\set ON_ERROR_STOP on
-- ============================================================================
-- SEP-1 · El interruptor de la separación solicitante/aprobador (compras_config.aprobacion_separada) NO se cambia por ninguna
--         vía directa, ni de quien edita, ni de quien borra, ni del administrador: solo por compras_separacion_configurar.
--
-- CAUSA RAÍZ (comprobada sobre la base de 20261027000800; el prototipo P-2 cerraba solo al editor)
--   La política de compras_config exige `edit` (`delete` para borrar) y compras_tg_oc_ciclo lee ESA fila. Quien solicita una orden y
--   puede editar la configuración la apaga, se aprueba a sí mismo y la vuelve a encender. Además: TRUNCATE no pasa por RLS (hasta un
--   operador sin permisos vaciaba la tabla); el administrador, el propietario y el super administrador cambiaban el interruptor sin
--   motivo y sin rastro; mover `company_id` hacía desaparecer la fila; y la AUSENCIA de la fila no dejaba memoria de que estuvo
--   encendida (se re-creaba «apagada» con un INSERT, un UPSERT o un reemplazo DELETE + INSERT).
--
-- COMPORTAMIENTO ESPERADO
--   · UPDATE / DELETE / UPSERT / reemplazo (DELETE + INSERT) / mover company_id / TRUNCATE del interruptor encendido: rechazados para
--     TODA sesión de usuario (editor con edit y delete, contador, administrador, propietario, super administrador), con el código
--     que corresponde (SOLO_ADMIN a quien no es administrador, VIA_RPC al administrador). Un cambio rechazado no deja rastro.
--   · Encender por tabla (UPDATE o INSERT con true) también se rechaza: se enciende por la RPC.
--   · La ausencia de la fila no apaga lo establecido: si la bitácora dice «activa», un INSERT de usuario nace ENCENDIDO.
--   · Quien edita sigue cambiando las demás columnas (tolerancias, mínimo, requiere_recepcion), también con INSERT … ON CONFLICT que no
--     toque el interruptor. Con la separación APAGADA no hay prohibiciones nuevas.
--   · Lo que hace el sistema (sin sesión de usuario, o con conta.allow_system_write) sigue permitido y queda anotado como 'sistema'.
--
-- Ids propios: personas 5e90… (SEP-0). Deja la configuración de compras como la encontró (la bitácora, por ser inmutable, conserva
-- sus filas de prueba).
-- ============================================================================
\ir SEP-0.padron.sql
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set SE  '''5e900000-0000-0000-0000-0000000000e1'''
\set SS  '''5e900000-0000-0000-0000-0000000000a1'''
\set SX  '''5e900000-0000-0000-0000-0000000000a2'''
\set SP  '''5e900000-0000-0000-0000-0000000000a3'''

CREATE TEMP TABLE sep1_previa AS
SELECT c.* FROM public.compras_config c WHERE c.company_id IN ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_preparar(:D::uuid, NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- A · EDITOR con «Editar» y «Eliminar» (la persona tipo UQ), interruptor ENCENDIDO en C
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_preparar(:C::uuid, true);
SELECT public.sep_nbit(:C::uuid) AS n0 \gset
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1a] el editor NO apaga el interruptor por UPDATE');
SELECT public.chk_falla($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1b] ni borra la configuración que la tiene encendida (aun con «Eliminar»: sin fila = apagada)');
SELECT public.chk_falla($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', false)
                           ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = EXCLUDED.aprobacion_separada $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1c] ni con INSERT … ON CONFLICT DO UPDATE (UPSERT)');
SELECT public.chk_falla($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
                           INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', false) $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1d] ni reemplazando la fila (DELETE + INSERT en la misma transacción)');
SELECT public.chk_falla($$ UPDATE public.compras_config SET company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1e] ni moviendo la fila a otra empresa (mover company_id)');
SELECT public.chk_falla($$ TRUNCATE public.compras_config $$,
  'permission denied for table compras_config', '[SEP-1f] ni vaciando la tabla (TRUNCATE no pasa por RLS: sin el privilegio, no hay camino)');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1g] tras todos los intentos el interruptor sigue ENCENDIDO');
SELECT public.chk(public.sep_nbit(:C::uuid), :n0, '[SEP-1g] y los intentos rechazados no dejaron rastro (ninguna fila nueva en la bitácora)');

