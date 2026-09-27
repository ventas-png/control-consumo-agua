-- ============================================================================
-- CONTABILIDAD (bloque 3): SOLICITUDES DE AJUSTE CON APROBACIÓN, EVIDENCIA DE
-- ANULACIÓN DE CARGOS, SALDO A FAVOR DESDE EL PORTAL Y CARGOS ADICIONALES POR
-- LA PASARELA
--
-- Decisiones aplicadas (docs/DECISIONES_PENDIENTES_CONTABILIDAD.md, §E):
--   E1  Quien solicita no aprueba. Única excepción: el `company_owner`, con
--       confirmación explícita (p_confirmar_autoaprobacion) y marca auditada.
--       No hay excepción por «único aprobador».
--   E2  Sin umbral monetario.
--   E3  Las solicitudes no vencen: ningún proceso cambia su estado por
--       antigüedad. (Recordatorios y «estancada» son PROPUESTA, sin código.)
--   E4  El residente SOLICITA la aplicación de su saldo a favor; contabilidad
--       la aprueba y la ejecuta.
--   E5  Se mantiene el bloqueo del rechazo de un cobro con saldo aplicado, sin
--       cascada. Un reembolso confirmado por el proveedor se conserva y abre
--       una incidencia visible de conciliación.
--
-- 1. FLUJO. solicitud (motivo) → pendiente → aprobar (ejecuta en la MISMA
--    transacción) → ejecutada | fallida (se reintenta) ; pendiente → rechazada
--    | cancelada. Todas las fechas y actores son del servidor. Cada transición
--    queda en conta_ajustes_eventos (sólo inserción).
--      · Idempotencia: el id de la solicitud lo genera el cliente; repetir la
--        MISMA solicitud devuelve la existente, con otros datos se rechaza.
--        Aprobar dos veces (doble clic, dos sesiones) ejecuta una sola vez:
--        la solicitud se bloquea FOR UPDATE y la segunda ve «ejecutada».
--      · Una solicitud abierta (pendiente o fallida) por tipo y documento.
--      · Al aprobar se vuelven a comprobar documento, período y saldo con el
--        documento bloqueado. Si algo cambió o falla, NADA de la ejecución
--        queda escrito (subtransacción) y la solicitud queda «fallida» con el
--        motivo del servidor; quien tenga permiso de aprobar la reintenta.
--
-- 2. SIN ATAJOS. Las operaciones que el flujo ejecuta ya no se pueden invocar
--    fuera de él: conta_anular_cobro_cargo, conta_anular_anticipo y
--    conta_revertir_aplicacion_saldo_favor exigen una solicitud aprobada EN
--    EJECUCIÓN en la transacción actual (conta_ajuste_exigir). Anular un cargo
--    adicional por UPDATE directo, o borrarlo, se rechaza
--    (CARGO_ANULACION_SOLO_POR_SOLICITUD, CARGO_NO_SE_BORRA). La marca de
--    ejecución es el txid de la transacción del aprobador, escrito en una
--    tabla que la aplicación no puede escribir.
--
-- 3. EVIDENCIA DE ANULACIÓN DE CARGOS. Toda anulación de un cargo adicional
--    deja en conta_cargo_anulaciones la hora del servidor, el actor, la
--    solicitud y el motivo, tenga o no asiento. El estado de cuenta ubica
--    esos cargos al corte con su fecha real; los anulados antes de esta
--    migración siguen en la limitación `anulacion_sin_fecha` (no se rellenan
--    con updated_at ni con la fecha de la migración).
--
-- 4. PORTAL. El residente consulta sus saldos a favor, sus cargos adicionales
--    y sus solicitudes (el sujeto sale de auth.uid() → cliente en el
--    servidor), y solicita aplicar un saldo propio a un documento propio.
--
-- 5. PASARELA.
--      · payment_requests.cargo_adicional_id: un cobro en línea de un cargo
--        adicional. conciliar_pago_externo lo registra por el camino del
--        cargo (validación de conta_tg_pagos, contabilización contra la CxC
--        del devengo). Exactamente un ítem por solicitud de cobro.
--      · pasarela_registrar_estado: único punto por el que un aviso del
--        proveedor (consulta desde el servidor o webhook) cambia el estado.
--        Deduplicado por (proveedor, clave de evento). El estado sólo avanza:
--        pending → succeeded | failed ; failed → succeeded ; succeeded →
--        refunded. Un aviso que contradice un estado final no lo revierte:
--        queda registrado y abre una incidencia.
--      · Reembolso confirmado: se conserva el evento, la solicitud pasa a
--        `refunded` y se intenta rechazar el cobro. Si el rechazo está
--        bloqueado (p. ej. COBRO_SALDO_FAVOR_APLICADO) NO se descarta: queda
--        una incidencia abierta con el motivo.
--
-- CÓMO SE REVIERTE: restaurar conta_anular_cobro_cargo (20261004000000),
-- conta_anular_anticipo, conta_revertir_aplicacion_saldo_favor y
-- conta_sf_autorizar (20261007000000), conta_ec_fuera_de_saldo y
-- conta_ec_limitaciones (20261006000000) y conciliar_pago_externo
-- (20260911231905); DROP de los triggers trg_cargo_solo_por_solicitud y de
-- las tablas y funciones nuevas; payment_requests: DROP COLUMN
-- cargo_adicional_id y restaurar payment_requests_estado_check.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TABLAS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.conta_ajustes_solicitudes (
  -- Clave de idempotencia: la genera el cliente.
  id                    uuid          PRIMARY KEY,
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tipo                  text          NOT NULL,
  documento_tabla       text          NOT NULL,
  documento_id          uuid          NOT NULL,
  -- aplicar_saldo_favor: el saldo (origen) que se aplica.
  saldo_origen_id       uuid          REFERENCES public.conta_saldo_favor_origenes(id) ON DELETE RESTRICT,
  -- aplicar_saldo_favor: importe a aplicar. Resto: importe del documento al
  -- solicitar (informativo, y se compara al aprobar).
  importe               numeric(14,2),
  moneda                text,
  motivo                text          NOT NULL,
  canal                 text          NOT NULL,
  estado                text          NOT NULL DEFAULT 'pendiente',
  solicitado_por        uuid          NOT NULL,
  solicitado_cliente_id uuid,
  solicitado_at         timestamptz   NOT NULL DEFAULT now(),
  -- Fotografía del documento al solicitar; al aprobar se compara con el
  -- documento bloqueado (conta_ajuste_revalidar).
  foto_documento        jsonb         NOT NULL DEFAULT '{}'::jsonb,
  revisado_por          uuid,
  revisado_at           timestamptz,
  motivo_revision       text,
  autoaprobada          boolean       NOT NULL DEFAULT false,
  ejecutado_at          timestamptz,
  resultado             jsonb,
  error_ejecucion       text,
  intentos_ejecucion    integer       NOT NULL DEFAULT 0,
  -- txid de la transacción que la está ejecutando (sólo mientras dura).
  ejecucion_txid        bigint,
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT conta_ajustes_tipo_valido CHECK (tipo IN (
    'anular_cargo', 'anular_cobro_cargo', 'anular_anticipo',
    'revertir_aplicacion_saldo_favor', 'aplicar_saldo_favor')),
  CONSTRAINT conta_ajustes_documento_del_tipo CHECK (
       (tipo = 'anular_cargo'                    AND documento_tabla = 'cargos_adicionales_unidad')
    OR (tipo IN ('anular_cobro_cargo','anular_anticipo') AND documento_tabla = 'pagos')
    OR (tipo = 'revertir_aplicacion_saldo_favor' AND documento_tabla = 'conta_saldo_favor_aplicaciones')
    OR (tipo = 'aplicar_saldo_favor'             AND documento_tabla IN ('cuotas_condominio','cargos_adicionales_unidad'))),
  CONSTRAINT conta_ajustes_aplicar_completa CHECK (
    tipo <> 'aplicar_saldo_favor' OR (saldo_origen_id IS NOT NULL AND importe > 0 AND importe = round(importe, 2))),
  CONSTRAINT conta_ajustes_canal_valido CHECK (canal IN ('backoffice','portal')),
  CONSTRAINT conta_ajustes_portal_solo_aplicar CHECK (
    canal <> 'portal' OR (tipo = 'aplicar_saldo_favor' AND solicitado_cliente_id IS NOT NULL)),
  CONSTRAINT conta_ajustes_estado_valido CHECK (estado IN (
    'pendiente', 'rechazada', 'cancelada', 'ejecutada', 'fallida')),
  CONSTRAINT conta_ajustes_motivo CHECK (length(btrim(motivo)) >= 5),
  CONSTRAINT conta_ajustes_revision_completa CHECK (
    estado IN ('pendiente','cancelada') OR (revisado_por IS NOT NULL AND revisado_at IS NOT NULL)),
  CONSTRAINT conta_ajustes_rechazo_con_motivo CHECK (
    estado <> 'rechazada' OR length(btrim(COALESCE(motivo_revision, ''))) >= 5),
  CONSTRAINT conta_ajustes_ejecutada_completa CHECK (
    estado <> 'ejecutada' OR (ejecutado_at IS NOT NULL AND resultado IS NOT NULL)),
  CONSTRAINT conta_ajustes_fallida_con_error CHECK (
    estado <> 'fallida' OR error_ejecucion IS NOT NULL),
  -- E1: sólo el company_owner se autoaprueba, y queda marcado.
  -- (una solicitud aprobada —ejecutada o fallida— por quien la pidió está
  -- marcada; y la marca sólo existe si fue así).
  CONSTRAINT conta_ajustes_autoaprobacion_marcada CHECK (
    (NOT autoaprobada OR revisado_por = solicitado_por)
    AND (estado NOT IN ('ejecutada','fallida') OR autoaprobada = (revisado_por = solicitado_por)))
);

-- Una solicitud ABIERTA por tipo y documento: dos anulaciones del mismo
-- cobro, o dos aplicaciones pendientes al mismo documento desde el mismo
-- saldo, no conviven.
CREATE UNIQUE INDEX uq_conta_ajustes_abierta
  ON public.conta_ajustes_solicitudes (tipo, documento_id, COALESCE(saldo_origen_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE estado IN ('pendiente','fallida');
CREATE INDEX idx_conta_ajustes_empresa ON public.conta_ajustes_solicitudes (company_id, project_id, estado, solicitado_at DESC);
CREATE INDEX idx_conta_ajustes_documento ON public.conta_ajustes_solicitudes (documento_tabla, documento_id);
CREATE INDEX idx_conta_ajustes_cliente ON public.conta_ajustes_solicitudes (solicitado_cliente_id) WHERE solicitado_cliente_id IS NOT NULL;
CREATE INDEX idx_conta_ajustes_origen ON public.conta_ajustes_solicitudes (saldo_origen_id) WHERE saldo_origen_id IS NOT NULL;
CREATE INDEX idx_conta_ajustes_txid ON public.conta_ajustes_solicitudes (ejecucion_txid) WHERE ejecucion_txid IS NOT NULL;

COMMENT ON TABLE public.conta_ajustes_solicitudes IS
  'Solicitudes de ajuste (anular un cargo o un cobro de cargo, anular un anticipo, revertir o aplicar un saldo a favor). Se solicitan con motivo y las aprueba otra persona (E1: el company_owner puede autoaprobarse con confirmación y queda marcado). Al aprobar se ejecutan en la misma transacción; si fallan quedan «fallida» y se reintentan. Sin umbral ni vencimiento (E2, E3). Sólo la escriben las RPC del flujo.';

CREATE TABLE public.conta_ajustes_eventos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id    uuid        NOT NULL REFERENCES public.conta_ajustes_solicitudes(id) ON DELETE RESTRICT,
  company_id      uuid        NOT NULL,
  project_id      uuid        NOT NULL,
  accion          text        NOT NULL,
  estado_anterior text,
  estado_nuevo    text        NOT NULL,
  actor           uuid,
  actor_cliente_id uuid,
  detalle         text,
  ocurrido_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conta_ajustes_eventos_accion CHECK (accion IN (
    'solicitada', 'aprobada', 'autoaprobada', 'rechazada', 'cancelada',
    'ejecutada', 'fallida', 'reintento'))
);

CREATE INDEX idx_conta_ajustes_eventos_sol ON public.conta_ajustes_eventos (solicitud_id, ocurrido_at);
CREATE INDEX idx_conta_ajustes_eventos_empresa ON public.conta_ajustes_eventos (company_id, project_id);

COMMENT ON TABLE public.conta_ajustes_eventos IS
  'Bitácora de sólo inserción de cada transición de una solicitud de ajuste: estado anterior y nuevo, actor (usuario o cliente del portal), hora del servidor y detalle (motivo, error de ejecución).';

CREATE TRIGGER trg_conta_ajustes_eventos_inmutable
  BEFORE UPDATE OR DELETE ON public.conta_ajustes_eventos
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_bitacora_inmutable();

-- Evidencia de la anulación de un cargo adicional (con o sin asiento).
CREATE TABLE public.conta_cargo_anulaciones (
  cargo_id      uuid        PRIMARY KEY REFERENCES public.cargos_adicionales_unidad(id) ON DELETE RESTRICT,
  company_id    uuid        NOT NULL,
  project_id    uuid        NOT NULL,
  solicitud_id  uuid        NOT NULL REFERENCES public.conta_ajustes_solicitudes(id) ON DELETE RESTRICT,
  anulado_at    timestamptz NOT NULL DEFAULT now(),
  anulado_por   uuid,
  motivo        text        NOT NULL,
  tenia_asiento boolean     NOT NULL,
  reverso_id    uuid        REFERENCES public.conta_asientos(id) ON DELETE RESTRICT
);

CREATE INDEX idx_conta_cargo_anulaciones_empresa ON public.conta_cargo_anulaciones (company_id, project_id);
CREATE INDEX idx_conta_cargo_anulaciones_sol ON public.conta_cargo_anulaciones (solicitud_id);
CREATE INDEX idx_conta_cargo_anulaciones_reverso ON public.conta_cargo_anulaciones (reverso_id) WHERE reverso_id IS NOT NULL;

COMMENT ON TABLE public.conta_cargo_anulaciones IS
  'Cuándo (hora del servidor), quién, por qué solicitud y con qué motivo se anuló un cargo adicional, tuviera o no asiento. El estado de cuenta lo usa para ubicar la anulación al corte. Los anulados antes de 20261011000000 no tienen fila: siguen como limitación anulacion_sin_fecha.';

CREATE TRIGGER trg_conta_cargo_anulaciones_inmutable
  BEFORE UPDATE OR DELETE ON public.conta_cargo_anulaciones
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_bitacora_inmutable();

-- Avisos del proveedor de pagos (consulta desde el servidor o webhook).
CREATE TABLE public.pasarela_eventos (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL,
  payment_request_id uuid        NOT NULL REFERENCES public.payment_requests(id) ON DELETE RESTRICT,
  provider           text        NOT NULL,
  clave_evento       text        NOT NULL,
  estado_informado   text        NOT NULL,
  origen             text        NOT NULL,
  estado_previo      text,
  estado_resultante  text,
  resultado          text,
  detalle            text,
  payload            jsonb,
  recibido_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pasarela_eventos_estado CHECK (estado_informado IN (
    'aprobado', 'pendiente', 'requiere_accion', 'rechazado', 'error', 'reembolsado')),
  CONSTRAINT pasarela_eventos_origen CHECK (origen IN ('consulta', 'webhook')),
  CONSTRAINT pasarela_eventos_clave_unica UNIQUE (provider, clave_evento)
);

CREATE INDEX idx_pasarela_eventos_pr ON public.pasarela_eventos (payment_request_id, recibido_at);
CREATE INDEX idx_pasarela_eventos_empresa ON public.pasarela_eventos (company_id, recibido_at DESC);

COMMENT ON TABLE public.pasarela_eventos IS
  'Cada aviso del proveedor de pagos sobre una solicitud de cobro, deduplicado por (proveedor, clave de evento): lo informado, el estado antes y después, y qué se hizo. Nunca se borra (evidencia de la conciliación).';

CREATE TRIGGER trg_pasarela_eventos_inmutable
  BEFORE UPDATE OR DELETE ON public.pasarela_eventos
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_bitacora_inmutable();

-- Incidencias de conciliación visibles para contabilidad.
CREATE TABLE public.conta_incidencias_conciliacion (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  tipo               text        NOT NULL,
  estado             text        NOT NULL DEFAULT 'abierta',
  payment_request_id uuid        REFERENCES public.payment_requests(id) ON DELETE RESTRICT,
  pago_id            uuid,
  evento_id          uuid        REFERENCES public.pasarela_eventos(id) ON DELETE RESTRICT,
  monto              numeric(14,2),
  detalle            text        NOT NULL,
  creada_at          timestamptz NOT NULL DEFAULT now(),
  resuelta_por       uuid,
  resuelta_at        timestamptz,
  nota_resolucion    text,
  CONSTRAINT conta_incidencias_tipo CHECK (tipo IN (
    'reembolso_bloqueado', 'reembolso_aplicado', 'rechazo_tras_aprobacion',
    'aprobado_tras_reembolso', 'reembolso_sin_cobro')),
  CONSTRAINT conta_incidencias_estado CHECK (estado IN ('abierta', 'resuelta')),
  CONSTRAINT conta_incidencias_resolucion CHECK (
    (estado = 'abierta' AND resuelta_por IS NULL AND resuelta_at IS NULL)
    OR (estado = 'resuelta' AND resuelta_por IS NOT NULL AND resuelta_at IS NOT NULL
        AND length(btrim(COALESCE(nota_resolucion, ''))) >= 5))
);

CREATE INDEX idx_conta_incidencias_empresa ON public.conta_incidencias_conciliacion (company_id, estado, creada_at DESC);
CREATE INDEX idx_conta_incidencias_pr ON public.conta_incidencias_conciliacion (payment_request_id);
CREATE INDEX idx_conta_incidencias_evento ON public.conta_incidencias_conciliacion (evento_id);
-- Un evento del proveedor abre, como mucho, una incidencia.
CREATE UNIQUE INDEX uq_conta_incidencias_evento ON public.conta_incidencias_conciliacion (evento_id) WHERE evento_id IS NOT NULL;

COMMENT ON TABLE public.conta_incidencias_conciliacion IS
  'Incidencias de conciliación con el proveedor de pagos: un reembolso confirmado cuyo rechazo interno está bloqueado (o que se aplicó), un rechazo o una aprobación que llega fuera de orden. Se resuelven a mano con nota; nunca se borran.';

-- Pago en línea de un CARGO ADICIONAL.
ALTER TABLE public.payment_requests
  ADD COLUMN cargo_adicional_id uuid REFERENCES public.cargos_adicionales_unidad(id) ON DELETE RESTRICT;

CREATE INDEX idx_payment_requests_cargo ON public.payment_requests (cargo_adicional_id)
  WHERE cargo_adicional_id IS NOT NULL;

COMMENT ON COLUMN public.payment_requests.cargo_adicional_id IS
  'Cargo adicional que paga esta solicitud de cobro en línea (portal). Excluyente con registro_id y cuota_id: lo valida conciliar_pago_externo.';

-- Un reembolso confirmado es un estado propio (sólo desde succeeded).
ALTER TABLE public.payment_requests DROP CONSTRAINT payment_requests_estado_check;
ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_estado_check
  CHECK (estado IN ('pending', 'succeeded', 'failed', 'pending_verification', 'refunded'));

-- ── RLS y grants: la aplicación sólo LEE, y sólo lo suyo ────────────────────
ALTER TABLE public.conta_ajustes_solicitudes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_ajustes_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_cargo_anulaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pasarela_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_incidencias_conciliacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conta_ajustes_solicitudes_select" ON public.conta_ajustes_solicitudes
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));

