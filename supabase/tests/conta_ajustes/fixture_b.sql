-- Datos del cierre del bloque 3 (20261012000000): cuotas a anular por el
-- flujo, cobros en línea con reembolsos parciales y respaldos documentales.
-- Sobre fixture.sql (mismos usuarios y empresa). Todo lleva prefijo SINT.

\set ON_ERROR_STOP on

-- ── Cuotas de Uno (U1, A1), todas por tipo (mantenimiento) ─────────────────
--   QA  se anula por el flujo (emitida; con mora)
--   QB  con un cobro vivo: AJUSTE_DEPENDENCIAS al pedirlo
--   QC  con una aplicación de saldo a favor viva
--   QD  el cobro llega entre la solicitud y la aprobación
--   QE  atajos: UPDATE, borrado suave y duro de una emitida
--   QF  tarifa sin emitir de una reserva CANCELADA, sin dependencias: se
--       elimina sin solicitud (E7, 20261014000000)
--   QF2 'pendiente' sin reserva: ya es cuenta por cobrar; no se elimina
--   QF3 'pendiente', tarifa de una reserva CONFIRMADA: no se elimina
--   QG  sin emitir con un cobro vivo: no se elimina
--   QH  período cerrado → fallida; reabierto → reintento
--   QI  autoaprobación del dueño
--   QJ  respaldos: aprobar
--   QK  respaldos: rechazar
--   QX, QY  concurrencia (run.sh)
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, cuota_estado) VALUES
  ('c9a00000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QA anular', 40, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-00000000000b', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QB con cobro', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QC con saldo aplicado', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QD cobro tardío', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-00000000000e', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QE atajos', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-00000000000f', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QF reserva', 30, '2026-09', 'pendiente', 'mantenimiento', 'pendiente'),
  ('c9a00000-0000-0000-0000-000000000010', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QG reserva con cobro', 30, '2026-09', 'pendiente', 'mantenimiento', 'pendiente'),
  ('c9a00000-0000-0000-0000-000000000011', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QH periodo', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QI dueño', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QJ respaldo', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000014', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QK respaldo rechazo', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000021', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QX aprobación vs cobro', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000022', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QY cobro vs aprobación', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  -- QZ: la otra empresa.
  ('c9a00000-0000-0000-0000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000b001', 'SINT QZ empresa B', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida');
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, cuota_estado) VALUES
  ('c9a00000-0000-0000-0000-000000000015', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QF2 pendiente sin reserva', 30, '2026-09', 'pendiente', 'mantenimiento', 'pendiente'),
  ('c9a00000-0000-0000-0000-000000000016', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QF3 reserva confirmada', 30, '2026-09', 'pendiente', 'mantenimiento', 'pendiente');
INSERT INTO public.amenidades (id, nombre, project_id, company_id) VALUES
  ('a3e00000-0000-0000-0000-000000000001', 'SINT Salón', 'a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.reservas_amenidades (id, company_id, amenidad_id, unidad_id, fecha, hora_inicio, hora_fin, estado, cuota_id) VALUES
  ('a3e00000-0000-0000-0000-0000000000f1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3e00000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', '2026-10-10', '10:00', '12:00', 'cancelada', 'c9a00000-0000-0000-0000-00000000000f'),
  ('a3e00000-0000-0000-0000-0000000000f3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3e00000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', '2026-10-11', '10:00', '12:00', 'confirmada', 'c9a00000-0000-0000-0000-000000000016');

-- QA existe desde antes de ayer: al corte de ayer estaba vigente.
UPDATE public.cuotas_condominio SET created_at = CURRENT_DATE - 10 WHERE id = 'c9a00000-0000-0000-0000-00000000000a';

-- ── Cargos y cobros en línea para los reembolsos parciales ─────────────────
INSERT INTO public.cargos_adicionales_unidad
  (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ad000000-0000-0000-0000-000000000041', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT PP1 parciales', 'reparacion', 60, '2026-09-02', 'pendiente'),
  ('ad000000-0000-0000-0000-000000000042', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT PP2 parcial antes', 'reparacion', 40, '2026-09-02', 'pendiente'),
  ('ad000000-0000-0000-0000-000000000043', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT PP3 concurrencia', 'reparacion', 50, '2026-09-02', 'pendiente');
INSERT INTO public.payment_requests (id, cliente_id, cargo_adicional_id, company_id, monto, provider, estado, provider_ref, ambiente) VALUES
  ('ad900000-0000-0000-0000-000000000041', 'e0000000-0000-0000-0000-00000000a001', 'ad000000-0000-0000-0000-000000000041', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 60, 'stripe', 'pending', 'pi_pp1', 'prod'),
  ('ad900000-0000-0000-0000-000000000042', 'e0000000-0000-0000-0000-00000000a001', 'ad000000-0000-0000-0000-000000000042', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 40, 'stripe', 'pending', 'pi_pp2', 'prod'),
  ('ad900000-0000-0000-0000-000000000043', 'e0000000-0000-0000-0000-00000000a001', 'ad000000-0000-0000-0000-000000000043', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 50, 'stripe', 'pending', 'pi_pp3', 'prod');

-- ── Confirmación TARDÍA sobre una cuota anulada o eliminada (20261015000000)
--   QL  se anula por el flujo; sus cobros en línea habían quedado 'failed' y
--       el proveedor los confirma DESPUÉS (PQ1 secuencial, PQ2 dos a la vez)
--   QM  la anulación retiene la cuota; mientras, llega la confirmación (PQ3)
--   QN  al revés: la confirmación primero (PQ4); mientras, la anulación
--   QF  (tarifa eliminable) con un cobro en línea 'failed' (PQ5): se elimina
--       y después llega la confirmación
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, cuota_estado) VALUES
  ('c9a00000-0000-0000-0000-000000000017', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QL cobro tardío anulada', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000018', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QM anulación contra aviso', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000019', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QN aviso contra anulación', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida');
INSERT INTO public.payment_requests (id, cliente_id, cuota_id, company_id, monto, provider, estado, provider_ref, ambiente) VALUES
  ('ad900000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000017', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'failed', 'pi_ql1', 'prod'),
  ('ad900000-0000-0000-0000-0000000000a2', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000017', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'failed', 'pi_ql2', 'prod'),
  ('ad900000-0000-0000-0000-0000000000a3', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000018', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'failed', 'pi_qm', 'prod'),
  ('ad900000-0000-0000-0000-0000000000a4', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000019', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'failed', 'pi_qn', 'prod'),
  ('ad900000-0000-0000-0000-0000000000a5', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-00000000000f', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'failed', 'pi_qf', 'prod');

-- ── Reembolso TOTAL antes de la aprobación (20261016000000)
--   QR  cobro en línea pending (PR6): reembolso total y después «aprobado»
--   QS  cobro en línea failed (PR7): igual
--   QT  cobro en línea pending (PR8): reembolso y aprobación a la vez, y
--       después dos aprobaciones simultáneas (run.sh M, N)
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, cuota_estado) VALUES
  ('c9a00000-0000-0000-0000-000000000023', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QR reembolso antes de aprobar', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000024', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QS reembolso de un fallido', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000025', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QT reembolso contra aprobación', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida');
INSERT INTO public.payment_requests (id, cliente_id, cuota_id, company_id, monto, provider, estado, provider_ref, ambiente) VALUES
  ('ad900000-0000-0000-0000-0000000000a6', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000023', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', 'pi_qr', 'prod'),
  ('ad900000-0000-0000-0000-0000000000a7', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000024', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'failed', 'pi_qs', 'prod'),
  ('ad900000-0000-0000-0000-0000000000a8', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000025', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', 'pi_qt', 'prod');

-- ── Storage como en Supabase: RLS activa y permisos de tabla ───────────────
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

-- ── Ayudas ─────────────────────────────────────────────────────────────────
-- «cuota_estado/devengos vivos/evidencia/anulada_at hoy».
CREATE OR REPLACE FUNCTION public.aj_cuota(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(c.cuota_estado, '-') || '/' ||
         (SELECT count(*) FROM public.conta_asientos a
           WHERE a.origen = 'automatico' AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = c.id
             AND a.origen_evento IN ('cuota_emitida','cuota_mora') AND a.estado = 'publicado' AND a.anulado_por_id IS NULL)
         || '/' || (SELECT count(*) FROM public.conta_cuota_anulaciones an WHERE an.cuota_id = c.id)
         || '/' || CASE WHEN c.deleted_at IS NOT NULL THEN 'eliminada'
                        WHEN c.anulada_at IS NULL THEN '-'
                        WHEN c.anulada_at::date = CURRENT_DATE THEN 'hoy' ELSE 'otra' END
    FROM public.cuotas_condominio c WHERE c.id = p_id
$$;
-- Cobro manual de una cuota (lo que registra la pantalla de Pagos).
CREATE OR REPLACE FUNCTION public.aj_cobro_cuota(p_cuota uuid, p_monto numeric, p_id uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.pagos (id, cuota_id, cliente_id, project_id, monto, metodo, estado, referencia)
  SELECT p_id, c.id, c.responsable_cliente_id, c.project_id, p_monto, 'efectivo', 'pendiente', 'SINT'
    FROM public.cuotas_condominio c WHERE c.id = p_cuota
  RETURNING id
$$;
CREATE OR REPLACE FUNCTION public.aj_rechazar_cobro(p_pago uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.pagos p SET estado = 'rechazado', verification_status = 'rechazado',
         verification_notes = 'SINT rechazado', updated_at = now()
   WHERE p.id = p_pago RETURNING p.estado
$$;
-- Reembolso parcial como lo manda el webhook (service_role).
CREATE OR REPLACE FUNCTION public.aj_reembolso(p_pr uuid, p_clave text, p_acumulado numeric, p_moneda text DEFAULT 'GTQ')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims text := current_setting('request.jwt.claims', true);
  v_r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_r := public.pasarela_registrar_reembolso_parcial(p_pr, 'webhook', p_clave, p_acumulado, p_moneda,
           '2026-09-20 10:00:00+00'::timestamptz, 'ch_' || left(p_pr::text, 8), 're_' || COALESCE(p_clave, 'x'),
           jsonb_build_object('tipo', 'charge.refunded'));
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  RETURN v_r;
END;
$$;
-- «n reembolsos/suma/max acumulado/incidencias reembolso_parcial».
CREATE OR REPLACE FUNCTION public.aj_reembolsos(p_pr uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*) || '/' || COALESCE(sum(r.importe), 0) || '/' || COALESCE(max(r.acumulado), 0) || '/' ||
         (SELECT count(*) FROM public.conta_incidencias_conciliacion i
           WHERE i.payment_request_id = p_pr AND i.tipo = 'reembolso_parcial')
    FROM public.pasarela_reembolsos r WHERE r.payment_request_id = p_pr
$$;
-- Subir un archivo como lo hace el cliente de storage (INSERT con la sesión).
CREATE OR REPLACE FUNCTION public.aj_subir(p_name text, p_etag text DEFAULT 'etag-1') RETURNS text
LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES ('ajustes-respaldos', p_name, auth.uid(),
          jsonb_build_object('mimetype', 'application/pdf', 'size', 1234, 'eTag', p_etag))
  RETURNING name
$$;

-- Conciliación directa, como service_role (para probar su propia guarda).
CREATE OR REPLACE FUNCTION public.aj_pr_conciliar(p_pr uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims text := current_setting('request.jwt.claims', true);
  v_r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_r := public.conciliar_pago_externo(p_pr, NULL, NULL);
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  RETURN v_r;
END;
$$;
GRANT EXECUTE ON FUNCTION public.aj_pr_conciliar(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.aj_cuota(uuid), public.aj_cobro_cuota(uuid, numeric, uuid),
  public.aj_rechazar_cobro(uuid), public.aj_reembolso(uuid, text, numeric, text), public.aj_reembolsos(uuid),
  public.aj_subir(text, text)
  TO authenticated;
