-- ============================================================================
-- REGLAS CONFIGURABLES DE IMPUTACIÓN CONTABLE
--
-- Cierra el «Fuera de alcance / siguiente PR» que dejó anotado #882: cuenta
-- predeterminada por proveedor, reglas por cliente/unidad/tipo de cargo, y una
-- prioridad determinista con trazabilidad de por qué se eligió cada cuenta.
--
-- EL PROBLEMA QUE RESUELVE. Hoy la imputación de una factura de proveedor sale
-- de `'gasto_' || NEW.categoria` en el trigger de 20260821000300: la categoría
-- del documento decide el evento y el evento decide la cuenta. Eso no permite
-- que un proveedor concreto impute distinto del resto de su categoría, ni que
-- un cargo de una unidad vaya a una cuenta propia, y no deja rastro de por qué
-- se eligió lo que se eligió.
--
-- LA PRIORIDAD, y es DETERMINISTA de arriba hacia abajo:
--   1. cuenta elegida explícitamente en el documento o la línea;
--   2. regla del proveedor para ese tipo de destino;
--   3. regla de cliente/unidad y tipo de cargo, de la más específica a la más
--      general;
--   4. mapeo general del evento contable (`conta_cuenta_para`);
--   5. NADA. No se inventa una cuenta: se devuelve `sin_resolver` con motivo y
--      el documento queda pendiente de configuración.
--
-- El quinto escalón es el que importa. Una cuenta inventada es un asiento mal
-- imputado que nadie audita hasta el cierre; un documento pendiente es visible
-- y se arregla configurando la regla que falta.
--
-- SIN CÓDIGOS FIJOS. Ni esta migración ni el resolutor mencionan '1102' ni
-- '5101' ni ningún código contable: los destinos se declaran semánticamente en
-- `conta_destinos_imputacion()`, igual que `conta_eventos_especiales()` de
-- 20260918121413, y cada destino nombra el EVENTO al que cae por defecto.
--
-- AISLAMIENTO. Las dos tablas de reglas llevan company_id y project_id, y un
-- trigger exige que la cuenta pertenezca al MISMO ledger que la regla —el
-- mismo patrón que `conta_tg_mapeo_mismo_ledger` de 20260612000000—, además de
-- ser ACTIVA y de DETALLE. Una regla no puede apuntar a una cuenta de otra
-- empresa, de otro proyecto, agrupadora ni desactivada.
--
-- LAS REGLAS NACEN VACÍAS. No hay backfill: sin reglas configuradas el
-- resolutor cae al escalón 4 y el comportamiento es exactamente el de hoy.
--
-- CÓMO SE REVIERTE: DROP de `conta_resolver_imputacion`,
-- `conta_registrar_resolucion`, `conta_destinos_imputacion`,
-- `conta_tg_regla_cuenta_valida` y de las tres tablas `conta_reglas_proveedor`,
-- `conta_reglas_cargo` y `conta_resoluciones`. Nada de lo existente se
-- modifica, así que revertir devuelve el sistema al estado previo exacto.
-- ============================================================================

-- ── 1. Catálogo declarado de destinos de imputación ─────────────────────────
-- Qué puede querer decir «la cuenta de este proveedor». Cada destino nombra el
-- evento de `conta_mapeo_cuentas` al que cae cuando no hay regla, que es lo
-- que hace innecesario cablear códigos: el evento ya sabe resolverse solo.
CREATE OR REPLACE FUNCTION public.conta_destinos_imputacion()
RETURNS TABLE (destino text, etiqueta text, descripcion text, evento_fallback text)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT * FROM (VALUES
    ('gasto',                'Gasto',                'Consumo del período: servicios, mantenimiento, administración', 'gasto_otros'),
    ('costo',                'Costo',                'Costo directo imputable a un proyecto u obra',                  'gasto_obras'),
    ('inventario',           'Inventario',           'Insumos que entran a bodega y se consumen después',             'inventario'),
    ('activo_fijo',          'Activo fijo',          'Bienes capitalizables que se deprecian',                        'activo_fijo'),
    ('compras_por_facturar', 'Compras por facturar', 'Puente GR/IR entre la recepción y la factura',                  'compras_por_facturar')
  ) AS t(destino, etiqueta, descripcion, evento_fallback)
