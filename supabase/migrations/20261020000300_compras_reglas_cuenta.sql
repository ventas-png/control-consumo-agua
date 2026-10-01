-- ════════════════════════════════════════════════════════════════════════════
-- CUENTAS SUGERIDAS DE COMPRA · POR CATEGORÍA O PRODUCTO, CON VIGENCIA
-- (PR A, entrega 4 de 4 del lado de base de datos)
--
-- EL HUECO QUE CIERRA
-- El motor de imputación (20260926000000 → 20260928000000) resuelve la cuenta
-- de una línea así: cuenta elegida → regla del PROVEEDOR para el destino →
-- regla de cliente/unidad → mapeo del evento → nada. Dos cosas faltan para
-- compras:
--   · La regla del proveedor manda TODO lo que ese proveedor vende a UNA cuenta
--     por destino. Un mismo proveedor surte limpieza y herramienta; ese
--     reparto no se puede expresar.
--   · Las reglas por categoría que existen (`conta_reglas_cargo.categoria`) no
--     las consulta nadie: `conta_tg_facturas_prov` pasa `categoria = NULL`.
--   · Ninguna regla tiene VIGENCIA: cambiar un predeterminado reescribe lo que
--     se resolvería para fechas pasadas.
--
-- QUÉ HACE (aditivo; no modifica ninguna función ni trigger existente)
--   1. `conta_reglas_compra`: cuenta predeterminada por (destino, categoría o
--      producto, proveedor opcional) dentro de UN ledger, con vigencia.
--      Una regla sin categoría ni producto se rechaza: sería «todo a una
--      cuenta», justo lo que se quiere evitar. Cambiar un predeterminado es
--      CERRAR la regla vigente y abrir otra desde una fecha posterior
--      (`compras_reemplazar_regla_cuenta`); las reglas ya vigentes no se
--      editan ni se borran, así lo resuelto para fechas pasadas no cambia.
--   2. `conta_cuenta_apta_destino`: aptitud del TIPO de cuenta para el destino
--      (gasto/costo → gasto; inventario/activo_fijo → activo).
--   3. `compras_resolver_cuenta_linea`: la precedencia completa, que DELEGA el
--      tramo existente en `conta_resolver_imputacion_interno` en vez de
--      reimplementarlo:
--         1  cuenta elegida en la línea (validada: ledger, detalle, activa, apta)
--         2  regla de compra (producto+proveedor > producto > categoría+
--            proveedor > categoría), vigente en la fecha del documento
--         3  regla del proveedor para el destino          (motor existente)
--         4  mapeo general del evento                     (motor existente)
--         5  NADA → `sin_resolver` con motivo; jamás una cuenta genérica
--      Cada escalón REVALIDA la cuenta y, si la configuración está rota, se
--      corta con motivo en vez de caer al siguiente.
--   4. `compras_sugerir_cuenta`: lo mismo sin cuenta explícita y con código y
--      nombre, para que la pantalla de captura PRECARGUE la línea. La línea
--      guarda la cuenta elegida: es la selección explícita del escalón 1, así
--      que cambiar el predeterminado después no mueve documentos ya capturados.
--   5. `compras_config_estado`: qué destino/categoría NO resuelve y por qué,
--      más la cuenta por pagar del proveedor (mapeo `cxp_proveedores`), que es
--      CONCEPTO DISTINTO del destino de la compra.
--
-- QUÉ NO HACE
--   · No cablea el devengo: `conta_tg_facturas_prov` sigue igual. Cablear
--     `compras_resolver_cuenta_linea` al devengo y a la recepción es del PR B.
--     Hasta entonces estas reglas SUGIEREN al capturar; no mueven un asiento.
--   · No crea subcuentas por proveedor: el auxiliar por proveedor es
--     `facturas_proveedor.proveedor_id` (+ `cxp_antiguedad_saldos`).
--   · Ningún código contable fijo.
--
-- CÓMO REVERTIR: DROP de las seis funciones y de la tabla `conta_reglas_compra`
-- (con sus triggers y funciones `conta_reglas_compra_*`). Nada existente cambia.
-- IMPACTO EN DATOS PRODUCTIVOS: ninguno; la tabla nace vacía.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Vocabularios declarados ───────────────────────────────────────────────
-- La lista de categorías está hoy repetida a mano en conta_tg_facturas_prov y en
-- el TS (CATEGORIAS_GASTO_CXP). Aquí se DECLARA una vez para las reglas.
CREATE OR REPLACE FUNCTION public.compras_categorias()
RETURNS TABLE (categoria text, etiqueta text)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT * FROM (VALUES
    ('mantenimiento',  'Mantenimiento'),
    ('servicios',      'Servicios'),
    ('administrativo', 'Administrativo'),
    ('seguridad',      'Seguridad'),
    ('limpieza',       'Limpieza'),
    ('obras',          'Obras'),
    ('otros',          'Otros')
  ) AS t(categoria, etiqueta)
