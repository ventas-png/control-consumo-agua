-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE B · CICLO DE LA ORDEN VALIDADO EN SERVIDOR + HISTORIAL
--
-- QUÉ FALTABA
-- La orden de compra (Fase 6) ya valida al proveedor al aprobar/emitir, congela
-- sus líneas y numera, pero:
--   · NINGÚN trigger validaba las TRANSICIONES: cualquiera con permiso de
--     edición podía pasar una orden de «emitida» a «recibida» a mano (la casilla
--     que la Fase 6 vino a eliminar y que la pantalla de Operaciones conserva),
--     reabrir una emitida a borrador o saltarse la aprobación (borrador →
--     emitida);
--   · la cabecera de una orden APROBADA se podía editar sin que nadie lo viera
--     (proveedor, moneda, contrato, condiciones…): la aprobación dejaba de
--     describir lo que se iba a comprar;
--   · no había separación solicitante/aprobador (el que captura puede
--     aprobarse a sí mismo) ni historial de quién hizo cada paso.
--
-- QUÉ HACE
--   1. `orden_compra_eventos`: historial append-only de cada cambio de estado
--      (quién, cuándo, motivo). Lo escribe un trigger; nadie más.
--   2. Máquina de estados validada en servidor (las escrituras del sistema —
--      recepciones y facturas, con `conta.allow_system_write`— quedan fuera):
--        borrador → aprobada | cancelada
--        aprobada → emitida | borrador (DEVOLVER: exige motivo) | cancelada
--        emitida  → cancelada (solo sin recepciones registradas) | cerrada
--        recibida_parcial | recibida → cerrada
--      `recibida` y `recibida_parcial` solo las pone una recepción registrada.
--   3. Aprobada = congelada: cambiar proveedor, moneda, proyecto, contrato,
--      condiciones de pago, días de crédito, obra o fecha requerida se RECHAZA
--      con la instrucción de devolverla a borrador. Devolver anula la
--      aprobación (sello y aprobador), sube `revision` y deja motivo e
--      historial: una modificación relevante es una REVISIÓN, nunca un cambio
--      silencioso.
--   4. El solicitante (`created_by`) lo fija el servidor al crear y no se
--      reasigna. Separación solicitante/aprobador, CONFIGURABLE y APAGADA por defecto:
--      `compras_config.aprobacion_separada`. Con ella encendida, quien creó la
--      orden no la aprueba. No hay decisión de negocio documentada que la
--      encienda: el interruptor existe para que la decisión no requiera
--      código, no para decidirla por la empresa.
--
-- COMPATIBILIDAD
--   · Nada cambia de lo que hacen las recepciones y las facturas (GUC del
--     sistema). Los flujos de pantalla aprobar → emitir → cancelar siguen igual.
--   · Cambia a propósito: «Marcar recibida» a mano ya no existe (la recepción
--     es lo que recibe) y editar la cabecera de una orden aprobada exige
--     devolverla.
--
-- CÓMO REVERTIR
--   DROP TRIGGER trg_compras_oc_ciclo_a ON public.ordenes_compra;
--   DROP TRIGGER trg_compras_oc_eventos ON public.ordenes_compra;
--   DROP TRIGGER trg_compras_oc_solicitante ON public.ordenes_compra;
--   DROP FUNCTION public.compras_tg_oc_solicitante();
--   DROP FUNCTION public.compras_tg_oc_ciclo(), public.compras_tg_oc_eventos();
--   DROP TABLE public.orden_compra_eventos;
--   ALTER TABLE public.ordenes_compra DROP COLUMN revision, DROP COLUMN motivo_devolucion;
--   ALTER TABLE public.compras_config DROP COLUMN aprobacion_separada;
--
-- IMPACTO EN DATOS: dos columnas con default y una tabla nueva vacía. Ninguna
-- fila existente cambia.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS revision          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motivo_devolucion text;

COMMENT ON COLUMN public.ordenes_compra.revision IS
  'Veces que la orden se devolvió a borrador tras aprobarse (cada una invalida la aprobación). 0 = nunca.';

