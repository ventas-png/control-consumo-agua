-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · ÓRDENES AL AMPARO DE UN CONTRATO: VIGENCIA, MONTO Y EXCEPCIÓN AUDITADA
--
-- QUÉ HABÍA
--   `ordenes_compra.contrato_id` existía «preparada» (20261020000100): al ligar se
--   comprobaban empresa, proveedor y proyecto y que el contrato estuviera `activo`.
--   Pero NADA se comprobaba al APROBAR ni al EMITIR: un contrato que vence, se
--   suspende o se termina después de ligar la orden no impedía comprometer dinero
--   a su nombre, y un contrato con monto máximo podía rebasarse sin aviso.
--
-- QUÉ HACE
--   1. `contrato_vigente()` (interna): estado `activo` Y hoy dentro de
--      [fecha_inicio, fecha_fin] (fecha_fin NULL = indefinido).
--   2. Al LIGAR una orden a un contrato (trigger existente, reescrito): además de
--      empresa/proveedor/proyecto/activo, exige vigencia por fechas y MISMA MONEDA
--      (un contrato en GTQ no ampara una orden en USD: no se mezclan monedas).
--   3. Al APROBAR y al EMITIR una orden con contrato (trigger nuevo): exige
--      contrato vigente y, si el contrato TIENE monto máximo, que lo comprometido
--      (aprobado/emitido/recibido/cerrado, mismo contrato y moneda) más esta orden
--      no lo rebase. Un contrato sin monto máximo NO tiene límite total: no se
--      inventa. La comprobación de monto se serializa por contrato (dos órdenes
--      aprobadas a la vez no rebasan el tope).
--   4. EXCEPCIÓN explícita, justificada y auditada: `compras_oc_excepcion_contrato`
--      (RPC) la registra en `orden_compra_excepciones` (append-only). La autoriza
--      quien tiene permiso de cambio de estado de Contabilidad; si la empresa
--      exige separación solicitante/aprobador, no la autoriza quien solicitó la
--      orden. Vale para UNA etapa (aprobar o emitir), UNA revisión de la orden y
--      las causas que cubre (vigencia, monto): devolver la orden a borrador la
--      invalida, y emitir exige su propia excepción. Reintentar devuelve la misma.
--   5. Una orden SIN contrato sigue como hasta hoy (el contrato no es obligatorio
--      para comprar; lo es solo para quien elige ampararse en uno).
--
-- LO QUE NO HACE: no genera órdenes, facturas, pagos ni asientos; no toca órdenes
-- ya aprobadas/emitidas (cancelar, cerrar, recibir y facturar no se bloquean: las
-- operaciones de sistema llegan con `conta.allow_system_write`).
--
-- CÓMO REVERTIR (en este orden)
--   DROP TRIGGER trg_compras_oc_contrato_vigencia ON public.ordenes_compra;
--   DROP FUNCTION public.compras_tg_oc_contrato_vigencia();
--   DROP FUNCTION public.compras_oc_excepcion_contrato(uuid, text, text);
--   DROP TABLE public.orden_compra_excepciones;
--   DROP FUNCTION public.contrato_monto_maximo_vigente(uuid);
--   DROP FUNCTION public.contrato_vigente(uuid, date);
--   restaurar compras_tg_oc_contrato() desde 20261020000100 y el CHECK de
--   orden_compra_eventos.tipo desde 20261021000000.
-- IMPACTO EN DATOS: ninguno sobre filas existentes. Ligar órdenes nuevas a un
-- contrato exige misma moneda y vigencia por fechas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Vigencia del contrato ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contrato_vigente(p_contrato_id uuid, p_fecha date DEFAULT CURRENT_DATE)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT c.estado = 'activo'
                          AND c.fecha_inicio <= p_fecha
                          AND (c.fecha_fin IS NULL OR c.fecha_fin >= p_fecha)
                     FROM public.contratos_proveedores c WHERE c.id = p_contrato_id), false)