$$;

REVOKE EXECUTE ON FUNCTION public.conta_destinos_imputacion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_destinos_imputacion() TO authenticated;

COMMENT ON FUNCTION public.conta_destinos_imputacion() IS
  'Catálogo declarado de destinos de imputación y el evento de conta_mapeo_cuentas al que cae cada uno. Sin códigos contables fijos.';

-- ── 2. Reglas por proveedor ─────────────────────────────────────────────────
-- Una fila por (ledger, proveedor, destino). `project_id` NULL = regla del
-- ledger de EMPRESA; con valor = regla del ledger de ese proyecto. No hay
-- herencia de empresa a proyecto: el ledger del documento es el que manda, y
-- mezclar los dos es lo que 20260612000000 cerró a propósito.
CREATE TABLE public.conta_reglas_proveedor (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  proveedor_id uuid        NOT NULL REFERENCES public.proveedores(id) ON DELETE CASCADE,
  destino      text        NOT NULL,
  cuenta_id    uuid        NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  activa       boolean     NOT NULL DEFAULT true,
  notas        text,
  created_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conta_reglas_proveedor_destino_valido
    CHECK (destino IN ('gasto','costo','inventario','activo_fijo','compras_por_facturar'))
);

-- UNA regla por proveedor y destino dentro de un ledger. Es la restricción que
-- hace determinista el escalón 2: no puede haber dos candidatas empatadas.
CREATE UNIQUE INDEX uq_conta_reglas_proveedor_ledger
  ON public.conta_reglas_proveedor(
    company_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    proveedor_id,
    destino);

CREATE INDEX idx_conta_reglas_proveedor_lookup
  ON public.conta_reglas_proveedor(company_id, project_id, proveedor_id)
  WHERE activa;

CREATE INDEX idx_conta_reglas_proveedor_cuenta
  ON public.conta_reglas_proveedor(cuenta_id);

COMMENT ON TABLE public.conta_reglas_proveedor IS
  'Cuenta predeterminada por proveedor y tipo de destino, dentro de UN ledger. Escalón 2 de la prioridad de imputación.';

-- ── 3. Reglas por cliente / unidad / tipo de cargo ──────────────────────────
-- Las tres dimensiones son opcionales y se combinan. `especificidad` es
-- GENERADA, no escrita: es lo que ordena el escalón 3 sin depender de que
-- alguien mantenga un número a mano.
--
--   4  unidad + categoría   la más específica que existe
--   3  unidad
--   2  cliente + categoría
--   1  cliente
--   0  sólo categoría       la más general
--
-- `cliente_id` y `unidad_id` no pueden ir los dos: una unidad ya pertenece a
-- un cliente y admitir el par abriría un empate que la especificidad no sabría
-- romper.
CREATE TABLE public.conta_reglas_cargo (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  cliente_id    uuid        REFERENCES public.clientes(id) ON DELETE CASCADE,
  unidad_id     uuid        REFERENCES public.unidades(id) ON DELETE CASCADE,
  categoria     text,
  cuenta_id     uuid        NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  activa        boolean     NOT NULL DEFAULT true,
  notas         text,
  especificidad int         NOT NULL GENERATED ALWAYS AS (
    CASE
      WHEN unidad_id  IS NOT NULL AND categoria IS NOT NULL THEN 4
      WHEN unidad_id  IS NOT NULL                           THEN 3
      WHEN cliente_id IS NOT NULL AND categoria IS NOT NULL THEN 2
      WHEN cliente_id IS NOT NULL                           THEN 1
      ELSE 0
    END
  ) STORED,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Una regla sin ninguna dimensión sería un «todo va acá» que pisaría el
  -- mapeo del evento sin decirlo. Se exige al menos una.
  CONSTRAINT conta_reglas_cargo_alguna_dimension
    CHECK (cliente_id IS NOT NULL OR unidad_id IS NOT NULL OR categoria IS NOT NULL),
  CONSTRAINT conta_reglas_cargo_no_cliente_y_unidad
    CHECK (NOT (cliente_id IS NOT NULL AND unidad_id IS NOT NULL))
);

