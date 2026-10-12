\set ON_ERROR_STOP on
-- ============================================================================
-- FLUJOS DE ADMINISTRACIÓN — lo que hace la pantalla «Asignar Acceso a Proyectos» (AsignacionModal)
--
-- DECISIÓN DEL DUEÑO DEL NEGOCIO (2026-10-11): sólo el PRINCIPAL de la empresa (propietario o superadministrador) escribe las asignaciones. Los flujos 3, 4, 6 y 8 (propietario,
-- superadministrador, propietario de otra empresa, otra empresa) dan lo MISMO que sin la migración; los de actor ADMINISTRADOR (1, 2, 5 y 9) pasan de «lo hace» a «el servidor lo
-- rechaza» (INSERT: 42501 por la política; DELETE y UPDATE: 0 filas SIN error) y el [flujo 7] de la autoedición ya cambió con la 0600. run.sh compara estos 28 resultados antes y
-- después de la migración y exige exactamente esos 18 cambios (13 de actor administrador + 5 de autoedición).
--
-- asgt.modal(actor, persona, proyectos, modo) devuelve «proyectos finales | resultado | filas conservadas tal cual (mismo id y created_at)»:
--   · 'legado'      el guardado de hoy: borra TODAS las de la persona y vuelve a insertar las marcadas (dos peticiones)
--   · 'diferencias' el guardado nuevo: inserta las que faltan y borra SÓLO las que sobran (y que el actor ve)
-- La base queda como estaba después de cada flujo.
-- ============================================================================

-- ═══ 1 · el reemplazo completo, por rol, sobre OTRAS personas de su empresa ══════════════════════════════════════
-- (antes de la decisión del 2026-10-11 estos diez flujos terminaban en «ok» y reemplazaban las asignaciones; ahora la persona se queda como estaba)
SELECT asgt.chk_txt(asgt.modal('AX', 'OP1', ARRAY['P4','P5','P6'], 'legado'),      'P1,P2|42501|2', '[flujo 1] administrador exento reemplaza (borrar todas + insertar): OP1 {P1,P2} → {P4,P5,P6}: el DELETE afecta 0 filas y el INSERT lo rechaza la política');
SELECT asgt.chk_txt(asgt.modal('AX', 'OP1', ARRAY['P4','P5','P6'], 'diferencias'), 'P1,P2|42501|2', '[flujo 1] … y por diferencias: el insert falla y no se borra nada');
SELECT asgt.chk_txt(asgt.modal('AP', 'OP2', ARRAY['P1','P3'], 'legado'),           'P2,P3|42501|2', '[flujo 2] administrador ACOTADO reemplaza a OP2 con proyectos que él ve: {P2,P3} → {P1,P3}: tampoco');
SELECT asgt.chk_txt(asgt.modal('AP', 'OP2', ARRAY['P1','P3'], 'diferencias'),      'P2,P3|42501|2', '[flujo 2] … por diferencias la fila P3 que no cambia se CONSERVA (mismo id y created_at), y la persona sigue como estaba');
SELECT asgt.chk_txt(asgt.modal('AX', 'OP1', ARRAY['P1','P2','P6'], 'legado'),      'P1,P2|42501|2', '[flujo 1] borrar todas + insertar (con las filas que no cambiaron) tampoco');
SELECT asgt.chk_txt(asgt.modal('AX', 'OP1', ARRAY['P1','P2','P6'], 'diferencias'), 'P1,P2|42501|2', '[flujo 1] por diferencias tampoco: sólo había que insertar P6');
SELECT asgt.chk_txt(asgt.modal('AP', 'OP3', ARRAY['P1'], 'legado'),                'P3,P4|42501|2', '[flujo 2] el administrador acotado no cambia a OP3 {P3,P4} → {P1}: ni lo que ve (P3) ni lo que no ve (P4)');
SELECT asgt.chk_txt(asgt.modal('AP', 'OP3', ARRAY['P1'], 'diferencias'),           'P3,P4|42501|2', '[flujo 2] … también por diferencias');
SELECT asgt.chk_txt(asgt.modal('AP', 'OP2', ARRAY[]::text[], 'legado'),            'P2,P3|ok|2',    '[flujo 2] quitar todas las de OP2: el DELETE afecta 0 filas SIN error (la pantalla debe leer de vuelta) y la persona conserva sus 2 proyectos');
SELECT asgt.chk_txt(asgt.modal('AP', 'OP2', ARRAY[]::text[], 'diferencias'),       'P2,P3|ok|2',    '[flujo 2] … por diferencias, igual');
SELECT asgt.chk_txt(asgt.modal('OW', 'NUEVO', ARRAY['P1','P2','P3','P4','P5','P6','P7','P8'], 'legado'), 'P1,P2,P3,P4,P5,P6,P7,P8|ok|0', '[flujo 3] propietario asigna los 8 proyectos a una persona sin filas');
SELECT asgt.chk_txt(asgt.modal('OW', 'OP4', ARRAY['P5'], 'diferencias'),           'P5|ok|1',       '[flujo 3] propietario quita uno por diferencias (OP4 {P4,P5} → {P5}); la fila P5 se conserva');
SELECT asgt.chk_txt(asgt.modal('OW', 'OW', ARRAY['P2','P3'], 'legado'),            'P2,P3|ok|0',    '[flujo 3] propietario sobre SÍ MISMO (es exento: su alcance no cambia)');
SELECT asgt.chk_txt(asgt.modal('SU', 'DOP', ARRAY['D1','D2'], 'legado'),           'D1,D2|ok|0',    '[flujo 4] superadministrador asigna a una persona de OTRA empresa los proyectos de ESA empresa');
SELECT asgt.chk_txt(asgt.modal('SU', 'OP1', ARRAY['P8'], 'diferencias'),           'P8|ok|0',       '[flujo 4] y a una de C por diferencias');
SELECT asgt.chk_txt(asgt.modal('SU2', 'OP1', ARRAY['P8'], 'legado'),               'P8|ok|0',       '[flujo 4] superadmin (la otra grafía), de la empresa D, administra a C');
SELECT asgt.chk_txt(asgt.modal('AX2', 'AP', ARRAY['P5'], 'legado'),                'P1,P2,P3|42501|3', '[flujo 5] un administrador NO cambia el alcance de OTRO administrador (AP {P1,P2,P3} → {P5}): la colusión de D-2 queda cerrada');
SELECT asgt.chk_txt(asgt.modal('AX2', 'AP', ARRAY[]::text[], 'legado'),            'P1,P2,P3|ok|3', '[flujo 5] ni puede dejarlo sin filas (AP seguiría acotado): el DELETE afecta 0 filas SIN error; sólo lo decide el principal');
SELECT asgt.chk_txt(asgt.modal('DOW', 'DOP', ARRAY['D1'], 'legado'),               'D1|ok|0',       '[flujo 6] el propietario de OTRA empresa administra la suya');

