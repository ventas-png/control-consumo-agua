\set ON_ERROR_STOP on
-- ============================================================================
-- SEP-6 · Tanda final de la separación solicitante/aprobador (segundo escéptico): las aserciones que faltaban.
--
-- Cada bloque cierra un mutante de la pieza que sobrevivía a SEP-1…SEP-5 (el segundo escéptico los numeró N17…N31; ver INFORME «Tanda final»):
--   A · (N21, N22) la RPC y el INSERT de usuario toman el MISMO candado asesor por empresa, de TRANSACCIÓN, y no dejan ninguno retenido:
--       un candado de sesión (pg_advisory_lock) sobrevive al COMMIT y, con conexiones persistentes o agrupadas, bloquea a la siguiente
--       petición de esa empresa hasta que la conexión se cierre. Se mira en pg_locks por pg_backend_pid(), en la MISMA sesión.
--   B · (N03, N04, N05) un motivo válido con invisibles en los bordes (ancho cero, BOM, espacio duro) se guarda RECORTADO. Solo en bases UTF8
--       (en SQL_ASCII esos caracteres son bytes sueltos y no se pueden escribir como un carácter).
--   C · (N17, N18) «nunca éxito sin rastro» y «nunca éxito sin operación»: con el AFTER de la bitácora deshabilitado la RPC lo detecta
--       (SIN_BITACORA) y con el INSERT de la configuración anulado por otro trigger no finge éxito (NO_APLICADA), cada uno dentro de un bloque que se revierte solo.
--   D · (N20) mover `company_id` de una configuración APAGADA cuya bitácora dice «activa» (origen) o hacia una empresa cuya bitácora dice «activa» (destino).
--   E · (N31) el CHECK de la bitácora (motivo ≥ 10 para origen «usuario») se prueba como superusuario: ninguna vía de la API llega a él, es la defensa en profundidad.
--   G · (N13) las ocho funciones que consultan o escriben la bitácora son SECURITY DEFINER (la que rechaza UPDATE/DELETE/TRUNCATE no lo es: no consulta nada).
--   H · (N30) la «memoria» es la última fila por ID (el orden del candado), no por fecha: dos relojes que discrepan no la cambian.
--   F · La RPC con la fila y la memoria discordantes (lo deja una reversión de la 0900 sin conciliar, triggers deshabilitados): «sin cambio» sin escribir nada
--       —nunca éxito sin operación— y, al pedir lo contrario de la fila, la fila manda. (Documenta la decisión de no conciliar desde la RPC; ver INFORME.)
--
-- Ids propios: ninguno nuevo; usa las personas de SEP-0 (SE editor de C, SS super administrador) y las de la plantilla (UA administrador de C).
-- Se puede correr más de una vez. Deja la configuración de C y D sin fila y su memoria en «apagada» (la bitácora conserva sus filas: es append-only).
-- ============================================================================
\ir SEP-0.padron.sql
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set SE  '''5e900000-0000-0000-0000-0000000000e1'''
\set SS  '''5e900000-0000-0000-0000-0000000000a1'''

