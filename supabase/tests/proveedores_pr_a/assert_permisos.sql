\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · PERMISOS DE LA CARGA MASIVA Y ENDURECIMIENTO DE FUNCIONES
-- ============================================================================
\set A     '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set UA    '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set UC    '''a0a0a0a0-0000-0000-0000-00000000000c'''
\set UO    '''a0a0a0a0-0000-0000-0000-00000000000d'''
\set UN    '''a0a0a0a0-0000-0000-0000-00000000000e'''
\set UB    '''b0b0b0b0-0000-0000-0000-00000000000b'''

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('proveedores', jsonb_build_array(
  jsonb_build_object('nombre','Proveedor de permisos', 'pais','GT', 'nit','1212121-2')), '{}'::jsonb, 'permisos.csv') ->> 'lote_id' AS lote_p \gset
RESET ROLE;

-- ── 1. Quién puede cargar qué ───────────────────────────────────────────────
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.proveedores_importar_previsualizar('proveedores', '[{"nombre":"X"}]'::jsonb) $$,
  '42501|No autorizado', '1 · UN (sin permisos) no carga proveedores');
SELECT public.chk_falla($$ SELECT public.proveedores_importar_previsualizar('contratos', '[{"referencia":"X"}]'::jsonb) $$,
  '42501|No autorizado', '1 · …ni contratos');
RESET ROLE;

SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.proveedores_importar_previsualizar('proveedores', '[{"nombre":"X"}]'::jsonb) $$,
  '42501|No autorizado', '1 · UO (consulta operativa, sin permiso contable) no carga proveedores');
SELECT public.chk_falla($$ SELECT public.proveedores_importar_previsualizar('asignaciones', '[{"proyecto":"X"}]'::jsonb) $$,
  '42501|No autorizado', '1 · …ni asignaciones (escribirlas es de Contabilidad)');
-- Sí carga contratos de SU proyecto: tiene el permiso de la pestaña de contratos.
SELECT public.proveedores_importar_previsualizar('contratos', jsonb_build_array(
  jsonb_build_object('referencia','OPE-001', 'proveedor_identificacion','1234567-8', 'pais','GT', 'proyecto','Proyecto A1',
                     'modalidad','por_demanda', 'fecha_inicio','2026-03-01')), '{}'::jsonb, 'ope.csv') ->> 'lote_id' AS lote_uo \gset
RESET ROLE;
SELECT public.chk_txt((SELECT accion FROM public.proveedor_importacion_filas WHERE lote_id = :'lote_uo'::uuid), 'crear',
  '1 · UO sí carga contratos de su proyecto (permiso de la pestaña)');
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.proveedores_importar_previsualizar('nada', '[{"x":1}]'::jsonb) $$,
  '42501|No autorizado', '1 · un tipo de carga inexistente no autoriza a nadie');
RESET ROLE;

-- ── 2. Un lote es de quien lo previsualizó, de su empresa ───────────────────
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla(format($$ SELECT public.proveedores_importar_aplicar(%L, 'todo_o_nada') $$, :'lote_p'),
  'No autorizado para aplicar este lote', '2 · UC (con permiso, misma empresa) no aplica el lote de OTRA persona');
SELECT public.chk_falla(format($$ SELECT public.proveedores_importar_descartar(%L) $$, :'lote_p'),
  '42501|No autorizado', '2 · …ni lo descarta');
SELECT public.chk((SELECT count(*) FROM public.proveedor_importaciones), 0,
  '2 · UC no ve los lotes que cargó otra persona (aunque tenga el mismo permiso)');
RESET ROLE;
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.chk_falla(format($$ SELECT public.proveedores_importar_aplicar(%L, 'todo_o_nada') $$, :'lote_p'),
  'LOTE_INEXISTENTE', '2 · UB (otra empresa) no aplica un lote de A: para él ni existe');