-- Lo legítimo: quien edita sigue cambiando todo lo demás, con el interruptor encendido y sin tocarlo.
SELECT updated_at AS u0 FROM public.compras_config WHERE company_id = :C::uuid \gset
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
UPDATE public.compras_config SET tolerancia_cantidad_pct = 2, tolerancia_precio_pct = 7, monto_minimo_oc = 100, requiere_recepcion = false
 WHERE company_id = :C::uuid;
RESET ROLE;
SELECT public.chk_num((SELECT tolerancia_precio_pct FROM public.compras_config WHERE company_id = :C::uuid), 7, '[SEP-1h] el editor sigue cambiando la tolerancia de precio');
SELECT public.chk_num((SELECT tolerancia_cantidad_pct FROM public.compras_config WHERE company_id = :C::uuid), 2, '[SEP-1h] la de cantidad');
SELECT public.chk_num((SELECT monto_minimo_oc FROM public.compras_config WHERE company_id = :C::uuid), 100, '[SEP-1h] el monto mínimo');
SELECT public.chk_bool((SELECT requiere_recepcion FROM public.compras_config WHERE company_id = :C::uuid), false, '[SEP-1h] y «requiere recepción»');
SELECT public.chk_bool((SELECT updated_at > :'u0'::timestamptz FROM public.compras_config WHERE company_id = :C::uuid), true,
  '[SEP-1h] el trigger de updated_at sigue funcionando (el orden de disparo no lo anula)');
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1h] con el interruptor sin tocar');
-- UPSERT que no menciona el interruptor (lo que haría una pantalla de tolerancias): el valor por defecto de la fila propuesta (false) NO lo arrastra.
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
INSERT INTO public.compras_config (company_id, tolerancia_precio_pct) VALUES (:C::uuid, 9)
  ON CONFLICT (company_id) DO UPDATE SET tolerancia_precio_pct = EXCLUDED.tolerancia_precio_pct;
RESET ROLE;
SELECT public.chk_num((SELECT tolerancia_precio_pct FROM public.compras_config WHERE company_id = :C::uuid), 9, '[SEP-1i] el UPSERT que solo cambia la tolerancia funciona');
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1i] y no apaga el interruptor (la fila propuesta trae false por defecto)');
SELECT public.chk(public.sep_nbit(:C::uuid), :n0, '[SEP-1i] y no escribe nada en la bitácora');

-- ═══════════════════════════════════════════════════════════════════════════
-- B · CONTADOR (UC: ver/crear/editar/eliminar) · OPERADOR SIN PERMISOS (UN) · anon
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1j] el contador no apaga el interruptor por UPDATE');
SELECT public.chk_falla($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1k] ni borra la configuración que la tiene encendida');
SELECT public.chk_falla($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', false)
                           ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = EXCLUDED.aprobacion_separada $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1l] ni con UPSERT');
SELECT public.como(:UN::uuid);
SELECT public.chk(public.sep_filas($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$), 0,
  '[SEP-1m] el operador sin permisos ni siquiera ve la fila para actualizarla: 0 filas (RLS)');
SELECT public.chk(public.sep_filas($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$), 0,
  '[SEP-1m] ni para borrarla: 0 filas');
SELECT public.chk_falla($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', false)
                           ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = EXCLUDED.aprobacion_separada $$,
  'row-level security', '[SEP-1m] ni el UPSERT (la política de INSERT lo rechaza)');
SELECT public.chk_falla($$ TRUNCATE public.compras_config $$,
  'permission denied for table compras_config', '[SEP-1n] ni vacía la tabla: TRUNCATE sin privilegio (antes lo tenía hasta un operador sin permisos)');
RESET ROLE;
-- anon: sin ningún privilegio (se mira el catálogo: bajo SET ROLE anon ni siquiera podría llamar a las ayudas de la prueba).
SELECT public.chk_bool(NOT (has_table_privilege('anon', 'public.compras_config', 'SELECT') OR has_table_privilege('anon', 'public.compras_config', 'INSERT')
                            OR has_table_privilege('anon', 'public.compras_config', 'UPDATE') OR has_table_privilege('anon', 'public.compras_config', 'DELETE')
                            OR has_table_privilege('anon', 'public.compras_config', 'TRUNCATE')), true,
  '[SEP-1o] anon no tiene ningún privilegio sobre compras_config (antes: todos, solo RLS lo frenaba)');