-- Unicidad por combinación EXACTA dentro del ledger. Con los centinelas, dos
-- reglas con las mismas tres dimensiones colisionan y la tercera columna no
-- puede quedar ambigua.
CREATE UNIQUE INDEX uq_conta_reglas_cargo_ledger
  ON public.conta_reglas_cargo(
    company_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(unidad_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(categoria,  ''));

CREATE INDEX idx_conta_reglas_cargo_lookup
  ON public.conta_reglas_cargo(company_id, project_id, especificidad DESC)
  WHERE activa;

CREATE INDEX idx_conta_reglas_cargo_cuenta
  ON public.conta_reglas_cargo(cuenta_id);

COMMENT ON TABLE public.conta_reglas_cargo IS
  'Reglas de imputación por cliente, unidad y tipo de cargo dentro de UN ledger. Escalón 3; `especificidad` es generada y ordena el desempate.';

COMMENT ON COLUMN public.conta_reglas_cargo.especificidad IS
  'Generada: 4 unidad+categoría, 3 unidad, 2 cliente+categoría, 1 cliente, 0 sólo categoría. No se escribe a mano.';

-- ── 4. La cuenta de una regla tiene que SERVIR ──────────────────────────────
-- Tres cosas a la vez, y las tres se comprueban en el mismo trigger porque
-- fallan por la misma razón —una regla que apunta a una cuenta que no puede
-- recibir el movimiento—:
--   · misma empresa y mismo ledger que la regla;
--   · de DETALLE: las agrupadoras acumulan saldo, no lo reciben;
--   · ACTIVA.
-- Se valida en BEFORE INSERT OR UPDATE y no con una FK compuesta porque el
-- ledger es (company_id, project_id) con project_id NULLable, y una FK no
-- expresa `IS NOT DISTINCT FROM`.
CREATE OR REPLACE FUNCTION public.conta_tg_regla_cuenta_valida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cuenta record;
BEGIN
  SELECT company_id, project_id, es_detalle, activa
    INTO v_cuenta
    FROM public.conta_cuentas
   WHERE id = NEW.cuenta_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGLA_CUENTA_INEXISTENTE: la cuenta % no existe.', NEW.cuenta_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_cuenta.company_id <> NEW.company_id
     OR v_cuenta.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'REGLA_LEDGER: la cuenta no pertenece a la contabilidad (empresa/proyecto) de la regla.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_cuenta.es_detalle THEN
    RAISE EXCEPTION 'REGLA_CUENTA_AGRUPADORA: sólo las cuentas de detalle reciben movimientos.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_cuenta.activa THEN
    RAISE EXCEPTION 'REGLA_CUENTA_INACTIVA: la cuenta está desactivada.'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_regla_cuenta_valida() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conta_reglas_proveedor_cuenta ON public.conta_reglas_proveedor;
CREATE TRIGGER trg_conta_reglas_proveedor_cuenta
  BEFORE INSERT OR UPDATE ON public.conta_reglas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_regla_cuenta_valida();

DROP TRIGGER IF EXISTS trg_conta_reglas_cargo_cuenta ON public.conta_reglas_cargo;
CREATE TRIGGER trg_conta_reglas_cargo_cuenta
  BEFORE INSERT OR UPDATE ON public.conta_reglas_cargo
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_regla_cuenta_valida();

-- ── 5. La regla de cargo vive en el proyecto de su unidad/cliente ───────────
-- Sin esto, una regla del ledger del proyecto A podría nombrar una unidad del
-- proyecto B: el aislamiento por company_id no alcanza, porque las dos
-- unidades pueden ser de la MISMA empresa.
CREATE OR REPLACE FUNCTION public.conta_tg_regla_cargo_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.unidad_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.unidades u
       WHERE u.id = NEW.unidad_id
         AND u.company_id = NEW.company_id
         AND (NEW.project_id IS NULL OR u.project_id = NEW.project_id)
    ) THEN
      RAISE EXCEPTION 'REGLA_UNIDAD_AJENA: la unidad no pertenece a la empresa/proyecto de la regla.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.cliente_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clientes c
       WHERE c.id = NEW.cliente_id
         AND (NEW.project_id IS NULL OR c.project_id IS NOT DISTINCT FROM NEW.project_id)
    ) THEN
      RAISE EXCEPTION 'REGLA_CLIENTE_AJENO: el cliente no pertenece al proyecto de la regla.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_regla_cargo_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conta_reglas_cargo_tenant ON public.conta_reglas_cargo;
