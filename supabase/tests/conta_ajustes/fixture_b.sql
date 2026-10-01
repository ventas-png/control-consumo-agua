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

-- ── Rebajas de importe / notas de crédito (E6, 20261017000000)
--   AJ-BONIF  cuenta de ajustes y bonificaciones del ledger A1, SIN mapear al
--             empezar (la primera aprobación falla por configuración)
--   QW1  100: rebaja de principal 30, después un cobro de 100 (70 a la CxC)
--   QW2   40 + mora 5: rebaja de la mora
--   QW3   60: aprobación de una rebaja mientras llega un cobro (run.sh P)
--   QW4  100: rebaja 40 y después mora sobre monto_cuota → base 60
--   QW5  100: rebaja 40 y después mora sobre saldo_vencido → base 60
--   QW6   60: el cobro llega primero; la rebaja ya no cabe (run.sh R)
--   QW7   50: dos aprobaciones de la misma rebaja a la vez (run.sh Q)
--   CW    cargo de 50: rebajas de 20 y 30
INSERT INTO public.conta_cuentas
  (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
  ('11000000-0000-0000-0000-00000000a1b0', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'AJ-BONIF', 'Ajustes y bonificaciones', 'ingreso', 'deudora', 3, true, true);
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, cuota_estado) VALUES
  ('c9a00000-0000-0000-0000-000000000031', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QW1 rebaja principal', 100, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000032', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QW2 rebaja mora', 40, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000033', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QW3 rebaja contra cobro', 60, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000034', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QW4 mora monto neto', 100, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000035', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QW5 mora saldo neto', 100, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000036', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QW6 cobro contra rebaja', 60, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QW7 doble aprobación', 50, '2026-09', 'pendiente', 'mantenimiento', 'emitida');
INSERT INTO public.cargos_adicionales_unidad
  (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ad000000-0000-0000-0000-000000000051', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT CW rebaja de cargo', 'reparacion', 50, '2026-09-02', 'pendiente');
