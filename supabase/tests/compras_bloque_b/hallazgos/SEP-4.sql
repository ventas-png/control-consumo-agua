\set ON_ERROR_STOP on
-- ============================================================================
-- SEP-4 · Ronda de correcciones de la separación solicitante/aprobador (escéptico independiente).
--
-- COMPORTAMIENTO ESPERADO
--   A · Quien tiene un JWT válido pero NO tiene fila en app_users («el fantasma»: OAuth antes del onboarding, perfil borrado con la
--       sesión viva, alta anónima) no es nadie: no enciende ni apaga la separación de ninguna empresa —propia inexistente, ajena o de
--       otro— ni por la RPC ni por la vía directa, y no lee la bitácora. (current_user_role(), is_super_admin() y get_my_company_id()
--       devuelven NULL para él y `IF NOT (NULL OR NULL)` es NULL: la autorización se saltaba entera.)
--   B · Un administrador, propietario o super administrador DESACTIVADO (app_users.activo = false) no usa la RPC ni lee la bitácora;
--       al reactivarlo, sí.
--   C · El motivo es ÚTIL: al menos 10 letras o cifras (no basta la longitud) y al menos una letra; un motivo real con tildes pasa en
--       bases UTF8 y SQL_ASCII. Los invisibles y los signos no cuentan.
--   D · (simulación) Ninguna condición de seguridad de la pieza se salta cuando un dato de la sesión es NULL: lo desconocido no autoriza.
--   E · Los cambios de SISTEMA siguen su camino (decisión pendiente del dueño): aquí solo se comprueba que quedan anotados.
--
-- Ids propios: personas 5e94…d1-d4 (y la empresa inexistente 5e94…fe) y el fantasma 9999…f1 (distintos de los de SEP-0 y de SEP-idempotencia). Se puede correr más de una vez. Deja la configuración de compras sin fila
-- (la bitácora conserva sus filas: es append-only).
-- ============================================================================
\ir SEP-0.padron.sql
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set SE  '''5e900000-0000-0000-0000-0000000000e1'''
\set GH  '''99999999-9999-9999-9999-9999999999f1'''
\set AD  '''5e940000-0000-0000-0000-0000000000d1'''
\set OD  '''5e940000-0000-0000-0000-0000000000d2'''
\set SD  '''5e940000-0000-0000-0000-0000000000d3'''
\set DE  '''5e940000-0000-0000-0000-0000000000d4'''
\set NE  '''5e940000-0000-0000-0000-0000000000d5'''
\set XX  '''5e940000-0000-0000-0000-0000000000fe'''

INSERT INTO auth.users (id) VALUES (:GH::uuid), (:AD::uuid), (:OD::uuid), (:SD::uuid), (:DE::uuid), (:NE::uuid) ON CONFLICT DO NOTHING;
-- GH: existe en auth, NO en app_users.  AD/OD/SD: administrador, propietario y super administrador de C DESACTIVADOS.  DE: administrador
-- de una empresa propia que ya no existe (no hay llave foránea en app_users.company_id).  NE: administrador SIN empresa (company_id NULL).
INSERT INTO public.app_users (id, company_id, full_name, role, activo) VALUES
  (:AD::uuid, :C::uuid, 'SEP4 Administrador DESACTIVADO de C',                    'admin',         false),
  (:OD::uuid, :C::uuid, 'SEP4 Propietario DESACTIVADO de C',                      'company_owner', false),
  (:SD::uuid, :C::uuid, 'SEP4 Super administrador DESACTIVADO',                   'super_admin',   false),
  (:DE::uuid, :XX::uuid, 'SEP4 Administrador de una empresa que ya no existe',    'admin',         true),
  (:NE::uuid, NULL,      'SEP4 Administrador SIN empresa (company_id NULL)',      'admin',         true)
ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, role = EXCLUDED.role, activo = EXCLUDED.activo;

SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_preparar(:D::uuid, NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- A · El fantasma: JWT válido, sin fila en app_users
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.chk((SELECT count(*) FROM public.app_users WHERE id = :GH::uuid), 0, '[SEP-4a] el principal de la prueba existe en auth.users pero NO tiene fila en app_users');
-- el administrador legítimo enciende C (para comprobar que el fantasma no la apaga) y D queda sin configuración
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT (public.compras_separacion_configurar(:C::uuid, true, 'Encendida por el administrador legítimo de C') ->> 'aprobacion_separada') AS ok \gset
RESET ROLE;
SELECT public.sep_nbit(:C::uuid) AS a0 \gset
SELECT public.sep_nbit(:D::uuid) AS a0d \gset

SELECT public.como(:GH::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.current_user_role() IS NULL AND public.is_super_admin() IS NULL AND public.get_my_company_id() IS NULL, true,
  '[SEP-4a] la causa: sin fila en app_users el rol, «es super administrador» y la empresa son NULL (no false)');
-- por la RPC: empresa ajena que existe (C, con la separación encendida por su administrador), otra empresa que existe (D) y una que no existe
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Un principal sin perfil intenta apagar C') $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-4b] sin fila en app_users no apaga la separación que encendió el administrador de C');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('dddddddd-dddd-dddd-dddd-dddddddddddd', true, 'Un principal sin perfil intenta encender D') $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-4b] ni enciende la de otra empresa (D)');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('5e940000-0000-0000-0000-0000000000fe', true, 'Un principal sin perfil y una empresa que no existe') $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-4b] ni una empresa que no existe: el rechazo no revela si existe (ni EMPRESA_INEXISTENTE ni ALCANCE)');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'Un principal sin perfil pide lo que ya está') $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-4b] ni siquiera «sin cambio» llega: la autorización va primero');
-- por la vía directa (la API): ni la configuración ni la bitácora
SELECT public.chk_falla($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', true) $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-4c] por la vía directa: INSERT de la configuración de otra empresa ENCENDIDA: lo rechaza el trigger (que corre antes que la RLS)');
SELECT public.chk_falla($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', false) $$,
  'row-level security', '[SEP-4c] y apagada: lo corta la RLS (no es de su empresa; ni tiene empresa)');
SELECT public.chk(public.sep_filas($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$), 0,
  '[SEP-4c] UPDATE directo del interruptor de C: 0 filas (RLS: no es de su empresa)');
SELECT public.chk(public.sep_filas($$ UPDATE public.compras_config SET aprobacion_separada = false $$), 0, '[SEP-4c] UPDATE directo sin WHERE: 0 filas');
SELECT public.chk(public.sep_filas($$ DELETE FROM public.compras_config $$), 0, '[SEP-4c] DELETE directo sin WHERE: 0 filas');
SELECT public.chk((SELECT count(*) FROM public.compras_config), 0, '[SEP-4c] ni siquiera ve la configuración de las empresas');
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora), 0, '[SEP-4c] la bitácora no le muestra ni una fila (RLS)');
SELECT public.chk_falla($$ INSERT INTO public.compras_config_separacion_bitacora (company_id, valor_nuevo, origen) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'sistema') $$,
  'permission denied', '[SEP-4c] y no escribe en la bitácora');
SELECT public.chk_falla($$ TRUNCATE public.compras_config $$, 'permission denied', '[SEP-4c] ni vacía la configuración');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-4d] la separación de C sigue encendida: la apagó nadie');
SELECT public.chk_txt(public.sep_valor(:D::uuid), 'SIN FILA', '[SEP-4d] D sigue sin fila: nadie la encendió');
SELECT public.chk(public.sep_nbit(:C::uuid), :a0, '[SEP-4d] y no hay una sola fila nueva en la bitácora de C');
SELECT public.chk(public.sep_nbit(:D::uuid), :a0d, '[SEP-4d] ni en la de D');

-- Regresión (verde con y sin la corrección): un administrador con una empresa propia que ya no existe sigue recibiendo un error claro.
SELECT public.como(:DE::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('5e940000-0000-0000-0000-0000000000fe', true, 'La empresa propia ya no existe') $$,
  'COMPRAS_SEPARACION_EMPRESA_INEXISTENTE', '[SEP-4e] el administrador de una empresa propia inexistente: error claro, nunca éxito sin operación');
RESET ROLE;

