\set ON_ERROR_STOP on
-- ============================================================================
-- DEFENSA EN PROFUNDIDAD — los dos triggers cierran el hueco AUNQUE una política permisiva futura lo reabra
--
-- Se simula el error que ya ocurrió una vez (la política de escritura vuelve a ser demasiado amplia): las tres políticas de escritura
-- se sustituyen, dentro de una transacción que se DESHACE al final, por `true`. Sin los triggers, cada una de estas sesiones
-- escribiría lo que quiere. Con ellos:
--   · trg_asignacion_propia   (autoasignación)  → nadie, salvo propietario y superadministrador, toca sus propias filas;
--   · trg_asignacion_empresa  (integridad)      → persona y proyecto son de la misma empresa para TODO actor.
-- Límite que se documenta: los triggers NO son una capa de autorización; con la política permisiva, asignar a OTRA persona de la misma
-- empresa ya no lo frena nadie. Por eso las políticas con asignacion_puede_administrar() son la primera línea.
-- ============================================================================
BEGIN;
DROP POLICY "user_project_assignments_insert" ON public.user_project_assignments;
DROP POLICY "user_project_assignments_update" ON public.user_project_assignments;
DROP POLICY "user_project_assignments_delete" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_insert" ON public.user_project_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "user_project_assignments_update" ON public.user_project_assignments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "user_project_assignments_delete" ON public.user_project_assignments FOR DELETE TO authenticated USING (true);

SELECT asgt.chk((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass
                  AND (polqual IS NOT NULL OR polwithcheck IS NOT NULL)
                  AND pg_get_expr(COALESCE(polqual, polwithcheck), polrelid) = 'true'), 3,
  '[defensa] montaje: las 3 políticas de escritura (insert, update, delete) son `true`: más amplias que el hueco original');

-- autoasignación: lo frena el trigger
SELECT asgt.err_propia('[defensa] operador: no se asigna otro proyecto', 'OP1', asgt.ins('OP1', 'P3'));
SELECT asgt.err_propia('[defensa] visor: no se asigna otro proyecto', 'VW4', asgt.ins('VW4', 'P8'));
SELECT asgt.err_propia('[defensa] administrador acotado: no se asigna otro proyecto', 'AP', asgt.ins('AP', 'P4'));
SELECT asgt.err_propia('[defensa] administrador exento: no se asigna ni el primero', 'AX', asgt.ins('AX', 'P1'));
SELECT asgt.err_propia('[defensa] administrador acotado: la política `true` le dejaría borrar las suyas; el trigger BEFORE DELETE no', 'AP', asgt.borrar_de('AP'));
SELECT asgt.err_propia('[defensa] … ni cambiarlas de proyecto', 'AP', asgt.mover('AP', 'P3', 'P4'));
SELECT asgt.err_propia('[defensa] … ni cambiar su permission_type', 'AP', asgt.permiso('AP', 'P3', 'lectura'));
SELECT asgt.err_propia('[defensa] … ni dejar a su nombre la fila de otra persona', 'AP',
  $q$UPDATE public.user_project_assignments SET user_id = {AP}, project_id = {P8} WHERE user_id = {OP1} AND project_id = {P1}$q$);
SELECT asgt.err_propia('[defensa] operador: no borra las suyas (la política `true` lo dejaría)', 'OP1', asgt.borrar_de('OP1'));
-- F-08 · UNA sola fila propia con otras restantes: la excepción de la baja en cascada exige que el PROYECTO YA NO EXISTA. Un borrado directo de la fila
-- (el proyecto existe) se rechaza aunque le queden otras. Sin esto, quitar esa condición dejaba pasar el DELETE de una fila propia mientras quedara otra.
SELECT asgt.err_propia('[defensa] administrador acotado (P1, P2, P3): borrar UNA sola fila propia (le quedan otras) tampoco; la cascada sólo vale si el proyecto ya no existe', 'AP',
  asgt.borrar_fila('AP', 'P3'));
SELECT asgt.err_propia('[defensa] … ni dos de sus tres filas (le queda una)', 'AP',
  $q$DELETE FROM public.user_project_assignments WHERE user_id = {AP} AND project_id IN ({P2}, {P3})$q$);
-- F3 · una sesión SIN fila en app_users (current_user_role() NULL) con filas a su nombre: sin COALESCE el IF del trigger daba NULL y no levantaba
SELECT asgt.err_propia('[defensa · F3] sesión sin app_users (rol NULL): no borra las filas a su nombre aunque la política `true` lo dejaría', 'ORF1', asgt.borrar_de('ORF1'));
SELECT asgt.err_propia('[defensa · F3] … ni cambia su permission_type', 'ORF1', asgt.permiso('ORF1', 'P1', 'lectura'));
SELECT asgt.err_propia('[defensa] el UPSERT sobre la propia tampoco', 'OP1',
  asgt.ins('OP1', 'P1') || $q$ ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = 'lectura'$q$);
