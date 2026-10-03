\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · LA LECTURA FINANCIERA EXIGE PERMISO, EMPRESA Y PROYECTO
-- (migraciones 20261026000000 · 20261026000100 · 20261026000200)
--
-- Cada prueba corre COMO el usuario (rol `authenticated` + `sub` del JWT) y consulta
-- las tablas DIRECTAMENTE, como lo hace la API de tablas: lo que la interfaz oculta
-- no cuenta. Las expectativas son literales (qué ámbitos ve cada perfil) y los
-- ámbitos de cada fila los fijó el fixture por dónde las sembró, no la política.
--
-- Ámbitos: C1 · C2 (proyectos de C) · E (contabilidad de la EMPRESA, project_id NULL) · D (otra empresa).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UK  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set UV  '''f1000000-0000-0000-0000-0000000000a1'''
\set UK1 '''f1000000-0000-0000-0000-0000000000a2'''
\set UK0 '''f1000000-0000-0000-0000-0000000000a3'''
\set UX  '''f1000000-0000-0000-0000-0000000000a4'''
\set UA1 '''f1000000-0000-0000-0000-0000000000a5'''
\set UCO '''f1000000-0000-0000-0000-0000000000a6'''
\set USA '''f1000000-0000-0000-0000-0000000000a7'''
\set UOS '''f1000000-0000-0000-0000-0000000000a8'''

-- Lo que un perfil debe ver en TODAS las tablas de cada grupo. Corre como el usuario de la sesión.
--   p_fin     tablas financieras con ámbito de proyecto (y sus hijas)
--   p_sinproy tablas financieras de la empresa sin ámbito de proyecto
--   p_ord     órdenes y recepciones (y sus renglones)
CREATE FUNCTION public.chk_alcance(p_perfil text, p_fin text, p_sinproy text, p_ord text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facturas_proveedor', 'factura_proveedor_lineas', 'contrasenas_pago', 'contrasena_pago_facturas',
                           'ordenes_pago', 'conta_asientos', 'conta_asiento_lineas', 'conta_cierres_anuales',
                           'conta_cuentas', 'conta_mapeo_cuentas'] LOOP
    PERFORM public.chk_txt(public.ver(t), p_fin, p_perfil || ' · ' || t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['conta_tipos_cambio', 'conta_duplicados_descartados'] LOOP
    PERFORM public.chk_txt(public.ver(t), p_sinproy, p_perfil || ' · ' || t || ' (sin ámbito de proyecto)');
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ordenes_compra', 'orden_compra_lineas', 'recepciones', 'recepcion_lineas'] LOOP
    PERFORM public.chk_txt(public.ver(t), p_ord, p_perfil || ' · ' || t);
  END LOOP;
END $$;

-- ── 0. Los datos existen: el dueño de las tablas (que no pasa por RLS) ve todo ──
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id::text LIKE 'f2000000%'), 4, '0 · el padrón tiene 4 facturas (C1, C2, empresa, D)');
SELECT public.chk((SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.zz_etiquetas e ON e.tabla = 'conta_asiento_lineas' AND e.id = l.id), 12, '0 · y 12 líneas de asiento generadas por el sistema');

-- ── 1. Contabilidad: ve todo lo de SUS proyectos asignados y la contabilidad de la empresa ──
SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UA admin (C1, C2)', 'C1,C2,E', 'E', 'C1,C2,E');
RESET ROLE;

SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UK contador (C1, C2)', 'C1,C2,E', 'E', 'C1,C2,E');
RESET ROLE;