-- El alcance también es a prueba de NULL: un administrador ACTIVO pero sin empresa (get_my_company_id() NULL) no es «de esa empresa».
-- (Verde con y sin el COALESCE del rol; muerde el alcance escrito con «<>» en vez de «IS DISTINCT FROM».)
SELECT public.como(:NE::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.current_user_role() = 'admin' AND public.get_my_company_id() IS NULL, true, '[SEP-4e] el administrador de la prueba es activo, de rol admin y SIN empresa (get_my_company_id() es NULL)');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Administrador sin empresa intenta apagar C') $$,
  'COMPRAS_ALCANCE_EMPRESA', '[SEP-4e] el administrador SIN empresa no cambia la separación de C: no es de esa empresa (NULL no es igual a nada)');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('dddddddd-dddd-dddd-dddd-dddddddddddd', true, 'Administrador sin empresa intenta encender D') $$,
  'COMPRAS_ALCANCE_EMPRESA', '[SEP-4e] ni la de D');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('5e940000-0000-0000-0000-0000000000fe', true, 'Administrador sin empresa y una empresa que no existe') $$,
  'COMPRAS_ALCANCE_EMPRESA', '[SEP-4e] ni una empresa que no existe (ALCANCE, sin revelar si existe)');
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora), 0, '[SEP-4e] y no lee la bitácora de nadie (company_id = NULL no coincide con ninguna)');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-4e] la separación de C sigue encendida');

-- ═══════════════════════════════════════════════════════════════════════════
-- B · Administrador, propietario y super administrador DESACTIVADOS
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_nbit(:C::uuid) AS b0 \gset
SELECT public.chk_txt((SELECT c.data_type || '/' || c.is_nullable || '/' || COALESCE(c.column_default, '') FROM information_schema.columns c
                        WHERE c.table_schema = 'public' AND c.table_name = 'app_users' AND c.column_name = 'activo'), 'boolean/NO/true',
  '[SEP-4f] la columna que mira la corrección existe con ese nombre y tipo: app_users.activo boolean NOT NULL DEFAULT true');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid), true,
  '[SEP-4f] control positivo: el administrador ACTIVO de C ve la bitácora de C');
SELECT public.como(:AD::uuid);
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Administrador desactivado intenta apagar') $$,
  'COMPRAS_SEPARACION_PERFIL', '[SEP-4g] el administrador DESACTIVADO de C no usa la RPC');
SELECT public.como(:OD::uuid);
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Propietario desactivado intenta apagar') $$,
  'COMPRAS_SEPARACION_PERFIL', '[SEP-4g] ni el propietario DESACTIVADO');
SELECT public.como(:SD::uuid);
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Super administrador desactivado intenta apagar') $$,
  'COMPRAS_SEPARACION_PERFIL', '[SEP-4g] ni el super administrador DESACTIVADO');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('5e940000-0000-0000-0000-0000000000fe', true, 'Super administrador desactivado y empresa que no existe') $$,
  'COMPRAS_SEPARACION_PERFIL', '[SEP-4g] y el super administrador desactivado no averigua si una empresa existe (PERFIL va antes que EMPRESA_INEXISTENTE)');
SELECT public.como(:AD::uuid);
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('dddddddd-dddd-dddd-dddd-dddddddddddd', true, 'Administrador desactivado sobre otra empresa') $$,
  'COMPRAS_ALCANCE_EMPRESA', '[SEP-4g] y sobre otra empresa recibe ALCANCE (la capa de empresa va antes: no se entera de nada)');
-- la lectura de la bitácora
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora), 0, '[SEP-4h] el administrador DESACTIVADO no lee la bitácora');
SELECT public.como(:OD::uuid);
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora), 0, '[SEP-4h] ni el propietario DESACTIVADO');
SELECT public.como(:SD::uuid);
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora), 0, '[SEP-4h] ni el super administrador DESACTIVADO (que activo lo ve todo)');
-- el rechazo directo lo explica bien: un desactivado no es «administrador», recibe SOLO_ADMIN (no «usa la RPC», que tampoco le valdría)
SELECT public.como(:AD::uuid);
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-4i] el UPDATE directo del administrador DESACTIVADO: SOLO_ADMIN (y no VIA_RPC, que lo mandaría a una RPC que lo rechaza)');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-4i] el mismo UPDATE del administrador ACTIVO: VIA_RPC (usa la RPC)');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-4j] la separación sigue encendida: ningún desactivado la tocó');
SELECT public.chk(public.sep_nbit(:C::uuid), :b0, '[SEP-4j] y no hay filas nuevas en la bitácora');

