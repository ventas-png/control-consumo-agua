-- Datos de prueba de los saldos a favor (20261007000000), sobre el padrón de
-- conta_auxiliares_tipo_cargo y el fixture de conta_contabilizacion_cargos
-- (run.sh aplica ambos antes que éste). Todo lleva prefijo SINT-AUX.
--
--   Ledger A1: CxC residentes a101, ingresos a102 (cuotas), a103 (cargos) y
--              a110 (mora), caja a109 (efectivo). Uno es pagador de U1 y U2;
--              Dos es arrendatario de U2 (NO pagador); Tres es familiar de U4.
--   Cuentas nuevas para anticipos: una de PASIVO válida (ANT-CLI) y una de
--   ACTIVO (ANT-MAL) para probar la validación. Sin mapeo de
--   `anticipo_clientes` al empezar: el assert lo configura.
--   Ledger B1: la OTRA empresa, con su propia cuenta de anticipos.

\set ON_ERROR_STOP on

INSERT INTO public.conta_cuentas
  (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
  ('11000000-0000-0000-0000-00000000a1a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'ANT-CLI', 'Anticipos de clientes', 'pasivo', 'acreedora', 3, true, true),
  ('11000000-0000-0000-0000-00000000a1a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'ANT-MAL', 'Anticipos mal clasificados', 'activo', 'deudora', 3, true, true),
  ('11000000-0000-0000-0000-00000000b1a1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'ANT-B', 'Anticipos (B)', 'pasivo', 'acreedora', 3, true, true);

INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'metodo_efectivo',   '11000000-0000-0000-0000-00000000b109'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'anticipo_clientes', '11000000-0000-0000-0000-00000000b1a1');

INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'mantenimiento',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a102'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'recargo_mora',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a110'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'adicional_reparacion',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'adicional_reparacion',
   '11000000-0000-0000-0000-00000000b101', '11000000-0000-0000-0000-00000000b102');

-- Dos vive en U2 pero NO paga: un excedente suyo sobre una cuota de U2 no es
-- saldo a favor de Uno.
INSERT INTO public.unidad_residentes
  (unidad_id, cliente_id, company_id, project_id, tipo, activo, responsable_pago) VALUES
  ('f0000000-0000-0000-0000-00000000a002', 'e0000000-0000-0000-0000-00000000a002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'arrendatario', true, false);

-- ── Documentos (como en la aplicación: el trigger fija el responsable y
--    devenga) ──────────────────────────────────────────────────────────────
INSERT INTO public.cargos_adicionales_unidad
  (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  -- SA: cobro de 130 sobre 100 (excedente 30), primero SIN cuenta de anticipos
  ('ca5f0000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX SA excedente', 'reparacion', 100, '2026-09-01', 'pendiente'),
  -- SB: cobro exacto
  ('ca5f0000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX SB exacto', 'reparacion', 50, '2026-09-01', 'pendiente'),
  -- SC: cobro parcial y después aplicaciones parciales de saldo a favor
  ('ca5f0000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX SC parcial', 'reparacion', 80, '2026-09-01', 'pendiente'),
  -- SD: OTRA unidad (U2) del mismo cliente: el saldo de U1 no se traslada
  ('ca5f0000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a002', 'SINT-AUX SD otra unidad', 'reparacion', 40, '2026-09-01', 'pendiente'),
  -- SE, SF, SG: concurrencia (run.sh)
  ('ca5f0000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX SE concurrencia', 'reparacion', 60, '2026-09-01', 'pendiente'),
  ('ca5f0000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX SF concurrencia', 'reparacion', 60, '2026-09-01', 'pendiente'),
  ('ca5f0000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX SG concurrencia', 'reparacion', 30, '2026-09-01', 'pendiente'),
  ('ca5f0000-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX SH concurrencia', 'reparacion', 20, '2026-09-01', 'pendiente'),
  -- SB1: la otra empresa
  ('ca5f0000-0000-0000-0000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000b001', 'SINT-AUX SB1 empresa B', 'reparacion', 70, '2026-09-01', 'pendiente');

INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  -- Q1: cobro de 150 sobre 100 (excedente 50)
  ('c5f00000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX Q1', 100, '2026-09', 'pendiente', 'mantenimiento'),
  -- Q2: U2; cobro de 120 del ARRENDATARIO (no es el responsable)
  ('c5f00000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a002', 'SINT-AUX Q2', 100, '2026-09', 'pendiente', 'mantenimiento'),
  -- Q3: cobro pendiente de verificación (no genera saldo)
  ('c5f00000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX Q3', 100, '2026-09', 'pendiente', 'mantenimiento'),
  -- Q4: con mora; recibe un saldo a favor y DESPUÉS un cobro
  ('c5f00000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX Q4', 100, '2026-09', 'pendiente', 'mantenimiento');

UPDATE public.cuotas_condominio SET mora_monto = 10, total_a_pagar = 110, mora_aplicada_at = now() - interval '1 hour'
 WHERE id = 'c5f00000-0000-0000-0000-000000000004';

-- ── Ayudas de lectura (SECURITY DEFINER: se leen desde cualquier rol) ────────
-- Saldo (haber − debe) de la cuenta de anticipos para un cliente y unidad.
CREATE OR REPLACE FUNCTION public.sf_libro(p_cuenta uuid, p_cliente uuid, p_unidad uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(sum(l.haber - l.debe), 0)::numeric(14,2) FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.estado = 'publicado' AND l.cuenta_id = p_cuenta
     AND l.auxiliar_cliente_id = p_cliente AND l.unidad_id = p_unidad
$$;
-- Saldo (debe − haber) de UN documento en la CxC: devengo, cobros y
-- aplicaciones de saldo a favor (reversos incluidos).
CREATE OR REPLACE FUNCTION public.sf_cxc_doc(p_tabla text, p_doc uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(sum(l.debe - l.haber), 0)::numeric(14,2) FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.estado = 'publicado' AND l.cuenta_id = '11000000-0000-0000-0000-00000000a101'
     AND ((a.origen_tabla = p_tabla AND a.origen_id = p_doc)
          OR (a.origen_tabla = 'pagos' AND a.origen_id IN
                (SELECT p.id FROM public.pagos p WHERE p.cargo_adicional_id = p_doc OR p.cuota_id = p_doc))
          OR (a.origen_tabla = 'conta_saldo_favor_aplicaciones' AND a.origen_id IN
                (SELECT x.id FROM public.conta_saldo_favor_aplicaciones x
                  WHERE x.cargo_adicional_id = p_doc OR x.cuota_id = p_doc)))
$$;
-- Origen del saldo a favor de un cobro: «tipo:monto:disponible».
CREATE OR REPLACE FUNCTION public.sf_origen(p_pago uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT o.tipo || ':' || o.monto || ':' || public.conta_sf_disponible(o.id)
    FROM public.conta_saldo_favor_origenes o WHERE o.pago_id = p_pago
$$;
CREATE OR REPLACE FUNCTION public.sf_origen_id(p_pago uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT o.id FROM public.conta_saldo_favor_origenes o WHERE o.pago_id = p_pago
$$;
CREATE OR REPLACE FUNCTION public.sf_intento(p_pago uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT i.resultado || '/' || COALESCE(i.codigo, '-') FROM public.conta_intentos_contabilizacion i
   WHERE i.origen_tabla = 'pagos' AND i.origen_id = p_pago
   ORDER BY i.created_at DESC, i.id DESC LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.sf_estado_cargo(p_cargo uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ca.estado FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_cargo
$$;
-- Líneas del asiento VIVO de un origen: «CÓDIGO:D/H monto:aux?:unidad?».
CREATE OR REPLACE FUNCTION public.sf_lineas(p_tabla text, p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT string_agg(c.codigo || ':' || CASE WHEN l.debe > 0 THEN 'D' || l.debe::text ELSE 'H' || l.haber::text END
                    || ':' || CASE WHEN l.auxiliar_cliente_id IS NULL THEN '-' ELSE 'x' END
                    || ':' || CASE WHEN l.unidad_id IS NULL THEN '-' ELSE 'u' END, ',' ORDER BY l.orden)
    FROM public.conta_asientos a
    JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
    JOIN public.conta_cuentas c ON c.id = l.cuenta_id
   WHERE a.origen = 'automatico' AND a.origen_tabla = p_tabla AND a.origen_id = p_id
     AND a.estado = 'publicado' AND a.anulado_por_id IS NULL AND a.reversa_de_id IS NULL
$$;
-- Aplicar y resumir: «monto/mora/principal/disponible/saldo_doc/estado[/repetido]».
CREATE OR REPLACE FUNCTION public.sf_aplicar(p_origen uuid, p_tabla text, p_doc uuid, p_monto numeric, p_clave uuid)
RETURNS text LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT r.monto || '/' || r.monto_mora || '/' || r.monto_principal || '/' || r.disponible_restante
         || '/' || COALESCE(r.saldo_documento::text, '-') || '/' || COALESCE(r.estado_documento, '-')
         || CASE WHEN r.repetido THEN '/repetido' ELSE '' END
    FROM public.conta_aplicar_saldo_favor(p_origen, p_tabla, p_doc, p_monto, 'SINT-AUX', p_clave) r
$$;
CREATE OR REPLACE FUNCTION public.sf_anticipo(p_unidad uuid, p_cliente uuid, p_monto numeric, p_clave uuid)
RETURNS text LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT r.resultado || '/' || COALESCE(r.codigo, '-') || '/' || r.saldo_a_favor
         || CASE WHEN r.repetido THEN '/repetido' ELSE '' END
    FROM public.conta_registrar_anticipo('a1a1a1a1-0000-0000-0000-000000000001', p_unidad, p_cliente, p_monto,
                                         'efectivo', CURRENT_DATE, 'SINT-AUX ant', NULL, p_clave) r
$$;

GRANT EXECUTE ON FUNCTION public.sf_libro(uuid, uuid, uuid), public.sf_cxc_doc(text, uuid), public.sf_origen(uuid),
  public.sf_origen_id(uuid), public.sf_intento(uuid), public.sf_estado_cargo(uuid), public.sf_lineas(text, uuid),
  public.sf_aplicar(uuid, text, uuid, numeric, uuid), public.sf_anticipo(uuid, uuid, numeric, uuid) TO authenticated;