SELECT public.chk_bool(has_table_privilege('authenticated', 'public.compras_config', 'SELECT') AND has_table_privilege('authenticated', 'public.compras_config', 'INSERT')
                       AND has_table_privilege('authenticated', 'public.compras_config', 'UPDATE') AND has_table_privilege('authenticated', 'public.compras_config', 'DELETE'), true,
  '[SEP-1o] authenticated conserva SELECT, INSERT, UPDATE y DELETE (RLS los sigue gobernando fila por fila)');
SELECT public.chk_bool(NOT (has_table_privilege('authenticated', 'public.compras_config', 'TRUNCATE') OR has_table_privilege('authenticated', 'public.compras_config', 'TRIGGER')
                            OR has_table_privilege('authenticated', 'public.compras_config', 'REFERENCES')), true,
  '[SEP-1o] pero ya no TRUNCATE, TRIGGER ni REFERENCES');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1p] el interruptor sigue encendido');
SELECT public.chk(public.sep_nbit(:C::uuid), :n0, '[SEP-1p] y no hay filas nuevas en la bitácora');

-- ═══════════════════════════════════════════════════════════════════════════
-- C · ADMINISTRADOR, PROPIETARIO y SUPER ADMINISTRADOR por la vía directa (sin la RPC): tampoco
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1q] el administrador de C NO apaga el interruptor escribiendo en la tabla (sin motivo y sin rastro)');
SELECT public.chk_falla($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1r] ni borra la configuración');
SELECT public.chk_falla($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', false)
                           ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = EXCLUDED.aprobacion_separada $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1s] ni con UPSERT');
SELECT public.chk_falla($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
                           INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', false) $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1t] ni reemplazando la fila (DELETE + INSERT)');
SELECT public.chk_falla($$ UPDATE public.compras_config SET company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1u] ni moviéndola de empresa');
SELECT public.chk_falla($$ TRUNCATE public.compras_config $$, 'permission denied for table compras_config', '[SEP-1v] ni vaciándola');
SELECT public.como(:SP::uuid);
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1w] el propietario de la empresa tampoco: solo por la RPC');
SELECT public.como(:SS::uuid);
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1x] el super administrador tampoco por UPDATE');
SELECT public.chk_falla($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1y] ni por DELETE');
SELECT public.chk_falla($$ UPDATE public.compras_config SET company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1z] ni moviendo la fila de C a D (la separación de C desaparecería)');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1aa] el interruptor de C sigue encendido');
SELECT public.chk_txt(public.sep_valor(:D::uuid), 'SIN FILA', '[SEP-1aa] y D no recibió ninguna fila');
SELECT public.chk(public.sep_nbit(:C::uuid), :n0, '[SEP-1aa] ningún intento dejó rastro');

-- MERGE (PostgreSQL 15 en adelante) dispara los mismos triggers de fila: ni el editor ni el administrador esquivan por ahí.
SELECT current_setting('server_version_num')::int >= 150000 AS hay_merge \gset
\if :hay_merge
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ MERGE INTO public.compras_config t USING (SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid AS company_id) s ON t.company_id = s.company_id
                           WHEN MATCHED THEN UPDATE SET aprobacion_separada = false $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1ma] el editor no apaga el interruptor con MERGE … UPDATE');
SELECT public.chk_falla($$ MERGE INTO public.compras_config t USING (SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid AS company_id) s ON t.company_id = s.company_id
                           WHEN MATCHED THEN DELETE $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1mb] ni la borra con MERGE … DELETE');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ MERGE INTO public.compras_config t USING (SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid AS company_id) s ON t.company_id = s.company_id
                           WHEN MATCHED THEN UPDATE SET aprobacion_separada = false $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1mc] ni el administrador con MERGE (solo la RPC)');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1md] el interruptor sigue encendido tras los MERGE');
\endif

-- El permiso que la RPC pone en la transacción vale para UN cambio de UNA empresa: ni otra empresa ni el valor contrario
-- (la RPC lo pone justo antes de escribir y lo borra justo después). Aquí se simula que quedó puesto de más.
SELECT public.como(:UA::uuid);
BEGIN;
SELECT set_config('compras.separacion_rpc', 'dddddddd-dddd-dddd-dddd-dddddddddddd:false', true);
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1aaa] el permiso de la RPC para OTRA empresa no autoriza el cambio de C');
SELECT set_config('compras.separacion_rpc', 'cccccccc-cccc-cccc-cccc-cccccccccccc:true', true);
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1aab] ni el de C para el valor CONTRARIO (el permiso nombra empresa Y valor)');
SELECT public.chk_falla($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1aac] ni sirve para borrar la fila');
ROLLBACK;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1aad] el interruptor de C sigue encendido');