-- Reactivar al administrador (carga de sistema) devuelve el poder; desactivarlo otra vez lo quita: la causa es `activo`, nada más.
SELECT public.como_sistema($$ UPDATE public.app_users SET activo = true WHERE id IN ('5e940000-0000-0000-0000-0000000000d1', '5e940000-0000-0000-0000-0000000000d2', '5e940000-0000-0000-0000-0000000000d3') $$);
SELECT public.como(:AD::uuid);
SET ROLE authenticated;
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid), true,
  '[SEP-4k] reactivado, el administrador vuelve a ver la bitácora de C');
SELECT public.chk_bool((public.compras_separacion_configurar(:C::uuid, false, 'Reactivado por la auditoría interna de 2026') ->> 'aprobacion_separada')::boolean, false,
  '[SEP-4k] y apaga la separación por la RPC (positivo)');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-4k] la RPC dejó la fila apagada');
SELECT public.como(:OD::uuid);
SET ROLE authenticated;
SELECT public.chk_bool((public.compras_separacion_configurar(:C::uuid, true, 'El propietario reactivado vuelve a encender') ->> 'aprobacion_separada')::boolean, true,
  '[SEP-4k] el propietario reactivado también (positivo)');
SELECT public.como(:SD::uuid);
SELECT public.chk_bool((public.compras_separacion_configurar(:C::uuid, false, 'El super administrador reactivado apaga otra vez') ->> 'aprobacion_separada')::boolean, false,
  '[SEP-4k] y el super administrador reactivado (positivo)');
RESET ROLE;
SELECT public.como_sistema($$ UPDATE public.app_users SET activo = false WHERE id = '5e940000-0000-0000-0000-0000000000d1' $$);
SELECT public.como(:AD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'Desactivado otra vez: vuelve a quedar fuera') $$,
  'COMPRAS_SEPARACION_PERFIL', '[SEP-4l] desactivado de nuevo, el mismo administrador vuelve a quedar fuera');
RESET ROLE;
SELECT public.como_sistema($$ UPDATE public.app_users SET activo = false WHERE id IN ('5e940000-0000-0000-0000-0000000000d2', '5e940000-0000-0000-0000-0000000000d3') $$);
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-4l] la configuración quedó como la dejó el último cambio válido');

-- ═══════════════════════════════════════════════════════════════════════════
-- C · El motivo es ÚTIL (la prueba se puede correr en una base UTF8 o SQL_ASCII: informa cuál es)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT current_setting('server_encoding') AS enc, (SELECT datcollate FROM pg_database WHERE datname = current_database()) AS loc \gset
SELECT ('á' ~ '[[:alpha:]]') AS unicode_locale \gset
SELECT format('ℹ [SEP-4m] la base de esta corrida: codificación %s, locale %s, letras con tilde reconocidas como letras: %s', :'enc', :'loc', :'unicode_locale') AS info \gset
\echo :info

