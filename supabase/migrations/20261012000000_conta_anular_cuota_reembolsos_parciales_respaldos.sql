-- ============================================================================
-- CONTABILIDAD (bloque 3, cierre): ANULAR CUOTA POR SOLICITUD, REEMBOLSOS
-- PARCIALES DEL PROVEEDOR Y RESPALDO DOCUMENTAL DE LAS SOLICITUDES
--
-- Sobre 20261011000000 (mismo PR). Reutiliza sus reglas sin cambiarlas: sin
-- umbral, sin vencimiento, cuatro ojos (sólo el company_owner se autoaprueba,
-- con confirmación y marca auditada), revalidación con el documento
-- bloqueado y ejecución atómica.
--
-- 1. ANULAR CUOTA (tipo `anular_cuota`).
--    · Se solicita con motivo y la ejecuta la aprobación. La cuota pasa a
--      `anulada` con la hora del servidor; su devengo (y su mora) se
--      reversan con asientos de reverso VINCULADOS al original
--      (conta_reversar_automatico: fecha del original o, si su período está
--      cerrado, hoy). El documento y los asientos originales no se tocan.
--    · Evidencia en conta_cuota_anulaciones (inmutable): hora, actor,
--      solicitud, motivo y reversos.
--    · DEPENDENCIAS SIN CASCADA. Con cobros vivos, aplicaciones de saldo a
--      favor vivas, un cobro en línea en curso, una solicitud de aplicación
--      abierta o un devengo sin contabilizar/en borrador, la solicitud se
--      rechaza al pedirla y la ejecución falla al aprobarla
--      (AJUSTE_DEPENDENCIAS) con la lista. Nada se anula en cascada: cada
--      dependencia se resuelve por su propio camino. conta_ajuste_dependencias
--      las devuelve para la pantalla.
--    · SIN ATAJOS. Anular por UPDATE directo → CUOTA_ANULACION_SOLO_POR_SOLICITUD;
--      reactivar → CUOTA_ANULADA_DEFINITIVA; mover la fecha de anulación →
--      CUOTA_FECHA_ANULACION_FIJA. Eliminar (suave o duro) una cuota con
--      dependencias → CUOTA_CON_DEPENDENCIAS; una cuota EMITIDA (cualquier
--      estado distinto de `pendiente`) → CUOTA_ELIMINACION_SOLO_POR_SOLICITUD.
--      Una cuota aún `pendiente` (sin emitir: la de una reserva de amenidad)
--      y sin dependencias se sigue pudiendo eliminar como hasta ahora (su
--      devengo lo reversa conta_tg_cuotas): ver DECISIONES §E7, pendiente de
--      confirmar.
--    · Un cobro nuevo (o reactivado) sobre una cuota anulada se rechaza
--      (COBRO_CUOTA_ANULADA), bloqueando la cuota FOR SHARE: se serializa con
--      la aprobación, que la bloquea FOR UPDATE.
--
-- 2. REEMBOLSOS PARCIALES (pasarela_registrar_reembolso_parcial).
--    · Cada aviso se conserva (pasarela_eventos, deduplicado por proveedor y
--      clave) con lo que informó el proveedor: evento, referencia del pago,
--      importe ACUMULADO reembolsado, moneda y fecha del proveedor.
--    · pasarela_reembolsos guarda cada reembolso NUEVO: el aumento del
--      acumulado respecto del mayor ya visto. Repetido o fuera de orden (un
--      acumulado menor o igual) no suma nada. Único por (solicitud,
--      acumulado).
--    · Cada reembolso nuevo abre una incidencia `reembolso_parcial` para
--      conciliarla en Contabilidad. La solicitud de cobro sigue `succeeded` y
--      el cobro NO se rechaza: un reembolso parcial no es un rechazo.
--    · No se emite ningún reembolso y no se asume nada de QPayPro.
--
-- 3. RESPALDO DOCUMENTAL de las solicitudes.
--    · Bucket PRIVADO `ajustes-respaldos`, ruta <empresa>/<solicitud>/<archivo>.
--      Sube quien solicitó (o quien crea en Contabilidad) mientras la
--      solicitud está pendiente; lo ve quien ve la solicitud (empresa y
--      proyecto). Sin políticas de UPDATE ni DELETE: no se reemplaza ni se
--      borra.
--    · conta_ajustes_respaldos (sólo inserción) registra cada archivo con su
--      objeto, eTag, tamaño y tipo tomados de storage (no del cliente).
--    · Al aprobar, quien aprueba declara QUÉ respaldos revisó
--      (p_respaldos_revisados): si no coinciden con los registrados, o un
--      archivo cambió, no se aprueba. La fotografía de lo revisado queda en
--      conta_ajustes_solicitudes.respaldos_revisados. Al rechazar también.
--    · El motivo y la bitácora siguen siendo cosas distintas del respaldo.
--
-- CÓMO SE REVIERTE: restaurar conta_ajuste_revalidar, conta_ajuste_puede_solicitar,
-- conta_ajuste_solicitar, conta_ajuste_ejecutar, conta_ajuste_rechazar y
-- conta_ajuste_aprobar(uuid,text,boolean) de 20261011000000; DROP de los
-- triggers trg_cuota_solo_por_solicitud y trg_pago_cuota_anulada, de las
-- tablas y funciones nuevas, de las políticas del bucket; restaurar los CHECK
-- de conta_ajustes_solicitudes, conta_ajustes_eventos, pasarela_eventos y
-- conta_incidencias_conciliacion; DROP COLUMN respaldos_revisados y
-- conta_incidencias_conciliacion.reembolso_id.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TABLAS Y RESTRICCIONES
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.conta_ajustes_solicitudes DROP CONSTRAINT conta_ajustes_tipo_valido;
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_tipo_valido CHECK (tipo IN (
  'anular_cargo', 'anular_cobro_cargo', 'anular_anticipo',
  'revertir_aplicacion_saldo_favor', 'aplicar_saldo_favor', 'anular_cuota'));
ALTER TABLE public.conta_ajustes_solicitudes DROP CONSTRAINT conta_ajustes_documento_del_tipo;
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_documento_del_tipo CHECK (
     (tipo = 'anular_cargo'                    AND documento_tabla = 'cargos_adicionales_unidad')
  OR (tipo IN ('anular_cobro_cargo','anular_anticipo') AND documento_tabla = 'pagos')
  OR (tipo = 'revertir_aplicacion_saldo_favor' AND documento_tabla = 'conta_saldo_favor_aplicaciones')
  OR (tipo = 'aplicar_saldo_favor'             AND documento_tabla IN ('cuotas_condominio','cargos_adicionales_unidad'))
  OR (tipo = 'anular_cuota'                    AND documento_tabla = 'cuotas_condominio'));

