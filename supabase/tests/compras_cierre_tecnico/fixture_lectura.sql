\set ON_ERROR_STOP on

-- ============================================================================
-- PADRÓN · LECTURA FINANCIERA POR PERMISO, EMPRESA Y PROYECTO
-- (migraciones 20261026000000 / 20261026000100 / 20261026000200)
--
-- Se monta SOBRE el fixture del bloque B (empresas C y D, proyectos C1, C2 y D1,
-- catálogos, proveedores y los usuarios UA, UB, UK, UO, UN, UD). Aquí se añaden
-- los perfiles que faltan para probar el alcance y se siembran datos REALES
-- (por los triggers y funciones del sistema, no por INSERT a mano donde importa)
-- en cuatro ámbitos:  C1 · C2 · E (contabilidad de la EMPRESA: project_id NULL) · D.
--
-- Perfiles nuevos (todos de la empresa C salvo que se diga otra cosa):
--   UV   viewer, asignado a C1, sin roles RBAC                  → no debe leer finanzas
--   UK1  contador (permiso contabilidad.*), asignado SOLO a C1  → finanzas de C1 + empresa
--   UK0  contador SIN asignaciones (no exento)                  → solo la contabilidad de la empresa
--   UX   admin SIN asignaciones (exento)                        → todo C
--   UA1  admin asignado SOLO a C1                               → C1 + empresa
--   UCO  company_owner (exento)                                 → todo C
--   USA  super_admin                                            → todo, de todas las empresas
--   UOS  operador de compras asignado SOLO a C1                 → órdenes de C1 + empresa
--
-- `zz_etiquetas` mapea cada fila sembrada a su ÁMBITO por dónde se sembró (no por
-- la política que se está probando): así las expectativas no son circulares.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''

-- ── Perfiles nuevos ─────────────────────────────────────────────────────────
INSERT INTO auth.users (id) VALUES
  ('f1000000-0000-0000-0000-0000000000a1'), ('f1000000-0000-0000-0000-0000000000a2'),
  ('f1000000-0000-0000-0000-0000000000a3'), ('f1000000-0000-0000-0000-0000000000a4'),
  ('f1000000-0000-0000-0000-0000000000a5'), ('f1000000-0000-0000-0000-0000000000a6'),
  ('f1000000-0000-0000-0000-0000000000a7'), ('f1000000-0000-0000-0000-0000000000a8');
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('f1000000-0000-0000-0000-0000000000a1', :C::uuid, 'LF Viewer C1',          'viewer'),
  ('f1000000-0000-0000-0000-0000000000a2', :C::uuid, 'LF Contador C1',        'operator'),
  ('f1000000-0000-0000-0000-0000000000a3', :C::uuid, 'LF Contador sin proy.', 'operator'),
  ('f1000000-0000-0000-0000-0000000000a4', :C::uuid, 'LF Admin exento',       'admin'),
  ('f1000000-0000-0000-0000-0000000000a5', :C::uuid, 'LF Admin C1',           'admin'),
  ('f1000000-0000-0000-0000-0000000000a6', :C::uuid, 'LF Owner',              'company_owner'),
  ('f1000000-0000-0000-0000-0000000000a7', :C::uuid, 'LF Super admin',        'super_admin'),
  ('f1000000-0000-0000-0000-0000000000a8', :C::uuid, 'LF Operador compras C1','operator');
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  ('f1000000-0000-0000-0000-0000000000a1', :C1::uuid, 'total'),
  ('f1000000-0000-0000-0000-0000000000a2', :C1::uuid, 'total'),
  ('f1000000-0000-0000-0000-0000000000a5', :C1::uuid, 'total'),
  ('f1000000-0000-0000-0000-0000000000a8', :C1::uuid, 'total');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('f1000000-0000-0000-0000-0000000000a2', '9b000000-0000-0000-0000-00000000000c'),   -- BB Contador (contabilidad.*)
  ('f1000000-0000-0000-0000-0000000000a3', '9b000000-0000-0000-0000-00000000000c'),
  ('f1000000-0000-0000-0000-0000000000a8', '9b000000-0000-0000-0000-00000000000d');   -- BB Operador compras