CREATE OR REPLACE FUNCTION public.sep4_alterna(p_motivo text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_actual boolean;
BEGIN
  SELECT c.aprobacion_separada INTO v_actual FROM public.compras_config c WHERE c.company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  RETURN public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', NOT COALESCE(v_actual, false), p_motivo) ->> 'motivo';
END;
$$;
SELECT public.sep_valor(:C::uuid) AS v0 \gset
SELECT public.sep_nbit(:C::uuid) AS c0 \gset
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- Rechazados: miden lo suficiente pero no dicen nada
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, '..........') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4n] diez puntos');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, '- - - - - - - - - - - -') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4n] guiones con espacios');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, '¿¿¿¿¿¿¿¿¿¿¿¿ !!!!!!!!!!!!') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4n] signos de puntuación');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, '0000000000') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4o] diez ceros: las cifras cuentan como alfanuméricas pero un motivo necesita al menos una letra');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, '1234567890') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4o] ni un número cualquiera');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, '2026-04-15 / 0415 / 12') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4o] ni una fecha con folios (cifras y signos, sin una letra)');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, repeat(chr(1), 12)) $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4p] doce caracteres de control (chr(1))');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, repeat(chr(127), 12)) $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4p] doce DEL (chr(127))');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'a' || repeat(E'\n', 20)) $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4p] una letra y saltos de línea: solo 1 carácter útil');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'a.b.c.d.e.f.g.h.i') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4q] nueve letras separadas por signos: 9 útiles, no 17');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'sin motivo') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4q] «sin motivo» (9 útiles)');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, repeat('a', 2000000)) $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4q] dos millones de caracteres: se rechaza por el tope antes de recorrerlos con expresiones regulares');
-- Caracteres invisibles (bytes UTF-8 escritos con escapes: valen en UTF8 —un solo carácter— y en SQL_ASCII —varios bytes—; ninguno es alfanumérico)
DO $$
DECLARE
  v_inv text[] := ARRAY[E'\xe2\x80\x8c', E'\xe2\x80\x8d', E'\xe2\x81\xa0', E'\xc2\xad', E'\xe2\x80\x8e', E'\xe3\x85\xa4', E'\xe2\xa0\x80', E'\xc2\x85',
                        E'\xe1\x85\x9f', E'\xe1\x85\xa0', E'\xef\xbe\xa0'];
  v_nom text[] := ARRAY['ancho cero sin unión U+200C', 'unión de ancho cero U+200D', 'unión de palabra U+2060', 'guion blando U+00AD',
                        'marca izquierda a derecha U+200E', 'relleno Hangul U+3164', 'braille en blanco U+2800', 'siguiente línea U+0085',
                        'relleno Hangul inicial U+115F', 'relleno Hangul medial U+1160', 'relleno Hangul de ancho medio U+FFA0'];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_inv, 1) LOOP
    PERFORM public.chk_falla(format($q$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, %L) $q$, repeat(v_inv[i], 12)),
      'COMPRAS_SEPARACION_MOTIVO', format('[SEP-4r] doce %s: no cuentan', v_nom[i]));
    PERFORM public.chk_falla(format($q$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, %L) $q$, 'abcdefghi' || repeat(v_inv[i], 6)),
      'COMPRAS_SEPARACION_MOTIVO', format('[SEP-4r] nueve letras y seis %s: nueve útiles', v_nom[i]));
  END LOOP;
END $$;
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), :'v0', '[SEP-4s] ningún motivo rechazado cambió el interruptor');
SELECT public.chk(public.sep_nbit(:C::uuid), :c0, '[SEP-4s] ni escribió bitácora');

-- Aceptados (cada uno cambia el interruptor: la prueba los alterna)
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_txt(public.sep4_alterna('aaaaaaaaaa'), 'aaaaaaaaaa',
  '[SEP-4t] diez letras iguales pasan: la regla es de higiene del rastro, no un juicio sobre el contenido (decisión documentada)');
SELECT public.chk_txt(public.sep4_alterna(E'  Se reactiva por auditoría interna 2026 \n'), 'Se reactiva por auditoría interna 2026',
  '[SEP-4t] un motivo real con tildes y espacios pasa (en esta base, con este locale) y se guarda recortado');
SELECT public.chk_txt(public.sep4_alterna('Folio 2026-0415 de cierre'), 'Folio 2026-0415 de cierre', '[SEP-4t] letras, cifras y signos: pasa');
SELECT public.chk_txt(public.sep4_alterna('12345abcde'), '12345abcde', '[SEP-4t] 10 útiles exactos (5 cifras y 5 letras): pasa');
SELECT public.chk_txt(public.sep4_alterna('a.b.c.d.e.f.g.h.i.j'), 'a.b.c.d.e.f.g.h.i.j', '[SEP-4t] 10 letras separadas por signos: 10 útiles, pasa');
SELECT public.chk_txt(public.sep4_alterna('Revisión técnica y aprobación del cierre'), 'Revisión técnica y aprobación del cierre', '[SEP-4t] otro motivo real con tildes: pasa');
\if :unicode_locale
-- Con una locale que entiende Unicode (la de Supabase), las letras con tilde y la eñe son letras: un motivo solo de ellas vale.
SELECT public.chk_txt(public.sep4_alterna('áéíóúñÁÉÍÓÚÑ'), 'áéíóúñÁÉÍÓÚÑ', '[SEP-4u] con locale Unicode, diez letras con tilde y eñe cuentan (esta base las reconoce)');
\else
-- Con locale C o SQL_ASCII solo cuentan los ASCII: es el límite documentado (un motivo en español tiene palabras con letras ASCII de sobra).
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'áéíóúñÁÉÍÓÚÑ') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-4u] con locale C / SQL_ASCII las letras con tilde no cuentan como alfanuméricas (límite documentado de [[:alnum:]])');
\endif
RESET ROLE;
SELECT public.chk(public.sep_nbit(:C::uuid), :c0 + 6 + (CASE WHEN :'unicode_locale'::boolean THEN 1 ELSE 0 END),
  '[SEP-4v] cada motivo aceptado dejó UNA fila de bitácora (y los rechazados ninguna)');

