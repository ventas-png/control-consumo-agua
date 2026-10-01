\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · CARGA MASIVA (proveedores, asignaciones a proyectos, contratos)
-- El servidor valida, calcula acción y diferencias, registra el lote y aplica.
-- ============================================================================
\set A     '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set B     '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
\set A1    '''a1a1a1a1-0000-0000-0000-000000000001'''
\set A2    '''a2a2a2a2-0000-0000-0000-000000000001'''
\set UA    '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set UP1   '''a0a0a0a0-0000-0000-0000-00000000000f'''
\set UC    '''a0a0a0a0-0000-0000-0000-00000000000c'''
\set UO    '''a0a0a0a0-0000-0000-0000-00000000000d'''
\set UN    '''a0a0a0a0-0000-0000-0000-00000000000e'''
\set UB    '''b0b0b0b0-0000-0000-0000-00000000000b'''
\set P1    '''d1000000-0000-0000-0000-0000000000a1'''
\set P6    '''d2000000-0000-0000-0000-0000000000a6'''

SELECT public.como(:UA::uuid);

-- Estado de partida (para demostrar que importar no autoriza ni contabiliza).
SELECT codigo AS p1cod FROM public.proveedores WHERE id = :P1::uuid \gset
SELECT codigo AS p6cod FROM public.proveedores WHERE id = :P6::uuid \gset
UPDATE public.proveedores SET telefono = '5555-9999' WHERE id = :P1::uuid;

CREATE TEMP TABLE i_antes AS
SELECT (SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid)                        AS proveedores,
       (SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid AND estado = 'autorizado') AS autorizados,
       (SELECT count(*) FROM public.conta_asientos)     AS asientos,
       (SELECT count(*) FROM public.facturas_proveedor) AS facturas,
       (SELECT count(*) FROM public.ordenes_pago)       AS pagos,
       (SELECT count(*) FROM public.ordenes_compra)     AS ordenes,
       (SELECT count(*) FROM public.contratos_proveedores WHERE company_id = :A::uuid AND estado = 'activo') AS contratos_activos;
GRANT SELECT ON i_antes TO authenticated;

-- ═════════════════════════════ A · PROVEEDORES ══════════════════════════════
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('proveedores', jsonb_build_array(
  /* r2  crear */      jsonb_build_object('codigo','', 'nombre','Papelería Central', 'pais','GT', 'nit','4440001-1',
                         'email','ventas@papeleria.test', 'telefono','5555-3000', 'dias_credito','30',
                         'categoria_default','administrativo', 'abastece','suministros;equipos', 'alcance','empresa'),
  /* r3  crear s/id */ jsonb_build_object('nombre','Jardinería Verde', 'abastece','servicios'),
  /* r4  existente */  jsonb_build_object('nit','12345678', 'pais','GT', 'nombre','Ferretería La Unión', 'email','nuevo@launion.test'),
  /* r5  sin cambios */jsonb_build_object('nit','1234567-8', 'pais','MX', 'nombre','Distribuidora México'),
  /* r6  dup archivo */jsonb_build_object('nombre','Papelería Central (copia)', 'nit','444-0001-1', 'pais','gt'),
  /* r7  NIT ajeno */  jsonb_build_object('codigo', :'p6cod', 'nombre','Eléctricos del Norte, S.A.', 'nit','1234567-8', 'pais','GT'),
  /* r8  correo mal */ jsonb_build_object('nombre','Con correo malo', 'email','no-es-un-correo', 'pais','GT', 'nit','5550009-9'),
  /* r9  fórmula */    jsonb_build_object('nombre','=HYPERLINK("http://evil.test","click")', 'pais','GT', 'nit','6660001-1'),
  /* r10 autoriza */   jsonb_build_object('nombre','Autoproclamado', 'pais','GT', 'nit','7770001-1', 'estado','autorizado'),
  /* r11 NIT sin país*/jsonb_build_object('nombre','Sin país', 'nit','8880001-1'),
  /* r12 parecido */   jsonb_build_object('nombre','FERRETERIA LA UNION', 'nit','9990001-9', 'pais','GT'),
  /* r13 solo nombre */jsonb_build_object('nombre','limpieza total'),
  /* r14 col. rara */  jsonb_build_object('nombre','Con columna rara', 'pais','GT', 'nit','1110001-1', 'color_favorito','azul'),
  /* r15 abastece */   jsonb_build_object('nombre','Abastece mal', 'abastece','ropa')
), '{}'::jsonb, 'proveedores_octubre.xlsx', 'sha256-demo') ->> 'lote_id' AS lote_a1 \gset
RESET ROLE;

SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid), (SELECT proveedores FROM i_antes),
  'A1 · la vista previa NO modifica el catálogo');
SELECT public.chk_txt((SELECT estado FROM public.proveedor_importaciones WHERE id = :'lote_a1'::uuid),
  'previsualizado', 'A1 · el lote queda registrado como previsualizado');
SELECT public.chk_uuid((SELECT created_by FROM public.proveedor_importaciones WHERE id = :'lote_a1'::uuid),
  :UA::uuid, 'A1 · con su ACTOR');
SELECT public.chk_txt((SELECT archivo_nombre FROM public.proveedor_importaciones WHERE id = :'lote_a1'::uuid),
  'proveedores_octubre.xlsx', 'A1 · …el archivo y la fecha (created_at)');

CREATE OR REPLACE FUNCTION public.fila_a(p_lote uuid, p_fila int) RETURNS public.proveedor_importacion_filas
LANGUAGE sql STABLE AS $$ SELECT * FROM public.proveedor_importacion_filas WHERE lote_id = p_lote AND fila = p_fila $$;

SELECT public.chk_txt((public.fila_a(:'lote_a1'::uuid, 2)).accion, 'crear', 'A1 · r2: proveedor nuevo → CREAR');
SELECT public.chk_txt((public.fila_a(:'lote_a1'::uuid, 3)).accion, 'crear', 'A1 · r3: sin identificación → crear…');
SELECT public.chk_bool((public.fila_a(:'lote_a1'::uuid, 3)).advertencias::text LIKE '%no se pueden detectar duplicados%', true,
  'A1 · …con ADVERTENCIA de que no se podrán detectar duplicados');
SELECT public.chk_txt((public.fila_a(:'lote_a1'::uuid, 4)).accion, 'omitir',
  'A1 · r4: existente (NIT con otro formato) con cambios y «actualizar existentes» desactivado → OMITIR');
SELECT public.chk_txt((public.fila_a(:'lote_a1'::uuid, 4)).cambios -> 'email' ->> 'despues', 'nuevo@launion.test',
  'A1 · …y muestra QUÉ campo cambiaría (correo)');
SELECT public.chk_txt((public.fila_a(:'lote_a1'::uuid, 4)).cambios -> 'email' ->> 'antes', 'ventas@launion.test',
  'A1 · …con su valor anterior');
SELECT public.chk_bool(((public.fila_a(:'lote_a1'::uuid, 4)).cambios ? 'telefono'), false,
  'A1 · …y el teléfono vacío del archivo NO figura como cambio (no sobrescribe por celdas vacías)');
SELECT public.chk_txt((public.fila_a(:'lote_a1'::uuid, 5)).accion, 'sin_cambios',
  'A1 · r5: el mismo NIT en OTRO país conocido es otro proveedor, y sin diferencias → SIN CAMBIOS');
SELECT public.chk_txt((public.fila_a(:'lote_a1'::uuid, 6)).accion, 'error', 'A1 · r6: duplicada dentro del archivo → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_a1'::uuid, 6)).errores::text LIKE '%Duplicada dentro del archivo%', true,
  'A1 · …y lo dice (se conserva la primera)');
SELECT public.chk_bool((public.fila_a(:'lote_a1'::uuid, 7)).errores::text LIKE '%pertenece a otro proveedor%', true,
  'A1 · r7: identificación que pertenece a OTRO proveedor → ERROR explicado');
SELECT public.chk_txt((public.fila_a(:'lote_a1'::uuid, 8)).accion, 'error', 'A1 · r8: correo inválido → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_a1'::uuid, 9)).errores::text LIKE '%posible fórmula%', true,
  'A1 · r9: un valor que empieza con = se rechaza como posible fórmula');
SELECT public.chk_bool((public.fila_a(:'lote_a1'::uuid, 10)).errores::text LIKE '%no autoriza%', true,
  'A1 · r10: una columna «estado» no autoriza proveedores por importación');
SELECT public.chk_bool((public.fila_a(:'lote_a1'::uuid, 11)).errores::text LIKE '%indica su país%', true,
  'A1 · r11: identificación sin país → ERROR');
SELECT public.chk_txt((public.fila_a(:'lote_a1'::uuid, 12)).accion, 'crear',
  'A1 · r12: nombre casi igual a otro proveedor pero con OTRO NIT → crear (no se une por nombre)…');
SELECT public.chk_bool((public.fila_a(:'lote_a1'::uuid, 12)).advertencias::text LIKE '%casi idéntico%', true,
  'A1 · …con ADVERTENCIA de nombre casi idéntico');
SELECT public.chk_bool((public.fila_a(:'lote_a1'::uuid, 13)).errores::text LIKE '%Los nombres no unen registros%', true,
  'A1 · r13: solo el nombre de un proveedor existente → ERROR («los nombres no unen registros»)');
SELECT public.chk_txt((public.fila_a(:'lote_a1'::uuid, 14)).accion, 'crear', 'A1 · r14: columna desconocida → se ignora y se crea…');
SELECT public.chk_bool((public.fila_a(:'lote_a1'::uuid, 14)).advertencias::text LIKE '%Columna desconocida%', true,
  'A1 · …con advertencia');
SELECT public.chk_txt((public.fila_a(:'lote_a1'::uuid, 15)).accion, 'error', 'A1 · r15: «abastece» fuera del vocabulario → ERROR');

SELECT public.chk((SELECT (resumen ->> 'crear')::bigint FROM public.proveedor_importaciones WHERE id = :'lote_a1'::uuid), 4,
  'A1 · resumen: 4 a crear');
SELECT public.chk((SELECT (resumen ->> 'con_error')::bigint FROM public.proveedor_importaciones WHERE id = :'lote_a1'::uuid), 8,
  'A1 · resumen: 8 con error');
SELECT public.chk((SELECT (resumen ->> 'omitir')::bigint FROM public.proveedor_importaciones WHERE id = :'lote_a1'::uuid), 1,
  'A1 · resumen: 1 omitida');
SELECT public.chk((SELECT (resumen ->> 'sin_cambios')::bigint FROM public.proveedor_importaciones WHERE id = :'lote_a1'::uuid), 1,
  'A1 · resumen: 1 sin cambios');

-- Todo o nada con errores: no se aplica NADA.
SET ROLE authenticated;
SELECT public.chk_falla(format($$ SELECT public.proveedores_importar_aplicar(%L, 'todo_o_nada') $$, :'lote_a1'),
  'LOTE_CON_ERRORES', 'A2 · modo todo_o_nada con filas en error: no se aplica nada');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid), (SELECT proveedores FROM i_antes),
  'A2 · …y el catálogo sigue igual');
SELECT public.chk_txt((SELECT estado FROM public.proveedor_importaciones WHERE id = :'lote_a1'::uuid),
  'previsualizado', 'A2 · …y el lote sigue previsualizado');

-- Solo filas válidas: se aplican las buenas y TODO queda informado.
SET ROLE authenticated;
SELECT public.proveedores_importar_aplicar(:'lote_a1'::uuid, 'filas_validas') AS res_a \gset
RESET ROLE;
SELECT public.chk_txt(((:'res_a'::jsonb) ->> 'estado'), 'aplicado_parcial', 'A3 · filas_validas deja el lote como aplicado_PARCIAL (nunca silencioso)');
SELECT public.chk(((:'res_a'::jsonb) ->> 'aplicadas')::bigint, 4, 'A3 · se aplicaron las 4 válidas');
SELECT public.chk(((:'res_a'::jsonb) ->> 'sin_cambios')::bigint, 1, 'A3 · 1 sin cambios');
SELECT public.chk(((:'res_a'::jsonb) ->> 'omitidas')::bigint, 9, 'A3 · 9 omitidas (8 con error + la que no actualiza)');
SELECT public.chk_bool(((:'res_a'::jsonb) ->> 'parcial')::boolean, true, 'A3 · el resultado declara explícitamente que es PARCIAL');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid), (SELECT proveedores FROM i_antes) + 4,
  'A3 · el catálogo creció exactamente en 4');
SELECT public.chk((SELECT count(*) FROM public.proveedor_importacion_filas WHERE lote_id = :'lote_a1'::uuid AND estado = 'aplicada'), 4,
  'A3 · cada fila conserva su estado (4 aplicadas)');
SELECT public.chk((SELECT count(*) FROM public.proveedor_importacion_filas WHERE lote_id = :'lote_a1'::uuid AND estado = 'omitida'
                    AND resultado IS NOT NULL), 9, 'A3 · …y las 9 omitidas dicen por qué');
SELECT public.chk_bool((SELECT aplicado_por IS NOT NULL AND aplicado_at IS NOT NULL FROM public.proveedor_importaciones
                         WHERE id = :'lote_a1'::uuid), true, 'A3 · el lote registra quién y cuándo lo aplicó');

-- Lo creado: borrador, sin autorización, con código.
SELECT public.chk_txt((SELECT estado FROM public.proveedores WHERE company_id = :A::uuid AND nombre = 'Papelería Central'),
  'borrador', 'A4 · lo importado nace en BORRADOR');
SELECT public.chk_bool((SELECT autorizado_por IS NULL AND autorizado_at IS NULL FROM public.proveedores
                         WHERE company_id = :A::uuid AND nombre = 'Papelería Central'), true,
  'A4 · …sin sello de autorización');
SELECT public.chk_bool((SELECT codigo ~ '^PRV-' FROM public.proveedores WHERE company_id = :A::uuid AND nombre = 'Papelería Central'),
  true, 'A4 · …con código asignado por el servidor');
SELECT public.chk_txt((SELECT identificacion_norm FROM public.proveedores WHERE company_id = :A::uuid AND nombre = 'Papelería Central'),
  '44400011', 'A4 · …y su identificación normalizada');
SELECT public.chk_txt((SELECT array_to_string(abastece, ';') FROM public.proveedores WHERE company_id = :A::uuid AND nombre = 'Papelería Central'),
  'equipos;suministros', 'A4 · «abastece» se guardó como lista (servicios, suministros y equipos)');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid AND estado = 'autorizado'),
  (SELECT autorizados FROM i_antes), 'A4 · importar NO autorizó a ningún proveedor');
SELECT public.chk_txt((SELECT email FROM public.proveedores WHERE id = :P1::uuid), 'ventas@launion.test',
  'A4 · el existente NO se modificó (no se pidió actualizar)');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid AND nombre = 'FERRETERIA LA UNION'), 1,
  'A4 · el de nombre casi igual se creó APARTE (no se unió a «Ferretería La Unión»)');

-- Reaplicar: devuelve lo mismo y no ejecuta nada.
SET ROLE authenticated;
SELECT public.proveedores_importar_aplicar(:'lote_a1'::uuid, 'filas_validas') AS res_a2 \gset
RESET ROLE;
SELECT public.chk_bool(((:'res_a2'::jsonb) ->> 'repetido')::boolean, true, 'A5 · reaplicar un lote aplicado lo declara repetido');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid), (SELECT proveedores FROM i_antes) + 4,
  'A5 · …y no crea nada más');

-- Subir el MISMO archivo otra vez: sin duplicar.
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('proveedores', (SELECT jsonb_agg(origen ORDER BY fila)
  FROM public.proveedor_importacion_filas WHERE lote_id = :'lote_a1'::uuid), '{}'::jsonb, 'proveedores_octubre.xlsx', 'sha256-demo') AS prev_a2 \gset
RESET ROLE;
SELECT (:'prev_a2'::jsonb) ->> 'lote_id' AS lote_a2 \gset
SELECT public.chk_bool(((:'prev_a2'::jsonb) -> 'resumen' ? 'contenido_ya_aplicado'), true,
  'A6 · la segunda carga avisa que ese mismo contenido YA se aplicó (lote anterior)');
SELECT public.chk((SELECT (resumen ->> 'crear')::bigint FROM public.proveedor_importaciones WHERE id = :'lote_a2'::uuid), 0,
  'A6 · la repetición no propone crear NADA (lo creado ahora existe: se reconoce por NIT)');
SELECT public.chk_txt((public.fila_a(:'lote_a2'::uuid, 2)).accion, 'sin_cambios', 'A6 · «Papelería Central» → sin cambios (no se duplica)');
SELECT public.chk_txt((public.fila_a(:'lote_a2'::uuid, 12)).accion, 'sin_cambios', 'A6 · «FERRETERIA LA UNION» → sin cambios');
SELECT public.chk_bool((public.fila_a(:'lote_a2'::uuid, 3)).errores::text LIKE '%Los nombres no unen registros%', true,
  'A6 · una fila SIN código ni identificación no se puede reconocer: error explicado, NO un duplicado (usa «codigo»)');
SET ROLE authenticated;
SELECT public.proveedores_importar_aplicar(:'lote_a2'::uuid, 'filas_validas') AS res_a3 \gset
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid), (SELECT proveedores FROM i_antes) + 4,
  'A6 · aplicar la repetición no creó ni un proveedor más');

-- ═══════════ B · ACTUALIZAR EXISTENTES, CELDAS VACÍAS Y OPCIÓN EXPLÍCITA ═════
-- Con «actualizar existentes»: cambia solo lo que cambió; el vacío no borra.
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('proveedores', jsonb_build_array(
  jsonb_build_object('codigo', :'p1cod', 'nombre','Ferretería La Unión', 'email','nuevo@launion.test',
                     'telefono','', 'direccion','', 'dias_credito','')),
  '{"actualizar_existentes": true}'::jsonb, 'actualiza.csv') ->> 'lote_id' AS lote_b1 \gset
RESET ROLE;
SELECT public.chk_txt((public.fila_a(:'lote_b1'::uuid, 2)).accion, 'actualizar', 'B1 · con la opción activa la fila es ACTUALIZAR');
SELECT public.chk((SELECT count(*) FROM jsonb_object_keys((public.fila_a(:'lote_b1'::uuid, 2)).cambios)), 1,
  'B1 · cambia UN solo campo (correo): lo vacío del archivo no figura');
SET ROLE authenticated;
SELECT public.proveedores_importar_aplicar(:'lote_b1'::uuid, 'todo_o_nada') AS res_b1 \gset
RESET ROLE;
SELECT public.chk_txt(((:'res_b1'::jsonb) ->> 'estado'), 'aplicado', 'B1 · todo_o_nada limpio: aplicado completo');
SELECT public.chk_txt((SELECT email FROM public.proveedores WHERE id = :P1::uuid), 'nuevo@launion.test', 'B1 · el correo se actualizó');
SELECT public.chk_txt((SELECT telefono FROM public.proveedores WHERE id = :P1::uuid), '5555-9999',
  'B1 · el teléfono NO se borró por venir la celda vacía');
SELECT public.chk_txt((SELECT estado FROM public.proveedores WHERE id = :P1::uuid), 'autorizado',
  'B1 · actualizar un proveedor NO toca su autorización');
SELECT public.chk_bool((SELECT autorizado_por IS NOT NULL FROM public.proveedores WHERE id = :P1::uuid), true,
  'B1 · …ni su sello de autorización');

-- Vaciar solo con la opción EXPLÍCITA.
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('proveedores', jsonb_build_array(
  jsonb_build_object('codigo', :'p1cod', 'nombre','', 'telefono','', 'dias_credito','')),
  '{"actualizar_existentes": true, "vaciar_vacios": true}'::jsonb, 'vaciar.csv') ->> 'lote_id' AS lote_b2 \gset
RESET ROLE;
SELECT public.chk_bool((public.fila_a(:'lote_b2'::uuid, 2)).cambios ? 'telefono', true,
  'B2 · con «vaciar celdas vacías» el teléfono vacío SÍ figura como cambio');
SELECT public.chk_bool((public.fila_a(:'lote_b2'::uuid, 2)).cambios ? 'nombre', false,
  'B2 · pero el NOMBRE nunca se vacía');
SELECT public.chk_bool((public.fila_a(:'lote_b2'::uuid, 2)).cambios ? 'dias_credito', false,
  'B2 · ni los días de crédito (obligatorios)');
SET ROLE authenticated;
SELECT public.proveedores_importar_aplicar(:'lote_b2'::uuid, 'todo_o_nada') AS res_b2 \gset
RESET ROLE;
SELECT public.chk_bool((SELECT telefono IS NULL FROM public.proveedores WHERE id = :P1::uuid), true, 'B2 · el teléfono se vació (opción explícita)');
SELECT public.chk_txt((SELECT nombre FROM public.proveedores WHERE id = :P1::uuid), 'Ferretería La Unión', 'B2 · el nombre se conservó');

-- ═════════════════ C · ATOMICIDAD REAL, LOTE DESACTUALIZADO ══════════════════
-- Un trigger de prueba hace fallar el INSERT de una fila concreta.
CREATE OR REPLACE FUNCTION public.t_falla_al_aplicar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.nombre = 'Falla al aplicar' THEN RAISE EXCEPTION 'FALLA_SIMULADA: el insert se rechaza'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t_falla_al_aplicar BEFORE INSERT ON public.proveedores
  FOR EACH ROW EXECUTE FUNCTION public.t_falla_al_aplicar();

SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('proveedores', jsonb_build_array(
  jsonb_build_object('nombre','Atómico Uno',  'pais','GT', 'nit','2220001-1'),
  jsonb_build_object('nombre','Falla al aplicar', 'pais','GT', 'nit','2220002-2'),
  jsonb_build_object('nombre','Atómico Tres', 'pais','GT', 'nit','2220003-3')), '{}'::jsonb, 'atomico.csv') ->> 'lote_id' AS lote_c1 \gset
RESET ROLE;
SELECT public.chk((SELECT (resumen ->> 'crear')::bigint FROM public.proveedor_importaciones WHERE id = :'lote_c1'::uuid), 3,
  'C1 · la vista previa no ve el fallo (viene de un trigger en el momento de escribir)');
CREATE TEMP TABLE c_antes AS SELECT count(*) AS n FROM public.proveedores WHERE company_id = :A::uuid;
SET ROLE authenticated;
SELECT public.proveedores_importar_aplicar(:'lote_c1'::uuid, 'todo_o_nada') AS res_c1 \gset
RESET ROLE;
SELECT public.chk_txt(((:'res_c1'::jsonb) ->> 'estado'), 'fallido', 'C1 · todo_o_nada: si una fila falla al escribir, el lote queda FALLIDO');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid), (SELECT n FROM c_antes),
  'C1 · …y NO quedó NINGÚN proveedor a medias (atomicidad real)');
SELECT public.chk_bool(((:'res_c1'::jsonb) ->> 'error') LIKE '%FALLA_SIMULADA%', true, 'C1 · el resultado dice por qué');
SELECT public.chk((SELECT count(*) FROM public.proveedor_importacion_filas WHERE lote_id = :'lote_c1'::uuid AND estado = 'aplicada'), 0,
  'C1 · ninguna fila quedó marcada como aplicada');

-- Mismo archivo en modo filas_validas: la fila mala queda en error, las demás se aplican.
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('proveedores',
  (SELECT jsonb_agg(origen ORDER BY fila) FROM public.proveedor_importacion_filas WHERE lote_id = :'lote_c1'::uuid),
  '{}'::jsonb, 'atomico.csv') ->> 'lote_id' AS lote_c2 \gset
SELECT public.proveedores_importar_aplicar(:'lote_c2'::uuid, 'filas_validas') AS res_c2 \gset
RESET ROLE;
SELECT public.chk_txt(((:'res_c2'::jsonb) ->> 'estado'), 'aplicado_parcial', 'C2 · filas_validas: el lote queda aplicado_parcial');
SELECT public.chk(((:'res_c2'::jsonb) ->> 'aplicadas')::bigint, 2, 'C2 · se aplicaron las 2 buenas');
SELECT public.chk(((:'res_c2'::jsonb) ->> 'con_error')::bigint, 1, 'C2 · y se informa la que falló');
SELECT public.chk_bool((SELECT resultado LIKE '%FALLA_SIMULADA%' FROM public.proveedor_importacion_filas
                         WHERE lote_id = :'lote_c2'::uuid AND estado = 'error'), true, 'C2 · con el motivo en SU fila');
DROP TRIGGER t_falla_al_aplicar ON public.proveedores;

-- Lote desactualizado: otro usuario crea el mismo NIT entre la vista previa y la aplicación.
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('proveedores', jsonb_build_array(
  jsonb_build_object('nombre','Distribuciones del Sur', 'pais','GT', 'nit','3330001-1'),
  jsonb_build_object('nombre','Insumos del Oriente',    'pais','GT', 'nit','3330002-2')), '{}'::jsonb, 'desact.csv') ->> 'lote_id' AS lote_c3 \gset
RESET ROLE;
INSERT INTO public.proveedores (company_id, nombre, nit, pais) VALUES (:A::uuid, 'Distribuciones del Sur (alta manual)', '3330001-1', 'GT');
SET ROLE authenticated;
SELECT public.proveedores_importar_aplicar(:'lote_c3'::uuid, 'todo_o_nada') AS res_c3 \gset
RESET ROLE;
SELECT public.chk_bool(((:'res_c3'::jsonb) ->> 'desactualizado')::boolean, true,
  'C3 · si la base cambió desde la vista previa, todo_o_nada NO aplica a ciegas');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid AND nombre = 'Insumos del Oriente'), 0,
  'C3 · …y la otra fila del lote tampoco se aplicó');
SELECT public.chk_txt((SELECT estado FROM public.proveedor_importaciones WHERE id = :'lote_c3'::uuid), 'previsualizado',
  'C3 · el lote sigue previsualizado (hay que volver a previsualizar)');

-- ═══════════════════════════ D · ASIGNACIONES ═══════════════════════════════
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('asignaciones', jsonb_build_array(
  /* a1 */ jsonb_build_object('proveedor_codigo', :'p6cod', 'proyecto','Proyecto A2', 'dias_credito','15'),
  /* a2 */ jsonb_build_object('proveedor_identificacion','1234567-8', 'pais','GT', 'proyecto','Proyecto A1',
                              'dias_credito','45', 'notas','Condiciones renegociadas'),
  /* a3 */ jsonb_build_object('proveedor_codigo','PRV-99999', 'proyecto','Proyecto A1'),
  /* a4 */ jsonb_build_object('proveedor_codigo', :'p6cod', 'proyecto','Proyecto B1'),
  /* a5 */ jsonb_build_object('proveedor_codigo', :'p6cod', 'proyecto','Proyecto A2'),
  /* a6 */ jsonb_build_object('proveedor_codigo', :'p6cod', 'proyecto','Proyecto A1', 'estado','habilitado'),
  /* a7 */ jsonb_build_object('proveedor_codigo', :'p6cod', 'proyecto','Proyecto A1', 'vigente_hasta','31/12/2026')),
  '{"actualizar_existentes": true}'::jsonb, 'asignaciones.csv') ->> 'lote_id' AS lote_d1 \gset
RESET ROLE;
SELECT public.chk_txt((public.fila_a(:'lote_d1'::uuid, 2)).accion, 'crear', 'D1 · a1: proveedor sin vínculo en A2 → CREAR (pendiente)');
SELECT public.chk_txt((public.fila_a(:'lote_d1'::uuid, 3)).accion, 'actualizar', 'D1 · a2: vínculo existente → ACTUALIZAR solo condiciones');
SELECT public.chk_bool((public.fila_a(:'lote_d1'::uuid, 3)).cambios ? 'estado', false, 'D1 · …nunca el estado de habilitación');
SELECT public.chk_bool((public.fila_a(:'lote_d1'::uuid, 4)).errores::text LIKE '%No existe un proveedor%', true, 'D1 · a3: proveedor inexistente → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_d1'::uuid, 5)).errores::text LIKE '%no existe en tu empresa%', true,
  'D1 · a4: proyecto de OTRA empresa → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_d1'::uuid, 6)).errores::text LIKE '%Duplicada dentro del archivo%', true,
  'D1 · a5: la misma asignación dos veces en el archivo → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_d1'::uuid, 7)).errores::text LIKE '%no habilita%', true,
  'D1 · a6: una columna «estado» no habilita proveedores en proyectos');
SELECT public.chk_bool((public.fila_a(:'lote_d1'::uuid, 8)).errores::text LIKE '%AAAA-MM-DD%', true, 'D1 · a7: fecha inválida → ERROR');

SET ROLE authenticated;
SELECT public.proveedores_importar_aplicar(:'lote_d1'::uuid, 'filas_validas') AS res_d1 \gset
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.proveedor_proyectos WHERE proveedor_id = :P6::uuid AND project_id = :A2::uuid),
  'pendiente', 'D2 · importar crea la asignación PENDIENTE: no habilita');
SELECT public.chk_txt((SELECT estado FROM public.proveedor_proyectos WHERE proveedor_id = :P1::uuid AND project_id = :A1::uuid),
  'habilitado', 'D2 · y la existente conserva su habilitación');
SELECT public.chk((SELECT dias_credito FROM public.proveedor_proyectos WHERE proveedor_id = :P1::uuid AND project_id = :A1::uuid), 45,
  'D2 · …con sus condiciones actualizadas');

-- Alcance de proyecto: UP1 (solo A1) no puede importar para A2.
SELECT public.como(:UP1::uuid);
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('asignaciones', jsonb_build_array(
  jsonb_build_object('proveedor_codigo', :'p1cod', 'proyecto','Proyecto A2')), '{}'::jsonb, 'x.csv') ->> 'lote_id' AS lote_d2 \gset
RESET ROLE;
SELECT public.chk_bool((public.fila_a(:'lote_d2'::uuid, 2)).errores::text LIKE '%No tienes acceso%', true,
  'D3 · UP1 (solo A1) no puede importar asignaciones hacia un proyecto que no ve (A2)');
SELECT public.como(:UA::uuid);

-- ════════════════════════════ E · CONTRATOS ══════════════════════════════════
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('contratos', jsonb_build_array(
  /* c1 */  jsonb_build_object('referencia','IMP-001', 'proveedor_codigo', :'p1cod', 'proyecto','Proyecto A1', 'servicio','limpieza',
             'modalidad','recurrente', 'periodicidad','mensual', 'moneda','GTQ', 'importe_periodico','2500.50',
             'fecha_inicio','2026-02-01', 'fecha_fin','2026-12-31', 'alcance','Limpieza semanal de áreas comunes'),
  /* c2 */  jsonb_build_object('referencia','IMP-002', 'proveedor_identificacion','1234567-8', 'pais','GT', 'proyecto','Proyecto A1',
             'modalidad','por_demanda', 'moneda','GTQ', 'monto_maximo','10000', 'fecha_inicio','2026-02-01'),
  /* c3 */  jsonb_build_object('referencia','IMP-003', 'proveedor_codigo', :'p1cod', 'proyecto','Proyecto A1', 'modalidad','recurrente',
             'fecha_inicio','2026-02-01'),
  /* c4 */  jsonb_build_object('referencia','IMP-004', 'proveedor_codigo', :'p1cod', 'proyecto','Proyecto A1', 'modalidad','por_demanda',
             'importe_periodico','100', 'moneda','GTQ', 'fecha_inicio','2026-02-01'),
  /* c5 */  jsonb_build_object('referencia','IMP-005', 'proveedor_codigo', :'p1cod', 'proyecto','Proyecto A1', 'modalidad','recurrente',
             'periodicidad','mensual', 'moneda','GTQ', 'importe_periodico','1,5', 'fecha_inicio','2026-02-01'),
  /* c6 */  jsonb_build_object('referencia','IMP-006', 'proveedor_codigo', :'p1cod', 'proyecto','Proyecto A1', 'modalidad','por_demanda',
             'fecha_inicio','31/12/2026'),
  /* c7 */  jsonb_build_object('referencia','imp-001', 'proveedor_codigo', :'p1cod', 'proyecto','Proyecto A1', 'modalidad','por_demanda',
             'fecha_inicio','2026-02-01'),
  /* c8 */  jsonb_build_object('referencia','IMP-008', 'proveedor_identificacion','5550002-2', 'pais','GT', 'proyecto','Proyecto A1',
             'modalidad','por_demanda', 'fecha_inicio','2026-02-01'),
  /* c9 */  jsonb_build_object('referencia','IMP-009', 'proveedor_codigo', :'p1cod', 'proyecto','Proyecto B1', 'modalidad','por_demanda',
             'fecha_inicio','2026-02-01'),
  /* c10 */ jsonb_build_object('referencia','IMP-010', 'proveedor_codigo', :'p1cod', 'proyecto','Proyecto A1', 'modalidad','por_demanda',
             'fecha_inicio','2026-02-01', 'estado','activo'),
  /* c11 */ jsonb_build_object('proveedor_codigo', :'p1cod', 'proyecto','Proyecto A1', 'modalidad','por_demanda', 'fecha_inicio','2026-02-01')),
  '{}'::jsonb, 'contratos.xlsx') ->> 'lote_id' AS lote_e1 \gset
RESET ROLE;
SELECT public.chk_txt((public.fila_a(:'lote_e1'::uuid, 2)).accion, 'crear', 'E1 · c1: contrato recurrente → CREAR');
SELECT public.chk_txt((public.fila_a(:'lote_e1'::uuid, 3)).accion, 'crear', 'E1 · c2: compra por demanda sin importe periódico → CREAR');
SELECT public.chk_bool((public.fila_a(:'lote_e1'::uuid, 4)).errores::text LIKE '%necesita periodicidad%', true, 'E1 · c3: recurrente sin periodicidad → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_e1'::uuid, 5)).errores::text LIKE '%no lleva importe periódico%', true,
  'E1 · c4: por demanda con importe periódico → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_e1'::uuid, 6)).errores::text LIKE '%Importe inválido%', true, 'E1 · c5: importe con coma → ERROR (sin ambigüedad de miles)');
SELECT public.chk_bool((public.fila_a(:'lote_e1'::uuid, 7)).errores::text LIKE '%AAAA-MM-DD%', true, 'E1 · c6: fecha dd/mm/aaaa → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_e1'::uuid, 8)).errores::text LIKE '%Duplicada dentro del archivo%', true,
  'E1 · c7: referencia repetida en el archivo (sin distinguir mayúsculas) → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_e1'::uuid, 9)).errores::text LIKE '%suspendido%', true,
  'E1 · c8: proveedor suspendido → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_e1'::uuid, 10)).errores::text LIKE '%no existe en tu empresa%', true,
  'E1 · c9: proyecto de otra empresa → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_e1'::uuid, 11)).errores::text LIKE '%no activa contratos%', true,
  'E1 · c10: una columna «estado» no activa contratos');
SELECT public.chk_bool((public.fila_a(:'lote_e1'::uuid, 12)).errores::text LIKE '%La referencia es obligatoria%', true,
  'E1 · c11: sin referencia (clave de reintento) → ERROR');

SET ROLE authenticated;
SELECT public.proveedores_importar_aplicar(:'lote_e1'::uuid, 'filas_validas') AS res_e1 \gset
RESET ROLE;
SELECT public.chk(((:'res_e1'::jsonb) ->> 'aplicadas')::bigint, 2, 'E2 · se aplicaron los 2 contratos válidos');
SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE referencia = 'IMP-001' AND company_id = :A::uuid),
  'borrador', 'E2 · importar crea el contrato en BORRADOR (no lo activa)');
SELECT public.chk_txt((SELECT proveedor_nombre FROM public.contratos_proveedores WHERE referencia = 'IMP-001' AND company_id = :A::uuid),
  'Ferretería La Unión', 'E2 · con la fotografía del proveedor del catálogo');
SELECT public.chk_uuid((SELECT proveedor_id FROM public.contratos_proveedores WHERE referencia = 'IMP-001' AND company_id = :A::uuid),
  :P1::uuid, 'E2 · y el vínculo por proveedor_id (no por texto)');
SELECT public.chk(((SELECT importe_periodico FROM public.contratos_proveedores WHERE referencia = 'IMP-001' AND company_id = :A::uuid) * 100)::bigint, 250050,
  'E2 · el importe se guardó exacto (2500.50)');
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores WHERE company_id = :A::uuid AND estado = 'activo'),
  (SELECT contratos_activos FROM i_antes), 'E2 · importar NO activó ningún contrato');

-- Reintento: sin duplicar.
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('contratos',
  (SELECT jsonb_agg(origen ORDER BY fila) FROM public.proveedor_importacion_filas WHERE lote_id = :'lote_e1'::uuid AND fila IN (2, 3)),
  '{}'::jsonb, 'contratos.xlsx') ->> 'lote_id' AS lote_e2 \gset
RESET ROLE;
SELECT public.chk_txt((public.fila_a(:'lote_e2'::uuid, 2)).accion, 'sin_cambios', 'E3 · repetir la carga: IMP-001 → sin cambios');
SELECT public.chk_txt((public.fila_a(:'lote_e2'::uuid, 3)).accion, 'sin_cambios', 'E3 · IMP-002 → sin cambios');
SET ROLE authenticated;
SELECT public.proveedores_importar_aplicar(:'lote_e2'::uuid, 'todo_o_nada') AS res_e2 \gset
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores WHERE company_id = :A::uuid AND referencia IN ('IMP-001', 'IMP-002')), 2,
  'E3 · el reintento no duplicó contratos');

-- Un borrador sí se actualiza; uno ya activo NO se reescribe.
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('contratos', jsonb_build_array(
  jsonb_build_object('referencia','IMP-002', 'proveedor_codigo', :'p1cod', 'proyecto','Proyecto A1', 'modalidad','por_demanda',
                     'moneda','GTQ', 'monto_maximo','12000', 'fecha_inicio','2026-02-01')),
  '{"actualizar_existentes": true}'::jsonb, 'cambio.csv') ->> 'lote_id' AS lote_e3 \gset
RESET ROLE;
SELECT public.chk_txt((public.fila_a(:'lote_e3'::uuid, 2)).accion, 'actualizar', 'E4 · un contrato en BORRADOR se actualiza (con la opción activa)');
SELECT public.chk_txt((public.fila_a(:'lote_e3'::uuid, 2)).cambios -> 'monto_maximo' ->> 'despues', '12000.00',
  'E4 · …mostrando el campo que cambia');
SET ROLE authenticated;
SELECT public.proveedores_importar_aplicar(:'lote_e3'::uuid, 'todo_o_nada') AS res_e3 \gset
RESET ROLE;
SELECT public.chk((SELECT monto_maximo FROM public.contratos_proveedores WHERE referencia = 'IMP-002' AND company_id = :A::uuid)::bigint, 12000,
  'E4 · el borrador quedó actualizado');

-- Activar IMP-001 (acción de pantalla, no de la importación) y reimportar.
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET responsable_id = 'a0a0a0a0-0000-0000-0000-00000000000a', estado = 'activo'
 WHERE referencia = 'IMP-001' AND company_id = :A::uuid;
SELECT public.proveedores_importar_previsualizar('contratos', jsonb_build_array(
  jsonb_build_object('referencia','IMP-001', 'proveedor_codigo', :'p1cod', 'proyecto','Proyecto A1', 'servicio','limpieza',
             'modalidad','recurrente', 'periodicidad','mensual', 'moneda','GTQ', 'importe_periodico','3000.00',
             'fecha_inicio','2026-02-01', 'fecha_fin','2026-12-31', 'alcance','Limpieza semanal de áreas comunes')),
  '{"actualizar_existentes": true}'::jsonb, 'cambio2.csv') ->> 'lote_id' AS lote_e4 \gset
RESET ROLE;
SELECT public.chk_txt((public.fila_a(:'lote_e4'::uuid, 2)).accion, 'error', 'E5 · cambiar el importe de un contrato ya ACTIVO por importación → ERROR');
SELECT public.chk_bool((public.fila_a(:'lote_e4'::uuid, 2)).errores::text LIKE '%no se reescribe lo firmado%', true, 'E5 · …«no se reescribe lo firmado»');
-- El archivo ORIGINAL, sin cambios, sigue siendo un reintento válido aun con el contrato activo.
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('contratos',
  (SELECT jsonb_agg(origen) FROM public.proveedor_importacion_filas WHERE lote_id = :'lote_e1'::uuid AND fila = 2),
  '{}'::jsonb, 'contratos.xlsx') ->> 'lote_id' AS lote_e5 \gset
RESET ROLE;
SELECT public.chk_txt((public.fila_a(:'lote_e5'::uuid, 2)).accion, 'sin_cambios',
  'E5 · repetir el archivo original con el contrato ya activo da SIN CAMBIOS (reintento seguro)');

-- ═════════ F · IMPORTAR NO CONTABILIZA, NO AUTORIZA, NO GENERA DOCUMENTOS ═════
SELECT public.chk((SELECT count(*) FROM public.conta_asientos), (SELECT asientos FROM i_antes),
  'F1 · tras TODAS las importaciones no hay un solo asiento contable nuevo');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor), (SELECT facturas FROM i_antes), 'F1 · …ni facturas');
SELECT public.chk((SELECT count(*) FROM public.ordenes_pago), (SELECT pagos FROM i_antes), 'F1 · …ni pagos');
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra), (SELECT ordenes FROM i_antes), 'F1 · …ni órdenes de compra');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid AND estado = 'autorizado'),
  (SELECT autorizados FROM i_antes), 'F1 · …ni autorizó a ningún proveedor');
SELECT public.chk((SELECT count(*) FROM public.proveedor_proyectos WHERE estado = 'habilitado'
                    AND created_by = :UA::uuid AND habilitado_at > now() - interval '1 minute' AND proveedor_id = :P6::uuid), 0,
  'F1 · …ni habilitó a ningún proveedor en un proyecto');
