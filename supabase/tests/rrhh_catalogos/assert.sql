-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261031000300 (catálogos RRHH: cargos y tipos de turno por condominio),
-- ejercidas COMO cada persona (JWT emulado + rol authenticated/anon).
--   A · backfill: 6 cargos + 3 turnos por proyecto; CHECK literales fuera; triggers dentro;
--       RBAC: 6 claves, Admin General, herencia desde `personal` (sólo allow → allow)
--   B · proyecto nuevo nace con 6 + 3 (trigger en projects)
--   C · CRUD y RLS: por permiso del tab, por proyecto, por empresa; company_id sellado;
--       creado_por sellado; código inmutable; nombre único (sin mayúsculas ni espacios);
--       forma del código; DELETE por permiso; anon fuera
--   D · desactivar vs borrar en uso (23503) y `rrhh_*_en_uso` (fuera de alcance: ceros)
--   E · validación en personal, actividades, programación y ejecuciones (activo, inactivo,
--       inexistente, « Conserje » normalizado, NULL comodín, de otro proyecto, mover de proyecto)
--   F · históricos editables: el valor que no cambia no se valida (IS DISTINCT FROM)
--   G · plantillas_import_evaluar: por código y por nombre, inactivo rechazado, catálogo vacío
--   H · re-sembrar no pisa lo personalizado
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