CREATE TRIGGER trg_conta_reglas_cargo_tenant
  BEFORE INSERT OR UPDATE ON public.conta_reglas_cargo
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_regla_cargo_tenant();

-- El proveedor de una regla tiene que ser de la misma empresa. `proveedores`
-- no tiene project_id, así que aquí sólo hay una dimensión que comprobar.
CREATE OR REPLACE FUNCTION public.conta_tg_regla_proveedor_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.proveedores p
     WHERE p.id = NEW.proveedor_id AND p.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'REGLA_PROVEEDOR_AJENO: el proveedor no pertenece a la empresa de la regla.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_regla_proveedor_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conta_reglas_proveedor_tenant ON public.conta_reglas_proveedor;
CREATE TRIGGER trg_conta_reglas_proveedor_tenant
  BEFORE INSERT OR UPDATE ON public.conta_reglas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_regla_proveedor_tenant();

-- ── 6. Trazabilidad ─────────────────────────────────────────────────────────
-- Qué se resolvió, con qué regla, por qué, quién y cuándo — y también los
-- FALLOS, que son la mitad útil: `cuenta_id` NULL con motivo es lo que hace
-- visible una configuración incompleta en vez de dejarla pasar en silencio.
--
-- No lleva FK a la tabla de origen porque el origen es polimórfico
-- (facturas_proveedor, cargos_adicionales_unidad, …). A cambio, un índice por
-- (origen_tabla, origen_id) para poder leer el historial de un documento.
CREATE TABLE public.conta_resoluciones (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  origen_tabla text        NOT NULL,
  origen_id    uuid        NOT NULL,
  destino      text,
  evento       text,
  cuenta_id    uuid        REFERENCES public.conta_cuentas(id) ON DELETE SET NULL,
  origen_resolucion text   NOT NULL,
  regla_tabla  text,
  regla_id     uuid,
  motivo       text,
  resuelto_por uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conta_resoluciones_origen_valido
    CHECK (origen_resolucion IN ('linea_explicita','regla_proveedor','regla_cargo','mapeo_evento','sin_resolver')),
  -- Las cuatro que resuelven TIENEN cuenta; `sin_resolver` NO la tiene y sí
  -- tiene motivo. Sin este CHECK la tabla podría afirmar que resolvió algo y
  -- no decir con qué.
  CONSTRAINT conta_resoluciones_coherente
    CHECK (
      (origen_resolucion = 'sin_resolver' AND cuenta_id IS NULL AND motivo IS NOT NULL)
      OR (origen_resolucion <> 'sin_resolver' AND cuenta_id IS NOT NULL)
    )
);

CREATE INDEX idx_conta_resoluciones_origen
  ON public.conta_resoluciones(origen_tabla, origen_id, created_at DESC);

CREATE INDEX idx_conta_resoluciones_pendientes
  ON public.conta_resoluciones(company_id, project_id, created_at DESC)
  WHERE origen_resolucion = 'sin_resolver';

COMMENT ON TABLE public.conta_resoluciones IS
  'Bitácora de imputación: qué cuenta se resolvió, con qué regla, por qué escalón, quién y cuándo. Las filas sin_resolver son las configuraciones incompletas.';

