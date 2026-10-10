\set ON_ERROR_STOP on
-- ============================================================================
-- SEP-2 · compras_separacion_configurar (la ÚNICA vía) y la bitácora protegida de los cambios del interruptor.
--
-- COMPORTAMIENTO ESPERADO
--   · Solo el propietario/administrador DE LA EMPRESA o el super administrador cambian el interruptor; los demás reciben SOLO_ADMIN, el
--     administrador de otra empresa recibe ALCANCE_EMPRESA (sin saber si la empresa existe).
--   · Motivo obligatorio (10 a 1000 caracteres útiles) y guardado SIN espacios en los extremos; el actor lo sella el servidor
--     (la función no recibe actor); valor distinto del vigente; empresa inexistente → error claro. NUNCA éxito sin operación.
--   · Cada cambio deja UNA fila de bitácora (empresa, actor, fecha, anterior, nuevo, motivo, origen) y la cadena encadena.
--   · La bitácora no se edita ni se borra ni se vacía —ni el administrador, ni el super administrador por la API, ni el propietario de
--     la tabla— y solo la leen el administrador/propietario de la empresa y el super administrador.
--   · Línea base: una fila por cada empresa que ya tenía la separación encendida; re-aplicar no duplica.
--
-- Ids propios: personas 5e90… (SEP-0). Deja la configuración de compras como la encontró (la bitácora conserva sus filas).
-- ============================================================================
\ir SEP-0.padron.sql
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set SE  '''5e900000-0000-0000-0000-0000000000e1'''
\set SS  '''5e900000-0000-0000-0000-0000000000a1'''
\set SX  '''5e900000-0000-0000-0000-0000000000a2'''
\set SP  '''5e900000-0000-0000-0000-0000000000a3'''
\set ZZ  '''5e900000-0000-0000-0000-0000000000ff'''

CREATE TEMP TABLE sep2_previa AS
SELECT c.* FROM public.compras_config c WHERE c.company_id IN ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
CREATE TEMP TABLE sep2_res (k text PRIMARY KEY, r jsonb);
GRANT ALL ON sep2_res TO authenticated;

-- La migración NO enciende la separación en ninguna empresa (ni inventa filas de línea base donde no la había).
SELECT public.chk((SELECT count(*) FROM public.compras_config WHERE aprobacion_separada), 0,
  '[SEP-2a] al llegar, ninguna empresa tiene la separación encendida: la migración no la activa globalmente');
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora b WHERE b.origen = 'linea_base'
                      AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = b.company_id)), 0,
  '[SEP-2a] y no hay filas de línea base (no había nada encendido que recordar)');
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_preparar(:D::uuid, NULL);
SELECT public.sep_nbit(:C::uuid) AS c0 \gset

-- ═══════════════════════════════════════════════════════════════════════════
-- A · El administrador ENCIENDE con motivo (con espacios, tabulaciones y saltos de línea alrededor)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO sep2_res SELECT 'on', public.compras_separacion_configurar(:C::uuid, true, E'  \t Se activa la separación por la política de control interno \n ');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-2b] el administrador enciende la separación por la RPC: el circuito lee TRUE en compras_config');
SELECT public.chk_txt((SELECT r->>'aprobacion_separada' FROM sep2_res WHERE k = 'on'), 'true', '[SEP-2b] la RPC devuelve el estado resultante (leído de la fila)');
SELECT public.chk_txt((SELECT r->>'valor_anterior' FROM sep2_res WHERE k = 'on'), 'false', '[SEP-2b] y el valor anterior (apagada)');
SELECT public.chk_txt((SELECT r->>'motivo' FROM sep2_res WHERE k = 'on'), 'Se activa la separación por la política de control interno', '[SEP-2b] y el motivo SIN espacios sobrantes');
SELECT public.chk_txt((SELECT r->>'actor_id' FROM sep2_res WHERE k = 'on'), :UA, '[SEP-2b] y el actor: el servidor lo toma de la sesión');
SELECT public.chk(public.sep_nbit(:C::uuid), :c0 + 1, '[SEP-2c] el cambio deja UNA fila en la bitácora');
SELECT public.chk_bool((SELECT b.company_id = :C::uuid AND b.actor_id = :UA::uuid AND b.valor_anterior = false AND b.valor_nuevo AND b.origen = 'usuario'
                               AND b.motivo = 'Se activa la separación por la política de control interno'
                               AND b.cambiado_at BETWEEN clock_timestamp() - interval '1 minute' AND clock_timestamp()
                               AND b.id::text = (SELECT r->>'bitacora_id' FROM sep2_res WHERE k = 'on')
                          FROM public.compras_config_separacion_bitacora b WHERE b.company_id = :C::uuid ORDER BY b.id DESC LIMIT 1), true,
  '[SEP-2c] con empresa, actor, fecha, valor anterior, valor nuevo, motivo (recortado) y origen «usuario»; el id coincide con el que devolvió la RPC');