ALTER TABLE public.compras_config
  ADD COLUMN IF NOT EXISTS aprobacion_separada boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.compras_config.aprobacion_separada IS
  'true = quien creó la orden no puede aprobarla. Apagado por defecto: sin decisión de negocio que lo exija.';

-- ── 1. Historial ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orden_compra_eventos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  orden_compra_id uuid        NOT NULL REFERENCES public.ordenes_compra(id) ON DELETE CASCADE,
  tipo            text        NOT NULL CHECK (tipo IN ('estado', 'devolucion')),
  estado_anterior text,
  estado_nuevo    text,
  revision        integer     NOT NULL DEFAULT 0,
  motivo          text,
  origen          text        NOT NULL DEFAULT 'usuario' CHECK (origen IN ('usuario', 'sistema')),
  actor_id        uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oc_eventos_orden ON public.orden_compra_eventos (orden_compra_id, created_at);

ALTER TABLE public.orden_compra_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orden_compra_eventos_select" ON public.orden_compra_eventos;
CREATE POLICY "orden_compra_eventos_select" ON public.orden_compra_eventos
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (project_id IS NULL OR public.can_access_project(project_id))));
REVOKE ALL ON public.orden_compra_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.orden_compra_eventos TO authenticated;

-- ── 2. Transiciones y congelamiento (BEFORE UPDATE) ─────────────────────────
-- Nombre `a_` para correr ANTES de compras_tg_oc_estado (que sella y numera) y
-- de los candados del proveedor: una transición inválida se rechaza sin tocar nada.
CREATE OR REPLACE FUNCTION public.compras_tg_oc_ciclo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ok       boolean;
  v_separada boolean;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;   -- recepciones y facturas moviendo el estado de lo comprometido
  END IF;

  -- El solicitante (`created_by`) es el que capturó la orden: no se reasigna,
  -- porque la separación solicitante/aprobador se apoya en él.
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'COMPRAS_OC_SOLICITANTE_INMUTABLE: el solicitante de la orden no se cambia.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Aprobada es documento congelado ───────────────────────────────────────
  IF OLD.estado = 'aprobada' AND NEW.estado = 'aprobada'
     AND (NEW.proveedor_id      IS DISTINCT FROM OLD.proveedor_id
       OR NEW.moneda            IS DISTINCT FROM OLD.moneda
       OR NEW.project_id        IS DISTINCT FROM OLD.project_id
       OR NEW.contrato_id       IS DISTINCT FROM OLD.contrato_id
       OR NEW.condiciones_pago  IS DISTINCT FROM OLD.condiciones_pago
       OR NEW.dias_credito      IS DISTINCT FROM OLD.dias_credito
       OR NEW.obra_id           IS DISTINCT FROM OLD.obra_id
       OR NEW.fecha_requerida   IS DISTINCT FROM OLD.fecha_requerida) THEN
    RAISE EXCEPTION 'COMPRAS_OC_APROBADA_CAMBIO: la orden está aprobada y sus condiciones (proveedor, moneda, proyecto, contrato, condiciones de pago, crédito, obra, fecha requerida) no se modifican en silencio. Devuélvela a borrador indicando el motivo: la aprobación se invalida y queda como revisión.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  -- ── Máquina de estados ────────────────────────────────────────────────────
  v_ok := CASE OLD.estado
    WHEN 'borrador'         THEN NEW.estado IN ('aprobada', 'cancelada')
    WHEN 'aprobada'         THEN NEW.estado IN ('emitida', 'borrador', 'cancelada')
    WHEN 'emitida'          THEN NEW.estado IN ('cancelada', 'cerrada')
    WHEN 'recibida_parcial' THEN NEW.estado IN ('cerrada')
    WHEN 'recibida'         THEN NEW.estado IN ('cerrada')
    ELSE false                       -- cerrada y cancelada son finales
  END;
  IF NOT v_ok THEN
    IF NEW.estado IN ('recibida', 'recibida_parcial') THEN
      RAISE EXCEPTION 'COMPRAS_OC_RECIBIDA_MANUAL: una orden no se marca como recibida a mano: pasa a «%» cuando se REGISTRA una recepción contra ella.', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'COMPRAS_OC_TRANSICION_INVALIDA: de «%» a «%» no es un cambio de estado permitido.', OLD.estado, NEW.estado
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cancelar una emitida con recepciones registradas dejaría existencias,
  -- activos y asientos sin orden: se CIERRA (o se anula la recepción primero).
  IF NEW.estado = 'cancelada' AND OLD.estado = 'emitida'
     AND EXISTS (SELECT 1 FROM public.recepciones r
                  WHERE r.orden_compra_id = OLD.id AND r.estado = 'registrada') THEN
    RAISE EXCEPTION 'COMPRAS_OC_CANCELAR_CON_RECEPCION: la orden tiene recepciones registradas; anúlalas primero o cierra la orden.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Devolver a borrador = invalidar la aprobación (revisión) ──────────────
  IF OLD.estado = 'aprobada' AND NEW.estado = 'borrador' THEN
    IF btrim(COALESCE(NEW.motivo_devolucion, '')) = ''
       OR NEW.motivo_devolucion IS NOT DISTINCT FROM OLD.motivo_devolucion THEN
      RAISE EXCEPTION 'COMPRAS_OC_DEVOLUCION_MOTIVO: devolver una orden aprobada a borrador exige indicar el motivo (nuevo en cada devolución).'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.aprobada_por := NULL;
    NEW.aprobada_at  := NULL;
    NEW.revision     := OLD.revision + 1;
  END IF;

  -- ── Separación solicitante / aprobador (si la empresa la activó) ──────────
  IF NEW.estado = 'aprobada' AND OLD.estado = 'borrador' THEN
    SELECT c.aprobacion_separada INTO v_separada
      FROM public.compras_config c WHERE c.company_id = NEW.company_id;
    IF COALESCE(v_separada, false)
       AND NEW.created_by IS NOT NULL AND NEW.created_by = auth.uid() THEN
      RAISE EXCEPTION 'COMPRAS_OC_AUTOAPROBACION: quien solicita la orden no la aprueba; la empresa exige que la apruebe otra persona.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_ciclo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_oc_ciclo_a ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_ciclo_a
  BEFORE UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_ciclo();