$$;
REVOKE EXECUTE ON FUNCTION public.compras_categorias() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_categorias() TO authenticated;

-- Destinos de una LÍNEA de compra. El puente GR/IR no es destino de una línea.
CREATE OR REPLACE FUNCTION public.compras_destinos_linea()
RETURNS TABLE (destino text, etiqueta text, tipo_cuenta text)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT * FROM (VALUES
    ('gasto',       'Gasto',       'gasto'),
    ('costo',       'Costo',       'gasto'),
    ('inventario',  'Inventario',  'activo'),
    ('activo_fijo', 'Activo fijo', 'activo')
  ) AS t(destino, etiqueta, tipo_cuenta)
$$;
REVOKE EXECUTE ON FUNCTION public.compras_destinos_linea() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_destinos_linea() TO authenticated;

COMMENT ON FUNCTION public.compras_destinos_linea() IS
  'Destinos de una línea de compra y el TIPO de cuenta que los admite. conta_cuentas.tipo no tiene «costo»: costo y gasto usan cuentas de tipo gasto.';

-- ── 2. Aptitud de la cuenta para el destino ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_cuenta_apta_destino(p_cuenta_id uuid, p_destino text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT c.tipo = d.tipo_cuenta
       FROM public.conta_cuentas c
       JOIN public.compras_destinos_linea() d ON d.destino = p_destino
      WHERE c.id = p_cuenta_id),
    false)
