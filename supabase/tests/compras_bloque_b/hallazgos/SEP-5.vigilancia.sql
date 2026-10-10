\set ON_ERROR_STOP on
-- ============================================================================
-- SEP-5 · La consulta de vigilancia de la separación (vigilancia.sql): detecta lo que debe detectar y es de SOLO LECTURA.
--
-- Se corre con la ruta de la consulta:   psql -v vigilancia_sql=/ruta/a/vigilancia.sql -f SEP-5.vigilancia.sql
-- (el arnés de este grupo la pasa solo). La consulta se lee con `cat` a una variable de psql y se materializa con CREATE TEMP TABLE … AS,
-- así lo que se prueba es el archivo tal cual se entrega.
--
-- COMPORTAMIENTO ESPERADO
--   · separacion_sistema   una fila por cada cambio de SISTEMA que apagó la separación (no por los que la encendieron ni por los de personas).
--   · separacion_sin_fila  la bitácora dice «activa» y la empresa no tiene fila en compras_config.
--   · separacion_sin_base  la fila está encendida y la bitácora no la respalda (sin ninguna fila, o su última fila dice «apagada»).
--   · Nada de lo anterior aparece cuando todo es coherente (RPC de personas, filas respaldadas).
--   · Es de solo lectura: corre en una transacción READ ONLY, con un rol que solo tiene SELECT, sin asignar identificador de
--     transacción (no escribió nada) y sin alterar el contenido de las tablas.
-- ============================================================================
-- Sin -v vigilancia_sql, se busca scripts/vigilancia-separacion-compras.sql subiendo desde el directorio de trabajo (la disposición del repo).
\if :{?vigilancia_sql}
\else
\set vigilancia_sql `for d in . .. ../.. ../../.. ../../../..; do [ -f "$d/scripts/vigilancia-separacion-compras.sql" ] && { echo "$d/scripts/vigilancia-separacion-compras.sql"; break; }; done`
\endif
\if :{?vigilancia_sql}
\else
DO $$ BEGIN RAISE EXCEPTION 'SEP-5: falta la ruta de la consulta: psql -v vigilancia_sql=/ruta/a/vigilancia.sql'; END $$;
\endif
SELECT (:'vigilancia_sql' <> '') AS hay_ruta \gset
\if :hay_ruta
\else
DO $$ BEGIN RAISE EXCEPTION 'SEP-5: no se encontró scripts/vigilancia-separacion-compras.sql; indica la ruta con psql -v vigilancia_sql=/ruta/a/vigilancia.sql'; END $$;
\endif
\ir SEP-0.padron.sql
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
-- K1: una «empresa» nueva en cada corrida (sin filas de bitácora previas); no existe en companies: se crea su fila con los triggers apagados.
SELECT quote_literal(gen_random_uuid()::text) AS "K1" \gset
\set vig `cat :vigilancia_sql`

-- La consulta es un SELECT y nada más (comprobación estática del archivo, sin comentarios)
SELECT regexp_replace(regexp_replace(:'vig', '--[^\n]*', '', 'g'), '\s+', ' ', 'g') AS vig_sin_comentarios \gset
SELECT public.chk_bool(:'vig_sin_comentarios' ~* '^ *with .* select .*; *$', true, '[SEP-5a] el archivo es una sola sentencia WITH … SELECT terminada en «;»');
SELECT public.chk_bool(:'vig_sin_comentarios' !~* '\m(insert|update|delete|truncate|create|alter|drop|grant|revoke|copy|vacuum|analyze|lock|set_config|nextval|setval|pg_advisory|perform|execute|do)\M', true,
  '[SEP-5a] y no contiene ninguna palabra de escritura, de DDL ni de bloqueo');

-- Rol de solo lectura para probarla (se borra al final)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sep5_vigia') THEN CREATE ROLE sep5_vigia NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO sep5_vigia;
GRANT SELECT ON public.compras_config, public.compras_config_separacion_bitacora, public.companies TO sep5_vigia;

SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_preparar(:D::uuid, NULL);

-- ── 1 · Estado coherente: ni sin_fila ni sin_base para C ni D ─────────────────
CREATE TEMP TABLE v1 AS :vig
SELECT public.chk((SELECT count(*) FROM v1 WHERE apartado IN ('separacion_sin_fila', 'separacion_sin_base') AND (id = :C OR id = :D)), 0,
  '[SEP-5b] con C y D sin fila y la bitácora al día (apagadas): ni «sin fila» ni «sin base»');