-- ── 2b. El solicitante lo pone el SERVIDOR ──────────────────────────────────
-- Antes `created_by` lo mandaba (o no) el cliente. Sin esto, la separación
-- solicitante/aprobador se evade capturando la orden a nombre de otra persona.
CREATE OR REPLACE FUNCTION public.compras_tg_oc_solicitante()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = auth.uid()) THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_solicitante() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_oc_solicitante ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_solicitante
  BEFORE INSERT ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_solicitante();

-- ── 3. Historial (AFTER: ya con el estado definitivo) ───────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_oc_eventos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sistema boolean := COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.orden_compra_eventos
      (company_id, project_id, orden_compra_id, tipo, estado_nuevo, revision, origen, actor_id)
    VALUES (NEW.company_id, NEW.project_id, NEW.id, 'estado', NEW.estado, NEW.revision,
            CASE WHEN v_sistema THEN 'sistema' ELSE 'usuario' END, auth.uid());
    RETURN NULL;
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO public.orden_compra_eventos
      (company_id, project_id, orden_compra_id, tipo, estado_anterior, estado_nuevo, revision, motivo, origen, actor_id)
    VALUES (NEW.company_id, NEW.project_id, NEW.id,
            CASE WHEN OLD.estado = 'aprobada' AND NEW.estado = 'borrador' THEN 'devolucion' ELSE 'estado' END,
            OLD.estado, NEW.estado, NEW.revision,
            CASE WHEN OLD.estado = 'aprobada' AND NEW.estado = 'borrador' THEN NEW.motivo_devolucion
                 WHEN NEW.estado = 'cancelada' THEN NEW.motivo_anulacion END,
            CASE WHEN v_sistema THEN 'sistema' ELSE 'usuario' END, auth.uid());
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_eventos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_oc_eventos ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_eventos
  AFTER INSERT OR UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_eventos();

COMMENT ON TABLE public.orden_compra_eventos IS
  'Historial append-only de la orden de compra (estado, devoluciones/revisiones). Lo escribe el trigger; la aplicación solo lee.';