SELECT public.chk_bool((SELECT motivo !~ '^[[:space:]]|[[:space:]]$' FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid ORDER BY id DESC LIMIT 1), true,
  '[SEP-2c] el motivo guardado no tiene espacios, tabulaciones ni saltos de línea en los extremos');

-- Otro administrador APAGA: el anterior encadena con el nuevo de la fila previa.
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
INSERT INTO sep2_res SELECT 'off', public.compras_separacion_configurar(:C::uuid, false, 'La política cambió: el cierre mensual lo hace una sola persona');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-2d] el segundo administrador apaga la separación');
SELECT public.chk_txt((SELECT r->>'valor_anterior' FROM sep2_res WHERE k = 'off'), 'true', '[SEP-2d] y el anterior que ve es el que dejó el primero (encadena)');
SELECT public.chk_bool((SELECT b.actor_id = :UB::uuid AND b.valor_anterior AND NOT b.valor_nuevo AND b.origen = 'usuario'
                          FROM public.compras_config_separacion_bitacora b WHERE b.company_id = :C::uuid ORDER BY b.id DESC LIMIT 1), true,
  '[SEP-2d] la fila nueva lleva a UB como actor, anterior true y nuevo false');
SELECT public.chk(public.sep_nbit(:C::uuid), :c0 + 2, '[SEP-2d] y son dos filas en total');
SELECT public.chk(public.sep_cadena_rota(:C::uuid), 0, '[SEP-2d] la cadena de la empresa es coherente');

-- «Sin cambio»: pedir lo que ya es NO es una operación y no se finge éxito.
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Apagar lo que ya está apagado') $$,
  'COMPRAS_SEPARACION_SIN_CAMBIO', '[SEP-2e] apagar lo que ya está apagado: error claro, no éxito');
SELECT public.como(:UA::uuid);
INSERT INTO sep2_res SELECT 'on2', public.compras_separacion_configurar(:C::uuid, true, 'Se vuelve a activar tras la auditoría');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'Activar lo que ya está activado') $$,
  'COMPRAS_SEPARACION_SIN_CAMBIO', '[SEP-2e] ni activar lo que ya está activado (reintento del mismo clic)');
RESET ROLE;
SELECT public.chk(public.sep_nbit(:C::uuid), :c0 + 3, '[SEP-2e] los rechazos «sin cambio» no escriben bitácora: tres cambios reales, tres filas');

-- ═══════════════════════════════════════════════════════════════════════════
-- B · Validaciones: nada de lo que sigue cambia el interruptor ni escribe bitácora
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, NULL) $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-2f] sin motivo (NULL)');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, '') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-2f] motivo vacío');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, E'   \t \n  ') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-2f] motivo solo de espacios, tabulaciones y saltos de línea');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, repeat(chr(160), 12)) $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-2f] motivo solo de espacios duros (no son caracteres útiles)');
-- Los de ancho cero (U+200B) y la marca de orden de bytes (U+FEFF) solo existen en una base UTF8 (la de Supabase); la plantilla del arnés puede ser SQL_ASCII.
SELECT current_setting('server_encoding') = 'UTF8' AS utf8 \gset
\if :utf8
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, repeat(chr(160), 6) || repeat(chr(8203), 3) || chr(65279)) $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-2f] motivo solo de espacios duros, de ancho cero y marca de orden de bytes');
\endif
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'corto') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-2f] motivo de 5 caracteres');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, '   abcd12345   ') $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-2f] 9 caracteres útiles rodeados de espacios: los espacios no cuentan');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, repeat('x', 1001)) $$,
  'COMPRAS_SEPARACION_MOTIVO', '[SEP-2f] y más de 1000 caracteres tampoco');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar(NULL, false, 'Sin empresa indicada') $$,
  'COMPRAS_SEPARACION_PARAMETROS', '[SEP-2g] sin empresa');
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, 'Sin valor indicado') $$,
  'COMPRAS_SEPARACION_PARAMETROS', '[SEP-2g] sin valor');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-2h] el interruptor sigue como estaba (encendido)');
