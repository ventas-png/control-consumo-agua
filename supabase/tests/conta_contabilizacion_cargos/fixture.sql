-- Datos de prueba de la contabilización de cargos, sobre el padrón de
-- conta_auxiliares_tipo_cargo (run.sh aplica aquél antes que éste). Todo lleva
-- prefijo SINT-AUX.
--
--   Ledger A1: U1 (Apto 101) y U2 (Apto 102) con Uno como pagador designado;
--              U4 (Apto 103) sólo con Tres como familiar → sin candidato.
--   Ledger B1: UB con el cliente B como pagador.
--   Cuentas nuevas: caja y mora en A1; caja en B1. Mapeos del ledger A1 para
--   el camino HISTÓRICO (cuotas sin clasificar) y el cobro en efectivo.

INSERT INTO public.conta_cuentas
  (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
  ('11000000-0000-0000-0000-00000000a109', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'CAJA',     'Caja',            'activo',  'deudora',   3, true, true),
  ('11000000-0000-0000-0000-00000000a110', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'ING-MORA', 'Ingreso por mora', 'ingreso', 'acreedora', 3, true, true),
  ('11000000-0000-0000-0000-00000000b109', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'CAJA',     'Caja (B)',        'activo',  'deudora',   3, true, true);

INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'cxc_cuotas',      '11000000-0000-0000-0000-00000000a101'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'ingreso_cuota',   '11000000-0000-0000-0000-00000000a102'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'metodo_efectivo', '11000000-0000-0000-0000-00000000a109');

INSERT INTO public.unidades (id, company_id, project_id, nombre) VALUES
  ('f0000000-0000-0000-0000-00000000a004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-AUX Apto 103');

INSERT INTO public.unidad_residentes
  (unidad_id, cliente_id, company_id, project_id, tipo, activo, responsable_pago) VALUES
  ('f0000000-0000-0000-0000-00000000a001', 'e0000000-0000-0000-0000-00000000a001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'propietario', true, true),
  ('f0000000-0000-0000-0000-00000000a002', 'e0000000-0000-0000-0000-00000000a001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'propietario', true, true),
  ('f0000000-0000-0000-0000-00000000a004', 'e0000000-0000-0000-0000-00000000a003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'familiar',    true, false),
  ('f0000000-0000-0000-0000-00000000b001', 'e0000000-0000-0000-0000-00000000b001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'propietario', true, true);

-- Asignaciones a proyecto: la bandeja y el reproceso exigen acceso al
-- proyecto del ledger además del permiso contable.
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  ('b0b0b0b0-0000-0000-0000-00000000000b', 'b1b1b1b1-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-00000000000c', 'a1a1a1a1-0000-0000-0000-000000000001', 'financiero'),
  ('a0a0a0a0-0000-0000-0000-00000000000e', 'a1a1a1a1-0000-0000-0000-000000000001', 'lectura');

-- ── Ayudas de lectura (se consultan con RESET ROLE) ─────────────────────────
-- Asientos VIVOS (publicados y no reversados) de un evento de un documento.
CREATE OR REPLACE FUNCTION public.n_vivos(p_tabla text, p_id uuid, p_evento text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.conta_asientos a
   WHERE a.origen = 'automatico' AND a.origen_tabla = p_tabla AND a.origen_id = p_id
     AND a.origen_evento = p_evento AND a.estado = 'publicado' AND a.anulado_por_id IS NULL
$$;
-- Todos los asientos de un evento (vivos, reversados o en borrador).
CREATE OR REPLACE FUNCTION public.n_asientos(p_tabla text, p_id uuid, p_evento text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.conta_asientos a
   WHERE a.origen = 'automatico' AND a.origen_tabla = p_tabla AND a.origen_id = p_id
     AND a.origen_evento = p_evento
$$;
-- Saldo (debe − haber) de un auxiliar en una cuenta, sobre asientos publicados.
CREATE OR REPLACE FUNCTION public.saldo_aux(p_cuenta uuid, p_cliente uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(l.debe - l.haber), 0)::bigint FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.estado = 'publicado' AND l.cuenta_id = p_cuenta AND l.auxiliar_cliente_id = p_cliente
$$;
-- Último intento de un evento de un documento: resultado/código.
CREATE OR REPLACE FUNCTION public.ultimo_intento(p_tabla text, p_id uuid, p_evento text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT i.resultado || '/' || COALESCE(i.codigo, '-') FROM public.conta_intentos_contabilizacion i
   WHERE i.origen_tabla = p_tabla AND i.origen_id = p_id AND i.evento = p_evento
   ORDER BY i.created_at DESC, i.id DESC LIMIT 1
$$;
