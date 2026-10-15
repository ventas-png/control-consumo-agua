-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261030000100_housekeeping_responsable_usuario, ejercidas COMO
-- cada persona (JWT emulado + rol authenticated/anon/service_role).
--   A · EQUIVALENCIA: la elegibilidad usa exactamente las reglas vigentes
--       (user_has_permission, can_access_project, hk_acceso) evaluadas como esa cuenta
--   B · catálogo hk_responsables_elegibles: contenido exacto y quién puede pedirlo
--   C · crear: autoasignación, otro elegible, y cada rechazo (empresa, proyecto, módulo,
--       deshabilitado, cliente, caducado, denegado, inexistente); quien asigna debe poder
--       escribir el servicio
--   D · manipulación directa: sellos del cliente ignorados, reasignar a no elegible,
--       mover de proyecto con responsable no elegible
--   E · reasignar conserva creado_por / iniciado_por / completado_por / fotos y el texto
--   F · revocación posterior: historial intacto, deja de ser elegible, no gana acceso;
--       editar otros campos sigue permitido
--   G · compatibilidad: el texto heredado no se vincula por nombre ni en bloque
--   H · service_role también pasa por la validación; cuenta borrada → SET NULL
--   I · inventario: trigger, ACL de las funciones
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql
-- datos.sql ya lo cargó run.sh (con los servicios heredados) ANTES de la migración.

-- ── A · equivalencia cuenta por cuenta ──────────────────────────────────────
DO $$
DECLARE
  u int; p uuid; c uuid;
  r_perm boolean; r_perm_mio boolean; r_acc boolean; r_acc_mio boolean; r_ele boolean; r_hk boolean;
  v_activo boolean; v_company uuid; v_role text;
  n int := 0;
BEGIN
  FOR u IN 1..13 LOOP
    SELECT activo, company_id, role INTO v_activo, v_company, v_role FROM public.app_users WHERE id = hkt.uid(u);
    -- permiso: usuario_tiene_permiso(u) == user_has_permission() como u
    PERFORM hkt.root();
    r_perm := public.usuario_tiene_permiso(hkt.uid(u), 'condominios.tab.housekeeping');
    PERFORM hkt.como(hkt.uid(u));
    r_perm_mio := public.user_has_permission('condominios.tab.housekeeping');
    PERFORM hkt.root();
    PERFORM hkt.ok(format('A%s.perm persona %s: usuario_tiene_permiso = user_has_permission (%s)', u, u, r_perm), r_perm = r_perm_mio);
    FOREACH p IN ARRAY ARRAY[hkt.pa1(), hkt.pa2(), hkt.pb1()] LOOP
      SELECT company_id INTO c FROM public.projects WHERE id = p;
      PERFORM hkt.root();
      r_acc := public.usuario_acceso_a_proyecto(hkt.uid(u), p);
      r_ele := public.hk_responsable_elegible(hkt.uid(u), c, p);
      PERFORM hkt.como(hkt.uid(u));
      r_acc_mio := public.can_access_project(p);
      r_hk := public.hk_acceso(c, p);
      PERFORM hkt.root();
      n := n + 1;
      PERFORM hkt.ok(format('A%s.acc persona %s / proyecto %s: usuario_acceso_a_proyecto = can_access_project (%s)', n, u, left(p::text, 2), r_acc), r_acc = r_acc_mio);
      PERFORM hkt.ok(format('A%s.ele persona %s / proyecto %s: elegible = activo ∧ misma empresa ∧ no cliente ∧ hk_acceso como la cuenta (%s)', n, u, left(p::text, 2), r_ele),
        r_ele = (v_activo AND v_company = c AND coalesce(v_role, '') <> 'cliente' AND r_hk));
    END LOOP;
  END LOOP;
  -- Resultado esperado, escrito a mano (si la regla cambiara sin querer, aquí se ve):
  PERFORM hkt.ok('A.pa1 elegibles de PA1 = {1,2,3,6,12,13}',
    (SELECT array_agg(g.k ORDER BY g.k) FROM generate_series(1, 13) AS g(k) WHERE public.hk_responsable_elegible(hkt.uid(g.k), hkt.ca(), hkt.pa1())) = ARRAY[1,2,3,6,12,13]);
  PERFORM hkt.ok('A.pa2 elegibles de PA2 = {1,4,12}',
    (SELECT array_agg(g.k ORDER BY g.k) FROM generate_series(1, 13) AS g(k) WHERE public.hk_responsable_elegible(hkt.uid(g.k), hkt.ca(), hkt.pa2())) = ARRAY[1,4,12]);
  PERFORM hkt.ok('A.pb1 elegibles de PB1 = {7}',
    (SELECT array_agg(g.k ORDER BY g.k) FROM generate_series(1, 13) AS g(k) WHERE public.hk_responsable_elegible(hkt.uid(g.k), hkt.cb(), hkt.pb1())) = ARRAY[7]);
  PERFORM hkt.ok('A.nulos empresa o proyecto NULL → no elegible',
    NOT public.hk_responsable_elegible(hkt.uid(1), NULL, hkt.pa1()) AND NOT public.hk_responsable_elegible(hkt.uid(1), hkt.ca(), NULL)
    AND NOT public.hk_responsable_elegible(NULL, hkt.ca(), hkt.pa1()) AND NOT public.hk_responsable_elegible(gen_random_uuid(), hkt.ca(), hkt.pa1()));
  PERFORM hkt.ok('A.empresa el admin de B no es elegible en A aunque el proyecto fuera de B por error de empresa',
    NOT public.hk_responsable_elegible(hkt.uid(7), hkt.ca(), hkt.pb1()) AND NOT public.hk_responsable_elegible(hkt.uid(7), hkt.cb(), hkt.pa1()));
