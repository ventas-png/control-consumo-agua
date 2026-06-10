-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD (partida doble) — FASE 1 · parte A: esquema
-- Ver ROADMAP_ERP_FINANZAS.md.
--
-- Tablas:
--   conta_cuentas        — catálogo de cuentas jerárquico (hasta 5 niveles)
--   conta_asientos       — cabecera de póliza (borrador → publicado; anulación
--                          por asiento de reverso, nunca borrado)
--   conta_asiento_lineas — líneas debe/haber en moneda base + snapshot
--                          multimoneda (moneda_origen/monto_origen/tipo_cambio)
--   conta_tipos_cambio   — tasas manuales por empresa/moneda/fecha
--   conta_mapeo_cuentas  — evento de negocio → cuenta contable (default
--                          empresa con override por proyecto)
--   conta_folios         — folio correlativo de pólizas por empresa
--
-- Multimoneda: toda la contabilidad se lleva en la moneda base de la empresa
-- (companies.default_currency). Las líneas cuya cuenta/documento opera en otra
-- moneda guardan además el monto origen y la tasa usada.
--
-- Convenciones del repo: idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS),
-- RLS con get_my_company_id()/is_super_admin()/current_user_role(); escritura
-- contable solo company_owner/admin.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Catálogo de cuentas ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conta_cuentas (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo      text        NOT NULL,
  nombre      text        NOT NULL,
  tipo        text        NOT NULL CHECK (tipo IN ('activo','pasivo','capital','ingreso','gasto')),
  -- naturaleza editable (no generada): existen cuentas contra-natura
  -- (ej. depreciación acumulada = activo de naturaleza acreedora).
  naturaleza  text        NOT NULL CHECK (naturaleza IN ('deudora','acreedora')),
  padre_id    uuid        REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  -- 1=clase '1' · 2=grupo '11' · 3=mayor '1102' · 4=sub-cuenta '1102-01'
  -- · 5=auxiliar '1102-01-01'
  nivel       int         NOT NULL DEFAULT 1 CHECK (nivel BETWEEN 1 AND 5),
  -- solo cuentas de detalle reciben movimientos; el resto agrupa saldos
  es_detalle  boolean     NOT NULL DEFAULT true,
  activa      boolean     NOT NULL DEFAULT true,
  -- viene del seed: la UI no permite borrarla, solo renombrar/desactivar
  es_sistema  boolean     NOT NULL DEFAULT false,
  -- NULL = moneda base de la empresa; ISO 4217 ('USD','GTQ') para cuentas de
  -- banco/caja en moneda extranjera
  moneda      text,
  descripcion text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_conta_cuentas_company ON public.conta_cuentas(company_id, codigo);
CREATE INDEX IF NOT EXISTS idx_conta_cuentas_padre   ON public.conta_cuentas(padre_id);

-- ── 2. Asientos (pólizas) — cabecera ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conta_asientos (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- NULL = asiento a nivel empresa (no atado a una locación)
  project_id     uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  -- folio correlativo por empresa; se asigna al PUBLICAR (borradores sin folio)
  numero         bigint,
  fecha          date        NOT NULL DEFAULT CURRENT_DATE,
  -- 'YYYY-MM' (extract/lpad y no to_char: las columnas generadas exigen
  -- expresiones IMMUTABLE y to_char(date,…) es solo STABLE)
  periodo        text        GENERATED ALWAYS AS (
                               (extract(year from fecha))::text || '-' ||
                               lpad((extract(month from fecha))::text, 2, '0')
                             ) STORED,
  tipo           text        NOT NULL DEFAULT 'diario'
                             CHECK (tipo IN ('diario','ingreso','egreso','apertura')),
  concepto       text        NOT NULL,
  estado         text        NOT NULL DEFAULT 'borrador'
                             CHECK (estado IN ('borrador','publicado','anulado')),
  origen         text        NOT NULL DEFAULT 'manual'
                             CHECK (origen IN ('manual','automatico')),
  origen_tabla   text,   -- 'pagos' | 'gastos_condominio' | 'registros' | 'cuotas_condominio'
  origen_id      uuid,
  origen_evento  text,   -- 'pago_contabilizado' | 'factura_emitida' | ... (+ '_revertido')
  -- snapshot de la moneda base de la empresa al crear el asiento (ISO 4217)
  moneda_base    text        NOT NULL DEFAULT 'GTQ',
  total_debe     numeric(14,2) NOT NULL DEFAULT 0,
  total_haber    numeric(14,2) NOT NULL DEFAULT 0,
  -- si este asiento ES un reverso, apunta al asiento original
  reversa_de_id  uuid        REFERENCES public.conta_asientos(id),
  -- si este asiento FUE reversado, apunta a su reverso
  anulado_por_id uuid        REFERENCES public.conta_asientos(id),
  created_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  publicado_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (origen = 'manual'
         OR (origen_tabla IS NOT NULL AND origen_id IS NOT NULL AND origen_evento IS NOT NULL))
);

-- Idempotencia de asientos automáticos: un evento de un documento = un asiento
-- vivo (los reversos usan otro origen_evento, así que conviven).
CREATE UNIQUE INDEX IF NOT EXISTS uq_conta_asiento_origen
  ON public.conta_asientos(company_id, origen_tabla, origen_id, origen_evento)
  WHERE origen = 'automatico' AND estado <> 'anulado';

CREATE UNIQUE INDEX IF NOT EXISTS uq_conta_asiento_numero
  ON public.conta_asientos(company_id, numero) WHERE numero IS NOT NULL;

-- Máximo un asiento de apertura publicado por empresa+proyecto (NULL agrupado).
CREATE UNIQUE INDEX IF NOT EXISTS uq_conta_asiento_apertura
  ON public.conta_asientos(company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE tipo = 'apertura' AND estado = 'publicado';

CREATE INDEX IF NOT EXISTS idx_conta_asientos_lista
  ON public.conta_asientos(company_id, periodo DESC, estado);
CREATE INDEX IF NOT EXISTS idx_conta_asientos_project ON public.conta_asientos(project_id);
CREATE INDEX IF NOT EXISTS idx_conta_asientos_origen  ON public.conta_asientos(origen_tabla, origen_id);
CREATE INDEX IF NOT EXISTS idx_conta_asientos_reversa ON public.conta_asientos(reversa_de_id);
CREATE INDEX IF NOT EXISTS idx_conta_asientos_anulado ON public.conta_asientos(anulado_por_id);
CREATE INDEX IF NOT EXISTS idx_conta_asientos_created_by ON public.conta_asientos(created_by);

-- ── 3. Líneas de asiento ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conta_asiento_lineas (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  asiento_id    uuid          NOT NULL REFERENCES public.conta_asientos(id) ON DELETE CASCADE,
  -- denormalizado para RLS sin join y para agregaciones de balanza/mayor
  company_id    uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cuenta_id     uuid          NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  orden         int           NOT NULL DEFAULT 1,
  descripcion   text,
  -- SIEMPRE en moneda base de la empresa
  debe          numeric(14,2) NOT NULL DEFAULT 0 CHECK (debe  >= 0),
  haber         numeric(14,2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
  -- snapshot multimoneda: se llenan juntas cuando el documento/cuenta opera en
  -- moneda distinta a la base; debe/haber = round(monto_origen * tipo_cambio, 2)
  moneda_origen text,
  monto_origen  numeric(14,2),
  tipo_cambio   numeric(12,6),
  CHECK ((debe > 0 AND haber = 0) OR (haber > 0 AND debe = 0) OR (debe = 0 AND haber = 0)),
  CHECK ((moneda_origen IS NULL AND monto_origen IS NULL AND tipo_cambio IS NULL)
      OR (moneda_origen IS NOT NULL AND monto_origen IS NOT NULL AND tipo_cambio IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_conta_lineas_asiento ON public.conta_asiento_lineas(asiento_id);
CREATE INDEX IF NOT EXISTS idx_conta_lineas_cuenta  ON public.conta_asiento_lineas(company_id, cuenta_id);

-- ── 4. Tipos de cambio (manuales, fase 1) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conta_tipos_cambio (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- ISO 4217 de la moneda extranjera
  moneda     text          NOT NULL,
  fecha      date          NOT NULL DEFAULT CURRENT_DATE,
  -- unidades de moneda BASE por 1 unidad de la moneda extranjera
  tasa       numeric(12,6) NOT NULL CHECK (tasa > 0),
  created_at timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (company_id, moneda, fecha)
);

CREATE INDEX IF NOT EXISTS idx_conta_tc_lookup
  ON public.conta_tipos_cambio(company_id, moneda, fecha DESC);

-- ── 5. Mapeo evento de negocio → cuenta ─────────────────────────────────────
-- Eventos soportados (espejados en src/types/contabilidad.ts):
--   metodo_efectivo | metodo_transferencia | metodo_deposito | metodo_cheque
--   | metodo_tarjeta | metodo_pasarela | metodo_otro
--   ingreso_agua | ingreso_cuota | ingreso_mora | ingreso_otros
--   cxc_agua | cxc_cuotas | iva_por_pagar
--   gasto_mantenimiento | gasto_servicios | gasto_administrativo
--   | gasto_seguridad | gasto_limpieza | gasto_obras | gasto_otros
CREATE TABLE IF NOT EXISTS public.conta_mapeo_cuentas (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- NULL = default de la empresa; con valor = override de esa locación
  project_id uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  evento     text        NOT NULL,
  cuenta_id  uuid        NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conta_mapeo
  ON public.conta_mapeo_cuentas(
    company_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    evento
  );
CREATE INDEX IF NOT EXISTS idx_conta_mapeo_cuenta ON public.conta_mapeo_cuentas(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_conta_mapeo_project ON public.conta_mapeo_cuentas(project_id);

-- ── 6. Folios por empresa ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conta_folios (
  company_id uuid   PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  ultimo     bigint NOT NULL DEFAULT 0
);

-- ── 7. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.conta_cuentas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_asientos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_asiento_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_tipos_cambio   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_mapeo_cuentas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_folios         ENABLE ROW LEVEL SECURITY;
-- conta_folios: sin policies (deny-all para clientes; solo lo tocan las
-- funciones SECURITY DEFINER al publicar).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conta_cuentas','conta_asientos','conta_asiento_lineas',
                           'conta_tipos_cambio','conta_mapeo_cuentas']
  LOOP
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

-- ── 8. Inmutabilidad de asientos publicados ─────────────────────────────────
-- La RLS no distingue estados; estos triggers garantizan que un asiento
-- publicado no se edita ni se borra (la anulación es un asiento de reverso) y
-- que la publicación pasa SIEMPRE por las funciones del sistema (GUC local
-- 'conta.allow_system_write', seteado solo por las funciones SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.conta_proteger_asiento()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE permitido boolean := current_setting('conta.allow_system_write', true) = 'on';
BEGIN
  IF permitido THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'publicado' THEN
      RAISE EXCEPTION 'CONTA_INMUTABLE: un asiento publicado no se borra; anúlalo (reverso).'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado = 'publicado' THEN
      RAISE EXCEPTION 'CONTA_PUBLICAR_RPC: usa conta_publicar_asiento() para publicar.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.estado = 'publicado' THEN
    RAISE EXCEPTION 'CONTA_INMUTABLE: un asiento publicado no se edita; anúlalo (reverso).'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.estado = 'publicado' THEN
    RAISE EXCEPTION 'CONTA_PUBLICAR_RPC: usa conta_publicar_asiento() para publicar.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_proteger_asiento ON public.conta_asientos;
CREATE TRIGGER trg_conta_proteger_asiento
  BEFORE INSERT OR UPDATE OR DELETE ON public.conta_asientos
  FOR EACH ROW EXECUTE FUNCTION public.conta_proteger_asiento();

CREATE OR REPLACE FUNCTION public.conta_proteger_lineas()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_estado text;
  v_asiento uuid := COALESCE(NEW.asiento_id, OLD.asiento_id);
BEGIN
  IF current_setting('conta.allow_system_write', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT estado INTO v_estado FROM public.conta_asientos WHERE id = v_asiento;
  IF v_estado = 'publicado' THEN
    RAISE EXCEPTION 'CONTA_INMUTABLE: las líneas de un asiento publicado no se modifican.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_proteger_lineas ON public.conta_asiento_lineas;
CREATE TRIGGER trg_conta_proteger_lineas
  BEFORE INSERT OR UPDATE OR DELETE ON public.conta_asiento_lineas
  FOR EACH ROW EXECUTE FUNCTION public.conta_proteger_lineas();

-- ── 9. Comentarios ──────────────────────────────────────────────────────────
COMMENT ON TABLE public.conta_cuentas IS
  'Catálogo de cuentas contables (partida doble, fase 1 ERP). Jerárquico hasta 5 niveles por padre_id.';
COMMENT ON TABLE public.conta_asientos IS
  'Pólizas contables. borrador→publicado (inmutable; anulación por reverso). origen=automatico viene de triggers de negocio.';
COMMENT ON TABLE public.conta_asiento_lineas IS
  'Líneas debe/haber en moneda base; moneda_origen/monto_origen/tipo_cambio cuando el documento opera en otra moneda.';
COMMENT ON TABLE public.conta_tipos_cambio IS
  'Tasas de cambio manuales: unidades de moneda base por 1 unidad de moneda extranjera, vigentes desde su fecha.';
COMMENT ON TABLE public.conta_mapeo_cuentas IS
  'Mapeo evento de negocio → cuenta contable. project_id NULL = default empresa; con valor = override por locación.';