$$;
REVOKE EXECUTE ON FUNCTION public.contrato_vigente(uuid, date) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contrato_vigente(uuid, date) IS
  'Interna. true = contrato activo y la fecha cae dentro de su vigencia (fecha_fin NULL = indefinido). El estado del contrato y la autorización del proveedor son cosas distintas.';

-- El monto máximo vigente = el original + las ampliaciones documentadas (se crean en
-- 20261024000100). Hasta entonces solo existe el original; la función se redefine allí.
CREATE OR REPLACE FUNCTION public.contrato_monto_maximo_vigente(p_contrato_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.monto_maximo FROM public.contratos_proveedores c WHERE c.id = p_contrato_id
$$;
REVOKE EXECUTE ON FUNCTION public.contrato_monto_maximo_vigente(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. Al ligar: vigencia por fechas y misma moneda ─────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_oc_contrato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c      record;
  v_moneda text;
BEGIN
  IF NEW.contrato_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.contrato_id IS NOT DISTINCT FROM OLD.contrato_id) THEN
    RETURN NEW;
  END IF;

  SELECT c.company_id, c.project_id, c.proveedor_id, c.estado, c.moneda INTO v_c
    FROM public.contratos_proveedores c WHERE c.id = NEW.contrato_id;

  IF NOT FOUND OR v_c.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_AJENO: el contrato no pertenece a la empresa de la orden.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.proveedor_id IS NULL OR v_c.proveedor_id IS DISTINCT FROM NEW.proveedor_id THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_PROVEEDOR: el contrato no es del mismo proveedor de la orden (o es un contrato histórico sin proveedor vinculado).'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_PROYECTO: el contrato es de otro proyecto que la orden.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.estado <> 'activo' THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_NO_ACTIVO: solo se vinculan órdenes a contratos activos (estado actual: %).', v_c.estado
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.contrato_vigente(NEW.contrato_id, CURRENT_DATE) THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_FUERA_DE_VIGENCIA: el contrato no está vigente hoy (fuera de las fechas de inicio y fin); no se le vinculan órdenes nuevas.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Monedas separadas: el contrato ampara compras en SU moneda. (La orden aún puede
  -- no traer moneda: la fija otro trigger con la moneda base del proyecto.)
  v_moneda := upper(COALESCE(NEW.moneda, public.conta_moneda_base(NEW.company_id, NEW.project_id)));
  IF v_c.moneda IS NOT NULL AND v_moneda IS NOT NULL AND v_moneda <> upper(v_c.moneda) THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_MONEDA: el contrato es en % y la orden en %; no se mezclan monedas.', v_c.moneda, v_moneda
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_contrato() FROM PUBLIC, anon, authenticated;

-- ── 3. Excepciones (append-only) ────────────────────────────────────────────
ALTER TABLE public.orden_compra_eventos DROP CONSTRAINT IF EXISTS orden_compra_eventos_tipo_check;
ALTER TABLE public.orden_compra_eventos
  ADD CONSTRAINT orden_compra_eventos_tipo_check
  CHECK (tipo IN ('estado', 'devolucion', 'excepcion_contrato'));

CREATE TABLE IF NOT EXISTS public.orden_compra_excepciones (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  orden_compra_id uuid        NOT NULL REFERENCES public.ordenes_compra(id) ON DELETE CASCADE,
  contrato_id     uuid        NOT NULL REFERENCES public.contratos_proveedores(id) ON DELETE RESTRICT,
  revision        integer     NOT NULL,
  etapa           text        NOT NULL CHECK (etapa IN ('aprobar', 'emitir')),
  causas          text        NOT NULL CHECK (causas IN ('vigencia', 'monto', 'monto,vigencia')),
  motivo          text        NOT NULL CHECK (char_length(btrim(motivo)) >= 10),
  detalle         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  autorizado_por  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (orden_compra_id, revision, etapa, causas)
);
CREATE INDEX IF NOT EXISTS idx_oc_excepciones_orden ON public.orden_compra_excepciones (orden_compra_id, created_at);
CREATE INDEX IF NOT EXISTS idx_oc_excepciones_contrato ON public.orden_compra_excepciones (contrato_id);

ALTER TABLE public.orden_compra_excepciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orden_compra_excepciones_select" ON public.orden_compra_excepciones;
CREATE POLICY "orden_compra_excepciones_select" ON public.orden_compra_excepciones
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND public.can_access_project(project_id)));
-- Sin policy de escritura a propósito: solo la RPC (SECURITY DEFINER) inserta.
REVOKE ALL ON public.orden_compra_excepciones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.orden_compra_excepciones TO authenticated;
GRANT SELECT, INSERT ON public.orden_compra_excepciones TO service_role;