END $$;

-- ── B · catálogo ────────────────────────────────────────────────────────────
DO $$
DECLARE lista int[]; est text;
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  SELECT array_agg(substr(id::text, 25)::int ORDER BY substr(id::text, 25)::int) INTO lista FROM public.hk_responsables_elegibles(hkt.pa1());
  PERFORM hkt.ok('B1 la dueña ve los elegibles de PA1 = {1,2,3,6,12,13}', lista = ARRAY[1,2,3,6,12,13]);
  PERFORM hkt.ok('B2 todos salen habilitados y con nombre',
    (SELECT bool_and(activo AND full_name <> '') FROM public.hk_responsables_elegibles(hkt.pa1())));
  SELECT array_agg(substr(id::text, 25)::int ORDER BY substr(id::text, 25)::int) INTO lista FROM public.hk_responsables_elegibles(hkt.pa2());
  PERFORM hkt.ok('B3 la dueña ve los elegibles de PA2 = {1,4,12}', lista = ARRAY[1,4,12]);
  PERFORM hkt.como(hkt.uid(3));
  SELECT array_agg(substr(id::text, 25)::int ORDER BY substr(id::text, 25)::int) INTO lista FROM public.hk_responsables_elegibles(hkt.pa1());
  PERFORM hkt.ok('B4 un operador con acceso a PA1 ve la MISMA lista (no solo a sí mismo)', lista = ARRAY[1,2,3,6,12,13]);
  PERFORM hkt.ok('B5 la lista está ordenada por nombre',
    (SELECT array_agg(full_name ORDER BY full_name COLLATE "C") = array_agg(full_name) FROM (SELECT full_name FROM public.hk_responsables_elegibles(hkt.pa1())) x));
  PERFORM hkt.como(hkt.uid(5));
  est := hkt.estado_de('SELECT * FROM public.hk_responsables_elegibles(hkt.pa1())');
  PERFORM hkt.ok('B6 sin permiso del módulo → 42501 (' || est || ')', est = '42501');
  PERFORM hkt.como(hkt.uid(4));
  est := hkt.estado_de('SELECT * FROM public.hk_responsables_elegibles(hkt.pa1())');
  PERFORM hkt.ok('B7 sin acceso a ESE proyecto → 42501 (' || est || ')', est = '42501');
  PERFORM hkt.como(hkt.uid(7));
  est := hkt.estado_de('SELECT * FROM public.hk_responsables_elegibles(hkt.pa1())');
  PERFORM hkt.ok('B8 otra empresa → 42501 (' || est || ')', est = '42501');
  est := hkt.estado_de('SELECT * FROM public.hk_responsables_elegibles(gen_random_uuid())');
  PERFORM hkt.ok('B9 proyecto inexistente → 42501 (' || est || ')', est = '42501');
  PERFORM hkt.como(hkt.uid(8));
  est := hkt.estado_de('SELECT * FROM public.hk_responsables_elegibles(hkt.pa1())');
  PERFORM hkt.ok('B10 un cliente → 42501 (' || est || ')', est = '42501');
  PERFORM hkt.como_anon();
  est := hkt.estado_de('SELECT * FROM public.hk_responsables_elegibles(hkt.pa1())');
  PERFORM hkt.ok('B11 anon no puede ejecutar el catálogo (' || est || ')', est = '42501');
  PERFORM hkt.root();