-- Encender tampoco se hace por la tabla: se enciende por la RPC (con motivo y bitácora).
SELECT public.sep_preparar(:C::uuid, false);
SELECT public.sep_nbit(:C::uuid) AS n1 \gset
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = true WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1ab] el administrador no ENCIENDE por UPDATE: se enciende por la RPC');
SELECT public.chk_falla($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
                           INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', true) $$,
  'COMPRAS_CONFIG_SEPARACION_VIA_RPC', '[SEP-1ac] ni encendiendo con un INSERT que reemplaza la fila');
SELECT public.como(:SE::uuid);
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = true WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1ad] ni el editor');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-1ae] sigue apagada');
SELECT public.chk(public.sep_nbit(:C::uuid), :n1, '[SEP-1ae] sin rastro');

-- ═══════════════════════════════════════════════════════════════════════════
-- D · OTRA EMPRESA: su administrador (UD) no alcanza la configuración de C; un rol «admin» de otra empresa no hace administrador
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_preparar(:C::uuid, true);
SELECT public.sep_nbit(:C::uuid) AS n2 \gset
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk(public.sep_filas($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$), 0,
  '[SEP-1af] el administrador de D no alcanza la fila de C: 0 filas por UPDATE (RLS)');
SELECT public.chk(public.sep_filas($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$), 0,
  '[SEP-1af] ni por DELETE');
SELECT public.chk_falla($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', false)
                           ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = EXCLUDED.aprobacion_separada $$,
  'row-level security', '[SEP-1ag] ni por UPSERT (la política de INSERT exige la empresa propia)');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Intento desde la empresa D') $$,
  'COMPRAS_ALCANCE_EMPRESA', '[SEP-1ah] por la RPC: el administrador de D es rechazado por ALCANCE de empresa');
SELECT public.como(:SX::uuid);
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1ai] un operador de C con un rol llamado «admin» (de D) y todas las llaves NO es administrador: UPDATE rechazado');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'El rol se llama admin pero es de otra empresa') $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1aj] ni por la RPC');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1ak] el interruptor de C no se movió');
SELECT public.chk(public.sep_nbit(:C::uuid), :n2, '[SEP-1ak] ni dejó rastro');

-- ═══════════════════════════════════════════════════════════════════════════
-- E · TRUNCATE: las dos capas (privilegio y trigger)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:SE::uuid);
SELECT public.chk_falla($$ TRUNCATE public.compras_config $$, 'COMPRAS_CONFIG_SEPARACION_TRUNCATE',
  '[SEP-1al] una sesión de usuario con privilegios de propietario (superusuario con sesión) tampoco vacía la tabla: lo rechaza el trigger');
GRANT TRUNCATE ON TABLE public.compras_config TO authenticated;      -- se devuelve el privilegio SOLO para probar la 2.ª capa
SET ROLE authenticated;
SELECT public.chk_falla($$ TRUNCATE public.compras_config $$, 'COMPRAS_CONFIG_SEPARACION_TRUNCATE',
  '[SEP-1am] aunque un día se volviera a conceder TRUNCATE a authenticated, el trigger lo rechaza (con sesión)');
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.chk_falla($$ TRUNCATE public.compras_config $$, 'COMPRAS_CONFIG_SEPARACION_TRUNCATE',
  '[SEP-1an] ni un rol de la API sin sesión (JWT sin sub): el trigger mira también el rol');
RESET ROLE;
REVOKE TRUNCATE ON TABLE public.compras_config FROM authenticated;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1ao] la configuración sigue ahí');
-- Un proceso de sistema SÍ puede vaciar la tabla (mantenimiento): queda anotado como apagada (y aquí se revierte).
SELECT set_config('request.jwt.claim.sub', '', false);
BEGIN;
TRUNCATE public.compras_config;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'SIN FILA', '[SEP-1ap] el sistema (sin sesión de usuario) puede vaciar la tabla en un mantenimiento');
SELECT public.chk_bool((SELECT valor_anterior AND NOT valor_nuevo AND origen = 'sistema' AND actor_id IS NULL
                          FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid ORDER BY id DESC LIMIT 1), true,
  '[SEP-1ap] y la separación de C queda anotada como APAGADA por el sistema (la ausencia no es silenciosa)');
