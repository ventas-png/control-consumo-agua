-- ============================================================================
-- VALIDACIÓN EN EL SANDBOX · cierre técnico del circuito de compras y contabilidad
-- (migraciones 20261026000000 … 20261026000400)
--
--   A · la lectura financiera exige permiso, empresa y proyecto (API directa, como cada perfil)
--   B · privilegios: anon sin acceso; authenticated sin TRUNCATE/REFERENCES/TRIGGER
--   C · reportes INVOKER y RPC DEFINER heredan el cierre
--   D · orden de compra: cabecera y renglones juntos, idempotente, todo o nada, desde Operaciones y Contabilidad
--   E · acumulación de lo facturado: sumar/restar, cierre y reapertura, error real que aborta todo, acumulado
--       descuadrado que se muestra
--
-- ES SQL (no una prueba de pantalla): comprueba el servidor del sandbox, no la interfaz.
-- NO cubre la concurrencia con sesiones simultáneas: esa vive en
-- supabase/tests/compras_cierre_tecnico/run.sh (PostgreSQL local, sesiones reales).
--
-- SQL plano (sin variables de psql): se puede pegar tal cual en el editor SQL o enviar por la API. Todo ocurre en UNA
-- sola sentencia (DO) y TERMINA SIEMPRE con una excepción para REVERTIR todo (no queda fila, función ni trigger de
-- prueba). Esa excepción es el canal de la evidencia y hay que LEERLA, no ignorarla:
--
--   · mensaje que empieza por  GUION_OK_REVERTIDO   → todas las comprobaciones coinciden con su valor esperado.
--   · mensaje que empieza por  GUION_FALLO          → alguna NO coincide (las líneas «FALLO» lo dicen).
--   · CUALQUIER OTRO mensaje (constraint, permiso, función inexistente…) → fallo real del recorrido.
--
-- Empresas, proyectos, usuarios y proveedor son de usar y tirar (UUID `5c0c…`); si ya existieran, aborta ANTES de escribir.
-- Solo aplicar en el sandbox `control-agua-rls-sandbox` (jwpmivhvlstslncrtokb), NUNCA en producción.
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5c0c0000-0000-0000-0000-00000000000c';  -- empresa
  cz  constant uuid := '5c0c0000-0000-0000-0000-00000000000d';  -- OTRA empresa
  pj1 constant uuid := '5c0c0000-0000-0000-0000-0000000000a1';  -- proyecto 1
  pj2 constant uuid := '5c0c0000-0000-0000-0000-0000000000a2';  -- proyecto 2 (misma empresa)
  pjz constant uuid := '5c0c0000-0000-0000-0000-0000000000a3';  -- proyecto de la otra empresa
  ua  constant uuid := '5c0c0000-0000-0000-0000-0000000000f1';  -- admin asignado a pj1 y pj2
  uk  constant uuid := '5c0c0000-0000-0000-0000-0000000000f2';  -- contador (permiso contable) asignado SOLO a pj1
  ukk constant uuid := '5c0c0000-0000-0000-0000-0000000000f3';  -- contador SIN asignaciones (no exento)
  uo  constant uuid := '5c0c0000-0000-0000-0000-0000000000f4';  -- operador de compras (Operaciones) asignado a pj1
  uv  constant uuid := '5c0c0000-0000-0000-0000-0000000000f5';  -- viewer asignado a pj1
  ux  constant uuid := '5c0c0000-0000-0000-0000-0000000000f6';  -- admin SIN asignaciones (exento)
  uz  constant uuid := '5c0c0000-0000-0000-0000-0000000000f7';  -- admin de la OTRA empresa
  pv  constant uuid := '5c0c0000-0000-0000-0000-0000000000b1';  -- proveedor
  pvz constant uuid := '5c0c0000-0000-0000-0000-0000000000b2';  -- proveedor de la otra empresa
  su1 constant uuid := '5c0c0000-0000-0000-0000-0000000000d1';  -- insumo de pj1
  su2 constant uuid := '5c0c0000-0000-0000-0000-0000000000d2';  -- insumo de pj2
  f1  constant uuid := '5c0c0000-0000-0000-0000-000000000f01';  -- factura sin orden, pj1
  f2  constant uuid := '5c0c0000-0000-0000-0000-000000000f02';  -- factura sin orden, pj2
  fe  constant uuid := '5c0c0000-0000-0000-0000-000000000f03';  -- factura sin orden, contabilidad de la EMPRESA
  oa  constant uuid := '5c0c0000-0000-0000-0000-000000000e01';  -- orden pj1 (lectura)
  ob  constant uuid := '5c0c0000-0000-0000-0000-000000000e02';  -- orden pj2 (lectura)
  oe  constant uuid := '5c0c0000-0000-0000-0000-000000000e03';  -- orden de la EMPRESA (lectura)
  ov  constant uuid := '5c0c0000-0000-0000-0000-000000000e04';  -- orden para la acumulación
  lv  constant uuid := '5c0c0000-0000-0000-0000-000000000e05';
  rv  constant uuid := '5c0c0000-0000-0000-0000-000000000e06';
  ev  text[] := ARRAY[]::text[];
  t   text;
  j   jsonb;
  j2  jsonb;
  n   numeric;
  oid_nuevo uuid;
  total_antes bigint;
  fallos int;
  tabla text;
  priv text;
  malos text;
