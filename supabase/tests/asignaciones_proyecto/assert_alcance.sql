\set ON_ERROR_STOP on
-- ============================================================================
-- EFECTO SOBRE EL ALCANCE — can_access_project() / user_is_project_exempt()
--
-- La razón de ser del cambio: como esas dos funciones leen user_project_assignments, quien podía escribir sus propias filas ampliaba su
-- alcance, y un administrador con asignaciones que las borrara quedaba «exento» (ve toda la empresa). Aquí se intenta, con las 29 personas
-- que no son propietario ni superadministrador, TODO lo que ampliaría el alcance propio, y se comprueba que el alcance no se movió.
-- ============================================================================

-- ═══ 1 · ninguna persona se asigna un proyecto: 29 personas × 10 proyectos = 290 intentos ═════════════════════════════
DO $$
DECLARE
  r record;  p record;
  v_intentos int := 0;  v_bloqueados int := 0;  v_empresa int := 0;  v_propia int := 0;  v_rls int := 0;
  v_alcances_antes text;  v_alcances_despues text;
  v_h0 text := asgt.huella_total();
BEGIN
  SELECT string_agg(i.alias || '=' || asgt.alcance(i.id) || '/' || asgt.exento(i.id)::text, ';' ORDER BY i.alias) INTO v_alcances_antes
    FROM asgt.ids i WHERE i.tipo = 'persona';
  FOR r IN SELECT alias, id FROM asgt.ids WHERE tipo = 'persona' AND alias NOT IN ('SU', 'SU2', 'OW', 'DOW') ORDER BY alias LOOP
    FOR p IN SELECT alias, id FROM asgt.ids WHERE tipo = 'proyecto' ORDER BY alias LOOP
      v_intentos := v_intentos + 1;
      BEGIN
        PERFORM asgt.poner_actor(r.alias);
        INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (r.id, p.id, 'total');
        PERFORM asgt.poner_actor('SISTEMA');
        RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'se pudo';
      EXCEPTION
        WHEN SQLSTATE 'AS999' THEN
          PERFORM asgt.poner_actor('SISTEMA');
          RAISE EXCEPTION '✗ % se asignó a sí mismo el proyecto %', r.alias, p.alias;
        WHEN SQLSTATE '23514' THEN v_bloqueados := v_bloqueados + 1; v_empresa := v_empresa + 1;
        WHEN SQLSTATE '42501' THEN
          v_bloqueados := v_bloqueados + 1;
          IF SQLERRM ~ 'ASIGNACION_PROPIA_NO_PERMITIDA' THEN v_propia := v_propia + 1; ELSE v_rls := v_rls + 1; END IF;
      END;
    END LOOP;
  END LOOP;
  PERFORM asgt.poner_actor('SISTEMA');
  PERFORM asgt.chk(v_intentos, 290, '[alcance 1] intentos de autoasignación (29 personas × 10 proyectos)');
  PERFORM asgt.chk(v_bloqueados, 290, '[alcance 1] intentos BLOQUEADOS con 42501/23514 (ninguno triunfó, ninguno falló por otra causa)');
  RAISE NOTICE '  · reparto del bloqueo: % por integridad de empresa, % por el trigger de autoasignación, % por la política', v_empresa, v_propia, v_rls;
  PERFORM asgt.chk_txt(asgt.huella_total(), v_h0, '[alcance 1] la tabla quedó idéntica (mismas filas, ids y created_at)');
  SELECT string_agg(i.alias || '=' || asgt.alcance(i.id) || '/' || asgt.exento(i.id)::text, ';' ORDER BY i.alias) INTO v_alcances_despues
    FROM asgt.ids i WHERE i.tipo = 'persona';
  PERFORM asgt.chk_bool(v_alcances_despues = v_alcances_antes, true, '[alcance 1] el alcance (can_access_project × 10 proyectos + user_is_project_exempt) de las 33 personas no se movió');
END $$;

-- ═══ 2 · ninguna persona cambia ni borra las suyas: 21 personas con filas × 4 intentos = 84 ══════════════════════════
DO $$
DECLARE
  r record;
  v_intentos int := 0;  v_ceros int := 0;  v_n bigint;
  v_h0 text := asgt.huella_total();
  v_q text;
