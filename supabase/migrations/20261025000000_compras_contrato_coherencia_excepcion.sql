-- ════════════════════════════════════════════════════════════════════════════
-- Contratos ↔ órdenes · coherencia al EDITAR y excepciones atadas a sus condiciones
-- ════════════════════════════════════════════════════════════════════════════
-- Dos huecos que dejó 20261024000000, hallados al probar por la API directa:
--
--  1. `compras_tg_oc_contrato()` salía en cuanto `contrato_id` no cambiaba. Una orden en BORRADOR que
--     conservaba su contrato podía cambiar de proveedor, de moneda o de proyecto con un UPDATE directo y
--     quedar ligada a un contrato que ya no le corresponde. Ahora se revalida la ligadura (empresa, proveedor,
--     proyecto y moneda) cuando cambia el contrato O cualquiera de esos cuatro datos. El estado y la vigencia
--     del contrato siguen exigiéndose solo al LIGAR (y al aprobar/emitir): un contrato que venció después no
--     impide corregir un borrador.
--
--  2. La excepción se identificaba por (orden, revisión, etapa, causas). Cambiar el contrato o el importe de la
--     orden en borrador dejaba la misma excepción «vigente» para otra cosa. Ahora la excepción guarda el
--     contrato, el proveedor, la moneda y el importe con que se autorizó, y el trigger de aprobar/emitir exige
--     que coincidan. Si cambió alguno, hace falta una autorización nueva (la anterior queda como historial).
--     Las filas que ya existieran no tienen esos datos (NULL) y por eso no autorizan nada nuevo.
--
-- ROLLBACK:
--   restaurar compras_tg_oc_contrato(), compras_tg_oc_contrato_vigencia() y compras_oc_excepcion_contrato()
--   desde 20261024000000; DROP INDEX uq_oc_excepciones_condiciones; ALTER TABLE orden_compra_excepciones
--   DROP COLUMN proveedor_id, DROP COLUMN moneda, DROP COLUMN total;
--   y recrear UNIQUE (orden_compra_id, revision, etapa, causas).
-- IMPACTO EN DATOS: ninguno sobre filas existentes (las columnas nuevas admiten NULL).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La ligadura se revalida al cambiar proveedor, proyecto, empresa o moneda ──
CREATE OR REPLACE FUNCTION public.compras_tg_oc_contrato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c               record;
  v_moneda          text;
  v_cambia_contrato boolean;
BEGIN
  IF NEW.contrato_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_cambia_contrato := TG_OP = 'INSERT' OR NEW.contrato_id IS DISTINCT FROM OLD.contrato_id;
  IF NOT v_cambia_contrato
     AND NEW.proveedor_id IS NOT DISTINCT FROM OLD.proveedor_id
     AND NEW.project_id   IS NOT DISTINCT FROM OLD.project_id
     AND NEW.company_id   IS NOT DISTINCT FROM OLD.company_id
     AND upper(NEW.moneda) IS NOT DISTINCT FROM upper(OLD.moneda) THEN
    RETURN NEW;   -- nada de lo que liga la orden al contrato cambió
  END IF;

  SELECT c.company_id, c.project_id, c.proveedor_id, c.estado, c.moneda INTO v_c
    FROM public.contratos_proveedores c WHERE c.id = NEW.contrato_id;

  IF NOT FOUND OR v_c.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_AJENO: el contrato no pertenece a la empresa de la orden.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.proveedor_id IS NULL OR v_c.proveedor_id IS DISTINCT FROM NEW.proveedor_id THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_PROVEEDOR: el contrato no es del mismo proveedor de la orden (o es un contrato histórico sin proveedor vinculado). Si cambias el proveedor, cambia o quita también el contrato.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_PROYECTO: el contrato es de otro proyecto que la orden. Si cambias el proyecto, cambia o quita también el contrato.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_cambia_contrato THEN
    IF v_c.estado <> 'activo' THEN
      RAISE EXCEPTION 'COMPRAS_CONTRATO_NO_ACTIVO: solo se vinculan órdenes a contratos activos (estado actual: %).', v_c.estado
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.contrato_vigente(NEW.contrato_id, CURRENT_DATE) THEN
      RAISE EXCEPTION 'COMPRAS_CONTRATO_FUERA_DE_VIGENCIA: el contrato no está vigente hoy (fuera de las fechas de inicio y fin); no se le vinculan órdenes nuevas.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Monedas separadas: el contrato ampara compras en SU moneda. (La orden aún puede
  -- no traer moneda: la fija otro trigger con la moneda base del proyecto.)
  v_moneda := upper(COALESCE(NEW.moneda, public.conta_moneda_base(NEW.company_id, NEW.project_id)));
  IF v_c.moneda IS NOT NULL AND v_moneda IS NOT NULL AND v_moneda <> upper(v_c.moneda) THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_MONEDA: el contrato es en % y la orden en %; no se mezclan monedas. Si cambias la moneda, cambia o quita también el contrato.', v_c.moneda, v_moneda
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_contrato() FROM PUBLIC, anon, authenticated;