-- ═══ 2 · lo que NO puede hacer la pantalla ═══════════════════════════════════════════════════════════════════════
SELECT asgt.chk_txt(asgt.modal('OP1', 'OP1', ARRAY['P1','P2','P3'], 'legado'),      'P1,P2|42501|2', '[flujo 7] un operador que se «edita» a sí mismo: no cambia nada y recibe error');
SELECT asgt.chk_txt(asgt.modal('AP', 'AP', ARRAY['P1','P2','P3','P4'], 'legado'),   'P1,P2,P3|42501|3', '[flujo 7] un administrador acotado que se amplía a sí mismo: no cambia nada y recibe error');
SELECT asgt.chk_txt(asgt.modal('AP', 'AP', ARRAY['P1','P2','P3','P4'], 'diferencias'), 'P1,P2,P3|42501|3', '[flujo 7] … también por diferencias: no borra nada si el insert falla');
SELECT asgt.chk_txt(asgt.modal('AP', 'AP', ARRAY[]::text[], 'legado'),              'P1,P2,P3|ok|3', '[flujo 7] ⚠ un administrador acotado que se vacía a sí mismo: el DELETE afecta 0 filas SIN error y la pantalla debe comprobarlo (por eso se oculta el botón y el guardado lee de vuelta)');
SELECT asgt.chk_txt(asgt.modal('AP', 'AP', ARRAY[]::text[], 'diferencias'),         'P1,P2,P3|ok|3', '[flujo 7] ⚠ ídem por diferencias: 0 filas sin error; la comprobación posterior vive en la aplicación');
SELECT asgt.chk_txt(asgt.modal('DAD', 'OP1', ARRAY['P1','P3'], 'legado'),           'P1,P2|42501|2', '[flujo 8] el administrador de OTRA empresa no cambia a una persona de C: el DELETE no toca nada y el INSERT falla');
SELECT asgt.chk_txt(asgt.modal('AX', 'DOP', ARRAY['D1'], 'legado'),                 '|42501|0',      '[flujo 8] un administrador de C no asigna a una persona de D (el INSERT lo rechaza la política: la persona no es de su empresa)');