-- Proyecto: el mismo permiso, pero asignado SOLO a C1 → no ve C2.
SELECT public.como(:UK1::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UK1 contador solo C1', 'C1,E', 'E', 'C1,E');
RESET ROLE;

SELECT public.como(:UA1::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UA1 admin solo C1', 'C1,E', 'E', 'C1,E');
RESET ROLE;

-- Sin asignaciones y no exento: solo la contabilidad de la EMPRESA (la consecuencia que
-- scripts/diagnostico-lectura-financiera.sql avisa antes de desplegar).
SELECT public.como(:UK0::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UK0 contador sin asignaciones', 'E', 'E', 'E');
RESET ROLE;

-- Exentos: admin sin asignaciones y propietario ven todas las contabilidades de SU empresa.
SELECT public.como(:UX::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UX admin exento', 'C1,C2,E', 'E', 'C1,C2,E');
RESET ROLE;

SELECT public.como(:UCO::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UCO propietario', 'C1,C2,E', 'E', 'C1,C2,E');
RESET ROLE;

-- Super admin: todo, de todas las empresas.
SELECT public.como(:USA::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('USA super admin', 'C1,C2,D,E', 'D,E', 'C1,C2,D,E');
RESET ROLE;

-- ── 2. Empresa: el admin de D solo ve D; nadie de C ve D ────────────────────
SELECT public.como(:UD::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UD admin de D', 'D', 'D', 'D');
RESET ROLE;

-- ── 3. SIN permiso de Contabilidad: ni una fila financiera, aunque sea de su proyecto ──
-- (era el hueco: antes veían todo lo de la empresa). Órdenes y recepciones sí las leen,
-- acotadas a sus proyectos: es lo que Operaciones necesita.
SELECT public.como(:UO::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UO operador de compras (C1, C2)', '', '', 'C1,C2,E');
RESET ROLE;

SELECT public.como(:UOS::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UOS operador de compras solo C1', '', '', 'C1,E');
RESET ROLE;

SELECT public.como(:UN::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UN operador sin permisos', '', '', 'C1,C2,E');
RESET ROLE;

SELECT public.como(:UV::uuid); SET ROLE authenticated;
SELECT public.chk_alcance('UV viewer solo C1', '', '', 'C1,E');
RESET ROLE;

-- ── 4. Visitante sin sesión: ni siquiera el privilegio ──────────────────────
SET ROLE anon;
SELECT public.chk_falla($$ SELECT count(*) FROM public.facturas_proveedor $$, 'permission denied', '4 · anon no lee facturas_proveedor (sin privilegio, no solo sin política)');
SELECT public.chk_falla($$ SELECT count(*) FROM public.conta_asientos $$, 'permission denied', '4 · anon no lee conta_asientos');
SELECT public.chk_falla($$ SELECT count(*) FROM public.conta_asiento_lineas $$, 'permission denied', '4 · anon no lee conta_asiento_lineas');
SELECT public.chk_falla($$ SELECT count(*) FROM public.ordenes_compra $$, 'permission denied', '4 · anon no lee ordenes_compra');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET notas = 'x' $$, 'permission denied', '4 · anon no escribe');
RESET ROLE;

-- ── 5. Privilegios: anon ninguno; authenticated sin TRUNCATE / TRIGGER / REFERENCES ──
DO $$
DECLARE
  t text; priv text; malos text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY['facturas_proveedor', 'factura_proveedor_lineas', 'contrasenas_pago', 'contrasena_pago_facturas',
                           'ordenes_pago', 'conta_asientos', 'conta_asiento_lineas', 'conta_cierres_anuales', 'conta_cuentas',
                           'conta_mapeo_cuentas', 'conta_tipos_cambio', 'conta_duplicados_descartados', 'conta_folios',
                           'ordenes_compra', 'orden_compra_lineas', 'recepciones', 'recepcion_lineas'] LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('anon', 'public.' || t, priv) THEN malos := malos || ' anon.' || t || ':' || priv; END IF;
    END LOOP;
    FOREACH priv IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('authenticated', 'public.' || t, priv) THEN malos := malos || ' authenticated.' || t || ':' || priv; END IF;
    END LOOP;
    -- Lo que SÍ debe conservar (RLS decide fila por fila).
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('authenticated', 'public.' || t, priv) THEN malos := malos || ' falta authenticated.' || t || ':' || priv; END IF;
    END LOOP;
  END LOOP;
  IF malos <> '' THEN RAISE EXCEPTION '5 · privilegios incorrectos:%', malos; END IF;
  RAISE NOTICE '✓ 5 · 17 tablas: anon sin privilegios; authenticated sin TRUNCATE/REFERENCES/TRIGGER y con SELECT/INSERT/UPDATE/DELETE';
END $$;

-- ── 6. Las funciones de reporte (SECURITY INVOKER) heredan el cierre ───────
-- Antes devolvían el libro a cualquier usuario de la empresa: su única autorización era la RLS.
SELECT public.como(:UV::uuid); SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.conta_balanza_comprobacion(:C::uuid, :C1::uuid, to_char(CURRENT_DATE, 'YYYY-MM'))), 0, '6 · UV (viewer) no obtiene balanza de comprobación');
SELECT public.chk((SELECT count(*) FROM public.cxp_antiguedad_saldos(:C::uuid, :C1::uuid)), 0, '6 · UV no obtiene la antigüedad de saldos');
SELECT public.chk((SELECT count(*) FROM public.conta_estado_resultados(:C::uuid, :C1::uuid, to_char(CURRENT_DATE, 'YYYY-MM'), to_char(CURRENT_DATE, 'YYYY-MM'))), 0, '6 · UV no obtiene el estado de resultados');
RESET ROLE;

SELECT public.como(:UO::uuid); SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.conta_balanza_comprobacion(:C::uuid, :C1::uuid, to_char(CURRENT_DATE, 'YYYY-MM'))), 0, '6 · UO (operador de compras) no obtiene balanza');
RESET ROLE;

SELECT public.como(:UK1::uuid); SET ROLE authenticated;
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.conta_balanza_comprobacion(:C::uuid, :C1::uuid, to_char(CURRENT_DATE, 'YYYY-MM'))), true, '6 · UK1 (contador de C1) SÍ obtiene la balanza de C1');
SELECT public.chk((SELECT count(*) FROM public.conta_balanza_comprobacion(:C::uuid, :C2::uuid, to_char(CURRENT_DATE, 'YYYY-MM'))), 0, '6 · …y NO la de C2, que no tiene asignado');
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.cxp_antiguedad_saldos(:C::uuid, :C1::uuid)), true, '6 · UK1 SÍ ve la antigüedad de saldos de C1');
RESET ROLE;

SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.conta_balanza_comprobacion(:C::uuid, :C2::uuid, to_char(CURRENT_DATE, 'YYYY-MM'))), true, '6 · UK (contador de C1 y C2) SÍ obtiene la balanza de C2');
RESET ROLE;