END $$;

-- ── C · crear ───────────────────────────────────────────────────────────────
DO $$
DECLARE est text; r record; quien int;
BEGIN
  -- autoasignación por el operador que crea
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha, responsable_user_id)
    VALUES (hkt.sv(1), hkt.ca(), hkt.pa1(), '2026-10-15', hkt.uid(3));
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(1);
  PERFORM hkt.ok('C1 autoasignación: responsable = creador', r.responsable_user_id = hkt.uid(3));
  PERFORM hkt.ok('C2 creado_por sellado por la BD = creador', r.creado_por = hkt.uid(3));
  PERFORM hkt.ok('C3 responsable_asignado_por/_en sellados = creador, ahora', r.responsable_asignado_por = hkt.uid(3) AND r.responsable_asignado_en IS NOT NULL);
  PERFORM hkt.ok('C4 iniciado_por y completado_por NO se tocan al asignar', r.iniciado_por IS NULL AND r.completado_por IS NULL);
  PERFORM hkt.ok('C5 el texto heredado no se escribe solo', r.responsable IS NULL);
  -- asignación a otro elegible por un operador autorizado
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha, responsable_user_id)
    VALUES (hkt.sv(2), hkt.ca(), hkt.pa1(), '2026-10-15', hkt.uid(6));
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(2);
  PERFORM hkt.ok('C6 otro elegible: responsable = 6, asignado por 3, creado por 3', r.responsable_user_id = hkt.uid(6) AND r.responsable_asignado_por = hkt.uid(3) AND r.creado_por = hkt.uid(3));
  -- sin responsable sigue siendo válido para la base (lo exige la pantalla al crear)
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha)
    VALUES (hkt.sv(3), hkt.ca(), hkt.pa1(), '2026-10-15');
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(3);
  PERFORM hkt.ok('C7 sin responsable: fila válida, sellos de asignación en NULL', r.responsable_user_id IS NULL AND r.responsable_asignado_por IS NULL AND r.responsable_asignado_en IS NULL);
  -- rechazos, incluso para la dueña (que sí puede escribir el servicio)
  PERFORM hkt.como(hkt.uid(1));
  FOREACH quien IN ARRAY ARRAY[7, 4, 5, 9, 8, 10, 11] LOOP
    est := hkt.estado_de(format('INSERT INTO public.servicios_housekeeping (company_id, project_id, fecha, responsable_user_id) VALUES (%L, %L, ''2026-10-15'', %L)', hkt.ca(), hkt.pa1(), hkt.uid(quien)));
    PERFORM hkt.ok(format('C8.%s responsable no elegible (persona %s) → 23514 (%s)', quien, quien, est), est = '23514');
  END LOOP;
  est := hkt.estado_de(format('INSERT INTO public.servicios_housekeeping (company_id, project_id, fecha, responsable_user_id) VALUES (%L, %L, ''2026-10-15'', %L)', hkt.ca(), hkt.pa1(), gen_random_uuid()));
  PERFORM hkt.ok('C9 uuid inexistente → 23514 (' || est || ')', est = '23514');
  PERFORM hkt.ok('C10 el mensaje nombra la regla', hkt.mensaje_de(format('INSERT INTO public.servicios_housekeeping (company_id, project_id, fecha, responsable_user_id) VALUES (%L, %L, ''2026-10-15'', %L)', hkt.ca(), hkt.pa1(), hkt.uid(7))) LIKE 'HK_RESPONSABLE_NO_ELEGIBLE%');
  -- quien asigna debe poder escribir ESE servicio (la RLS no cambia)
  PERFORM hkt.como(hkt.uid(3));
  est := hkt.estado_de(format('INSERT INTO public.servicios_housekeeping (company_id, project_id, fecha, responsable_user_id) VALUES (%L, %L, ''2026-10-15'', %L)', hkt.ca(), hkt.pa2(), hkt.uid(4)));
  PERFORM hkt.ok('C11 un operador de PA1 no crea en PA2 aunque el responsable sea elegible allí → 42501 (' || est || ')', est = '42501');
  PERFORM hkt.como(hkt.uid(5));
  est := hkt.estado_de(format('INSERT INTO public.servicios_housekeeping (company_id, project_id, fecha, responsable_user_id) VALUES (%L, %L, ''2026-10-15'', %L)', hkt.ca(), hkt.pa1(), hkt.uid(3)));
  PERFORM hkt.ok('C12 sin permiso del módulo no se crea nada, elegible o no → 42501 (' || est || ')', est = '42501');
  PERFORM hkt.como(hkt.uid(7));
  est := hkt.estado_de(format('INSERT INTO public.servicios_housekeeping (company_id, project_id, fecha, responsable_user_id) VALUES (%L, %L, ''2026-10-15'', %L)', hkt.ca(), hkt.pa1(), hkt.uid(3)));
  PERFORM hkt.ok('C13 otra empresa no crea en A → 42501 (' || est || ')', est = '42501');
  PERFORM hkt.root();
  PERFORM hkt.ok('C14 ningún rechazo dejó fila (3 heredados + 3 nuevos)', (SELECT count(*) FROM public.servicios_housekeeping) = 6);