-- ═══ 3 · la ventana con CERO asignaciones del guardado «borrar todas y volver a insertar» ═════════════════════════
-- El DELETE y el INSERT son dos peticiones: si el INSERT falla, el DELETE ya valió. Por diferencias, un insert fallido no borra nada.
SELECT asgt.chk_txt(asgt.modal('AP', 'OP2', ARRAY['P1','P4'], 'legado'),      'P2,P3|42501|2',   '[flujo 9] guardado de hoy de un administrador: el DELETE ya no afecta filas y el INSERT falla → OP2 conserva sus 2 asignaciones (ya no hay ventana con CERO: quien guarda es el principal)');
SELECT asgt.chk_txt(asgt.modal('AP', 'OP2', ARRAY['P1','P4'], 'diferencias'), 'P2,P3|42501|2',   '[flujo 9] guardado por diferencias: el insert falla y NO se borra nada → OP2 conserva sus 2 asignaciones');

-- ═══ 4 · lectura: cada persona ve lo suyo (la política SELECT no cambió) ═════════════════════════════════════════
SELECT asgt.ok('[lectura] el operador OP1 lee sus 2 filas y nada más', 'OP1', 'SELECT * FROM public.user_project_assignments', 2);
SELECT asgt.ok('[lectura] el visor VW1 lee sus 2 filas', 'VW1', 'SELECT * FROM public.user_project_assignments', 2);
SELECT asgt.ok('[lectura] una persona sin filas (NUEVO) lee 0', 'NUEVO', 'SELECT * FROM public.user_project_assignments', 0);
SELECT asgt.ok_sql('[lectura] el administrador acotado lee las filas de SUS proyectos (también las suyas y las huérfanas)', 'AP',
  'SELECT * FROM public.user_project_assignments',
  $q$SELECT count(*) FROM public.user_project_assignments WHERE project_id IN ({P1}, {P2}, {P3})$q$);
SELECT asgt.ok('[lectura] el administrador exento lee las 43', 'AX', 'SELECT * FROM public.user_project_assignments', 43);
SELECT asgt.ok('[lectura] el propietario lee las 43', 'OW', 'SELECT * FROM public.user_project_assignments', 43);
SELECT asgt.ok('[lectura] el superadministrador lee las 43', 'SU', 'SELECT * FROM public.user_project_assignments', 43);
SELECT asgt.ok('[lectura] el administrador de OTRA empresa no lee ninguna de C', 'DAD', 'SELECT * FROM public.user_project_assignments', 0);
SELECT asgt.ok('[lectura] el propietario de OTRA empresa tampoco', 'DOW', 'SELECT * FROM public.user_project_assignments', 0);
SELECT asgt.ok('[lectura] la sesión sin app_users lee 0', 'SINAPP', 'SELECT * FROM public.user_project_assignments', 0);
SELECT asgt.ok('[lectura] el cliente lee 0', 'CLI', 'SELECT * FROM public.user_project_assignments', 0);

-- ═══ 5 · el rol de servicio y las funciones de borde siguen escribiendo ═════════════════════════════════════════
-- (create-user / invite-user / delete-user no tocan la tabla; seed-rls-sandbox y rls-evidencias-datos escriben como servicio/superusuario)
SELECT asgt.ok('[servicio] el sembrado converge: borra las de una persona y vuelve a insertar la que toca', 'SERVICIO',
  asgt.borrar_de('OP1') || '; ' || asgt.ins('OP1', 'P5'), 1,
  p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P5');
SELECT asgt.ok('[servicio] y el UPSERT del sembrado (ON CONFLICT user_id,project_id)', 'SERVICIO',
  asgt.ins('OP1', 'P1') || ' ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = EXCLUDED.permission_type', 1);