-- ── 7. RPC DEFINER de borradores del libro: exige el permiso ────────────────
SELECT public.como(:UV::uuid); SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT * FROM public.conta_borradores_sin_conversion() $$, 'acceso de lectura a Contabilidad', '7 · UV no consulta los borradores del libro');
RESET ROLE;
SELECT public.como(:UO::uuid); SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT * FROM public.conta_borradores_sin_conversion() $$, 'acceso de lectura a Contabilidad', '7 · UO tampoco');
RESET ROLE;
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.chk_bool((SELECT count(*) >= 0 FROM public.conta_borradores_sin_conversion()), true, '7 · UK (permiso de Contabilidad) sí la ejecuta');
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT public.chk_bool((SELECT count(*) >= 0 FROM public.conta_borradores_sin_conversion()), true, '7 · UA (admin) sí la ejecuta');
RESET ROLE;

-- ── 8. Una sola definición de «quién ve Contabilidad» ───────────────────────
-- conta_puede_leer() delega en prov_puede_ver_papeleria(): para cada perfil dan lo mismo,
-- y lo que dan coincide con la expectativa literal (true solo para quien lee finanzas).
CREATE TEMP TABLE perfiles (perfil text PRIMARY KEY, uid uuid, lee boolean);
GRANT SELECT ON perfiles TO authenticated;
INSERT INTO perfiles VALUES
  ('UA', :UA::uuid, true), ('UK', :UK::uuid, true), ('UK1', :UK1::uuid, true), ('UK0', :UK0::uuid, true),
  ('UA1', :UA1::uuid, true), ('UX', :UX::uuid, true), ('UCO', :UCO::uuid, true), ('USA', :USA::uuid, true), ('UD', :UD::uuid, true),
  ('UO', :UO::uuid, false), ('UOS', :UOS::uuid, false), ('UN', :UN::uuid, false), ('UV', :UV::uuid, false);