SELECT count(*) AS s0 FROM v1 WHERE apartado = 'separacion_sistema' AND detalle LIKE '%' || :C || '%' \gset

-- ── 2 · El sistema borra la fila encendida: aparece UNA fila de «separacion_sistema» (la carga de sistema que la ENCENDIÓ no cuenta) ──
SELECT public.sep_preparar(:C::uuid, true);
CREATE TEMP TABLE v2 AS :vig
SELECT public.chk((SELECT count(*) FROM v2 WHERE apartado = 'separacion_sistema' AND detalle LIKE '%' || :C || '%'), :s0,
  '[SEP-5c] el sistema ENCENDIÓ la separación de C: no es un apagado, no se lista');
SELECT public.como_sistema($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$);
CREATE TEMP TABLE v3 AS :vig
SELECT public.chk((SELECT count(*) FROM v3 WHERE apartado = 'separacion_sistema' AND detalle LIKE '%' || :C || '%'), :s0 + 1,
  '[SEP-5d] el sistema BORRÓ la fila encendida de C: aparece UNA fila nueva en «separacion_sistema»');
SELECT public.chk_bool((SELECT bool_and(detalle LIKE '%sin sesión de usuario%' AND detalle LIKE '%SIGUE existiendo%' AND tabla = 'compras_config_separacion_bitacora')
                          FROM v3 WHERE apartado = 'separacion_sistema' AND detalle LIKE '%' || :C || '%' AND id = (SELECT max(id::bigint)::text FROM v3 WHERE apartado = 'separacion_sistema' AND detalle LIKE '%' || :C || '%')),
  true, '[SEP-5d] y dice que fue el sistema, sin sesión de usuario, y que la empresa sigue existiendo');
SELECT public.chk((SELECT count(*) FROM v3 WHERE apartado IN ('separacion_sin_fila', 'separacion_sin_base') AND id = :C), 0,
  '[SEP-5d] el borrado de sistema quedó anotado como apagado: la bitácora y la ausencia coinciden, no es «sin fila»');

-- ── 3 · Una persona cambia por la RPC: no aparece como sistema ni como incoherencia ──
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT (public.compras_separacion_configurar(:C::uuid, true, 'Encendida por el administrador de C (vigilancia)') ->> 'aprobacion_separada') AS ok \gset
SELECT (public.compras_separacion_configurar(:C::uuid, false, 'Apagada por el administrador de C (vigilancia)') ->> 'aprobacion_separada') AS ok \gset
SELECT (public.compras_separacion_configurar(:C::uuid, true, 'Vuelve a encenderla el administrador (vigilancia)') ->> 'aprobacion_separada') AS ok \gset
RESET ROLE;
CREATE TEMP TABLE v4 AS :vig
SELECT public.chk((SELECT count(*) FROM v4 WHERE apartado = 'separacion_sistema' AND detalle LIKE '%' || :C || '%'), :s0 + 1,
  '[SEP-5e] encender y apagar por la RPC (origen «usuario») no suma filas a «separacion_sistema»');
SELECT public.chk((SELECT count(*) FROM v4 WHERE apartado IN ('separacion_sin_fila', 'separacion_sin_base') AND id = :C), 0,
  '[SEP-5e] y una fila encendida respaldada por la bitácora (por la RPC) no es «sin base» ni «sin fila»');

-- ── 4 · La fila desaparece sin pasar por los triggers (la bitácora sigue diciendo «activa») ──
SELECT public.sep_borrar_sin_rastro(:C::uuid);
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'SIN FILA', '[SEP-5f] (preparación) la fila de C desapareció sin rastro');
CREATE TEMP TABLE v5 AS :vig
SELECT public.chk((SELECT count(*) FROM v5 WHERE apartado = 'separacion_sin_fila' AND id = :C), 1,
  '[SEP-5f] «separacion_sin_fila»: la bitácora de C dice activa y no hay fila');
SELECT public.chk((SELECT count(*) FROM v5 WHERE apartado = 'separacion_sin_base' AND id = :C), 0, '[SEP-5f] y no es «sin base» (no hay fila encendida)');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT (public.compras_separacion_configurar(:C::uuid, true, 'Restablezco la fila ausente de la separación') ->> 'restablecida') AS rest \gset
RESET ROLE;
SELECT public.chk_txt(:'rest', 'true', '[SEP-5g] (preparación) la RPC restableció la fila ausente');
CREATE TEMP TABLE v6 AS :vig
SELECT public.chk((SELECT count(*) FROM v6 WHERE apartado IN ('separacion_sin_fila', 'separacion_sin_base') AND id = :C), 0, '[SEP-5g] restablecida la fila, desaparece del informe');