SELECT public.chk(public.sep_nbit(:C::uuid), :c0 + 3, '[SEP-2h] y ninguna validación fallida escribió bitácora');

-- Cero filas: una empresa que NO existe jamás devuelve éxito.
SELECT public.como(:SS::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('5e900000-0000-0000-0000-0000000000ff', true, 'Una empresa que no existe') $$,
  'COMPRAS_SEPARACION_EMPRESA_INEXISTENTE', '[SEP-2i] el super administrador sobre una empresa inexistente: error claro (no «0 filas, todo bien»)');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('5e900000-0000-0000-0000-0000000000ff', true, 'Una empresa que no existe') $$,
  'COMPRAS_ALCANCE_EMPRESA', '[SEP-2j] el administrador sobre una empresa que no es la suya recibe ALCANCE (no se entera de si existe)');
RESET ROLE;
SELECT public.chk(public.sep_nbit(:ZZ::uuid), 0, '[SEP-2k] ni bitácora');
SELECT public.chk((SELECT count(*) FROM public.compras_config WHERE company_id = :ZZ::uuid), 0, '[SEP-2k] ni configuración para la empresa inexistente');

-- Sin sesión de usuario: el actor lo toma el servidor de la sesión; sin sesión no hay actor.
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Llamada sin sesión de usuario') $$,
  'COMPRAS_SEPARACION_SESION', '[SEP-2l] sin sesión de usuario: rechazada');
SELECT public.como(:UA::uuid);
SET conta.allow_system_write = 'on';
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Con el permiso de sistema de otro proceso') $$,
  'COMPRAS_SEPARACION_SESION', '[SEP-2l] ni con conta.allow_system_write: la RPC es de personas');
RESET conta.allow_system_write;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-2l] sigue encendido');

-- Límites del motivo que SÍ valen: 10 caracteres exactos y 1000 exactos.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO sep2_res SELECT 'diez', public.compras_separacion_configurar(:C::uuid, false, E'\n12345abcde\t');
INSERT INTO sep2_res SELECT 'mil', public.compras_separacion_configurar(:C::uuid, true, repeat('m', 1000));
RESET ROLE;
SELECT public.chk_txt((SELECT r->>'motivo' FROM sep2_res WHERE k = 'diez'), '12345abcde', '[SEP-2m] 10 caracteres útiles (con saltos de línea y tabulación alrededor) son suficientes y se guardan recortados');
SELECT public.chk(public.sep_nbit(:C::uuid), :c0 + 5, '[SEP-2m] y 1000 caracteres también: cinco cambios reales, cinco filas');

-- ═══════════════════════════════════════════════════════════════════════════
-- C · Quién puede: administrador y propietario DE LA EMPRESA, super administrador; nadie más
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_nbit(:C::uuid) AS c1 \gset
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'El editor quiere apagarla') $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-2n] el editor (edit + delete + approve) no');
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'El contador quiere apagarla') $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-2o] el contador no');
SELECT public.como(:UO::uuid);
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'El operador quiere apagarla') $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-2p] el operador sin permiso contable no');
SELECT public.como(:UN::uuid);
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'El operador sin permisos quiere apagarla') $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-2q] el operador sin permisos no');
SELECT public.como(:SX::uuid);
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'Tengo un rol llamado admin de otra empresa') $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-2r] quien tiene un rol llamado «admin» de OTRA empresa con todas las llaves no es administrador');
SELECT public.como(:UD::uuid);
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'El administrador de D quiere apagar la de C') $$,
  'COMPRAS_ALCANCE_EMPRESA', '[SEP-2s] el administrador de OTRA empresa: rechazo por alcance');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-2t] ninguno cambió nada');
SELECT public.chk(public.sep_nbit(:C::uuid), :c1, '[SEP-2t] ni dejó rastro');