-- ── 2. La excepción guarda las condiciones con que se autorizó ─────────────────
ALTER TABLE public.orden_compra_excepciones
  ADD COLUMN IF NOT EXISTS proveedor_id uuid,
  ADD COLUMN IF NOT EXISTS moneda       text,
  ADD COLUMN IF NOT EXISTS total        numeric;

COMMENT ON COLUMN public.orden_compra_excepciones.total IS
  'Importe total de la orden al autorizar. La excepción solo vale para ese importe, con ese contrato, proveedor y moneda.';

-- La unicidad pasa de (orden, revisión, etapa, causas) a incluir las condiciones: con otras condiciones es
-- una autorización nueva. (Se busca el UNIQUE antiguo por su definición; así la migración se puede repetir.)
DO $$
DECLARE v_con text;
BEGIN
  FOR v_con IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'public.orden_compra_excepciones'::regclass AND con.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
             WHERE a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey))
           = ARRAY['causas', 'etapa', 'orden_compra_id', 'revision']
  LOOP
    EXECUTE format('ALTER TABLE public.orden_compra_excepciones DROP CONSTRAINT %I', v_con);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_oc_excepciones_condiciones
  ON public.orden_compra_excepciones (orden_compra_id, revision, etapa, causas, contrato_id, proveedor_id, moneda, total);

-- ── 3. Aprobar / emitir: la excepción debe coincidir con las condiciones actuales ──
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
  v_moneda         text;
  v_otra           boolean;
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

  -- La excepción vale para ESAS condiciones: la misma orden y revisión, la misma etapa y causas, y el mismo
  -- contrato, proveedor, moneda e importe con que se autorizó. Si cambió cualquiera, se necesita una nueva.
  v_moneda := upper(COALESCE(NEW.moneda, public.conta_moneda_base(NEW.company_id, NEW.project_id)));
  IF EXISTS (SELECT 1 FROM public.orden_compra_excepciones x
              WHERE x.orden_compra_id = NEW.id AND x.revision = NEW.revision
                AND x.etapa = v_etapa AND x.causas = v_causas
                AND x.contrato_id = NEW.contrato_id
                AND x.proveedor_id IS NOT DISTINCT FROM NEW.proveedor_id
                AND x.moneda = v_moneda
                AND x.total IS NOT DISTINCT FROM NEW.total) THEN
    RETURN NEW;   -- excepción autorizada, justificada y auditada, para estas mismas condiciones
  END IF;
  v_otra := EXISTS (SELECT 1 FROM public.orden_compra_excepciones x
                     WHERE x.orden_compra_id = NEW.id AND x.revision = NEW.revision AND x.etapa = v_etapa);

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
    || CASE WHEN v_otra THEN ' Había una excepción autorizada para esta orden, pero ya no corresponde: cambió el contrato, el proveedor, la moneda o el importe. Se necesita una autorización nueva.' ELSE '' END
    USING ERRCODE = 'check_violation';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_contrato_vigencia() FROM PUBLIC, anon, authenticated;

-- ── 4. La RPC que autoriza guarda y reconoce las condiciones ──────────────────
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
  v_moneda   text;
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

  v_moneda := upper(COALESCE(v_oc.moneda, public.conta_moneda_base(v_oc.company_id, v_oc.project_id)));

  -- Reintento: la misma excepción (orden, revisión, etapa, causas Y las mismas condiciones: contrato, proveedor,
  -- moneda e importe) no se duplica; con otras condiciones es una autorización nueva y la anterior queda en el historial.
  INSERT INTO public.orden_compra_excepciones
    (company_id, project_id, orden_compra_id, contrato_id, revision, etapa, causas, proveedor_id, moneda, total, motivo, detalle, autorizado_por)
  VALUES (v_oc.company_id, v_oc.project_id, v_oc.id, v_oc.contrato_id, v_oc.revision, p_etapa, v_causas,
          v_oc.proveedor_id, v_moneda, v_oc.total, btrim(p_motivo),
          jsonb_build_object('contrato_estado', v_c.estado, 'contrato_referencia', v_c.referencia,
                             'fecha_inicio', v_c.fecha_inicio, 'fecha_fin', v_c.fecha_fin,
                             'monto_maximo_vigente', public.contrato_monto_maximo_vigente(v_oc.contrato_id),
                             'total_orden', v_oc.total, 'moneda', v_oc.moneda),
          v_uid)
  ON CONFLICT (orden_compra_id, revision, etapa, causas, contrato_id, proveedor_id, moneda, total) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT x.id INTO v_id FROM public.orden_compra_excepciones x
     WHERE x.orden_compra_id = v_oc.id AND x.revision = v_oc.revision AND x.etapa = p_etapa AND x.causas = v_causas
       AND x.contrato_id = v_oc.contrato_id AND x.proveedor_id IS NOT DISTINCT FROM v_oc.proveedor_id
       AND x.moneda = v_moneda AND x.total IS NOT DISTINCT FROM v_oc.total;
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
