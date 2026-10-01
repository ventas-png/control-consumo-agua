-- ════════════════════════════════════════════════════════════════════════════
-- LA CUENTA DE LAS LÍNEAS DE COMPRA LA RESUELVE EL SERVIDOR AL GUARDAR (PR A)
--
-- EL PROBLEMA
-- La pantalla consultaba la cuenta sugerida con una query aparte y guardaba en la
-- línea lo que esa query hubiera devuelto *en ese instante*: si seguía cargando
-- o había fallado, la línea se guardaba sin cuenta; si el proveedor o la
-- categoría cambiaban a mitad de una consulta lenta, se guardaba la cuenta de la
-- entrada ANTERIOR. La misma entrada daba cuentas distintas según la latencia.
--
-- LA CORRECCIÓN
-- La resolución y su validación son del servidor, en el momento de guardar:
--   · INSERT sin cuenta: se resuelve con `compras_resolver_cuenta_linea_interno`
--     (la MISMA función que usa la sugerencia de la pantalla). Solo una REGLA DE
--     COMPRA fija `cuenta_id`; sin regla, la línea queda sin cuenta y el posteo
--     sigue resolviendo como hoy. `cuenta_origen` dice cuál fue el caso.
--   · INSERT/UPDATE con cuenta elegida: se valida (ledger, detalle, activa,
--     tipo apto para el destino) y queda como `linea_explicita`: prevalece.
--   · UPDATE de categoría, destino o producto en una línea automática: se
--     re-resuelve; una elegida a mano no se toca.
--   · Cambiar el proveedor de una orden en BORRADOR re-resuelve sus líneas
--     automáticas (la regla puede ser por proveedor).
--   · Fuera del borrador las líneas no se editan (ya lo exigía
--     `compras_tg_oc_linea_total`): la cuenta guardada es historia y un cambio
--     posterior de predeterminados no la altera.
-- Determinismo: la fecha de vigencia es la del servidor al guardar, no la del
-- cliente; la misma entrada y la misma configuración dan la misma cuenta.
--
-- COMPATIBILIDAD
--   · `cuenta_id` NOT NULL con `cuenta_origen` NULL (líneas anteriores) se trata
--     como elegida a mano: no se re-resuelve ni se toca ninguna fila existente.
--   · `compras_resolver_cuenta_linea` conserva firma y comportamiento: ahora
--     valida sesión y delega en la función interna (una sola lógica).
--
-- CÓMO REVERTIR
--   DROP TRIGGER trg_compras_oc_linea_zcuenta ON public.orden_compra_lineas;
--   DROP TRIGGER trg_compras_oc_proveedor_reresolver ON public.ordenes_compra;
--   DROP FUNCTION public.compras_tg_oc_linea_cuenta(), public.compras_tg_oc_reresolver_cuentas();
--   restaurar compras_resolver_cuenta_linea() de 20261020000300 y
--   DROP FUNCTION public.compras_resolver_cuenta_linea_interno(uuid,uuid,text,text,uuid,uuid,uuid,date);
--   ALTER TABLE public.orden_compra_lineas DROP COLUMN cuenta_origen, DROP COLUMN cuenta_regla_id;
--
-- IMPACTO EN DATOS: dos columnas NULL (sin reescribir la tabla). Ninguna fila cambia.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orden_compra_lineas
  ADD COLUMN IF NOT EXISTS cuenta_origen   text,
  ADD COLUMN IF NOT EXISTS cuenta_regla_id uuid;

ALTER TABLE public.orden_compra_lineas
  ADD CONSTRAINT orden_compra_lineas_cuenta_origen
    CHECK (cuenta_origen IS NULL OR cuenta_origen IN ('linea_explicita', 'regla_compra'));

COMMENT ON COLUMN public.orden_compra_lineas.cuenta_origen IS
  'De dónde salió cuenta_id: linea_explicita (elegida y validada) o regla_compra (resuelta por el servidor al guardar). NULL con cuenta_id = línea anterior, tratada como elegida; NULL sin cuenta_id = sin regla aplicable (rige el mapeo al contabilizar).';
COMMENT ON COLUMN public.orden_compra_lineas.cuenta_regla_id IS
  'Regla de compra que fijó cuenta_id (trazabilidad; sin FK: la regla puede cerrarse y la línea conserva su cuenta).';

-- ── 1. Resolución interna (sin sesión) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_resolver_cuenta_linea_interno(
  p_company          uuid,
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
  v_company uuid := p_company;
  v_regla   record;
  v_ok      boolean;
  r         record;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_CUENTA_EMPRESA: falta la empresa para resolver la cuenta.' USING ERRCODE = '22023';
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

REVOKE EXECUTE ON FUNCTION public.compras_resolver_cuenta_linea_interno(uuid, uuid, text, text, uuid, uuid, uuid, date)
  FROM PUBLIC, anon, authenticated;

-- ── 2. La función pública pasa a ser un envoltorio con guard de sesión ───────
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
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NOT NULL AND (
       NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = v_company)
       OR NOT public.can_access_project(p_project_id)) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa o no tienes acceso.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.cuenta_id, r.origen, r.regla_id, r.motivo
    FROM public.compras_resolver_cuenta_linea_interno(
           v_company, p_project_id, p_destino, p_categoria, p_suministro_id,
           p_proveedor_id, p_cuenta_explicita, p_fecha) r;