CREATE POLICY "conta_ajustes_eventos_select" ON public.conta_ajustes_eventos
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));

CREATE POLICY "conta_cargo_anulaciones_select" ON public.conta_cargo_anulaciones
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));

CREATE POLICY "pasarela_eventos_select" ON public.pasarela_eventos
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND ((SELECT public.conta_puede_escribir('view')) OR (SELECT public.user_has_permission('platform.contabilidad.view')))));

CREATE POLICY "conta_incidencias_conciliacion_select" ON public.conta_incidencias_conciliacion
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (project_id IS NULL OR public.can_access_project(project_id))));

REVOKE ALL ON public.conta_ajustes_solicitudes, public.conta_ajustes_eventos, public.conta_cargo_anulaciones,
              public.pasarela_eventos, public.conta_incidencias_conciliacion
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_ajustes_solicitudes, public.conta_ajustes_eventos, public.conta_cargo_anulaciones,
                public.pasarela_eventos, public.conta_incidencias_conciliacion
  TO authenticated;
GRANT ALL ON public.conta_ajustes_solicitudes, public.conta_ajustes_eventos, public.conta_cargo_anulaciones,
             public.pasarela_eventos, public.conta_incidencias_conciliacion
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. CONTEXTO DE EJECUCIÓN: lo único que habilita las operaciones del flujo
-- ═══════════════════════════════════════════════════════════════════════════