END $$;

-- ── D · manipulación directa ────────────────────────────────────────────────
DO $$
DECLARE est text; r record; antes timestamptz;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha, responsable_user_id, responsable_asignado_por, responsable_asignado_en)
    VALUES (hkt.sv(4), hkt.ca(), hkt.pa1(), '2026-10-15', hkt.uid(6), hkt.uid(7), '2000-01-01');
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(4);
  PERFORM hkt.ok('D1 los sellos que manda el cliente al crear se ignoran', r.responsable_asignado_por = hkt.uid(3) AND r.responsable_asignado_en > '2026-01-01');
  antes := r.responsable_asignado_en;
  UPDATE public.servicios_housekeeping SET responsable_asignado_por = hkt.uid(7), responsable_asignado_en = '2000-01-01', notas = 'x' WHERE id = hkt.sv(4);
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(4);
  PERFORM hkt.ok('D2 un UPDATE que no cambia el responsable conserva los sellos (el cliente no los reescribe)', r.responsable_asignado_por = hkt.uid(3) AND r.responsable_asignado_en = antes AND r.notas = 'x');
  est := hkt.estado_de(format('UPDATE public.servicios_housekeeping SET responsable_user_id = %L WHERE id = %L', hkt.uid(7), hkt.sv(4)));
  PERFORM hkt.ok('D3 reasignar por la API a otra empresa → 23514 (' || est || ')', est = '23514');
  est := hkt.estado_de(format('UPDATE public.servicios_housekeeping SET responsable_user_id = %L WHERE id = %L', hkt.uid(5), hkt.sv(4)));
  PERFORM hkt.ok('D4 reasignar por la API a quien no tiene el módulo → 23514 (' || est || ')', est = '23514');
  est := hkt.estado_de(format('UPDATE public.servicios_housekeeping SET responsable_user_id = %L WHERE id = %L', hkt.uid(9), hkt.sv(4)));
  PERFORM hkt.ok('D5 reasignar a una cuenta deshabilitada → 23514 (' || est || ')', est = '23514');
  PERFORM hkt.como(hkt.uid(1));
  est := hkt.estado_de(format('UPDATE public.servicios_housekeeping SET project_id = %L WHERE id = %L', hkt.pa2(), hkt.sv(4)));
  PERFORM hkt.ok('D6 mover a un proyecto donde el responsable (6) no es elegible → 23514 (' || est || ')', est = '23514');
  UPDATE public.servicios_housekeeping SET responsable_user_id = hkt.uid(1) WHERE id = hkt.sv(4);
  UPDATE public.servicios_housekeeping SET project_id = hkt.pa2() WHERE id = hkt.sv(4);
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(4);
  PERFORM hkt.ok('D7 con un responsable exento (la dueña) sí se mueve de proyecto', r.project_id = hkt.pa2() AND r.responsable_user_id = hkt.uid(1));
  PERFORM hkt.como(hkt.uid(4));
  est := hkt.estado_de(format('UPDATE public.servicios_housekeeping SET responsable_user_id = %L WHERE id = %L', hkt.uid(4), hkt.sv(1)));
  PERFORM hkt.ok('D8 un operador de PA2 no reasigna un servicio de PA1 (RLS: 0 filas, sin error) (' || est || ')', est = 'SIN_ERROR' AND (SELECT responsable_user_id FROM public.servicios_housekeeping WHERE id = hkt.sv(1)) IS DISTINCT FROM hkt.uid(4));
  PERFORM hkt.root();
  PERFORM hkt.ok('D9 tras los rechazos el servicio 1 sigue con su responsable', (SELECT responsable_user_id FROM public.servicios_housekeeping WHERE id = hkt.sv(1)) = hkt.uid(3));