-- Fotografía de los respaldos que vio quien revisó (aprobar o rechazar).
ALTER TABLE public.conta_ajustes_solicitudes ADD COLUMN respaldos_revisados jsonb;
COMMENT ON COLUMN public.conta_ajustes_solicitudes.respaldos_revisados IS
  'Respaldos documentales que declaró haber revisado quien aprobó o rechazó (id, ruta, objeto, eTag, tamaño, quién y cuándo se subió). NULL: sin revisión todavía.';

ALTER TABLE public.conta_ajustes_eventos DROP CONSTRAINT conta_ajustes_eventos_accion;
ALTER TABLE public.conta_ajustes_eventos ADD CONSTRAINT conta_ajustes_eventos_accion CHECK (accion IN (
  'solicitada', 'aprobada', 'autoaprobada', 'rechazada', 'cancelada',
  'ejecutada', 'fallida', 'reintento', 'respaldo_adjuntado'));

-- Evidencia de la anulación de una cuota.
CREATE TABLE public.conta_cuota_anulaciones (
  cuota_id            uuid        PRIMARY KEY REFERENCES public.cuotas_condominio(id) ON DELETE RESTRICT,
  company_id          uuid        NOT NULL,
  project_id          uuid        NOT NULL,
  solicitud_id        uuid        NOT NULL REFERENCES public.conta_ajustes_solicitudes(id) ON DELETE RESTRICT,
  anulado_at          timestamptz NOT NULL DEFAULT now(),
  anulado_por         uuid,
  motivo              text        NOT NULL,
  tenia_asiento       boolean     NOT NULL,
  reverso_emision_id  uuid        REFERENCES public.conta_asientos(id) ON DELETE RESTRICT,
  reverso_mora_id     uuid        REFERENCES public.conta_asientos(id) ON DELETE RESTRICT
);

CREATE INDEX idx_conta_cuota_anulaciones_empresa ON public.conta_cuota_anulaciones (company_id, project_id);
CREATE INDEX idx_conta_cuota_anulaciones_sol ON public.conta_cuota_anulaciones (solicitud_id);

COMMENT ON TABLE public.conta_cuota_anulaciones IS
  'Cuándo (hora del servidor), quién, por qué solicitud y con qué motivo se anuló una cuota, y los reversos de su devengo y su mora. Las anuladas antes de 20261012000000 no tienen fila.';

CREATE TRIGGER trg_conta_cuota_anulaciones_inmutable
  BEFORE UPDATE OR DELETE ON public.conta_cuota_anulaciones
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_bitacora_inmutable();

-- Reembolsos parciales informados por el proveedor.
ALTER TABLE public.pasarela_eventos DROP CONSTRAINT pasarela_eventos_estado;
ALTER TABLE public.pasarela_eventos ADD CONSTRAINT pasarela_eventos_estado CHECK (estado_informado IN (
  'aprobado', 'pendiente', 'requiere_accion', 'rechazado', 'error', 'reembolsado', 'reembolso_parcial'));

CREATE TABLE public.pasarela_reembolsos (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid          NOT NULL,
  payment_request_id uuid          NOT NULL REFERENCES public.payment_requests(id) ON DELETE RESTRICT,
  pago_id            uuid,
  provider           text          NOT NULL,
  evento_id          uuid          NOT NULL REFERENCES public.pasarela_eventos(id) ON DELETE RESTRICT,
  clave_evento       text          NOT NULL,
  referencia_pago    text,
  reembolso_ref      text,
  importe            numeric(14,2) NOT NULL,
  acumulado          numeric(14,2) NOT NULL,
  moneda             text          NOT NULL,
  fecha_proveedor    timestamptz,
  registrado_at      timestamptz   NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pasarela_reembolsos_importes CHECK (importe > 0 AND acumulado >= importe),
  CONSTRAINT pasarela_reembolsos_acumulado_unico UNIQUE (payment_request_id, acumulado)
);

CREATE INDEX idx_pasarela_reembolsos_empresa ON public.pasarela_reembolsos (company_id, registrado_at DESC);
CREATE INDEX idx_pasarela_reembolsos_evento ON public.pasarela_reembolsos (evento_id);

COMMENT ON TABLE public.pasarela_reembolsos IS
  'Cada reembolso que el proveedor informó sobre un cobro en línea: importe (aumento del acumulado respecto del mayor ya visto), acumulado, moneda, fecha del proveedor, referencia del pago y del reembolso, y el evento que lo trajo. Un aviso repetido o fuera de orden no agrega fila. Nunca se borra.';

CREATE TRIGGER trg_pasarela_reembolsos_inmutable
  BEFORE UPDATE OR DELETE ON public.pasarela_reembolsos
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_bitacora_inmutable();

ALTER TABLE public.conta_incidencias_conciliacion DROP CONSTRAINT conta_incidencias_tipo;
ALTER TABLE public.conta_incidencias_conciliacion ADD CONSTRAINT conta_incidencias_tipo CHECK (tipo IN (
  'reembolso_bloqueado', 'reembolso_aplicado', 'rechazo_tras_aprobacion',
  'aprobado_tras_reembolso', 'reembolso_sin_cobro', 'reembolso_parcial'));
ALTER TABLE public.conta_incidencias_conciliacion
  ADD COLUMN reembolso_id uuid REFERENCES public.pasarela_reembolsos(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_conta_incidencias_reembolso ON public.conta_incidencias_conciliacion (reembolso_id)
  WHERE reembolso_id IS NOT NULL;

-- Respaldos documentales de las solicitudes.
CREATE TABLE public.conta_ajustes_respaldos (
  -- Clave de idempotencia: la genera el cliente.
  id              uuid        PRIMARY KEY,
  solicitud_id    uuid        NOT NULL REFERENCES public.conta_ajustes_solicitudes(id) ON DELETE RESTRICT,
  company_id      uuid        NOT NULL,
  project_id      uuid        NOT NULL,
  storage_path    text        NOT NULL UNIQUE,
  objeto_id       uuid        NOT NULL,
  nombre_archivo  text        NOT NULL,
  mime            text,
  tamano          bigint,
  etag            text,
  sha256          text,
  descripcion     text,
  subido_por      uuid        NOT NULL,
  subido_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conta_ajustes_respaldos_sha256 CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_conta_ajustes_respaldos_sol ON public.conta_ajustes_respaldos (solicitud_id, subido_at);
CREATE INDEX idx_conta_ajustes_respaldos_empresa ON public.conta_ajustes_respaldos (company_id, project_id);

COMMENT ON TABLE public.conta_ajustes_respaldos IS
  'Documentos de respaldo de una solicitud de ajuste (bucket privado ajustes-respaldos). Sólo se agregan mientras la solicitud está pendiente; no se reemplazan ni se borran. El motivo de la solicitud y su bitácora NO son respaldo.';

CREATE TRIGGER trg_conta_ajustes_respaldos_inmutable
  BEFORE UPDATE OR DELETE ON public.conta_ajustes_respaldos
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_bitacora_inmutable();

-- ── RLS y grants: la aplicación sólo LEE ─────────────────────────────────────
ALTER TABLE public.conta_cuota_anulaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pasarela_reembolsos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_ajustes_respaldos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conta_cuota_anulaciones_select" ON public.conta_cuota_anulaciones
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));