SELECT public.como(:SP::uuid);
SET ROLE authenticated;
INSERT INTO sep2_res SELECT 'owner', public.compras_separacion_configurar(:C::uuid, false, 'El propietario apaga la separación en el cierre');
RESET ROLE;
SELECT public.chk_bool((SELECT b.actor_id = :SP::uuid AND NOT b.valor_nuevo FROM public.compras_config_separacion_bitacora b WHERE b.company_id = :C::uuid ORDER BY b.id DESC LIMIT 1), true,
  '[SEP-2u] el propietario (company_owner) de la empresa sí puede, y queda como actor');
SELECT public.como(:SS::uuid);
SET ROLE authenticated;
INSERT INTO sep2_res SELECT 'super', public.compras_separacion_configurar(:C::uuid, true, 'El soporte activa la separación a pedido de la gerencia');
RESET ROLE;
SELECT public.chk_bool((SELECT b.actor_id = :SS::uuid AND b.valor_nuevo FROM public.compras_config_separacion_bitacora b WHERE b.company_id = :C::uuid ORDER BY b.id DESC LIMIT 1), true,
  '[SEP-2v] el super administrador también');
-- Una empresa SIN fila de configuración: la RPC la crea (el super administrador sobre D; luego su administrador la apaga).
SELECT public.sep_nbit(:D::uuid) AS d0 \gset
SELECT public.como(:SS::uuid);
SET ROLE authenticated;
INSERT INTO sep2_res SELECT 'd_on', public.compras_separacion_configurar(:D::uuid, true, 'Se activa en D por decisión de su gerencia');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:D::uuid), 'true', '[SEP-2w] sobre una empresa sin fila de configuración, la RPC crea la fila ENCENDIDA');
SELECT public.chk_txt((SELECT r->>'valor_anterior' FROM sep2_res WHERE k = 'd_on'), 'false', '[SEP-2w] y el anterior es «apagada» (sin fila = apagada)');
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-2w] la de C no se movió');
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
INSERT INTO sep2_res SELECT 'd_off', public.compras_separacion_configurar(:D::uuid, false, 'El administrador de D la desactiva tras la auditoría');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:D::uuid), 'false', '[SEP-2x] el administrador de D apaga la suya');
SELECT public.chk(public.sep_nbit(:D::uuid), :d0 + 2, '[SEP-2x] dos filas en la bitácora de D');
SELECT public.chk(public.sep_cadena_rota(:C::uuid) + public.sep_cadena_rota(:D::uuid), 0, '[SEP-2x] las cadenas de C y de D son coherentes');

-- Sin fila Y sin nada establecido, apagar es «sin cambio» (no hay nada que apagar); encender crea la fila.
SELECT public.sep_preparar(:D::uuid, NULL);       -- el sistema la borra: queda anotada como apagada
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_separacion_configurar('dddddddd-dddd-dddd-dddd-dddddddddddd', false, 'Apagar una empresa que no tiene nada encendido') $$,
  'COMPRAS_SEPARACION_SIN_CAMBIO', '[SEP-2y] sin fila y sin nada establecido, apagar es «sin cambio»: error, no éxito');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- D · La fila falta (borrada sin pasar por los triggers) pero la bitácora dice «activa»: la RPC la restablece o la apaga con rastro
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_preparar(:C::uuid, true);
SELECT public.sep_borrar_sin_rastro(:C::uuid);
SELECT public.sep_nbit(:C::uuid) AS c2 \gset
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO sep2_res SELECT 'resta', public.compras_separacion_configurar(:C::uuid, true, 'Restablecer la fila que se perdió en la carga manual');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-2z] activar con la fila ausente y la bitácora «activa»: la fila se restablece ENCENDIDA');
SELECT public.chk_txt((SELECT r->>'restablecida' FROM sep2_res WHERE k = 'resta'), 'true', '[SEP-2z] la RPC avisa que solo restableció la fila');
SELECT public.chk(public.sep_nbit(:C::uuid), :c2, '[SEP-2z] sin cambio de lo establecido no se inventa una fila de bitácora');
SELECT public.sep_borrar_sin_rastro(:C::uuid);
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO sep2_res SELECT 'apaga', public.compras_separacion_configurar(:C::uuid, false, 'Desactivar tras la pérdida de la fila de configuración');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-2aa] apagar con la fila ausente y la bitácora «activa»: sí es un cambio de lo establecido');
SELECT public.chk_txt((SELECT r->>'valor_anterior' FROM sep2_res WHERE k = 'apaga'), 'true', '[SEP-2aa] el anterior es el que recordaba la bitácora');
SELECT public.chk(public.sep_nbit(:C::uuid), :c2 + 1, '[SEP-2aa] y deja su fila');
SELECT public.chk(public.sep_cadena_rota(:C::uuid), 0, '[SEP-2aa] encadenada con la anterior');

