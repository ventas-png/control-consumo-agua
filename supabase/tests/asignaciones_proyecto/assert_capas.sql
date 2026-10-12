\set ON_ERROR_STOP on
-- ============================================================================
-- CAPAS INDEPENDIENTES — las POLÍTICAS, solas, ya cierran el hueco (sin ayuda de los triggers)
--
-- assert_defensa.sql prueba la otra mitad: los triggers solos (con una política permisiva). Aquí, dentro de una transacción que se
-- DESHACE, se quitan los dos triggers y se comprueba que sólo con las políticas nuevas:
--   · nadie se asigna, cambia ni borra lo suyo (salvo propietario y superadministrador);
--   · un administrador/propietario no asigna entre empresas ni a quien no es de su empresa (huérfanas, sin empresa, otra empresa).
-- Esto es lo que hace que revertir UNA política (o la regla) ponga rojo algo aunque los triggers sigan puestos.
-- Decisión del dueño del negocio (2026-10-11): sólo el PRINCIPAL (propietario o superadministrador) escribe la tabla; un administrador, acotado o exento, no escribe NADA, y eso lo
-- decide la política (la regla), no un trigger.
-- Lo que las políticas solas NO cubren, y sólo cubre el trigger de integridad: el superadministrador y el rol de servicio cruzando
-- empresas (la regla les concede todo por diseño).
-- ============================================================================
BEGIN;
DROP TRIGGER trg_asignacion_empresa ON public.user_project_assignments;
DROP TRIGGER trg_asignacion_propia ON public.user_project_assignments;
SELECT asgt.chk((SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.user_project_assignments'::regclass AND NOT tgisinternal), 0,
  '[capas] montaje: sin ningún trigger, sólo las políticas');

-- autoasignación: la política (WITH CHECK / USING) por sí sola
SELECT asgt.err_rls('[capas] política sola: el operador no se asigna otro proyecto', 'OP1', asgt.ins('OP1', 'P3'));
SELECT asgt.err_rls('[capas] … ni el visor', 'VW4', asgt.ins('VW4', 'P8'));
SELECT asgt.err_rls('[capas] … ni el administrador acotado', 'AP', asgt.ins('AP', 'P4'));
SELECT asgt.err_rls('[capas] … ni el exento', 'AX', asgt.ins('AX', 'P1'));
SELECT asgt.err_rls('[capas] … ni el administrador de otra empresa', 'DAD', asgt.ins('DAD', 'D1'));
SELECT asgt.cero('[capas] … el administrador acotado no borra las suyas', 'AP', asgt.borrar_de('AP'),
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => 'P1,P2,P3|false');
SELECT asgt.cero('[capas] … ni las cambia de proyecto', 'AP', asgt.mover('AP', 'P3', 'P4'));
SELECT asgt.cero('[capas] … ni cambia su permission_type', 'AP', asgt.permiso('AP', 'P3', 'lectura'));
SELECT asgt.cero('[capas] … ni deja a su nombre la fila de otra persona (el USING de la fila vieja la filtra: 0 filas)', 'AP',
  $q$UPDATE public.user_project_assignments SET user_id = {AP}, project_id = {P8} WHERE user_id = {OP1} AND project_id = {P1}$q$);
SELECT asgt.cero('[capas] … el operador no borra las suyas', 'OP1', asgt.borrar_de('OP1'));
SELECT asgt.cero('[capas] … ni las cambia', 'OP1', asgt.mover('OP1', 'P1', 'P3'));
SELECT asgt.cero('[capas] … ni pasa su fila a otra persona', 'VW4', asgt.pasar_a('VW4', 'P5', 'NUEVO'));
SELECT asgt.err_rls('[capas] … el UPSERT sobre la propia (WITH CHECK del insert)', 'OP1',
  asgt.ins('OP1', 'P1') || $q$ ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = 'lectura'$q$);

-- entre empresas y personas que no son de la empresa: la política (la regla) por sí sola
SELECT asgt.err_rls('[capas] política sola: el administrador no asigna a una persona de otra empresa a un proyecto suyo', 'AP', asgt.ins('DOP', 'P1'));
SELECT asgt.err_rls('[capas] … ni a una persona de C a un proyecto de otra empresa', 'AP', asgt.ins('NUEVO', 'D1'));
SELECT asgt.err_rls('[capas] … ni el exento', 'AX', asgt.ins('OP1', 'D1'));
SELECT asgt.err_rls('[capas] … ni a una huérfana', 'AP', asgt.ins('ORF1', 'P3'));
SELECT asgt.err_rls('[capas] … ni el propietario a una huérfana', 'OW', asgt.ins('ORF1', 'P3'));
SELECT asgt.err_rls('[capas] … ni a un cliente (sin empresa)', 'OW', asgt.ins('CLI', 'P1'));
SELECT asgt.err_rls('[capas] … ni a una sesión sin app_users', 'AX', asgt.ins('SINAPP', 'P1'));
SELECT asgt.err_rls('[capas] … ni el administrador de otra empresa a una persona de C', 'DAD', asgt.ins('OP1', 'P3'));
SELECT asgt.err_rls('[capas] … ni mover la fila de una persona a un proyecto de otra empresa', 'OW', asgt.mover('OP4', 'P4', 'D1'));
SELECT asgt.err_rls('[capas] … ni un administrador acotado reparte un proyecto de su empresa que no ve', 'AP', asgt.ins('NUEVO', 'P4'));
-- el principal es el único que escribe: las políticas solas dejan al propietario y al superadministrador y rechazan a todo administrador (acotado o exento)
SELECT asgt.err_rls('[capas] política sola: un administrador acotado NO asigna ni un proyecto que ve (OP1 → P3)', 'AP', asgt.ins('OP1', 'P3'));
SELECT asgt.err_rls('[capas] … ni el exento (AX)', 'AX', asgt.ins('OP1', 'P3'));
SELECT asgt.err_rls('[capas] … ni a otro administrador (AP → AX2 → P2)', 'AP', asgt.ins('AX2', 'P2'));
SELECT asgt.cero('[capas] … ni borra las filas de otra persona de sus proyectos (OP1)', 'AP', asgt.borrar_de('OP1'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2');
SELECT asgt.cero('[capas] … ni las cambia (el exento tampoco)', 'AX', asgt.permiso('OP1', 'P1', 'lectura'));
SELECT asgt.err_rls('[capas] … ni un operador con el rol RBAC «Admin Plataforma»', 'OP2', asgt.ins('NUEVO', 'P1'),
  p_preparar => $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({OP2}, '00000000-0000-0000-0000-000000000201')$q$);
SELECT asgt.err_rls('[capas] política sola: ni el propietario asigna a una persona de SU empresa un proyecto de OTRA empresa (OP1 → D1): la regla exige el proyecto de su empresa', 'OW', asgt.ins('OP1', 'D1'));
SELECT asgt.ok('[capas] política sola: el propietario SÍ asigna a una persona de su empresa (OP1 → P3)', 'OW', asgt.ins('OP1', 'P3'), 1,
  p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2,P3');
SELECT asgt.ok('[capas] … y acota a un administrador exento (AX2 → P2)', 'OW', asgt.ins('AX2', 'P2'), 1);
SELECT asgt.ok('[capas] … y el superadministrador, también de otra empresa (OP1 → P3)', 'SU2', asgt.ins('OP1', 'P3'), 1);
SELECT asgt.err_rls('[capas] … pero el propietario de OTRA empresa no (DOW no asigna a OP1)', 'DOW', asgt.ins('OP1', 'P3'));
SELECT asgt.cero('[capas] … ni el administrador acotado borra las filas de lo que no ve', 'AP', asgt.borrar_de('OP4'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP4})$q$, p_efecto => 'P4,P5');
SELECT asgt.cero('[capas] … ni borra huérfanas', 'OW', asgt.borrar_de('ORF2'));

-- lo que las políticas solas permiten y sólo el trigger de integridad impide
SELECT asgt.ok('[capas · LÍMITE] sin el trigger de integridad el superadministrador SÍ cruza empresas (la regla se lo concede): por eso existe el trigger', 'SU',
  asgt.ins('OP1', 'D1'), p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'D1,P1,P2');
ROLLBACK;

SELECT asgt.chk((SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.user_project_assignments'::regclass AND NOT tgisinternal
                  AND tgname IN ('trg_asignacion_empresa', 'trg_asignacion_propia')), 2,
  '[capas] tras el ROLLBACK los dos triggers vuelven a estar');