$$;
REVOKE EXECUTE ON FUNCTION public.conta_cuenta_apta_destino(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 3. Reglas ────────────────────────────────────────────────────────────────
CREATE TABLE public.conta_reglas_compra (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  destino       text        NOT NULL CHECK (destino IN ('gasto', 'costo', 'inventario', 'activo_fijo')),
  categoria     text,
  suministro_id uuid        REFERENCES public.suministros_condominio(id) ON DELETE CASCADE,
  proveedor_id  uuid        REFERENCES public.proveedores(id) ON DELETE CASCADE,
  cuenta_id     uuid        NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  vigente_desde date        NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta date,
  activa        boolean     NOT NULL DEFAULT true,
  notas         text,
  especificidad int         NOT NULL GENERATED ALWAYS AS (
    CASE
      WHEN suministro_id IS NOT NULL AND proveedor_id IS NOT NULL THEN 4
      WHEN suministro_id IS NOT NULL                              THEN 3
      WHEN proveedor_id  IS NOT NULL                              THEN 2
      ELSE 1
    END
  ) STORED,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Una regla sin categoría ni producto mandaría todo lo de un proveedor (o de
  -- un destino) a UNA cuenta. Eso ya existe, explícito y por proveedor, en
  -- conta_reglas_proveedor; aquí no se repite.
  CONSTRAINT conta_reglas_compra_clasifica
    CHECK (categoria IS NOT NULL OR suministro_id IS NOT NULL),
  CONSTRAINT conta_reglas_compra_no_ambas
    CHECK (NOT (categoria IS NOT NULL AND suministro_id IS NOT NULL)),
  CONSTRAINT conta_reglas_compra_vigencia
    CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE UNIQUE INDEX uq_conta_reglas_compra_vigencia
  ON public.conta_reglas_compra (
    company_id,
    COALESCE(project_id,    '00000000-0000-0000-0000-000000000000'::uuid),
    destino,
    COALESCE(suministro_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(categoria, ''),
    COALESCE(proveedor_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    vigente_desde);

CREATE INDEX idx_conta_reglas_compra_lookup
  ON public.conta_reglas_compra (company_id, project_id, destino, especificidad DESC)
  WHERE activa;
CREATE INDEX idx_conta_reglas_compra_cuenta ON public.conta_reglas_compra (cuenta_id);

COMMENT ON TABLE public.conta_reglas_compra IS
  'Cuenta predeterminada por destino y categoría o producto (proveedor opcional), dentro de UN ledger y con vigencia. Alimenta la SUGERENCIA al capturar la línea; la línea guarda la cuenta elegida.';
COMMENT ON COLUMN public.conta_reglas_compra.especificidad IS
  'Generada: 4 producto+proveedor, 3 producto, 2 categoría+proveedor, 1 categoría.';

-- Validación de la regla: ledger, detalle y activa (el trigger que ya existe),
-- más aptitud del tipo, vocabulario y coherencia de las dimensiones.
CREATE TRIGGER trg_conta_reglas_compra_a_cuenta
  BEFORE INSERT OR UPDATE ON public.conta_reglas_compra
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_regla_cuenta_valida();

CREATE OR REPLACE FUNCTION public.conta_reglas_compra_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sum record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = NEW.company_id) THEN
    RAISE EXCEPTION 'REGLA_EMPRESA_INEXISTENTE' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'REGLA_LEDGER: el proyecto no pertenece a la empresa de la regla.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.compras_destinos_linea() d WHERE d.destino = NEW.destino) THEN
    RAISE EXCEPTION 'REGLA_DESTINO: «%» no es un destino de línea de compra (gasto, costo, inventario, activo_fijo).', NEW.destino
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.categoria IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.compras_categorias() c WHERE c.categoria = NEW.categoria) THEN
    RAISE EXCEPTION 'REGLA_CATEGORIA: «%» no es una categoría de compra declarada.', NEW.categoria
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.proveedor_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.proveedores p WHERE p.id = NEW.proveedor_id AND p.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'REGLA_PROVEEDOR_AJENO: el proveedor no pertenece a la empresa de la regla.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Un producto es de UN proyecto: la regla vive en el ledger de ese proyecto.
  IF NEW.suministro_id IS NOT NULL THEN
    SELECT s.company_id, s.project_id INTO v_sum
      FROM public.suministros_condominio s WHERE s.id = NEW.suministro_id;
    IF NOT FOUND OR v_sum.company_id <> NEW.company_id
       OR NEW.project_id IS DISTINCT FROM v_sum.project_id THEN
      RAISE EXCEPTION 'REGLA_PRODUCTO_AJENO: el producto no es de la empresa y el proyecto (ledger) de la regla.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NOT public.conta_cuenta_apta_destino(NEW.cuenta_id, NEW.destino) THEN
    RAISE EXCEPTION 'REGLA_CUENTA_NO_APTA: una cuenta de ese tipo no admite el destino «%».', NEW.destino
      USING ERRCODE = 'check_violation';
  END IF;

  -- Vigencia: lo que ya rige no se reescribe. Se puede CERRAR (vigente_hasta),
  -- desactivar o anotar; cambiar la cuenta o las dimensiones es abrir otra
  -- regla (compras_reemplazar_regla_cuenta).
  IF TG_OP = 'UPDATE' AND OLD.vigente_desde <= CURRENT_DATE
     AND (NEW.cuenta_id     IS DISTINCT FROM OLD.cuenta_id
          OR NEW.destino      IS DISTINCT FROM OLD.destino
          OR NEW.categoria    IS DISTINCT FROM OLD.categoria
          OR NEW.suministro_id IS DISTINCT FROM OLD.suministro_id
          OR NEW.proveedor_id IS DISTINCT FROM OLD.proveedor_id
          OR NEW.project_id   IS DISTINCT FROM OLD.project_id
          OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde) THEN
    RAISE EXCEPTION 'REGLA_VIGENTE_INMUTABLE: una regla que ya rige no cambia de cuenta ni de dimensiones, para no reescribir lo resuelto en fechas pasadas. Usa compras_reemplazar_regla_cuenta().'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Sin traslapes para la MISMA combinación: dos reglas vigentes a la vez para
  -- lo mismo serían una ambigüedad que nadie eligió.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'regla-compra:' || NEW.company_id::text || ':' || COALESCE(NEW.project_id::text, '-')
      || ':' || NEW.destino, 0));

  IF NEW.activa AND EXISTS (
       SELECT 1 FROM public.conta_reglas_compra r
        WHERE r.id <> NEW.id
          AND r.company_id = NEW.company_id
          AND r.project_id    IS NOT DISTINCT FROM NEW.project_id
          AND r.destino       = NEW.destino
          AND r.suministro_id IS NOT DISTINCT FROM NEW.suministro_id
          AND r.categoria     IS NOT DISTINCT FROM NEW.categoria
          AND r.proveedor_id  IS NOT DISTINCT FROM NEW.proveedor_id
          AND r.activa
          AND daterange(r.vigente_desde, COALESCE(r.vigente_hasta, 'infinity'::date), '[]')
              && daterange(NEW.vigente_desde, COALESCE(NEW.vigente_hasta, 'infinity'::date), '[]')) THEN
    RAISE EXCEPTION 'REGLA_TRASLAPE: ya hay una regla activa para esa combinación cuya vigencia se traslapa. Ciérrala (vigente_hasta) o usa compras_reemplazar_regla_cuenta().'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.conta_reglas_compra_tg() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_reglas_compra_b_regla
  BEFORE INSERT OR UPDATE ON public.conta_reglas_compra
  FOR EACH ROW EXECUTE FUNCTION public.conta_reglas_compra_tg();