-- ═══════════════════════════════════════════════════════════════════════════
-- D · Ninguna condición de seguridad se salta cuando un dato de la sesión es NULL (SIMULACIÓN, cada bloque se revierte solo)
--     compras_sesion_usuario() hoy nunca devuelve NULL; si una redefinición futura lo hiciera, lo desconocido no debe autorizar.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  r := public.compras_sesion_usuario();
  PERFORM public.chk_bool(r IS NOT NULL AND NOT r, true, '[SEP-4w] sin sesión de usuario: false, no NULL');
  PERFORM set_config('request.jwt.claim.sub', '5e900000-0000-0000-0000-0000000000e1', true);
  PERFORM set_config('conta.allow_system_write', 'on', true);
  r := public.compras_sesion_usuario();
  PERFORM public.chk_bool(r IS NOT NULL AND NOT r, true, '[SEP-4w] con conta.allow_system_write: false, no NULL');
  PERFORM set_config('conta.allow_system_write', 'off', true);
  r := public.compras_sesion_usuario();
  PERFORM public.chk_bool(r IS NOT NULL AND r, true, '[SEP-4w] con sesión y sin el permiso de sistema: true, no NULL');
  PERFORM set_config('conta.allow_system_write', '', true);
END $$;

SELECT public.sep_preparar(:C::uuid, true);   -- carga de sistema: C encendida
-- Cada escena es un DO propio: se redefine compras_sesion_usuario() para que devuelva NULL, se comprueba y se REVIERTE sola (una falla
-- en una escena no oculta a las demás). SE es el editor de C (edita y borra la configuración); UA, el administrador.
-- 1 · el editor no apaga (BEFORE de fila)
DO $do$
BEGIN
  BEGIN
    EXECUTE $q$ CREATE OR REPLACE FUNCTION public.compras_sesion_usuario() RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
                AS $f$ SELECT NULL::boolean $f$ $q$;
    PERFORM set_config('request.jwt.claim.sub', '5e900000-0000-0000-0000-0000000000e1', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.chk_falla($c$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $c$,
      'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-4x] (simulación, sesión NULL) el editor no apaga la separación: el BEFORE juzga lo desconocido como sesión de usuario');
    RESET ROLE;
    RAISE EXCEPTION 'SEP4_REVERTIR';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SEP4_REVERTIR' THEN RAISE; END IF;
  END;
END $do$;
-- 2 · el AFTER (red de seguridad) rechaza aunque el BEFORE no estuviera
DO $do$
BEGIN
  BEGIN
    EXECUTE $q$ CREATE OR REPLACE FUNCTION public.compras_sesion_usuario() RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
                AS $f$ SELECT NULL::boolean $f$ $q$;
    ALTER TABLE public.compras_config DISABLE TRIGGER trg_compras_00_config_separacion;
    PERFORM set_config('request.jwt.claim.sub', '5e900000-0000-0000-0000-0000000000e1', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.chk_falla($c$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $c$,
      'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-4y] (simulación, sesión NULL, BEFORE deshabilitado) la red de seguridad AFTER rechaza el cambio: no lo anota como «sistema»');
    RESET ROLE;
    RAISE EXCEPTION 'SEP4_REVERTIR';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SEP4_REVERTIR' THEN RAISE; END IF;
  END;
END $do$;
-- 3 · la RPC: sin sesión conocida no hay actor
DO $do$
BEGIN
  BEGIN
    EXECUTE $q$ CREATE OR REPLACE FUNCTION public.compras_sesion_usuario() RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
                AS $f$ SELECT NULL::boolean $f$ $q$;
    PERFORM set_config('request.jwt.claim.sub', 'c0c0c0c0-0000-0000-0000-00000000000a', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.chk_falla($c$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Con la sesión desconocida no hay actor') $c$,
      'COMPRAS_SEPARACION_SESION', '[SEP-4z] (simulación, sesión NULL) la RPC se niega: sin sesión conocida no hay actor');
    RESET ROLE;
    RAISE EXCEPTION 'SEP4_REVERTIR';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SEP4_REVERTIR' THEN RAISE; END IF;
  END;
END $do$;
-- 4 · TRUNCATE de un rol sin sesión conocida: lo desconocido tampoco se exime
DO $do$
BEGIN
  BEGIN
    EXECUTE $q$ CREATE OR REPLACE FUNCTION public.compras_sesion_usuario() RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
                AS $f$ SELECT NULL::boolean $f$ $q$;
    PERFORM set_config('request.jwt.claim.sub', 'c0c0c0c0-0000-0000-0000-00000000000a', true);
    PERFORM public.chk_falla($c$ TRUNCATE public.compras_config $c$,
      'COMPRAS_CONFIG_SEPARACION_TRUNCATE', '[SEP-4za] (simulación, sesión NULL) ni el TRUNCATE de un rol sin sesión conocida pasa');
    RAISE EXCEPTION 'SEP4_REVERTIR';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SEP4_REVERTIR' THEN RAISE; END IF;
  END;
END $do$;
-- 5 · permiso de la RPC falsificado (límite documentado con SQL directo) + sesión NULL: un NULL no se interpreta como «sí»
DO $do$
BEGIN
  BEGIN
    EXECUTE $q$ CREATE OR REPLACE FUNCTION public.compras_sesion_usuario() RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
                AS $f$ SELECT NULL::boolean $f$ $q$;
    PERFORM set_config('compras.separacion_rpc', 'cccccccc-cccc-cccc-cccc-cccccccccccc:false', true);
    PERFORM set_config('request.jwt.claim.sub', '5e900000-0000-0000-0000-0000000000e1', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.chk_falla($c$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $c$,
      'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-4zb] (simulación, sesión NULL) el permiso de la RPC no se da por válido: un NULL no es un «sí»');
    RESET ROLE;
    RAISE EXCEPTION 'SEP4_REVERTIR';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SEP4_REVERTIR' THEN RAISE; END IF;
  END;
END $do$;
SELECT public.chk_bool(pg_get_functiondef('public.compras_sesion_usuario()'::regprocedure) LIKE '%allow_system_write%', true, '[SEP-4zc] la simulación se revirtió: compras_sesion_usuario() es la de siempre');
SELECT public.chk_bool((SELECT count(*) = 3 FROM pg_trigger WHERE tgrelid = 'public.compras_config'::regclass AND NOT tgisinternal AND tgenabled = 'O'
                           AND tgname IN ('trg_compras_00_config_separacion', 'trg_compras_00_config_separacion_truncate', 'trg_zz_compras_config_separacion_bitacora')), true,
  '[SEP-4zc] y los tres triggers de la separación siguen habilitados');
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-4zc] y la configuración de C sigue como estaba (encendida)');
-- NULL explícito en la columna: la restricción NOT NULL lo corta (verde con y sin la corrección)
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.chk_falla($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', NULL) $$,
  'null value in column', '[SEP-4zd] un NULL explícito en el interruptor no deja una fila sin valor');
SELECT public.sep_preparar(:C::uuid, false);
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = NULL WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN|null value in column', '[SEP-4zd] ni un UPDATE a NULL del editor: lo para el trigger o la restricción NOT NULL, nunca queda una fila sin valor');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-4zd] la fila sigue con su valor (apagada)');

-- ═══════════════════════════════════════════════════════════════════════════
-- E · Cambios de SISTEMA (decisión pendiente del dueño): siguen permitidos y quedan anotados
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_preparar(:C::uuid, true);
SELECT public.sep_nbit(:C::uuid) AS e0 \gset
SELECT public.como_sistema($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$);
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'SIN FILA', '[SEP-4ze] el sistema (sin sesión de usuario) borra la fila encendida: se mantiene el comportamiento');
SELECT public.chk_bool((SELECT b.origen = 'sistema' AND b.valor_anterior AND NOT b.valor_nuevo AND b.actor_id IS NULL AND b.motivo IS NULL
                          FROM public.compras_config_separacion_bitacora b WHERE b.company_id = :C::uuid ORDER BY b.id DESC LIMIT 1), true,
  '[SEP-4ze] y queda anotado: origen «sistema», actor NULL, encendida → apagada, sin motivo (es lo que lista la consulta de vigilancia)');
SELECT public.chk(public.sep_nbit(:C::uuid), :e0 + 1, '[SEP-4ze] UNA fila de bitácora por el borrado');
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_preparar(:D::uuid, NULL);