COMMENT ON TABLE public.orden_compra_excepciones IS
  'Excepciones autorizadas para aprobar o emitir una orden amparada en un contrato no vigente o que rebasa su monto máximo. Append-only; la escribe solo compras_oc_excepcion_contrato().';

CREATE OR REPLACE FUNCTION public.compras_tg_oc_excepciones_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'COMPRAS_EXCEPCION_INMUTABLE: una excepción autorizada queda como evidencia; no se edita.'
    USING ERRCODE = 'check_violation';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_excepciones_inmutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_oc_excepciones_inmutable ON public.orden_compra_excepciones;
CREATE TRIGGER trg_oc_excepciones_inmutable
  BEFORE UPDATE ON public.orden_compra_excepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_excepciones_inmutable();

-- Qué causas tiene HOY una orden para no poder aprobarse/emitirse al amparo de su contrato.
-- Devuelve NULL si ninguna. `p_con_monto`: solo al aprobar (el compromiso nace ahí).
CREATE OR REPLACE FUNCTION public.compras_oc_contrato_causas(
  p_orden_id uuid, p_contrato_id uuid, p_total numeric, p_moneda text, p_con_monto boolean)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_causas   text[] := ARRAY[]::text[];
  v_max      numeric;
  v_comp     numeric;
BEGIN
  IF NOT public.contrato_vigente(p_contrato_id, CURRENT_DATE) THEN
    v_causas := array_append(v_causas, 'vigencia');
  END IF;
  IF p_con_monto THEN
    v_max := public.contrato_monto_maximo_vigente(p_contrato_id);
    IF v_max IS NOT NULL THEN
      SELECT COALESCE(sum(o.total), 0) INTO v_comp
        FROM public.ordenes_compra o
       WHERE o.contrato_id = p_contrato_id
         AND o.id <> p_orden_id
         AND upper(o.moneda) = upper(p_moneda)
         AND o.estado IN ('aprobada', 'emitida', 'recibida_parcial', 'recibida', 'cerrada');
      IF v_comp + COALESCE(p_total, 0) > v_max THEN
        v_causas := array_append(v_causas, 'monto');
      END IF;
    END IF;
  END IF;
  IF array_length(v_causas, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN array_to_string(ARRAY(SELECT x FROM unnest(v_causas) x ORDER BY x), ',');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_oc_contrato_causas(uuid, uuid, numeric, text, boolean) FROM PUBLIC, anon, authenticated;

-- ── 4. Aprobar / emitir una orden con contrato ──────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_oc_contrato_vigencia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entra_aprobada boolean;
  v_entra_emitida  boolean;
  v_etapa          text;
  v_causas         text;
  v_max            numeric;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;  -- recepciones/facturas moviendo el estado de lo ya comprometido
  END IF;
  IF NEW.contrato_id IS NULL OR NEW.estado NOT IN ('aprobada', 'emitida') THEN
    RETURN NEW;
  END IF;

  v_entra_aprobada := NEW.estado = 'aprobada'
    AND (TG_OP = 'INSERT'
         OR OLD.estado NOT IN ('aprobada', 'emitida', 'recibida_parcial', 'recibida', 'cerrada'));
  v_entra_emitida := NEW.estado = 'emitida'
    AND (TG_OP = 'INSERT'
         OR OLD.estado NOT IN ('emitida', 'recibida_parcial', 'recibida', 'cerrada'));
  IF NOT (v_entra_aprobada OR v_entra_emitida) THEN
    RETURN NEW;
  END IF;
  v_etapa := CASE WHEN v_entra_emitida THEN 'emitir' ELSE 'aprobar' END;

  -- Dos órdenes que se aprueban a la vez sobre el mismo contrato no rebasan juntas el tope.
  PERFORM pg_advisory_xact_lock(hashtextextended('oc-contrato:' || NEW.contrato_id::text, 0));

  v_causas := public.compras_oc_contrato_causas(
    NEW.id, NEW.contrato_id, NEW.total,
    COALESCE(NEW.moneda, public.conta_moneda_base(NEW.company_id, NEW.project_id)),
    v_etapa = 'aprobar');
  IF v_causas IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.orden_compra_excepciones x
              WHERE x.orden_compra_id = NEW.id AND x.revision = NEW.revision
                AND x.etapa = v_etapa AND x.causas = v_causas) THEN
    RETURN NEW;   -- excepción autorizada, justificada y auditada
  END IF;

  IF v_causas LIKE '%monto%' THEN
    v_max := public.contrato_monto_maximo_vigente(NEW.contrato_id);
  END IF;
  RAISE EXCEPTION 'COMPRAS_CONTRATO_NO_VIGENTE: no se puede % la orden al amparo de su contrato (%). Un contrato fuera de vigencia o que rebasa su monto máximo exige una excepción autorizada y justificada (cambio de estado de Contabilidad).',
    CASE WHEN v_etapa = 'emitir' THEN 'emitir' ELSE 'aprobar' END,
    CASE v_causas
      WHEN 'vigencia' THEN 'no está vigente hoy: estado distinto de activo o fuera de sus fechas'
      WHEN 'monto' THEN format('rebasa el monto máximo vigente de %s', v_max)
      ELSE format('no está vigente y además rebasa el monto máximo vigente de %s', v_max)
    END
    USING ERRCODE = 'check_violation';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_contrato_vigencia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_oc_contrato_vigencia ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_contrato_vigencia
  BEFORE INSERT OR UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_contrato_vigencia();

