\set ON_ERROR_STOP on
-- ============================================================================
-- DATOS COMO PRODUCCIÓN — la migración no cambia una sola fila ni el alcance de nadie
--
-- Compara la instantánea «antes» (la base con la forma de producción, SIN la migración) con la «después» (CON la migración).
-- La forma replica lo leído en producción el 2026-10-10: 43 filas, 27 usuarios, 10 filas huérfanas de 6 usuarios, todas «total»,
-- admin 3/1, operator 14/7, viewer 16/13, un administrador acotado con 3 proyectos, una empresa con 8 proyectos.
-- ============================================================================
SELECT asgt.chk((SELECT filas FROM asgt.snap_tabla WHERE tag = 'antes'), 43, '[datos] antes: 43 filas (la cifra de producción)');
SELECT asgt.chk((SELECT filas FROM asgt.snap_tabla WHERE tag = 'despues'), 43, '[datos] después: 43 filas');
SELECT asgt.chk((SELECT usuarios FROM asgt.snap_tabla WHERE tag = 'despues'), 27, '[datos] 27 user_id distintos');
SELECT asgt.chk((SELECT huerfanas FROM asgt.snap_tabla WHERE tag = 'despues'), 10, '[datos] 10 filas huérfanas se conservan (no se borran ni se arreglan)');
SELECT asgt.chk((SELECT usuarios_huerfanos FROM asgt.snap_tabla WHERE tag = 'despues'), 6, '[datos] … de 6 usuarios que no existen en app_users');
SELECT asgt.chk_txt((SELECT tipos FROM asgt.snap_tabla WHERE tag = 'despues'), 'total', '[datos] todas siguen siendo permission_type = total');
SELECT asgt.chk_txt((SELECT por_rol FROM asgt.snap_tabla WHERE tag = 'despues'), 'admin:3/1, huérfana:10/6, operator:14/7, viewer:16/13',
  '[datos] por rol: administrador 3 filas / 1 persona, operador 14 / 7, visor 16 / 13, huérfanas 10 / 6');
SELECT asgt.chk_txt((SELECT por_rol FROM asgt.snap_tabla WHERE tag = 'antes'), (SELECT por_rol FROM asgt.snap_tabla WHERE tag = 'despues'),
  '[datos] el reparto por rol es el mismo antes y después');
SELECT asgt.chk_txt((SELECT huella_contrato FROM asgt.snap_tabla WHERE tag = 'despues'), (SELECT huella_contrato FROM asgt.snap_tabla WHERE tag = 'antes'),
  '[datos] huella md5 de (id, user_id, project_id, permission_type): IDÉNTICA antes y después');
SELECT asgt.chk_txt((SELECT huella_total FROM asgt.snap_tabla WHERE tag = 'despues'), (SELECT huella_total FROM asgt.snap_tabla WHERE tag = 'antes'),
  '[datos] huella md5 de TODAS las columnas (incluido created_at): IDÉNTICA antes y después');
SELECT asgt.chk((SELECT count(*) FROM public.user_project_assignments u JOIN asgt.snap_filas s USING (id, user_id, project_id, permission_type, created_at)), 43,
  '[datos] las 43 filas coinciden una a una con la copia original (mismo id, persona, proyecto, permission_type y created_at)');
SELECT asgt.chk((SELECT count(*) FROM asgt.snap_personas WHERE tag = 'antes'), 39, '[datos] la instantánea cubre 39 personas (33 con sesión + 6 huérfanas)');
SELECT asgt.chk((SELECT count(*) FROM asgt.snap_personas a JOIN asgt.snap_personas d ON d.alias = a.alias AND d.tag = 'despues'
                  WHERE a.tag = 'antes' AND a.exento IS DISTINCT FROM d.exento), 0,
  '[datos] user_is_project_exempt() devuelve LO MISMO para las 39 personas antes y después (0 diferencias)');
SELECT asgt.chk((SELECT count(*) FROM asgt.snap_personas a JOIN asgt.snap_personas d ON d.alias = a.alias AND d.tag = 'despues'
                  WHERE a.tag = 'antes' AND a.alcance IS DISTINCT FROM d.alcance), 0,
  '[datos] can_access_project() devuelve LO MISMO para las 39 personas × 10 proyectos = 390 pares antes y después (0 diferencias)');
SELECT asgt.chk((SELECT count(*) FROM asgt.snap_personas a JOIN asgt.snap_personas d ON d.alias = a.alias AND d.tag = 'despues'
                  WHERE a.tag = 'antes' AND a.visibles IS DISTINCT FROM d.visibles), 0,
  '[datos] lo que cada persona LEE de la tabla (política SELECT) es lo mismo antes y después (0 diferencias en 39 personas)');
SELECT asgt.chk_txt((SELECT string_agg(alias || '=' || exento::text, ',' ORDER BY alias) FROM asgt.snap_personas
                      WHERE tag = 'despues' AND alias IN ('AP', 'AX', 'AX2', 'DAD', 'OW', 'SU', 'OP1', 'VW1')),
  'AP=false,AX=true,AX2=true,DAD=true,OP1=false,OW=true,SU=true,VW1=false',
  '[datos] el administrador acotado (AP) sigue sin ser exento; los exentos siguen exentos; operadores y visores no');
SELECT asgt.chk_txt((SELECT alcance FROM asgt.snap_personas WHERE tag = 'despues' AND alias = 'AP'), 'P1,P2,P3', '[datos] AP alcanza exactamente P1, P2 y P3');
SELECT asgt.chk_txt((SELECT alcance FROM asgt.snap_personas WHERE tag = 'despues' AND alias = 'OP7'), 'P7,P8', '[datos] OP7 alcanza exactamente P7 y P8');
SELECT asgt.chk_txt((SELECT alcance FROM asgt.snap_personas WHERE tag = 'despues' AND alias = 'NUEVO'), '', '[datos] una persona sin filas no alcanza ninguno');