BEGIN
  -- ── Comprobadores: valor OBTENIDO contra valor ESPERADO ───────────────────
  CREATE FUNCTION pg_temp.ck(p_lbl text, p_obtenido text, p_esperado text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce($2, 'NULL') || ' esperado=' || coalesce($3, 'NULL') $f$;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (c, cz)) THEN
    RAISE EXCEPTION 'ABORTA: la empresa de prueba ya existe; no se escribe nada.';
  END IF;

  -- ── Padrón de usar y tirar ────────────────────────────────────────────────
  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ Cierre técnico', 'gtq'), (cz, 'ZZ Cierre otra empresa', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj1, c, 'ZZ Proyecto 1'), (pj2, c, 'ZZ Proyecto 2'), (pjz, cz, 'ZZ Proyecto otra empresa');
  INSERT INTO auth.users (id) VALUES (ua), (uk), (ukk), (uo), (uv), (ux), (uz);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ Admin', 'admin'), (uk, c, 'ZZ Contador P1', 'operator'), (ukk, c, 'ZZ Contador sin proyectos', 'operator'),
    (uo, c, 'ZZ Operador compras', 'operator'), (uv, c, 'ZZ Viewer', 'viewer'), (ux, c, 'ZZ Admin exento', 'admin'),
    (uz, cz, 'ZZ Admin otra empresa', 'admin');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
    (ua, pj1, 'total'), (ua, pj2, 'total'), (uk, pj1, 'total'), (uo, pj1, 'total'), (uv, pj1, 'total'), (uz, pjz, 'total');
  INSERT INTO public.roles (id, company_id, name) VALUES
    ('5c0c0000-0000-0000-0000-0000000000c9', c, 'ZZ Contador'),
    ('5c0c0000-0000-0000-0000-0000000000c8', c, 'ZZ Operador compras');
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    ('5c0c0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.view',   'allow'),
    ('5c0c0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.create', 'allow'),
    ('5c0c0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.edit',   'allow'),
    ('5c0c0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.delete', 'allow'),
    ('5c0c0000-0000-0000-0000-0000000000c8', 'condominios.tab.ordenes_compra', 'allow'),
    ('5c0c0000-0000-0000-0000-0000000000c8', 'condominios.tab.suministros',    'allow');
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (uk, '5c0c0000-0000-0000-0000-0000000000c9'), (ukk, '5c0c0000-0000-0000-0000-0000000000c9'), (uo, '5c0c0000-0000-0000-0000-0000000000c8');

  -- Contabilidad PROPIA: catálogo y mapeos de la empresa y de cada proyecto.
  PERFORM public.conta_seed_catalogo(c, NULL);   PERFORM public.compras_seed_cuentas(c, NULL);
  PERFORM public.conta_seed_catalogo(c, pj1);    PERFORM public.compras_seed_cuentas(c, pj1);
  PERFORM public.conta_seed_catalogo(c, pj2);    PERFORM public.compras_seed_cuentas(c, pj2);
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
    (pv,  c,  'ZZ Proveedor cierre', '9999971-1', 'GT', 'empresa'),
    (pvz, cz, 'ZZ Proveedor otra empresa', '9999972-2', 'GT', 'empresa');
  INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida) VALUES
    (su1, c, pj1, 'ZZ Cloro P1', 'litro'), (su2, c, pj2, 'ZZ Cloro P2', 'litro');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = pv;
  RESET ROLE;

  -- Datos sembrados por ámbito: una factura en cada contabilidad (con su asiento, que genera el sistema) y una orden por ámbito.
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, categoria, monto_total, iva_monto, fecha_emision) VALUES
    (f1, c, pj1,  pv, 'ZZ-F1', 'Factura ZZ de P1',      'mantenimiento', 112, 12, CURRENT_DATE),
    (f2, c, pj2,  pv, 'ZZ-F2', 'Factura ZZ de P2',      'mantenimiento', 112, 12, CURRENT_DATE),
    (fe, c, NULL, pv, 'ZZ-FE', 'Factura ZZ de la empresa', 'mantenimiento', 112, 12, CURRENT_DATE);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id IN (f1, f2, fe);
  RESET ROLE;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
    (oa, c, pj1,  pv, 'ZZ Proveedor cierre', 'Orden ZZ P1'),
    (ob, c, pj2,  pv, 'ZZ Proveedor cierre', 'Orden ZZ P2'),
    (oe, c, NULL, pv, 'ZZ Proveedor cierre', 'Orden ZZ empresa');
  ev := ev || pg_temp.ck('0 padrón · 3 asientos de factura generados por el sistema', (SELECT count(*)::text FROM public.conta_asientos WHERE company_id = c AND origen_tabla = 'facturas_proveedor'), '3');

  -- ── A · LECTURA FINANCIERA por la API directa, como cada perfil ──────────
  -- (cuenta, para cada perfil, lo que ve de ESTA empresa de prueba)
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('A admin (P1,P2) · facturas',  (SELECT count(*)::text FROM public.facturas_proveedor WHERE company_id = c), '3');
  ev := ev || pg_temp.ck('A admin (P1,P2) · asientos',  (SELECT count(*)::text FROM public.conta_asientos WHERE company_id = c), '3');
  ev := ev || pg_temp.ck('A admin (P1,P2) · líneas de asiento', (SELECT count(*)::text FROM public.conta_asiento_lineas WHERE company_id = c), '9');
  ev := ev || pg_temp.ck('A admin (P1,P2) · órdenes',   (SELECT count(*)::text FROM public.ordenes_compra WHERE company_id = c), '3');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('A contador solo P1 · facturas (P1 + empresa; NO P2)', (SELECT count(*)::text FROM public.facturas_proveedor WHERE company_id = c), '2');
  ev := ev || pg_temp.ck('A contador solo P1 · asientos', (SELECT count(*)::text FROM public.conta_asientos WHERE company_id = c), '2');
  ev := ev || pg_temp.ck('A contador solo P1 · líneas de asiento', (SELECT count(*)::text FROM public.conta_asiento_lineas WHERE company_id = c), '6');
  ev := ev || pg_temp.ck('A contador solo P1 · no ve la factura de P2', (SELECT count(*)::text FROM public.facturas_proveedor WHERE id = f2), '0');
  ev := ev || pg_temp.ck('A contador solo P1 · órdenes (P1 + empresa)', (SELECT count(*)::text FROM public.ordenes_compra WHERE company_id = c), '2');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ukk::text, true); SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('A contador sin asignaciones · facturas (solo la de la EMPRESA)', (SELECT count(*)::text FROM public.facturas_proveedor WHERE company_id = c), '1');
  ev := ev || pg_temp.ck('A contador sin asignaciones · asientos', (SELECT count(*)::text FROM public.conta_asientos WHERE company_id = c), '1');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ux::text, true);  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('A admin exento (sin asignaciones) · facturas', (SELECT count(*)::text FROM public.facturas_proveedor WHERE company_id = c), '3');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('A Operaciones (sin permiso contable) · facturas', (SELECT count(*)::text FROM public.facturas_proveedor WHERE company_id = c), '0');
  ev := ev || pg_temp.ck('A Operaciones · asientos', (SELECT count(*)::text FROM public.conta_asientos WHERE company_id = c), '0');
  ev := ev || pg_temp.ck('A Operaciones · líneas de asiento', (SELECT count(*)::text FROM public.conta_asiento_lineas WHERE company_id = c), '0');
  ev := ev || pg_temp.ck('A Operaciones · catálogo de cuentas', (SELECT count(*)::text FROM public.conta_cuentas WHERE company_id = c), '0');
  ev := ev || pg_temp.ck('A Operaciones · SÍ ve las órdenes de su proyecto y la de la empresa', (SELECT count(*)::text FROM public.ordenes_compra WHERE company_id = c), '2');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uv::text, true);  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('A viewer · facturas', (SELECT count(*)::text FROM public.facturas_proveedor WHERE company_id = c), '0');
  ev := ev || pg_temp.ck('A viewer · asientos', (SELECT count(*)::text FROM public.conta_asientos WHERE company_id = c), '0');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('A admin de OTRA empresa · facturas de esta empresa', (SELECT count(*)::text FROM public.facturas_proveedor WHERE company_id = c), '0');
  ev := ev || pg_temp.ck('A admin de OTRA empresa · órdenes de esta empresa', (SELECT count(*)::text FROM public.ordenes_compra WHERE company_id = c), '0');
  RESET ROLE;

  -- ── B · PRIVILEGIOS ───────────────────────────────────────────────────────
  malos := '';
  FOREACH tabla IN ARRAY ARRAY['facturas_proveedor', 'factura_proveedor_lineas', 'contrasenas_pago', 'contrasena_pago_facturas', 'ordenes_pago',
                               'conta_asientos', 'conta_asiento_lineas', 'conta_cierres_anuales', 'conta_cuentas', 'conta_mapeo_cuentas',
                               'conta_tipos_cambio', 'conta_duplicados_descartados', 'conta_folios', 'ordenes_compra', 'orden_compra_lineas',
                               'recepciones', 'recepcion_lineas'] LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('anon', 'public.' || tabla, priv) THEN malos := malos || ' anon.' || tabla || ':' || priv; END IF;
    END LOOP;
    FOREACH priv IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('authenticated', 'public.' || tabla, priv) THEN malos := malos || ' authenticated.' || tabla || ':' || priv; END IF;
    END LOOP;
  END LOOP;
  ev := ev || pg_temp.ck('B 17 tablas · privilegios de más (anon, o TRUNCATE/REFERENCES/TRIGGER de authenticated)', coalesce(nullif(malos, ''), 'ninguno'), 'ninguno');
  SET LOCAL ROLE anon;
  BEGIN PERFORM count(*) FROM public.facturas_proveedor; t := 'SIN ERROR'; EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ' for ', 1); END;
  RESET ROLE;
  ev := ev || pg_temp.ck('B anon intenta leer facturas_proveedor', t, 'permission denied');

  -- ── C · REPORTES INVOKER y RPC DEFINER ───────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', uv::text, true);  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('C viewer · balanza de comprobación de P1', (SELECT count(*)::text FROM public.conta_balanza_comprobacion(c, pj1, to_char(CURRENT_DATE, 'YYYY-MM'))), '0');
  BEGIN PERFORM * FROM public.conta_borradores_sin_conversion(); t := 'SIN ERROR'; EXCEPTION WHEN OTHERS THEN t := SQLSTATE; END;
  ev := ev || pg_temp.ck('C viewer · conta_borradores_sin_conversion', t, '42501');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('C contador P1 · balanza de P1 tiene datos', (SELECT (count(*) > 0)::text FROM public.conta_balanza_comprobacion(c, pj1, to_char(CURRENT_DATE, 'YYYY-MM'))), 'true');
  ev := ev || pg_temp.ck('C contador P1 · balanza de P2 (sin asignar) vacía', (SELECT count(*)::text FROM public.conta_balanza_comprobacion(c, pj2, to_char(CURRENT_DATE, 'YYYY-MM'))), '0');
  BEGIN PERFORM * FROM public.conta_borradores_sin_conversion(); t := 'OK'; EXCEPTION WHEN OTHERS THEN t := SQLSTATE; END;
  ev := ev || pg_temp.ck('C contador · conta_borradores_sin_conversion', t, 'OK');
  RESET ROLE;

  -- ── D · ORDEN DE COMPRA: operación transaccional e idempotente ───────────
  -- D1 · Operaciones (solo con permiso de órdenes) crea cabecera + 2 renglones juntos.
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);  SET LOCAL ROLE authenticated;
  j := public.compras_orden_crear(c, pj1,
    format('{"proveedor_id":"%s","proveedor_nombre":"NOMBRE FALSO","concepto":"Orden ZZ de Operaciones","clave_idempotencia":"zz-cct-orden-01"}', pv)::jsonb,
    '[{"descripcion":"Material","destino_tipo":"gasto","categoria":"mantenimiento","cantidad":10,"unidad":"u","precio_unitario":10,"iva_monto":12},
      {"descripcion":"Insumo","destino_tipo":"gasto","categoria":"mantenimiento","cantidad":5,"unidad":"u","precio_unitario":20,"iva_monto":12}]'::jsonb);
  ev := ev || pg_temp.ck('D1 Operaciones · cabecera y 2 renglones en una operación (nueva, borrador)', ((j->>'reutilizada')::boolean)::text || '/' || (j->'orden'->>'estado') || '/' || jsonb_array_length(j->'lineas'), 'false/borrador/2');
  ev := ev || pg_temp.ck('D1 el nombre del proveedor lo pone el servidor', j->'orden'->>'proveedor_nombre', 'ZZ Proveedor cierre');
  ev := ev || pg_temp.ck('D1 el solicitante es quien llamó', ((j->'orden'->>'created_by')::uuid = uo)::text, 'true');
  ev := ev || pg_temp.ck('D1 el total sale de los renglones (224)', trim_scale((j->'orden'->>'total')::numeric)::text, '224');
  -- D2 · doble clic / respuesta perdida: LA MISMA orden.
  j2 := public.compras_orden_crear(c, pj1,
    format('{"proveedor_id":"%s","concepto":"Orden ZZ de Operaciones","clave_idempotencia":"zz-cct-orden-01"}', pv)::jsonb,
    '[{"descripcion":"Material","destino_tipo":"gasto","categoria":"mantenimiento","cantidad":10.0,"unidad":"u","precio_unitario":10.00,"iva_monto":12.00},
      {"descripcion":"Insumo","destino_tipo":"gasto","categoria":"mantenimiento","cantidad":5,"unidad":"u","precio_unitario":20,"iva_monto":12}]'::jsonb);
  ev := ev || pg_temp.ck('D2 reintento (cifras escritas distinto) · la MISMA orden', ((j2->>'reutilizada')::boolean)::text || '/' || ((j2->'orden'->>'id') = (j->'orden'->>'id'))::text, 'true/true');
  ev := ev || pg_temp.ck('D2 una sola orden con esa clave', (SELECT count(*)::text FROM public.ordenes_compra WHERE clave_idempotencia = 'zz-cct-orden-01'), '1');
  ev := ev || pg_temp.ck('D2 y dos renglones, no cuatro', (SELECT count(*)::text FROM public.orden_compra_lineas WHERE orden_compra_id = (j->'orden'->>'id')::uuid), '2');
  BEGIN PERFORM public.compras_orden_crear(c, pj1,
      format('{"proveedor_id":"%s","concepto":"Orden ZZ de Operaciones","clave_idempotencia":"zz-cct-orden-01"}', pv)::jsonb,
      '[{"descripcion":"Material","destino_tipo":"gasto","categoria":"mantenimiento","cantidad":9,"unidad":"u","precio_unitario":10,"iva_monto":12}]'::jsonb);
    t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('D2 misma clave con OTRO contenido', t, 'COMPRAS_ORDEN_CLAVE_CONFLICTO');
  -- D3 · TODO O NADA: el 2.º renglón es de inventario con un insumo de OTRO proyecto → no queda ni cabecera ni renglón 1.
  RESET ROLE;
  total_antes := (SELECT (SELECT count(*) FROM public.ordenes_compra) * 1000000 + (SELECT count(*) FROM public.orden_compra_lineas));
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.compras_orden_crear(c, pj1,
      format('{"proveedor_id":"%s","concepto":"Orden ZZ que falla","clave_idempotencia":"zz-cct-orden-fallo"}', pv)::jsonb,
      format('[{"descripcion":"Material","destino_tipo":"gasto","categoria":"mantenimiento","cantidad":1,"unidad":"u","precio_unitario":10},
               {"descripcion":"Cloro ajeno","destino_tipo":"inventario","suministro_id":"%s","categoria":"limpieza","cantidad":1,"unidad":"litro","precio_unitario":5}]', su2)::jsonb);
    t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  RESET ROLE;
  ev := ev || pg_temp.ck('D3 un insumo de otro proyecto en el 2.º renglón', t, 'COMPRAS_LINEA_INSUMO_ALCANCE');
  ev := ev || pg_temp.ck('D3 y NO queda ni cabecera ni renglones (órdenes×1e6 + renglones, antes = después)',
    (SELECT (SELECT count(*) FROM public.ordenes_compra) * 1000000 + (SELECT count(*) FROM public.orden_compra_lineas))::text, total_antes::text);
  -- D4 · el reintento corregido con la misma clave crea UNA orden.
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);  SET LOCAL ROLE authenticated;
  j2 := public.compras_orden_crear(c, pj1,
    format('{"proveedor_id":"%s","concepto":"Orden ZZ que falla","clave_idempotencia":"zz-cct-orden-fallo"}', pv)::jsonb,
    format('[{"descripcion":"Material","destino_tipo":"gasto","categoria":"mantenimiento","cantidad":1,"unidad":"u","precio_unitario":10},
             {"descripcion":"Cloro","destino_tipo":"inventario","suministro_id":"%s","categoria":"limpieza","cantidad":1,"unidad":"litro","precio_unitario":5}]', su1)::jsonb);
  ev := ev || pg_temp.ck('D4 el reintento corregido con la misma clave crea UNA orden con sus 2 renglones', (SELECT count(*)::text FROM public.ordenes_compra WHERE clave_idempotencia = 'zz-cct-orden-fallo') || '/' || jsonb_array_length(j2->'lineas'), '1/2');
  -- D5 · alcance por proyecto y por empresa; solo cabecera; permisos.
  BEGIN PERFORM public.compras_orden_crear(c, pj2, format('{"proveedor_id":"%s","concepto":"Orden en P2","clave_idempotencia":"zz-cct-orden-p2"}', pv)::jsonb, '[]'::jsonb);
    t := 'SIN ERROR'; EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('D5 Operaciones asignado solo a P1 no crea en P2', t, 'COMPRAS_ORDEN_PROYECTO');
  j2 := public.compras_orden_crear(c, pj1, format('{"proveedor_id":"%s","concepto":"Orden ZZ solo cabecera","clave_idempotencia":"zz-cct-orden-cab"}', pv)::jsonb, NULL);
  ev := ev || pg_temp.ck('D5 solo la cabecera (sin renglones) es válido', jsonb_array_length(j2->'lineas')::text, '0');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uv::text, true);  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.compras_orden_crear(c, pj1, format('{"proveedor_id":"%s","concepto":"Orden del viewer","clave_idempotencia":"zz-cct-orden-v"}', pv)::jsonb, '[]'::jsonb);
    t := 'SIN ERROR'; EXCEPTION WHEN OTHERS THEN t := CASE WHEN SQLERRM LIKE '%row-level security%' THEN 'row-level security' ELSE SQLERRM END; END;
  RESET ROLE;
  ev := ev || pg_temp.ck('D5 un viewer no crea órdenes (política de escritura de siempre)', t, 'row-level security');
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.compras_orden_crear(c, pj1, format('{"proveedor_id":"%s","concepto":"Desde otra empresa","clave_idempotencia":"zz-cct-orden-z"}', pv)::jsonb, '[]'::jsonb);
    t := 'SIN ERROR'; EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  RESET ROLE;
  ev := ev || pg_temp.ck('D5 el admin de otra empresa no crea en esta', t, 'COMPRAS_ORDEN_EMPRESA');
  -- D6 · Contabilidad (contador de P1) crea por la MISMA operación.
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);  SET LOCAL ROLE authenticated;
  j2 := public.compras_orden_crear(c, pj1, format('{"proveedor_id":"%s","concepto":"Orden ZZ de Contabilidad","clave_idempotencia":"zz-cct-orden-co"}', pv)::jsonb,
    '[{"descripcion":"Servicio","destino_tipo":"servicio","categoria":"mantenimiento","cantidad":1,"unidad":"u","precio_unitario":300,"iva_monto":36}]'::jsonb);
  ev := ev || pg_temp.ck('D6 Contabilidad · misma operación: borrador con su renglón', (j2->'orden'->>'estado') || '/' || jsonb_array_length(j2->'lineas'), 'borrador/1');
  RESET ROLE;

  -- ── E · ACUMULACIÓN DE LO FACTURADO ──────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);  SET LOCAL ROLE authenticated;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (ov, c, pj1, pv, 'ZZ Proveedor cierre', 'Orden ZZ de acumulación');
  INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
    VALUES (lv, c, ov, 1, 'Material', 'gasto', 'mantenimiento', 10, 'u', 10);
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = ov;
  UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = ov;
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES (rv, c, pj1, ov, 'bienes');
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (c, rv, lv, 10);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = rv;
  RESET ROLE;
  ev := ev || pg_temp.ck('E0 orden recibida completa', (SELECT estado FROM public.ordenes_compra WHERE id = ov), 'recibida');
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);  SET LOCAL ROLE authenticated;
  PERFORM public.compras_factura_crear(c, pj1,
    format('{"proveedor_id":"%s","orden_compra_id":"%s","numero_factura":"ZZ-AC1","concepto":"Factura ZZ de acumulación","clave_idempotencia":"zz-cct-fac-0001"}', pv, ov)::jsonb,
    format('[{"orden_compra_linea_id":"%s","cantidad":10,"precio_unitario":10,"iva_monto":0}]', lv)::jsonb);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);  SET LOCAL ROLE authenticated;
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'zz-cct-fac-0001';
  RESET ROLE;
  ev := ev || pg_temp.ck('E1 aprobar SUMA lo facturado y cierra la orden', (SELECT cantidad_facturada::text FROM public.orden_compra_lineas WHERE id = lv) || '/' || (SELECT estado FROM public.ordenes_compra WHERE id = ov), '10.0000/cerrada');
  -- E2 · un error REAL al acumular ABORTA la anulación entera (falla inyectada, en esta transacción).
  CREATE FUNCTION public.zz_cct_falla() RETURNS trigger LANGUAGE plpgsql AS
    $f$ BEGIN
      IF coalesce(current_setting('zz.falla', true), 'off') = 'on' AND NEW.cantidad_facturada IS DISTINCT FROM OLD.cantidad_facturada THEN
        RAISE EXCEPTION 'ZZ_FALLA_ACUMULACION: error simulado';
      END IF;
      RETURN NEW;
    END $f$;
  CREATE TRIGGER zz_cct_falla BEFORE UPDATE ON public.orden_compra_lineas FOR EACH ROW EXECUTE FUNCTION public.zz_cct_falla();
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);  SET LOCAL ROLE authenticated;
  PERFORM set_config('zz.falla', 'on', true);
  BEGIN UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'zz-cct-fac-0001'; t := 'SIN ERROR (la factura se anuló a pesar del fallo)';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  PERFORM set_config('zz.falla', 'off', true);
  RESET ROLE;
  ev := ev || pg_temp.ck('E2 un error real al acumular aborta la anulación', t, 'ZZ_FALLA_ACUMULACION');
  ev := ev || pg_temp.ck('E2 la factura sigue aprobada, lo facturado en 10 y la orden cerrada',
    (SELECT estado FROM public.facturas_proveedor WHERE clave_idempotencia = 'zz-cct-fac-0001') || '/' || (SELECT cantidad_facturada::text FROM public.orden_compra_lineas WHERE id = lv) || '/' || (SELECT estado FROM public.ordenes_compra WHERE id = ov),
    'aprobada/10.0000/cerrada');
  DROP TRIGGER zz_cct_falla ON public.orden_compra_lineas;
  DROP FUNCTION public.zz_cct_falla();
  -- E3 · sin la falla, anular RESTA y reabre la orden.
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);  SET LOCAL ROLE authenticated;
  UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'zz-cct-fac-0001';
  RESET ROLE;
  ev := ev || pg_temp.ck('E3 anular RESTA lo facturado y reabre la orden', (SELECT cantidad_facturada::text FROM public.orden_compra_lineas WHERE id = lv) || '/' || (SELECT estado FROM public.ordenes_compra WHERE id = ov), '0.0000/recibida');
  -- E4 · un acumulado descuadrado se MUESTRA (antes se recortaba a cero).
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);  SET LOCAL ROLE authenticated;
  PERFORM public.compras_factura_crear(c, pj1,
    format('{"proveedor_id":"%s","orden_compra_id":"%s","numero_factura":"ZZ-AC2","concepto":"Segunda factura ZZ","clave_idempotencia":"zz-cct-fac-0002"}', pv, ov)::jsonb,
    format('[{"orden_compra_linea_id":"%s","cantidad":10,"precio_unitario":10,"iva_monto":0}]', lv)::jsonb);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);  SET LOCAL ROLE authenticated;
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'zz-cct-fac-0002';
  RESET ROLE;
  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.orden_compra_lineas SET cantidad_facturada = 2 WHERE id = lv;      -- descuadre sembrado a propósito
  PERFORM set_config('conta.allow_system_write', 'off', true);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);  SET LOCAL ROLE authenticated;
  BEGIN UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'zz-cct-fac-0002'; t := 'SIN ERROR (recortó a cero)';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  RESET ROLE;
  ev := ev || pg_temp.ck('E4 anular con el acumulado descuadrado', t, 'COMPRAS_ACUMULACION_INCONSISTENTE');
  ev := ev || pg_temp.ck('E4 lo acumulado no se recortó (sigue en 2) y la factura sigue aprobada', (SELECT cantidad_facturada::text FROM public.orden_compra_lineas WHERE id = lv) || '/' || (SELECT estado FROM public.facturas_proveedor WHERE clave_idempotencia = 'zz-cct-fac-0002'), '2.0000/aprobada');

  -- ── Veredicto: SIEMPRE se revierte todo con una excepción ────────────────
  SELECT count(*) INTO fallos FROM unnest(ev) e WHERE e LIKE 'FALLO%';
  IF fallos = 0 THEN
    RAISE EXCEPTION E'GUION_OK_REVERTIDO: % comprobaciones coinciden con lo esperado\n%', cardinality(ev), array_to_string(ev, E'\n');
  ELSE
    RAISE EXCEPTION E'GUION_FALLO: % de % comprobaciones NO coinciden\n%', fallos, cardinality(ev), array_to_string(ev, E'\n');
  END IF;
END
$guion$;
