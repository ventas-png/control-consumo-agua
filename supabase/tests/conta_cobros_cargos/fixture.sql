-- Datos de prueba de los cobros de cargos adicionales (20261004000000), sobre
-- el padrón de conta_auxiliares_tipo_cargo y el fixture de
-- conta_contabilizacion_cargos (run.sh aplica ambos antes que éste). Todo
-- lleva prefijo SINT-AUX.
--
--   Ledger A1: CxC residentes a101, ingreso extraordinario a103, caja a109.
--              Uno es pagador de U1 y U2; U4 no tiene candidato.
--   Ledger A2: códigos raros (Z-COBRAR, Z-VENTAS, Z-CAJA): nada depende de
--              códigos contables fijos. Dos es pagador de Local 1.
--   Ledger B1: la OTRA empresa.
--
--   Configurado por tipo: adicional_reparacion en A1, A2 y B1. SIN configurar
--   (para pendientes de devengo): adicional_multa, adicional_servicio,
--   adicional_dano en A1.

INSERT INTO public.conta_cuentas
  (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
  ('11000000-0000-0000-0000-00000000a209', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'Z-CAJA', 'Caja chica rara', 'activo', 'deudora', 2, true, true),
  ('11000000-0000-0000-0000-00000000a119', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'BANCO', 'Banco', 'activo', 'deudora', 3, true, true);

INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'metodo_efectivo', '11000000-0000-0000-0000-00000000a209'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'metodo_efectivo', '11000000-0000-0000-0000-00000000b109');

INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'adicional_reparacion',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'adicional_reparacion',
   '11000000-0000-0000-0000-00000000a201', '11000000-0000-0000-0000-00000000a202'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'adicional_reparacion',
   '11000000-0000-0000-0000-00000000b101', '11000000-0000-0000-0000-00000000b102');