-- Saldo de un componente (lectura para las pruebas).
CREATE OR REPLACE FUNCTION public.aj_rebaja_saldo(p_tabla text, p_id uuid, p_componente text) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.conta_rebaja_saldo(p_tabla, p_id, p_componente)
$$;
-- «monto/saldo_antes/componente/aprobado por» de la nota de una solicitud.
CREATE OR REPLACE FUNCTION public.aj_nota(p_sol uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT n.monto || '/' || n.saldo_antes || '/' || n.componente || '/' || n.aprobado_por
    FROM public.conta_notas_credito n WHERE n.solicitud_id = p_sol
$$;
-- Asiento de la nota: «código:D|H importe:auxiliar?:unidad?:tipo_cargo» por línea.
CREATE OR REPLACE FUNCTION public.aj_nota_lineas(p_sol uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.estado || '|' || a.fecha::text || '|' || string_agg(
           c.codigo || ':' || CASE WHEN l.debe > 0 THEN 'D' || l.debe ELSE 'H' || l.haber END
           || ':' || CASE WHEN l.auxiliar_cliente_id IS NULL THEN '-' ELSE 'x' END
           || ':' || CASE WHEN l.unidad_id IS NULL THEN '-' ELSE 'u' END
           || ':' || COALESCE(l.tipo_cargo, '-'), ',' ORDER BY l.orden)
    FROM public.conta_notas_credito n
    JOIN public.conta_asientos a ON a.id = n.asiento_id
    JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
    JOIN public.conta_cuentas c ON c.id = l.cuenta_id
   WHERE n.solicitud_id = p_sol
   GROUP BY a.estado, a.fecha
$$;
-- Devengo − cobros aplicados − notas vivas de una cuota (sin acotar a 0).
CREATE OR REPLACE FUNCTION public.aj_cuota_neto(p_cuota uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (c.monto
          - COALESCE((SELECT sum(ap.monto) FROM public.conta_cobro_aplicaciones ap
                        JOIN public.conta_asientos a ON a.id = ap.asiento_id
                       WHERE ap.cuota_id = c.id AND ap.evento = 'cuota_emitida'
                         AND a.estado = 'publicado' AND a.anulado_por_id IS NULL), 0)
          - COALESCE((SELECT sum(n.monto) FROM public.conta_notas_credito n
                       WHERE n.cuota_id = c.id AND n.componente = 'principal'
                         AND public.conta_sf_asiento_vivo(n.asiento_id)), 0))::numeric(14,2)
    FROM public.cuotas_condominio c WHERE c.id = p_cuota
$$;
GRANT EXECUTE ON FUNCTION public.aj_rebaja_saldo(text, uuid, text), public.aj_nota(uuid), public.aj_nota_lineas(uuid),
  public.aj_cuota_neto(uuid) TO authenticated;

-- ── E7: cancelar la reserva anula su tarifa (20261018000000)
--   RV1 confirmada, tarifa QR1: se cancela → tarifa anulada con evidencia
--   RV2 confirmada, tarifa QR2 con un cobro: la tarifa queda (solicitud)
--   RV3 pendiente, tarifa QR3: se RECHAZA con motivo
--   RV4 sin tarifa
--   RV5 confirmada, tarifa QR5: período cerrado → fallida, reintento
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, cuota_estado) VALUES
  ('c9a00000-0000-0000-0000-000000000041', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QR1 tarifa', 25, '2026-10', 'pendiente', 'mantenimiento', 'pendiente'),
  ('c9a00000-0000-0000-0000-000000000042', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QR2 tarifa cobrada', 25, '2026-10', 'pendiente', 'mantenimiento', 'pendiente'),
  ('c9a00000-0000-0000-0000-000000000043', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QR3 tarifa rechazo', 25, '2026-10', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000045', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QR5 tarifa periodo', 25, '2026-10', 'pendiente', 'mantenimiento', 'pendiente');
INSERT INTO public.reservas_amenidades (id, company_id, amenidad_id, unidad_id, fecha, hora_inicio, hora_fin, estado, cuota_id) VALUES
  ('a3e00000-0000-0000-0000-000000000101', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3e00000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', '2026-10-20', '10:00', '12:00', 'confirmada', 'c9a00000-0000-0000-0000-000000000041'),
  ('a3e00000-0000-0000-0000-000000000102', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3e00000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', '2026-10-21', '10:00', '12:00', 'confirmada', 'c9a00000-0000-0000-0000-000000000042'),
  ('a3e00000-0000-0000-0000-000000000103', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3e00000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', '2026-10-22', '10:00', '12:00', 'pendiente', 'c9a00000-0000-0000-0000-000000000043'),
  ('a3e00000-0000-0000-0000-000000000104', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3e00000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', '2026-10-23', '10:00', '12:00', 'confirmada', NULL),
  ('a3e00000-0000-0000-0000-000000000105', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3e00000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', '2026-10-24', '10:00', '12:00', 'confirmada', 'c9a00000-0000-0000-0000-000000000045');

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

-- ── E8: cobros en línea abandonados (20261019000000)
--   PN1 sin referencia, 30 h        → el cron lo marca failed
--   PN2 con referencia, 2 h         → 1.ª consulta
--   PN3 con referencia, 30 h, 1 consulta → 2.ª consulta
--   PN4 con referencia, 26 h, 2 consultas → incidencia, NO failed
--   PN5 con referencia, 26 h, 2 consultas, cobro de 30 días ya failed → intacto
--   QX1 (cobrado), QX2 (no cobrado), QX3 (cobrado sobre cuota anulada), QX4 (dos aprobaciones a la vez)
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, cuota_estado) VALUES
  ('c9a00000-0000-0000-0000-000000000051', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QX1 resolución cobrado', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000052', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QX2 resolución no cobrado', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000053', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QX3 cobrado sobre anulada', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000054', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QX4 dos aprobaciones', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida');
INSERT INTO public.payment_requests (id, cliente_id, cuota_id, company_id, monto, provider, estado, provider_ref, ambiente, created_at, consultas_auto) VALUES
  ('ad900000-0000-0000-0000-0000000000b1', 'e0000000-0000-0000-0000-00000000a001', NULL, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', NULL, 'prod', now() - interval '30 hours', 0),
  ('ad900000-0000-0000-0000-0000000000b2', 'e0000000-0000-0000-0000-00000000a001', NULL, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', 'pi_n2', 'prod', now() - interval '2 hours', 0),
  ('ad900000-0000-0000-0000-0000000000b3', 'e0000000-0000-0000-0000-00000000a001', NULL, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', 'pi_n3', 'prod', now() - interval '30 hours', 1),
  ('ad900000-0000-0000-0000-0000000000b4', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000051', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', 'pi_n4', 'prod', now() - interval '26 hours', 2),
  ('ad900000-0000-0000-0000-0000000000b5', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000052', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', 'pi_n5', 'prod', now() - interval '26 hours', 2),
  ('ad900000-0000-0000-0000-0000000000b6', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000053', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', 'pi_n6', 'prod', now() - interval '26 hours', 2),
  ('ad900000-0000-0000-0000-0000000000b7', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000054', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', 'pi_n7', 'prod', now() - interval '26 hours', 2);
-- Secretos del cron (el stub de net.http_post no hace nada).
INSERT INTO vault.secrets (name, secret) VALUES ('edge_function_url', 'http://edge.test'), ('service_role_key', 'srk-test');

-- Aprobar como p_aprobador indicando los respaldos revisados (E8).
CREATE OR REPLACE FUNCTION public.aj_aprobar_con(p_aprobador uuid, p_sol uuid, p_resp uuid[])
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_yo text := current_setting('request.jwt.claim.sub', true);
  v_r  record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_aprobador::text, false);
  BEGIN
    SELECT * INTO v_r FROM public.conta_ajuste_aprobar(p_sol, 'SINT visto el respaldo', false, p_resp);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', v_yo, false);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_yo, false);
  RETURN v_r.estado || CASE WHEN v_r.error_ejecucion IS NOT NULL THEN '/' || split_part(v_r.error_ejecucion, ':', 1) ELSE '' END;
END;
$$;
GRANT EXECUTE ON FUNCTION public.aj_aprobar_con(uuid, uuid, uuid[]) TO authenticated;

-- E8 (concurrencia): QX5/PB8 aprobación manual contra aviso del proveedor
-- (run.sh S); QX6/PB9 dos aprobaciones de la misma resolución (run.sh T).
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, cuota_estado) VALUES
  ('c9a00000-0000-0000-0000-000000000055', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QX5 resolución contra aviso', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'),
  ('c9a00000-0000-0000-0000-000000000056', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QX6 doble aprobación de resolución', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida');
INSERT INTO public.payment_requests (id, cliente_id, cuota_id, company_id, monto, provider, estado, provider_ref, ambiente, created_at, consultas_auto) VALUES
  ('ad900000-0000-0000-0000-0000000000b8', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000055', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', 'pi_n8', 'prod', now() - interval '26 hours', 2),
  ('ad900000-0000-0000-0000-0000000000b9', 'e0000000-0000-0000-0000-00000000a001', 'c9a00000-0000-0000-0000-000000000056', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', 'pi_n9', 'prod', now() - interval '26 hours', 2);

-- ── E8 (20261019000100): cierre de «cobro_sin_confirmar» por el proveedor y
--    cuatro ojos sin excepción. Todos con 2 consultas y 26 h → el cron abre
--    su incidencia en la primera pasada.
--   PC1 aprobado (webhook) · PC2 rechazado (consulta) · PC3 reembolsado
--   PC4 aprobado sobre cuota ANULADA · PC5 pendiente / requiere_accion / error
--   PC6 aprobado duplicado · PC7 resolución manual solicitada por el dueño
--   PC8 dos avisos «aprobado» a la vez (run.sh U)
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, cuota_estado)
SELECT ('c9a00000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
       'f0000000-0000-0000-0000-00000000a001', 'SINT QZ' || n || ' cobro sin confirmar', 30, '2026-09', 'pendiente', 'mantenimiento', 'emitida'
  FROM generate_series(61, 68) n;
INSERT INTO public.payment_requests (id, cliente_id, cuota_id, company_id, monto, provider, estado, provider_ref, ambiente, created_at, consultas_auto)
SELECT ('ad900000-0000-0000-0000-0000000000c' || n)::uuid, 'e0000000-0000-0000-0000-00000000a001',
       ('c9a00000-0000-0000-0000-0000000000' || (60 + n))::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 30, 'stripe', 'pending', 'pi_c' || n, 'prod',
       now() - interval '26 hours', 2
  FROM generate_series(1, 8) n;