CREATE OR REPLACE FUNCTION hkt.fila(p_vista jsonb, p_n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT f FROM jsonb_array_elements(p_vista->'filas') f WHERE (f->>'fila')::int = p_n $$;
CREATE OR REPLACE FUNCTION hkt.err(p_vista jsonb, p_n int, p_campo text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(e->>'mensaje', ' | ') FROM jsonb_array_elements(hkt.fila(p_vista, p_n)->'errores') e WHERE e->>'campo' = p_campo $$;
CREATE OR REPLACE FUNCTION hkt.n_err(p_vista jsonb, p_n int) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_array_length(hkt.fila(p_vista, p_n)->'errores') $$;
CREATE OR REPLACE FUNCTION hkt.n_cargos(p uuid) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::int FROM public.rrhh_cargos WHERE project_id = p $$;
CREATE OR REPLACE FUNCTION hkt.n_turnos(p uuid) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::int FROM public.rrhh_tipos_turno WHERE project_id = p $$;
CREATE OR REPLACE FUNCTION hkt.cargo(p uuid, c text) RETURNS public.rrhh_cargos LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.rrhh_cargos WHERE project_id = p AND codigo = c $$;
CREATE OR REPLACE FUNCTION hkt.turno(p uuid, c text) RETURNS public.rrhh_tipos_turno LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.rrhh_tipos_turno WHERE project_id = p AND codigo = c $$;
CREATE OR REPLACE FUNCTION hkt.pers(p_id uuid) RETURNS public.personal_condominio LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.personal_condominio WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION hkt.plan(p_id uuid) RETURNS public.plantillas_tarea_cargo LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.plantillas_tarea_cargo WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION hkt.prog(p_id uuid) RETURNS public.programacion_limpieza LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.programacion_limpieza WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION hkt.pers_id(p_nombre text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM public.personal_condominio WHERE nombre = p_nombre ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION hkt.plan_id(p_titulo text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM public.plantillas_tarea_cargo WHERE titulo = p_titulo ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION hkt.rp(p_rol uuid) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(array_agg(permission_key || ':' || effect ORDER BY permission_key COLLATE "C"), ARRAY[]::text[])
    FROM public.role_permissions WHERE role_id = p_rol AND permission_key LIKE 'condominios.tab.rrhh\_config%' $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- ── A · backfill y RBAC ─────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.root();
  PERFORM hkt.ok('A1 · cada proyecto existente tiene los 6 cargos y 3 turnos de siempre',
    hkt.n_cargos(hkt.pa1()) = 6 AND hkt.n_cargos(hkt.pa2()) = 6 AND hkt.n_cargos(hkt.pb1()) = 6
    AND hkt.n_turnos(hkt.pa1()) = 3 AND hkt.n_turnos(hkt.pa2()) = 3 AND hkt.n_turnos(hkt.pb1()) = 3
    AND (hkt.cargo(hkt.pa1(), 'conserje')).nombre = 'Conserje' AND (hkt.cargo(hkt.pa1(), 'conserje')).icono = '🧹'
    AND (hkt.cargo(hkt.pa1(), 'conserje')).orden = 10 AND (hkt.cargo(hkt.pa1(), 'conserje')).activo
    AND (hkt.cargo(hkt.pb1(), 'otro')).company_id = hkt.cb()
    AND (hkt.turno(hkt.pa1(), 'rotativo')).icono = '🔄' AND (hkt.turno(hkt.pa1(), 'rotativo')).orden = 30
    AND (hkt.cargo(hkt.pa1(), 'conserje')).creado_por IS NULL);
  PERFORM hkt.ok('A2 · los tres CHECK literales ya no existen',
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('prog_limpieza_cargo_check', 'prog_limpieza_turno_check', 'ejec_limpieza_turno_check')));
  PERFORM hkt.ok('A3 · los triggers de validación, siembra y borrado están instalados',
    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
      ('trg_personal_catalogo_rrhh', 'trg_plantillas_cargo_controlado', 'trg_prog_limpieza_catalogo_rrhh',
       'trg_ejec_limpieza_turno_rrhh', 'trg_rrhh_sembrar_catalogos', 'trg_rrhh_cargo_borrable', 'trg_rrhh_turno_borrable',
       'trg_rrhh_cargos_coherente', 'trg_rrhh_cargos_sello', 'trg_rrhh_cargos_updated_at',
       'trg_rrhh_turnos_coherente', 'trg_rrhh_turnos_sello', 'trg_rrhh_turnos_updated_at')) = 13);
  PERFORM hkt.ok('A4 · RBAC: 6 claves del tab en recursos_humanos',
    (SELECT count(*) FROM public.permissions WHERE category = 'recursos_humanos'
       AND (key = 'condominios.tab.rrhh_config' OR key LIKE 'condominios.tab.rrhh\_config.%')) = 6);
  PERFORM hkt.ok('A5 · Administrador General recibe las 6',
    cardinality(hkt.rp('00000000-0000-0000-0000-000000000001')) = 6);
  PERFORM hkt.ok('A6 · «Solo personal» (personal + create + edit) hereda exactamente tab + create + edit',
    hkt.rp('e0000000-0000-0000-0000-0000000000a2') = ARRAY['condominios.tab.rrhh_config:allow',
      'condominios.tab.rrhh_config.create:allow', 'condominios.tab.rrhh_config.edit:allow']);
  PERFORM hkt.ok('A7 · un deny sobre personal NO se propaga',
    cardinality(hkt.rp('e0000000-0000-0000-0000-0000000000a3')) = 0);
  PERFORM hkt.ok('A8 · las DEFINER internas no son ejecutables por authenticated; los validadores y en_uso sí',
    NOT has_function_privilege('authenticated', 'public.rrhh_sembrar_defaults(uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.rrhh_cargo_uso(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.rrhh_cargo_valido(uuid, text, boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.rrhh_cargo_valido(uuid, text, boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.rrhh_cargo_en_uso(uuid, text)', 'EXECUTE')
    AND NOT has_table_privilege('anon', 'public.rrhh_cargos', 'SELECT'));
END $$;

-- ── B · proyecto nuevo ──────────────────────────────────────────────────────
DO $$
DECLARE v_p uuid;
BEGIN
  PERFORM hkt.root();
  INSERT INTO public.projects (company_id, nombre) VALUES (hkt.cb(), 'B · Proyecto nuevo') RETURNING id INTO v_p;
  PERFORM hkt.ok('B1 · un proyecto nuevo nace con 6 cargos y 3 turnos de su empresa',
    hkt.n_cargos(v_p) = 6 AND hkt.n_turnos(v_p) = 3
    AND (SELECT bool_and(company_id = hkt.cb()) FROM public.rrhh_cargos WHERE project_id = v_p));
END $$;

-- ── C · CRUD y RLS ──────────────────────────────────────────────────────────
-- El rol «RRHH config» recibe sus 6 claves ahora (nacieron con la migración).
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT 'e0000000-0000-0000-0000-0000000000a1', key, 'allow' FROM public.permissions
 WHERE key = 'condominios.tab.rrhh_config' OR key LIKE 'condominios.tab.rrhh\_config.%';
DO $$
DECLARE r public.rrhh_cargos; n int;
BEGIN
  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('C1 · quien configura ve SOLO los cargos de sus proyectos (PA1: 6, no PA2)',
    (SELECT count(*) FROM public.rrhh_cargos) = 6 AND (SELECT count(*) FROM public.rrhh_cargos WHERE project_id = hkt.pa2()) = 0
    AND (SELECT count(*) FROM public.rrhh_tipos_turno) = 3);
  -- company_id de otra empresa en el INSERT: el trigger lo sella desde el proyecto.
  INSERT INTO public.rrhh_cargos (company_id, project_id, codigo, nombre, icono, orden)
    VALUES (hkt.cb(), hkt.pa1(), ' Supervisor_Piscina ', '  Supervisor de piscina ', '🏊', 70);
  r := hkt.cargo(hkt.pa1(), 'supervisor_piscina');
  PERFORM hkt.ok('C2 · crear: código normalizado, nombre recortado, company_id sellado desde el proyecto, creado_por sellado',
    r.id IS NOT NULL AND r.nombre = 'Supervisor de piscina' AND r.company_id = hkt.ca() AND r.creado_por = hkt.uid(6) AND r.activo);
  PERFORM hkt.ok('C3 · crear en un proyecto al que no accede → 42501',
    hkt.estado_de($q$INSERT INTO public.rrhh_cargos (company_id, project_id, codigo, nombre) VALUES (hkt.ca(), hkt.pa2(), 'x1', 'Equis uno')$q$) = '42501');
  PERFORM hkt.ok('C4 · código inmutable → 23514; proyecto inmutable → 23514',
    hkt.estado_de($q$UPDATE public.rrhh_cargos SET codigo = 'otro_codigo' WHERE codigo = 'supervisor_piscina'$q$) = '23514'
    AND hkt.mensaje_de($q$UPDATE public.rrhh_cargos SET codigo = 'otro_codigo' WHERE codigo = 'supervisor_piscina'$q$) LIKE 'RRHH_CATALOGO_INMUTABLE%'
    AND hkt.estado_de($q$UPDATE public.rrhh_cargos SET project_id = hkt.pa2() WHERE codigo = 'supervisor_piscina'$q$) IN ('23514', '42501'));
  PERFORM hkt.ok('C5 · nombre repetido (sin mayúsculas ni espacios) → 23505; código repetido → 23505',
    hkt.estado_de($q$UPDATE public.rrhh_cargos SET nombre = ' GUARDIA ' WHERE codigo = 'supervisor_piscina'$q$) = '23505'
    AND hkt.estado_de($q$INSERT INTO public.rrhh_cargos (company_id, project_id, codigo, nombre) VALUES (hkt.ca(), hkt.pa1(), 'guardia', 'Guardia 2')$q$) = '23505');
  PERFORM hkt.ok('C6 · forma: código con espacios o mayúsculas internas, nombre corto, orden negativo → 23514',
    hkt.estado_de($q$INSERT INTO public.rrhh_cargos (company_id, project_id, codigo, nombre) VALUES (hkt.ca(), hkt.pa1(), 'mal codigo', 'Mal código')$q$) = '23514'
    AND hkt.estado_de($q$INSERT INTO public.rrhh_cargos (company_id, project_id, codigo, nombre) VALUES (hkt.ca(), hkt.pa1(), 'corto', 'X')$q$) = '23514'
    AND hkt.estado_de($q$INSERT INTO public.rrhh_cargos (company_id, project_id, codigo, nombre, orden) VALUES (hkt.ca(), hkt.pa1(), 'neg', 'Negativo', -1)$q$) = '23514');
  UPDATE public.rrhh_cargos SET nombre = 'Supervisor/a de piscina', icono = '🏊', orden = 5, descripcion = 'Cuida la piscina' WHERE codigo = 'supervisor_piscina';
  r := hkt.cargo(hkt.pa1(), 'supervisor_piscina');
  PERFORM hkt.ok('C7 · editar nombre/ícono/orden/descripción y updated_at se mueve',
    r.nombre = 'Supervisor/a de piscina' AND r.orden = 5 AND r.descripcion = 'Cuida la piscina' AND r.updated_at >= r.created_at);
  INSERT INTO public.rrhh_cargos (company_id, project_id, codigo, nombre) VALUES (hkt.ca(), hkt.pa1(), 'temporal', 'Temporal');
  n := hkt.afectadas($q$DELETE FROM public.rrhh_cargos WHERE codigo = 'temporal'$q$);
  PERFORM hkt.ok('C8 · con .delete, un cargo que nadie usa se borra', n = 1 AND hkt.cargo(hkt.pa1(), 'temporal') IS NULL);

  PERFORM hkt.como(hkt.uid(14));
  PERFORM hkt.ok('C9 · «Config solo ver» lee el catálogo y no escribe (INSERT 42501, UPDATE/DELETE 0 filas)',
    (SELECT count(*) FROM public.rrhh_cargos) = 7
    AND hkt.estado_de($q$INSERT INTO public.rrhh_cargos (company_id, project_id, codigo, nombre) VALUES (hkt.ca(), hkt.pa1(), 'x2', 'Equis dos')$q$) = '42501'
    AND hkt.afectadas($q$UPDATE public.rrhh_cargos SET nombre = 'Nada' WHERE codigo = 'otro'$q$) = 0
    AND hkt.afectadas($q$DELETE FROM public.rrhh_cargos WHERE codigo = 'otro'$q$) = 0);
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('C10 · sin ningún permiso del tab: lee (catálogo transversal), no escribe',
    (SELECT count(*) FROM public.rrhh_tipos_turno) = 3
    AND hkt.estado_de($q$INSERT INTO public.rrhh_tipos_turno (company_id, project_id, codigo, nombre) VALUES (hkt.ca(), hkt.pa1(), 'x3', 'Equis tres')$q$) = '42501');
  PERFORM hkt.como(hkt.uid(11));
  INSERT INTO public.rrhh_cargos (company_id, project_id, codigo, nombre) VALUES (hkt.ca(), hkt.pa1(), 'vigilante', 'Vigilante');
  PERFORM hkt.ok('C11 · «Solo personal» (herencia: create + edit) crea y edita, pero no borra (0 filas)',
    (hkt.cargo(hkt.pa1(), 'vigilante')).id IS NOT NULL
    AND hkt.afectadas($q$UPDATE public.rrhh_cargos SET nombre = 'Vigilante nocturno' WHERE codigo = 'vigilante'$q$) = 1
    AND hkt.afectadas($q$DELETE FROM public.rrhh_cargos WHERE codigo = 'vigilante'$q$) = 0);
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('C12 · otra empresa: no ve PA1; ve los suyos (PB1 + el nuevo: 12)',
    (SELECT count(*) FROM public.rrhh_cargos WHERE project_id = hkt.pa1()) = 0
    AND (SELECT count(*) FROM public.rrhh_cargos) = 12
    AND hkt.afectadas($q$UPDATE public.rrhh_cargos SET nombre = 'Hackeado' WHERE project_id = hkt.pa1()$q$) = 0);
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('C13 · la dueña (exenta) ve todos los proyectos de su empresa y borra lo no usado',
    (SELECT count(*) FROM public.rrhh_cargos) = 14
    AND hkt.afectadas($q$DELETE FROM public.rrhh_cargos WHERE codigo = 'vigilante'$q$) = 1);
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('C14 · anon no lee ni llama', hkt.estado_de($q$SELECT count(*) FROM public.rrhh_cargos$q$) = '42501'
    AND hkt.estado_de($q$SELECT public.rrhh_cargo_valido(hkt.pa1(), 'conserje')$q$) = '42501');
  PERFORM hkt.root();
END $$;

-- ── D · desactivar vs borrar en uso ─────────────────────────────────────────
DO $$
DECLARE u record; m text;
BEGIN
  PERFORM hkt.como(hkt.uid(6));
  m := hkt.mensaje_de($q$DELETE FROM public.rrhh_cargos WHERE codigo = 'jardinero'$q$);
  PERFORM hkt.ok('D1 · borrar un cargo en uso (1 empleado, 1 programación) → 23503 con el detalle',
    hkt.estado_de($q$DELETE FROM public.rrhh_cargos WHERE codigo = 'jardinero'$q$) = '23503'
    AND m LIKE 'RRHH_CARGO_EN_USO:%' AND m LIKE '%1 empleado(s), 0 actividad(es) y 1 programación(es)%'
    AND (hkt.cargo(hkt.pa1(), 'jardinero')).id IS NOT NULL);
  PERFORM hkt.ok('D2 · borrar un turno en uso (empleado, programación y ejecución) → 23503',
    hkt.estado_de($q$DELETE FROM public.rrhh_tipos_turno WHERE codigo = 'nocturno'$q$) = '23503'
    AND hkt.mensaje_de($q$DELETE FROM public.rrhh_tipos_turno WHERE codigo = 'nocturno'$q$) LIKE 'RRHH_TURNO_EN_USO:%');
  SELECT * INTO u FROM public.rrhh_cargo_en_uso(hkt.pa1(), 'jardinero');
  PERFORM hkt.ok('D3 · rrhh_cargo_en_uso cuenta personal / actividades / programaciones',
    u.personal = 1 AND u.actividades = 0 AND u.programaciones = 1);
  SELECT * INTO u FROM public.rrhh_turno_en_uso(hkt.pa1(), 'nocturno');
  PERFORM hkt.ok('D4 · rrhh_turno_en_uso cuenta personal / programaciones / ejecuciones',
    u.personal = 1 AND u.programaciones = 1 AND u.ejecuciones = 1);
  SELECT * INTO u FROM public.rrhh_cargo_en_uso(hkt.pa1(), 'conserje');
  PERFORM hkt.ok('D5 · «Conserje» legado en mayúscula cuenta como conserje (1 empleado, 3 actividades: 2 previas + la legada)',
    u.personal = 1 AND u.actividades = 3 AND u.programaciones = 0);
  PERFORM hkt.ok('D6 · desactivar en vez de borrar: permitido',
    hkt.afectadas($q$UPDATE public.rrhh_cargos SET activo = false WHERE codigo = 'jardinero'$q$) = 1
    AND NOT (hkt.cargo(hkt.pa1(), 'jardinero')).activo);
  PERFORM hkt.ok('D7 · borrar un cargo que nadie usa (administrador): permitido',
    hkt.afectadas($q$DELETE FROM public.rrhh_cargos WHERE codigo = 'administrador'$q$) = 1);
  PERFORM hkt.como(hkt.uid(7));
  SELECT * INTO u FROM public.rrhh_cargo_en_uso(hkt.pa1(), 'jardinero');
  PERFORM hkt.ok('D8 · en_uso desde otra empresa: ceros', u.personal = 0 AND u.actividades = 0 AND u.programaciones = 0);
  PERFORM hkt.como(hkt.uid(4));
  SELECT * INTO u FROM public.rrhh_turno_en_uso(hkt.pa1(), 'nocturno');
  PERFORM hkt.ok('D9 · en_uso desde un proyecto al que no se accede: ceros', u.personal = 0 AND u.programaciones = 0 AND u.ejecuciones = 0);
  PERFORM hkt.root();
END $$;

-- ── E · validación en las cuatro tablas ─────────────────────────────────────
DO $$
DECLARE p public.personal_condominio; a public.plantillas_tarea_cargo; g public.programacion_limpieza; v_id uuid;
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.personal_condominio (company_id, project_id, nombre, cargo, turno)
    VALUES (hkt.ca(), hkt.pa1(), 'Fede Piscina', 'supervisor_piscina', ' Diurno ');
  p := hkt.pers(hkt.pers_id('Fede Piscina'));
  PERFORM hkt.ok('E1 · personal: cargo nuevo del catálogo y turno « Diurno » normalizado',
    p.cargo = 'supervisor_piscina' AND p.turno = 'diurno');
  PERFORM hkt.ok('E2 · personal: cargo inactivo (jardinero) → 23514 RRHH_CARGO; inexistente → 23514; turno inexistente → 23514 RRHH_TURNO',
    hkt.estado_de($q$INSERT INTO public.personal_condominio (company_id, project_id, nombre, cargo, turno) VALUES (hkt.ca(), hkt.pa1(), 'X', 'jardinero', 'diurno')$q$) = '23514'
    AND hkt.mensaje_de($q$INSERT INTO public.personal_condominio (company_id, project_id, nombre, cargo, turno) VALUES (hkt.ca(), hkt.pa1(), 'X', 'jardinero', 'diurno')$q$) LIKE 'RRHH_CARGO:%'
    AND hkt.estado_de($q$INSERT INTO public.personal_condominio (company_id, project_id, nombre, cargo, turno) VALUES (hkt.ca(), hkt.pa1(), 'X', 'portero', 'diurno')$q$) = '23514'
    AND hkt.mensaje_de($q$INSERT INTO public.personal_condominio (company_id, project_id, nombre, cargo, turno) VALUES (hkt.ca(), hkt.pa1(), 'X', 'conserje', 'mixto')$q$) LIKE 'RRHH_TURNO:%');
  PERFORM hkt.ok('E3 · personal: un cargo de OTRO proyecto no vale (supervisor_piscina sólo existe en PA1)',
    hkt.estado_de($q$INSERT INTO public.personal_condominio (company_id, project_id, nombre, cargo, turno) VALUES (hkt.ca(), hkt.pa2(), 'X', 'supervisor_piscina', 'diurno')$q$) = '23514');
  PERFORM hkt.ok('E4 · personal: cambiar a un cargo activo sí; volver al inactivo no',
    hkt.afectadas($q$UPDATE public.personal_condominio SET cargo = 'guardia' WHERE id = hkt.pe(2)$q$) = 1
    AND hkt.estado_de($q$UPDATE public.personal_condominio SET cargo = 'jardinero' WHERE id = hkt.pe(2)$q$) = '23514');
  PERFORM hkt.ok('E5 · personal: mover de proyecto re-valida (conserje existe en PA2; supervisor_piscina no)',
    hkt.afectadas($q$UPDATE public.personal_condominio SET project_id = hkt.pa2() WHERE id = hkt.pe(1)$q$) = 1
    AND hkt.afectadas($q$UPDATE public.personal_condominio SET project_id = hkt.pa1() WHERE id = hkt.pe(1)$q$) = 1
    AND hkt.estado_de($q$UPDATE public.personal_condominio SET project_id = hkt.pa2() WHERE nombre = 'Fede Piscina'$q$) = '23514');

  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.plantillas_tarea_cargo (company_id, project_id, cargo, titulo, servicio)
    VALUES (hkt.ca(), hkt.pa1(), 'Supervisor_Piscina', 'Revisar cloro', 'otro');
  a := hkt.plan(hkt.plan_id('Revisar cloro'));
  PERFORM hkt.ok('E6 · actividades: cargo nuevo normalizado; inactivo → 23514 PLANTILLAS_CARGO',
    a.cargo = 'supervisor_piscina'
    AND hkt.estado_de($q$INSERT INTO public.plantillas_tarea_cargo (company_id, project_id, cargo, titulo, servicio) VALUES (hkt.ca(), hkt.pa1(), 'jardinero', 'Podar', 'otro')$q$) = '23514'
    AND hkt.mensaje_de($q$INSERT INTO public.plantillas_tarea_cargo (company_id, project_id, cargo, titulo, servicio) VALUES (hkt.ca(), hkt.pa1(), 'jardinero', 'Podar', 'otro')$q$) LIKE 'PLANTILLAS_CARGO:%');

  PERFORM hkt.como(hkt.uid(6));
  INSERT INTO public.programacion_limpieza (company_id, project_id, area, area_id, cargo, turno)
    VALUES (hkt.ca(), hkt.pa1(), 'Pasillo', hkt.ar(1), ' Supervisor_Piscina ', NULL) RETURNING id INTO v_id;
  g := hkt.prog(v_id);
  PERFORM hkt.ok('E7 · programación: NULL comodín; cargo nuevo normalizado; inactivo → 23514; turno fuera → 23514',
    g.cargo = 'supervisor_piscina' AND g.turno IS NULL
    AND hkt.estado_de($q$INSERT INTO public.programacion_limpieza (company_id, project_id, area, area_id, cargo) VALUES (hkt.ca(), hkt.pa1(), 'Pasillo', hkt.ar(1), 'jardinero')$q$) = '23514'
    AND hkt.estado_de($q$INSERT INTO public.programacion_limpieza (company_id, project_id, area, area_id, turno) VALUES (hkt.ca(), hkt.pa1(), 'Pasillo', hkt.ar(1), 'tarde')$q$) = '23514'
    AND hkt.afectadas($q$INSERT INTO public.programacion_limpieza (company_id, project_id, area, area_id) VALUES (hkt.ca(), hkt.pa1(), 'Pasillo', hkt.ar(1))$q$) = 1);
  PERFORM hkt.ok('E8 · ejecución: turno existente (aunque esté inactivo) sí; inexistente no',
    hkt.afectadas($q$UPDATE public.rrhh_tipos_turno SET activo = false WHERE codigo = 'nocturno'$q$) = 1
    AND hkt.afectadas($q$INSERT INTO public.ejecuciones_limpieza (company_id, project_id, programacion_id, fecha, turno) VALUES (hkt.ca(), hkt.pa1(), hkt.pg(1), current_date + 1, 'Nocturno')$q$) = 1
    AND hkt.estado_de($q$INSERT INTO public.ejecuciones_limpieza (company_id, project_id, programacion_id, fecha, turno) VALUES (hkt.ca(), hkt.pa1(), hkt.pg(1), current_date + 2, 'tarde')$q$) = '23514'
    AND hkt.estado_de($q$INSERT INTO public.personal_condominio (company_id, project_id, nombre, cargo, turno) VALUES (hkt.ca(), hkt.pa1(), 'X', 'conserje', 'nocturno')$q$) = '23514'
    AND hkt.afectadas($q$UPDATE public.rrhh_tipos_turno SET activo = true WHERE codigo = 'nocturno'$q$) = 1);
  PERFORM hkt.root();
END $$;

-- ── F · históricos editables ────────────────────────────────────────────────
DO $$
DECLARE p public.personal_condominio;
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('F1 · empleado legado (Polivalente/mixto): se edita entero sin tocar cargo ni turno',
    hkt.afectadas($q$UPDATE public.personal_condominio SET nombre = 'Carla P.', telefono = '555', estado = 'vacaciones', cargo = cargo, turno = turno WHERE id = hkt.pe(3)$q$) = 1
    AND (hkt.pers(hkt.pe(3))).cargo = 'Polivalente' AND (hkt.pers(hkt.pe(3))).turno = 'mixto');
  PERFORM hkt.ok('F2 · legado: cambiar sólo el cargo valida sólo el cargo (el turno «mixto» sigue)',
    hkt.afectadas($q$UPDATE public.personal_condominio SET cargo = 'conserje' WHERE id = hkt.pe(3)$q$) = 1
    AND (hkt.pers(hkt.pe(3))).turno = 'mixto');
  PERFORM hkt.ok('F3 · legado: salir de «mixto» a un turno activo sí; volver a «mixto» no',
    hkt.afectadas($q$UPDATE public.personal_condominio SET turno = 'rotativo' WHERE id = hkt.pe(3)$q$) = 1
    AND hkt.estado_de($q$UPDATE public.personal_condominio SET turno = 'mixto' WHERE id = hkt.pe(3)$q$) = '23514');
  PERFORM hkt.ok('F4 · empleado con cargo hoy inactivo (jardinero → guardia en E4; Beto): sigue editable',
    hkt.afectadas($q$UPDATE public.personal_condominio SET notas = 'ok' WHERE id = hkt.pe(2)$q$) = 1);
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('F5 · actividad legada «Conserje» (mayúscula): se edita sin tocar el cargo; al tocarlo se normaliza',
    hkt.afectadas($q$UPDATE public.plantillas_tarea_cargo SET titulo = 'Legada editada' WHERE id = hkt.pl(4)$q$) = 1
    AND (hkt.plan(hkt.pl(4))).cargo = 'Conserje'
    AND hkt.afectadas($q$UPDATE public.plantillas_tarea_cargo SET cargo = 'conserje' WHERE id = hkt.pl(4)$q$) = 1
    AND (hkt.plan(hkt.pl(4))).cargo = 'conserje');
  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('F6 · programación con cargo hoy inactivo (jardinero): editable; cambiar a inactivo no',
    hkt.afectadas($q$UPDATE public.programacion_limpieza SET notas = 'ok', orden = 2 WHERE id = hkt.pg(1)$q$) = 1
    AND (hkt.prog(hkt.pg(1))).cargo = 'jardinero'
    AND hkt.estado_de($q$UPDATE public.programacion_limpieza SET cargo = 'jardinero' WHERE id = hkt.pg(2)$q$) = '23514');
  PERFORM hkt.root();
END $$;

-- ── G · plantillas_import_evaluar ───────────────────────────────────────────
DO $$
DECLARE v jsonb; d jsonb;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), $j$[
    {"titulo":"Por código","cargo":"supervisor_piscina","servicio":"otro"},
    {"titulo":"Por nombre","cargo":" Supervisor/a de Piscina ","servicio":"otro"},
    {"titulo":"Inactivo","cargo":"jardinero","servicio":"otro"},
    {"titulo":"Inexistente","cargo":"Portero","servicio":"otro"},
    {"titulo":"Vacío","servicio":"otro"},
    {"titulo":"De siempre","cargo":"Guardia","servicio":"seguridad"}
  ]$j$::jsonb, 'cargos.csv');
  d := hkt.fila(v, 1)->'datos';
  PERFORM hkt.ok('G1 · carga masiva: cargo nuevo por código', hkt.n_err(v, 1) = 0 AND d->>'cargo' = 'supervisor_piscina');
  d := hkt.fila(v, 2)->'datos';
  PERFORM hkt.ok('G2 · carga masiva: por nombre de pantalla → se guarda el código', hkt.n_err(v, 2) = 0 AND d->>'cargo' = 'supervisor_piscina');
  PERFORM hkt.ok('G3 · carga masiva: cargo inactivo rechazado, con la lista real',
    hkt.n_err(v, 3) = 1 AND hkt.err(v, 3, 'cargo') LIKE 'Cargo inválido «jardinero» (o inactivo): usa %supervisor_piscina%'
    AND hkt.err(v, 3, 'cargo') NOT LIKE '%jardinero,%' AND hkt.err(v, 3, 'cargo') NOT LIKE '%administrador%');
  PERFORM hkt.ok('G4 · carga masiva: inexistente y vacío',
    hkt.err(v, 4, 'cargo') LIKE 'Cargo inválido «portero»%' AND hkt.err(v, 5, 'cargo') LIKE 'El cargo es obligatorio: %');
  d := hkt.fila(v, 6)->'datos';
  PERFORM hkt.ok('G5 · carga masiva: los de siempre siguen valiendo por etiqueta', hkt.n_err(v, 6) = 0 AND d->>'cargo' = 'guardia');
  PERFORM public.plantillas_importar_descartar((v->>'lote_id')::uuid);
  -- Catálogo vacío: PA2 sin cargos activos.
  PERFORM hkt.como(hkt.uid(1));
  UPDATE public.rrhh_cargos SET activo = false WHERE project_id = hkt.pa2();
  PERFORM hkt.como(hkt.uid(4));
  v := public.plantillas_importar_previsualizar(hkt.pa2(), $j$[{"titulo":"Sin catálogo","cargo":"conserje","servicio":"otro"}]$j$::jsonb, 'vacio.csv');
  PERFORM hkt.ok('G6 · carga masiva sin cargos activos en el condominio: mensaje que manda a Configuración',
    hkt.err(v, 1, 'cargo') LIKE 'Este condominio no tiene cargos activos%Configuración%');
  PERFORM public.plantillas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.como(hkt.uid(1));
  UPDATE public.rrhh_cargos SET activo = true WHERE project_id = hkt.pa2();
  PERFORM hkt.root();
END $$;

-- ── H · re-sembrar no pisa lo personalizado ─────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.root();
  PERFORM public.rrhh_sembrar_defaults(hkt.pa1(), hkt.ca());
  PERFORM hkt.ok('H1 · re-sembrar PA1: vuelve «administrador» (borrado), jardinero sigue inactivo, supervisor_piscina sigue (7 cargos)',
    hkt.n_cargos(hkt.pa1()) = 7 AND (hkt.cargo(hkt.pa1(), 'administrador')).id IS NOT NULL
    AND NOT (hkt.cargo(hkt.pa1(), 'jardinero')).activo AND (hkt.cargo(hkt.pa1(), 'supervisor_piscina')).nombre = 'Supervisor/a de piscina');
END $$;