CREATE OR REPLACE FUNCTION public.sep6_alterna(p_motivo text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_actual boolean;
BEGIN
  SELECT c.aprobacion_separada INTO v_actual FROM public.compras_config c WHERE c.company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  RETURN public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', NOT COALESCE(v_actual, false), p_motivo) ->> 'motivo';
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A · Candados asesores: la misma llave, de transacción, y ninguno retenido al terminar
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.chk((SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()), 0,
  '[SEP-6a] (control) la sesión de la prueba empieza sin candados asesores');

-- A1 · el INSERT de un usuario (fila ausente) toma el candado de la empresa
SELECT public.como(:SE::uuid);
BEGIN;
SET LOCAL ROLE authenticated;
INSERT INTO public.compras_config (company_id) VALUES (:C::uuid);
RESET ROLE;
SELECT count(*) FILTER (WHERE classid::bigint = (hashtext('compras_separacion')::bigint & 4294967295)
                          AND objid::bigint   = (hashtext(:C::text)::bigint & 4294967295) AND objsubid = 2 AND granted) AS misma_llave,
       count(*) AS total
  FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() \gset
SELECT public.chk(:misma_llave, 1, '[SEP-6a] el INSERT de usuario toma el candado asesor (compras_separacion, empresa): la MISMA llave que la RPC');
SELECT public.chk(:total, 1, '[SEP-6a] y es el único candado asesor de la sesión');
COMMIT;
SELECT public.chk((SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()), 0,
  '[SEP-6a] confirmado el INSERT, la sesión NO retiene ningún candado asesor (el candado es de transacción)');

-- A2 · la RPC, dentro de una transacción abierta: toma el candado de la empresa; confirmada, no retiene ninguno
SELECT (public.sep_valor(:C::uuid) = 'true') AS cur \gset
SELECT public.como(:UA::uuid);
BEGIN;
SET LOCAL ROLE authenticated;
SELECT (public.compras_separacion_configurar(:C::uuid, NOT :'cur'::boolean, 'Cambio dentro de una transacción abierta (candados)') ->> 'aprobacion_separada') AS ok \gset
RESET ROLE;
SELECT count(*) FILTER (WHERE classid::bigint = (hashtext('compras_separacion')::bigint & 4294967295)
                          AND objid::bigint   = (hashtext(:C::text)::bigint & 4294967295) AND objsubid = 2 AND granted) AS misma_llave,
       count(*) AS total
  FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() \gset
SELECT public.chk(:misma_llave, 1, '[SEP-6a] la RPC toma el candado asesor (compras_separacion, empresa)');
SELECT public.chk(:total, 1, '[SEP-6a] y es el único candado asesor de la sesión');
COMMIT;
SELECT public.chk((SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()), 0,
  '[SEP-6a] confirmada la RPC, la sesión PERSISTENTE no retiene ningún candado asesor (uno de sesión bloquearía a la siguiente petición de la empresa)');
-- y otra llamada de la misma sesión a la misma empresa no espera a nadie (si el candado se hubiera quedado, esta sesión lo reentraría: lo que se mide es el total)
SELECT (public.compras_separacion_configurar(:C::uuid, :'cur'::boolean, 'Segunda llamada de la misma sesión persistente') ->> 'aprobacion_separada') AS ok2 \gset
SELECT public.chk((SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()), 0,
  '[SEP-6a] tras una segunda RPC en la misma sesión (autocommit), tampoco queda ningún candado asesor');

-- ═══════════════════════════════════════════════════════════════════════════
-- B · Invisibles en los bordes del motivo: se guarda recortado (solo UTF8)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT (current_setting('server_encoding') = 'UTF8') AS es_utf8 \gset
\if :es_utf8
SELECT public.sep_preparar(:C::uuid, false);
SELECT public.sep_nbit(:C::uuid) AS b0 \gset
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_txt(public.sep6_alterna(E'\u200bMotivo válido real 2026\ufeff'), 'Motivo válido real 2026',
  '[SEP-6b] ancho cero al inicio y BOM al final: el motivo se guarda recortado (U+200B, U+FEFF)');
SELECT public.chk_txt(public.sep6_alterna(E'\u00a0Motivo válido real 2026\u00a0'), 'Motivo válido real 2026',
  '[SEP-6b] espacios duros en ambos extremos: recortado (U+00A0)');
SELECT public.chk_txt(public.sep6_alterna(E' \u200b\u00a0Motivo válido real 2026\ufeff\u200b \n'), 'Motivo válido real 2026',
  '[SEP-6b] mezcla de espacios, ancho cero, espacio duro y BOM: recortado');
RESET ROLE;
SELECT public.chk_txt((SELECT b.motivo FROM public.compras_config_separacion_bitacora b WHERE b.company_id = :C::uuid ORDER BY b.id DESC LIMIT 1),
  'Motivo válido real 2026', '[SEP-6b] y la bitácora guarda el motivo recortado (sin invisibles en los bordes)');
SELECT public.chk(public.sep_nbit(:C::uuid), :b0 + 3, '[SEP-6b] tres cambios, tres filas de bitácora');
SELECT public.chk((SELECT count(*) FROM (SELECT b.motivo FROM public.compras_config_separacion_bitacora b WHERE b.company_id = :C::uuid ORDER BY b.id DESC LIMIT 3) t
                    WHERE t.motivo ~ '^[\u200b\ufeff\u00a0]|[\u200b\ufeff\u00a0]$'), 0, '[SEP-6b] ninguna de las tres empieza ni termina con un invisible');
\else
\echo ℹ [SEP-6b] la base no es UTF8: el recorte de invisibles Unicode en los bordes del motivo no se comprueba aquí (en SQL_ASCII son bytes sueltos; lo cubre la corrida UTF8)
\endif

-- ═══════════════════════════════════════════════════════════════════════════
-- C · Nunca éxito sin rastro ni sin operación (cada escena es un bloque que se revierte solo)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_preparar(:C::uuid, false);
SELECT public.sep_nbit(:C::uuid) AS c0 \gset
-- C1 · el AFTER de la bitácora deshabilitado: el cambio se escribe pero no deja rastro ⇒ la RPC lo detecta y se revierte
DO $do$
BEGIN
  BEGIN
    ALTER TABLE public.compras_config DISABLE TRIGGER trg_zz_compras_config_separacion_bitacora;
    PERFORM set_config('request.jwt.claim.sub', 'c0c0c0c0-0000-0000-0000-00000000000a', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.chk_falla($c$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'Sin el AFTER no hay rastro: se revierte') $c$,
      'COMPRAS_SEPARACION_SIN_BITACORA', '[SEP-6c] con el AFTER de la bitácora deshabilitado la RPC no da por bueno un cambio sin rastro');
    RESET ROLE;
    RAISE EXCEPTION 'SEP6_REVERTIR';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SEP6_REVERTIR' THEN RAISE; END IF;
  END;
END $do$;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-6c] y el cambio no quedó: la fila de C sigue apagada');
SELECT public.chk(public.sep_nbit(:C::uuid), :c0, '[SEP-6c] ni una fila de bitácora');
SELECT public.chk_bool((SELECT tgenabled = 'O' FROM pg_trigger WHERE tgrelid = 'public.compras_config'::regclass AND tgname = 'trg_zz_compras_config_separacion_bitacora'), true,
  '[SEP-6c] y el AFTER de la bitácora sigue habilitado (la simulación se revirtió)');