-- Una regla vigente no se borra (se cierra o se desactiva): borrarla cambiaría
-- retroactivamente lo que se habría resuelto.
CREATE OR REPLACE FUNCTION public.conta_reglas_compra_borrado_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.vigente_desde <= CURRENT_DATE THEN
    RAISE EXCEPTION 'REGLA_VIGENTE_INMUTABLE: una regla que ya rige no se borra: ciérrala con vigente_hasta o desactívala.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.conta_reglas_compra_borrado_tg() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_reglas_compra_del
  BEFORE DELETE ON public.conta_reglas_compra
  FOR EACH ROW EXECUTE FUNCTION public.conta_reglas_compra_borrado_tg();

CREATE TRIGGER audit_conta_reglas_compra
  AFTER INSERT OR UPDATE OR DELETE ON public.conta_reglas_compra
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.conta_reglas_compra ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conta_reglas_compra_select" ON public.conta_reglas_compra
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (project_id IS NULL OR public.can_access_project(project_id))));
CREATE POLICY "conta_reglas_compra_insert" ON public.conta_reglas_compra
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_super_admin())
              OR (company_id = (SELECT public.get_my_company_id())
                  AND (project_id IS NULL OR public.can_access_project(project_id))
                  AND public.conta_puede_escribir('create')));
CREATE POLICY "conta_reglas_compra_update" ON public.conta_reglas_compra
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (project_id IS NULL OR public.can_access_project(project_id))
             AND public.conta_puede_escribir('edit')))
  WITH CHECK ((SELECT public.is_super_admin())
              OR (company_id = (SELECT public.get_my_company_id())
                  AND (project_id IS NULL OR public.can_access_project(project_id))
                  AND public.conta_puede_escribir('edit')));
CREATE POLICY "conta_reglas_compra_delete" ON public.conta_reglas_compra
  FOR DELETE TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (project_id IS NULL OR public.can_access_project(project_id))
             AND public.conta_puede_escribir('delete')));

REVOKE ALL ON public.conta_reglas_compra FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conta_reglas_compra TO authenticated, service_role;