END $$;

-- ── E · reasignar conserva la autoría ───────────────────────────────────────
DO $$
DECLARE r record; antes record;
BEGIN
  -- El servicio 1 lo creó 3; 3 lo inicia, 6 lo completa; la raíz le pone un texto heredado.
  PERFORM hkt.como(hkt.uid(3));
  UPDATE public.servicios_housekeeping SET estado = 'en_proceso' WHERE id = hkt.sv(1);
  PERFORM hkt.como(hkt.uid(6));
  UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = hkt.sv(1);
  PERFORM hkt.root();
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path, creado_por) VALUES (hkt.sv(1), 'cierre', hkt.ruta(hkt.pa1(), 1, 'z.jpg'), hkt.uid(6));
  UPDATE public.servicios_housekeeping SET responsable = 'Texto heredado' WHERE id = hkt.sv(1);
  SELECT * INTO antes FROM public.servicios_housekeeping WHERE id = hkt.sv(1);
  PERFORM hkt.ok('E0 punto de partida: creado 3, iniciado 3, completado 6, foto de 6',
    antes.creado_por = hkt.uid(3) AND antes.iniciado_por = hkt.uid(3) AND antes.completado_por = hkt.uid(6)
    AND (SELECT creado_por FROM public.servicio_housekeeping_fotos WHERE servicio_id = hkt.sv(1)) = hkt.uid(6));
  -- La dueña reasigna a la administradora acotada (2)
  PERFORM hkt.como(hkt.uid(1));
  UPDATE public.servicios_housekeeping SET responsable_user_id = hkt.uid(2) WHERE id = hkt.sv(1);
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(1);
  PERFORM hkt.ok('E1 responsable = 2; asignado por 1', r.responsable_user_id = hkt.uid(2) AND r.responsable_asignado_por = hkt.uid(1) AND r.responsable_asignado_en > antes.responsable_asignado_en);
  PERFORM hkt.ok('E2 creado_por intacto', r.creado_por = antes.creado_por);
  PERFORM hkt.ok('E3 iniciado_por/_en intactos', r.iniciado_por = antes.iniciado_por AND r.iniciado_en = antes.iniciado_en);
  PERFORM hkt.ok('E4 completado_por/_en intactos', r.completado_por = antes.completado_por AND r.completado_en = antes.completado_en);
  PERFORM hkt.ok('E5 el texto heredado no se toca al reasignar', r.responsable = 'Texto heredado');
  PERFORM hkt.ok('E6 la autoría de la foto no cambia', (SELECT creado_por FROM public.servicio_housekeeping_fotos WHERE servicio_id = hkt.sv(1)) = hkt.uid(6));
  -- Retirar el responsable también queda sellado (quién lo retiró)
  PERFORM hkt.como(hkt.uid(2));
  UPDATE public.servicios_housekeeping SET responsable_user_id = NULL WHERE id = hkt.sv(1);
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(1);
  PERFORM hkt.ok('E7 retirar: responsable NULL, sellado por quien lo retiró (2)', r.responsable_user_id IS NULL AND r.responsable_asignado_por = hkt.uid(2));
  PERFORM hkt.ok('E8 y la autoría sigue intacta', r.creado_por = antes.creado_por AND r.iniciado_por = antes.iniciado_por AND r.completado_por = antes.completado_por);
  PERFORM hkt.root();