BEGIN
  FOR r IN SELECT i.alias, i.id FROM asgt.ids i
            WHERE i.tipo = 'persona' AND EXISTS (SELECT 1 FROM public.user_project_assignments u WHERE u.user_id = i.id) ORDER BY i.alias LOOP
    FOREACH v_q IN ARRAY ARRAY[
      format('DELETE FROM public.user_project_assignments WHERE user_id = %L', r.id),
      format('UPDATE public.user_project_assignments SET project_id = %L WHERE user_id = %L', asgt.pid_de(8), r.id),
      format('UPDATE public.user_project_assignments SET permission_type = %L WHERE user_id = %L', 'lectura', r.id),
      format('UPDATE public.user_project_assignments SET user_id = %L WHERE user_id = %L', asgt.uid_de(8), r.id)
    ] LOOP
      v_intentos := v_intentos + 1;
      BEGIN
        PERFORM asgt.poner_actor(r.alias);
        EXECUTE v_q;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        PERFORM asgt.poner_actor('SISTEMA');
        IF v_n = 0 THEN v_ceros := v_ceros + 1;
        ELSE RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = format('%s afectó %s filas con «%s»', r.alias, v_n, v_q);
        END IF;
      EXCEPTION
        WHEN SQLSTATE 'AS999' THEN
          PERFORM asgt.poner_actor('SISTEMA');
          RAISE EXCEPTION '✗ %', SQLERRM;
      END;
    END LOOP;
  END LOOP;
  PERFORM asgt.poner_actor('SISTEMA');
  PERFORM asgt.chk(v_intentos, 84, '[alcance 2] intentos de borrar/cambiar las propias (21 personas × 4)');
  PERFORM asgt.chk(v_ceros, 84, '[alcance 2] todos afectaron 0 filas (y, como SISTEMA, las mismas sentencias sí tienen filas que afectar: ver [alcance 2b])');
  PERFORM asgt.chk_txt(asgt.huella_total(), v_h0, '[alcance 2] la tabla quedó idéntica');
  -- el control de que el 0 no es un WHERE equivocado: las 21 personas tienen filas (≥ 1) y el SISTEMA sí puede borrarlas
  PERFORM asgt.chk((SELECT count(*) FROM asgt.ids i WHERE i.tipo = 'persona'
                      AND EXISTS (SELECT 1 FROM public.user_project_assignments u WHERE u.user_id = i.id)), 21,
                   '[alcance 2b] control: las 21 personas probadas SÍ tienen filas que borrar');
END $$;

-- ═══ 3 · un administrador acotado no se vuelve exento, ni borrando ni de ningún otro modo ═══════════════════════════
SELECT asgt.cero('[alcance 3] AP no se vuelve exento borrando sus 3 filas', 'AP', asgt.borrar_de('AP'),
  p_efecto_sql => $q$SELECT asgt.exento({AP})::text || '|' || asgt.alcance({AP})$q$, p_efecto => 'false|P1,P2,P3');

-- Borrar un proyecto al que se está asignado: la baja EN CASCADA de la fila propia se permite mientras quede otra asignación (el alcance
-- sólo se reduce; es un flujo legítimo del servidor) y se rechaza si fuera la ÚLTIMA (el administrador quedaría exento).
SELECT asgt.err_propia('[alcance 3] AP (con sólo P1) no borra el proyecto P1 por la API: la cascada quitaría su última fila y lo volvería exento', 'AP',
  $q$DELETE FROM public.projects WHERE id = {P1}$q$,
  p_preparar => $q$DELETE FROM public.user_project_assignments WHERE user_id = {AP} AND project_id <> {P1}$q$);
SELECT asgt.ok('[alcance 3] AP (P1, P2, P3) SÍ borra el proyecto P1: la cascada le quita esa fila, conserva P2 y P3 y SIGUE acotado', 'AP',
  $q$DELETE FROM public.projects WHERE id = {P1}$q$, 1,
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => 'P2,P3|false');
SELECT asgt.ok('[alcance 3] … y dos a la vez (P1 y P2), mientras le quede P3', 'AP',
  $q$DELETE FROM public.projects WHERE id IN ({P1}, {P2})$q$, 2,
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => 'P3|false');
SELECT asgt.err_propia('[alcance 3] pero no los dos únicos que tiene en una sola sentencia (se quedaría sin filas): no se borra ninguno', 'AP',
  $q$DELETE FROM public.projects WHERE id IN ({P1}, {P2})$q$,
  p_preparar => $q$DELETE FROM public.user_project_assignments WHERE user_id = {AP} AND project_id = {P3}$q$);