SELECT public.chk((SELECT count(*) FROM public.proveedor_importaciones), 0, '2 · UB no ve lotes de A');
SELECT public.chk((SELECT count(*) FROM public.proveedor_importacion_filas), 0, '2 · …ni sus filas');
RESET ROLE;
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.proveedor_importaciones), 0, '2 · UN no ve lotes');
RESET ROLE;
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.proveedor_importaciones WHERE tipo = 'proveedores'), 0,
  '2 · UO no ve los lotes de proveedores (sí los de contratos, que son suyos)');
SELECT public.chk((SELECT count(*) FROM public.proveedor_importaciones WHERE tipo = 'contratos'), 1,
  '2 · …y de los de contratos ve únicamente el SUYO: no los que otros cargaron para otros proyectos');
RESET ROLE;
SELECT public.como(:UA::uuid);

-- ── 3. La aplicación no escribe por otro camino ─────────────────────────────
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.proveedor_importaciones (company_id, tipo, contenido_sha256)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'proveedores', 'x') $$, 'permission denied',
  '3 · el navegador no inserta lotes directamente');
SELECT public.chk_falla($$ UPDATE public.proveedor_importaciones SET estado = 'aplicado' $$, 'permission denied',
  '3 · ni marca un lote como aplicado');
SELECT public.chk_falla($$ DELETE FROM public.proveedor_importacion_filas $$, 'permission denied',
  '3 · ni borra el resultado por fila');
SELECT public.chk_falla($$ SELECT public.prov_imp_aplicar_fila('proveedores', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'crear', NULL, '{"nombre":"Colado"}'::jsonb, '{}'::jsonb) $$,
  'permission denied', '3 · la función que escribe una fila no es invocable desde el navegador');
SELECT public.chk_falla($$ SELECT * FROM public.prov_imp_evaluar('proveedores', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}'::jsonb, '{}'::jsonb) $$,
  'permission denied', '3 · ni la que evalúa por fuera de la RPC (no acepta una empresa por parámetro del cliente)');
RESET ROLE;

-- ── 4. Límites y descarte ───────────────────────────────────────────────────
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.proveedores_importar_previsualizar('proveedores', '[]'::jsonb) $$,
  'ARCHIVO_VACIO', '4 · un archivo sin filas se rechaza');
SELECT public.chk_falla($$ SELECT public.proveedores_importar_previsualizar('proveedores', '{"nombre":"no es lista"}'::jsonb) $$,
  'ARCHIVO_VACIO', '4 · un contenido que no es una lista de filas se rechaza');
SELECT public.chk_falla($$ SELECT public.proveedores_importar_previsualizar('proveedores',
  (SELECT jsonb_agg(jsonb_build_object('nombre', 'P' || g)) FROM generate_series(1, 2001) g)) $$,
  'ARCHIVO_GRANDE', '4 · más de 2000 filas por carga se rechaza (se divide el archivo)');
SELECT public.proveedores_importar_previsualizar('proveedores', jsonb_build_array(
  jsonb_build_object('nombre','Descartable', 'pais','GT', 'nit','1313131-3'), '"no es objeto"'::jsonb,
  jsonb_build_object('nombre', repeat('x', 30000))), '{}'::jsonb, 'raro.csv') ->> 'lote_id' AS lote_d \gset
RESET ROLE;
SELECT public.chk_txt((public.fila_a(:'lote_d'::uuid, 3)).accion, 'error', '4 · una fila que no es un objeto se marca como error de la fila (no aborta el lote)');
SELECT public.chk_txt((public.fila_a(:'lote_d'::uuid, 4)).accion, 'error', '4 · una fila gigante se marca como error de la fila');
SET ROLE authenticated;
SELECT public.proveedores_importar_descartar(:'lote_d'::uuid);
SELECT public.chk_falla(format($$ SELECT public.proveedores_importar_aplicar(%L, 'filas_validas') $$, :'lote_d'),
  'LOTE_DESCARTADO', '4 · un lote descartado no se puede aplicar');
SELECT public.chk_falla($$ SELECT public.proveedores_importar_aplicar('00000000-0000-0000-0000-000000000000', 'filas_validas') $$,
  'LOTE_INEXISTENTE', '4 · un lote inexistente se rechaza');