CREATE POLICY "pasarela_reembolsos_select" ON public.pasarela_reembolsos
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND ((SELECT public.conta_puede_escribir('view')) OR (SELECT public.user_has_permission('platform.contabilidad.view')))));

CREATE POLICY "conta_ajustes_respaldos_select" ON public.conta_ajustes_respaldos
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));

REVOKE ALL ON public.conta_cuota_anulaciones, public.pasarela_reembolsos, public.conta_ajustes_respaldos
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_cuota_anulaciones, public.pasarela_reembolsos, public.conta_ajustes_respaldos
  TO authenticated;
GRANT ALL ON public.conta_cuota_anulaciones, public.pasarela_reembolsos, public.conta_ajustes_respaldos
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. DEPENDENCIAS DE UNA CUOTA (lo que impide anularla o eliminarla)
-- ═══════════════════════════════════════════════════════════════════════════
-- INTERNA. p_para_anular agrega el devengo sin contabilizar o en borrador:
-- al eliminar lo reversa conta_tg_cuotas y el reproceso lo bloquea; al
-- anular, un devengo que aparece después quedaría vivo en una cuota anulada.
CREATE FUNCTION public.conta_cuota_dependencias(p_cuota uuid, p_para_anular boolean)
RETURNS TABLE (dependencia text, id uuid, monto numeric, estado text, detalle text, como_resolver text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH c AS (SELECT * FROM public.cuotas_condominio c WHERE c.id = p_cuota)
  SELECT 'cobro'::text, p.id, p.monto, p.estado,
         'Cobro ' || COALESCE(p.metodo, '') || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '')
           || ' del ' || to_char(COALESCE(p.verified_at, p.created_at), 'YYYY-MM-DD'),
         'Recházalo o anúlalo en Pagos antes de anular la cuota.'
    FROM c JOIN public.pagos p ON (p.cuota_id = c.id OR p.id = c.pago_id)
   WHERE p.deleted_at IS NULL AND p.estado IS DISTINCT FROM 'rechazado'
  UNION ALL
  SELECT 'aplicacion_saldo_favor', x.id, x.monto, 'viva',
         'Aplicación de saldo a favor del ' || to_char(x.created_at, 'YYYY-MM-DD'),
         'Solicita revertir la aplicación (Contabilidad › Saldos a favor).'
    FROM c JOIN public.conta_saldo_favor_aplicaciones x ON x.cuota_id = c.id
   WHERE x.revertida_at IS NULL
  UNION ALL
  SELECT 'cobro_en_linea', pr.id, pr.monto, pr.estado,
         'Pago en línea en curso (' || pr.provider || ')',
         'Espera la confirmación o el rechazo del proveedor.'
    FROM c JOIN public.payment_requests pr ON pr.cuota_id = c.id
   WHERE pr.estado IN ('pending','pending_verification')
  UNION ALL
  SELECT 'solicitud_aplicacion', s.id, s.importe, s.estado,
         'Solicitud abierta de aplicar saldo a favor',
         'Recházala o que la cancele quien la pidió.'
    FROM c JOIN public.conta_ajustes_solicitudes s
      ON s.tipo = 'aplicar_saldo_favor' AND s.documento_id = c.id
   WHERE s.estado IN ('pendiente','fallida')
  UNION ALL
  SELECT 'devengo_borrador', a.id, a.total_debe, a.estado,
         'Asiento de ' || a.origen_evento || ' en ' || a.estado,
         'Publícalo o anúlalo en Contabilidad antes de anular la cuota.'
    FROM c JOIN public.conta_asientos a
      ON a.company_id = c.company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = c.id
     AND a.origen_evento IN ('cuota_emitida','cuota_mora')
   WHERE p_para_anular AND a.estado NOT IN ('publicado','anulado')
  UNION ALL
  SELECT DISTINCT ON (i.evento) 'devengo_pendiente', i.id, NULL::numeric, i.evento,
         'Contabilización pendiente de ' || i.evento,
         'Reprocésala (Contabilidad › Pendientes) antes de anular la cuota.'
    FROM c JOIN public.conta_intentos_contabilizacion i
      ON i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id
   WHERE p_para_anular
     AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                      WHERE a.company_id = c.company_id AND a.origen = 'automatico'
                        AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = c.id
                        AND a.origen_evento = i.evento AND a.estado <> 'anulado')
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuota_dependencias(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Lanza AJUSTE_DEPENDENCIAS (o p_codigo) con la lista, si hay alguna.
CREATE FUNCTION public.conta_cuota_exigir_sin_dependencias(p_cuota uuid, p_para_anular boolean, p_codigo text)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lista text;
  v_n     integer;
BEGIN
  SELECT count(*), string_agg(d.detalle || COALESCE(' por ' || to_char(d.monto, 'FM999999990.00'), '')
                              || ' [' || d.dependencia || ' ' || left(d.id::text, 8) || ']: ' || d.como_resolver,
                              '; ' ORDER BY d.dependencia, d.id)
    INTO v_n, v_lista
    FROM public.conta_cuota_dependencias(p_cuota, p_para_anular) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION '%: la cuota tiene % operación(es) viva(s) que lo impiden y no se anulan en cascada. Resuélvelas primero: %',
      p_codigo, v_n, v_lista USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuota_exigir_sin_dependencias(uuid, boolean, text) FROM PUBLIC, anon, authenticated;

-- Para la pantalla: qué impide anular un documento. Cuota: todo lo anterior.
-- Cargo adicional: sus cobros y aplicaciones vivas (lo que hoy hace fallar la
-- anulación con CARGO_CON_COBROS o COBRO_SALDO_FAVOR_APLICADO).
CREATE FUNCTION public.conta_ajuste_dependencias(p_tipo text, p_documento_id uuid)
RETURNS TABLE (dependencia text, id uuid, monto numeric, estado text, detalle text, como_resolver text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión con empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('anular_cuota','anular_cargo') THEN
    RAISE EXCEPTION 'AJUSTE_TIPO: sólo se consultan dependencias de anular_cuota y anular_cargo.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.conta_ajuste_puede_solicitar(p_tipo) THEN
    RAISE EXCEPTION 'No autorizado para solicitar este ajuste.' USING ERRCODE = '42501';
  END IF;

  IF p_tipo = 'anular_cuota' THEN
    IF NOT EXISTS (SELECT 1 FROM public.cuotas_condominio c
                    WHERE c.id = p_documento_id AND c.company_id = v_company
                      AND public.can_access_project(c.project_id)) THEN
      RAISE EXCEPTION 'El documento no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
    END IF;
    RETURN QUERY SELECT * FROM public.conta_cuota_dependencias(p_documento_id, true);
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.cargos_adicionales_unidad ca
                    WHERE ca.id = p_documento_id AND ca.company_id = v_company
                      AND public.can_access_project(ca.project_id)) THEN
      RAISE EXCEPTION 'El documento no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
    END IF;
    RETURN QUERY
      SELECT 'cobro'::text, p.id, p.monto, p.estado,
             'Cobro ' || COALESCE(p.metodo, '') || COALESCE(' ref. ' || NULLIF(p.referencia, ''), ''),
             'Solicita anular el cobro antes de anular el cargo.'
        FROM public.pagos p
       WHERE p.cargo_adicional_id = p_documento_id AND p.deleted_at IS NULL
         AND p.estado IS DISTINCT FROM 'rechazado'
      UNION ALL
      SELECT 'aplicacion_saldo_favor', x.id, x.monto, 'viva',
             'Aplicación de saldo a favor del ' || to_char(x.created_at, 'YYYY-MM-DD'),
             'Solicita revertir la aplicación (Contabilidad › Saldos a favor).'
        FROM public.conta_saldo_favor_aplicaciones x
       WHERE x.cargo_adicional_id = p_documento_id AND x.revertida_at IS NULL;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_dependencias(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_dependencias(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_ajuste_dependencias(text, uuid) IS
  'Lo que impide anular una cuota o un cargo adicional (cobros, aplicaciones de saldo a favor, cobro en línea en curso, solicitud abierta, devengo pendiente o en borrador), con cómo resolverlo. Nada se anula en cascada.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. REVALIDACIÓN (cuerpo de 20261011000000 + anular_cuota)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.conta_ajuste_revalidar(p_sol public.conta_ajustes_solicitudes)
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
  IF v_ahora IS NULL
     OR (p_sol.tipo = 'anular_cuota'
         AND EXISTS (SELECT 1 FROM public.cuotas_condominio c
                      WHERE c.id = p_sol.documento_id AND c.deleted_at IS NOT NULL)) THEN
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

  -- ANULAR CUOTA: no anulada ya, y sin dependencias vivas (con la cuota
  -- bloqueada: un cobro nuevo espera a esta transacción y ve la anulación).
  IF p_sol.tipo = 'anular_cuota' THEN
    IF v_ahora ->> 'estado' = 'anulada' THEN
      RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: la cuota ya está anulada.' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM public.conta_cuota_exigir_sin_dependencias(p_sol.documento_id, true, 'AJUSTE_DEPENDENCIAS');
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SOLICITAR (cuerpos de 20261011000000 + anular_cuota)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.conta_ajuste_puede_solicitar(p_tipo text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_tipo IN ('anular_cargo','anular_cobro_cargo','anular_anticipo','anular_cuota') THEN
         public.is_super_admin()
      OR public.current_user_role() = ANY (ARRAY['company_owner','admin'])
      OR public.user_has_permission('platform.condominios.edit')
      OR public.conta_puede_escribir('create')
    ELSE public.conta_puede_escribir('create')
  END
$$;

CREATE OR REPLACE FUNCTION public.conta_ajuste_solicitar(
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
  v_cuota   public.cuotas_condominio;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('anular_cargo','anular_cobro_cargo','anular_anticipo',
                                      'revertir_aplicacion_saldo_favor','aplicar_saldo_favor',
                                      'anular_cuota') THEN
    RAISE EXCEPTION 'AJUSTE_TIPO: tipo de solicitud inválido: %', p_tipo USING ERRCODE = '22023';
  END IF;
  IF NOT public.conta_ajuste_puede_solicitar(p_tipo) THEN
    RAISE EXCEPTION 'No autorizado para solicitar este ajuste.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(v_company);

  v_previa := EXISTS (SELECT 1 FROM public.conta_ajustes_solicitudes s WHERE s.id = p_id);

  -- ANULAR CUOTA: se informa AHORA lo que lo impide (no al aprobar).
  IF p_tipo = 'anular_cuota' AND NOT v_previa THEN
    SELECT * INTO v_cuota FROM public.cuotas_condominio c
     WHERE c.id = p_documento_id AND c.company_id = v_company AND public.can_access_project(c.project_id);
    IF v_cuota.id IS NULL OR v_cuota.deleted_at IS NOT NULL OR p_documento_tabla IS DISTINCT FROM 'cuotas_condominio' THEN
      RAISE EXCEPTION 'El documento no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
    END IF;
    IF v_cuota.cuota_estado = 'anulada' THEN
      RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: la cuota ya está anulada.' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM public.conta_cuota_exigir_sin_dependencias(p_documento_id, true, 'AJUSTE_DEPENDENCIAS');
  END IF;

  v_sol := public.conta_ajuste_alta(p_id, v_company, p_tipo, p_documento_tabla, p_documento_id,
                                    p_saldo_origen_id, p_importe, p_motivo, 'backoffice', NULL);
  RETURN QUERY SELECT v_sol.id, v_sol.estado, v_previa;
END;
$$;

COMMENT ON FUNCTION public.conta_ajuste_solicitar(uuid, text, text, uuid, text, uuid, numeric) IS
  'Solicita un ajuste con motivo (anular un cargo, una cuota o un cobro de cargo, anular un anticipo, revertir o aplicar un saldo a favor). No cambia nada: lo ejecuta la aprobación de otra persona. Idempotente por p_id; una solicitud abierta por documento. Anular una cuota con dependencias vivas se rechaza con la lista (AJUSTE_DEPENDENCIAS).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. EJECUTAR (cuerpo de 20261011000000 + anular_cuota)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.conta_ajuste_ejecutar(p_sol public.conta_ajustes_solicitudes, p_accion text)
RETURNS public.conta_ajustes_solicitudes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sol   public.conta_ajustes_solicitudes := p_sol;
  v_res   jsonb;
  v_rev   uuid;
  v_rev_m uuid;
  v_tenia boolean;
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
    ELSIF v_sol.tipo = 'anular_cuota' THEN
      -- La cuota queda anulada con la hora del servidor (el estado de cuenta
      -- la ubica al corte por anulada_at). Su devengo y su mora se reversan
      -- con asientos vinculados; los originales no se tocan.
      v_tenia := EXISTS (SELECT 1 FROM public.conta_asientos a
                          WHERE a.company_id = v_sol.company_id AND a.origen = 'automatico'
                            AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = v_sol.documento_id
                            AND a.origen_evento IN ('cuota_emitida','cuota_mora') AND a.estado = 'publicado');
      UPDATE public.cuotas_condominio c
         SET cuota_estado = 'anulada', anulada_at = now()
       WHERE c.id = v_sol.documento_id;
      v_rev := public.conta_reversar_automatico(v_sol.company_id, 'cuotas_condominio', v_sol.documento_id,
                 'cuota_emitida', 'Cuota anulada (solicitud ' || left(v_sol.id::text, 8) || ')');
      v_rev_m := public.conta_reversar_automatico(v_sol.company_id, 'cuotas_condominio', v_sol.documento_id,
                 'cuota_mora', 'Mora de cuota anulada (solicitud ' || left(v_sol.id::text, 8) || ')');
      -- conta_reversar_automatico no lanza: si algo quedó sin reversar, se
      -- deshace todo.
      IF EXISTS (SELECT 1 FROM public.conta_asientos a
                  WHERE a.company_id = v_sol.company_id AND a.origen = 'automatico'
                    AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = v_sol.documento_id
                    AND a.origen_evento IN ('cuota_emitida','cuota_mora')
                    AND a.estado = 'publicado' AND a.anulado_por_id IS NULL) THEN
        RAISE EXCEPTION 'AJUSTE_REVERSO_FALLO: no se pudo reversar el devengo de la cuota; no se anuló. Revisa el registro del servidor y reintenta.'
          USING ERRCODE = 'check_violation';
      END IF;
      INSERT INTO public.conta_cuota_anulaciones
        (cuota_id, company_id, project_id, solicitud_id, anulado_por, motivo, tenia_asiento,
         reverso_emision_id, reverso_mora_id)
      VALUES (v_sol.documento_id, v_sol.company_id, v_sol.project_id, v_sol.id, auth.uid(), v_sol.motivo,
              v_tenia, v_rev, v_rev_m);
      SELECT to_jsonb(an) INTO v_res FROM public.conta_cuota_anulaciones an WHERE an.cuota_id = v_sol.documento_id;
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. CUOTAS: anulación sólo por solicitud; eliminación sólo sin emitir y sin
--    dependencias; un cobro no entra en una cuota anulada
-- ═══════════════════════════════════════════════════════════════════════════
CREATE FUNCTION public.conta_cuota_exigir_eliminable(p_cuota public.cuotas_condominio)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.conta_cuota_exigir_sin_dependencias(p_cuota.id, false, 'CUOTA_CON_DEPENDENCIAS');
  IF COALESCE(p_cuota.cuota_estado, 'pendiente') <> 'pendiente' THEN
    RAISE EXCEPTION 'CUOTA_ELIMINACION_SOLO_POR_SOLICITUD: la cuota ya está % y no se elimina: solicita su anulación con motivo (la aprueba otra persona).',
      p_cuota.cuota_estado USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuota_exigir_eliminable(public.cuotas_condominio) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.conta_tg_cuota_solo_por_solicitud()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Cascada de empresa/proyecto (nivel > 1) o purga de una ya eliminada.
    IF pg_trigger_depth() > 1 OR OLD.deleted_at IS NOT NULL THEN
      RETURN OLD;
    END IF;
    PERFORM public.conta_cuota_exigir_eliminable(OLD);
    RETURN OLD;
  END IF;

  IF NEW.cuota_estado = 'anulada' AND OLD.cuota_estado IS DISTINCT FROM 'anulada' THEN
    IF public.conta_ajuste_en_ejecucion('anular_cuota', NEW.id) IS NULL THEN
      RAISE EXCEPTION 'CUOTA_ANULACION_SOLO_POR_SOLICITUD: la anulación de una cuota se solicita con motivo y la ejecuta la aprobación de otra persona. No se anuló.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.cuota_estado = 'anulada' AND NEW.cuota_estado IS DISTINCT FROM 'anulada' THEN
    RAISE EXCEPTION 'CUOTA_ANULADA_DEFINITIVA: una cuota anulada no se reactiva; emite una cuota nueva.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- La fecha de anulación ubica la cuota en los cortes históricos: no se
  -- mueve ni se pone fuera de la anulación.
  IF NEW.anulada_at IS DISTINCT FROM OLD.anulada_at
     AND (OLD.anulada_at IS NOT NULL
          OR public.conta_ajuste_en_ejecucion('anular_cuota', NEW.id) IS NULL) THEN
    RAISE EXCEPTION 'CUOTA_FECHA_ANULACION_FIJA: la fecha de anulación la pone el servidor al ejecutar la solicitud y no se cambia.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    PERFORM public.conta_cuota_exigir_eliminable(OLD);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_cuota_solo_por_solicitud() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cuota_solo_por_solicitud
  BEFORE UPDATE OF cuota_estado, anulada_at, deleted_at OR DELETE ON public.cuotas_condominio
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_cuota_solo_por_solicitud();

-- Un cobro vivo NUEVO (o que vuelve a estar vivo, o que cambia de cuota)
-- sobre una cuota anulada. FOR SHARE: espera a una anulación en curso (que
-- tiene la cuota FOR UPDATE) y la ve; o la anulación espera a este cobro y
-- lo encuentra como dependencia.
CREATE FUNCTION public.conta_tg_pago_cuota_anulada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado text;
BEGIN
  IF NEW.cuota_id IS NULL OR NEW.deleted_at IS NOT NULL OR NEW.estado = 'rechazado' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.cuota_id IS NOT DISTINCT FROM OLD.cuota_id
     AND OLD.deleted_at IS NULL AND OLD.estado IS DISTINCT FROM 'rechazado' THEN
    RETURN NEW;
  END IF;
  SELECT c.cuota_estado INTO v_estado FROM public.cuotas_condominio c WHERE c.id = NEW.cuota_id FOR SHARE;
  IF v_estado = 'anulada' THEN
    RAISE EXCEPTION 'COBRO_CUOTA_ANULADA: la cuota está anulada; no admite cobros.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_pago_cuota_anulada() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_pago_cuota_anulada
  BEFORE INSERT OR UPDATE OF cuota_id, estado, deleted_at ON public.pagos
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_pago_cuota_anulada();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. RESPALDOS: bucket privado, políticas, registro
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ajustes-respaldos', 'ajustes-respaldos', false, 15728640,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- La solicitud a la que apunta una ruta <empresa>/<solicitud>/<archivo>, si
-- es de la empresa de la sesión y de un proyecto al que tiene acceso.
CREATE FUNCTION public.conta_ajuste_respaldo_solicitud(p_name text)
RETURNS public.conta_ajustes_solicitudes
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_f   text[] := storage.foldername(p_name);
  v_sol public.conta_ajustes_solicitudes;
BEGIN
  IF v_f IS NULL OR array_length(v_f, 1) IS DISTINCT FROM 2
     OR v_f[1] IS DISTINCT FROM public.get_my_company_id()::text
     OR v_f[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_sol FROM public.conta_ajustes_solicitudes s
   WHERE s.id = v_f[2]::uuid AND s.company_id::text = v_f[1]
     AND public.can_access_project(s.project_id);
  RETURN v_sol;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_respaldo_solicitud(text) FROM PUBLIC, anon, authenticated;

-- Subir: la solicitud está pendiente y quien sube la pidió o crea en
-- Contabilidad.
CREATE FUNCTION public.conta_ajuste_respaldo_puede_subir(p_name text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sol public.conta_ajustes_solicitudes := public.conta_ajuste_respaldo_solicitud(p_name);
BEGIN
  RETURN v_sol.id IS NOT NULL AND v_sol.estado = 'pendiente'
     AND (v_sol.solicitado_por = auth.uid() OR public.conta_puede_escribir('create'));
END;
$$;

-- Ver: quien ve la solicitud (misma regla que su RLS).
CREATE FUNCTION public.conta_ajuste_respaldo_puede_ver(p_name text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (public.conta_ajuste_respaldo_solicitud(p_name)).id IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_respaldo_puede_subir(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.conta_ajuste_respaldo_puede_ver(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_respaldo_puede_subir(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_respaldo_puede_ver(text) TO authenticated;

DROP POLICY IF EXISTS "ajustes_respaldos_select" ON storage.objects;
DROP POLICY IF EXISTS "ajustes_respaldos_insert" ON storage.objects;

CREATE POLICY "ajustes_respaldos_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ajustes-respaldos' AND public.conta_ajuste_respaldo_puede_ver(name));

CREATE POLICY "ajustes_respaldos_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ajustes-respaldos' AND public.conta_ajuste_respaldo_puede_subir(name));
-- Sin UPDATE ni DELETE: un respaldo no se reemplaza ni se borra.

-- Registrar un archivo ya subido como respaldo de la solicitud. Los metadatos
-- salen de storage (no del cliente). Idempotente por p_id.
CREATE FUNCTION public.conta_ajuste_adjuntar_respaldo(
  p_id           uuid,
  p_solicitud_id uuid,
  p_storage_path text,
  p_descripcion  text DEFAULT NULL,
  p_sha256       text DEFAULT NULL
)
RETURNS TABLE (respaldo_id uuid, repetida boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_sol     public.conta_ajustes_solicitudes;
  v_obj     record;
  v_existe  public.conta_ajustes_respaldos;
  v_sha     text := lower(NULLIF(btrim(COALESCE(p_sha256, '')), ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL OR p_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;

  -- Serializa con la revisión (que bloquea la solicitud FOR UPDATE).
  SELECT * INTO v_sol FROM public.conta_ajustes_solicitudes s
   WHERE s.id = p_solicitud_id AND s.company_id = v_company AND public.can_access_project(s.project_id)
     FOR UPDATE;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_sol.solicitado_por = auth.uid() OR public.conta_puede_escribir('create')) THEN
    RAISE EXCEPTION 'No autorizado: adjunta respaldo quien pidió la solicitud o quien crea en Contabilidad.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existe FROM public.conta_ajustes_respaldos r WHERE r.id = p_id;
  IF v_existe.id IS NOT NULL THEN
    IF v_existe.solicitud_id IS DISTINCT FROM p_solicitud_id OR v_existe.storage_path IS DISTINCT FROM p_storage_path THEN
      RAISE EXCEPTION 'AJUSTE_CLAVE_REUSADA: esa clave ya identifica otro respaldo. No se registró nada.' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existe.id, true;
    RETURN;
  END IF;

  IF v_sol.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'AJUSTE_RESPALDO_CERRADO: la solicitud está % y su respaldo ya se revisó; no se agregan ni se cambian archivos.',
      v_sol.estado USING ERRCODE = 'check_violation';
  END IF;
  IF p_storage_path IS NULL
     OR p_storage_path NOT LIKE v_company::text || '/' || v_sol.id::text || '/%'
     OR array_length(storage.foldername(p_storage_path), 1) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'AJUSTE_RESPALDO_RUTA: el archivo debe estar en %/%/.', v_company, v_sol.id USING ERRCODE = '22023';
  END IF;
  IF v_sha IS NOT NULL AND v_sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'AJUSTE_RESPALDO_HASH: el sha256 debe tener 64 dígitos hexadecimales.' USING ERRCODE = '22023';
  END IF;

  SELECT o.id, o.name, o.metadata INTO v_obj FROM storage.objects o
   WHERE o.bucket_id = 'ajustes-respaldos' AND o.name = p_storage_path;
  IF v_obj.id IS NULL THEN
    RAISE EXCEPTION 'AJUSTE_RESPALDO_SIN_ARCHIVO: el archivo no está en el almacenamiento; súbelo primero.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conta_ajustes_respaldos r WHERE r.storage_path = p_storage_path) THEN
    RAISE EXCEPTION 'AJUSTE_RESPALDO_DUPLICADO: ese archivo ya es respaldo de la solicitud.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.conta_ajustes_respaldos (
    id, solicitud_id, company_id, project_id, storage_path, objeto_id, nombre_archivo,
    mime, tamano, etag, sha256, descripcion, subido_por)
  VALUES (
    p_id, v_sol.id, v_sol.company_id, v_sol.project_id, p_storage_path, v_obj.id,
    storage.filename(p_storage_path),
    v_obj.metadata ->> 'mimetype', NULLIF(v_obj.metadata ->> 'size', '')::bigint, v_obj.metadata ->> 'eTag',
    v_sha, NULLIF(btrim(COALESCE(p_descripcion, '')), ''), auth.uid());

  PERFORM public.conta_ajuste_evento(v_sol, 'respaldo_adjuntado', v_sol.estado, v_sol.estado,
                                     storage.filename(p_storage_path));
  RETURN QUERY SELECT p_id, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_adjuntar_respaldo(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_adjuntar_respaldo(uuid, uuid, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.conta_ajuste_adjuntar_respaldo(uuid, uuid, text, text, text) IS
  'Registra como respaldo de una solicitud PENDIENTE un archivo ya subido al bucket privado ajustes-respaldos (<empresa>/<solicitud>/<archivo>). Los metadatos (objeto, eTag, tamaño, tipo) se toman de storage. Idempotente por p_id. Después de revisada la solicitud no se agregan ni cambian archivos.';

-- Fotografía de los respaldos de una solicitud, verificando que cada archivo
-- siga en storage con el mismo eTag (INTERNA). Lanza si alguno cambió.
CREATE FUNCTION public.conta_ajuste_respaldos_foto(p_solicitud uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_r    record;
  v_foto jsonb := '[]'::jsonb;
BEGIN
  FOR v_r IN
    SELECT r.*, o.id AS o_id, o.metadata ->> 'eTag' AS o_etag
      FROM public.conta_ajustes_respaldos r
      LEFT JOIN storage.objects o ON o.bucket_id = 'ajustes-respaldos' AND o.name = r.storage_path
     WHERE r.solicitud_id = p_solicitud
     ORDER BY r.subido_at, r.id
  LOOP
    IF v_r.o_id IS DISTINCT FROM v_r.objeto_id OR v_r.o_etag IS DISTINCT FROM v_r.etag THEN
      RAISE EXCEPTION 'AJUSTE_RESPALDO_ALTERADO: el archivo de respaldo % ya no es el que se adjuntó (falta o cambió). No se revisó la solicitud.',
        v_r.nombre_archivo USING ERRCODE = 'check_violation';
    END IF;
    v_foto := v_foto || jsonb_build_object(
      'id', v_r.id, 'ruta', v_r.storage_path, 'objeto_id', v_r.objeto_id, 'etag', v_r.etag,
      'tamano', v_r.tamano, 'mime', v_r.mime, 'sha256', v_r.sha256,
      'subido_por', v_r.subido_por, 'subido_at', v_r.subido_at);
  END LOOP;
  RETURN v_foto;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_respaldos_foto(uuid) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. APROBAR (con los respaldos revisados) Y RECHAZAR
-- ═══════════════════════════════════════════════════════════════════════════
-- Nueva firma: p_respaldos_revisados. Cuerpo de 20261011000000 + la
-- comprobación de respaldos antes de marcar la revisión.
DROP FUNCTION public.conta_ajuste_aprobar(uuid, text, boolean);

CREATE FUNCTION public.conta_ajuste_aprobar(
  p_id                        uuid,
  p_nota                      text DEFAULT NULL,
  p_confirmar_autoaprobacion  boolean DEFAULT false,
  p_respaldos_revisados       uuid[] DEFAULT NULL
)
RETURNS TABLE (solicitud_id uuid, estado text, repetida boolean, autoaprobada boolean,
               resultado jsonb, error_ejecucion text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sol   public.conta_ajustes_solicitudes;
  v_auto  boolean := false;
  v_foto  jsonb;
  v_hay   uuid[];
  v_vistos uuid[];
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

  -- RESPALDOS: se aprueba lo que se revisó. Si hay archivos, quien aprueba
  -- declara cuáles vio; si difieren de los registrados (llegó uno después
  -- de abrir la solicitud) o alguno cambió en storage, no se aprueba.
  SELECT COALESCE(array_agg(r.id ORDER BY r.id), '{}') INTO v_hay
    FROM public.conta_ajustes_respaldos r WHERE r.solicitud_id = v_sol.id;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_vistos
    FROM unnest(COALESCE(p_respaldos_revisados, '{}'::uuid[])) x;
  IF cardinality(v_hay) > 0 AND p_respaldos_revisados IS NULL THEN
    RAISE EXCEPTION 'AJUSTE_RESPALDOS_SIN_REVISAR: la solicitud tiene % respaldo(s); ábrelos e indica cuáles revisaste.',
      cardinality(v_hay) USING ERRCODE = 'check_violation';
  END IF;
  IF p_respaldos_revisados IS NOT NULL AND v_vistos IS DISTINCT FROM v_hay THEN
    RAISE EXCEPTION 'AJUSTE_RESPALDOS_CAMBIARON: los respaldos de la solicitud no son los que revisaste (hay %, revisaste %). Vuelve a abrirla.',
      cardinality(v_hay), cardinality(v_vistos) USING ERRCODE = 'check_violation';
  END IF;
  v_foto := public.conta_ajuste_respaldos_foto(v_sol.id);

  UPDATE public.conta_ajustes_solicitudes s
     SET revisado_por = auth.uid(), revisado_at = now(),
         motivo_revision = NULLIF(btrim(COALESCE(p_nota, '')), ''),
         autoaprobada = v_auto, respaldos_revisados = v_foto, updated_at = now()
   WHERE s.id = v_sol.id
  RETURNING * INTO v_sol;
  PERFORM public.conta_ajuste_evento(v_sol, CASE WHEN v_auto THEN 'autoaprobada' ELSE 'aprobada' END,
    'pendiente', 'pendiente', NULLIF(btrim(COALESCE(p_nota, '')), ''));

  v_sol := public.conta_ajuste_ejecutar(v_sol, 'aprobar');
  RETURN QUERY SELECT v_sol.id, v_sol.estado, false, v_sol.autoaprobada, v_sol.resultado, v_sol.error_ejecucion;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_aprobar(uuid, text, boolean, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_aprobar(uuid, text, boolean, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.conta_ajuste_aprobar(uuid, text, boolean, uuid[]) IS
  'Aprueba una solicitud de ajuste y la ejecuta en la misma transacción, revalidando documento, período y saldo con el documento bloqueado. Quien solicita no aprueba (E1); sólo el company_owner puede autoaprobarse, con p_confirmar_autoaprobacion = true, y queda marcado. Con respaldos, p_respaldos_revisados debe listar exactamente los registrados y ninguno puede haber cambiado; su fotografía queda en respaldos_revisados. Repetirla devuelve el resultado sin ejecutar otra vez. Si la ejecución falla no queda nada escrito y la solicitud queda «fallida».';

CREATE OR REPLACE FUNCTION public.conta_ajuste_rechazar(p_id uuid, p_motivo text)
RETURNS TABLE (solicitud_id uuid, estado text, repetida boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sol  public.conta_ajustes_solicitudes;
  v_prev text;
  v_foto jsonb;
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
  -- Lo que había de respaldo al rechazar (si un archivo falta o cambió, el
  -- rechazo procede igual y la fotografía lo dice).
  BEGIN
    v_foto := COALESCE(v_sol.respaldos_revisados, public.conta_ajuste_respaldos_foto(v_sol.id));
  EXCEPTION WHEN check_violation THEN
    v_foto := jsonb_build_array(jsonb_build_object('alterado', true, 'detalle', SQLERRM));
  END;
  UPDATE public.conta_ajustes_solicitudes s
     SET estado = 'rechazada', revisado_por = COALESCE(s.revisado_por, auth.uid()),
         revisado_at = COALESCE(s.revisado_at, now()),
         motivo_revision = btrim(p_motivo), respaldos_revisados = v_foto, updated_at = now()
   WHERE s.id = v_sol.id
  RETURNING * INTO v_sol;
  PERFORM public.conta_ajuste_evento(v_sol, 'rechazada', v_prev, 'rechazada', btrim(p_motivo));
  RETURN QUERY SELECT v_sol.id, v_sol.estado, false;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. REEMBOLSO PARCIAL
-- ═══════════════════════════════════════════════════════════════════════════
CREATE FUNCTION public.pasarela_registrar_reembolso_parcial(
  p_payment_request_id uuid,
  p_origen             text,
  p_clave_evento       text,
  p_importe_acumulado  numeric,
  p_moneda             text,
  p_fecha_proveedor    timestamptz,
  p_referencia_pago    text,
  p_reembolso_ref      text DEFAULT NULL,
  p_payload            jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pr     public.payment_requests;
  v_clave  text;
  v_max    numeric(14,2);
  v_acum   numeric(14,2);
  v_delta  numeric(14,2);
  v_pago   public.pagos;
  v_ev     uuid := gen_random_uuid();
  v_reemb  uuid;
  v_inc    uuid;
  v_accion text;
  v_det    text;
  v_proj   uuid;
BEGIN
  PERFORM public.pasarela_exigir_service_role();
  IF p_origen IS NULL OR p_origen NOT IN ('consulta','webhook') THEN
    RAISE EXCEPTION 'origen inválido: %', p_origen USING ERRCODE = '22023';
  END IF;
  IF p_importe_acumulado IS NULL OR p_importe_acumulado <= 0 OR p_importe_acumulado <> round(p_importe_acumulado, 2) THEN
    RAISE EXCEPTION 'importe acumulado reembolsado inválido: %', p_importe_acumulado USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_moneda, ''))) = 0 THEN
    RAISE EXCEPTION 'falta la moneda del reembolso' USING ERRCODE = '22023';
  END IF;
  v_acum := p_importe_acumulado;

  -- Todo aviso de la MISMA solicitud se serializa aquí (igual que
  -- pasarela_registrar_estado).
  SELECT * INTO v_pr FROM public.payment_requests pr WHERE pr.id = p_payment_request_id FOR UPDATE;
  IF v_pr.id IS NULL THEN
    RAISE EXCEPTION 'solicitud de cobro no encontrada' USING ERRCODE = 'P0002';
  END IF;
  v_clave := COALESCE(NULLIF(btrim(COALESCE(p_clave_evento, '')), ''),
                      'consulta:' || v_pr.id::text || ':reembolso_parcial:' || v_acum::text);

  IF EXISTS (SELECT 1 FROM public.pasarela_eventos e
              WHERE e.provider = v_pr.provider AND e.clave_evento = v_clave) THEN
    RETURN jsonb_build_object('ok', true, 'duplicado', true, 'estado', v_pr.estado, 'accion', 'duplicado');
  END IF;

  SELECT COALESCE(max(r.acumulado), 0) INTO v_max
    FROM public.pasarela_reembolsos r WHERE r.payment_request_id = v_pr.id;
  SELECT * INTO v_pago FROM public.pagos p WHERE p.payment_request_id = v_pr.id;
  v_proj := COALESCE(v_pago.project_id,
                     (SELECT c.project_id FROM public.cuotas_condominio c WHERE c.id = v_pr.cuota_id),
                     (SELECT ca.project_id FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_pr.cargo_adicional_id),
                     (SELECT r.project_id FROM public.registros r WHERE r.id = v_pr.registro_id));

  IF v_acum <= v_max THEN
    -- Repetido con otra clave o FUERA DE ORDEN: ese acumulado ya está
    -- contado por un aviso posterior. Se conserva el aviso, no se suma.
    v_accion := 'reembolso_ya_contado';
    v_det := 'Acumulado informado ' || v_acum || ' ' || p_moneda || ' ≤ ya registrado ' || v_max || ': no se suma.';
  ELSE
    v_delta := v_acum - v_max;
    v_accion := CASE WHEN v_pr.estado = 'refunded' THEN 'reembolso_parcial_tras_total' ELSE 'reembolso_parcial_registrado' END;
    v_det := 'Reembolso parcial informado por el proveedor: ' || v_delta || ' ' || p_moneda
             || ' (acumulado ' || v_acum || ' de ' || v_pr.monto || ')'
             || CASE WHEN v_acum > v_pr.monto THEN '. EL ACUMULADO SUPERA EL IMPORTE COBRADO.' ELSE '' END
             || CASE WHEN v_pr.estado NOT IN ('succeeded','refunded')
                     THEN '. La solicitud de cobro está ' || v_pr.estado || ' (el aviso llegó antes de la confirmación).'
                     ELSE '' END
             || ' El cobro no se rechazó: concilia el importe devuelto.';
  END IF;

  INSERT INTO public.pasarela_eventos (
    id, company_id, payment_request_id, provider, clave_evento, estado_informado, origen,
    estado_previo, estado_resultante, resultado, detalle, payload)
  VALUES (
    v_ev, v_pr.company_id, v_pr.id, v_pr.provider, v_clave, 'reembolso_parcial', p_origen,
    v_pr.estado, v_pr.estado, v_accion, v_det,
    COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
      'importe_acumulado', v_acum, 'moneda', p_moneda, 'fecha_proveedor', p_fecha_proveedor,
      'referencia_pago', p_referencia_pago, 'reembolso_ref', p_reembolso_ref));

  IF v_delta IS NOT NULL THEN
    INSERT INTO public.pasarela_reembolsos (
      company_id, payment_request_id, pago_id, provider, evento_id, clave_evento, referencia_pago,
      reembolso_ref, importe, acumulado, moneda, fecha_proveedor)
    VALUES (
      v_pr.company_id, v_pr.id, v_pago.id, v_pr.provider, v_ev, v_clave, p_referencia_pago,
      p_reembolso_ref, v_delta, v_acum, upper(btrim(p_moneda)), p_fecha_proveedor)
    RETURNING id INTO v_reemb;

    -- Tras un reembolso total ya hay una incidencia del total: no se abre
    -- otra por su parte.
    IF v_pr.estado <> 'refunded' THEN
      INSERT INTO public.conta_incidencias_conciliacion (
        company_id, project_id, tipo, payment_request_id, pago_id, evento_id, reembolso_id, monto, detalle)
      VALUES (
        v_pr.company_id, v_proj, 'reembolso_parcial', v_pr.id, v_pago.id, v_ev, v_reemb, v_delta, v_det)
      RETURNING id INTO v_inc;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'duplicado', false, 'estado', v_pr.estado, 'accion', v_accion,
    'evento_id', v_ev, 'reembolso_id', v_reemb, 'importe', v_delta, 'acumulado', v_acum,
    'incidencia_id', v_inc);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pasarela_registrar_reembolso_parcial(uuid, text, text, numeric, text, timestamptz, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pasarela_registrar_reembolso_parcial(uuid, text, text, numeric, text, timestamptz, text, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.pasarela_registrar_reembolso_parcial(uuid, text, text, numeric, text, timestamptz, text, text, jsonb) IS
  'service_role (webhooks): registra un reembolso PARCIAL informado por el proveedor con su acumulado, moneda, fecha y referencias. Deduplicado por (proveedor, clave); un acumulado menor o igual al ya visto (repetido o fuera de orden) no suma. Cada reembolso nuevo queda en pasarela_reembolsos y abre una incidencia reembolso_parcial. No cambia la solicitud de cobro ni rechaza el cobro.';