DO $$
DECLARE p record; r boolean; v boolean;
BEGIN
  FOR p IN SELECT * FROM perfiles ORDER BY perfil LOOP
    PERFORM public.como(p.uid);
    SET LOCAL ROLE authenticated;
    r := public.conta_puede_leer(); v := public.prov_puede_ver_papeleria();
    RESET ROLE;
    IF r IS DISTINCT FROM v THEN RAISE EXCEPTION '8 · % — conta_puede_leer (%) difiere de prov_puede_ver_papeleria (%)', p.perfil, r, v; END IF;
    IF r IS DISTINCT FROM p.lee THEN RAISE EXCEPTION '8 · % — conta_puede_leer() = %, esperado %', p.perfil, r, p.lee; END IF;
  END LOOP;
  RAISE NOTICE '✓ 8 · conta_puede_leer() coincide con prov_puede_ver_papeleria() y con lo esperado en los 13 perfiles';
END $$;
SELECT public.como(NULL::uuid);
SET ROLE anon;
SELECT public.chk_falla($$ SELECT public.conta_puede_leer() $$, 'permission denied', '8 · anon no ejecuta conta_puede_leer()');
RESET ROLE;

-- ── 9. Procesos automáticos y flujos legítimos siguen funcionando ───────────
-- 9a. La llave de servicio (reportes programados, cron) no pasa por RLS: ve todo.
SET ROLE service_role;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor f JOIN public.zz_etiquetas e ON e.tabla = 'facturas_proveedor' AND e.id = f.id), 4, '9a · service_role ve las 4 facturas (BYPASSRLS)');
SELECT public.chk((SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.zz_etiquetas e ON e.tabla = 'conta_asiento_lineas' AND e.id = l.id), 12, '9a · y las 12 líneas de asiento');
RESET ROLE;

-- 9b. Un trigger SECURITY DEFINER sigue contabilizando para un usuario SIN lectura contable:
-- aprobar es de quien aprueba (UA); el asiento lo escribe el sistema y lo ve quien tiene permiso.
SELECT public.como(:UA::uuid); SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, categoria, monto_total, iva_monto, fecha_emision)
VALUES ('f2000000-0000-0000-0000-0000000000f1', :C::uuid, :C1::uuid, 'e3000000-0000-0000-0000-000000000001', 'LF-NUEVA', 'Factura nueva LF', 'mantenimiento', 224, 24, CURRENT_DATE);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'f2000000-0000-0000-0000-0000000000f1';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = 'f2000000-0000-0000-0000-0000000000f1' AND estado <> 'anulado'), 1, '9b · aprobar una factura sigue generando UN asiento (trigger DEFINER, sin pasar por la RLS de lectura)');
SELECT public.como(:UK1::uuid); SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = 'f2000000-0000-0000-0000-0000000000f1'), 1, '9b · …y el contador de C1 lo ve');
RESET ROLE;
SELECT public.como(:UV::uuid); SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = 'f2000000-0000-0000-0000-0000000000f1'), 0, '9b · …y el viewer NO');
RESET ROLE;

-- 9c. Operaciones: crea y lee SU orden (INSERT … RETURNING pasa por la política de lectura) pero no su factura.
SELECT public.como(:UOS::uuid); SET ROLE authenticated;
WITH o AS (
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
  VALUES ('f9000000-0000-0000-0000-0000000000f2', :C::uuid, :C1::uuid, 'e3000000-0000-0000-0000-000000000001', 'Ferretería Bloque B', 'Orden de Operaciones LF')
  RETURNING id)
SELECT public.chk((SELECT count(*) FROM o), 1, '9c · UOS (Operaciones) crea una orden y la recibe de vuelta (RETURNING)');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES ('f9100000-0000-0000-0000-0000000000f2', :C::uuid, 'f9000000-0000-0000-0000-0000000000f2', 1, 'Renglón de Operaciones', 'gasto', 'mantenimiento', 5, 'u', 10);
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = 'f9000000-0000-0000-0000-0000000000f2'), 1, '9c · y sus renglones');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor), 0, '9c · pero por la API directa no ve NINGUNA factura de la empresa');
SELECT public.chk_bool((SELECT facturado IS NULL FROM public.compras_seguimiento_lista(NULL, NULL, NULL, NULL, NULL, false) WHERE orden_id = 'f9000000-0000-0000-0000-000000000001'), true,
  '9c · y el seguimiento le devuelve lo financiero en NULL (como antes)');