SELECT asgt.ok('[alcance 3] el propietario SÍ puede borrar P1 (cascada incluida) y AP queda sin filas → exento: decisión del propietario, no de AP', 'OW',
  $q$DELETE FROM public.projects WHERE id = {P1}$q$, 1,
  p_efecto_sql => $q$SELECT asgt.exento({AP})::text || '|' || (SELECT count(*) FROM public.user_project_assignments WHERE project_id = {P1})$q$, p_efecto => 'true|0',
  p_preparar => $q$DELETE FROM public.user_project_assignments WHERE user_id = {AP} AND project_id <> {P1}$q$);

-- ═══ 4 · efecto sobre can_access_project: quien recibe un proyecto de OTRA persona lo alcanza; quien lo intenta solo, no ═══
SELECT asgt.ok('[alcance 4] un administrador le da P3 a OP1: ahora OP1 SÍ alcanza P3', 'AX', asgt.ins('OP1', 'P3'),
  p_efecto_sql => $q$SELECT asgt.puede({OP1}, {P3})::text$q$, p_efecto => 'true');
SELECT asgt.err_propia('[alcance 4] OP1 intenta dárselo solo: no, y sigue SIN alcanzarlo', 'OP1', asgt.ins('OP1', 'P3'));
SELECT asgt.cero('[alcance 4] OP1 no puede quitarse el que tiene', 'OP1', asgt.borrar_fila('OP1', 'P1'),
  p_efecto_sql => $q$SELECT asgt.puede({OP1}, {P1})::text$q$, p_efecto => 'true');
DO $$
BEGIN
  PERFORM asgt.chk_bool(asgt.puede(asgt.uid_de(21), asgt.pid_de(3)), false, '[alcance 4] control final: OP1 no alcanza P3 (nada de lo anterior quedó escrito)');
  PERFORM asgt.chk_bool(asgt.puede(asgt.uid_de(21), asgt.pid_de(1)), true,  '[alcance 4] control final: OP1 sigue alcanzando P1');
  PERFORM asgt.chk_bool(asgt.exento(asgt.uid_de(6)), false, '[alcance 4] control final: AP sigue sin ser exento');
  PERFORM asgt.chk_bool(asgt.exento(asgt.uid_de(5)), true,  '[alcance 4] control final: AX (sin filas) sigue siendo exento');
END $$;

-- ═══ 5 · OTROS CAMINOS hacia el mismo efecto (se buscaron; no se corrigen aquí) ══════════════════════════════════════
-- a · cambiarse el rol / la empresa / el proyecto principal en app_users (user_has_project_access lee app_users.project_id)
SELECT asgt.ok('[otros caminos] OP1 se «promueve» en app_users: el trigger lock_app_users_self_privilege revierte rol, empresa, proyecto principal y activo', 'OP1',
  $q$UPDATE public.app_users SET role = 'company_owner', company_id = {D}, project_id = {P8}, activo = false, permission_type = 'financiero' WHERE id = {OP1}$q$, 1,
  p_efecto_sql => $q$SELECT role || '|' || company_id::text || '|' || COALESCE(project_id::text, '-') || '|' || activo::text || '|' || COALESCE(permission_type, '-')
                       FROM public.app_users WHERE id = {OP1}$q$,
  p_efecto => 'operator|a5c00000-0000-0000-0000-000000000001|-|true|-');
SELECT asgt.ok('[otros caminos] AP tampoco: sigue siendo admin de C, con su alcance', 'AP',
  $q$UPDATE public.app_users SET role = 'company_owner', project_id = {P8} WHERE id = {AP}$q$, 1,
  p_efecto_sql => $q$SELECT role || '|' || COALESCE(project_id::text, '-') || '|' || asgt.exento({AP})::text FROM public.app_users WHERE id = {AP}$q$,
  p_efecto => 'admin|-|false');
-- b · crear un proyecto nuevo en su empresa no le da acceso a él (no hay asignación automática)
SELECT asgt.ok('[otros caminos] AP crea un proyecto en su empresa: no lo alcanza (sin asignación) y no puede asignárselo', 'AP',
  $q$INSERT INTO public.projects (id, company_id, nombre) VALUES ('a5d00000-0000-0000-0000-0000000000f1', {C}, 'ASG proyecto nuevo de AP')$q$, 1,
  p_efecto_sql => $q$SELECT asgt.puede({AP}, 'a5d00000-0000-0000-0000-0000000000f1'::uuid)::text$q$, p_efecto => 'false',
  p_preparar => 'SET session_replication_role = replica');