SELECT asgt.err_propia('[defensa] el administrador de otra empresa tampoco', 'DAD', asgt.ins('DAD', 'D1'));
-- los que SÍ pueden sobre sí mismos
SELECT asgt.ok('[defensa] el propietario sí (es exento)', 'OW', asgt.ins('OW', 'P1'), p_efecto_sql => $q$SELECT asgt.filas_de({OW})$q$, p_efecto => 'P1');
SELECT asgt.ok('[defensa] el superadministrador sí', 'SU', asgt.ins('SU', 'P1'));
SELECT asgt.ok('[defensa] el rol de servicio sí (sin auth.uid() el trigger no interviene)', 'SERVICIO', asgt.ins('OP1', 'P5'));

-- integridad: lo frena el trigger de empresa, para todos
SELECT asgt.err_empresa('[defensa] operador: no se asigna un proyecto de otra empresa', 'OP1', asgt.ins('OP1', 'D1'));
SELECT asgt.err_empresa('[defensa] administrador: no asigna a una persona de otra empresa a un proyecto suyo', 'AP', asgt.ins('DOP', 'P1'));
SELECT asgt.err_empresa('[defensa] … ni a una de C a un proyecto de otra empresa', 'AX', asgt.ins('NUEVO', 'D1'));
SELECT asgt.err_empresa('[defensa] … ni a una huérfana', 'AX', asgt.ins('ORF1', 'P1'));
SELECT asgt.err_empresa('[defensa] … ni a un cliente (sin empresa)', 'OW', asgt.ins('CLI', 'P1'));
SELECT asgt.err_empresa('[defensa] … ni a una sesión sin app_users', 'OW', asgt.ins('SINAPP', 'P1'));
SELECT asgt.err_empresa('[defensa] … ni mover la fila de una persona a un proyecto de otra empresa', 'OW', asgt.mover('OP4', 'P4', 'D1'));
SELECT asgt.err_empresa('[defensa] el superadministrador tampoco cruza empresas', 'SU', asgt.ins('OP1', 'D1'));
SELECT asgt.err_empresa('[defensa] el rol de servicio tampoco', 'SERVICIO', asgt.ins('OP1', 'D1'));
SELECT asgt.err_empresa('[defensa] el superusuario tampoco', 'SISTEMA', asgt.ins('OP1', 'D1'));

-- el límite, dicho con claridad
SELECT asgt.ok('[defensa · LÍMITE] con la política `true`, un operador asigna a OTRA persona de su empresa: los triggers no son autorización', 'OP1',
  asgt.ins('NUEVO', 'P1'), p_efecto_sql => $q$SELECT asgt.filas_de({NUEVO})$q$, p_efecto => 'P1');
ROLLBACK;

-- F3 con la forma exacta del hallazgo: las políticas VERDADERAS más una permisiva futura «zz» (FOR ALL TO authenticated USING (true) WITH CHECK (true))
BEGIN;
CREATE POLICY zz ON public.user_project_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
SELECT asgt.chk((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass), 5,
  '[defensa · zz] montaje: las 4 políticas verdaderas más la permisiva «zz» (5)');
SELECT asgt.err_propia('[defensa · zz] sesión de un user_id huérfano (sin app_users, rol NULL): DELETE de sus filas', 'ORF1', asgt.borrar_de('ORF1'));
SELECT asgt.err_propia('[defensa · zz] … y UPDATE de su permission_type', 'ORF1', asgt.permiso('ORF1', 'P1', 'lectura'));
SELECT asgt.err_propia('[defensa · zz] administrador acotado: borrar UNA de sus filas con «zz» presente', 'AP', asgt.borrar_fila('AP', 'P3'));
ROLLBACK;

-- las políticas verdaderas volvieron (el montaje no se filtró)
SELECT asgt.chk((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass
                  AND COALESCE(pg_get_expr(polqual, polrelid), '') || COALESCE(pg_get_expr(polwithcheck, polrelid), '') ~ 'asignacion_puede_administrar'), 3,
  '[defensa] tras el ROLLBACK las 3 políticas de escritura vuelven a usar asignacion_puede_administrar()');
SELECT asgt.chk((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass), 4, '[defensa] y la política «zz» no se filtró: siguen las 4 de siempre');
SELECT asgt.chk((SELECT count(*) FROM asgt.fallos), 0, '[defensa] ningún veredicto fallido anotado');
