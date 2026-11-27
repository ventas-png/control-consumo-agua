-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD · FONDO DE RESERVA (traslado manual) Y CAJA CHICA (fondo fijo)
--
-- POR QUÉ
-- Condominios lleva el fondo de reserva (`fondo_reserva`) y la caja chica
-- (`caja_chica`, `movimientos_caja`) como registros operativos: ninguno
-- generaba póliza. En libros no había fondo de reserva, y los vales de caja
-- chica no llegaban nunca al gasto.
--
-- QUÉ HACE
-- 1. FONDO DE RESERVA — conta_fondo_reserva_traslado(...)
--    Un movimiento decidido por una persona (no un porcentaje automático de
--    cada cuota), que queda en el registro del fondo Y en libros a la vez:
--      aportación   Dr Fondo de reserva        / Cr contrapartida (banco operativo)
--      retiro       Dr contrapartida (banco o gasto) / Cr Fondo de reserva
--      rendimiento  Dr Fondo de reserva        / Cr contrapartida (ingreso financiero)
--    Un retiro no puede dejar la cuenta del fondo en negativo.
--    conta_fondo_reserva_resumen(proyecto) compara el saldo del registro con el
--    de libros y cuenta los movimientos que no tienen póliza (los capturados
--    directo en Condominios), para que la diferencia se vea.
--
-- 2. CAJA CHICA — fondo fijo con reposición
--    conta_caja_chica_constituir(caja, …): Dr Caja chica / Cr Banco por el
--      monto del fondo. Una sola vez por caja.
--    conta_caja_chica_reponer(caja, …): junta los egresos aún no repuestos,
--      cada uno con su cuenta de gasto, en UNA póliza  Dr gastos / Cr Banco,
--      y registra el ingreso de la reposición en la caja. La cuenta «Caja
--      chica» no se mueve: su saldo es siempre el fondo fijo. Primero se
--      previsualiza; al aplicar, lo que no tiene cuenta queda pendiente.
--    Un vale ya repuesto no se borra ni cambia de importe.
--
-- AUTORIZACIÓN: ver pide ver Contabilidad; registrar pide crear Y cambiar
-- estado en Contabilidad, más el permiso de Condominios sobre el registro que
-- se escribe (fondo de reserva / caja chica).
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.conta_fondo_reserva_traslado(uuid, text, numeric, date, text, uuid, uuid, text);
--   DROP FUNCTION public.conta_fondo_reserva_resumen(uuid);
--   DROP FUNCTION public.conta_cajas_chicas(uuid);
--   DROP FUNCTION public.conta_caja_chica_constituir(uuid, date, uuid, uuid);
--   DROP FUNCTION public.conta_caja_chica_reponer(uuid, date, uuid, jsonb, boolean);
--   DROP TRIGGER trg_movimiento_caja_repuesto ON public.movimientos_caja;
--   DROP FUNCTION public.conta_tg_movimiento_caja_repuesto();
--   ALTER TABLE public.movimientos_caja DROP COLUMN reposicion_id, DROP COLUMN cuenta_gasto_id;
--   ALTER TABLE public.caja_chica DROP COLUMN cuenta_caja_id;
--   DROP TABLE public.conta_caja_reposiciones;
-- Las pólizas ya generadas se anulan como cualquier otra (reverso).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. Autorización común ───────────────────────────────────────────────────
-- Quién es, de qué empresa, con qué permiso y sobre qué proyecto. Devuelve la
-- empresa de la sesión. `p_escribir` exige además crear y cambiar estado.
CREATE OR REPLACE FUNCTION public.conta_autorizar_proyecto(p_project_id uuid, p_escribir boolean)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
BEGIN
  IF v_company IS NULL OR public.sesion_api_sin_empresa() THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(
    COALESCE((SELECT pr.company_id FROM public.projects pr WHERE pr.id = p_project_id), v_company));
  IF NOT public.mfa_requirement_met() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin()
          OR public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])
          OR public.user_has_permission('platform.contabilidad.view')) THEN
    RAISE EXCEPTION 'No autorizado para ver la contabilidad.' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No autorizado para este proyecto.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_escribir, false)
     AND NOT (public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status')) THEN
    RAISE EXCEPTION 'No autorizado: requiere crear y cambiar estado en Contabilidad.' USING ERRCODE = '42501';
  END IF;
  RETURN v_company;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_autorizar_proyecto(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Una cuenta utilizable en una póliza de ESE ledger: de detalle y activa.
CREATE OR REPLACE FUNCTION public.conta_cuenta_utilizable(p_company uuid, p_project uuid, p_cuenta uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conta_cuentas c
     WHERE c.id = p_cuenta AND c.company_id = p_company
       AND c.project_id IS NOT DISTINCT FROM p_project AND c.es_detalle AND c.activa)
$$;

REVOKE ALL ON FUNCTION public.conta_cuenta_utilizable(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- La fecha de una póliza nueva: no futura, en ejercicio y periodo abiertos.
CREATE OR REPLACE FUNCTION public.conta_exigir_fecha_abierta(p_company uuid, p_project uuid, p_fecha date)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_fecha IS NULL OR p_fecha > CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha es obligatoria y no puede ser futura.' USING ERRCODE = 'check_violation';
  END IF;
  IF public.conta_anio_cerrado(p_company, p_project, EXTRACT(YEAR FROM p_fecha)::int) THEN
    RAISE EXCEPTION 'El ejercicio % de esta contabilidad está cerrado; elige una fecha de un ejercicio abierto.',
      EXTRACT(YEAR FROM p_fecha)::int USING ERRCODE = 'check_violation';
  END IF;
  IF p_project IS NOT NULL AND public.conta_periodo_cerrado(p_project, to_char(p_fecha, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'El periodo % de este proyecto está cerrado; reábrelo o elige otra fecha.', to_char(p_fecha, 'YYYY-MM')
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_exigir_fecha_abierta(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

-- ── 1. FONDO DE RESERVA ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_fondo_reserva_traslado(
  p_project_id      uuid,
  p_tipo            text,
  p_monto           numeric,
  p_fecha           date,
  p_concepto        text,
  p_cuenta_fondo_id uuid,
  p_cuenta_contra_id uuid,
  p_referencia      text DEFAULT NULL
) RETURNS TABLE (movimiento_id uuid, asiento_id uuid, saldo_fondo numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid := public.conta_autorizar_proyecto(p_project_id, true);
  v_monto   numeric(14,2) := round(p_monto, 2);
  v_saldo   numeric(14,2);
  v_id      uuid := gen_random_uuid();
  v_asiento uuid;
  v_entra   boolean;   -- el dinero ENTRA al fondo (aportación, rendimiento)
BEGIN
  PERFORM public.assert_company_scope(v_company);
  IF NOT (public.is_super_admin()
          OR public.condominios_puede_actuar('fondo_reserva', 'create')
          OR public.condominios_puede_actuar('gestion_fondo', 'create')) THEN
    RAISE EXCEPTION 'No autorizado: requiere crear movimientos del fondo de reserva en Condominios.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('aportacion', 'retiro', 'rendimiento') THEN
    RAISE EXCEPTION 'El movimiento del fondo es «aportacion», «retiro» o «rendimiento».' USING ERRCODE = '22023';
  END IF;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor que cero.' USING ERRCODE = 'check_violation';
  END IF;
  IF NULLIF(btrim(p_concepto), '') IS NULL THEN
    RAISE EXCEPTION 'El concepto es obligatorio.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.conta_exigir_fecha_abierta(v_company, p_project_id, p_fecha);
  IF NOT public.conta_cuenta_utilizable(v_company, p_project_id, p_cuenta_fondo_id)
     OR NOT public.conta_cuenta_utilizable(v_company, p_project_id, p_cuenta_contra_id) THEN
    RAISE EXCEPTION 'Las dos cuentas tienen que ser de esta contabilidad, de detalle y activas.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_cuenta_fondo_id = p_cuenta_contra_id THEN
    RAISE EXCEPTION 'La cuenta del fondo y la contrapartida no pueden ser la misma.' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT c.tipo FROM public.conta_cuentas c WHERE c.id = p_cuenta_fondo_id) <> 'activo' THEN
    RAISE EXCEPTION 'La cuenta del fondo de reserva debe ser una cuenta de activo (el banco o inversión donde está el dinero).'
      USING ERRCODE = 'check_violation';
  END IF;

  v_entra := p_tipo <> 'retiro';
  -- Dos retiros simultáneos no deben pasar los dos el control de saldo.
  PERFORM pg_advisory_xact_lock(hashtextextended('conta_fondo_reserva:' || p_cuenta_fondo_id::text, 0));
  SELECT COALESCE(sum(l.debe - l.haber), 0) INTO v_saldo
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE l.cuenta_id = p_cuenta_fondo_id AND a.estado = 'publicado';
  IF NOT v_entra AND v_monto > v_saldo THEN
    RAISE EXCEPTION 'El retiro (%) supera el saldo en libros del fondo de reserva (%).', v_monto, v_saldo
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.fondo_reserva (id, company_id, project_id, tipo, concepto, monto, fecha, referencia, notas)
  VALUES (v_id, v_company, p_project_id, p_tipo, btrim(p_concepto), v_monto, p_fecha,
          NULLIF(btrim(p_referencia), ''), 'Registrado desde Contabilidad, con póliza.');

  v_asiento := public.conta_generar_asiento(
    v_company, p_project_id, 'fondo_reserva', v_id, 'fondo_' || p_tipo, p_fecha,
    'Fondo de reserva — ' || CASE p_tipo WHEN 'aportacion' THEN 'aportación' ELSE p_tipo END || ': ' || btrim(p_concepto),
    'diario', NULL,
    jsonb_build_array(
      jsonb_build_object('cuenta_id', p_cuenta_fondo_id, 'descripcion', 'Fondo de reserva',
                         CASE WHEN v_entra THEN 'debe' ELSE 'haber' END, v_monto),
      jsonb_build_object('cuenta_id', p_cuenta_contra_id, 'descripcion', 'Contrapartida del fondo de reserva',
                         CASE WHEN v_entra THEN 'haber' ELSE 'debe' END, v_monto)));
  IF v_asiento IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.conta_asientos a WHERE a.id = v_asiento AND a.estado = 'publicado') THEN
    RAISE EXCEPTION 'No se pudo publicar la póliza del fondo de reserva.' USING ERRCODE = 'check_violation';
  END IF;

  movimiento_id := v_id; asiento_id := v_asiento;
  saldo_fondo := v_saldo + CASE WHEN v_entra THEN v_monto ELSE -v_monto END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_fondo_reserva_traslado(uuid, text, numeric, date, text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_fondo_reserva_traslado(uuid, text, numeric, date, text, uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.conta_fondo_reserva_traslado(uuid, text, numeric, date, text, uuid, uuid, text) IS
  'Movimiento manual del fondo de reserva (aportación, retiro o rendimiento) que queda en el registro del fondo y en libros con su póliza. Un retiro no puede superar el saldo en libros del fondo.';

-- El fondo según su registro y según libros.
CREATE OR REPLACE FUNCTION public.conta_fondo_reserva_resumen(p_project_id uuid)
RETURNS TABLE (
  cuenta_fondo_id uuid, cuenta_contra_id uuid,
  saldo_registro numeric, saldo_libros numeric,
  movimientos integer, movimientos_sin_poliza integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid := public.conta_autorizar_proyecto(p_project_id, false);
  v_ultimo  uuid;
BEGIN
  -- (conta_autorizar_proyecto ya lo exigió sobre la empresa del proyecto; se repite a la vista.)
  PERFORM public.assert_company_scope(v_company);
  -- Las cuentas que se usaron la última vez: son las que se proponen la siguiente.
  SELECT a.id INTO v_ultimo FROM public.conta_asientos a
   WHERE a.company_id = v_company AND a.project_id = p_project_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'fondo_reserva' AND a.estado = 'publicado' AND a.reversa_de_id IS NULL
   ORDER BY a.created_at DESC, a.numero DESC NULLS LAST LIMIT 1;
  SELECT l.cuenta_id INTO cuenta_fondo_id FROM public.conta_asiento_lineas l
   WHERE l.asiento_id = v_ultimo AND l.descripcion = 'Fondo de reserva' LIMIT 1;
  SELECT l.cuenta_id INTO cuenta_contra_id FROM public.conta_asiento_lineas l
   WHERE l.asiento_id = v_ultimo AND l.descripcion <> 'Fondo de reserva' LIMIT 1;

  SELECT COALESCE(sum(CASE WHEN f.tipo = 'retiro' THEN -f.monto WHEN f.tipo = 'ajuste' THEN 0 ELSE f.monto END), 0),
         count(*)::int,
         (count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM public.conta_asientos a
             WHERE a.company_id = v_company AND a.origen = 'automatico' AND a.origen_tabla = 'fondo_reserva'
               AND a.origen_id = f.id AND a.estado = 'publicado' AND a.anulado_por_id IS NULL)))::int
    INTO saldo_registro, movimientos, movimientos_sin_poliza
    FROM public.fondo_reserva f
   WHERE f.company_id = v_company AND f.project_id = p_project_id;

  SELECT COALESCE(sum(l.debe - l.haber), 0) INTO saldo_libros
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE cuenta_fondo_id IS NOT NULL AND l.cuenta_id = cuenta_fondo_id AND a.estado = 'publicado';

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_fondo_reserva_resumen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_fondo_reserva_resumen(uuid) TO authenticated;

-- ── 2. CAJA CHICA: fondo fijo con reposición ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conta_caja_reposiciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  caja_id         uuid NOT NULL REFERENCES public.caja_chica(id) ON DELETE RESTRICT,
  fecha           date NOT NULL,
  total           numeric(14,2) NOT NULL CHECK (total > 0),
  cuenta_banco_id uuid NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  asiento_id      uuid REFERENCES public.conta_asientos(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conta_caja_reposiciones_caja ON public.conta_caja_reposiciones (caja_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_conta_caja_reposiciones_company ON public.conta_caja_reposiciones (company_id);
CREATE INDEX IF NOT EXISTS idx_conta_caja_reposiciones_project ON public.conta_caja_reposiciones (project_id);
CREATE INDEX IF NOT EXISTS idx_conta_caja_reposiciones_cuenta ON public.conta_caja_reposiciones (cuenta_banco_id);
CREATE INDEX IF NOT EXISTS idx_conta_caja_reposiciones_asiento ON public.conta_caja_reposiciones (asiento_id);
CREATE INDEX IF NOT EXISTS idx_conta_caja_reposiciones_created_by ON public.conta_caja_reposiciones (created_by);

ALTER TABLE public.conta_caja_reposiciones ENABLE ROW LEVEL SECURITY;

-- Sólo lectura por RLS: se escribe únicamente desde conta_caja_chica_reponer.
DROP POLICY IF EXISTS "conta_caja_reposiciones_select" ON public.conta_caja_reposiciones;
CREATE POLICY "conta_caja_reposiciones_select" ON public.conta_caja_reposiciones
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])
                    OR public.user_has_permission('platform.contabilidad.view'))
        AND (SELECT public.can_access_project(project_id)))
  );
DROP POLICY IF EXISTS mfa_gate_aal2 ON public.conta_caja_reposiciones;
CREATE POLICY mfa_gate_aal2 ON public.conta_caja_reposiciones
  AS RESTRICTIVE TO authenticated
  USING (public.mfa_requirement_met())
  WITH CHECK (public.mfa_requirement_met());

REVOKE ALL ON public.conta_caja_reposiciones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_caja_reposiciones TO authenticated;
GRANT SELECT ON public.conta_caja_reposiciones TO service_role;

ALTER TABLE public.caja_chica
  ADD COLUMN IF NOT EXISTS cuenta_caja_id uuid REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT;
ALTER TABLE public.movimientos_caja
  ADD COLUMN IF NOT EXISTS cuenta_gasto_id uuid REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reposicion_id uuid REFERENCES public.conta_caja_reposiciones(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_caja_chica_cuenta_caja ON public.caja_chica (cuenta_caja_id) WHERE cuenta_caja_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_cuenta_gasto ON public.movimientos_caja (cuenta_gasto_id) WHERE cuenta_gasto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_reposicion ON public.movimientos_caja (reposicion_id) WHERE reposicion_id IS NOT NULL;

COMMENT ON COLUMN public.caja_chica.cuenta_caja_id IS
  'Cuenta contable «Caja chica» del fondo fijo. Se fija al constituir el fondo en libros (conta_caja_chica_constituir).';
COMMENT ON COLUMN public.movimientos_caja.cuenta_gasto_id IS
  'Cuenta de gasto del vale. Se asigna al reponer la caja (conta_caja_chica_reponer).';
COMMENT ON COLUMN public.movimientos_caja.reposicion_id IS
  'Reposición que llevó este vale a libros (o que este ingreso registra). NULL = aún no repuesto.';

-- Un vale que ya entró a libros no se borra ni cambia de importe o de tipo.
CREATE OR REPLACE FUNCTION public.conta_tg_movimiento_caja_repuesto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_setting('conta.allow_system_write', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.reposicion_id IS NOT NULL THEN
      RAISE EXCEPTION 'CAJA_MOVIMIENTO_REPUESTO: este movimiento ya está en una reposición contabilizada y no se puede eliminar. Reversa la póliza de la reposición desde Contabilidad.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.reposicion_id IS NOT NULL
     AND (NEW.monto IS DISTINCT FROM OLD.monto OR NEW.tipo IS DISTINCT FROM OLD.tipo
          OR NEW.caja_id IS DISTINCT FROM OLD.caja_id OR NEW.reposicion_id IS DISTINCT FROM OLD.reposicion_id
          OR NEW.cuenta_gasto_id IS DISTINCT FROM OLD.cuenta_gasto_id) THEN
    RAISE EXCEPTION 'CAJA_MOVIMIENTO_REPUESTO: este movimiento ya está en una reposición contabilizada y no se puede modificar.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_tg_movimiento_caja_repuesto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_movimiento_caja_repuesto ON public.movimientos_caja;
CREATE TRIGGER trg_movimiento_caja_repuesto
  BEFORE UPDATE OR DELETE ON public.movimientos_caja
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_movimiento_caja_repuesto();

-- Las cajas del proyecto vistas desde Contabilidad: quien lleva los libros no
-- siempre tiene la pestaña «Caja chica» de Condominios, y aun así las repone.
CREATE OR REPLACE FUNCTION public.conta_cajas_chicas(p_project_id uuid)
RETURNS TABLE (
  caja_id uuid, responsable text, fecha_apertura date, monto_fondo numeric, estado text,
  cuenta_caja_id uuid, vales_pendientes integer, total_pendiente numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid := public.conta_autorizar_proyecto(p_project_id, false);
BEGIN
  PERFORM public.assert_company_scope(v_company);
  RETURN QUERY
  SELECT c.id, c.responsable, c.fecha_apertura, c.monto_inicial::numeric, c.estado, c.cuenta_caja_id,
         (SELECT count(*)::int FROM public.movimientos_caja m
           WHERE m.caja_id = c.id AND m.tipo = 'egreso' AND m.reposicion_id IS NULL),
         (SELECT COALESCE(sum(m.monto), 0)::numeric FROM public.movimientos_caja m
           WHERE m.caja_id = c.id AND m.tipo = 'egreso' AND m.reposicion_id IS NULL)
    FROM public.caja_chica c
   WHERE c.company_id = v_company AND c.project_id = p_project_id
   ORDER BY (c.estado = 'abierta') DESC, c.fecha_apertura DESC, c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_cajas_chicas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cajas_chicas(uuid) TO authenticated;

-- Constituir el fondo fijo: Dr Caja chica / Cr Banco, una sola vez por caja.
CREATE OR REPLACE FUNCTION public.conta_caja_chica_constituir(
  p_caja_id         uuid,
  p_fecha           date,
  p_cuenta_caja_id  uuid,
  p_cuenta_banco_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caja    public.caja_chica;
  v_company uuid;
  v_asiento uuid;
BEGIN
  SELECT * INTO v_caja FROM public.caja_chica c WHERE c.id = p_caja_id FOR UPDATE;
  -- Una caja que no existe y una de otra empresa responden igual.
  v_company := public.conta_autorizar_proyecto(v_caja.project_id, true);
  IF v_caja.id IS NULL OR v_caja.company_id <> v_company THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin() OR public.condominios_puede_actuar('caja_chica', 'edit')) THEN
    RAISE EXCEPTION 'No autorizado: requiere editar la caja chica en Condominios.' USING ERRCODE = '42501';
  END IF;
  IF v_caja.estado <> 'abierta' THEN
    RAISE EXCEPTION 'La caja está cerrada.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_caja.cuenta_caja_id IS NOT NULL THEN
    RAISE EXCEPTION 'El fondo de esta caja ya está constituido en libros.' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(v_caja.monto_inicial, 0) <= 0 THEN
    RAISE EXCEPTION 'La caja no tiene monto de fondo: captúralo en Condominios › Caja chica.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.conta_exigir_fecha_abierta(v_company, v_caja.project_id, p_fecha);
  IF NOT public.conta_cuenta_utilizable(v_company, v_caja.project_id, p_cuenta_caja_id)
     OR NOT public.conta_cuenta_utilizable(v_company, v_caja.project_id, p_cuenta_banco_id)
     OR p_cuenta_caja_id = p_cuenta_banco_id THEN
    RAISE EXCEPTION 'La cuenta de caja chica y la de banco tienen que ser dos cuentas de esta contabilidad, de detalle y activas.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT c.tipo FROM public.conta_cuentas c WHERE c.id = p_cuenta_caja_id) <> 'activo' THEN
    RAISE EXCEPTION 'La cuenta de caja chica debe ser una cuenta de activo.' USING ERRCODE = 'check_violation';
  END IF;

  v_asiento := public.conta_generar_asiento(
    v_company, v_caja.project_id, 'caja_chica', v_caja.id, 'fondo_constituido', p_fecha,
    'Caja chica — constitución del fondo fijo (' || v_caja.responsable || ')', 'diario', NULL,
    jsonb_build_array(
      jsonb_build_object('cuenta_id', p_cuenta_caja_id, 'debe', v_caja.monto_inicial, 'descripcion', 'Fondo fijo de caja chica'),
      jsonb_build_object('cuenta_id', p_cuenta_banco_id, 'haber', v_caja.monto_inicial, 'descripcion', 'Fondo fijo de caja chica')));
  IF v_asiento IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.conta_asientos a WHERE a.id = v_asiento AND a.estado = 'publicado') THEN
    RAISE EXCEPTION 'No se pudo publicar la póliza del fondo de caja chica.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.caja_chica c SET cuenta_caja_id = p_cuenta_caja_id WHERE c.id = v_caja.id;
  RETURN v_asiento;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_caja_chica_constituir(uuid, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_caja_chica_constituir(uuid, date, uuid, uuid) TO authenticated;

-- Reponer: los vales pendientes pasan al gasto en una póliza contra el banco.
CREATE OR REPLACE FUNCTION public.conta_caja_chica_reponer(
  p_caja_id         uuid,
  p_fecha           date,
  p_cuenta_banco_id uuid,
  p_lineas          jsonb DEFAULT '[]'::jsonb,
  p_aplicar         boolean DEFAULT false
) RETURNS TABLE (
  movimiento_id uuid, fecha date, concepto text, comprobante text, monto numeric,
  cuenta_gasto_id uuid, cuenta_codigo text, cuenta_nombre text,
  resultado text, motivo text, reposicion_id uuid, asiento_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_variable
DECLARE
  v_caja    public.caja_chica;
  v_company uuid;
  v_repo    uuid := gen_random_uuid();
  v_asiento uuid;
  v_total   numeric(14,2);
  v_lineas  jsonb;
  v_pend    jsonb;
  m         record;
BEGIN
  SELECT * INTO v_caja FROM public.caja_chica c WHERE c.id = p_caja_id FOR UPDATE;
  v_company := public.conta_autorizar_proyecto(v_caja.project_id, COALESCE(p_aplicar, false));
  IF v_caja.id IS NULL OR v_caja.company_id <> v_company THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_aplicar, false)
     AND NOT (public.is_super_admin() OR public.condominios_puede_actuar('caja_chica', 'create')) THEN
    RAISE EXCEPTION 'No autorizado: requiere crear movimientos de caja chica en Condominios.' USING ERRCODE = '42501';
  END IF;
  IF p_lineas IS NOT NULL AND jsonb_typeof(p_lineas) <> 'array' THEN
    RAISE EXCEPTION 'Las cuentas por vale van como una lista.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_aplicar, false) THEN
    IF v_caja.cuenta_caja_id IS NULL THEN
      RAISE EXCEPTION 'Primero constituye el fondo de esta caja en libros.' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM public.conta_exigir_fecha_abierta(v_company, v_caja.project_id, p_fecha);
    IF NOT public.conta_cuenta_utilizable(v_company, v_caja.project_id, p_cuenta_banco_id)
       OR p_cuenta_banco_id = v_caja.cuenta_caja_id THEN
      RAISE EXCEPTION 'La cuenta de banco tiene que ser de esta contabilidad, de detalle, activa y distinta de la de caja chica.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Vales pendientes, cada uno con la cuenta que viene en p_lineas o la que ya tenía.
  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.fecha, q.movimiento_id), '[]'::jsonb) INTO v_pend
    FROM (
      SELECT mv.id AS movimiento_id, mv.fecha, mv.concepto, mv.comprobante, mv.monto, x.cuenta AS cuenta_gasto_id,
             (x.cuenta IS NOT NULL
              AND public.conta_cuenta_utilizable(v_company, v_caja.project_id, x.cuenta)
              AND x.cuenta IS DISTINCT FROM v_caja.cuenta_caja_id
              AND x.cuenta IS DISTINCT FROM p_cuenta_banco_id) AS valida
        FROM public.movimientos_caja mv
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            (SELECT NULLIF(l ->> 'cuenta_gasto_id', '')::uuid FROM jsonb_array_elements(COALESCE(p_lineas, '[]'::jsonb)) l
              WHERE l ->> 'movimiento_id' = mv.id::text LIMIT 1),
            mv.cuenta_gasto_id) AS cuenta) x
       WHERE mv.caja_id = v_caja.id AND mv.tipo = 'egreso' AND mv.reposicion_id IS NULL
         AND mv.fecha <= COALESCE(p_fecha, CURRENT_DATE)
    ) q;

  SELECT COALESCE(sum((t ->> 'monto')::numeric), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'cuenta_id', t ->> 'cuenta_gasto_id', 'debe', (t ->> 'monto')::numeric,
           'descripcion', left((t ->> 'concepto') || COALESCE(' · ' || NULLIF(t ->> 'comprobante', ''), ''), 200))), '[]'::jsonb)
    INTO v_total, v_lineas
    FROM jsonb_array_elements(v_pend) t WHERE (t ->> 'valida')::boolean;

  IF COALESCE(p_aplicar, false) AND v_total > 0 THEN
    v_asiento := public.conta_generar_asiento(
      v_company, v_caja.project_id, 'conta_caja_reposiciones', v_repo, 'reposicion', p_fecha,
      'Caja chica — reposición del fondo (' || v_caja.responsable || ')', 'diario', NULL,
      v_lineas || jsonb_build_array(
        jsonb_build_object('cuenta_id', p_cuenta_banco_id, 'haber', v_total, 'descripcion', 'Reposición de caja chica')));
    IF v_asiento IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.conta_asientos a WHERE a.id = v_asiento AND a.estado = 'publicado') THEN
      RAISE EXCEPTION 'No se pudo publicar la póliza de la reposición.' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.conta_caja_reposiciones (id, company_id, project_id, caja_id, fecha, total, cuenta_banco_id, asiento_id, created_by)
    VALUES (v_repo, v_company, v_caja.project_id, v_caja.id, p_fecha, v_total, p_cuenta_banco_id, v_asiento, auth.uid());

    PERFORM set_config('conta.allow_system_write', 'on', true);
    UPDATE public.movimientos_caja mv
       SET reposicion_id = v_repo, cuenta_gasto_id = (t ->> 'cuenta_gasto_id')::uuid
      FROM jsonb_array_elements(v_pend) t
     WHERE mv.id = (t ->> 'movimiento_id')::uuid AND (t ->> 'valida')::boolean;
    -- El dinero que vuelve a la caja: su saldo operativo regresa al fondo fijo.
    INSERT INTO public.movimientos_caja (company_id, caja_id, project_id, tipo, concepto, monto, fecha, registrado_por, reposicion_id)
    VALUES (v_company, v_caja.id, v_caja.project_id, 'ingreso', 'Reposición de caja chica', v_total, p_fecha, 'Contabilidad', v_repo);
    PERFORM set_config('conta.allow_system_write', 'off', true);
  END IF;

  FOR m IN
    SELECT (t ->> 'movimiento_id')::uuid AS movimiento_id, (t ->> 'fecha')::date AS fecha, t ->> 'concepto' AS concepto,
           t ->> 'comprobante' AS comprobante, (t ->> 'monto')::numeric AS monto,
           (t ->> 'cuenta_gasto_id')::uuid AS cuenta_gasto_id, (t ->> 'valida')::boolean AS valida, c.codigo, c.nombre
      FROM jsonb_array_elements(v_pend) WITH ORDINALITY AS e(t, n)
      LEFT JOIN public.conta_cuentas c ON c.id = (t ->> 'cuenta_gasto_id')::uuid AND c.company_id = v_company
     ORDER BY e.n
  LOOP
    movimiento_id := m.movimiento_id; fecha := m.fecha; concepto := m.concepto; comprobante := m.comprobante;
    monto := m.monto; cuenta_gasto_id := m.cuenta_gasto_id; cuenta_codigo := m.codigo; cuenta_nombre := m.nombre;
    reposicion_id := NULL; asiento_id := NULL; motivo := NULL;
    IF NOT m.valida THEN
      resultado := 'sin_cuenta';
      motivo := CASE WHEN m.cuenta_gasto_id IS NULL THEN 'Elige la cuenta de gasto de este vale.'
                     ELSE 'La cuenta no sirve: tiene que ser de esta contabilidad, de detalle, activa, y no la de caja ni la de banco.' END;
    ELSIF COALESCE(p_aplicar, false) THEN
      resultado := 'repuesto'; reposicion_id := v_repo; asiento_id := v_asiento;
    ELSE
      resultado := 'previsualizacion';
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_caja_chica_reponer(uuid, date, uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_caja_chica_reponer(uuid, date, uuid, jsonb, boolean) TO authenticated;

COMMENT ON FUNCTION public.conta_caja_chica_constituir(uuid, date, uuid, uuid) IS
  'Constituye en libros el fondo fijo de una caja chica (Dr Caja chica / Cr Banco). Una vez por caja.';
COMMENT ON FUNCTION public.conta_caja_chica_reponer(uuid, date, uuid, jsonb, boolean) IS
  'Reposición de caja chica: los egresos aún no repuestos pasan al gasto en una póliza contra el banco y la caja recibe el ingreso. Previsualiza (p_aplicar=false) o aplica.';