ROLLBACK;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1aq] (la prueba anterior se revirtió)');

-- ═══════════════════════════════════════════════════════════════════════════
-- F · AUSENCIA: la fila falta por una vía que los triggers no ven, pero la bitácora recuerda que estuvo ENCENDIDA
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_borrar_sin_rastro(:C::uuid);
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'SIN FILA', '[SEP-1ar] preparación: la fila de C falta (borrada sin pasar por los triggers)');
SELECT public.chk_bool((SELECT valor_nuevo FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid ORDER BY id DESC LIMIT 1), true,
  '[SEP-1ar] y la bitácora de C dice que está ACTIVA');
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (:C::uuid, false);
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true',
  '[SEP-1as] el editor re-crea la fila «apagada» y nace ENCENDIDA: la ausencia no apaga lo establecido');
SELECT public.chk(public.sep_nbit(:C::uuid), :n2, '[SEP-1as] sin cambio de lo establecido, sin fila nueva en la bitácora');
-- El mismo intento por UPSERT y por el administrador (que tampoco puede apagar por la tabla).
SELECT public.sep_borrar_sin_rastro(:C::uuid);
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (:C::uuid, false)
  ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = EXCLUDED.aprobacion_separada;
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1at] el administrador por UPSERT sobre la fila ausente: nace ENCENDIDA también');
-- Y un reemplazo con la fila ausente: DELETE (0 filas) + INSERT false.
SELECT public.sep_borrar_sin_rastro(:C::uuid);
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
DELETE FROM public.compras_config WHERE company_id = :C::uuid;
INSERT INTO public.compras_config (company_id, aprobacion_separada, tolerancia_precio_pct) VALUES (:C::uuid, false, 3);
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-1au] el reemplazo DELETE + INSERT sobre la fila ausente: nace ENCENDIDA');
SELECT public.chk_num((SELECT tolerancia_precio_pct FROM public.compras_config WHERE company_id = :C::uuid), 3,
  '[SEP-1au] y las demás columnas se guardan como las pidió (solo el interruptor se corrige)');
-- La memoria no inventa nada: sin bitácora que diga «activa», el INSERT de un editor nace como lo pidió.
SELECT public.sep_preparar(:D::uuid, NULL);
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', false) $$,
  'row-level security', '[SEP-1av] (control) el editor de C no crea configuración en D');
RESET ROLE;
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
INSERT INTO public.compras_config (company_id) VALUES (:D::uuid);
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:D::uuid), 'false', '[SEP-1aw] sin memoria de separación, una empresa crea su configuración «apagada» como siempre');
SELECT public.sep_preparar(:D::uuid, NULL);

-- Borrado de sistema (anotado) ≠ ausencia sin rastro: la bitácora queda en «apagada» y un INSERT posterior NO se fuerza.
SELECT public.sep_preparar(:C::uuid, true);
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.chk_bool((SELECT NOT valor_nuevo AND origen = 'sistema' FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid ORDER BY id DESC LIMIT 1), true,
  '[SEP-1ax] un borrado de SISTEMA de la configuración encendida queda anotado como «apagada» (origen sistema)');
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (:C::uuid, false);
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-1ay] y entonces el INSERT de un editor nace apagada: no se inventan prohibiciones');