SELECT public.chk_falla(format($$ SELECT public.proveedores_importar_aplicar(%L, 'a_medias') $$, :'lote_p'),
  'MODO_INVALIDO', '4 · el modo debe ser todo_o_nada o filas_validas (no hay un tercero implícito)');
RESET ROLE;

-- ── 5. ACL de las funciones nuevas: anon nada; internas, solo el servidor ───
-- Las que la aplicación llama, authenticated; las internas, nadie del cliente.
SELECT public.chk((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public'
                      AND p.proname IN ('proveedor_habilitado_en', 'proveedores_duplicados_fiscales', 'prov_puede_ver_papeleria',
                         'contratos_sin_proveedor_vista_previa', 'contratos_vinculacion_resumen', 'contrato_vincular_proveedor',
                         'contratos_vincular_inequivocos', 'contratos_vinculos_revertir', 'contrato_respaldo_autoriza',
                         'compras_resolver_cuenta_linea', 'compras_sugerir_cuenta', 'compras_config_estado',
                         'compras_reemplazar_regla_cuenta', 'compras_categorias', 'compras_destinos_linea',
                         'proveedores_importar_previsualizar', 'proveedores_importar_aplicar', 'proveedores_importar_descartar',
                         'prov_import_puede', 'proveedor_normalizar_identificacion', 'proveedor_normalizar_nombre',
                         'proveedor_nombre_base')
                      AND has_function_privilege('anon', p.oid, 'EXECUTE')), 0,
  '5 · ninguna función pública nueva es ejecutable por anon');
SELECT public.chk((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public'
                      AND p.proname IN ('proveedor_siguiente_codigo', 'proveedores_tg_identidad', 'proveedor_contactos_tg',
                         'proveedor_proyectos_tg', 'compras_tg_oc_proveedor_proyecto', 'contratos_proveedores_tg',
                         'contratos_proveedores_eventos_tg', 'contratos_proveedores_borrado_tg', 'compras_tg_oc_contrato',
                         'conta_cuenta_apta_destino', 'conta_reglas_compra_tg', 'conta_reglas_compra_borrado_tg',
                         'contrato_vincular_proveedor_interno', 'prov_imp_aplicar_fila', 'prov_imp_evaluar',
                         'prov_imp_eval_proveedor', 'prov_imp_eval_asignacion', 'prov_imp_eval_contrato',
                         'prov_imp_resolver_proveedor', 'prov_imp_resolver_proyecto', 'prov_imp_txt', 'prov_imp_fecha',
                         'prov_imp_err', 'prov_imp_sospechoso')
                      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))), 0,
  '5 · las funciones internas y de trigger no son ejecutables ni por anon ni por authenticated');
SELECT public.chk((SELECT count(*) FROM information_schema.role_table_grants
                    WHERE table_schema = 'public' AND grantee = 'anon'
                      AND table_name IN ('proveedor_contactos', 'proveedor_proyectos', 'proveedor_correlativos',
                         'contrato_proveedor_eventos', 'conta_reglas_compra', 'proveedor_importaciones',
                         'proveedor_importacion_filas')), 0,
  '5 · anon no tiene ningún privilegio sobre las tablas nuevas');
SELECT public.chk((SELECT count(*) FROM information_schema.role_table_grants
                    WHERE table_schema = 'public' AND grantee = 'authenticated'
                      AND table_name = 'proveedor_correlativos'), 0,
  '5 · el correlativo de códigos es deny-all para la aplicación');
SELECT public.chk((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
                      AND c.relname IN ('proveedor_contactos', 'proveedor_proyectos', 'proveedor_correlativos',
                         'contrato_proveedor_eventos', 'conta_reglas_compra', 'proveedor_importaciones',
                         'proveedor_importacion_filas')), 0,
  '5 · todas las tablas nuevas tienen RLS habilitada');
SELECT public.chk_txt('ok', 'ok', 'PERMISOS · bloque completo');