-- ── 5 · Fila encendida sin respaldo: sin ninguna fila de bitácora, y con la última fila «apagada» ──
SELECT public.como_sistema(format($f$ SET LOCAL session_replication_role = replica;
  INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (%L, true);
  SET LOCAL session_replication_role = origin $f$, :K1));
SELECT public.chk_txt(public.sep_valor(:K1::uuid), 'true', '[SEP-5h] (preparación) una fila ENCENDIDA creada con los triggers deshabilitados: la bitácora no se enteró');
SELECT public.chk(public.sep_nbit(:K1::uuid), 0, '[SEP-5h] (preparación) sin ninguna fila de bitácora');
CREATE TEMP TABLE v7 AS :vig
SELECT public.chk((SELECT count(*) FROM v7 WHERE apartado = 'separacion_sin_base' AND id = :K1 AND detalle LIKE '%NINGUNA fila%línea base%'), 1,
  '[SEP-5h] «separacion_sin_base»: encendida y sin ninguna fila de bitácora (falta la línea base)');
-- C: la RPC la dejó encendida; se apaga por la RPC y luego se ENCIENDE por fuera
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT (public.compras_separacion_configurar(:C::uuid, false, 'Apagada por el administrador para la prueba') ->> 'aprobacion_separada') AS ok \gset
RESET ROLE;
SELECT public.como_sistema($$ SET LOCAL session_replication_role = replica;
  UPDATE public.compras_config SET aprobacion_separada = true WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  SET LOCAL session_replication_role = origin $$);
CREATE TEMP TABLE v8 AS :vig
SELECT public.chk((SELECT count(*) FROM v8 WHERE apartado = 'separacion_sin_base' AND id = :C AND detalle LIKE '%la da por apagada%'), 1,
  '[SEP-5i] «separacion_sin_base»: la fila de C está encendida y la última fila de la bitácora la da por apagada');

-- ── 6 · Solo lectura: READ ONLY + un rol que solo tiene SELECT + ningún identificador de transacción asignado + tablas intactas ──
SELECT md5(COALESCE((SELECT string_agg(g::text, '|' ORDER BY g.company_id) FROM public.compras_config g), '')
        || '#' || COALESCE((SELECT string_agg(b::text, '|' ORDER BY b.id) FROM public.compras_config_separacion_bitacora b), '')) AS antes \gset
BEGIN READ ONLY;
SET LOCAL ROLE sep5_vigia;
\o /dev/null
\i :vigilancia_sql
\o
SELECT txid_current_if_assigned() IS NULL AS sin_escribir \gset
SELECT current_setting('transaction_read_only') AS ro \gset
COMMIT;
RESET ROLE;
SELECT public.chk_txt(:'ro', 'on', '[SEP-5j] la consulta se corrió en una transacción READ ONLY');
SELECT public.chk_bool(:'sin_escribir'::boolean, true, '[SEP-5j] y con un rol que solo tiene SELECT: la transacción no llegó a tener identificador (no escribió nada)');
SELECT md5(COALESCE((SELECT string_agg(g::text, '|' ORDER BY g.company_id) FROM public.compras_config g), '')
        || '#' || COALESCE((SELECT string_agg(b::text, '|' ORDER BY b.id) FROM public.compras_config_separacion_bitacora b), '')) AS despues \gset
SELECT public.chk_txt(:'despues', :'antes', '[SEP-5j] el contenido de compras_config y de la bitácora es idéntico antes y después');
-- control de la propia prueba: en esa misma modalidad, una escritura SÍ falla (la guarda muerde)
BEGIN READ ONLY;
SET LOCAL ROLE sep5_vigia;
SELECT public.chk_falla($$ INSERT INTO public.compras_config_separacion_bitacora (company_id, valor_nuevo, origen) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'sistema') $$,
  'read-only transaction|permission denied', '[SEP-5k] control: con esa modalidad y ese rol, una escritura sí se rechaza');
ROLLBACK;
RESET ROLE;

-- ── Limpieza: la configuración sin fila (la bitácora es append-only y conserva sus filas) y el rol de la prueba ──
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_preparar(:D::uuid, NULL);
SELECT public.como_sistema(format($f$ DELETE FROM public.compras_config WHERE company_id = %L $f$, :K1));
REVOKE ALL ON public.compras_config, public.compras_config_separacion_bitacora, public.companies FROM sep5_vigia;
REVOKE USAGE ON SCHEMA public FROM sep5_vigia;
DROP ROLE sep5_vigia;