-- Empresa de la solicitud de `p_tipo` sobre `p_id` que se está ejecutando en
-- ESTA transacción, o NULL. La marca (ejecucion_txid) sólo la escribe
-- conta_ajuste_ejecutar, en una tabla que la aplicación no puede escribir.
CREATE FUNCTION public.conta_ajuste_en_ejecucion(p_tipo text, p_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.company_id FROM public.conta_ajustes_solicitudes s
   WHERE s.ejecucion_txid = txid_current()
     AND s.tipo = p_tipo AND s.documento_id = p_id
   LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_en_ejecucion(text, uuid) FROM PUBLIC, anon, authenticated;

-- Igual, pero lanza si no hay ejecución: la usan las operaciones que antes
-- eran RPC directas.
CREATE FUNCTION public.conta_ajuste_exigir(p_tipo text, p_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid := public.conta_ajuste_en_ejecucion(p_tipo, p_id);
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'AJUSTE_REQUIERE_SOLICITUD: esta operación (%) se solicita con motivo y la ejecuta la aprobación de otra persona (Contabilidad › Solicitudes de ajuste). No se hizo nada.',
      p_tipo USING ERRCODE = '42501';
  END IF;
  RETURN v_company;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_exigir(text, uuid) FROM PUBLIC, anon, authenticated;

-- Bitácora (INTERNA).
CREATE FUNCTION public.conta_ajuste_evento(
  p_sol public.conta_ajustes_solicitudes,
  p_accion text,
  p_anterior text,
  p_nuevo text,
  p_detalle text
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.conta_ajustes_eventos
    (solicitud_id, company_id, project_id, accion, estado_anterior, estado_nuevo, actor, actor_cliente_id, detalle)
  VALUES (p_sol.id, p_sol.company_id, p_sol.project_id, p_accion, p_anterior, p_nuevo, auth.uid(),
          CASE WHEN p_sol.canal = 'portal' AND p_accion IN ('solicitada','cancelada')
               THEN p_sol.solicitado_cliente_id END,
          p_detalle)
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_evento(public.conta_ajustes_solicitudes, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. FOTOGRAFÍA Y REVALIDACIÓN DEL DOCUMENTO
-- ═══════════════════════════════════════════════════════════════════════════

-- Estado relevante del documento. Con p_bloquear, bloquea su fila (y, para
-- una aplicación a un documento, la del documento) en el MISMO orden que las
-- operaciones que el flujo ejecuta: documento primero.
-- Devuelve NULL si no existe en esa empresa y proyecto.
CREATE FUNCTION public.conta_ajuste_foto(
  p_company uuid,
  p_project uuid,
  p_tipo    text,
  p_tabla   text,
  p_id      uuid,
  p_origen  uuid,
  p_bloquear boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ca   public.cargos_adicionales_unidad;
  v_cu   public.cuotas_condominio;
  v_p    public.pagos;
  v_x    public.conta_saldo_favor_aplicaciones;
  v_o    public.conta_saldo_favor_origenes;
  v_s    record;
  v_q    record;
BEGIN
  IF p_tabla = 'cargos_adicionales_unidad' THEN
    IF p_bloquear THEN
      SELECT * INTO v_ca FROM public.cargos_adicionales_unidad ca
       WHERE ca.id = p_id AND ca.company_id = p_company AND ca.project_id = p_project FOR UPDATE;
    ELSE
      SELECT * INTO v_ca FROM public.cargos_adicionales_unidad ca
       WHERE ca.id = p_id AND ca.company_id = p_company AND ca.project_id = p_project;
    END IF;
    IF v_ca.id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(v_ca.id);
    RETURN jsonb_build_object(
      'estado', v_ca.estado, 'monto', v_ca.monto, 'responsable', v_ca.responsable_cliente_id,
      'unidad', v_ca.unidad_id, 'concepto', v_ca.concepto,
      'saldo', CASE WHEN v_s.devengo_monto IS NULL THEN NULL
                    ELSE round(v_s.devengo_monto - v_s.aplicado, 2) END);
  ELSIF p_tabla = 'cuotas_condominio' THEN
    IF p_bloquear THEN
      SELECT * INTO v_cu FROM public.cuotas_condominio c
       WHERE c.id = p_id AND c.company_id = p_company AND c.project_id = p_project FOR UPDATE;
    ELSE
      SELECT * INTO v_cu FROM public.cuotas_condominio c
       WHERE c.id = p_id AND c.company_id = p_company AND c.project_id = p_project;
    END IF;
    IF v_cu.id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_q FROM public.conta_cuota_saldo_cobro(v_cu.id);
    RETURN jsonb_build_object(
      'estado', COALESCE(v_cu.cuota_estado, v_cu.estado), 'monto', v_cu.monto,
      'responsable', v_cu.responsable_cliente_id, 'unidad', v_cu.unidad_id,
      'concepto', v_cu.concepto || ' ' || v_cu.periodo,
      'saldo', CASE WHEN v_q.princ_monto IS NULL THEN NULL
                    ELSE round(COALESCE(v_q.princ_monto, 0) + COALESCE(v_q.mora_monto, 0)
                               - v_q.aplicado_princ - v_q.aplicado_mora, 2) END);
  ELSIF p_tabla = 'pagos' THEN
    IF p_bloquear THEN
      -- Cobro de cargo: el cargo primero (orden de conta_anular_cobro_cargo).
      PERFORM 1 FROM public.cargos_adicionales_unidad ca
       WHERE ca.id = (SELECT p.cargo_adicional_id FROM public.pagos p WHERE p.id = p_id) FOR UPDATE;
      SELECT * INTO v_p FROM public.pagos p WHERE p.id = p_id FOR UPDATE;
    ELSE
      SELECT * INTO v_p FROM public.pagos p WHERE p.id = p_id;
    END IF;
    IF v_p.id IS NULL
       OR v_p.project_id IS DISTINCT FROM p_project
       OR NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = v_p.project_id AND pr.company_id = p_company) THEN
      RETURN NULL;
    END IF;
    IF p_tipo = 'anular_cobro_cargo' AND v_p.cargo_adicional_id IS NULL THEN RETURN NULL; END IF;
    IF p_tipo = 'anular_anticipo'
       AND NOT EXISTS (SELECT 1 FROM public.conta_anticipos an WHERE an.pago_id = v_p.id AND an.company_id = p_company) THEN
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object(
      'estado', v_p.estado, 'monto', v_p.monto, 'responsable', v_p.cliente_id,
      'eliminado', v_p.deleted_at IS NOT NULL, 'cargo', v_p.cargo_adicional_id);
  ELSIF p_tabla = 'conta_saldo_favor_aplicaciones' THEN
    SELECT * INTO v_x FROM public.conta_saldo_favor_aplicaciones x
     WHERE x.id = p_id AND x.company_id = p_company AND x.project_id = p_project;
    IF v_x.id IS NULL THEN RETURN NULL; END IF;
    RETURN jsonb_build_object(
      'estado', CASE WHEN v_x.revertida_at IS NULL THEN 'viva' ELSE 'revertida' END,
      'monto', v_x.monto, 'responsable', v_x.cliente_id, 'origen', v_x.origen_id);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_foto(uuid, uuid, text, text, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;

-- Al aprobar: el documento bloqueado frente a lo que se solicitó. Lanza con
-- un código AJUSTE_* si ya no procede; la ejecución no empieza.
CREATE FUNCTION public.conta_ajuste_revalidar(p_sol public.conta_ajustes_solicitudes)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ahora jsonb;
  v_antes jsonb := p_sol.foto_documento;
  v_disp  numeric(14,2);
  v_o     public.conta_saldo_favor_origenes;
BEGIN
  v_ahora := public.conta_ajuste_foto(p_sol.company_id, p_sol.project_id, p_sol.tipo,
               p_sol.documento_tabla, p_sol.documento_id, p_sol.saldo_origen_id, true);
  IF v_ahora IS NULL THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_INEXISTENTE: el documento ya no existe en esta contabilidad.'
      USING ERRCODE = 'P0002';
  END IF;

  -- PERÍODO. Las anulaciones y reversos se fechan en el período del asiento
  -- original o, si está cerrado, hoy; una aplicación, hoy. Si el período de
  -- hoy está cerrado no hay fecha posible.
  IF public.conta_periodo_cerrado(p_sol.project_id, to_char(CURRENT_DATE, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'AJUSTE_PERIODO_CERRADO: el período % está cerrado; reábrelo o espera al siguiente y reintenta.',
      to_char(CURRENT_DATE, 'YYYY-MM') USING ERRCODE = 'check_violation';
  END IF;

  -- DOCUMENTO: lo aprobado es lo que se vio al solicitar.
  IF (v_antes ->> 'monto') IS DISTINCT FROM (v_ahora ->> 'monto')
     OR (v_antes ->> 'responsable') IS DISTINCT FROM (v_ahora ->> 'responsable') THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el documento cambió después de la solicitud (importe o responsable: % → %). Rechaza esta solicitud y crea otra.',
      COALESCE(v_antes ->> 'monto', '—') || '/' || COALESCE(v_antes ->> 'responsable', '—'),
      COALESCE(v_ahora ->> 'monto', '—') || '/' || COALESCE(v_ahora ->> 'responsable', '—')
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_sol.tipo = 'anular_cargo' AND v_ahora ->> 'estado' = 'anulado' THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el cargo ya está anulado.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_sol.tipo IN ('anular_cobro_cargo','anular_anticipo')
     AND (v_ahora ->> 'estado' = 'rechazado' OR (v_ahora ->> 'eliminado')::boolean) THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el cobro ya está anulado.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_sol.tipo = 'revertir_aplicacion_saldo_favor' AND v_ahora ->> 'estado' = 'revertida' THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: la aplicación ya está revertida.' USING ERRCODE = 'check_violation';
  END IF;

  -- SALDO de una aplicación: disponible del origen y saldo del documento.
  IF p_sol.tipo = 'aplicar_saldo_favor' THEN
    IF v_ahora ->> 'estado' IN ('anulado','anulada','pagado','pagada') THEN
      RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el documento ya no admite aplicaciones (estado: %).', v_ahora ->> 'estado'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_o FROM public.conta_saldo_favor_origenes o WHERE o.id = p_sol.saldo_origen_id;
    v_disp := public.conta_sf_disponible(p_sol.saldo_origen_id);
    IF v_o.id IS NULL OR v_disp IS NULL OR v_disp < p_sol.importe THEN
      RAISE EXCEPTION 'AJUSTE_SALDO_INSUFICIENTE: el saldo a favor disponible (% %) ya no alcanza para aplicar %.',
        COALESCE(v_disp, 0), COALESCE(v_o.moneda, ''), p_sol.importe USING ERRCODE = 'check_violation';
    END IF;
    IF (v_ahora ->> 'saldo') IS NOT NULL AND (v_ahora ->> 'saldo')::numeric < p_sol.importe THEN
      RAISE EXCEPTION 'AJUSTE_SALDO_DOCUMENTO: el documento ahora debe % y la solicitud aplica %. Rechaza esta solicitud y crea otra por el importe correcto.',
        v_ahora ->> 'saldo', p_sol.importe USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN v_ahora;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_revalidar(public.conta_ajustes_solicitudes)
  FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SOLICITAR (back-office)
-- ═══════════════════════════════════════════════════════════════════════════

-- Quién puede solicitar cada tipo: lo mismo que antes se exigía para hacerlo
-- directamente.
CREATE FUNCTION public.conta_ajuste_puede_solicitar(p_tipo text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_tipo IN ('anular_cargo','anular_cobro_cargo','anular_anticipo') THEN
         public.is_super_admin()
      OR public.current_user_role() = ANY (ARRAY['company_owner','admin'])
      OR public.user_has_permission('platform.condominios.edit')
      OR public.conta_puede_escribir('create')
    ELSE public.conta_puede_escribir('create')
  END
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_puede_solicitar(text) FROM PUBLIC, anon, authenticated;

-- Alta común (INTERNA): idempotente por id, fotografía, bitácora.
CREATE FUNCTION public.conta_ajuste_alta(
  p_id        uuid,
  p_company   uuid,
  p_tipo      text,
  p_tabla     text,
  p_doc       uuid,
  p_origen    uuid,
  p_importe   numeric,
  p_motivo    text,
  p_canal     text,
  p_cliente   uuid
)
RETURNS public.conta_ajustes_solicitudes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_existe  public.conta_ajustes_solicitudes;
  v_sol     public.conta_ajustes_solicitudes;
  v_project uuid;
  v_foto    jsonb;
  v_moneda  text;
  v_motivo  text := btrim(COALESCE(p_motivo, ''));
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'AJUSTE_CLAVE: falta la clave de la solicitud.' USING ERRCODE = '22023';
  END IF;
  IF length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'AJUSTE_MOTIVO: indica el motivo (al menos 5 caracteres).' USING ERRCODE = '22023';
  END IF;

  -- Proyecto del documento, dentro de la empresa. Ajeno = inexistente.
  v_project := CASE p_tabla
    WHEN 'cargos_adicionales_unidad' THEN (SELECT ca.project_id FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_doc AND ca.company_id = p_company)
    WHEN 'cuotas_condominio' THEN (SELECT c.project_id FROM public.cuotas_condominio c WHERE c.id = p_doc AND c.company_id = p_company)
    WHEN 'pagos' THEN (SELECT p.project_id FROM public.pagos p JOIN public.projects pr ON pr.id = p.project_id
                        WHERE p.id = p_doc AND pr.company_id = p_company)
    WHEN 'conta_saldo_favor_aplicaciones' THEN (SELECT x.project_id FROM public.conta_saldo_favor_aplicaciones x WHERE x.id = p_doc AND x.company_id = p_company)
  END;
  IF v_project IS NULL OR (p_canal = 'backoffice' AND NOT public.can_access_project(v_project)) THEN
    RAISE EXCEPTION 'El documento no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;

  v_foto := public.conta_ajuste_foto(p_company, v_project, p_tipo, p_tabla, p_doc, p_origen, false);
  IF v_foto IS NULL THEN
    RAISE EXCEPTION 'El documento no existe, no es del tipo pedido o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;

  IF p_tipo = 'aplicar_saldo_favor' THEN
    SELECT o.moneda INTO v_moneda FROM public.conta_saldo_favor_origenes o
     WHERE o.id = p_origen AND o.company_id = p_company AND o.project_id = v_project;
    IF v_moneda IS NULL THEN
      RAISE EXCEPTION 'El saldo a favor no existe o no es de esta contabilidad.' USING ERRCODE = 'P0002';
    END IF;
    IF p_importe IS NULL OR p_importe <= 0 OR p_importe <> round(p_importe, 2) THEN
      RAISE EXCEPTION 'AJUSTE_IMPORTE: el importe debe ser positivo y con dos decimales como máximo.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- IDEMPOTENCIA: la misma clave con los mismos datos devuelve la solicitud;
  -- con otros, se rechaza sin tocar nada.
  SELECT * INTO v_existe FROM public.conta_ajustes_solicitudes s WHERE s.id = p_id;
  IF v_existe.id IS NOT NULL THEN
    IF v_existe.company_id IS DISTINCT FROM p_company
       OR v_existe.tipo IS DISTINCT FROM p_tipo
       OR v_existe.documento_id IS DISTINCT FROM p_doc
       OR v_existe.saldo_origen_id IS DISTINCT FROM p_origen
       OR (p_tipo = 'aplicar_saldo_favor' AND v_existe.importe IS DISTINCT FROM p_importe)
       OR v_existe.motivo IS DISTINCT FROM v_motivo
       OR v_existe.solicitado_por IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'AJUSTE_CLAVE_REUSADA: esa clave ya identifica otra solicitud. No se registró nada.'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existe;
  END IF;

  BEGIN
    INSERT INTO public.conta_ajustes_solicitudes (
      id, company_id, project_id, tipo, documento_tabla, documento_id, saldo_origen_id,
      importe, moneda, motivo, canal, solicitado_por, solicitado_cliente_id, foto_documento)
    VALUES (
      p_id, p_company, v_project, p_tipo, p_tabla, p_doc, p_origen,
      CASE WHEN p_tipo = 'aplicar_saldo_favor' THEN p_importe
           ELSE (v_foto ->> 'monto')::numeric(14,2) END,
      v_moneda, v_motivo, p_canal, auth.uid(), p_cliente, v_foto)
    RETURNING * INTO v_sol;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'AJUSTE_YA_SOLICITADO: ya hay una solicitud abierta (pendiente o fallida) para este documento. Resuélvela antes de pedir otra.'
      USING ERRCODE = '23505';
  END;

  PERFORM public.conta_ajuste_evento(v_sol, 'solicitada', NULL, 'pendiente', v_motivo);
  RETURN v_sol;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_alta(uuid, uuid, text, text, uuid, uuid, numeric, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.conta_ajuste_solicitar(
  p_id              uuid,
  p_tipo            text,
  p_documento_tabla text,
  p_documento_id    uuid,
  p_motivo          text,
  p_saldo_origen_id uuid DEFAULT NULL,
  p_importe         numeric DEFAULT NULL
)
RETURNS TABLE (solicitud_id uuid, estado text, repetida boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_sol     public.conta_ajustes_solicitudes;
  v_previa  boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('anular_cargo','anular_cobro_cargo','anular_anticipo',
                                      'revertir_aplicacion_saldo_favor','aplicar_saldo_favor') THEN
    RAISE EXCEPTION 'AJUSTE_TIPO: tipo de solicitud inválido: %', p_tipo USING ERRCODE = '22023';
  END IF;
  IF NOT public.conta_ajuste_puede_solicitar(p_tipo) THEN
    RAISE EXCEPTION 'No autorizado para solicitar este ajuste.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(v_company);

  v_previa := EXISTS (SELECT 1 FROM public.conta_ajustes_solicitudes s WHERE s.id = p_id);
  v_sol := public.conta_ajuste_alta(p_id, v_company, p_tipo, p_documento_tabla, p_documento_id,
                                    p_saldo_origen_id, p_importe, p_motivo, 'backoffice', NULL);
  RETURN QUERY SELECT v_sol.id, v_sol.estado, v_previa;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_solicitar(uuid, text, text, uuid, text, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_solicitar(uuid, text, text, uuid, text, uuid, numeric) TO authenticated;

COMMENT ON FUNCTION public.conta_ajuste_solicitar(uuid, text, text, uuid, text, uuid, numeric) IS
  'Solicita un ajuste con motivo (anular un cargo o un cobro de cargo, anular un anticipo, revertir o aplicar un saldo a favor). No cambia nada: lo ejecuta la aprobación de otra persona. Idempotente por p_id; una solicitud abierta por documento.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. EJECUTAR (INTERNA): en una subtransacción, con el contexto puesto
-- ═══════════════════════════════════════════════════════════════════════════
-- Devuelve la solicitud ya en «ejecutada» o «fallida». Una falla deshace TODO
-- lo que la ejecución hubiera escrito (el bloque con EXCEPTION es un
-- savepoint) y deja el motivo del servidor.
CREATE FUNCTION public.conta_ajuste_ejecutar(p_sol public.conta_ajustes_solicitudes, p_accion text)
RETURNS public.conta_ajustes_solicitudes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sol   public.conta_ajustes_solicitudes := p_sol;
  v_res   jsonb;
  v_rev   uuid;
  v_err   text;
  v_prev  text := p_sol.estado;
BEGIN
  UPDATE public.conta_ajustes_solicitudes s
     SET intentos_ejecucion = s.intentos_ejecucion + 1, updated_at = now()
   WHERE s.id = v_sol.id;

  BEGIN
    UPDATE public.conta_ajustes_solicitudes s SET ejecucion_txid = txid_current() WHERE s.id = v_sol.id;

    PERFORM public.conta_ajuste_revalidar(v_sol);

    IF v_sol.tipo = 'anular_cargo' THEN
      -- El trigger del cargo reversa su devengo (si lo tenía); la evidencia
      -- se escribe después, con el reverso ya hecho.
      UPDATE public.cargos_adicionales_unidad ca SET estado = 'anulado' WHERE ca.id = v_sol.documento_id;
      SELECT a.anulado_por_id INTO v_rev FROM public.conta_asientos a
       WHERE a.company_id = v_sol.company_id AND a.origen = 'automatico'
         AND a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = v_sol.documento_id
         AND a.origen_evento = 'cargo_adicional_emitido'
       ORDER BY a.created_at DESC LIMIT 1;
      INSERT INTO public.conta_cargo_anulaciones
        (cargo_id, company_id, project_id, solicitud_id, anulado_por, motivo, tenia_asiento, reverso_id)
      VALUES (v_sol.documento_id, v_sol.company_id, v_sol.project_id, v_sol.id, auth.uid(), v_sol.motivo,
              EXISTS (SELECT 1 FROM public.conta_asientos a
                       WHERE a.company_id = v_sol.company_id AND a.origen = 'automatico'
                         AND a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = v_sol.documento_id
                         AND a.origen_evento = 'cargo_adicional_emitido'),
              v_rev);
      SELECT to_jsonb(an) INTO v_res FROM public.conta_cargo_anulaciones an WHERE an.cargo_id = v_sol.documento_id;
    ELSIF v_sol.tipo = 'anular_cobro_cargo' THEN
      SELECT to_jsonb(r) INTO v_res FROM public.conta_anular_cobro_cargo(v_sol.documento_id, v_sol.motivo) r;
    ELSIF v_sol.tipo = 'anular_anticipo' THEN
      SELECT to_jsonb(r) INTO v_res FROM public.conta_anular_anticipo(v_sol.documento_id, v_sol.motivo) r;
    ELSIF v_sol.tipo = 'revertir_aplicacion_saldo_favor' THEN
      SELECT to_jsonb(r) INTO v_res FROM public.conta_revertir_aplicacion_saldo_favor(v_sol.documento_id, v_sol.motivo) r;
    ELSIF v_sol.tipo = 'aplicar_saldo_favor' THEN
      -- La aplicación usa el id de la solicitud como su clave: un reintento
      -- después de un éxito que no alcanzó a sellarse no aplica dos veces.
      SELECT to_jsonb(r) INTO v_res
        FROM public.conta_aplicar_saldo_favor(v_sol.saldo_origen_id, v_sol.documento_tabla, v_sol.documento_id,
                                              v_sol.importe, 'Solicitud ' || v_sol.id::text || ': ' || v_sol.motivo,
                                              v_sol.id) r;
    END IF;

    UPDATE public.conta_ajustes_solicitudes s
       SET estado = 'ejecutada', ejecutado_at = now(), resultado = COALESCE(v_res, '{}'::jsonb),
           error_ejecucion = NULL, ejecucion_txid = NULL, updated_at = now()
     WHERE s.id = v_sol.id
    RETURNING * INTO v_sol;
    PERFORM public.conta_ajuste_evento(v_sol, 'ejecutada', v_prev, 'ejecutada', NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    UPDATE public.conta_ajustes_solicitudes s
       SET estado = 'fallida', error_ejecucion = v_err, ejecucion_txid = NULL, updated_at = now()
     WHERE s.id = v_sol.id
    RETURNING * INTO v_sol;
    PERFORM public.conta_ajuste_evento(v_sol, 'fallida', v_prev, 'fallida', v_err);
  END;
  RETURN v_sol;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_ejecutar(public.conta_ajustes_solicitudes, text)
  FROM PUBLIC, anon, authenticated;

-- Autorización de quien revisa (aprobar, rechazar, reintentar): empresa de la
-- sesión, permiso de aprobar en Contabilidad y la solicitud bloqueada.
CREATE FUNCTION public.conta_ajuste_bloquear_para_revision(p_id uuid)
RETURNS public.conta_ajustes_solicitudes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_sol     public.conta_ajustes_solicitudes;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.conta_puede_escribir('approve') THEN
    RAISE EXCEPTION 'No autorizado: aprobar o rechazar ajustes requiere «Autorizar / Denegar» en Contabilidad.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sol FROM public.conta_ajustes_solicitudes s
   WHERE s.id = p_id AND s.company_id = v_company AND public.can_access_project(s.project_id)
     FOR UPDATE;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_sol.company_id);
  RETURN v_sol;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_bloquear_para_revision(uuid) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. APROBAR (y ejecutar), RECHAZAR, CANCELAR, REINTENTAR
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.conta_ajuste_aprobar(
  p_id                        uuid,
  p_nota                      text DEFAULT NULL,
  p_confirmar_autoaprobacion  boolean DEFAULT false
)
RETURNS TABLE (solicitud_id uuid, estado text, repetida boolean, autoaprobada boolean,
               resultado jsonb, error_ejecucion text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sol  public.conta_ajustes_solicitudes;
  v_auto boolean := false;
BEGIN
  v_sol := public.conta_ajuste_bloquear_para_revision(p_id);

  -- Doble clic / dos sesiones: la segunda entra cuando la primera ya
  -- confirmó y ve el resultado. No ejecuta otra vez.
  IF v_sol.estado = 'ejecutada' THEN
    RETURN QUERY SELECT v_sol.id, v_sol.estado, true, v_sol.autoaprobada, v_sol.resultado, v_sol.error_ejecucion;
    RETURN;
  END IF;
  IF v_sol.estado = 'fallida' THEN
    RAISE EXCEPTION 'AJUSTE_ESTADO: la solicitud ya se aprobó y su ejecución falló (%). Usa «Reintentar» o recházala.',
      v_sol.error_ejecucion USING ERRCODE = 'check_violation';
  END IF;
  IF v_sol.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'AJUSTE_ESTADO: la solicitud está % y ya no se puede aprobar.', v_sol.estado
      USING ERRCODE = 'check_violation';
  END IF;

  -- E1: cuatro ojos. Sólo el company_owner se autoaprueba, y confirmándolo.
  IF v_sol.solicitado_por = auth.uid() THEN
    IF public.current_user_role() IS DISTINCT FROM 'company_owner' THEN
      RAISE EXCEPTION 'AJUSTE_AUTOAPROBACION_NO_PERMITIDA: quien solicita un ajuste no lo aprueba; debe aprobarlo otra persona con permiso.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(p_confirmar_autoaprobacion, false) THEN
      RAISE EXCEPTION 'AJUSTE_AUTOAPROBACION_SIN_CONFIRMAR: vas a aprobar tu propia solicitud. Confírmalo explícitamente; quedará registrado como autoaprobación.'
        USING ERRCODE = '42501';
    END IF;
    v_auto := true;
  END IF;

  UPDATE public.conta_ajustes_solicitudes s
     SET revisado_por = auth.uid(), revisado_at = now(),
         motivo_revision = NULLIF(btrim(COALESCE(p_nota, '')), ''),
         autoaprobada = v_auto, updated_at = now()
   WHERE s.id = v_sol.id
  RETURNING * INTO v_sol;
  PERFORM public.conta_ajuste_evento(v_sol, CASE WHEN v_auto THEN 'autoaprobada' ELSE 'aprobada' END,
    'pendiente', 'pendiente', NULLIF(btrim(COALESCE(p_nota, '')), ''));

  v_sol := public.conta_ajuste_ejecutar(v_sol, 'aprobar');
  RETURN QUERY SELECT v_sol.id, v_sol.estado, false, v_sol.autoaprobada, v_sol.resultado, v_sol.error_ejecucion;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_aprobar(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_aprobar(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.conta_ajuste_aprobar(uuid, text, boolean) IS
  'Aprueba una solicitud de ajuste y la ejecuta en la misma transacción, revalidando documento, período y saldo con el documento bloqueado. Quien solicita no aprueba (E1); sólo el company_owner puede autoaprobarse, con p_confirmar_autoaprobacion = true, y queda marcado. Repetirla devuelve el resultado sin ejecutar otra vez. Si la ejecución falla no queda nada escrito y la solicitud queda «fallida».';

CREATE FUNCTION public.conta_ajuste_reintentar(p_id uuid)
RETURNS TABLE (solicitud_id uuid, estado text, resultado jsonb, error_ejecucion text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sol public.conta_ajustes_solicitudes;
BEGIN
  v_sol := public.conta_ajuste_bloquear_para_revision(p_id);
  IF v_sol.estado = 'ejecutada' THEN
    RETURN QUERY SELECT v_sol.id, v_sol.estado, v_sol.resultado, v_sol.error_ejecucion;
    RETURN;
  END IF;
  IF v_sol.estado <> 'fallida' THEN
    RAISE EXCEPTION 'AJUSTE_ESTADO: sólo se reintenta una solicitud aprobada cuya ejecución falló (está %).', v_sol.estado
      USING ERRCODE = 'check_violation';
  END IF;
  -- Reintentar no es aprobar: quien solicitó no puede reintentar su propia
  -- solicitud salvo que sea quien la autoaprobó (company_owner).
  IF v_sol.solicitado_por = auth.uid() AND NOT v_sol.autoaprobada THEN
    RAISE EXCEPTION 'AJUSTE_AUTOAPROBACION_NO_PERMITIDA: quien solicitó el ajuste no ejecuta su reintento.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.conta_ajuste_evento(v_sol, 'reintento', 'fallida', 'fallida', v_sol.error_ejecucion);
  v_sol := public.conta_ajuste_ejecutar(v_sol, 'reintentar');
  RETURN QUERY SELECT v_sol.id, v_sol.estado, v_sol.resultado, v_sol.error_ejecucion;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_reintentar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_reintentar(uuid) TO authenticated;

CREATE FUNCTION public.conta_ajuste_rechazar(p_id uuid, p_motivo text)
RETURNS TABLE (solicitud_id uuid, estado text, repetida boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sol  public.conta_ajustes_solicitudes;
  v_prev text;
BEGIN
  IF length(btrim(COALESCE(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'AJUSTE_MOTIVO: indica por qué se rechaza (al menos 5 caracteres).' USING ERRCODE = '22023';
  END IF;
  v_sol := public.conta_ajuste_bloquear_para_revision(p_id);
  IF v_sol.estado = 'rechazada' THEN
    RETURN QUERY SELECT v_sol.id, v_sol.estado, true;
    RETURN;
  END IF;
  IF v_sol.estado NOT IN ('pendiente','fallida') THEN
    RAISE EXCEPTION 'AJUSTE_ESTADO: la solicitud está % y ya no se puede rechazar.', v_sol.estado
      USING ERRCODE = 'check_violation';
  END IF;
  v_prev := v_sol.estado;
  UPDATE public.conta_ajustes_solicitudes s
     SET estado = 'rechazada', revisado_por = COALESCE(s.revisado_por, auth.uid()),
         revisado_at = COALESCE(s.revisado_at, now()),
         motivo_revision = btrim(p_motivo), updated_at = now()
   WHERE s.id = v_sol.id
  RETURNING * INTO v_sol;
  PERFORM public.conta_ajuste_evento(v_sol, 'rechazada', v_prev, 'rechazada', btrim(p_motivo));
  RETURN QUERY SELECT v_sol.id, v_sol.estado, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_rechazar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_rechazar(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.conta_ajuste_rechazar(uuid, text) IS
  'Rechaza con motivo una solicitud pendiente o fallida: no cambia ningún documento. Requiere permiso de aprobar. Idempotente.';

-- Cancelar: sólo quien la solicitó (usuario o cliente del portal), mientras
-- nadie la haya aprobado.
CREATE FUNCTION public.conta_ajuste_cancelar(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS TABLE (solicitud_id uuid, estado text, repetida boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sol public.conta_ajustes_solicitudes;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sol FROM public.conta_ajustes_solicitudes s
   WHERE s.id = p_id AND s.solicitado_por = auth.uid()
     FOR UPDATE;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no existe o no es tuya.' USING ERRCODE = 'P0002';
  END IF;
  IF v_sol.estado = 'cancelada' THEN
    RETURN QUERY SELECT v_sol.id, v_sol.estado, true;
    RETURN;
  END IF;
  IF v_sol.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'AJUSTE_ESTADO: la solicitud está % y ya no se puede cancelar.', v_sol.estado
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.conta_ajustes_solicitudes s
     SET estado = 'cancelada', updated_at = now()
   WHERE s.id = v_sol.id
  RETURNING * INTO v_sol;
  PERFORM public.conta_ajuste_evento(v_sol, 'cancelada', 'pendiente', 'cancelada', NULLIF(btrim(COALESCE(p_motivo, '')), ''));
  RETURN QUERY SELECT v_sol.id, v_sol.estado, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_cancelar(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.conta_ajuste_cancelar(uuid, text) IS
  'Cancela una solicitud pendiente. Sólo quien la solicitó (también el residente desde el portal). Idempotente.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. LAS OPERACIONES DEL FLUJO YA NO SE INVOCAN SUELTAS
-- ═══════════════════════════════════════════════════════════════════════════
-- Cuerpos idénticos a los de 20261004000000 (anular cobro de cargo) y
-- 20261007000000 (anular anticipo, revertir aplicación) salvo la primera
-- línea: en lugar del permiso de quien llama, exigen la solicitud aprobada en
-- ejecución (conta_ajuste_exigir). Invocadas directamente responden
-- AJUSTE_REQUIERE_SOLICITUD y no hacen nada.
CREATE OR REPLACE FUNCTION public.conta_anular_cobro_cargo(
  p_pago_id uuid,
  p_motivo  text
)
RETURNS TABLE (
  pago_id          uuid,
  resultado        text,
  asiento_id       uuid,
  reverso_id       uuid,
  reverso_numero   bigint,
  estado_cargo     text,
  cobros_pendientes bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company  uuid;
  v_cargo_id uuid;
  v_cargo    public.cargos_adicionales_unidad;
  v_pago     public.pagos;
  v_res      text;
BEGIN
  -- 20261011000000: sólo dentro de una solicitud aprobada en ejecución.
  v_company := public.conta_ajuste_exigir('anular_cobro_cargo', p_pago_id);
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo de la anulación.' USING ERRCODE = '22023';
  END IF;

  SELECT p.cargo_adicional_id INTO v_cargo_id FROM public.pagos p WHERE p.id = p_pago_id;
  -- Orden: cargo → pago.
  SELECT * INTO v_cargo FROM public.cargos_adicionales_unidad ca
   WHERE ca.id = v_cargo_id AND ca.company_id = v_company
     AND public.can_access_project(ca.project_id)
     FOR UPDATE;
  IF v_cargo.id IS NULL THEN
    RAISE EXCEPTION 'El cobro no existe, no es de un cargo adicional o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_cargo.company_id);

  SELECT * INTO v_pago FROM public.pagos p WHERE p.id = p_pago_id FOR UPDATE;

  IF v_pago.estado = 'rechazado' OR v_pago.deleted_at IS NOT NULL THEN
    v_res := 'ya_anulado';
  ELSE
    PERFORM set_config('conta.cobro_cargo_pago', v_pago.id::text, true);
    UPDATE public.pagos p
       SET estado = 'rechazado', verification_status = 'rechazado',
           verification_notes = btrim(p_motivo), updated_at = now()
     WHERE p.id = v_pago.id;
    PERFORM set_config('conta.cobro_cargo_pago', '', true);
    v_res := 'anulado';
  END IF;

  RETURN QUERY
  SELECT v_pago.id, v_res, a.id, r.id, r.numero::bigint,
         (SELECT ca.estado FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_cargo.id),
         (SELECT count(*) FROM public.pagos p
           WHERE p.cargo_adicional_id = v_cargo.id AND p.deleted_at IS NULL
             AND p.estado IN ('verificado','aplicado')
             AND NOT EXISTS (SELECT 1 FROM public.conta_asientos x
                              WHERE x.company_id = v_company AND x.origen = 'automatico'
                                AND x.origen_tabla = 'pagos' AND x.origen_id = p.id
                                AND x.origen_evento = 'pago_contabilizado'))
    FROM (SELECT 1) uno
    LEFT JOIN public.conta_asientos a
      ON a.company_id = v_company AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id AND a.origen_evento = 'pago_contabilizado'
    LEFT JOIN public.conta_asientos r ON r.id = a.anulado_por_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.conta_anular_anticipo(p_pago_id uuid, p_motivo text)
RETURNS TABLE (
  pago_id        uuid,
  resultado      text,
  asiento_id     uuid,
  reverso_id     uuid,
  reverso_numero bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_pago    public.pagos;
  v_res     text;
BEGIN
  -- 20261011000000: sólo dentro de una solicitud aprobada en ejecución.
  v_company := public.conta_ajuste_exigir('anular_anticipo', p_pago_id);
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo de la anulación.' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_pago
    FROM public.pagos p
    JOIN public.conta_anticipos an ON an.pago_id = p.id
   WHERE p.id = p_pago_id AND an.company_id = v_company AND public.can_access_project(an.project_id)
     FOR UPDATE OF p;
  IF v_pago.id IS NULL THEN
    RAISE EXCEPTION 'El anticipo no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_company);

  IF v_pago.estado = 'rechazado' OR v_pago.deleted_at IS NOT NULL THEN
    v_res := 'ya_anulado';
  ELSE
    PERFORM set_config('conta.anticipo_pago', v_pago.id::text, true);
    UPDATE public.pagos p
       SET estado = 'rechazado', verification_status = 'rechazado',
           verification_notes = btrim(p_motivo), updated_at = now()
     WHERE p.id = v_pago.id;
    PERFORM set_config('conta.anticipo_pago', '', true);
    v_res := 'anulado';
  END IF;

  RETURN QUERY
  SELECT v_pago.id, v_res, a.id, r.id, r.numero::bigint
    FROM (SELECT 1) uno
    LEFT JOIN public.conta_asientos a
      ON a.company_id = v_company AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id AND a.origen_evento = 'pago_contabilizado'
    LEFT JOIN public.conta_asientos r ON r.id = a.anulado_por_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.conta_revertir_aplicacion_saldo_favor(p_aplicacion_id uuid, p_motivo text)
RETURNS TABLE (
  aplicacion_id       uuid,
  resultado           text,
  reverso_id          uuid,
  reverso_numero      bigint,
  disponible_restante numeric,
  estado_documento    text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_x       public.conta_saldo_favor_aplicaciones;
  v_rev     uuid;
  v_res     text;
BEGIN
  -- 20261011000000: sólo dentro de una solicitud aprobada en ejecución.
  v_company := public.conta_ajuste_exigir('revertir_aplicacion_saldo_favor', p_aplicacion_id);
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo de la reversión.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_x FROM public.conta_saldo_favor_aplicaciones x
   WHERE x.id = p_aplicacion_id AND x.company_id = v_company AND public.can_access_project(x.project_id);
  IF v_x.id IS NULL THEN
    RAISE EXCEPTION 'La aplicación no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_x.company_id);

  -- Mismo orden que la aplicación: documento → cobro de origen → candados.
  IF v_x.cuota_id IS NOT NULL THEN
    PERFORM 1 FROM public.cuotas_condominio c WHERE c.id = v_x.cuota_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_x.cargo_adicional_id FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.pagos p WHERE p.id = v_x.pago_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(
    hashtext(CASE WHEN v_x.cuota_id IS NOT NULL THEN 'conta_cobro_cuota' ELSE 'conta_cobro_cargo' END),
    hashtext(COALESCE(v_x.cuota_id, v_x.cargo_adicional_id)::text));
  PERFORM pg_advisory_xact_lock(hashtext('conta_saldo_favor'), hashtext(v_x.origen_id::text));

  -- Releída bajo los bloqueos: la reversión se decide una vez.
  SELECT * INTO v_x FROM public.conta_saldo_favor_aplicaciones x WHERE x.id = p_aplicacion_id;
  IF v_x.revertida_at IS NOT NULL THEN
    v_res := 'ya_revertida';
    v_rev := v_x.asiento_reverso_id;
  ELSE
    -- Si su asiento ya se reversó desde Pólizas, ese reverso es el suyo: se
    -- sella la evidencia sin reversar dos veces.
    SELECT a.anulado_por_id INTO v_rev FROM public.conta_asientos a WHERE a.id = v_x.asiento_id;
    IF v_rev IS NULL THEN
      v_rev := public.conta_reversar_automatico(v_x.company_id, 'conta_saldo_favor_aplicaciones', v_x.id,
        'saldo_favor_aplicado', 'Reverso de aplicación de saldo a favor');
    END IF;
    IF v_rev IS NULL THEN
      RAISE EXCEPTION 'SALDO_FAVOR_SIN_REVERSO: no se pudo reversar el asiento de la aplicación. No se revirtió nada.'
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.conta_saldo_favor_aplicaciones x
       SET revertida_at = now(), revertida_por = auth.uid(), motivo_reverso = btrim(p_motivo),
           asiento_reverso_id = v_rev
     WHERE x.id = v_x.id;
    v_res := 'revertida';
  END IF;

  IF v_x.cargo_adicional_id IS NOT NULL THEN
    PERFORM public.conta_cargo_sincronizar_estado(v_x.cargo_adicional_id);
  END IF;

  RETURN QUERY SELECT v_x.id, v_res, v_rev, (SELECT a.numero::bigint FROM public.conta_asientos a WHERE a.id = v_rev),
    public.conta_sf_disponible(v_x.origen_id),
    CASE WHEN v_x.cargo_adicional_id IS NOT NULL
         THEN (SELECT ca.estado FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_x.cargo_adicional_id)
         ELSE (SELECT COALESCE(c.cuota_estado, c.estado) FROM public.cuotas_condominio c WHERE c.id = v_x.cuota_id) END;
END;
$$;


COMMENT ON FUNCTION public.conta_anular_cobro_cargo(uuid, text) IS
  'Anula (rechaza con motivo) un cobro de cargo adicional. Desde 20261011000000 sólo la ejecuta una solicitud de ajuste aprobada (conta_ajuste_aprobar); invocada directamente responde AJUSTE_REQUIERE_SOLICITUD.';
COMMENT ON FUNCTION public.conta_anular_anticipo(uuid, text) IS
  'Anula un anticipo sin deuda. Desde 20261011000000 sólo la ejecuta una solicitud de ajuste aprobada; invocada directamente responde AJUSTE_REQUIERE_SOLICITUD.';
COMMENT ON FUNCTION public.conta_revertir_aplicacion_saldo_favor(uuid, text) IS
  'Revierte una aplicación de saldo a favor. Desde 20261011000000 sólo la ejecuta una solicitud de ajuste aprobada; invocada directamente responde AJUSTE_REQUIERE_SOLICITUD.';

-- Autorización de las operaciones de saldo a favor: dentro de una aplicación
-- aprobada en ejecución basta el permiso de aprobar. Fuera, igual que antes.
CREATE OR REPLACE FUNCTION public.conta_sf_autorizar(p_accion text)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_company uuid;
BEGIN
  IF p_accion = 'anticipo' OR p_accion = 'leer' THEN
    RETURN public.conta_cobro_cargo_autorizar(p_accion = 'anticipo');
  END IF;
  IF p_accion <> 'aplicar' THEN
    RAISE EXCEPTION 'conta_sf_autorizar: acción inválida %', p_accion USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  -- 20261011000000: dentro de una solicitud aprobada en ejecución, el permiso
  -- es el de aprobar, que ya se comprobó (conta_ajuste_aprobar).
  IF EXISTS (SELECT 1 FROM public.conta_ajustes_solicitudes s
              WHERE s.ejecucion_txid = txid_current() AND s.company_id = v_company
                AND s.tipo = 'aplicar_saldo_favor') THEN
    RETURN v_company;
  END IF;
  IF NOT (public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status')) THEN
    RAISE EXCEPTION 'No autorizado para aplicar o revertir saldos a favor: requiere crear y cambiar estado en Contabilidad.'
      USING ERRCODE = '42501';
  END IF;
  RETURN v_company;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. CARGOS ADICIONALES: la anulación sólo por solicitud; nunca se borran
-- ═══════════════════════════════════════════════════════════════════════════
-- BEFORE, y su nombre ordena después de trg_cargo_cobros_guard: con cobros
-- vivos manda el motivo de negocio (CARGO_CON_COBROS).
CREATE FUNCTION public.conta_tg_cargo_solo_por_solicitud()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- El borrado en cascada de una empresa o un proyecto (llega desde el
    -- trigger de la FK, nivel > 1) no es una anulación: se permite.
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'CARGO_NO_SE_BORRA: un cargo adicional es un documento; se anula con una solicitud de ajuste aprobada, no se borra.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado = 'anulado' AND OLD.estado IS DISTINCT FROM 'anulado' THEN
    IF public.conta_ajuste_en_ejecucion('anular_cargo', NEW.id) IS NULL THEN
      RAISE EXCEPTION 'CARGO_ANULACION_SOLO_POR_SOLICITUD: la anulación de un cargo adicional se solicita con motivo y la ejecuta la aprobación de otra persona. No se anuló.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.estado = 'anulado' AND NEW.estado IS DISTINCT FROM 'anulado' THEN
    -- Su devengo ya se reversó y no se recrea: reactivarlo dejaría un cargo
    -- vivo sin asiento.
    RAISE EXCEPTION 'CARGO_ANULADO_DEFINITIVO: un cargo anulado no se reactiva; emite un cargo nuevo.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_cargo_solo_por_solicitud() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cargo_solo_por_solicitud
  BEFORE UPDATE OF estado OR DELETE ON public.cargos_adicionales_unidad
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_cargo_solo_por_solicitud();

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. ESTADO DE CUENTA: la anulación con evidencia tiene fecha
-- ═══════════════════════════════════════════════════════════════════════════
-- Cuerpos idénticos a 20261006000000 salvo:
--   · conta_ec_fuera_de_saldo: un cargo anulado con evidencia deja de estar
--     vigente en la fecha de su anulación (o_cancel), tenga o no asiento; el
--     que no la tiene sigue dependiendo del registro de su reverso.
--   · conta_ec_limitaciones: `anulacion_sin_fecha` excluye los cargos con
--     evidencia. Los anulados antes de 20261011000000 siguen contando.
CREATE OR REPLACE FUNCTION public.conta_ec_fuera_de_saldo(
  p_company uuid,
  p_project uuid,
  p_cliente uuid,
  p_unidad  uuid,
  p_hasta   date
)
RETURNS TABLE (
  clase          text,
  naturaleza     text,
  origen_tabla   text,
  origen_id      uuid,
  evento         text,
  fecha          date,
  concepto       text,
  tipo_cargo     text,
  unidad_id      uuid,
  responsable_id uuid,
  monto          numeric,
  estado_actual  text,
  codigo         text,
  motivo         text,
  asiento_id     uuid,
  asiento_numero bigint,
  asiento_fecha  date,
  limitacion     text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH par AS (
    SELECT COALESCE(p_hasta, 'infinity'::date) AS h,
           (p_hasta IS NOT NULL AND p_hasta < CURRENT_DATE) AS historico
  ),
  cu AS (
    SELECT c.*,
           EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id) AS por_tipo,
           LEAST(c.deleted_at, c.anulada_at) AS cancelado_at
      FROM public.cuotas_condominio c
     WHERE c.company_id = p_company AND c.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR c.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR c.responsable_cliente_id = p_cliente)
  ),
  ca AS (
    SELECT x.*,
           EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = x.id) AS por_tipo,
           -- Fecha real de la anulación (20261011000000), si la hay.
           (SELECT an.anulado_at FROM public.conta_cargo_anulaciones an WHERE an.cargo_id = x.id) AS anulado_at
      FROM public.cargos_adicionales_unidad x
     WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)
  ),
  -- Eventos: devengos de cuota, mora y cargo adicional; y cobros de cuotas.
  -- o_cancel = cuándo dejó de estar vigente, si se sabe por el documento.
  -- o_cancel_por_reverso = el documento está anulado/rechazado hoy y su fecha
  -- sólo se conoce por el registro del reverso de su asiento.
  ev AS (
    SELECT 'cuotas_condominio'::text AS o_tabla, c.id AS o_id, 'cuota_emitida'::text AS o_evento,
           'cargo'::text AS o_nat,
           c.created_at::date AS o_fecha, c.concepto || ' ' || c.periodo AS o_concepto,
           c.tipo_cargo AS o_tipo, c.unidad_id AS o_unidad, c.responsable_cliente_id AS o_resp,
           c.monto AS o_monto, c.estado AS o_estado, c.por_tipo AS o_por_tipo,
           c.cancelado_at AS o_cancel, false AS o_cancel_por_reverso,
           false AS o_hist
      FROM cu c WHERE COALESCE(c.monto, 0) > 0
    UNION ALL
    SELECT 'cuotas_condominio', c.id, 'cuota_mora', 'cargo',
           public.conta_fecha_evento_cargo('cuotas_condominio', c.id, 'cuota_mora'),
           'Mora · ' || c.concepto || ' ' || c.periodo,
           'recargo_mora', c.unidad_id, c.responsable_cliente_id,
           c.mora_monto, c.estado, c.por_tipo, c.cancelado_at, false, false
      FROM cu c WHERE COALESCE(c.mora_monto, 0) > 0
    UNION ALL
    SELECT 'cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido', 'cargo', x.fecha_cargo, x.concepto,
           public.conta_tipo_cargo_de_documento('cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido'),
           x.unidad_id, x.responsable_cliente_id, x.monto, x.estado, x.por_tipo,
           -- Con evidencia (20261011000000), la anulación tiene fecha propia,
           -- con o sin asiento. Sin ella, sólo la del registro del reverso.
           CASE WHEN x.estado = 'anulado' THEN x.anulado_at END,
           x.estado = 'anulado' AND x.anulado_at IS NULL, false
      FROM ca x WHERE COALESCE(x.monto, 0) > 0
    UNION ALL
    SELECT * FROM (
      SELECT DISTINCT ON (p.id)
             'pagos'::text, p.id, 'pago_contabilizado'::text, 'abono'::text,
             COALESCE(p.verified_at, p.created_at)::date,
             'Pago ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '') || ' · ' || c.concepto || ' ' || c.periodo,
             c.tipo_cargo, c.unidad_id, c.responsable_cliente_id, p.monto, p.estado, c.por_tipo,
             -- el cobro de una cuota anulada deja de estar vigente con ella
             LEAST(p.deleted_at, c.cancelado_at), p.estado = 'rechazado',
             hs.o_hist
        FROM cu c
        JOIN public.pagos p ON (p.cuota_id = c.id OR c.pago_id = p.id)
      CROSS JOIN LATERAL (
        -- Con historia (20261005000000): tiene eventos en la bitácora y nunca
        -- tuvo asiento de cobro (ningún reverso le da fecha).
        SELECT EXISTS (SELECT 1 FROM public.pagos_rechazo_eventos r WHERE r.pago_id = p.id)
               AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                                WHERE a.company_id = p_company AND a.origen = 'automatico'
                                  AND a.origen_tabla = 'pagos' AND a.origen_id = p.id
                                  AND a.origen_evento = 'pago_contabilizado') AS o_hist
      ) hs
       WHERE (p.estado IN ('verificado', 'aplicado', 'rechazado') OR hs.o_hist)
         AND p.cargo_adicional_id IS NULL
       ORDER BY p.id, c.id
    ) pg
    UNION ALL
    -- Cobros de cargos adicionales (20261004000000). El cargo no se puede
    -- anular con cobros vivos: la vigencia del cobro es la suya.
    SELECT 'pagos'::text, p.id, 'pago_contabilizado'::text, 'abono'::text,
           COALESCE(p.verified_at, p.created_at)::date,
           'Pago ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '') || ' · cargo ' || x.concepto,
           public.conta_tipo_cargo_de_documento('cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido'),
           x.unidad_id, x.responsable_cliente_id, p.monto, p.estado, x.por_tipo,
           p.deleted_at, p.estado = 'rechazado', hs.o_hist
      FROM ca x
      JOIN public.pagos p ON p.cargo_adicional_id = x.id
    CROSS JOIN LATERAL (
        -- Con historia (20261005000000): tiene eventos en la bitácora y nunca
        -- tuvo asiento de cobro (ningún reverso le da fecha).
        SELECT EXISTS (SELECT 1 FROM public.pagos_rechazo_eventos r WHERE r.pago_id = p.id)
               AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                                WHERE a.company_id = p_company AND a.origen = 'automatico'
                                  AND a.origen_tabla = 'pagos' AND a.origen_id = p.id
                                  AND a.origen_evento = 'pago_contabilizado') AS o_hist
      ) hs
     WHERE (p.estado IN ('verificado', 'aplicado', 'rechazado') OR hs.o_hist)
  ),
  -- Asientos del evento evaluados al corte.
  ev_a AS (
    SELECT e.*, par.h, par.historico,
           sal.id AS a_saldo,
           pos.id AS a_post, pos.fecha AS a_post_fecha,
           rev.id AS a_rev, rev.r_fecha, rev.r_creado,
           bor.id AS a_borr, bor.fecha AS a_borr_fecha,
           anu.r_creado AS anul_creado,
           ih.codigo AS ih_codigo, ih.motivo AS ih_motivo,
           ia.motivo AS ia_motivo,
           -- Cobro con historia (20261005000000, 20261006000000): su estado
           -- al corte sale de la bitácora (conta_ec_cobro_al_corte).
           hx.t_estado, hx.t_desde, hx.t_sin_fecha, hx.le_at, hx.nx_evento, hx.nx_at
      FROM ev e
      CROSS JOIN par
      -- Estado del cobro al corte según la bitácora (20261006000000).
      LEFT JOIN LATERAL (
        SELECT k.* FROM public.conta_ec_cobro_al_corte(e.o_id, p_hasta) k WHERE e.o_hist
      ) hx ON true
      LEFT JOIN LATERAL (
        SELECT a.id FROM public.conta_asientos a
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'publicado' AND a.fecha <= par.h
           AND NOT EXISTS (SELECT 1 FROM public.conta_asientos r
                            WHERE r.id = a.anulado_por_id AND r.estado = 'publicado' AND r.fecha <= par.h)
         ORDER BY a.fecha, a.created_at LIMIT 1
      ) sal ON true
      LEFT JOIN LATERAL (
        SELECT a.id, a.fecha FROM public.conta_asientos a
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'publicado' AND a.fecha > par.h
         ORDER BY a.fecha, a.created_at LIMIT 1
      ) pos ON true
      LEFT JOIN LATERAL (
        SELECT a.id, r.fecha AS r_fecha, r.created_at AS r_creado
          FROM public.conta_asientos a
          JOIN public.conta_asientos r ON r.id = a.anulado_por_id AND r.estado = 'publicado'
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'publicado' AND a.fecha <= par.h AND r.fecha <= par.h
         ORDER BY r.created_at DESC LIMIT 1
      ) rev ON true
      LEFT JOIN LATERAL (
        SELECT a.id, a.fecha FROM public.conta_asientos a
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'borrador' AND a.created_at::date <= par.h
         ORDER BY a.created_at DESC LIMIT 1
      ) bor ON true
      -- Registro del reverso que acompañó la anulación/rechazo (sin corte):
      -- es la única fecha que el sistema guarda de ese cambio de estado.
      LEFT JOIN LATERAL (
        SELECT r.created_at AS r_creado
          FROM public.conta_asientos a
          JOIN public.conta_asientos r ON r.id = a.anulado_por_id AND r.estado = 'publicado'
         WHERE e.o_cancel_por_reverso
           AND a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
         ORDER BY r.created_at DESC LIMIT 1
      ) anu ON true
      LEFT JOIN LATERAL (
        SELECT i.codigo, i.motivo FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = e.o_tabla AND i.origen_id = e.o_id AND i.evento = e.o_evento
           AND i.created_at::date <= par.h
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1
      ) ih ON true
      LEFT JOIN LATERAL (
        SELECT i.motivo FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = e.o_tabla AND i.origen_id = e.o_id AND i.evento = e.o_evento
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1
      ) ia ON true
  ),
  -- Vigencia AL CORTE. Sin fecha de anulación/rechazo conocida, un documento
  -- que hoy está anulado/rechazado no se puede situar: queda fuera (y cuenta
  -- en conta_ec_limitaciones).
  vig AS (
    SELECT s.*,
           CASE WHEN s.o_hist THEN
                  -- lo que antes llegue: la baja del documento o el siguiente rechazo
                  LEAST(CASE WHEN s.o_cancel::date > s.h THEN s.o_cancel::date END,
                        CASE WHEN s.nx_evento = 'rechazo' THEN s.nx_at::date END)
                WHEN s.o_cancel IS NOT NULL AND s.o_cancel::date > s.h THEN s.o_cancel::date
                WHEN s.o_cancel_por_reverso AND s.anul_creado::date > s.h THEN s.anul_creado::date
           END AS cancelado_despues,
           (s.o_hist AND s.nx_evento = 'rechazo'
            AND (s.o_cancel IS NULL OR s.nx_at::date <= s.o_cancel::date)) AS rechazo_fechado,
           CASE WHEN s.o_hist THEN s.t_desde ELSE s.o_fecha END AS f_fecha,
           -- Asiento del camino histórico (sin dimensiones), vivo al corte.
           (SELECT a.id FROM public.conta_asientos a
             WHERE NOT s.o_por_tipo
               AND a.company_id = p_company AND a.origen = 'automatico'
               AND a.origen_tabla = s.o_tabla AND a.origen_id = s.o_id
               AND a.origen_evento NOT LIKE '%\_revertido'
               AND a.estado = 'publicado' AND a.fecha <= s.h
               AND NOT EXISTS (SELECT 1 FROM public.conta_asientos r
                                WHERE r.id = a.anulado_por_id AND r.estado = 'publicado' AND r.fecha <= s.h)
             ORDER BY a.fecha DESC, a.created_at DESC LIMIT 1) AS a_hist
      FROM ev_a s
     WHERE (s.o_cancel IS NULL OR s.o_cancel::date > s.h)
       AND CASE WHEN s.o_hist
                -- Con historia: vigente al corte si en ese intervalo estaba
                -- verificado/aplicado desde una fecha no posterior al corte.
                -- Un intervalo cuyo inicio no se conoce (NULL) no se lista.
                THEN s.t_estado IN ('verificado', 'aplicado')
                     AND (s.t_desde <= s.h
                          -- Verificado sin fecha tras reactivarse: sólo el
                          -- corte de HOY conoce su estado (el de hoy); en un
                          -- corte histórico es limitación (conta_ec_limitaciones).
                          OR (s.t_sin_fecha AND s.nx_evento IS NULL AND NOT s.historico))
                ELSE s.o_fecha <= s.h
                     AND (NOT s.o_cancel_por_reverso OR s.anul_creado::date > s.h)
           END
  ),
  clas AS (
    SELECT v.*,
           CASE
             WHEN NOT v.o_por_tipo THEN 'fuera_del_auxiliar'
             WHEN v.a_saldo IS NOT NULL THEN 'cobro_sin_vinculo'
             WHEN v.a_post IS NOT NULL THEN 'contabilizado_despues'
             WHEN v.a_borr IS NOT NULL THEN 'borrador'
             ELSE 'pendiente'
           END AS k
      FROM vig v
     WHERE NOT v.o_por_tipo
        OR v.a_saldo IS NULL
        -- «pagado» SIN cobro vinculado (marcado antes de 20261004000000): el
        -- estado de cuenta no puede acreditarlo. Con cobros, el estado se
        -- deriva de ellos y sus abonos ya están en el saldo.
        OR (v.o_tabla = 'cargos_adicionales_unidad' AND v.o_estado = 'pagado'
            AND NOT EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = v.o_id))
  )
  SELECT c.k, c.o_nat, c.o_tabla, c.o_id, c.o_evento, c.f_fecha, c.o_concepto, c.o_tipo,
         c.o_unidad, c.o_resp, c.o_monto, c.o_estado,
         CASE c.k
           WHEN 'contabilizado_despues' THEN 'contabilizado_despues_del_corte'
           WHEN 'pendiente' THEN
             CASE WHEN c.a_rev IS NOT NULL THEN 'asiento_reversado'
                  ELSE COALESCE(c.ih_codigo, 'sin_intento_al_corte') END
         END,
         CASE c.k
           WHEN 'fuera_del_auxiliar' THEN
             CASE WHEN c.a_hist IS NOT NULL THEN
               CASE WHEN c.o_nat = 'abono'
                 THEN 'Cobro contabilizado por el mapeo general: su asiento no lleva el auxiliar ni la unidad, así que no entra en este saldo.'
                 ELSE 'Contabilizado por el mapeo general: su asiento no lleva el auxiliar ni la unidad, así que no entra en este saldo.' END
             ELSE
               CASE WHEN c.o_nat = 'abono'
                 THEN 'Cobro de una cuota del camino histórico: no entra en este saldo.'
                 ELSE 'Anterior a la contabilización por tipo o sin clasificar: no se contabiliza retroactivamente.' END
             END
           WHEN 'cobro_sin_vinculo' THEN
             'Hoy el documento figura como pagado, pero los cargos adicionales no tienen pago vinculado: el estado de cuenta no puede acreditarlo.'
             || CASE WHEN c.historico THEN ' El documento no registra cuándo se marcó como pagado: es su estado de hoy, no necesariamente el del corte.' ELSE '' END
           WHEN 'contabilizado_despues' THEN
             'Contabilizado con fecha ' || to_char(c.a_post_fecha, 'YYYY-MM-DD')
             || ', posterior al corte: a esa fecha no estaba en el saldo. Entra al saldo en los cortes desde el '
             || to_char(c.a_post_fecha, 'YYYY-MM-DD') || '.'
           WHEN 'borrador' THEN
             CASE WHEN c.o_nat = 'abono'
               THEN 'Su asiento está en borrador: no reduce el saldo hasta publicarse.'
               ELSE 'Su asiento está en borrador: no suma al saldo hasta publicarse.' END
           ELSE
             CASE
               WHEN c.a_rev IS NOT NULL AND c.cancelado_despues IS NOT NULL THEN
                 'Al corte seguía vigente; se anuló el ' || to_char(c.cancelado_despues, 'YYYY-MM-DD')
                 || ' y el reverso de su asiento lleva fecha contable ' || to_char(c.r_fecha, 'YYYY-MM-DD')
                 || ', no posterior al corte: no está en el saldo a esa fecha.'
               WHEN c.a_rev IS NOT NULL THEN
                 'Su asiento fue reversado con fecha ' || to_char(c.r_fecha, 'YYYY-MM-DD')
                 || ' y el documento sigue vigente: no se recrea automáticamente.'
               WHEN c.ih_codigo IS NOT NULL THEN
                 COALESCE(c.ih_motivo, 'Sin asiento contabilizado.')
               ELSE
                 'Sin intento de contabilización registrado a la fecha de corte.'
                 || COALESCE(' Motivo de hoy: ' || c.ia_motivo, '')
             END
             || CASE WHEN c.a_rev IS NULL AND c.cancelado_despues IS NOT NULL THEN
                  CASE WHEN c.rechazo_fechado
                    THEN ' El cobro se rechazó después del corte, el ' || to_char(c.cancelado_despues, 'YYYY-MM-DD') || '.'
                    ELSE ' El documento se anuló después del corte, el ' || to_char(c.cancelado_despues, 'YYYY-MM-DD') || '.' END
                ELSE '' END
             || CASE WHEN c.o_hist AND c.t_sin_fecha THEN
                  ' Se reactivó el ' || to_char(c.le_at::date, 'YYYY-MM-DD')
                  || ' y después se verificó sin fecha registrada: se lista por su estado de hoy.'
                ELSE '' END
         END,
         a.id, a.numero, a.fecha,
         CASE WHEN c.k = 'cobro_sin_vinculo' AND c.historico THEN 'estado_actual_sin_fecha'
              WHEN c.o_hist AND c.t_sin_fecha THEN 'verificacion_sin_fecha' END
    FROM clas c
    LEFT JOIN public.conta_asientos a ON a.id = CASE c.k
           WHEN 'fuera_del_auxiliar' THEN c.a_hist
           WHEN 'cobro_sin_vinculo' THEN c.a_saldo
           WHEN 'contabilizado_despues' THEN c.a_post
           WHEN 'borrador' THEN c.a_borr
           ELSE c.a_rev
         END
$$;


CREATE OR REPLACE FUNCTION public.conta_ec_limitaciones(
  p_company uuid,
  p_project uuid,
  p_cliente uuid,
  p_unidad  uuid,
  p_hasta   date
)
RETURNS TABLE (codigo text, documentos bigint, monto numeric, descripcion text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH cu AS (
    SELECT c.id, c.pago_id, LEAST(c.deleted_at, c.anulada_at) AS cancelado_at FROM public.cuotas_condominio c
     WHERE c.company_id = p_company AND c.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR c.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR c.responsable_cliente_id = p_cliente)
  ),
  rech AS (
    SELECT DISTINCT p.id, p.monto
      FROM (SELECT c.id AS cuota_id, c.pago_id, NULL::uuid AS cargo_id FROM cu c
            UNION ALL
            -- cobros de cargos adicionales (20261004000000)
            SELECT NULL, NULL, x.id FROM public.cargos_adicionales_unidad x
             WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
               AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
               AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)) d
      JOIN public.pagos p ON (p.cuota_id = d.cuota_id OR d.pago_id = p.id OR p.cargo_adicional_id = d.cargo_id)
      -- Primer evento registrado del cobro (20261005000000), si lo hay.
      LEFT JOIN LATERAL (
        SELECT e.evento, e.ocurrido_at, e.verified_at_anterior FROM public.pagos_rechazo_eventos e
         WHERE e.pago_id = p.id ORDER BY e.ocurrido_at, e.id LIMIT 1
      ) fe ON true
     WHERE (
             -- (a) rechazado sin ningún evento: el rechazo es anterior a la
             --     bitácora y no se sabe cuándo ocurrió.
             (fe.evento IS NULL AND p.estado = 'rechazado'
              AND COALESCE(p.verified_at, p.created_at)::date <= p_hasta)
             -- (b) su primer evento es una REACTIVACIÓN posterior al corte:
             --     antes hubo un rechazo sin fecha, así que al corte no se
             --     sabe si seguía vigente o ya estaba rechazado. Un rechazo
             --     o reactivación posterior no le devuelve la fecha. El
             --     umbral es el mismo de (a), con la `verified_at` que tenía
             --     el cobro al reactivarse.
          OR (fe.evento = 'reactivacion' AND fe.ocurrido_at::date > p_hasta
              AND COALESCE(fe.verified_at_anterior, p.created_at)::date <= p_hasta)
           )
       AND (p.deleted_at IS NULL OR p.deleted_at::date > p_hasta)
       AND NOT EXISTS (
         SELECT 1 FROM public.conta_asientos a
          WHERE a.company_id = p_company AND a.origen = 'automatico'
            AND a.origen_tabla = 'pagos' AND a.origen_id = p.id AND a.origen_evento = 'pago_contabilizado'
            AND a.anulado_por_id IS NOT NULL)
  ),
  -- Cobros sin asiento reactivados a un estado no vigente y verificados
  -- después sin fecha registrada (20261006000000): al corte, en ese
  -- intervalo, no se sabe si ya estaban vigentes. No se listan ni se les
  -- inventa fecha (ni la de la reactivación ni otra).
  sinv AS (
    SELECT DISTINCT p.id, p.monto
      FROM (SELECT c.id AS cuota_id, c.pago_id, NULL::uuid AS cargo_id, c.cancelado_at FROM cu c
            UNION ALL
            SELECT NULL, NULL, x.id, NULL::timestamptz FROM public.cargos_adicionales_unidad x
             WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
               AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
               AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)) d
      JOIN public.pagos p ON (p.cuota_id = d.cuota_id OR d.pago_id = p.id OR p.cargo_adicional_id = d.cargo_id)
      CROSS JOIN LATERAL public.conta_ec_cobro_al_corte(p.id, p_hasta) k
     WHERE k.t_sin_fecha
       AND (d.cancelado_at IS NULL OR d.cancelado_at::date > p_hasta)
       AND (p.deleted_at IS NULL OR p.deleted_at::date > p_hasta)
       AND NOT EXISTS (
         SELECT 1 FROM public.conta_asientos a
          WHERE a.company_id = p_company AND a.origen = 'automatico'
            AND a.origen_tabla = 'pagos' AND a.origen_id = p.id AND a.origen_evento = 'pago_contabilizado')
  ),
  anul AS (
    SELECT x.id, x.monto FROM public.cargos_adicionales_unidad x
     WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)
       AND x.estado = 'anulado' AND x.fecha_cargo <= p_hasta
       -- Con evidencia de la anulación (20261011000000) la fecha se conoce.
       AND NOT EXISTS (SELECT 1 FROM public.conta_cargo_anulaciones an WHERE an.cargo_id = x.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.conta_asientos a
          WHERE a.company_id = p_company AND a.origen = 'automatico'
            AND a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = x.id
            AND a.origen_evento = 'cargo_adicional_emitido'
            AND a.anulado_por_id IS NOT NULL)
  )
  SELECT 'rechazo_sin_fecha'::text, count(*), sum(r.monto)::numeric(14,2),
         'Cobros sin asiento que se rechazaron antes de que el sistema registrara la fecha de los rechazos: no se puede saber si al corte estaban vigentes o ya rechazados. No se listan como pendientes.'::text
    FROM rech r
   WHERE p_hasta IS NOT NULL AND p_hasta < CURRENT_DATE
  HAVING count(*) > 0
  UNION ALL
  SELECT 'anulacion_sin_fecha', count(*), sum(n.monto)::numeric(14,2),
         'Cargos adicionales HOY anulados que nunca tuvieron asiento y se anularon antes de que el sistema registrara la fecha de las anulaciones, así que no se puede saber si estaban vigentes al corte. No se listan como pendientes.'
    FROM anul n
   WHERE p_hasta IS NOT NULL AND p_hasta < CURRENT_DATE
  HAVING count(*) > 0
  UNION ALL
  SELECT 'verificacion_sin_fecha', count(*), sum(s.monto)::numeric(14,2),
         'Cobros sin asiento que se reactivaron y después se verificaron sin fecha de verificación registrada: no se sabe desde cuándo estaban vigentes al corte. No se listan como pendientes.'
    FROM sinv s
   WHERE p_hasta IS NOT NULL AND p_hasta < CURRENT_DATE
  HAVING count(*) > 0
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. PORTAL DEL RESIDENTE: consultar y SOLICITAR (E4)
-- ═══════════════════════════════════════════════════════════════════════════
-- El sujeto es SIEMPRE el cliente de la sesión (get_my_cliente_id()), nunca un
-- parámetro: un residente no ve ni pide nada de otro cliente, aunque comparta
-- la unidad.

CREATE FUNCTION public.portal_cliente_sesion()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cli uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_cli := public.get_my_cliente_id();
  IF v_cli IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no es de un residente.' USING ERRCODE = '42501';
  END IF;
  RETURN v_cli;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_cliente_sesion() FROM PUBLIC, anon, authenticated;

-- Saldos a favor disponibles del residente.
CREATE FUNCTION public.portal_saldos_favor()
RETURNS TABLE (
  origen_id   uuid,
  project_id  uuid,
  unidad_id   uuid,
  tipo        text,
  moneda      text,
  monto       numeric,
  disponible  numeric,
  creado_at   timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cli uuid := public.portal_cliente_sesion();
BEGIN
  RETURN QUERY
  SELECT o.id, o.project_id, o.unidad_id, o.tipo, o.moneda, o.monto,
         public.conta_sf_disponible(o.id), o.created_at
    FROM public.conta_saldo_favor_origenes o
   WHERE o.cliente_id = v_cli
     AND public.conta_sf_disponible(o.id) > 0
   ORDER BY o.created_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_saldos_favor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_saldos_favor() TO authenticated;

COMMENT ON FUNCTION public.portal_saldos_favor() IS
  'Portal: saldos a favor disponibles del residente de la sesión (titular = su cliente).';

-- Documentos del residente con saldo pendiente contabilizado (cuotas y
-- cargos adicionales por tipo, con devengo publicado): a los que puede pedir
-- aplicar un saldo y —los cargos— pagar en línea.
CREATE FUNCTION public.portal_documentos_con_saldo()
RETURNS TABLE (
  documento_tabla text,
  documento_id    uuid,
  project_id      uuid,
  unidad_id       uuid,
  concepto        text,
  fecha           date,
  estado          text,
  moneda          text,
  saldo           numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cli uuid := public.portal_cliente_sesion();
BEGIN
  RETURN QUERY
  SELECT 'cuotas_condominio'::text, c.id, c.project_id, c.unidad_id,
         c.concepto || ' ' || c.periodo, c.fecha_vencimiento,
         COALESCE(c.cuota_estado, c.estado), q.princ_moneda,
         round(COALESCE(q.princ_monto, 0) + COALESCE(q.mora_monto, 0) - q.aplicado_princ - q.aplicado_mora, 2)
    FROM public.cuotas_condominio c
   CROSS JOIN LATERAL public.conta_cuota_saldo_cobro(c.id) q
   WHERE c.responsable_cliente_id = v_cli AND c.deleted_at IS NULL
     AND COALESCE(c.cuota_estado, '') NOT IN ('anulada','pagada')
     AND q.princ_estado = 'publicado'
     AND round(COALESCE(q.princ_monto, 0) + COALESCE(q.mora_monto, 0) - q.aplicado_princ - q.aplicado_mora, 2) > 0
  UNION ALL
  SELECT 'cargos_adicionales_unidad'::text, ca.id, ca.project_id, ca.unidad_id,
         ca.concepto, ca.fecha_cargo, ca.estado,
         public.conta_moneda_base(ca.company_id, ca.project_id),
         round(s.devengo_monto - s.aplicado, 2)
    FROM public.cargos_adicionales_unidad ca
   CROSS JOIN LATERAL public.conta_cargo_saldo_cobro(ca.id) s
   WHERE ca.responsable_cliente_id = v_cli AND ca.estado = 'pendiente'
     AND s.devengo_estado = 'publicado'
     AND round(s.devengo_monto - s.aplicado, 2) > 0
   ORDER BY 6, 5;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_documentos_con_saldo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_documentos_con_saldo() TO authenticated;

COMMENT ON FUNCTION public.portal_documentos_con_saldo() IS
  'Portal: cuotas y cargos adicionales del residente de la sesión (responsable = su cliente) con saldo contabilizado pendiente. Los cargos listados se pueden pagar en línea (create-charge con cargo_adicional_id).';

-- Solicitud de aplicación de un saldo propio a un documento propio.
CREATE FUNCTION public.portal_solicitar_aplicacion_saldo_favor(
  p_id              uuid,
  p_origen_id       uuid,
  p_documento_tabla text,
  p_documento_id    uuid,
  p_importe         numeric,
  p_motivo          text DEFAULT NULL
)
RETURNS TABLE (solicitud_id uuid, estado text, repetida boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cli    uuid := public.portal_cliente_sesion();
  v_o      public.conta_saldo_favor_origenes;
  v_resp   uuid;
  v_proj   uuid;
  v_sol    public.conta_ajustes_solicitudes;
  v_previa boolean;
BEGIN
  IF p_documento_tabla IS NULL OR p_documento_tabla NOT IN ('cuotas_condominio','cargos_adicionales_unidad') THEN
    RAISE EXCEPTION 'SALDO_FAVOR_DOCUMENTO: el documento tiene que ser una cuota o un cargo adicional.' USING ERRCODE = '22023';
  END IF;
  -- El saldo tiene que ser SUYO. Ajeno = inexistente.
  SELECT * INTO v_o FROM public.conta_saldo_favor_origenes o WHERE o.id = p_origen_id AND o.cliente_id = v_cli;
  IF v_o.id IS NULL THEN
    RAISE EXCEPTION 'El saldo a favor no existe.' USING ERRCODE = 'P0002';
  END IF;
  -- Y el documento, también suyo y de la misma contabilidad.
  IF p_documento_tabla = 'cuotas_condominio' THEN
    SELECT c.responsable_cliente_id, c.project_id INTO v_resp, v_proj
      FROM public.cuotas_condominio c WHERE c.id = p_documento_id AND c.company_id = v_o.company_id;
  ELSE
    SELECT ca.responsable_cliente_id, ca.project_id INTO v_resp, v_proj
      FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_documento_id AND ca.company_id = v_o.company_id;
  END IF;
  IF v_resp IS DISTINCT FROM v_cli OR v_proj IS DISTINCT FROM v_o.project_id THEN
    RAISE EXCEPTION 'El documento no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF p_importe IS NULL OR p_importe <= 0 OR p_importe > public.conta_sf_disponible(v_o.id) THEN
    RAISE EXCEPTION 'AJUSTE_IMPORTE: el importe debe ser positivo y no mayor que tu saldo disponible (%).',
      public.conta_sf_disponible(v_o.id) USING ERRCODE = '22023';
  END IF;

  v_previa := EXISTS (SELECT 1 FROM public.conta_ajustes_solicitudes s WHERE s.id = p_id);
  v_sol := public.conta_ajuste_alta(p_id, v_o.company_id, 'aplicar_saldo_favor', p_documento_tabla, p_documento_id,
                                    v_o.id, p_importe,
                                    COALESCE(NULLIF(btrim(COALESCE(p_motivo, '')), ''), 'Solicitud del residente desde el portal'),
                                    'portal', v_cli);
  RETURN QUERY SELECT v_sol.id, v_sol.estado, v_previa;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_solicitar_aplicacion_saldo_favor(uuid, uuid, text, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_solicitar_aplicacion_saldo_favor(uuid, uuid, text, uuid, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.portal_solicitar_aplicacion_saldo_favor(uuid, uuid, text, uuid, numeric, text) IS
  'Portal (E4): el residente solicita aplicar SU saldo a favor a SU cuota o cargo. No aplica nada: contabilidad aprueba y ejecuta (conta_ajuste_aprobar). Idempotente por p_id.';

-- Sus solicitudes, sin el detalle interno de un fallo de ejecución.
CREATE FUNCTION public.portal_mis_solicitudes()
RETURNS TABLE (
  solicitud_id    uuid,
  tipo            text,
  documento_tabla text,
  documento_id    uuid,
  saldo_origen_id uuid,
  importe         numeric,
  moneda          text,
  estado          text,
  motivo          text,
  motivo_revision text,
  solicitado_at   timestamptz,
  revisado_at     timestamptz,
  ejecutado_at    timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cli uuid := public.portal_cliente_sesion();
BEGIN
  RETURN QUERY
  SELECT s.id, s.tipo, s.documento_tabla, s.documento_id, s.saldo_origen_id, s.importe, s.moneda,
         -- Una ejecución fallida sigue en manos de contabilidad.
         CASE WHEN s.estado = 'fallida' THEN 'en_revision' ELSE s.estado END,
         s.motivo, CASE WHEN s.estado = 'rechazada' THEN s.motivo_revision END,
         s.solicitado_at, s.revisado_at, s.ejecutado_at
    FROM public.conta_ajustes_solicitudes s
   WHERE s.solicitado_cliente_id = v_cli AND s.canal = 'portal'
   ORDER BY s.solicitado_at DESC
   LIMIT 200;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_mis_solicitudes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_mis_solicitudes() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. PASARELA: cargos adicionales, avisos del proveedor y reembolsos
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.pasarela_exigir_service_role()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rol text := COALESCE((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role', '');
BEGIN
  IF v_rol <> 'service_role' AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'operación del proveedor de pago, no de un usuario' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pasarela_exigir_service_role() FROM PUBLIC, anon, authenticated;

-- ¿Se puede cobrar en línea este cargo, y cuánto? Para create-charge.
CREATE FUNCTION public.conta_cargo_saldo_pagable(p_cargo_id uuid)
RETURNS TABLE (
  pagable     boolean,
  saldo       numeric,
  motivo      text,
  company_id  uuid,
  project_id  uuid,
  unidad_id   uuid,
  responsable_cliente_id uuid,
  concepto    text,
  moneda      text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ca  public.cargos_adicionales_unidad;
  v_s   record;
  v_coh record;
  v_m   text;
  v_sal numeric(14,2);
BEGIN
  PERFORM public.pasarela_exigir_service_role();
  SELECT * INTO v_ca FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_cargo_id;
  IF v_ca.id IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(v_ca.id);
  SELECT k.codigo, k.motivo INTO v_coh FROM public.conta_cargo_coherencia_devengo(v_ca.id) k;
  v_sal := CASE WHEN v_s.devengo_monto IS NULL THEN NULL ELSE round(v_s.devengo_monto - v_s.aplicado, 2) END;
  v_m := CASE
    WHEN v_ca.estado = 'anulado' THEN 'El cargo está anulado.'
    WHEN v_ca.responsable_cliente_id IS NULL THEN 'El cargo no tiene responsable.'
    WHEN NOT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                      WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = v_ca.id)
      THEN 'El cargo es anterior a la contabilización por tipo: se paga en la administración.'
    WHEN v_s.devengo_estado IS DISTINCT FROM 'publicado' THEN 'El cargo todavía no está contabilizado.'
    WHEN v_coh.codigo IS NOT NULL THEN v_coh.motivo
    WHEN v_sal <= 0 THEN 'El cargo ya está saldado.'
  END;
  RETURN QUERY SELECT v_m IS NULL, GREATEST(COALESCE(v_sal, 0), 0), v_m, v_ca.company_id, v_ca.project_id,
                      v_ca.unidad_id, v_ca.responsable_cliente_id, v_ca.concepto,
                      public.conta_moneda_base(v_ca.company_id, v_ca.project_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargo_saldo_pagable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conta_cargo_saldo_pagable(uuid) TO service_role;

COMMENT ON FUNCTION public.conta_cargo_saldo_pagable(uuid) IS
  'service_role (create-charge): si un cargo adicional se puede cobrar en línea y su saldo contabilizado (devengo publicado − cobros y saldos a favor aplicados vivos), o el motivo por el que no.';

-- Conciliación de un cobro aprobado. Cuerpo de 20260911231905 salvo:
--   · verified_by recibe un uuid (o NULL) y la procedencia en texto va a
--     verification_notes: con verified_by uuid el INSERT anterior fallaba
--     siempre por tipo;
--   · un reembolsado no se vuelve a acreditar (PAGO_REEMBOLSADO);
--   · exactamente UN ítem: recibo, cuota o CARGO ADICIONAL;
--   · el cargo: bloqueado después de la solicitud, el pago se registra por el
--     camino del cargo (marca conta.cobro_cargo_pago, que valida conta_tg_pagos
--     y contabiliza contra la CxC de su devengo; el estado del cargo se deriva
--     de sus cobros). Si el cargo ya no admite el cobro (anulado, saldado por
--     otra vía) el pago SE REGISTRA igual —el dinero entró— y su
--     contabilización queda pendiente con el motivo, visible en Contabilidad.
CREATE OR REPLACE FUNCTION public.conciliar_pago_externo(
  p_payment_request_id uuid,
  p_verificado_por text DEFAULT NULL,
  p_verificado_en  timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pr        public.payment_requests;
  v_pago_id   uuid;
  v_reg       public.registros;
  v_cuota     public.cuotas_condominio;
  v_cargo     public.cargos_adicionales_unidad;
  v_s         record;
  v_ref       text;
  v_metodo    text;
  v_proyecto  uuid;
  v_total     numeric;
  v_abonado   numeric;
  v_liquida   boolean;
  v_saldo     numeric;
  v_ahora     timestamptz := now();
  v_items     int;
  -- `pagos.verified_by` es uuid (producción y la cadena de migraciones): la
  -- procedencia de texto de un webhook ('stripe_webhook') no cabe ahí. Antes
  -- se insertaba tal cual y TODA conciliación fallaba por tipo (text → uuid),
  -- con o sin valor. Un uuid va a verified_by; la procedencia, a las notas.
  v_verif_uid  uuid := CASE WHEN p_verificado_por ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            THEN p_verificado_por::uuid END;
  v_verif_nota text := CASE WHEN p_verificado_por IS NOT NULL
                            THEN 'Verificado por ' || p_verificado_por END;
BEGIN
  PERFORM public.pasarela_exigir_service_role();

  IF p_payment_request_id IS NULL THEN
    RAISE EXCEPTION 'falta la solicitud de cobro' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pr FROM public.payment_requests pr
   WHERE pr.id = p_payment_request_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'solicitud de cobro no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_pr.estado = 'refunded' THEN
    RAISE EXCEPTION 'PAGO_REEMBOLSADO: la solicitud de cobro fue reembolsada por el proveedor; no se acredita.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_items := (v_pr.registro_id IS NOT NULL)::int + (v_pr.cuota_id IS NOT NULL)::int
           + (v_pr.cargo_adicional_id IS NOT NULL)::int;

  -- YA CONCILIADA: se devuelve lo que hay y no se acredita de nuevo.
  IF v_pr.estado = 'succeeded' THEN
    SELECT p.id INTO v_pago_id FROM public.pagos p WHERE p.payment_request_id = v_pr.id;
    IF v_pr.registro_id IS NOT NULL THEN
      SELECT * INTO v_reg FROM public.registros r WHERE r.id = v_pr.registro_id;
      v_total   := COALESCE(v_reg.total_a_pagar, v_reg.monto_calculado, 0);
      v_liquida := v_reg.estado = 'pagado';
      v_saldo   := round(GREATEST(v_total - COALESCE(v_reg.monto_pagado, 0), 0), 2);
    ELSIF v_pr.cargo_adicional_id IS NOT NULL THEN
      SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(v_pr.cargo_adicional_id);
      v_liquida := (SELECT ca.estado = 'pagado' FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_pr.cargo_adicional_id);
      v_saldo   := round(GREATEST(COALESCE(v_s.devengo_monto, 0) - COALESCE(v_s.aplicado, 0), 0), 2);
    ELSE
      SELECT * INTO v_cuota FROM public.cuotas_condominio c WHERE c.id = v_pr.cuota_id;
      SELECT COALESCE(sum(p.monto), 0) INTO v_abonado
        FROM public.pagos p WHERE p.cuota_id = v_pr.cuota_id AND p.deleted_at IS NULL;
      v_total   := COALESCE(v_cuota.total_a_pagar, v_cuota.monto, 0);
      v_liquida := v_total > 0 AND (v_total - v_abonado) <= 0.005;
      v_saldo   := round(GREATEST(v_total - v_abonado, 0), 2);
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'ya_conciliado', true, 'pago_id', v_pago_id,
      'liquidado', COALESCE(v_liquida, false), 'saldo_restante', v_saldo);
  END IF;

  IF v_items <> 1 THEN
    RAISE EXCEPTION 'la solicitud de cobro no apunta a exactamente un ítem' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_pr.monto, 0) <= 0 THEN
    RAISE EXCEPTION 'la solicitud de cobro no tiene monto' USING ERRCODE = '22023';
  END IF;

  v_ref := COALESCE(v_pr.provider_ref, v_pr.stripe_payment_intent, v_pr.paypal_order_id);
  v_metodo := CASE WHEN v_pr.provider = 'sandbox' THEN 'sandbox' ELSE 'tarjeta_credito' END;

  -- ── CARGO ADICIONAL ──────────────────────────────────────────────────────
  IF v_pr.cargo_adicional_id IS NOT NULL THEN
    SELECT * INTO v_cargo FROM public.cargos_adicionales_unidad ca
     WHERE ca.id = v_pr.cargo_adicional_id AND ca.company_id = v_pr.company_id
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cargo adicional no encontrado' USING ERRCODE = 'P0002';
    END IF;
    IF v_cargo.responsable_cliente_id IS DISTINCT FROM v_pr.cliente_id THEN
      -- create-charge fija el cliente del cobro = responsable del cargo.
      RAISE EXCEPTION 'COBRO_CARGO_AJENO: la solicitud de cobro no es del responsable del cargo.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT p.id INTO v_pago_id FROM public.pagos p WHERE p.payment_request_id = v_pr.id;
    IF v_pago_id IS NULL THEN
      v_pago_id := gen_random_uuid();
      PERFORM set_config('conta.cobro_cargo_pago', v_pago_id::text, true);
      INSERT INTO public.pagos (
        id, payment_request_id, cargo_adicional_id, cliente_id, project_id,
        monto, metodo, estado, verification_status, tipo_aplicacion, referencia,
        verified_by, verified_at, verification_notes, created_at)
      VALUES (
        v_pago_id, v_pr.id, v_cargo.id, v_cargo.responsable_cliente_id, v_cargo.project_id,
        v_pr.monto, v_metodo, 'aplicado', 'aplicado', 'abono', v_ref,
        v_verif_uid,
        CASE WHEN p_verificado_por IS NULL THEN NULL ELSE COALESCE(p_verificado_en, v_ahora) END,
        v_verif_nota, v_ahora);
      PERFORM set_config('conta.cobro_cargo_pago', '', true);
    END IF;

    SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(v_cargo.id);
    v_saldo   := round(GREATEST(COALESCE(v_s.devengo_monto, 0) - COALESCE(v_s.aplicado, 0), 0), 2);
    v_liquida := (SELECT ca.estado = 'pagado' FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_cargo.id);
    IF v_liquida THEN
      UPDATE public.pagos p SET tipo_aplicacion = 'pago_total' WHERE p.id = v_pago_id;
    END IF;

    UPDATE public.payment_requests pr SET estado = 'succeeded', updated_at = v_ahora WHERE pr.id = v_pr.id;
    RETURN jsonb_build_object(
      'ok', true, 'ya_conciliado', false, 'pago_id', v_pago_id,
      'liquidado', COALESCE(v_liquida, false), 'saldo_restante', v_saldo);
  END IF;

  -- ── RECIBO o CUOTA: igual que 20260911231905 ─────────────────────────────
  IF v_pr.registro_id IS NOT NULL THEN
    SELECT * INTO v_reg FROM public.registros r
     WHERE r.id = v_pr.registro_id AND r.deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'recibo no encontrado' USING ERRCODE = 'P0002';
    END IF;
    v_proyecto := v_reg.project_id;
    v_total    := COALESCE(v_reg.total_a_pagar, v_reg.monto_calculado, 0);
  ELSE
    SELECT * INTO v_cuota FROM public.cuotas_condominio c
     WHERE c.id = v_pr.cuota_id AND c.deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cuota no encontrada' USING ERRCODE = 'P0002';
    END IF;
    v_proyecto := v_cuota.project_id;
    v_total    := COALESCE(v_cuota.total_a_pagar, v_cuota.monto, 0);
  END IF;

  INSERT INTO public.pagos (
    payment_request_id, registro_id, cuota_id, cliente_id, project_id,
    monto, metodo, estado, verification_status, tipo_aplicacion, referencia,
    verified_by, verified_at, verification_notes
  ) VALUES (
    v_pr.id, v_pr.registro_id, v_pr.cuota_id, v_pr.cliente_id, v_proyecto,
    v_pr.monto, v_metodo, 'aplicado', 'aplicado', 'abono', v_ref,
    v_verif_uid,
    CASE WHEN p_verificado_por IS NULL THEN NULL
         ELSE COALESCE(p_verificado_en, v_ahora) END,
    v_verif_nota
  )
  ON CONFLICT (payment_request_id) DO NOTHING
  RETURNING id INTO v_pago_id;

  IF v_pago_id IS NULL THEN
    SELECT p.id INTO v_pago_id FROM public.pagos p WHERE p.payment_request_id = v_pr.id;
    IF v_pr.registro_id IS NOT NULL THEN
      v_liquida := v_reg.estado = 'pagado';
      v_saldo   := round(GREATEST(v_total - COALESCE(v_reg.monto_pagado, 0), 0), 2);
    ELSE
      SELECT COALESCE(sum(p.monto), 0) INTO v_abonado
        FROM public.pagos p WHERE p.cuota_id = v_pr.cuota_id AND p.deleted_at IS NULL;
      v_liquida := v_total > 0 AND (v_total - v_abonado) <= 0.005;
      v_saldo   := round(GREATEST(v_total - v_abonado, 0), 2);
    END IF;
    UPDATE public.payment_requests pr SET estado = 'succeeded', updated_at = v_ahora WHERE pr.id = v_pr.id;
    RETURN jsonb_build_object(
      'ok', true, 'ya_conciliado', true, 'pago_id', v_pago_id,
      'liquidado', v_liquida, 'saldo_restante', v_saldo);
  END IF;

  IF v_pr.registro_id IS NOT NULL THEN
    v_reg := public.agua_registro_acreditar_pago_externo(v_pr.registro_id, v_pr.monto, v_ref);
    v_liquida := v_reg.estado = 'pagado';
    v_saldo   := round(GREATEST(v_total - COALESCE(v_reg.monto_pagado, 0), 0), 2);
  ELSE
    SELECT COALESCE(sum(p.monto), 0) INTO v_abonado
      FROM public.pagos p WHERE p.cuota_id = v_pr.cuota_id AND p.deleted_at IS NULL;
    v_liquida := v_total > 0 AND (v_total - v_abonado) <= 0.005;
    v_saldo   := round(GREATEST(v_total - v_abonado, 0), 2);
    IF v_liquida THEN
      UPDATE public.cuotas_condominio c
         SET cuota_estado    = 'pagada',
             pagada_at       = v_ahora,
             estado          = 'pagado',
             fecha_pago      = v_ahora::date,
             metodo_pago     = 'en_linea:' || v_pr.provider,
             referencia_pago = v_ref,
             pago_id         = v_pago_id
       WHERE c.id = v_pr.cuota_id;
    END IF;
  END IF;

  IF v_liquida THEN
    UPDATE public.pagos p SET tipo_aplicacion = 'pago_total' WHERE p.id = v_pago_id;
  END IF;

  UPDATE public.payment_requests pr SET estado = 'succeeded', updated_at = v_ahora WHERE pr.id = v_pr.id;

  RETURN jsonb_build_object(
    'ok', true, 'ya_conciliado', false, 'pago_id', v_pago_id,
    'liquidado', v_liquida, 'saldo_restante', v_saldo);
END;
$$;

COMMENT ON FUNCTION public.conciliar_pago_externo(uuid, text, timestamptz) IS
  'Concilia en UNA transacción un cobro que el payfac ya aprobó: bloquea la solicitud, inserta el pago con llave única (pagos.payment_request_id), bloquea el recibo, la cuota o el cargo adicional, acredita y marca la solicitud succeeded. Una reembolsada no se acredita (PAGO_REEMBOLSADO). Repetirla sobre una ya conciliada devuelve el resultado existente. Sólo service_role; se llama desde pasarela_registrar_estado.';

-- Rechazo de un cobro por reembolso del proveedor (INTERNA). El mismo UPDATE
-- que un rechazo manual: conta_tg_pagos reversa su asiento, deja la evidencia
-- en pagos_rechazo_eventos y aplica los guards —entre ellos
-- COBRO_SALDO_FAVOR_APLICADO, que NO se salta—. Un cobro de cargo lleva la
-- marca de su camino (conta.cobro_cargo_pago).
CREATE FUNCTION public.conta_rechazar_cobro_por_reembolso(p_pago_id uuid, p_nota text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_p public.pagos;
BEGIN
  SELECT * INTO v_p FROM public.pagos p WHERE p.id = p_pago_id FOR UPDATE;
  IF v_p.id IS NULL OR v_p.estado = 'rechazado' OR v_p.deleted_at IS NOT NULL THEN
    RETURN;
  END IF;
  IF v_p.cargo_adicional_id IS NOT NULL THEN
    PERFORM 1 FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_p.cargo_adicional_id FOR UPDATE;
    PERFORM set_config('conta.cobro_cargo_pago', v_p.id::text, true);
  END IF;
  UPDATE public.pagos p
     SET estado = 'rechazado', verification_status = 'rechazado',
         verification_notes = p_nota, updated_at = now()
   WHERE p.id = v_p.id;
  PERFORM set_config('conta.cobro_cargo_pago', '', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_rechazar_cobro_por_reembolso(uuid, text) FROM PUBLIC, anon, authenticated;

-- El único punto por el que un aviso del proveedor cambia una solicitud de
-- cobro. Deduplicado por (proveedor, clave); el estado sólo avanza.
CREATE FUNCTION public.pasarela_registrar_estado(
  p_payment_request_id uuid,
  p_estado             text,
  p_origen             text,
  p_clave_evento       text DEFAULT NULL,
  p_payload            jsonb DEFAULT NULL,
  p_verificado_por     text DEFAULT NULL,
  p_verificado_en      timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pr     public.payment_requests;
  v_clave  text;
  v_prev   text;
  v_nuevo  text;
  v_accion text;
  v_det    text;
  v_conc   jsonb := '{}'::jsonb;
  v_pago   public.pagos;
  v_ev     uuid := gen_random_uuid();
  v_inc_t  text;
  v_inc_d  text;
  v_inc    uuid;
  v_err    text;
BEGIN
  PERFORM public.pasarela_exigir_service_role();
  IF p_estado IS NULL OR p_estado NOT IN ('aprobado','pendiente','requiere_accion','rechazado','error','reembolsado') THEN
    RAISE EXCEPTION 'estado del proveedor inválido: %', p_estado USING ERRCODE = '22023';
  END IF;
  IF p_origen IS NULL OR p_origen NOT IN ('consulta','webhook') THEN
    RAISE EXCEPTION 'origen inválido: %', p_origen USING ERRCODE = '22023';
  END IF;

  -- Todo aviso de la MISMA solicitud se serializa aquí.
  SELECT * INTO v_pr FROM public.payment_requests pr WHERE pr.id = p_payment_request_id FOR UPDATE;
  IF v_pr.id IS NULL THEN
    RAISE EXCEPTION 'solicitud de cobro no encontrada' USING ERRCODE = 'P0002';
  END IF;
  v_prev  := v_pr.estado;
  v_nuevo := v_pr.estado;
  -- Sin clave del proveedor (consulta desde el servidor), la clave es el
  -- estado informado: consultar dos veces lo mismo es el mismo aviso.
  v_clave := COALESCE(NULLIF(btrim(COALESCE(p_clave_evento, '')), ''),
                      'consulta:' || v_pr.id::text || ':' || p_estado);

  -- DUPLICADO: ya procesado (y confirmado). No se hace nada otra vez.
  IF EXISTS (SELECT 1 FROM public.pasarela_eventos e
              WHERE e.provider = v_pr.provider AND e.clave_evento = v_clave) THEN
    IF v_pr.estado = 'succeeded' THEN
      v_conc := public.conciliar_pago_externo(v_pr.id, NULL, NULL);
    END IF;
    RETURN v_conc || jsonb_build_object('ok', true, 'duplicado', true, 'estado', v_pr.estado,
                                        'accion', 'duplicado');
  END IF;

  IF p_estado = 'aprobado' THEN
    IF v_pr.estado = 'refunded' THEN
      v_accion := 'ignorado_reembolsado';
      v_inc_t  := 'aprobado_tras_reembolso';
      v_inc_d  := 'El proveedor informó «aprobado» después de un reembolso confirmado: no se volvió a acreditar. Verifica con el proveedor el estado final del cobro.';
    ELSE
      -- pending|failed → succeeded (el proveedor es la autoridad); succeeded
      -- → devuelve lo existente.
      v_conc   := public.conciliar_pago_externo(v_pr.id, p_verificado_por, p_verificado_en);
      v_accion := CASE WHEN (v_conc ->> 'ya_conciliado')::boolean THEN 'ya_conciliado' ELSE 'conciliado' END;
      v_nuevo  := 'succeeded';
    END IF;

  ELSIF p_estado = 'rechazado' THEN
    IF v_pr.estado IN ('pending','pending_verification') THEN
      UPDATE public.payment_requests pr SET estado = 'failed', updated_at = now() WHERE pr.id = v_pr.id;
      v_nuevo := 'failed'; v_accion := 'marcado_fallido';
    ELSIF v_pr.estado = 'succeeded' THEN
      -- FUERA DE ORDEN: un rechazo después de la aprobación no revierte el
      -- cobro acreditado.
      v_accion := 'ignorado_fuera_de_orden';
      v_inc_t  := 'rechazo_tras_aprobacion';
      v_inc_d  := 'El proveedor informó «rechazado» después de haber aprobado y acreditado el cobro: no se revirtió nada. Verifica con el proveedor; si el cobro realmente no ocurrió, el proveedor enviará un reembolso o anúlalo con una solicitud de ajuste.';
    ELSE
      v_accion := 'sin_cambio';
    END IF;

  ELSIF p_estado = 'reembolsado' THEN
    IF v_pr.estado = 'succeeded' THEN
      UPDATE public.payment_requests pr SET estado = 'refunded', updated_at = now() WHERE pr.id = v_pr.id;
      v_nuevo := 'refunded';
      SELECT * INTO v_pago FROM public.pagos p WHERE p.payment_request_id = v_pr.id;
      IF v_pago.id IS NULL THEN
        v_accion := 'reembolso_sin_cobro';
        v_inc_t  := 'reembolso_sin_cobro';
        v_inc_d  := 'Reembolso confirmado de una solicitud acreditada sin cobro registrado. Revísalo.';
      ELSE
        BEGIN
          PERFORM public.conta_rechazar_cobro_por_reembolso(v_pago.id,
            'Reembolso confirmado por el proveedor (' || v_pr.provider || ', ' || v_clave || ')');
          v_accion := 'cobro_rechazado';
          v_inc_t  := 'reembolso_aplicado';
          v_inc_d  := 'Reembolso confirmado por el proveedor: el cobro se rechazó y su asiento se reversó. Revisa el estado del documento que pagaba.';
        EXCEPTION WHEN OTHERS THEN
          -- E5: el bloqueo se mantiene y NO se descarta el reembolso.
          GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
          v_accion := 'rechazo_bloqueado';
          v_inc_t  := 'reembolso_bloqueado';
          v_inc_d  := 'Reembolso confirmado por el proveedor, pero el cobro no se pudo rechazar: ' || v_err
                      || ' El dinero ya se devolvió: resuelve el bloqueo (p. ej. revierte las aplicaciones de su saldo con una solicitud de ajuste) y anula el cobro.';
        END;
      END IF;
    ELSIF v_pr.estado = 'refunded' THEN
      v_accion := 'sin_cambio';
    ELSE
      v_accion := 'reembolso_sin_cobro';
      v_inc_t  := 'reembolso_sin_cobro';
      v_inc_d  := 'El proveedor informó un reembolso de una solicitud que no estaba acreditada (' || v_pr.estado || '). No se cambió nada.';
    END IF;

  ELSE
    -- pendiente / requiere_accion / error de consulta: nunca retrocede.
    v_accion := 'sin_cambio';
  END IF;

  INSERT INTO public.pasarela_eventos (
    id, company_id, payment_request_id, provider, clave_evento, estado_informado, origen,
    estado_previo, estado_resultante, resultado, detalle, payload)
  VALUES (
    v_ev, v_pr.company_id, v_pr.id, v_pr.provider, v_clave, p_estado, p_origen,
    v_prev, v_nuevo, v_accion, v_inc_d, p_payload);

  IF v_inc_t IS NOT NULL THEN
    INSERT INTO public.conta_incidencias_conciliacion (
      company_id, project_id, tipo, payment_request_id, pago_id, evento_id, monto, detalle)
    VALUES (
      v_pr.company_id,
      COALESCE(v_pago.project_id,
               (SELECT c.project_id FROM public.cuotas_condominio c WHERE c.id = v_pr.cuota_id),
               (SELECT ca.project_id FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_pr.cargo_adicional_id),
               (SELECT r.project_id FROM public.registros r WHERE r.id = v_pr.registro_id)),
      v_inc_t, v_pr.id, v_pago.id, v_ev, v_pr.monto, v_inc_d)
    RETURNING id INTO v_inc;
  END IF;

  RETURN v_conc || jsonb_build_object(
    'ok', true, 'duplicado', false, 'estado_previo', v_prev, 'estado', v_nuevo,
    'accion', v_accion, 'evento_id', v_ev, 'incidencia_id', v_inc);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pasarela_registrar_estado(uuid, text, text, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pasarela_registrar_estado(uuid, text, text, text, jsonb, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.pasarela_registrar_estado(uuid, text, text, text, jsonb, text, timestamptz) IS
  'service_role (confirm-charge, webhooks): registra un aviso del proveedor sobre una solicitud de cobro y aplica la única transición que corresponde. Deduplicado por (proveedor, clave). El estado sólo avanza: pending→succeeded|failed, failed→succeeded, succeeded→refunded. Un aviso contradictorio no revierte nada y abre una incidencia. Un reembolso intenta rechazar el cobro; si está bloqueado (COBRO_SALDO_FAVOR_APLICADO u otro) se conserva y abre una incidencia abierta.';

-- Resolver una incidencia (contabilidad), con nota.
CREATE FUNCTION public.conta_incidencia_resolver(p_id uuid, p_nota text)
RETURNS TABLE (incidencia_id uuid, estado text, repetida boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_i       public.conta_incidencias_conciliacion;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL OR NOT public.conta_puede_escribir('change_status') THEN
    RAISE EXCEPTION 'No autorizado para resolver incidencias de conciliación.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_nota, ''))) < 5 THEN
    RAISE EXCEPTION 'Indica cómo se resolvió (al menos 5 caracteres).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_i FROM public.conta_incidencias_conciliacion i
   WHERE i.id = p_id AND i.company_id = v_company
     AND (i.project_id IS NULL OR public.can_access_project(i.project_id))
     FOR UPDATE;
  IF v_i.id IS NULL THEN
    RAISE EXCEPTION 'La incidencia no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  IF v_i.estado = 'resuelta' THEN
    RETURN QUERY SELECT v_i.id, v_i.estado, true;
    RETURN;
  END IF;
  UPDATE public.conta_incidencias_conciliacion i
     SET estado = 'resuelta', resuelta_por = auth.uid(), resuelta_at = now(), nota_resolucion = btrim(p_nota)
   WHERE i.id = v_i.id;
  RETURN QUERY SELECT v_i.id, 'resuelta'::text, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_incidencia_resolver(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_incidencia_resolver(uuid, text) TO authenticated;