-- ═══════════════════════════════════════════════════════════════════════════
-- E · La bitácora es de SOLO ESCRITURA y de LECTURA restringida
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.chk_bool((SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid) > 0
                       AND (SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = :D::uuid) > 0, true,
  '[SEP-2ab] preparación: C y D tienen bitácora');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid), true, '[SEP-2ac] el administrador de C lee la bitácora de C');
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id <> :C::uuid), 0, '[SEP-2ac] y solo la de C');
SELECT public.chk_falla($$ UPDATE public.compras_config_separacion_bitacora SET motivo = 'reescrito' $$,
  'permission denied for table compras_config_separacion_bitacora', '[SEP-2ad] el administrador no edita la bitácora (sin privilegio UPDATE)');
SELECT public.chk_falla($$ DELETE FROM public.compras_config_separacion_bitacora $$,
  'permission denied for table compras_config_separacion_bitacora', '[SEP-2ae] ni la borra');
SELECT public.chk_falla($$ INSERT INTO public.compras_config_separacion_bitacora (company_id, valor_anterior, valor_nuevo, origen) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', true, false, 'sistema') $$,
  'permission denied for table compras_config_separacion_bitacora', '[SEP-2af] ni escribe filas a mano (la única que escribe es el trigger)');
SELECT public.chk_falla($$ TRUNCATE public.compras_config_separacion_bitacora $$,
  'permission denied for table compras_config_separacion_bitacora', '[SEP-2ag] ni la vacía');
SELECT public.como(:SS::uuid);
SELECT public.chk_bool((SELECT count(DISTINCT company_id) >= 2 FROM public.compras_config_separacion_bitacora), true, '[SEP-2ah] el super administrador lee la de todas las empresas');
SELECT public.chk_falla($$ UPDATE public.compras_config_separacion_bitacora SET motivo = 'reescrito' $$,
  'permission denied for table compras_config_separacion_bitacora', '[SEP-2ai] pero tampoco la edita por la API');
SELECT public.chk_falla($$ DELETE FROM public.compras_config_separacion_bitacora $$,
  'permission denied for table compras_config_separacion_bitacora', '[SEP-2aj] ni la borra');
SELECT public.chk_falla($$ TRUNCATE public.compras_config_separacion_bitacora $$,
  'permission denied for table compras_config_separacion_bitacora', '[SEP-2ak] ni la vacía');
SELECT public.como(:SP::uuid);
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid), true, '[SEP-2al] el propietario de C la lee');
SELECT public.como(:UD::uuid);
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = :C::uuid), 0, '[SEP-2am] el administrador de D no ve la bitácora de C');
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.compras_config_separacion_bitacora WHERE company_id = :D::uuid), true, '[SEP-2am] pero sí la de D');
SELECT public.como(:SE::uuid);
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora), 0, '[SEP-2an] el editor (edit + delete) no lee la bitácora: es evidencia de administración');
SELECT public.como(:UC::uuid);
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora), 0, '[SEP-2an] ni el contador');
SELECT public.como(:UN::uuid);
SELECT public.chk((SELECT count(*) FROM public.compras_config_separacion_bitacora), 0, '[SEP-2an] ni el operador sin permisos');
RESET ROLE;
SELECT public.chk_bool(NOT (has_table_privilege('anon', 'public.compras_config_separacion_bitacora', 'SELECT')
                            OR has_table_privilege('anon', 'public.compras_config_separacion_bitacora', 'INSERT')
                            OR has_table_privilege('anon', 'public.compras_config_separacion_bitacora', 'UPDATE')
                            OR has_table_privilege('anon', 'public.compras_config_separacion_bitacora', 'DELETE')
                            OR has_table_privilege('anon', 'public.compras_config_separacion_bitacora', 'TRUNCATE')), true, '[SEP-2ao] anon no tiene ningún privilegio');