-- C2 · otro trigger anula el INSERT de la configuración (equivale a que otra transacción creó la fila antes): cero filas ⇒ NO_APLICADA, no éxito
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_nbit(:C::uuid) AS c1 \gset
DO $do$
BEGIN
  BEGIN
    CREATE FUNCTION public.sep6_omitir_insert() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$;
    CREATE TRIGGER trg_zzz_sep6_omitir BEFORE INSERT ON public.compras_config FOR EACH ROW EXECUTE FUNCTION public.sep6_omitir_insert();
    PERFORM set_config('request.jwt.claim.sub', 'c0c0c0c0-0000-0000-0000-00000000000a', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.chk_falla($c$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'El INSERT no escribe ninguna fila: no es un éxito') $c$,
      'COMPRAS_SEPARACION_NO_APLICADA: la configuración de la empresa cambió mientras se aplicaba',
      '[SEP-6d] con cero filas escritas la RPC lo dice por la rama de «filas afectadas» (no por la relectura): nunca éxito sin operación');
    RESET ROLE;
    RAISE EXCEPTION 'SEP6_REVERTIR';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SEP6_REVERTIR' THEN RAISE; END IF;
  END;
END $do$;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'SIN FILA', '[SEP-6d] y no quedó ninguna fila');
SELECT public.chk(public.sep_nbit(:C::uuid), :c1, '[SEP-6d] ni de bitácora');
SELECT public.chk_bool(to_regprocedure('public.sep6_omitir_insert()') IS NULL, true, '[SEP-6d] y el trigger de la simulación se revirtió');