-- ── 7. El resolutor ─────────────────────────────────────────────────────────
-- STABLE y sin efectos: resuelve y explica, no escribe. Registrar es un paso
-- aparte (`conta_registrar_resolucion`) para que la UI pueda PREVISUALIZAR la
-- decisión sin ensuciar la bitácora.
--
-- Devuelve siempre una fila. `cuenta_id` NULL significa escalón 5, y entonces
-- `motivo` dice qué falta configurar.
CREATE OR REPLACE FUNCTION public.conta_resolver_imputacion(
  p_project_id       uuid,
  p_destino          text    DEFAULT NULL,
  p_proveedor_id     uuid    DEFAULT NULL,
  p_cliente_id       uuid    DEFAULT NULL,
  p_unidad_id        uuid    DEFAULT NULL,
  p_categoria        text    DEFAULT NULL,
  p_evento           text    DEFAULT NULL,
  p_cuenta_explicita uuid    DEFAULT NULL
)
RETURNS TABLE (
  cuenta_id         uuid,
  origen_resolucion text,
  regla_tabla       text,
  regla_id          uuid,
  evento_usado      text,
  motivo            text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company  uuid;
  v_cuenta   uuid;
  v_regla    uuid;
  v_evento   text;
  v_ok       boolean;
BEGIN
  v_company := public.get_my_company_id();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.'
      USING ERRCODE = '42501';
  END IF;

  -- Un proyecto de otra empresa no resuelve nada: ni siquiera se mira.
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = v_company
  ) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.'
      USING ERRCODE = '42501';
  END IF;

  -- ── Escalón 1: lo que alguien eligió a mano, si sirve ────────────────────
  -- Se valida igual que una regla. Una cuenta explícita de otro ledger, o
  -- agrupadora, o inactiva, NO gana: sería peor que no elegir nada.
  IF p_cuenta_explicita IS NOT NULL THEN
    SELECT (c.company_id = v_company
            AND c.project_id IS NOT DISTINCT FROM p_project_id
            AND c.es_detalle AND c.activa)
      INTO v_ok
      FROM public.conta_cuentas c
     WHERE c.id = p_cuenta_explicita;

    IF COALESCE(v_ok, false) THEN
      RETURN QUERY SELECT p_cuenta_explicita, 'linea_explicita'::text,
                          NULL::text, NULL::uuid, NULL::text, NULL::text;
      RETURN;
    END IF;

    RETURN QUERY SELECT NULL::uuid, 'sin_resolver'::text, NULL::text, NULL::uuid, NULL::text,
      'La cuenta elegida en el documento no sirve para esta contabilidad: tiene que ser de este ledger, de detalle y activa.'::text;
    RETURN;
  END IF;

  -- ── Escalón 2: regla del proveedor para el destino ───────────────────────
  IF p_proveedor_id IS NOT NULL AND p_destino IS NOT NULL THEN
    SELECT r.cuenta_id, r.id INTO v_cuenta, v_regla
      FROM public.conta_reglas_proveedor r
     WHERE r.company_id = v_company
       AND r.project_id IS NOT DISTINCT FROM p_project_id
       AND r.proveedor_id = p_proveedor_id
       AND r.destino = p_destino
       AND r.activa
     LIMIT 1;

    IF v_cuenta IS NOT NULL THEN
      RETURN QUERY SELECT v_cuenta, 'regla_proveedor'::text,
                          'conta_reglas_proveedor'::text, v_regla, NULL::text, NULL::text;
      RETURN;
    END IF;
  END IF;

  -- ── Escalón 3: regla de cliente/unidad y tipo de cargo ───────────────────
  -- De la más específica a la más general. El ORDER BY sobre la columna
  -- generada es lo que hace el desempate determinista; `id` cierra cualquier
  -- empate residual para que dos corridas den lo mismo.
  IF p_cliente_id IS NOT NULL OR p_unidad_id IS NOT NULL OR p_categoria IS NOT NULL THEN
    SELECT r.cuenta_id, r.id INTO v_cuenta, v_regla
      FROM public.conta_reglas_cargo r
     WHERE r.company_id = v_company
       AND r.project_id IS NOT DISTINCT FROM p_project_id
       AND r.activa
       AND (r.unidad_id  IS NULL OR r.unidad_id  = p_unidad_id)
       AND (r.cliente_id IS NULL OR r.cliente_id = p_cliente_id)
       AND (r.categoria  IS NULL OR r.categoria  = p_categoria)
     ORDER BY r.especificidad DESC, r.id
     LIMIT 1;

    IF v_cuenta IS NOT NULL THEN
      RETURN QUERY SELECT v_cuenta, 'regla_cargo'::text,
                          'conta_reglas_cargo'::text, v_regla, NULL::text, NULL::text;
      RETURN;
    END IF;
  END IF;

  -- ── Escalón 4: mapeo general del evento ──────────────────────────────────
  -- El evento llega explícito o sale del destino. Así el escalón 4 sigue
  -- siendo exactamente el comportamiento de hoy cuando no hay reglas.
  v_evento := COALESCE(
    p_evento,
    (SELECT d.evento_fallback FROM public.conta_destinos_imputacion() d
      WHERE d.destino = p_destino));

  IF v_evento IS NOT NULL THEN
    v_cuenta := public.conta_cuenta_para(v_company, p_project_id, v_evento);

    IF v_cuenta IS NOT NULL THEN
      RETURN QUERY SELECT v_cuenta, 'mapeo_evento'::text,
                          NULL::text, NULL::uuid, v_evento, NULL::text;
      RETURN;
    END IF;
  END IF;

  -- ── Escalón 5: no se inventa nada ────────────────────────────────────────
  RETURN QUERY SELECT NULL::uuid, 'sin_resolver'::text, NULL::text, NULL::uuid, v_evento,
    CASE
      WHEN v_evento IS NULL THEN
        'No hay regla aplicable y el destino no tiene evento contable asociado. Configura una regla o elige la cuenta en el documento.'
      ELSE
        format('No hay regla aplicable y el evento «%s» no está mapeado en esta contabilidad. Configura el mapeo o una regla.', v_evento)
    END::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_resolver_imputacion(uuid, text, uuid, uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_resolver_imputacion(uuid, text, uuid, uuid, uuid, text, text, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.conta_resolver_imputacion(uuid, text, uuid, uuid, uuid, text, text, uuid) IS
  'Resuelve la cuenta a imputar por prioridad determinista (explícita > proveedor > cliente/unidad > evento) y explica el porqué. STABLE: no registra nada, sirve para previsualizar.';

-- ── 8. Registrar la resolución ──────────────────────────────────────────────
-- Resuelve y ESCRIBE la bitácora, en una sola llamada para que no exista el
-- estado intermedio «resolví pero no registré». Devuelve lo mismo que el
-- resolutor más el id de la fila escrita.
CREATE OR REPLACE FUNCTION public.conta_registrar_resolucion(
  p_origen_tabla     text,
  p_origen_id        uuid,
  p_project_id       uuid,
  p_destino          text    DEFAULT NULL,
  p_proveedor_id     uuid    DEFAULT NULL,
  p_cliente_id       uuid    DEFAULT NULL,
  p_unidad_id        uuid    DEFAULT NULL,
  p_categoria        text    DEFAULT NULL,
  p_evento           text    DEFAULT NULL,
  p_cuenta_explicita uuid    DEFAULT NULL
)
RETURNS TABLE (
  resolucion_id     uuid,
  cuenta_id         uuid,
  origen_resolucion text,
  regla_tabla       text,
  regla_id          uuid,
  evento_usado      text,
  motivo            text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
  r         record;
  v_id      uuid;
BEGIN
  v_company := public.get_my_company_id();

  IF v_company IS NULL OR NOT (
    public.is_super_admin()
    OR public.current_user_role() = ANY (ARRAY['company_owner','admin','contador'])
  ) THEN
    RAISE EXCEPTION 'No autorizado para registrar resoluciones de imputación.'
      USING ERRCODE = '42501';
  END IF;

  IF p_origen_tabla IS NULL OR btrim(p_origen_tabla) = '' OR p_origen_id IS NULL THEN
    RAISE EXCEPTION 'Origen inválido: se requiere tabla e id del documento.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM public.conta_resolver_imputacion(
    p_project_id, p_destino, p_proveedor_id, p_cliente_id,
    p_unidad_id, p_categoria, p_evento, p_cuenta_explicita);

  INSERT INTO public.conta_resoluciones
    (company_id, project_id, origen_tabla, origen_id, destino, evento,
     cuenta_id, origen_resolucion, regla_tabla, regla_id, motivo, resuelto_por)
  VALUES
    (v_company, p_project_id, p_origen_tabla, p_origen_id, p_destino, r.evento_usado,
     r.cuenta_id, r.origen_resolucion, r.regla_tabla, r.regla_id, r.motivo, auth.uid())
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, r.cuenta_id, r.origen_resolucion,
                      r.regla_tabla, r.regla_id, r.evento_usado, r.motivo;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_registrar_resolucion(text, uuid, uuid, text, uuid, uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_registrar_resolucion(text, uuid, uuid, text, uuid, uuid, uuid, text, text, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.conta_registrar_resolucion(text, uuid, uuid, text, uuid, uuid, uuid, text, text, uuid) IS
  'Resuelve la imputación y deja la fila de trazabilidad en la misma llamada. Incluye los no resueltos, con su motivo.';

-- ── 9. RLS ──────────────────────────────────────────────────────────────────
-- Mismo molde que el resto de contabilidad (20260611000000): lectura para la
-- empresa activa, escritura para owner/admin de esa empresa. La bitácora NO se
-- edita ni se borra desde la aplicación: es un registro, y un registro que se
-- puede reescribir no prueba nada.
ALTER TABLE public.conta_reglas_proveedor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_reglas_cargo     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_resoluciones     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conta_reglas_proveedor','conta_reglas_cargo'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_select" ON public.%I
        FOR SELECT TO authenticated
        USING (company_id = get_my_company_id() OR is_super_admin())
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_insert" ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
                    AND company_id = get_my_company_id()))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_update" ON public.%I
        FOR UPDATE TO authenticated
        USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
               AND company_id = get_my_company_id()))
        WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
                    AND company_id = get_my_company_id()))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_delete" ON public.%I
        FOR DELETE TO authenticated
        USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
               AND company_id = get_my_company_id()))
    $p$, t, t);
  END LOOP;