END $$;

-- ── F · revocación posterior ────────────────────────────────────────────────
DO $$
DECLARE r record; n int; est text; antes record;
BEGIN
  -- Servicio 5 con responsable 13 (acceso por asignación explícita); servicio 6 con responsable 6.
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha, responsable_user_id) VALUES
    (hkt.sv(5), hkt.ca(), hkt.pa1(), '2026-10-15', hkt.uid(13)),
    (hkt.sv(6), hkt.ca(), hkt.pa1(), '2026-10-15', hkt.uid(6));
  PERFORM hkt.root();
  SELECT * INTO antes FROM public.servicios_housekeeping WHERE id = hkt.sv(5);
  -- se revoca el acceso de 13 al proyecto y se deshabilita a 6
  DELETE FROM public.user_project_assignments WHERE user_id = hkt.uid(13);
  UPDATE public.app_users SET activo = false WHERE id = hkt.uid(6);
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(5);
  PERFORM hkt.ok('F1 el historial se conserva: el servicio sigue con responsable 13 y sus sellos', r.responsable_user_id = hkt.uid(13) AND r.responsable_asignado_por = antes.responsable_asignado_por AND r.responsable_asignado_en = antes.responsable_asignado_en);
  PERFORM hkt.ok('F2 13 y 6 dejan de ser elegibles (requiere reasignación)',
    NOT public.hk_responsable_elegible(hkt.uid(13), hkt.ca(), hkt.pa1()) AND NOT public.hk_responsable_elegible(hkt.uid(6), hkt.ca(), hkt.pa1()));
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('F3 el catálogo ya no los ofrece', NOT EXISTS (SELECT 1 FROM public.hk_responsables_elegibles(hkt.pa1()) WHERE id IN (hkt.uid(13), hkt.uid(6))));
  -- ser responsable no concede acceso
  PERFORM hkt.como(hkt.uid(13));
  SELECT count(*) INTO n FROM public.servicios_housekeeping WHERE id = hkt.sv(5);
  PERFORM hkt.ok('F4 el responsable revocado no ve "su" servicio (la asignación no concede acceso)', n = 0);
  est := hkt.estado_de(format('UPDATE public.servicios_housekeeping SET notas = ''intruso'' WHERE id = %L', hkt.sv(5)));
  PERFORM hkt.root();
  PERFORM hkt.ok('F5 ni lo edita (0 filas)', (SELECT notas FROM public.servicios_housekeeping WHERE id = hkt.sv(5)) IS NULL);
  PERFORM hkt.como(hkt.uid(13));
  est := hkt.estado_de(format('SELECT * FROM public.hk_responsables_elegibles(%L)', hkt.pa1()));
  PERFORM hkt.ok('F6 ni pide el catálogo del proyecto → 42501 (' || est || ')', est = '42501');
  -- editar otros campos del servicio sigue permitido para quien sí puede
  PERFORM hkt.como(hkt.uid(1));
  UPDATE public.servicios_housekeeping SET notas = 'sigue editable', estado = 'en_proceso' WHERE id = hkt.sv(5);
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(5);
  PERFORM hkt.ok('F7 otros campos se editan sin revalidar un responsable que ya no es elegible', r.notas = 'sigue editable' AND r.estado = 'en_proceso' AND r.responsable_user_id = hkt.uid(13));
  est := hkt.estado_de(format('UPDATE public.servicios_housekeeping SET responsable_user_id = %L WHERE id = %L', hkt.uid(13), hkt.sv(6)));
  PERFORM hkt.ok('F8 pero volver a asignarlo en otro servicio ya no se puede → 23514 (' || est || ')', est = '23514');
  UPDATE public.servicios_housekeeping SET responsable_user_id = hkt.uid(3) WHERE id = hkt.sv(5);
  PERFORM hkt.ok('F9 la reasignación a un elegible resuelve el estado', (SELECT responsable_user_id FROM public.servicios_housekeeping WHERE id = hkt.sv(5)) = hkt.uid(3));
  PERFORM hkt.root();
  -- restaurar para los bloques siguientes
  INSERT INTO public.user_project_assignments (user_id, project_id) VALUES (hkt.uid(13), hkt.pa1());
  UPDATE public.app_users SET activo = true WHERE id = hkt.uid(6);