-- ── 5. Resolutor de una línea de compra ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_resolver_cuenta_linea(
  p_project_id       uuid,
  p_destino          text,
  p_categoria        text DEFAULT NULL,
  p_suministro_id    uuid DEFAULT NULL,
  p_proveedor_id     uuid DEFAULT NULL,
  p_cuenta_explicita uuid DEFAULT NULL,
  p_fecha            date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  cuenta_id uuid,
  origen    text,
  regla_id  uuid,
  motivo    text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_regla   record;
  v_ok      boolean;
  r         record;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NOT NULL AND (
       NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = v_company)
       OR NOT public.can_access_project(p_project_id)) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa o no tienes acceso.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.compras_destinos_linea() d WHERE d.destino = p_destino) THEN
    RAISE EXCEPTION 'DESTINO_INVALIDO: «%» no es un destino de línea de compra.', p_destino
      USING ERRCODE = '22023';
  END IF;

  -- ── 1. La cuenta elegida en la línea ───────────────────────────────────────
  IF p_cuenta_explicita IS NOT NULL THEN
    SELECT (c.company_id = v_company
            AND c.project_id IS NOT DISTINCT FROM p_project_id
            AND c.es_detalle AND c.activa)
      INTO v_ok FROM public.conta_cuentas c WHERE c.id = p_cuenta_explicita;

    IF NOT COALESCE(v_ok, false) THEN
      RETURN QUERY SELECT NULL::uuid, 'sin_resolver'::text, NULL::uuid,
        'La cuenta elegida en la línea no sirve para esta contabilidad: tiene que ser de este ledger, de detalle y activa.'::text;
      RETURN;
    END IF;
    IF NOT public.conta_cuenta_apta_destino(p_cuenta_explicita, p_destino) THEN
      RETURN QUERY SELECT NULL::uuid, 'sin_resolver'::text, NULL::uuid,
        format('La cuenta elegida no es de un tipo apto para el destino «%s».', p_destino)::text;
      RETURN;
    END IF;
    RETURN QUERY SELECT p_cuenta_explicita, 'linea_explicita'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- ── 2. Regla de compra vigente en la fecha del documento ───────────────────
  SELECT rc.id, rc.cuenta_id INTO v_regla
    FROM public.conta_reglas_compra rc
   WHERE rc.company_id = v_company
     AND rc.project_id IS NOT DISTINCT FROM p_project_id
     AND rc.destino = p_destino
     AND rc.activa
     AND rc.vigente_desde <= COALESCE(p_fecha, CURRENT_DATE)
     AND (rc.vigente_hasta IS NULL OR rc.vigente_hasta >= COALESCE(p_fecha, CURRENT_DATE))
     AND (rc.suministro_id IS NULL OR rc.suministro_id = p_suministro_id)
     AND (rc.categoria     IS NULL OR rc.categoria     = p_categoria)
     AND (rc.proveedor_id  IS NULL OR rc.proveedor_id  = p_proveedor_id)
   ORDER BY rc.especificidad DESC, rc.vigente_desde DESC, rc.id
   LIMIT 1;

  IF FOUND THEN
    SELECT (c.company_id = v_company
            AND c.project_id IS NOT DISTINCT FROM p_project_id
            AND c.es_detalle AND c.activa)
           AND public.conta_cuenta_apta_destino(c.id, p_destino)
      INTO v_ok FROM public.conta_cuentas c WHERE c.id = v_regla.cuenta_id;

    IF COALESCE(v_ok, false) THEN
      RETURN QUERY SELECT v_regla.cuenta_id, 'regla_compra'::text, v_regla.id, NULL::text;
      RETURN;
    END IF;
    -- La regla existe pero su cuenta ya no sirve: se corta, no se cae a otra.
    RETURN QUERY SELECT NULL::uuid, 'sin_resolver'::text, v_regla.id,
      'La regla de compra apunta a una cuenta que ya no sirve (desactivada, agrupadora, de otro ledger o de tipo no apto). Corrige la regla.'::text;
    RETURN;
  END IF;

  -- ── 3 y 4. Regla del proveedor y mapeo del evento: el motor EXISTENTE ──────
  -- cliente, unidad y categoría van en NULL: las reglas de cargo son de otro
  -- flujo (cuotas y cargos a unidades), no de compras.
  SELECT * INTO r FROM public.conta_resolver_imputacion_interno(
    v_company, p_project_id, p_destino, p_proveedor_id, NULL, NULL, NULL, NULL, NULL);

  IF r.cuenta_id IS NOT NULL AND NOT public.conta_cuenta_apta_destino(r.cuenta_id, p_destino) THEN
    RETURN QUERY SELECT NULL::uuid, 'sin_resolver'::text, r.regla_id,
      format('La cuenta resuelta por «%s» no es de un tipo apto para el destino «%s». Corrige la regla o el mapeo.',
             r.origen_resolucion, p_destino)::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT r.cuenta_id, r.origen_resolucion, r.regla_id, r.motivo;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_resolver_cuenta_linea(uuid, text, text, uuid, uuid, uuid, date)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_resolver_cuenta_linea(uuid, text, text, uuid, uuid, uuid, date)
  TO authenticated;