END $$;

-- La bitácora: se lee, no se escribe desde la aplicación. Las filas entran por
-- `conta_registrar_resolucion`, que es SECURITY DEFINER y salta la RLS; que no
-- haya policy de INSERT/UPDATE/DELETE es deliberado, no un olvido.
DROP POLICY IF EXISTS "conta_resoluciones_select" ON public.conta_resoluciones;
CREATE POLICY "conta_resoluciones_select" ON public.conta_resoluciones
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

-- ── 10. ACL de tabla ────────────────────────────────────────────────────────
-- anon no toca nada. authenticated escribe reglas (contenido por RLS) y sólo
-- LEE la bitácora, que es la otra mitad de la decisión de arriba.
-- El REVOKE incluye a `authenticated` A PROPÓSITO, y no es redundante: este
-- proyecto tiene ALTER DEFAULT PRIVILEGES que otorga los siete privilegios a
-- `authenticated` sobre toda tabla nueva del esquema. Sin revocar primero, la
-- bitácora nacería con INSERT/UPDATE/DELETE que nadie escribió en esta
-- migración —medido: seis privilegios de más— y el GRANT de abajo no los
-- quitaría, porque un GRANT sólo suma. Se parte de cero y se concede lo justo.
REVOKE ALL ON public.conta_reglas_proveedor FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.conta_reglas_cargo     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.conta_resoluciones     FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conta_reglas_proveedor TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conta_reglas_cargo     TO authenticated;
GRANT SELECT                          ON public.conta_resoluciones     TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conta_reglas_proveedor TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conta_reglas_cargo     TO service_role;
GRANT SELECT, INSERT                 ON public.conta_resoluciones     TO service_role;
