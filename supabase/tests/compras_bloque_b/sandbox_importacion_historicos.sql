-- ============================================================================
-- VALIDACIÓN EN SANDBOX · CARGA MASIVA y VINCULACIÓN DE CONTRATOS HISTÓRICOS (PR A) tras el bloque contratos–compras
-- Comprueba que lo ya existente SIGUE funcionando con las migraciones 20261024000000 … 20261025000000:
--   · carga masiva de proveedores y de contratos: vista previa sin escribir, errores por fila, «filas_validas»
--     aplica solo las buenas y lo declara PARCIAL; importar nunca autoriza proveedores ni activa contratos;
--   · vinculación de históricos: la simulación no cambia nada; solo se vinculan los INEQUÍVOCOS; las coincidencias
--     AMBIGUAS y las SIN coincidencia quedan pendientes para revisión manual (no se borran ni se fusionan);
--     el vínculo manual funciona; quien no tiene la pestaña no ve ni vincula.
--
-- SQL plano; UNA sola sentencia (DO) que TERMINA SIEMPRE con una excepción para REVERTIR todo:
--   GUION_OK_REVERTIDO → todo coincide · GUION_FALLO → alguna comprobación no coincide · otro → fallo del recorrido.
-- Sin DELETE ni DROP. Padrón de usar y tirar `5b5f…`.
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5b5f0000-0000-0000-0000-00000000000c';
  pj  constant uuid := '5b5f0000-0000-0000-0000-0000000000a1';
  ua  constant uuid := '5b5f0000-0000-0000-0000-0000000000f1';  -- admin
  un  constant uuid := '5b5f0000-0000-0000-0000-0000000000f2';  -- sin la pestaña de proveedores
  pu  constant uuid := '5b5f0000-0000-0000-0000-0000000000b1';  -- proveedor único
  pl1 constant uuid := '5b5f0000-0000-0000-0000-0000000000b2';
  pl2 constant uuid := '5b5f0000-0000-0000-0000-0000000000b3';
  h1  constant uuid := '5b5f0000-0000-0000-0000-0000000000e1';  -- histórico inequívoco
  h2  constant uuid := '5b5f0000-0000-0000-0000-0000000000e2';  -- solo difiere la forma societaria → ambigua
  h3  constant uuid := '5b5f0000-0000-0000-0000-0000000000e3';  -- varios proveedores con ese nombre → ambigua
  h4  constant uuid := '5b5f0000-0000-0000-0000-0000000000e4';  -- sin coincidencia
  ev  text[] := ARRAY[]::text[];
  j   jsonb;
  lote uuid;
  pucod text;
  fallos int;
  n_prov bigint; n_aut bigint; n_asi bigint; n_ctr bigint;