END;
$$;

-- ── 3. Trigger de la línea: resolver y validar al guardar ────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_oc_linea_cuenta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_oc      record;
  v_destino text;
  v_auto    boolean := COALESCE(current_setting('compras.reresolver_cuentas', true), 'off') = 'on';
  v_resolver boolean := false;
  v_validar  boolean := false;
  r         record;
BEGIN
  -- Recepciones y facturas mueven cantidades acumuladas con el GUC del sistema:
  -- ahí no se resuelve ni se valida nada.
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_validar  := NEW.cuenta_id IS NOT NULL;
    v_resolver := NEW.cuenta_id IS NULL;
  ELSE
    IF v_auto THEN
      -- Re-resolución pedida por el cambio de proveedor de la orden: solo las
      -- líneas AUTOMÁTICAS (sin cuenta, o fijadas por una regla).
      v_resolver := OLD.cuenta_origen = 'regla_compra'
                 OR (OLD.cuenta_id IS NULL AND OLD.cuenta_origen IS NULL);
    ELSIF NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id THEN
      v_validar  := NEW.cuenta_id IS NOT NULL;
      v_resolver := NEW.cuenta_id IS NULL;
    ELSIF (NEW.categoria IS DISTINCT FROM OLD.categoria
           OR NEW.destino_tipo IS DISTINCT FROM OLD.destino_tipo
           OR NEW.suministro_id IS DISTINCT FROM OLD.suministro_id)
          AND (OLD.cuenta_origen = 'regla_compra'
               OR (OLD.cuenta_id IS NULL AND OLD.cuenta_origen IS NULL)) THEN
      v_resolver := true;   -- línea automática cuya clasificación cambió
    END IF;
  END IF;

  IF NOT (v_validar OR v_resolver) THEN
    RETURN NEW;
  END IF;

  SELECT o.company_id, o.project_id, o.proveedor_id INTO v_oc
    FROM public.ordenes_compra o WHERE o.id = NEW.orden_compra_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_destino := CASE NEW.destino_tipo
                 WHEN 'servicio' THEN 'gasto'
                 ELSE NEW.destino_tipo END;   -- gasto | inventario | activo_fijo

  IF v_validar THEN
    SELECT * INTO r FROM public.compras_resolver_cuenta_linea_interno(
      v_oc.company_id, v_oc.project_id, v_destino, NEW.categoria, NEW.suministro_id,
      v_oc.proveedor_id, NEW.cuenta_id, CURRENT_DATE);
    IF r.cuenta_id IS NULL THEN
      RAISE EXCEPTION 'COMPRAS_LINEA_CUENTA_INVALIDA: %', r.motivo
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.cuenta_origen   := 'linea_explicita';
    NEW.cuenta_regla_id := NULL;
    RETURN NEW;
  END IF;

  -- Resolver: SOLO una regla de compra fija la cuenta; lo demás se deja vacío
  -- para que el posteo siga como hoy. Una regla con la cuenta rota NO se
  -- esconde: se rechaza el guardado con el motivo (no se guarda una cuenta nula
  -- «por si acaso»).
  SELECT * INTO r FROM public.compras_resolver_cuenta_linea_interno(
    v_oc.company_id, v_oc.project_id, v_destino, NEW.categoria, NEW.suministro_id,
    v_oc.proveedor_id, NULL, CURRENT_DATE);

  IF r.origen = 'regla_compra' THEN
    NEW.cuenta_id       := r.cuenta_id;
    NEW.cuenta_origen   := 'regla_compra';
    NEW.cuenta_regla_id := r.regla_id;
  ELSIF r.origen = 'sin_resolver' AND r.regla_id IS NOT NULL THEN
    RAISE EXCEPTION 'COMPRAS_LINEA_REGLA_ROTA: %', r.motivo USING ERRCODE = 'check_violation';
  ELSE
    NEW.cuenta_id       := NULL;
    NEW.cuenta_origen   := NULL;
    NEW.cuenta_regla_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_linea_cuenta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_oc_linea_zcuenta ON public.orden_compra_lineas;
CREATE TRIGGER trg_compras_oc_linea_zcuenta
  BEFORE INSERT OR UPDATE ON public.orden_compra_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_linea_cuenta();

-- ── 4. Cambiar el proveedor de una orden en borrador re-resuelve sus líneas ──
CREATE OR REPLACE FUNCTION public.compras_tg_oc_reresolver_cuentas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('compras.reresolver_cuentas', 'on', true);
  UPDATE public.orden_compra_lineas SET updated_at = now() WHERE orden_compra_id = NEW.id;
  PERFORM set_config('compras.reresolver_cuentas', 'off', true);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_reresolver_cuentas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_oc_proveedor_reresolver ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_proveedor_reresolver
  AFTER UPDATE OF proveedor_id ON public.ordenes_compra
  FOR EACH ROW
  WHEN (OLD.proveedor_id IS DISTINCT FROM NEW.proveedor_id AND NEW.estado = 'borrador')
  EXECUTE FUNCTION public.compras_tg_oc_reresolver_cuentas();