SELECT public.chk_bool(has_table_privilege('authenticated', 'public.compras_config_separacion_bitacora', 'SELECT')
                       AND NOT (has_table_privilege('authenticated', 'public.compras_config_separacion_bitacora', 'INSERT')
                                OR has_table_privilege('authenticated', 'public.compras_config_separacion_bitacora', 'UPDATE')
                                OR has_table_privilege('authenticated', 'public.compras_config_separacion_bitacora', 'DELETE')
                                OR has_table_privilege('authenticated', 'public.compras_config_separacion_bitacora', 'TRUNCATE')
                                OR has_table_privilege('authenticated', 'public.compras_config_separacion_bitacora', 'TRIGGER')
                                OR has_table_privilege('authenticated', 'public.compras_config_separacion_bitacora', 'REFERENCES')), true,
  '[SEP-2ap] authenticated solo tiene SELECT (y RLS lo restringe a administración)');
SELECT public.chk_bool(has_table_privilege('service_role', 'public.compras_config_separacion_bitacora', 'SELECT')
                       AND NOT (has_table_privilege('service_role', 'public.compras_config_separacion_bitacora', 'INSERT')
                                OR has_table_privilege('service_role', 'public.compras_config_separacion_bitacora', 'UPDATE')
                                OR has_table_privilege('service_role', 'public.compras_config_separacion_bitacora', 'DELETE')
                                OR has_table_privilege('service_role', 'public.compras_config_separacion_bitacora', 'TRUNCATE')), true,
  '[SEP-2aq] la llave de servicio puede leerla pero no escribirla');
SELECT public.chk_bool(NOT (has_sequence_privilege('authenticated', 'public.compras_config_separacion_bitacora_id_seq', 'USAGE')
                            OR has_sequence_privilege('anon', 'public.compras_config_separacion_bitacora_id_seq', 'USAGE')), true,
  '[SEP-2ar] nadie de la API consume la secuencia de la bitácora');

-- Inmutable también para el PROPIETARIO de la tabla y para un superusuario con sesión de usuario: el trigger rechaza.
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.chk_falla($$ UPDATE public.compras_config_separacion_bitacora SET motivo = 'reescrito' $$,
  'COMPRAS_SEPARACION_BITACORA_INMUTABLE', '[SEP-2as] el propietario de la tabla no edita la bitácora (trigger)');
SELECT public.chk_falla($$ DELETE FROM public.compras_config_separacion_bitacora $$,
  'COMPRAS_SEPARACION_BITACORA_INMUTABLE', '[SEP-2at] ni la borra');
SELECT public.chk_falla($$ TRUNCATE public.compras_config_separacion_bitacora $$,
  'COMPRAS_SEPARACION_BITACORA_INMUTABLE', '[SEP-2au] ni la vacía');
SELECT public.como(:SS::uuid);
SELECT public.chk_falla($$ UPDATE public.compras_config_separacion_bitacora SET valor_nuevo = NOT valor_nuevo $$,
  'COMPRAS_SEPARACION_BITACORA_INMUTABLE', '[SEP-2av] ni con una sesión de super administrador en una conexión privilegiada');
-- Defensa del propio dato: una fila a mano (solo el propietario puede) no puede ser incompleta ni contradictoria.
SELECT public.chk_falla($$ INSERT INTO public.compras_config_separacion_bitacora (company_id, valor_anterior, valor_nuevo, origen, motivo, actor_id)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', true, false, 'usuario', NULL, '5e900000-0000-0000-0000-0000000000a1') $$,
  'compras_config_sep_bit_usuario_check', '[SEP-2aw] una fila de origen «usuario» sin motivo no entra (un CHECK con NULL pasaría: se valida con COALESCE)');
SELECT public.chk_falla($$ INSERT INTO public.compras_config_separacion_bitacora (company_id, valor_anterior, valor_nuevo, origen, motivo, actor_id)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', true, false, 'usuario', 'Motivo suficiente pero sin actor', NULL) $$,
  'compras_config_sep_bit_usuario_check', '[SEP-2ax] ni sin actor');
SELECT public.chk_falla($$ INSERT INTO public.compras_config_separacion_bitacora (company_id, valor_anterior, valor_nuevo, origen, motivo)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', true, false, 'sistema', ' con espacios en los extremos ') $$,
  'compras_config_sep_bit_motivo_check', '[SEP-2ay] ni un motivo con espacios en los extremos');