RESET ROLE;
SELECT public.como(:UK1::uuid); SET ROLE authenticated;
SELECT public.chk_bool((SELECT facturado IS NOT NULL FROM public.compras_seguimiento_lista(NULL, NULL, NULL, NULL, NULL, false) WHERE orden_id = 'f9000000-0000-0000-0000-000000000001'), true,
  '9c · el contador sí recibe lo facturado en el seguimiento');
RESET ROLE;

-- 9d. Contabilidad factura contra una orden por la RPC transaccional (INVOKER): necesita leer lo que acaba de crear.
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'f9000000-0000-0000-0000-0000000000f2';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = 'f9000000-0000-0000-0000-0000000000f2';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES ('f9200000-0000-0000-0000-0000000000f2', :C::uuid, :C1::uuid, 'f9000000-0000-0000-0000-0000000000f2', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (:C::uuid, 'f9200000-0000-0000-0000-0000000000f2', 'f9100000-0000-0000-0000-0000000000f2', 5);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'f9200000-0000-0000-0000-0000000000f2';
RESET ROLE;
SELECT public.como(:UK1::uuid); SET ROLE authenticated;
SELECT public.chk_txt((public.compras_factura_crear(:C::uuid, :C1::uuid,
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"f9000000-0000-0000-0000-0000000000f2","numero_factura":"LF-RPC-1","concepto":"Factura por RPC","clave_idempotencia":"lf-clave-rpc-0001"}'::jsonb,
  '[{"orden_compra_linea_id":"f9100000-0000-0000-0000-0000000000f2","cantidad":5,"precio_unitario":10,"iva_monto":0}]'::jsonb))->'factura'->>'estado', 'registrada',
  '9d · el contador de C1 factura por compras_factura_crear (RPC INVOKER) y recibe la factura de vuelta');
-- Una orden de C2 no la ve ni la factura: el alcance por proyecto también cubre la RPC.
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c2c2c2c2-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"f9000000-0000-0000-0000-000000000002","numero_factura":"LF-RPC-2","concepto":"Factura de C2","clave_idempotencia":"lf-clave-rpc-0002"}'::jsonb,
  '[{"orden_compra_linea_id":"f9100000-0000-0000-0000-000000000002","cantidad":1,"precio_unitario":10,"iva_monto":0}]'::jsonb) $$,
  'COMPRAS_FACTURA_PROYECTO|COMPRAS_FACTURA_ORDEN:|row-level security', '9d · UK1 no factura contra una orden de C2 (proyecto sin asignar: ni el proyecto ni la orden le son visibles)');
RESET ROLE;

-- ── 10. La política restrictiva de MFA sigue mandando ───────────────────────
-- Una empresa que exige MFA: sin aal2 no se lee nada financiero; con aal2 se lee igual que antes.
UPDATE public.companies SET mfa_required = true WHERE id = :C::uuid;
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.chk_txt(public.ver('facturas_proveedor'), '', '10 · con MFA exigido y sesión aal1, UK no lee facturas');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"aal":"aal2"}', false);
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.chk_txt(public.ver('facturas_proveedor'), 'C1,C2,E', '10 · con aal2, UK lee igual que sin MFA');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
UPDATE public.companies SET mfa_required = false WHERE id = :C::uuid;

-- ── 11. La escritura quedó como estaba: el cierre es de LECTURA ─────────────
-- Un viewer no inserta facturas (no está en la lista de roles de la política de escritura).
SELECT public.como(:UV::uuid); SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, categoria, monto_total)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'LF-V', 'Intento del viewer', 'mantenimiento', 10) $$,
  'row-level security', '11 · el viewer no inserta facturas (política de escritura intacta)');
RESET ROLE;
-- Un contador con permiso de editar pero que no ve la factura (otro proyecto) no puede tocarla.
SELECT public.como(:UK1::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET notas = 'intento cruzado' WHERE id = 'f2000000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'f2000000-0000-0000-0000-000000000002' AND notas = 'intento cruzado'), 0, '11 · UK1 no modifica la factura de C2 (no la ve: 0 filas afectadas)');
SELECT public.como(:UK1::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET notas = 'nota propia' WHERE id = 'f2000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'f2000000-0000-0000-0000-000000000001' AND notas = 'nota propia'), 1, '11 · …y sí modifica la de su proyecto (C1)');