-- ── Facturas: una por ámbito, con renglones; se aprueban para que el sistema genere el asiento ─
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, categoria, monto_total, iva_monto, fecha_emision) VALUES
  ('f2000000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'LF-C1', 'Factura LF de C1', 'mantenimiento', 112, 12, CURRENT_DATE),
  ('f2000000-0000-0000-0000-000000000002', :C::uuid, :C2::uuid, :P1::uuid, 'LF-C2', 'Factura LF de C2', 'mantenimiento', 112, 12, CURRENT_DATE),
  ('f2000000-0000-0000-0000-000000000003', :C::uuid, NULL,      :P1::uuid, 'LF-E',  'Factura LF de la empresa', 'mantenimiento', 112, 12, CURRENT_DATE),
  ('f2000000-0000-0000-0000-000000000004', :D::uuid, :D1::uuid, :PD::uuid, 'LF-D',  'Factura LF de D', 'mantenimiento', 112, 12, CURRENT_DATE);
INSERT INTO public.factura_proveedor_lineas (id, company_id, factura_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES
  ('f2100000-0000-0000-0000-000000000001', :C::uuid, 'f2000000-0000-0000-0000-000000000001', 1, 'Renglón LF C1', 1, 100, 12),
  ('f2100000-0000-0000-0000-000000000002', :C::uuid, 'f2000000-0000-0000-0000-000000000002', 1, 'Renglón LF C2', 1, 100, 12),
  ('f2100000-0000-0000-0000-000000000003', :C::uuid, 'f2000000-0000-0000-0000-000000000003', 1, 'Renglón LF E',  1, 100, 12),
  ('f2100000-0000-0000-0000-000000000004', :D::uuid, 'f2000000-0000-0000-0000-000000000004', 1, 'Renglón LF D',  1, 100, 12);

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada'
 WHERE id IN ('f2000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000003');
RESET ROLE;
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'f2000000-0000-0000-0000-000000000004';
RESET ROLE;

-- ── Pagos: una orden de pago y una contraseña por ámbito ────────────────────
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, metodo_pago, estado) VALUES
  ('f3000000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'f2000000-0000-0000-0000-000000000001', 112, 'transferencia', 'borrador'),
  ('f3000000-0000-0000-0000-000000000002', :C::uuid, :C2::uuid, :P1::uuid, 'f2000000-0000-0000-0000-000000000002', 112, 'transferencia', 'borrador'),
  ('f3000000-0000-0000-0000-000000000003', :C::uuid, NULL,      :P1::uuid, 'f2000000-0000-0000-0000-000000000003', 112, 'transferencia', 'borrador'),
  ('f3000000-0000-0000-0000-000000000004', :D::uuid, :D1::uuid, :PD::uuid, 'f2000000-0000-0000-0000-000000000004', 112, 'transferencia', 'borrador');
-- Fixture: el número lo fija el sistema (histórico), no una sesión de usuario ([EV-08]).
SELECT set_config('conta.allow_system_write', 'on', false);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, numero, fecha_pago_programada, total) VALUES
  ('f4000000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'CP-LF-C1', CURRENT_DATE + 30, 112),
  ('f4000000-0000-0000-0000-000000000002', :C::uuid, :C2::uuid, :P1::uuid, 'CP-LF-C2', CURRENT_DATE + 30, 112),
  ('f4000000-0000-0000-0000-000000000003', :C::uuid, NULL,      :P1::uuid, 'CP-LF-E',  CURRENT_DATE + 30, 112),
  ('f4000000-0000-0000-0000-000000000004', :D::uuid, :D1::uuid, :PD::uuid, 'CP-LF-D',  CURRENT_DATE + 30, 112);
SELECT set_config('conta.allow_system_write', 'off', false);
INSERT INTO public.contrasena_pago_facturas (id, company_id, contrasena_id, factura_id, monto) VALUES
  ('f4100000-0000-0000-0000-000000000001', :C::uuid, 'f4000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 112),
  ('f4100000-0000-0000-0000-000000000002', :C::uuid, 'f4000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000002', 112),
  ('f4100000-0000-0000-0000-000000000003', :C::uuid, 'f4000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000003', 112),
  ('f4100000-0000-0000-0000-000000000004', :D::uuid, 'f4000000-0000-0000-0000-000000000004', 'f2000000-0000-0000-0000-000000000004', 112);

-- ── Tablas de la empresa sin ámbito de proyecto ─────────────────────────────
INSERT INTO public.conta_tipos_cambio (id, company_id, moneda, fecha, tasa) VALUES
  ('f5000000-0000-0000-0000-000000000001', :C::uuid, 'USD', CURRENT_DATE, 7.75),
  ('f5000000-0000-0000-0000-000000000002', :D::uuid, 'USD', CURRENT_DATE, 7.80);
INSERT INTO public.gastos_condominio (id, company_id, project_id, concepto, categoria, monto, fecha, estado) VALUES
  ('f6000000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, 'Gasto LF C', 'mantenimiento', 112, CURRENT_DATE, 'pendiente'),
  ('f6000000-0000-0000-0000-000000000002', :D::uuid, :D1::uuid, 'Gasto LF D', 'mantenimiento', 112, CURRENT_DATE, 'pendiente');
INSERT INTO public.conta_duplicados_descartados (id, company_id, gasto_id, factura_id, motivo) VALUES
  ('f7000000-0000-0000-0000-000000000001', :C::uuid, 'f6000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'LF'),
  ('f7000000-0000-0000-0000-000000000002', :D::uuid, 'f6000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000004', 'LF');

-- Cierres anuales: se apoyan en un asiento real de cada ámbito.
INSERT INTO public.conta_cierres_anuales (id, company_id, anio, asiento_id, project_id)
SELECT ('f8000000-0000-0000-0000-00000000000' || row_number() OVER (ORDER BY a.company_id, a.project_id NULLS LAST))::uuid,
       a.company_id, 2090 + (row_number() OVER (ORDER BY a.company_id, a.project_id NULLS LAST))::int, a.id, a.project_id
  FROM (SELECT DISTINCT ON (company_id, project_id) id, company_id, project_id
          FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor'
         ORDER BY company_id, project_id, created_at) a;

-- ── Órdenes y recepciones por ámbito (por las vías normales: admin crea, aprueba y emite) ─
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
  ('f9000000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Orden LF de C1'),
  ('f9000000-0000-0000-0000-000000000002', :C::uuid, :C2::uuid, :P1::uuid, 'Ferretería Bloque B', 'Orden LF de C2'),
  ('f9000000-0000-0000-0000-000000000003', :C::uuid, NULL,      :P1::uuid, 'Ferretería Bloque B', 'Orden LF de la empresa');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
  ('f9100000-0000-0000-0000-000000000001', :C::uuid, 'f9000000-0000-0000-0000-000000000001', 1, 'Renglón de orden LF C1', 'gasto', 'mantenimiento', 10, 'u', 10, 12),
  ('f9100000-0000-0000-0000-000000000002', :C::uuid, 'f9000000-0000-0000-0000-000000000002', 1, 'Renglón de orden LF C2', 'gasto', 'mantenimiento', 10, 'u', 10, 12),
  ('f9100000-0000-0000-0000-000000000003', :C::uuid, 'f9000000-0000-0000-0000-000000000003', 1, 'Renglón de orden LF E',  'gasto', 'mantenimiento', 10, 'u', 10, 12);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN ('f9000000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000002', 'f9000000-0000-0000-0000-000000000003');
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id IN ('f9000000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000002', 'f9000000-0000-0000-0000-000000000003');
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES
  ('f9200000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, 'f9000000-0000-0000-0000-000000000001', 'bienes'),
  ('f9200000-0000-0000-0000-000000000002', :C::uuid, :C2::uuid, 'f9000000-0000-0000-0000-000000000002', 'bienes'),
  ('f9200000-0000-0000-0000-000000000003', :C::uuid, NULL,      'f9000000-0000-0000-0000-000000000003', 'bienes');
INSERT INTO public.recepcion_lineas (id, company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES
  ('f9300000-0000-0000-0000-000000000001', :C::uuid, 'f9200000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 4),
  ('f9300000-0000-0000-0000-000000000002', :C::uuid, 'f9200000-0000-0000-0000-000000000002', 'f9100000-0000-0000-0000-000000000002', 4),
  ('f9300000-0000-0000-0000-000000000003', :C::uuid, 'f9200000-0000-0000-0000-000000000003', 'f9100000-0000-0000-0000-000000000003', 4);
RESET ROLE;
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
  ('f9000000-0000-0000-0000-000000000004', :D::uuid, :D1::uuid, :PD::uuid, 'Proveedor de D', 'Orden LF de D');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
  ('f9100000-0000-0000-0000-000000000004', :D::uuid, 'f9000000-0000-0000-0000-000000000004', 1, 'Renglón de orden LF D', 'gasto', 'mantenimiento', 10, 'u', 10, 12);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'f9000000-0000-0000-0000-000000000004';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = 'f9000000-0000-0000-0000-000000000004';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES
  ('f9200000-0000-0000-0000-000000000004', :D::uuid, :D1::uuid, 'f9000000-0000-0000-0000-000000000004', 'bienes');
INSERT INTO public.recepcion_lineas (id, company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES
  ('f9300000-0000-0000-0000-000000000004', :D::uuid, 'f9200000-0000-0000-0000-000000000004', 'f9100000-0000-0000-0000-000000000004', 4);
RESET ROLE;

-- ── Etiquetas de ámbito: por DÓNDE se sembró cada fila (C1, C2, E = empresa, D) ──
CREATE TABLE public.zz_etiquetas (tabla text NOT NULL, id uuid NOT NULL, ambito text NOT NULL, PRIMARY KEY (tabla, id));
GRANT SELECT ON public.zz_etiquetas TO authenticated, anon;

CREATE FUNCTION public.zz_ambito(p_company uuid, p_project uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_company = 'dddddddd-dddd-dddd-dddd-dddddddddddd' THEN 'D'
              WHEN p_project IS NULL THEN 'E'
              WHEN p_project = 'c1c1c1c1-0000-0000-0000-000000000001' THEN 'C1'
              WHEN p_project = 'c2c2c2c2-0000-0000-0000-000000000001' THEN 'C2'
              ELSE '?' END
$$;

-- Solo las filas SEMBRADAS aquí (las de otros fixtures no se etiquetan: no entran en la prueba).
INSERT INTO public.zz_etiquetas SELECT 'facturas_proveedor', id, public.zz_ambito(company_id, project_id) FROM public.facturas_proveedor WHERE id::text LIKE 'f2000000%';
INSERT INTO public.zz_etiquetas SELECT 'factura_proveedor_lineas', l.id, public.zz_ambito(f.company_id, f.project_id) FROM public.factura_proveedor_lineas l JOIN public.facturas_proveedor f ON f.id = l.factura_id WHERE l.id::text LIKE 'f2100000%';
INSERT INTO public.zz_etiquetas SELECT 'ordenes_pago', id, public.zz_ambito(company_id, project_id) FROM public.ordenes_pago WHERE id::text LIKE 'f3000000%';
INSERT INTO public.zz_etiquetas SELECT 'contrasenas_pago', id, public.zz_ambito(company_id, project_id) FROM public.contrasenas_pago WHERE id::text LIKE 'f4000000%';
INSERT INTO public.zz_etiquetas SELECT 'contrasena_pago_facturas', l.id, public.zz_ambito(c.company_id, c.project_id) FROM public.contrasena_pago_facturas l JOIN public.contrasenas_pago c ON c.id = l.contrasena_id WHERE l.id::text LIKE 'f4100000%';
INSERT INTO public.zz_etiquetas SELECT 'conta_tipos_cambio', id, public.zz_ambito(company_id, NULL) FROM public.conta_tipos_cambio WHERE id::text LIKE 'f5000000%';
INSERT INTO public.zz_etiquetas SELECT 'conta_duplicados_descartados', id, public.zz_ambito(company_id, NULL) FROM public.conta_duplicados_descartados WHERE id::text LIKE 'f7000000%';
INSERT INTO public.zz_etiquetas SELECT 'conta_cierres_anuales', id, public.zz_ambito(company_id, project_id) FROM public.conta_cierres_anuales WHERE id::text LIKE 'f8000000%';
-- Los asientos de las facturas sembradas (y SOLO esos) y sus líneas.
INSERT INTO public.zz_etiquetas SELECT 'conta_asientos', a.id, public.zz_ambito(a.company_id, a.project_id)
  FROM public.conta_asientos a WHERE a.origen_tabla = 'facturas_proveedor' AND a.origen_id::text LIKE 'f2000000%';
INSERT INTO public.zz_etiquetas SELECT 'conta_asiento_lineas', l.id, public.zz_ambito(a.company_id, a.project_id)
  FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
 WHERE a.origen_tabla = 'facturas_proveedor' AND a.origen_id::text LIKE 'f2000000%';
-- Catálogo contable (sembrado por el fixture del bloque B): una contabilidad por ámbito.
INSERT INTO public.zz_etiquetas SELECT 'conta_cuentas', id, public.zz_ambito(company_id, project_id) FROM public.conta_cuentas;
INSERT INTO public.zz_etiquetas SELECT 'conta_mapeo_cuentas', id, public.zz_ambito(company_id, project_id) FROM public.conta_mapeo_cuentas;
-- Órdenes y recepciones.
INSERT INTO public.zz_etiquetas SELECT 'ordenes_compra', id, public.zz_ambito(company_id, project_id) FROM public.ordenes_compra WHERE id::text LIKE 'f9000000%';
INSERT INTO public.zz_etiquetas SELECT 'orden_compra_lineas', l.id, public.zz_ambito(o.company_id, o.project_id) FROM public.orden_compra_lineas l JOIN public.ordenes_compra o ON o.id = l.orden_compra_id WHERE l.id::text LIKE 'f9100000%';
INSERT INTO public.zz_etiquetas SELECT 'recepciones', id, public.zz_ambito(company_id, project_id) FROM public.recepciones WHERE id::text LIKE 'f9200000%';
INSERT INTO public.zz_etiquetas SELECT 'recepcion_lineas', l.id, public.zz_ambito(r.company_id, r.project_id) FROM public.recepcion_lineas l JOIN public.recepciones r ON r.id = l.recepcion_id WHERE l.id::text LIKE 'f9300000%';

-- Qué ámbitos ve la sesión actual en una tabla (solo filas etiquetadas). Se ejecuta
-- como el usuario de la sesión (SECURITY INVOKER): lo que devuelve lo decide la RLS.
CREATE FUNCTION public.ver(p_tabla text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format(
    'SELECT COALESCE(string_agg(DISTINCT e.ambito, '','' ORDER BY e.ambito), '''') FROM public.%I t JOIN public.zz_etiquetas e ON e.tabla = %L AND e.id = t.id',
    p_tabla, p_tabla) INTO v;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.ver(text), public.zz_ambito(uuid, uuid) TO authenticated, anon;