-- ── 5. La RPC que autoriza la excepción ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_oc_excepcion_contrato(
  p_orden_id uuid, p_etapa text, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_oc       public.ordenes_compra%ROWTYPE;
  v_uid      uuid := auth.uid();
  v_causas   text;
  v_id       uuid;
  v_separada boolean;
  v_c        record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_EXCEPCION_SESION: se necesita una sesión para autorizar una excepción.' USING ERRCODE = '42501';
  END IF;
  IF p_etapa NOT IN ('aprobar', 'emitir') THEN
    RAISE EXCEPTION 'COMPRAS_EXCEPCION_ETAPA: la etapa es «aprobar» o «emitir».' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'COMPRAS_EXCEPCION_MOTIVO: la excepción exige un motivo de al menos 10 caracteres.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_oc FROM public.ordenes_compra WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND
     OR NOT (public.is_super_admin()
             OR (v_oc.company_id = public.get_my_company_id()
                 AND (v_oc.project_id IS NULL OR public.can_access_project(v_oc.project_id)))) THEN
    RAISE EXCEPTION 'COMPRAS_EXCEPCION_ORDEN: la orden no existe en tu empresa o proyecto.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.conta_puede_escribir('change_status') THEN
    RAISE EXCEPTION 'COMPRAS_EXCEPCION_PERMISO: autorizar una excepción exige el permiso de cambio de estado de Contabilidad.' USING ERRCODE = '42501';
  END IF;
  IF v_oc.contrato_id IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_EXCEPCION_SIN_CONTRATO: la orden no está ligada a un contrato.' USING ERRCODE = 'check_violation';
  END IF;
  IF (p_etapa = 'aprobar' AND v_oc.estado <> 'borrador') OR (p_etapa = 'emitir' AND v_oc.estado <> 'aprobada') THEN
    RAISE EXCEPTION 'COMPRAS_EXCEPCION_ESTADO: para % la orden debe estar en «%» (está en «%»).',
      p_etapa, CASE p_etapa WHEN 'aprobar' THEN 'borrador' ELSE 'aprobada' END, v_oc.estado
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.aprobacion_separada INTO v_separada FROM public.compras_config c WHERE c.company_id = v_oc.company_id;
  IF COALESCE(v_separada, false) AND v_oc.created_by IS NOT NULL AND v_oc.created_by = v_uid THEN
    RAISE EXCEPTION 'COMPRAS_EXCEPCION_AUTOAUTORIZACION: quien solicita la orden no autoriza su excepción; la empresa exige otra persona.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('oc-contrato:' || v_oc.contrato_id::text, 0));
  v_causas := public.compras_oc_contrato_causas(
    v_oc.id, v_oc.contrato_id, v_oc.total,
    COALESCE(v_oc.moneda, public.conta_moneda_base(v_oc.company_id, v_oc.project_id)),
    p_etapa = 'aprobar');
  IF v_causas IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_EXCEPCION_INNECESARIA: el contrato está vigente y dentro de su monto; no hace falta una excepción.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.estado, c.fecha_inicio, c.fecha_fin, c.moneda, c.referencia INTO v_c
    FROM public.contratos_proveedores c WHERE c.id = v_oc.contrato_id;

  -- Reintento: la misma excepción (orden, revisión, etapa, causas) no se duplica.
  INSERT INTO public.orden_compra_excepciones
    (company_id, project_id, orden_compra_id, contrato_id, revision, etapa, causas, motivo, detalle, autorizado_por)
  VALUES (v_oc.company_id, v_oc.project_id, v_oc.id, v_oc.contrato_id, v_oc.revision, p_etapa, v_causas, btrim(p_motivo),
          jsonb_build_object('contrato_estado', v_c.estado, 'contrato_referencia', v_c.referencia,
                             'fecha_inicio', v_c.fecha_inicio, 'fecha_fin', v_c.fecha_fin,
                             'monto_maximo_vigente', public.contrato_monto_maximo_vigente(v_oc.contrato_id),
                             'total_orden', v_oc.total, 'moneda', v_oc.moneda),
          v_uid)
  ON CONFLICT (orden_compra_id, revision, etapa, causas) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT x.id INTO v_id FROM public.orden_compra_excepciones x
     WHERE x.orden_compra_id = v_oc.id AND x.revision = v_oc.revision AND x.etapa = p_etapa AND x.causas = v_causas;
    RETURN v_id;
  END IF;

  INSERT INTO public.orden_compra_eventos
    (company_id, project_id, orden_compra_id, tipo, estado_anterior, estado_nuevo, revision, motivo, origen, actor_id)
  VALUES (v_oc.company_id, v_oc.project_id, v_oc.id, 'excepcion_contrato', v_oc.estado, v_oc.estado, v_oc.revision,
          format('[%s · %s] %s', p_etapa, v_causas, btrim(p_motivo)), 'usuario', v_uid);
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_oc_excepcion_contrato(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_oc_excepcion_contrato(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.compras_oc_excepcion_contrato(uuid, text, text) IS
  'Autoriza (con motivo, de forma auditada) aprobar o emitir una orden cuyo contrato no está vigente o rebasa su monto máximo. Permiso: cambio de estado de Contabilidad; con separación activada, no quien solicitó la orden. Idempotente.';