-- ═══════════════════════════════════════════════════════════════════════════
-- D · Mover `company_id` cuando solo la MEMORIA (la bitácora) dice «activa»
-- ═══════════════════════════════════════════════════════════════════════════
-- D1 · origen: la fila de C está APAGADA (se apagó sin pasar por los triggers) y la bitácora de C dice «activa»; el destino D no tiene nada
SELECT public.sep_preparar(:C::uuid, true);
SELECT public.sep_preparar(:D::uuid, NULL);
SELECT public.como_sistema($$ SET LOCAL session_replication_role = replica;
  UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  SET LOCAL session_replication_role = origin $$);
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-6e] (preparación) la fila de C está APAGADA');
SELECT public.chk_bool(public.compras_separacion_memoria(:C::uuid), true, '[SEP-6e] (preparación) y la bitácora de C dice «activa»');
SELECT public.chk_bool(COALESCE(public.compras_separacion_memoria(:D::uuid), false), false, '[SEP-6e] (preparación) D no tiene nada establecido');
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.compras_config SET company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-6e] el editor no mueve la configuración de C a otra empresa aunque la fila esté apagada: la memoria de C dice «activa»');
SELECT public.como(:SS::uuid);
SELECT public.chk_falla($$ UPDATE public.compras_config SET company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-6e] ni el super administrador: se le indica la RPC');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-6e] la fila sigue en C');
SELECT public.chk_txt(public.sep_valor(:D::uuid), 'SIN FILA', '[SEP-6e] y D sigue sin fila');
-- D2 · destino: D no tiene fila pero su bitácora dice «activa»; la fila de C está apagada y su bitácora también
SELECT public.sep_preparar(:C::uuid, false);
SELECT public.sep_preparar(:D::uuid, true);
SELECT public.sep_borrar_sin_rastro(:D::uuid);
SELECT public.chk_bool(public.compras_separacion_memoria(:C::uuid), false, '[SEP-6e] (preparación) ahora la bitácora de C dice «apagada»');
SELECT public.chk_bool(public.compras_separacion_memoria(:D::uuid), true, '[SEP-6e] (preparación) y la de D dice «activa» (sin fila)');
SELECT public.chk_txt(public.sep_valor(:D::uuid), 'SIN FILA', '[SEP-6e] (preparación) D no tiene fila');
SELECT public.como(:SS::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.compras_config SET company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-6e] no se mueve una configuración apagada hacia una empresa cuya bitácora dice «activa» (llegaría a ocupar su sitio)');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-6e] la fila sigue en C');
SELECT public.chk_txt(public.sep_valor(:D::uuid), 'SIN FILA', '[SEP-6e] y D sigue sin fila');
-- D3 · control: sin nada establecido en ninguna de las dos empresas, mover una configuración apagada SÍ se permite (no hay prohibición nueva)
SELECT public.sep_preparar(:D::uuid, false);
SELECT public.sep_preparar(:D::uuid, NULL);
SELECT public.chk_bool(public.compras_separacion_memoria(:D::uuid), false, '[SEP-6e] (preparación) D con la memoria en «apagada»');
SELECT public.como(:SS::uuid);
SET ROLE authenticated;
SELECT public.chk(public.sep_filas($$ UPDATE public.compras_config SET company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$), 1,
  '[SEP-6e] (control) con ambas memorias apagadas y la fila apagada, el super administrador SÍ la mueve: no se inventa una prohibición');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:D::uuid), 'false', '[SEP-6e] (control) la fila quedó en D');

-- ═══════════════════════════════════════════════════════════════════════════
-- E · El CHECK de la bitácora (defensa en profundidad), como superusuario: la API nunca llega a él
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.chk_falla($$ INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, motivo, origen)
                          VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0c0c0c0-0000-0000-0000-00000000000a', false, true, 'cinco', 'usuario') $$,
  'compras_config_sep_bit_usuario_check', '[SEP-6f] origen «usuario» con un motivo de 5 caracteres: lo rechaza el CHECK (aunque lo escriba un superusuario)');
SELECT public.chk_falla($$ INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, motivo, origen)
                          VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0c0c0c0-0000-0000-0000-00000000000a', false, true, 'nueve 123', 'usuario') $$,
  'compras_config_sep_bit_usuario_check', '[SEP-6f] ni uno de 9 (el mínimo es 10)');
SELECT public.chk_falla($$ INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, motivo, origen)
                          VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, false, true, 'un motivo largo y válido', 'usuario') $$,
  'compras_config_sep_bit_usuario_check', '[SEP-6f] ni origen «usuario» sin actor');
DO $do$
BEGIN
  BEGIN
    INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, motivo, origen)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0c0c0c0-0000-0000-0000-00000000000a', false, true, 'diez chars', 'usuario');
    PERFORM public.chk_bool(EXISTS (SELECT 1 FROM public.compras_config_separacion_bitacora WHERE motivo = 'diez chars'), true,
      '[SEP-6f] (control) un motivo de exactamente 10 caracteres SÍ entra: el límite es 10, ni 9 ni 11');
    RAISE EXCEPTION 'SEP6_REVERTIR';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SEP6_REVERTIR' THEN RAISE; END IF;
  END;
END $do$;

-- ═══════════════════════════════════════════════════════════════════════════
-- F · La RPC con la fila y la memoria DISCORDANTES: la fila manda; nunca éxito sin operación
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_preparar(:C::uuid, true);
SELECT public.como_sistema($$ SET LOCAL session_replication_role = replica;
  UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  SET LOCAL session_replication_role = origin $$);
SELECT public.sep_nbit(:C::uuid) AS f0 \gset
SELECT public.chk_txt(public.sep_valor(:C::uuid) || '/' || public.compras_separacion_memoria(:C::uuid)::text, 'false/true', '[SEP-6g] (preparación) fila apagada y memoria «activa»');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Se pide apagar lo que ya está apagado') $$,
  'COMPRAS_SEPARACION_SIN_CAMBIO', '[SEP-6g] pedir apagar una fila ya apagada: SIN_CAMBIO aunque la memoria diga «activa» (lo que lee el circuito es la fila)');