COMMENT ON FUNCTION public.compras_resolver_cuenta_linea(uuid, text, text, uuid, uuid, uuid, date) IS
  'Precedencia completa para una línea de compra: cuenta elegida > regla de compra vigente (producto/categoría) > regla del proveedor > mapeo del evento > sin_resolver. STABLE y sin efectos; delega el tramo existente en conta_resolver_imputacion_interno.';

-- ── 6. Sugerencia para la pantalla de captura ────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_sugerir_cuenta(
  p_project_id    uuid,
  p_destino       text,
  p_categoria     text DEFAULT NULL,
  p_suministro_id uuid DEFAULT NULL,
  p_proveedor_id  uuid DEFAULT NULL,
  p_fecha         date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  cuenta_id     uuid,
  cuenta_codigo text,
  cuenta_nombre text,
  origen        text,
  regla_id      uuid,
  motivo        text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- El resolutor ya valida empresa y proyecto; se repite aquí a propósito: el
  -- guard de scope no debe depender de que alguien no cambie la función
  -- delegada (misma lección que assert_company_scope).
  IF public.get_my_company_id() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.cuenta_id, c.codigo, c.nombre, r.origen, r.regla_id, r.motivo
    FROM public.compras_resolver_cuenta_linea(
           p_project_id, p_destino, p_categoria, p_suministro_id, p_proveedor_id, NULL, p_fecha) r
    LEFT JOIN public.conta_cuentas c ON c.id = r.cuenta_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_sugerir_cuenta(uuid, text, text, uuid, uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_sugerir_cuenta(uuid, text, text, uuid, uuid, date) TO authenticated;

COMMENT ON FUNCTION public.compras_sugerir_cuenta(uuid, text, text, uuid, uuid, date) IS
  'La cuenta que se SUGIERE al capturar una línea (con código y nombre). La línea guarda la cuenta elegida: esa elección explícita es la que prevalece después sobre cualquier predeterminado.';

-- ── 7. Cambiar un predeterminado sin tocar el pasado ─────────────────────────
CREATE OR REPLACE FUNCTION public.compras_reemplazar_regla_cuenta(
  p_regla_id uuid, p_cuenta_id uuid, p_vigente_desde date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_old     public.conta_reglas_compra%ROWTYPE;
  v_new     uuid;
BEGIN
  IF v_company IS NULL OR NOT public.conta_puede_escribir('edit') THEN
    RAISE EXCEPTION 'No autorizado para cambiar reglas de compra.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old FROM public.conta_reglas_compra
   WHERE id = p_regla_id AND company_id = v_company;
  IF NOT FOUND OR (v_old.project_id IS NOT NULL AND NOT public.can_access_project(v_old.project_id)) THEN
    RAISE EXCEPTION 'La regla no existe o no pertenece a tu empresa/proyecto.' USING ERRCODE = '42501';
  END IF;
  IF p_vigente_desde IS NULL OR p_vigente_desde <= v_old.vigente_desde
     OR p_vigente_desde <= CURRENT_DATE THEN
    RAISE EXCEPTION 'REGLA_FECHA: el reemplazo debe regir desde una fecha FUTURA y posterior al inicio de la regla actual; lo anterior no se reescribe.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cierra la actual el día anterior y abre la nueva: sin huecos ni traslapes.
  UPDATE public.conta_reglas_compra
     SET vigente_hasta = p_vigente_desde - 1
   WHERE id = v_old.id;

  INSERT INTO public.conta_reglas_compra
    (company_id, project_id, destino, categoria, suministro_id, proveedor_id, cuenta_id,
     vigente_desde, notas)
  VALUES
    (v_old.company_id, v_old.project_id, v_old.destino, v_old.categoria, v_old.suministro_id,
     v_old.proveedor_id, p_cuenta_id, p_vigente_desde, v_old.notas)
  RETURNING id INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_reemplazar_regla_cuenta(uuid, uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_reemplazar_regla_cuenta(uuid, uuid, date) TO authenticated;

-- ── 8. Configuración incompleta: visible, no silenciosa ─────────────────────
-- Una fila por (destino, categoría) y una para la cuenta por pagar. `completa`
-- = el sistema SABE a qué cuenta iría; si no, `motivo` dice qué configurar.
CREATE OR REPLACE FUNCTION public.compras_config_estado(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  concepto      text,
  destino       text,
  categoria     text,
  cuenta_id     uuid,
  cuenta_codigo text,
  origen        text,
  completa      boolean,
  motivo        text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_cxp     uuid;
  v_ok      boolean;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NOT NULL AND (
       NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = v_company)
       OR NOT public.can_access_project(p_project_id)) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa o no tienes acceso.' USING ERRCODE = '42501';
  END IF;

  -- Cuenta POR PAGAR del proveedor: concepto distinto del destino de la compra.
  v_cxp := public.conta_cuenta_para(v_company, p_project_id, 'cxp_proveedores');
  IF v_cxp IS NOT NULL THEN
    SELECT (c.es_detalle AND c.activa) INTO v_ok FROM public.conta_cuentas c WHERE c.id = v_cxp;
  END IF;
  RETURN QUERY
  SELECT 'cuenta_por_pagar'::text, NULL::text, NULL::text,
         CASE WHEN COALESCE(v_ok, false) THEN v_cxp END,
         (SELECT c.codigo FROM public.conta_cuentas c WHERE c.id = v_cxp AND COALESCE(v_ok, false)),
         CASE WHEN COALESCE(v_ok, false) THEN 'mapeo_evento' ELSE 'sin_resolver' END,
         COALESCE(v_ok, false),
         CASE
           WHEN v_cxp IS NULL THEN 'No hay cuenta por pagar mapeada (evento cxp_proveedores) en esta contabilidad.'
           WHEN NOT COALESCE(v_ok, false) THEN 'La cuenta por pagar mapeada ya no sirve (desactivada o agrupadora).'
         END;

  -- Destino × categoría, sin proveedor ni producto: lo que se sugeriría «por
  -- defecto» para cada clase de compra.
  RETURN QUERY
  SELECT 'destino'::text, d.destino, k.categoria, r.cuenta_id, c.codigo, r.origen,
         r.cuenta_id IS NOT NULL, r.motivo
    FROM public.compras_destinos_linea() d
    CROSS JOIN public.compras_categorias() k
    CROSS JOIN LATERAL public.compras_resolver_cuenta_linea(
                 p_project_id, d.destino, k.categoria, NULL, NULL, NULL, CURRENT_DATE) r
    LEFT JOIN public.conta_cuentas c ON c.id = r.cuenta_id
   ORDER BY d.destino, k.categoria;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_config_estado(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_config_estado(uuid) TO authenticated;

COMMENT ON FUNCTION public.compras_config_estado(uuid) IS
  'Qué destino/categoría de compra no resuelve cuenta y por qué, más la cuenta por pagar del proveedor (concepto distinto del destino). Es lo que hace visible una configuración incompleta.';