-- ═══════════════════════════════════════════════════════════════════════════
-- G · SEPARACIÓN APAGADA o SIN CONFIGURACIÓN: nada de lo anterior se bloquea (sin prohibiciones inventadas)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_nbit(:C::uuid) AS n3 \gset
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
UPDATE public.compras_config SET tolerancia_precio_pct = 4, monto_minimo_oc = 50 WHERE company_id = :C::uuid;
UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = :C::uuid;     -- (sin cambio de valor)
DELETE FROM public.compras_config WHERE company_id = :C::uuid;
INSERT INTO public.compras_config (company_id, aprobacion_separada, tolerancia_precio_pct) VALUES (:C::uuid, false, 6);
SELECT public.como(:UA::uuid);
DELETE FROM public.compras_config WHERE company_id = :C::uuid;
INSERT INTO public.compras_config (company_id) VALUES (:C::uuid)
  ON CONFLICT (company_id) DO UPDATE SET tolerancia_cantidad_pct = 1;
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-1az] con la separación apagada, editar, borrar, re-crear y hacer UPSERT de la configuración funciona como siempre');
SELECT public.chk(public.sep_nbit(:C::uuid), :n3, '[SEP-1az] y no deja rastro en la bitácora (no cambió lo establecido)');
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', true)
                           ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = EXCLUDED.aprobacion_separada $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1ba] pero encenderla sigue siendo solo por la RPC (UPSERT con true)');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- H · El SISTEMA sigue pudiendo, y queda anotado
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_preparar(:C::uuid, false);
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.compras_config SET aprobacion_separada = true WHERE company_id = :C::uuid;
SELECT public.chk_bool((SELECT valor_anterior = false AND valor_nuevo AND origen = 'sistema' AND actor_id IS NULL AND motivo IS NULL
                          FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid ORDER BY id DESC LIMIT 1), true,
  '[SEP-1bb] sin sesión de usuario el interruptor se enciende como siempre y queda anotado: origen sistema, actor NULL, sin motivo');
UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = :C::uuid;
SELECT public.chk_bool((SELECT valor_anterior AND NOT valor_nuevo AND origen = 'sistema'
                          FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid ORDER BY id DESC LIMIT 1), true,
  '[SEP-1bc] y se apaga y queda anotado');
SELECT public.como(:SE::uuid);
SET conta.allow_system_write = 'on';
UPDATE public.compras_config SET aprobacion_separada = true WHERE company_id = :C::uuid;
RESET conta.allow_system_write;
SELECT public.chk_bool((SELECT NOT valor_anterior AND valor_nuevo AND origen = 'sistema' AND actor_id = :SE::uuid
                          FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid ORDER BY id DESC LIMIT 1), true,
  '[SEP-1bd] con conta.allow_system_write (un trigger de sistema, no una persona) tampoco se bloquea; queda como sistema, con el actor que el servidor ve');
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-1be] pero fuera de ese camino, la misma sesión vuelve a ser de usuario y no puede');
SELECT public.chk(public.sep_cadena_rota(:C::uuid), 0, '[SEP-1bf] la bitácora de C encadena: el anterior de cada fila es el nuevo de la anterior');

-- Purga de una empresa (cascada del DELETE de companies): no la bloquea la separación encendida y la bitácora conserva su historia.
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.companies (id, nombre, default_currency) VALUES ('5e900000-0000-0000-0000-0000000000c0', 'SEP Empresa a purgar', 'gtq');
SELECT public.sep_preparar('5e900000-0000-0000-0000-0000000000c0'::uuid, true);
SELECT public.sep_nbit('5e900000-0000-0000-0000-0000000000c0'::uuid) AS n4 \gset
SELECT public.como(:SS::uuid);
DELETE FROM public.companies WHERE id = '5e900000-0000-0000-0000-0000000000c0';
SELECT public.chk(public.sep_filas($$ SELECT 1 FROM public.compras_config WHERE company_id = '5e900000-0000-0000-0000-0000000000c0' $$), 0,
  '[SEP-1bg] la empresa con la separación encendida se purga (la cascada no la bloquea) y su configuración desaparece con ella');
SELECT public.chk_bool((SELECT NOT valor_nuevo AND origen = 'sistema' FROM public.compras_config_separacion_bitacora
                         WHERE company_id = '5e900000-0000-0000-0000-0000000000c0' ORDER BY id DESC LIMIT 1), true,
  '[SEP-1bh] la bitácora (sin llave foránea) sobrevive a la empresa y anota la baja');
SELECT public.chk_bool((SELECT count(*) > :n4 FROM public.compras_config_separacion_bitacora WHERE company_id = '5e900000-0000-0000-0000-0000000000c0'), true,
  '[SEP-1bi] y conserva las filas anteriores');

-- ── Se deja la configuración como estaba ─────────────────────────────────────
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_preparar(:D::uuid, NULL);
SELECT public.como_sistema($$ INSERT INTO public.compras_config SELECT * FROM sep1_previa $$);
DROP TABLE sep1_previa;
SELECT set_config('request.jwt.claim.sub', '', false);