END $$;

-- ── G · compatibilidad con el texto heredado ────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  -- Los servicios 101..103 los sembró run.sh ANTES de aplicar la migración, con el texto
  -- EXACTO del full_name de personas existentes.
  PERFORM hkt.ok('G1 los servicios heredados conservan su texto',
    (SELECT count(*) FROM public.servicios_housekeeping WHERE id IN (hkt.sv(101), hkt.sv(102), hkt.sv(103)) AND responsable IS NOT NULL) = 3);
  PERFORM hkt.ok('G2 ninguno quedó vinculado por coincidencia de nombre',
    (SELECT count(*) FROM public.servicios_housekeeping WHERE id IN (hkt.sv(101), hkt.sv(102), hkt.sv(103)) AND responsable_user_id IS NOT NULL) = 0);
  PERFORM hkt.ok('G3 sus sellos de asignación están vacíos (no hubo asignación)',
    (SELECT count(*) FROM public.servicios_housekeeping WHERE id IN (hkt.sv(101), hkt.sv(102), hkt.sv(103)) AND (responsable_asignado_por IS NOT NULL OR responsable_asignado_en IS NOT NULL)) = 0);
  -- editar un heredado no lo vincula; vincularlo conserva el texto
  PERFORM hkt.como(hkt.uid(1));
  UPDATE public.servicios_housekeeping SET notas = 'editado' WHERE id = hkt.sv(101);
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(101);
  PERFORM hkt.ok('G4 editar otro campo no lo vincula', r.responsable_user_id IS NULL AND r.responsable = 'Operador PA1');
  UPDATE public.servicios_housekeeping SET responsable_user_id = hkt.uid(3) WHERE id = hkt.sv(101);
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(101);
  PERFORM hkt.ok('G5 al elegir un usuario el texto heredado sigue ahí (lo decide la pantalla, no la base)', r.responsable_user_id = hkt.uid(3) AND r.responsable = 'Operador PA1' AND r.responsable_asignado_por = hkt.uid(1));
  PERFORM hkt.root();