BEGIN
  CREATE FUNCTION pg_temp.ck(p_lbl text, p_o text, p_e text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce($2, 'NULL') || ' esperado=' || coalesce($3, 'NULL') $f$;
  CREATE FUNCTION pg_temp.err(p text) RETURNS text LANGUAGE plpgsql AS
    $f$ BEGIN EXECUTE p; RETURN 'SIN ERROR'; EXCEPTION WHEN OTHERS THEN RETURN split_part(SQLERRM, ':', 1); END $f$;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id = c) THEN
    RAISE EXCEPTION 'ABORTA: la empresa de prueba ya existe; no se escribe nada.';
  END IF;

  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ Importación', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ Imp Proyecto');
  INSERT INTO auth.users (id) VALUES (ua), (un);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES (ua, c, 'ZZ Imp Admin', 'admin'), (un, c, 'ZZ Imp Sin pestaña', 'operator');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (ua, pj, 'total'), (un, pj, 'total');

  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
    (pu,  c, 'ZZ Ferretería Unión', '9999961-1', 'GT', 'empresa');
  INSERT INTO public.proveedores (id, company_id, nombre, alcance) VALUES
    (pl1, c, 'ZZ Limpieza Total', 'empresa'),
    (pl2, c, 'ZZ LIMPIEZA TOTAL', 'empresa');
  SELECT codigo INTO pucod FROM public.proveedores WHERE id = pu;

  -- Contratos históricos: llegaron de antes del catálogo (sin proveedor vinculado), como sistema.
  PERFORM set_config('conta.allow_system_write', 'on', true);
  INSERT INTO public.contratos_proveedores (id, company_id, project_id, proveedor_nombre, proveedor_email, servicio, fecha_inicio, estado, monto_mensual) VALUES
    (h1, c, pj, 'ZZ FERRETERÍA UNIÓN',        NULL, 'mantenimiento', '2024-01-01', 'activo', 500),
    (h2, c, pj, 'ZZ Ferretería Unión, S.A.',  NULL, 'mantenimiento', '2024-01-01', 'activo', 500),
    (h3, c, pj, 'ZZ Limpieza Total',          NULL, 'limpieza',      '2024-01-01', 'activo', 900),
    (h4, c, pj, 'ZZ Empresa Inexistente S.A.', NULL, 'otro',         '2024-01-01', 'activo', 100);
  PERFORM set_config('conta.allow_system_write', 'off', true);

  SELECT count(*) INTO n_prov FROM public.proveedores WHERE company_id = c;
  SELECT count(*) INTO n_aut  FROM public.proveedores WHERE company_id = c AND estado = 'autorizado';
  SELECT count(*) INTO n_asi  FROM public.conta_asientos WHERE company_id = c;

  -- ═══ A · VINCULACIÓN DE HISTÓRICOS ═══════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('A1 · mismo nombre normalizado con UN proveedor: inequívoca',
    (SELECT clasificacion FROM public.contratos_sin_proveedor_vista_previa() WHERE contrato_id = h1), 'inequivoca');
  ev := ev || pg_temp.ck('A2 · solo difiere la forma societaria (S.A.): AMBIGUA, elección manual',
    (SELECT clasificacion FROM public.contratos_sin_proveedor_vista_previa() WHERE contrato_id = h2), 'ambigua');
  ev := ev || pg_temp.ck('A3 · varios proveedores con ese nombre: AMBIGUA',
    (SELECT clasificacion FROM public.contratos_sin_proveedor_vista_previa() WHERE contrato_id = h3), 'ambigua');
  ev := ev || pg_temp.ck('A4 · sin proveedor parecido: sin_coincidencia',
    (SELECT clasificacion FROM public.contratos_sin_proveedor_vista_previa() WHERE contrato_id = h4), 'sin_coincidencia');
  ev := ev || pg_temp.ck('A5 · y de la ambigua se listan TODOS los candidatos para elegir',
    (SELECT (jsonb_array_length(candidatos) >= 2)::text FROM public.contratos_sin_proveedor_vista_previa() WHERE contrato_id = h3), 'true');
  j := public.contratos_vinculacion_resumen();
  ev := ev || pg_temp.ck('A6 · el resumen propone 1 inequívoco, 2 ambiguos y 1 sin coincidencia',
    (j -> 'propuesta' ->> 'inequivocos') || '|' || (j -> 'propuesta' ->> 'ambiguos') || '|' || (j -> 'propuesta' ->> 'sin_coincidencia'), '1|2|1');
  j := public.contratos_vincular_inequivocos(true);
  ev := ev || pg_temp.ck('A7 · la simulación propone 1 y por defecto no vincula', (j ->> 'propuestos') || '|' || (public.contratos_vincular_inequivocos() ->> 'vinculados'), '1|0');
  RESET ROLE;
  ev := ev || pg_temp.ck('A8 · tras simular, ningún contrato quedó vinculado', (SELECT count(*)::text FROM public.contratos_proveedores WHERE company_id = c AND proveedor_id IS NOT NULL), '0');

  PERFORM set_config('request.jwt.claim.sub', un::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('A9 · sin la pestaña de proveedores no se ve la vista previa', pg_temp.err('SELECT * FROM public.contratos_sin_proveedor_vista_previa()'), 'No autorizado para revisar contratos de proveedores.');
  ev := ev || pg_temp.ck('A10 · …ni se vincula', pg_temp.err('SELECT public.contratos_vincular_inequivocos(false)'), 'No autorizado para vincular contratos a proveedores.');
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  j := public.contratos_vincular_inequivocos(false);
  RESET ROLE;
  ev := ev || pg_temp.ck('A11 · aplicar vincula SOLO el inequívoco', (j ->> 'vinculados') || '|' || (SELECT proveedor_id::text FROM public.contratos_proveedores WHERE id = h1), '1|' || pu::text);
  ev := ev || pg_temp.ck('A12 · las ambiguas y la sin coincidencia quedan PENDIENTES (sin proveedor, sin tocar)',
    (SELECT count(*)::text FROM public.contratos_proveedores WHERE id IN (h2, h3, h4) AND proveedor_id IS NULL), '3');
  ev := ev || pg_temp.ck('A13 · y no se borró ni se fusionó ninguno (siguen los 4 contratos)', (SELECT count(*)::text FROM public.contratos_proveedores WHERE company_id = c), '4');
  ev := ev || pg_temp.ck('A14 · el vínculo deja su evento de historial', (SELECT count(*)::text FROM public.contrato_proveedor_eventos WHERE contrato_id = h1 AND tipo = 'vinculo_proveedor'), '1');

  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  lote := public.contrato_vincular_proveedor(h2, pu, 'Misma empresa con razón social S.A.');
  PERFORM public.contrato_vincular_proveedor(h3, pl1, 'Se elige el primer homónimo tras revisar el contrato');
  RESET ROLE;
  ev := ev || pg_temp.ck('A15 · el vínculo MANUAL de las ambiguas funciona (con motivo)', (SELECT proveedor_id::text FROM public.contratos_proveedores WHERE id = h2) || '|' || (SELECT proveedor_id::text FROM public.contratos_proveedores WHERE id = h3), pu::text || '|' || pl1::text);
  ev := ev || pg_temp.ck('A16 · la sin coincidencia sigue pendiente hasta que alguien la resuelva', (SELECT (proveedor_id IS NULL)::text FROM public.contratos_proveedores WHERE id = h4), 'true');

  -- ═══ B · CARGA MASIVA ════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  j := public.proveedores_importar_previsualizar('proveedores', jsonb_build_array(
    jsonb_build_object('nombre', 'ZZ Papelería Central', 'pais', 'GT', 'nit', '9999962-2', 'email', 'ventas@zzpapeleria.test', 'abastece', 'suministros'),
    jsonb_build_object('nombre', 'ZZ Jardinería Verde', 'abastece', 'servicios'),
    jsonb_build_object('nombre', 'ZZ Autoproclamado', 'pais', 'GT', 'nit', '9999963-3', 'estado', 'autorizado'),
    jsonb_build_object('nombre', 'ZZ Con correo malo', 'email', 'no-es-un-correo', 'pais', 'GT', 'nit', '9999964-4')
  ), '{}'::jsonb, 'zz_proveedores.xlsx', 'sha256-zz-prov');
  lote := (j ->> 'lote_id')::uuid;
  RESET ROLE;
  ev := ev || pg_temp.ck('B1 · la vista previa NO escribe en el catálogo', (SELECT count(*)::text FROM public.proveedores WHERE company_id = c), n_prov::text);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('B2 · todo_o_nada con filas en error no aplica nada', pg_temp.err(format($q$SELECT public.proveedores_importar_aplicar(%L, 'todo_o_nada')$q$, lote)), 'LOTE_CON_ERRORES');
  j := public.proveedores_importar_aplicar(lote, 'filas_validas');
  RESET ROLE;
  ev := ev || pg_temp.ck('B3 · filas_validas aplica las 2 buenas, omite las 2 con error y lo declara PARCIAL',
    (j ->> 'estado') || '|' || (j ->> 'aplicadas') || '|' || (j ->> 'omitidas') || '|' || (j ->> 'parcial'), 'aplicado_parcial|2|2|true');
  ev := ev || pg_temp.ck('B4 · importar NO autoriza a nadie (los nuevos quedan sin autorizar y el «estado» pedido no se obedece)',
    (SELECT count(*)::text FROM public.proveedores WHERE company_id = c AND estado = 'autorizado'), n_aut::text);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  j := public.proveedores_importar_aplicar(lote, 'filas_validas');
  RESET ROLE;
  ev := ev || pg_temp.ck('B5 · reintentar el mismo lote no duplica nada', (SELECT count(*)::text FROM public.proveedores WHERE company_id = c), (n_prov + 2)::text);

  SELECT count(*) INTO n_ctr FROM public.contratos_proveedores WHERE company_id = c;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  j := public.proveedores_importar_previsualizar('contratos', jsonb_build_array(
    jsonb_build_object('referencia', 'ZZ-IMP-001', 'proveedor_codigo', pucod, 'proyecto', 'ZZ Imp Proyecto', 'servicio', 'limpieza',
      'modalidad', 'recurrente', 'periodicidad', 'mensual', 'moneda', 'GTQ', 'importe_periodico', '2500.50',
      'fecha_inicio', '2026-02-01', 'fecha_fin', '2026-12-31', 'alcance', 'Limpieza semanal'),
    jsonb_build_object('referencia', 'ZZ-IMP-002', 'proveedor_codigo', pucod, 'proyecto', 'ZZ Imp Proyecto', 'modalidad', 'recurrente', 'fecha_inicio', '2026-02-01'),
    jsonb_build_object('referencia', 'ZZ-IMP-003', 'proveedor_codigo', pucod, 'proyecto', 'ZZ Imp Proyecto', 'modalidad', 'por_demanda', 'fecha_inicio', '2026-02-01', 'estado', 'activo')
  ), '{}'::jsonb, 'zz_contratos.xlsx');
  lote := (j ->> 'lote_id')::uuid;
  RESET ROLE;
  ev := ev || pg_temp.ck('B6 · la vista previa de contratos no escribe', (SELECT count(*)::text FROM public.contratos_proveedores WHERE company_id = c), n_ctr::text);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  j := public.proveedores_importar_aplicar(lote, 'filas_validas');
  RESET ROLE;
  ev := ev || pg_temp.ck('B7 · se crea el contrato válido y se omiten el que no tiene periodicidad y el que intenta fijar «estado»',
    (j ->> 'aplicadas') || '|' || (j ->> 'omitidas'), '1|2');
  ev := ev || pg_temp.ck('B8 · el contrato importado NO queda activo (activarlo es una decisión explícita)',
    (SELECT estado FROM public.contratos_proveedores WHERE company_id = c AND referencia = 'ZZ-IMP-001'), 'borrador');
  ev := ev || pg_temp.ck('B9 · y queda ligado al proveedor del catálogo por id', (SELECT proveedor_id::text FROM public.contratos_proveedores WHERE company_id = c AND referencia = 'ZZ-IMP-001'), pu::text);
  ev := ev || pg_temp.ck('B10 · importar no genera asientos', (SELECT count(*)::text FROM public.conta_asientos WHERE company_id = c), n_asi::text);

  SELECT count(*) INTO fallos FROM unnest(ev) e WHERE e LIKE 'FALLO%';
  RAISE EXCEPTION '%', (CASE WHEN fallos = 0 THEN 'GUION_OK_REVERTIDO' ELSE 'GUION_FALLO' END)
    || ' · ' || array_length(ev, 1) || ' comprobaciones, ' || fallos || ' fallos' || E'\n' || array_to_string(ev, E'\n');
END;
$guion$;