RESET ROLE;
SELECT public.chk(public.sep_nbit(:C::uuid), :f0, '[SEP-6g] y no escribió nada en la bitácora');
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-6g] ni cambió la fila');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT (public.compras_separacion_configurar(:C::uuid, true, 'Se vuelve a encender tras revisar la vigilancia') ->> 'aprobacion_separada') AS ok \gset
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-6g] pedir encender SÍ opera: la fila queda encendida');
SELECT public.chk(public.sep_nbit(:C::uuid), :f0 + 1, '[SEP-6g] con UNA fila de bitácora');
SELECT public.chk_bool((SELECT b.origen = 'usuario' AND b.valor_anterior IS NOT DISTINCT FROM false AND b.valor_nuevo AND b.actor_id = :UA::uuid
                          FROM public.compras_config_separacion_bitacora b WHERE b.company_id = :C::uuid ORDER BY b.id DESC LIMIT 1), true,
  '[SEP-6g] de origen «usuario», con el administrador como actor y «anterior» = lo que tenía la fila (apagada)');

-- ═══════════════════════════════════════════════════════════════════════════
-- G · SECURITY DEFINER: el conjunto exacto de funciones de la pieza que lo son
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.chk_txt((SELECT string_agg(p.proname, ',' ORDER BY p.proname COLLATE "C") FROM pg_proc p
                        WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
                          AND (p.proname LIKE 'compras\_separacion\_%' OR p.proname LIKE 'compras\_tg\_config\_separacion%')),
  'compras_separacion_configurar,compras_separacion_memoria,compras_separacion_rechazar,compras_separacion_registrar,compras_separacion_via_rpc,compras_tg_config_separacion,compras_tg_config_separacion_bitacora,compras_tg_config_separacion_truncate',
  '[SEP-6h] son SECURITY DEFINER las ocho funciones que leen o escriben la bitácora y la configuración (la RPC, la memoria, el permiso de la RPC, el rechazo, el registro y los tres triggers)');
SELECT public.chk_bool((SELECT NOT p.prosecdef FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'compras_tg_config_separacion_bitacora_inmutable'), true,
  '[SEP-6h] y la que rechaza UPDATE/DELETE/TRUNCATE de la bitácora NO lo es: no consulta nada y el rechazo no depende de quién llame');

-- ═══════════════════════════════════════════════════════════════════════════
-- H · La memoria es la última fila por ID, no por fecha (dos relojes que discrepan no la cambian)
-- ═══════════════════════════════════════════════════════════════════════════
DO $do$
BEGIN
  BEGIN
    -- empresa inventada (la bitácora no tiene llave foránea): la fila de mayor id es la «apagada», pero su fecha es ANTERIOR a la de la «activa»
    INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, motivo, origen, cambiado_at) VALUES
      ('5e960000-0000-0000-0000-0000000000a1', NULL, NULL, true,  'Línea base de la prueba del orden por id', 'linea_base', now() + interval '1 hour'),
      ('5e960000-0000-0000-0000-0000000000a1', NULL, true, false, NULL,                                     'sistema',    now());
    PERFORM public.chk_bool(public.compras_separacion_memoria('5e960000-0000-0000-0000-0000000000a1'::uuid), false,
      '[SEP-6i] la memoria es la fila de MAYOR id (la última en el orden del candado), aunque su fecha sea anterior a la de otra fila');
    RAISE EXCEPTION 'SEP6_REVERTIR';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SEP6_REVERTIR' THEN RAISE; END IF;
  END;
END $do$;
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = '5e960000-0000-0000-0000-0000000000a1'), 0, '[SEP-6i] y la simulación no dejó filas (se revirtió)');

-- ── Limpieza: C y D sin fila y con la memoria en «apagada» (la bitácora conserva sus filas) ──
SELECT public.sep_preparar(:C::uuid, false);
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_preparar(:D::uuid, false);
SELECT public.sep_preparar(:D::uuid, NULL);
SELECT public.chk_txt(public.sep_valor(:C::uuid) || '/' || public.sep_valor(:D::uuid), 'SIN FILA/SIN FILA', '[SEP-6z] C y D quedan sin fila');
SELECT public.chk_bool(COALESCE(public.compras_separacion_memoria(:C::uuid), false) OR COALESCE(public.compras_separacion_memoria(:D::uuid), false), false,
  '[SEP-6z] y con la memoria en «apagada»');