END $$;

-- ── H · service_role y cuenta borrada ───────────────────────────────────────
DO $$
DECLARE est text; r record;
BEGIN
  PERFORM hkt.como_servicio();
  est := hkt.estado_de(format('INSERT INTO public.servicios_housekeeping (company_id, project_id, fecha, responsable_user_id) VALUES (%L, %L, ''2026-10-15'', %L)', hkt.ca(), hkt.pa1(), hkt.uid(7)));
  PERFORM hkt.ok('H1 service_role (sin RLS) tampoco asigna a quien no es elegible → 23514 (' || est || ')', est = '23514');
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha, responsable_user_id) VALUES (hkt.sv(7), hkt.ca(), hkt.pa1(), '2026-10-15', hkt.uid(6));
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(7);
  PERFORM hkt.ok('H2 service_role asigna a un elegible; sin JWT el sello de quién queda NULL y el cuándo no', r.responsable_user_id = hkt.uid(6) AND r.responsable_asignado_por IS NULL AND r.responsable_asignado_en IS NOT NULL);
  PERFORM hkt.root();
  DELETE FROM auth.users WHERE id = hkt.uid(6);
  SELECT * INTO r FROM public.servicios_housekeeping WHERE id = hkt.sv(7);
  PERFORM hkt.ok('H3 borrar la cuenta deja el servicio (responsable → NULL por ON DELETE SET NULL)', r.id = hkt.sv(7) AND r.responsable_user_id IS NULL);
END $$;

-- ── I · inventario ──────────────────────────────────────────────────────────
DO $$
DECLARE est text;
BEGIN
  PERFORM hkt.ok('I1 trigger trg_hk_responsable BEFORE INSERT OR UPDATE',
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hk_responsable' AND tgrelid = 'public.servicios_housekeeping'::regclass
            AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE%'));
  PERFORM hkt.ok('I2 columnas y llaves',
    (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.servicios_housekeeping'::regclass AND contype = 'f'
       AND conname IN ('servicios_housekeeping_responsable_user_id_fkey', 'servicios_housekeeping_responsable_asignado_por_fkey')) = 2);
  PERFORM hkt.ok('I3 las funciones nuevas son SECURITY DEFINER con search_path vacío',
    (SELECT bool_and(p.prosecdef AND p.proconfig::text LIKE '%search_path=%') FROM pg_proc p
      WHERE p.proname IN ('usuario_tiene_permiso', 'hk_responsable_elegible', 'hk_responsable_validar', 'hk_responsables_elegibles')));
  PERFORM hkt.como(hkt.uid(1));
  est := hkt.estado_de(format('SELECT public.usuario_tiene_permiso(%L, ''condominios.tab.housekeeping'')', hkt.uid(3)));
  PERFORM hkt.ok('I4 usuario_tiene_permiso no es un oráculo para authenticated (' || est || ')', est = '42501');
  est := hkt.estado_de(format('SELECT public.hk_responsable_elegible(%L, %L, %L)', hkt.uid(3), hkt.ca(), hkt.pa1()));
  PERFORM hkt.ok('I5 hk_responsable_elegible tampoco (' || est || ')', est = '42501');
  PERFORM hkt.como_anon();
  est := hkt.estado_de(format('SELECT public.usuario_tiene_permiso(%L, ''condominios.tab.housekeeping'')', hkt.uid(3)));
  PERFORM hkt.ok('I6 ni para anon (' || est || ')', est = '42501');
  PERFORM hkt.root();
END $$;

\echo 'HOUSEKEEPING_RESPONSABLE_OK'