SELECT public.chk_falla($$ INSERT INTO public.compras_config_separacion_bitacora (company_id, valor_anterior, valor_nuevo, origen)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', true, true, 'sistema') $$,
  'compras_config_sep_bit_cambio_check', '[SEP-2az] ni una fila que no es un cambio (anterior = nuevo)');
SELECT public.chk_falla($$ INSERT INTO public.compras_config_separacion_bitacora (company_id, valor_anterior, valor_nuevo, origen)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', true, false, 'otro') $$,
  'compras_config_sep_bit_origen_check', '[SEP-2ba] ni un origen inventado');
SELECT set_config('request.jwt.claim.sub', '', false);

-- ═══════════════════════════════════════════════════════════════════════════
-- F · Privilegios y forma de las funciones
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.chk_bool(has_function_privilege('authenticated', 'public.compras_separacion_configurar(uuid,boolean,text)', 'EXECUTE'), true,
  '[SEP-2bb] authenticated ejecuta la RPC');
SELECT public.chk_bool(NOT has_function_privilege('anon', 'public.compras_separacion_configurar(uuid,boolean,text)', 'EXECUTE')
                       AND NOT has_function_privilege('service_role', 'public.compras_separacion_configurar(uuid,boolean,text)', 'EXECUTE'), true,
  '[SEP-2bc] anon y service_role no (GRANT EXECUTE solo a authenticated)');
SELECT public.chk_bool((SELECT p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
                          FROM pg_proc p WHERE p.oid = 'public.compras_separacion_configurar(uuid,boolean,text)'::regprocedure), true,
  '[SEP-2bd] y PUBLIC tampoco');
SELECT public.chk_bool((SELECT count(*) = 8 AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
                          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'public'
                           AND p.proname IN ('compras_tg_config_separacion', 'compras_tg_config_separacion_truncate', 'compras_tg_config_separacion_bitacora',
                                             'compras_tg_config_separacion_bitacora_inmutable', 'compras_separacion_registrar', 'compras_separacion_rechazar',
                                             'compras_separacion_via_rpc', 'compras_separacion_memoria')), true,
  '[SEP-2be] las funciones de trigger y las ayudas internas no se pueden invocar desde la API');
SELECT public.chk_txt((SELECT pg_get_function_arguments(p.oid) FROM pg_proc p WHERE p.oid = 'public.compras_separacion_configurar(uuid,boolean,text)'::regprocedure),
  'p_company_id uuid, p_activa boolean, p_motivo text', '[SEP-2bf] la RPC no recibe actor: solo empresa, valor y motivo (el actor sale de auth.uid() en el servidor)');
SELECT public.chk_bool((SELECT p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
                          FROM pg_proc p WHERE p.oid = 'public.compras_separacion_configurar(uuid,boolean,text)'::regprocedure), true,
  '[SEP-2bg] es SECURITY DEFINER con search_path fijo');
SELECT public.chk((SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.compras_config'::regclass AND NOT tgisinternal
                      AND tgname IN ('trg_compras_00_config_separacion', 'trg_compras_00_config_separacion_truncate', 'trg_zz_compras_config_separacion_bitacora')), 3,
  '[SEP-2bh] compras_config tiene sus tres triggers de la separación, una vez cada uno');
SELECT public.chk_txt((SELECT min(tgname) FROM pg_trigger
                        WHERE tgrelid = 'public.compras_config'::regclass AND NOT tgisinternal AND (tgtype & 1) = 1 AND (tgtype & 2) = 2),
  'trg_compras_00_config_separacion',
  '[SEP-2bi] orden de disparo: el control de la separación es el PRIMER trigger BEFORE de fila (antes de trg_compras_config_touch y de cualquier otro)');
SELECT public.chk_bool((SELECT 'trg_compras_00_config_separacion' < 'trg_compras_config_touch'), true,
  '[SEP-2bi] (el orden de disparo es el alfabético del nombre del trigger)');
SELECT public.chk((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'compras_config_separacion_bitacora'), 1,
  '[SEP-2bj] la bitácora tiene UNA política (SELECT) y ninguna de escritura');