INSERT INTO public.unidad_residentes
  (unidad_id, cliente_id, company_id, project_id, tipo, activo, responsable_pago) VALUES
  ('f0000000-0000-0000-0000-00000000a201', 'e0000000-0000-0000-0000-00000000a002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'propietario', true, true);

-- ── Cargos ──────────────────────────────────────────────────────────────────
-- Se emiten como en la aplicación (INSERT): el trigger fija el responsable y
-- devenga.
INSERT INTO public.cargos_adicionales_unidad
  (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  -- CA1: parciales, saldo completo, excedente, cobro anterior pendiente, reverso
  ('ca000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX CA1 vidrio', 'reparacion', 100, '2026-06-01', 'pendiente'),
  -- CA2: dos cobros simultáneos
  ('ca000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a002', 'SINT-AUX CA2 puerta', 'reparacion', 50, '2026-06-01', 'pendiente'),
  -- CA3: sin configuración → devengo pendiente
  ('ca000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX CA3 multa', 'multa', 40, '2026-06-01', 'pendiente'),
  -- CA4: unidad sin candidato → sin responsable
  ('ca000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a004', 'SINT-AUX CA4 sin responsable', 'reparacion', 25, '2026-06-01', 'pendiente'),
  -- CA5: se marcará «pagado» como antes de los cobros por cargo
  ('ca000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX CA5 pagado histórico', 'reparacion', 60, '2026-06-01', 'pendiente'),
  -- CA7: ledger A2, códigos raros
  ('ca000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a201', 'SINT-AUX CA7 local', 'reparacion', 80, '2026-06-01', 'pendiente'),
  -- CA8: la otra empresa
  ('ca000000-0000-0000-0000-000000000008', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000b001', 'SINT-AUX CA8 empresa B', 'reparacion', 70, '2026-06-01', 'pendiente'),
  -- CA9: método sin cuenta; reverso en período cerrado (cortes)
  ('ca000000-0000-0000-0000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a002', 'SINT-AUX CA9 portón', 'reparacion', 90, '2026-06-01', 'pendiente'),
  -- CA10 y CA12 son de JULIO: assert.sql cierra junio antes de la concurrencia.
  -- CA10: reprocesos simultáneos (concurrencia)
  ('ca000000-0000-0000-0000-000000000010', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX CA10 servicio', 'servicio', 30, '2026-07-01', 'pendiente'),
  -- CA11: anulado
  ('ca000000-0000-0000-0000-000000000011', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX CA11 anulado', 'reparacion', 15, '2026-06-01', 'pendiente'),
  -- CA12: reproceso contra anulación del cobro (concurrencia)
  ('ca000000-0000-0000-0000-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX CA12 daño', 'dano', 35, '2026-07-01', 'pendiente'),
  -- CA13 / CA14: anulación del cargo contra alta de cobro (concurrencia)
  ('ca000000-0000-0000-0000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX CA13', 'reparacion', 20, '2026-06-01', 'pendiente'),
  ('ca000000-0000-0000-0000-000000000014', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX CA14', 'reparacion', 20, '2026-06-01', 'pendiente');

UPDATE public.cargos_adicionales_unidad SET estado = 'anulado' WHERE id = 'ca000000-0000-0000-0000-000000000011';

-- CA5: «pagado» a mano ANTES de esta migración (sin el guard, como el dato heredado).
ALTER TABLE public.cargos_adicionales_unidad DISABLE TRIGGER trg_cargo_cobros_guard;
UPDATE public.cargos_adicionales_unidad SET estado = 'pagado' WHERE id = 'ca000000-0000-0000-0000-000000000005';
ALTER TABLE public.cargos_adicionales_unidad ENABLE TRIGGER trg_cargo_cobros_guard;

-- CA6: cargo HISTÓRICO, anterior a la contabilización por tipo (sin intentos).
ALTER TABLE public.cargos_adicionales_unidad DISABLE TRIGGER trg_conta_cargos_adicionales;
INSERT INTO public.cargos_adicionales_unidad
  (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ca000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX CA6 histórico', 'reparacion', 45, '2026-01-10', 'pendiente');
ALTER TABLE public.cargos_adicionales_unidad ENABLE TRIGGER trg_conta_cargos_adicionales;

-- ── Ayudas de lectura (SECURITY DEFINER: se leen desde cualquier rol) ────────
-- Saldo (debe − haber) de UN cargo en una cuenta: su devengo y sus cobros,
-- sobre asientos publicados (reversos incluidos).
CREATE OR REPLACE FUNCTION public.cc_saldo(p_cargo uuid, p_cuenta uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(sum(l.debe - l.haber), 0)::numeric(14,2) FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.estado = 'publicado' AND l.cuenta_id = p_cuenta
     AND ((a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = p_cargo)
          OR (a.origen_tabla = 'pagos' AND a.origen_id IN
                (SELECT p.id FROM public.pagos p WHERE p.cargo_adicional_id = p_cargo)))
$$;
-- Lo aplicado VIVO a un cargo.
CREATE OR REPLACE FUNCTION public.cc_aplicado(p_cargo uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(sum(ap.monto), 0)::numeric(14,2) FROM public.conta_cobro_aplicaciones ap
    JOIN public.conta_asientos a ON a.id = ap.asiento_id
   WHERE ap.cargo_adicional_id = p_cargo AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
$$;
-- Filas de aplicación (vivas o no: la evidencia).
CREATE OR REPLACE FUNCTION public.cc_n_aplicaciones(p_cargo uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*) FROM public.conta_cobro_aplicaciones ap WHERE ap.cargo_adicional_id = p_cargo
$$;
CREATE OR REPLACE FUNCTION public.cc_estado(p_cargo uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ca.estado FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_cargo
$$;
-- Asientos de cobro (todos) y vivos de un cargo.
CREATE OR REPLACE FUNCTION public.cc_asientos(p_cargo uuid, p_vivos boolean) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*) FROM public.conta_asientos a
   WHERE a.origen = 'automatico' AND a.origen_tabla = 'pagos' AND a.origen_evento = 'pago_contabilizado'
     AND a.origen_id IN (SELECT p.id FROM public.pagos p WHERE p.cargo_adicional_id = p_cargo)
     AND (NOT p_vivos OR (a.estado = 'publicado' AND a.anulado_por_id IS NULL))
$$;
-- Líneas del asiento VIVO de un cobro: «CÓDIGO:debe/haber:tipo:unidad?:aux?».
CREATE OR REPLACE FUNCTION public.cc_lineas(p_pago uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT string_agg(c.codigo || ':' || CASE WHEN l.debe > 0 THEN 'D' || l.debe::text ELSE 'H' || l.haber::text END
                    || ':' || COALESCE(l.tipo_cargo, '-')
                    || ':' || CASE WHEN l.unidad_id IS NULL THEN '-' ELSE 'u' END
                    || ':' || CASE WHEN l.auxiliar_cliente_id IS NULL THEN '-' ELSE 'x' END, ',' ORDER BY l.orden)
    FROM public.conta_asientos a
    JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
    JOIN public.conta_cuentas c ON c.id = l.cuenta_id
   WHERE a.origen = 'automatico' AND a.origen_tabla = 'pagos' AND a.origen_id = p_pago
     AND a.origen_evento = 'pago_contabilizado' AND a.anulado_por_id IS NULL AND a.estado = 'publicado'
$$;
-- Último intento de un cobro: «resultado/código».
CREATE OR REPLACE FUNCTION public.cc_intento(p_pago uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT i.resultado || '/' || COALESCE(i.codigo, '-') FROM public.conta_intentos_contabilizacion i
   WHERE i.origen_tabla = 'pagos' AND i.origen_id = p_pago
   ORDER BY i.created_at DESC, i.id DESC LIMIT 1
$$;
-- Registrar un cobro y resumir el resultado: «resultado/código/estado_cargo».
CREATE OR REPLACE FUNCTION public.cc_cobrar(p_cargo uuid, p_monto numeric, p_metodo text, p_fecha date, p_clave uuid)
RETURNS text LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT r.resultado || '/' || COALESCE(r.codigo, '-') || '/' || r.estado_cargo
         || CASE WHEN r.repetido THEN '/repetido' ELSE '' END
    FROM public.conta_registrar_cobro_cargo(p_cargo, p_monto, p_metodo, p_fecha, 'SINT-AUX ref', NULL, p_clave) r
$$;

GRANT EXECUTE ON FUNCTION public.cc_saldo(uuid, uuid), public.cc_aplicado(uuid), public.cc_n_aplicaciones(uuid),
  public.cc_estado(uuid), public.cc_asientos(uuid, boolean), public.cc_lineas(uuid), public.cc_intento(uuid),
  public.cc_cobrar(uuid, numeric, text, date, uuid) TO authenticated;