SELECT public.chk_bool((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.compras_config_separacion_bitacora'::regclass), true, '[SEP-2bk] con RLS activa');
SELECT public.chk_bool((SELECT count(*) >= 2 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'compras_config_separacion_bitacora'
                          AND indexname IN ('idx_compras_config_sep_bit_empresa_fecha', 'idx_compras_config_sep_bit_empresa_id')), true,
  '[SEP-2bl] e índices por empresa/fecha y por empresa/id');

-- ═══════════════════════════════════════════════════════════════════════════
-- G · Línea base de la migración: una fila por empresa que YA tenía la separación encendida (la sentencia de la pieza, tal cual)
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.companies (id, nombre, default_currency) VALUES
  ('5e900000-0000-0000-0000-0000000000b1', 'SEP Línea base encendida', 'gtq'),
  ('5e900000-0000-0000-0000-0000000000b2', 'SEP Línea base apagada', 'gtq'),
  ('5e900000-0000-0000-0000-0000000000b3', 'SEP Línea base con bitácora', 'gtq');
-- b1: encendida SIN bitácora (como estaba antes de la migración: se siembra sin pasar por los triggers). b2: apagada. b3: encendida CON bitácora.
SELECT public.como_sistema($$ SET LOCAL session_replication_role = replica; INSERT INTO public.compras_config (company_id, aprobacion_separada)
  VALUES ('5e900000-0000-0000-0000-0000000000b1', true), ('5e900000-0000-0000-0000-0000000000b2', false); SET LOCAL session_replication_role = origin $$);
SELECT public.sep_preparar('5e900000-0000-0000-0000-0000000000b3'::uuid, true);
SELECT public.sep_nbit('5e900000-0000-0000-0000-0000000000b3'::uuid) AS b3_0 \gset
SELECT public.chk(public.sep_nbit('5e900000-0000-0000-0000-0000000000b1'::uuid), 0, '[SEP-2bm] preparación: la empresa encendida de antes no tiene bitácora');
-- (la sentencia de la pieza se ejecuta dos veces a continuación)
INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, motivo, origen)
SELECT c.company_id, NULL, NULL, true,
       'Línea base: la separación solicitante/aprobador ya estaba encendida cuando se creó esta bitácora.', 'linea_base'
  FROM public.compras_config c
 WHERE c.aprobacion_separada
   AND NOT EXISTS (SELECT 1 FROM public.compras_config_separacion_bitacora b WHERE b.company_id = c.company_id);
SELECT public.chk_bool((SELECT count(*) = 1 AND bool_and(valor_anterior IS NULL AND valor_nuevo AND actor_id IS NULL AND origen = 'linea_base')
                          FROM public.compras_config_separacion_bitacora WHERE company_id = '5e900000-0000-0000-0000-0000000000b1'), true,
  '[SEP-2bn] la empresa que ya la tenía encendida recibe UNA fila de línea base (sin antecedente, sin actor)');
SELECT public.chk(public.sep_nbit('5e900000-0000-0000-0000-0000000000b2'::uuid), 0, '[SEP-2bo] la apagada no recibe ninguna');
SELECT public.chk(public.sep_nbit('5e900000-0000-0000-0000-0000000000b3'::uuid), :b3_0, '[SEP-2bp] ni la que ya tenía bitácora (no se pisa su historia)');
INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, motivo, origen)
SELECT c.company_id, NULL, NULL, true,
       'Línea base: la separación solicitante/aprobador ya estaba encendida cuando se creó esta bitácora.', 'linea_base'
  FROM public.compras_config c
 WHERE c.aprobacion_separada
   AND NOT EXISTS (SELECT 1 FROM public.compras_config_separacion_bitacora b WHERE b.company_id = c.company_id);
SELECT public.chk(public.sep_nbit('5e900000-0000-0000-0000-0000000000b1'::uuid), 1, '[SEP-2bq] aplicada una segunda vez no duplica');

-- ── Se deja la configuración como estaba ─────────────────────────────────────
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_preparar(:D::uuid, NULL);
SELECT public.como_sistema($$ INSERT INTO public.compras_config SELECT * FROM sep2_previa $$);
SELECT public.como_sistema($$ DELETE FROM public.companies WHERE id IN ('5e900000-0000-0000-0000-0000000000b1', '5e900000-0000-0000-0000-0000000000b2', '5e900000-0000-0000-0000-0000000000b3') $$);
DROP TABLE sep2_previa;
DROP TABLE sep2_res;
SELECT set_config('request.jwt.claim.sub', '', false);
