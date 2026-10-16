-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261031000200 (carga masiva de actividades y recursos en bloque),
-- ejercidas COMO cada persona (JWT emulado + rol authenticated/anon).
--   A · vista previa: cada regla por campo, recursos por nombre (inexistente, ambiguo, inactivo,
--       categoría, cantidad, «!»), título repetido (existente activo/inactivo, en el archivo),
--       defectos; no escribe actividades
--   B · aplicar con errores: todo o nada, nada escrito (ni actividad ni puentes)
--   C · aplicar OK: actividades con sus puentes (cantidad, obligatoria, company_id del trigger,
--       creado_por sellado); reaplicar devuelve «reutilizada»
--   D · el mismo contenido no se importa dos veces mientras sus actividades sigan
--   E · re-evaluación al aplicar contra el estado de HOY
--   F · descartar
--   G · permisos y alcance: sin crear, sin permiso, sin ver Suministros, otro proyecto, otra
--       empresa, sin perfil, anon, límite, vacío, proyecto inexistente; quién sí
--   H · candado: los lotes solo los escriben las RPC; quién los lee
--   I · inventario: ACL y RLS
--   J · recursos en bloque: agregar/quitar con conteos, pares existentes intactos, alcance,
--       permisos, forma, atómico
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

CREATE OR REPLACE FUNCTION hkt.fila(p_vista jsonb, p_n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT f FROM jsonb_array_elements(p_vista->'filas') f WHERE (f->>'fila')::int = p_n $$;
CREATE OR REPLACE FUNCTION hkt.err(p_vista jsonb, p_n int, p_campo text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(e->>'mensaje', ' | ') FROM jsonb_array_elements(hkt.fila(p_vista, p_n)->'errores') e WHERE e->>'campo' = p_campo $$;
CREATE OR REPLACE FUNCTION hkt.n_err(p_vista jsonb, p_n int) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_array_length(hkt.fila(p_vista, p_n)->'errores') $$;
CREATE OR REPLACE FUNCTION hkt.n_pl() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*)::int FROM public.plantillas_tarea_cargo $$;
CREATE OR REPLACE FUNCTION hkt.n_ps() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*)::int FROM public.plantilla_tarea_suministros $$;
CREATE OR REPLACE FUNCTION hkt.n_ph() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*)::int FROM public.plantilla_tarea_herramientas $$;
CREATE OR REPLACE FUNCTION hkt.lote(p_id uuid) RETURNS public.plantillas_importaciones LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.plantillas_importaciones WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION hkt.pl_id(p_titulo text, p_proyecto uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM public.plantillas_tarea_cargo WHERE titulo = p_titulo AND project_id = p_proyecto ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION hkt.ps(p_pl uuid, p_su uuid) RETURNS public.plantilla_tarea_suministros LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.plantilla_tarea_suministros WHERE plantilla_tarea_id = p_pl AND suministro_id = p_su $$;
CREATE OR REPLACE FUNCTION hkt.ph(p_pl uuid, p_inv uuid) RETURNS public.plantilla_tarea_herramientas LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.plantilla_tarea_herramientas WHERE plantilla_tarea_id = p_pl AND inventario_id = p_inv $$;
CREATE TABLE IF NOT EXISTS hkt.res (k text PRIMARY KEY, j jsonb);
GRANT ALL ON hkt.res TO authenticated, anon, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- ── A · vista previa con errores por campo ──────────────────────────────────
DO $$
DECLARE v jsonb; n0 int := hkt.n_pl(); l public.plantillas_importaciones; d jsonb;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), $j$[
    {"titulo":"Barrido de gradas","cargo":"Conserje","servicio":"Limpieza","descripcion":"- Barrer de arriba abajo","instrucciones_seguridad":"Guantes","duracion_min":"15","icono":"🧹","area":"pasillo","orden":"2","requiere_foto":"si","requiere_comentario":"no","requiere_checklist":"sí","checklist":"Barrer|Recoger| ","insumos":"escoba; Bolsa x 3","herramientas":"Trapeador x2!","equipo":"Hidrolavadora"},
    {"titulo":"X","cargo":"conserje","servicio":"otro"},
    {"titulo":"Fila 3","cargo":"Portero","servicio":"otro"},
    {"titulo":"Fila 4","cargo":"conserje","servicio":"Cocina"},
    {"titulo":"Fila 5","cargo":"conserje","servicio":"limpieza"},
    {"titulo":"Fila 6","cargo":"conserje","servicio":"otro","duracion_min":"abc"},
    {"titulo":"Fila 7","cargo":"conserje","servicio":"otro","icono":"🐱"},
    {"titulo":"Fila 8","cargo":"conserje","servicio":"otro","area":"Nada"},
    {"titulo":"Fila 9","cargo":"conserje","servicio":"otro","area":"dup"},
    {"titulo":"Fila 10","cargo":"conserje","servicio":"otro","area":"Vieja"},
    {"titulo":"Fila 11","cargo":"conserje","servicio":"otro","orden":"x"},
    {"titulo":"Fila 12","cargo":"conserje","servicio":"otro","requiere_foto":"quizá"},
    {"titulo":"Fila 13","cargo":"conserje","servicio":"otro","requiere_checklist":"si","checklist":" | "},
    {"titulo":"Fila 14","cargo":"conserje","servicio":"otro","insumos":"Nada"},
    {"titulo":"Fila 15","cargo":"conserje","servicio":"otro","insumos":"dup"},
    {"titulo":"Fila 16","cargo":"conserje","servicio":"otro","insumos":"Cloro"},
    {"titulo":"Fila 17","cargo":"conserje","servicio":"otro","insumos":"Escoba x 0"},
    {"titulo":"Fila 18","cargo":"conserje","servicio":"otro","insumos":"Escoba; escoba x2"},
    {"titulo":"Fila 19","cargo":"conserje","servicio":"otro","insumos":"Escoba!"},
    {"titulo":"Fila 20","cargo":"conserje","servicio":"otro","herramientas":"Hidrolavadora"},
    {"titulo":"Fila 21","cargo":"conserje","servicio":"otro","equipo":"Aspiradora"},
    {"titulo":"Fila 22","cargo":"conserje","servicio":"otro","herramientas":"Trapeador x 1.5"},
    {"titulo":"Fila 23","cargo":"conserje","servicio":"otro","descripcion":"=cmd|' /C calc'!A0"},
    {"titulo":"Fila 24","cargo":"conserje","servicio":"otro","estado":"x"},
    {"titulo":"barrido de piso en pasillo","cargo":"conserje","servicio":"limpieza","duracion_min":"5"},
    {"titulo":"VIEJA ACTIVIDAD","cargo":"conserje","servicio":"limpieza","duracion_min":"5"},
    {"titulo":"barrido de gradas","cargo":"conserje","servicio":"mantenimiento"},
    {"titulo":"Mínima","cargo":"Guardia","servicio":"Seguridad"},
    {"titulo":"Poda","cargo":"Jardinero","servicio":"Jardinería","equipo":"Pulidora!"},
    {"titulo":"Trapear","cargo":"conserje","servicio":"limpieza","duracion_min":"10","insumos":"Trapo"}
  ]$j$::jsonb, 'prueba.csv');
  INSERT INTO hkt.res VALUES ('a', v);
  PERFORM hkt.ok('A0 la vista previa cuenta las 30 filas: 3 válidas, 27 con error, sin duplicado de lote', (v->'resumen'->>'total')::int = 30
    AND (v->'resumen'->>'validas')::int = 3 AND (v->'resumen'->>'con_error')::int = 27 AND (v->'resumen'->>'duplicado_de_lote_aplicado')::boolean = false
    AND (v->>'project_id')::uuid = hkt.pa1());
  d := hkt.fila(v, 1)->'datos';
  PERFORM hkt.ok('A1 fila completa: cargo y servicio por etiqueta, duración, ícono, área por nombre, orden, si/no, checklist sin vacíos',
    hkt.n_err(v, 1) = 0 AND d->>'cargo' = 'conserje' AND d->>'servicio' = 'limpieza' AND (d->>'duracion_estimada_min')::int = 15
    AND d->>'icono' = '🧹' AND (d->>'area_id')::uuid = hkt.ar(1) AND (d->>'orden')::int = 2
    AND (d->>'requiere_foto')::boolean AND NOT (d->>'requiere_comentario')::boolean AND (d->>'requiere_checklist')::boolean
    AND d->'checklist' = '["Barrer","Recoger"]'::jsonb AND d->>'descripcion' = '- Barrer de arriba abajo');
  PERFORM hkt.ok('A1b … y sus recursos resueltos por nombre: 2 insumos (Escoba ×1, Bolsa ×3), herramienta ×2 obligatoria, equipo ×1',
    (d->>'n_recursos')::int = 4
    AND (SELECT count(*) FROM jsonb_array_elements(d->'recursos'->'suministros') x WHERE (x->>'id')::uuid = hkt.su(1) AND (x->>'cantidad')::numeric = 1) = 1
    AND (SELECT count(*) FROM jsonb_array_elements(d->'recursos'->'suministros') x WHERE (x->>'id')::uuid = hkt.su(2) AND (x->>'cantidad')::numeric = 3) = 1
    AND (SELECT count(*) FROM jsonb_array_elements(d->'recursos'->'inventario') x WHERE (x->>'id')::uuid = hkt.inv(1) AND (x->>'cantidad')::int = 2 AND (x->>'obligatoria')::boolean AND x->>'categoria' = 'herramienta') = 1
    AND (SELECT count(*) FROM jsonb_array_elements(d->'recursos'->'inventario') x WHERE (x->>'id')::uuid = hkt.inv(3) AND (x->>'cantidad')::int = 1 AND NOT (x->>'obligatoria')::boolean AND x->>'categoria' = 'equipo') = 1);
  PERFORM hkt.ok('A2 título de 1 carácter → error', hkt.err(v, 2, 'titulo') IS NOT NULL);
  PERFORM hkt.ok('A3 cargo fuera del catálogo → error', hkt.err(v, 3, 'cargo') LIKE 'Cargo inválido%');
  PERFORM hkt.ok('A4 servicio fuera del catálogo → error', hkt.err(v, 4, 'servicio') LIKE 'Servicio inválido%');
  PERFORM hkt.ok('A5 limpieza sin duración → error (regla de la pantalla)', hkt.err(v, 5, 'duracion_min') LIKE '%limpieza requieren duración%');
  PERFORM hkt.ok('A6 duración no entera → error', hkt.err(v, 6, 'duracion_min') IS NOT NULL);
  PERFORM hkt.ok('A7 ícono fuera del catálogo → error', hkt.err(v, 7, 'icono') IS NOT NULL);
  PERFORM hkt.ok('A8 área inexistente → error (no crea áreas)', hkt.err(v, 8, 'area') LIKE '%no existe%no crea áreas%');
  PERFORM hkt.ok('A9 nombre de área repetido → ambigua', hkt.err(v, 9, 'area') LIKE '%ambiguo%');
  PERFORM hkt.ok('A10 área inactiva → no existe', hkt.err(v, 10, 'area') LIKE '%no existe%');
  PERFORM hkt.ok('A11 orden no numérico → error', hkt.err(v, 11, 'orden') IS NOT NULL);
  PERFORM hkt.ok('A12 requiere_foto que no es si/no → error', hkt.err(v, 12, 'requiere_foto') IS NOT NULL);
  PERFORM hkt.ok('A13 checklist obligatorio sin pasos → error', hkt.err(v, 13, 'checklist') LIKE '%obligatorio pero no trae pasos%');
  PERFORM hkt.ok('A14 insumo inexistente → error (no crea insumos)', hkt.err(v, 14, 'insumos') LIKE '%no existe%no crea insumos%');
  PERFORM hkt.ok('A15 insumo con nombre repetido → ambiguo', hkt.err(v, 15, 'insumos') LIKE '%ambiguo%');
  PERFORM hkt.ok('A16 insumo inactivo → no existe', hkt.err(v, 16, 'insumos') LIKE '%no existe%');
  PERFORM hkt.ok('A17 cantidad 0 → error', hkt.err(v, 17, 'insumos') LIKE '%mayor que cero%');
  PERFORM hkt.ok('A18 insumo repetido en la fila → error', hkt.err(v, 18, 'insumos') LIKE '%se repite en la misma fila%');
  PERFORM hkt.ok('A19 «!» en un insumo → error', hkt.err(v, 19, 'insumos') LIKE '%no llevan «!»%');
  PERFORM hkt.ok('A20 un equipo en la columna herramientas → error de categoría', hkt.err(v, 20, 'herramientas') LIKE '%categoría «herramienta»%');
  PERFORM hkt.ok('A21 equipo dado de baja → error', hkt.err(v, 21, 'equipo') LIKE '%no existe%');
  PERFORM hkt.ok('A22 cantidad decimal en herramienta → error (entera)', hkt.err(v, 22, 'herramientas') LIKE '%entero%');
  PERFORM hkt.ok('A23 fórmula en una celda → error', hkt.err(v, 23, 'descripcion') LIKE '%posible fórmula%');
  PERFORM hkt.ok('A24 columna «estado» → rechazada', hkt.err(v, 24, 'estado') LIKE '%no se admite%');
  PERFORM hkt.ok('A25 título ya existente (activo, sin mayúsculas) con el mismo cargo → error', hkt.err(v, 25, 'titulo') LIKE 'Ya existe una actividad%');
  PERFORM hkt.ok('A26 título ya existente INACTIVO → también error', hkt.err(v, 26, 'titulo') LIKE 'Ya existe una actividad%');
  PERFORM hkt.ok('A27 título + cargo repetidos dentro del archivo → error en la fila posterior', hkt.err(v, 27, 'titulo') LIKE '%se repite en otra fila%');
  d := hkt.fila(v, 28)->'datos';
  PERFORM hkt.ok('A28 fila mínima: valores por omisión (ícono por servicio, orden 0, sin requisitos, checklist vacío, sin recursos)',
    hkt.n_err(v, 28) = 0 AND d->>'cargo' = 'guardia' AND d->>'servicio' = 'seguridad' AND d->>'icono' = '🔐' AND (d->>'orden')::int = 0
    AND NOT (d->>'requiere_foto')::boolean AND NOT (d->>'requiere_checklist')::boolean AND d->'checklist' = '[]'::jsonb
    AND (d->>'n_recursos')::int = 0 AND d->>'duracion_estimada_min' IS NULL AND d->>'area_id' IS NULL);
  d := hkt.fila(v, 29)->'datos';
  PERFORM hkt.ok('A29 «Jardinería» → jardineria, ícono 🌿, equipo obligatorio', hkt.n_err(v, 29) = 0 AND d->>'servicio' = 'jardineria' AND d->>'icono' = '🌿'
    AND (SELECT count(*) FROM jsonb_array_elements(d->'recursos'->'inventario') x WHERE (x->>'id')::uuid = hkt.inv(4) AND (x->>'obligatoria')::boolean) = 1);
  PERFORM hkt.ok('A30 insumo de OTRO proyecto de la empresa → no existe aquí', hkt.err(v, 30, 'insumos') LIKE '%no existe%');
  l := hkt.lote((v->>'lote_id')::uuid);
  PERFORM hkt.ok('A31 el lote queda «previsualizado» con sus 30 filas y quién lo cargó; ninguna actividad escrita',
    l.estado = 'previsualizado' AND l.created_by = hkt.uid(3) AND l.company_id = hkt.ca() AND l.project_id = hkt.pa1()
    AND (SELECT count(*) FROM public.plantillas_importacion_filas WHERE lote_id = l.id) = 30 AND hkt.n_pl() = n0
    AND (l.resumen->>'con_error')::int = 27);
  PERFORM hkt.root();
END $$;

-- ── B · aplicar con errores: nada ───────────────────────────────────────────
DO $$
DECLARE v jsonb := (SELECT j FROM hkt.res WHERE k = 'a'); n0 int := hkt.n_pl(); s0 int := hkt.n_ps(); h0 int := hkt.n_ph(); msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  msg := hkt.mensaje_de(format('SELECT public.plantillas_importar_aplicar(%L)', v->>'lote_id'));
  PERFORM hkt.ok('B1 aplicar un lote con errores → PLANTILLAS_IMPORT_CON_ERRORES (23514), todo o nada', msg LIKE 'PLANTILLAS_IMPORT_CON_ERRORES: 27 fila(s)%'
    AND hkt.estado_de(format('SELECT public.plantillas_importar_aplicar(%L)', v->>'lote_id')) = '23514');
  PERFORM hkt.ok('B2 ninguna actividad ni puente escrita y el lote sigue «previsualizado»', hkt.n_pl() = n0 AND hkt.n_ps() = s0 AND hkt.n_ph() = h0
    AND (hkt.lote((v->>'lote_id')::uuid)).estado = 'previsualizado');
  PERFORM hkt.root();
END $$;

-- ── C · aplicar OK ──────────────────────────────────────────────────────────
DO $$
DECLARE v jsonb; r jsonb; r2 jsonb; n0 int := hkt.n_pl(); l public.plantillas_importaciones; x public.plantillas_tarea_cargo;
        ps public.plantilla_tarea_suministros; ph public.plantilla_tarea_herramientas;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), $j$[
    {"titulo":"Barrido de gradas","cargo":"Conserje","servicio":"Limpieza","descripcion":"Barrer","instrucciones_seguridad":"Guantes","duracion_min":"15","icono":"🧹","area":"Pasillo","orden":"2","requiere_foto":"si","requiere_checklist":"si","checklist":"Barrer|Recoger","insumos":"escoba; Bolsa x 3","herramientas":"Trapeador x2!","equipo":"Hidrolavadora"},
    {"titulo":"Mínima","cargo":"Guardia","servicio":"Seguridad"},
    {"titulo":"Poda","cargo":"Jardinero","servicio":"Jardinería","equipo":"Pulidora!"}
  ]$j$::jsonb, 'limpio.csv');
  INSERT INTO hkt.res VALUES ('c', v);
  PERFORM hkt.ok('C1 archivo limpio: 3 válidas', (v->'resumen'->>'validas')::int = 3 AND (v->'resumen'->>'con_error')::int = 0);
  r := public.plantillas_importar_aplicar((v->>'lote_id')::uuid);
  INSERT INTO hkt.res VALUES ('c_res', r);
  PERFORM hkt.ok('C2 aplicar crea 3 actividades con 2 insumos y 3 herramientas/equipos y devuelve sus ids', (r->>'actividades_creadas')::int = 3
    AND jsonb_array_length(r->'plantilla_ids') = 3 AND (r->>'insumos_vinculados')::int = 2 AND (r->>'herramientas_vinculadas')::int = 3
    AND (r->>'reutilizada')::boolean = false AND hkt.n_pl() = n0 + 3);
  SELECT * INTO x FROM public.plantillas_tarea_cargo WHERE titulo = 'Barrido de gradas' AND project_id = hkt.pa1();
  PERFORM hkt.ok('C3 la actividad nace activa con todos sus campos (cargo normalizado, servicio, duración, área, checklist, requisitos)',
    x.activo AND x.cargo = 'conserje' AND x.servicio = 'limpieza' AND x.duracion_estimada_min = 15 AND x.area_id = hkt.ar(1) AND x.orden = 2
    AND x.requiere_foto AND x.requiere_checklist AND NOT x.requiere_comentario AND x.checklist = '["Barrer","Recoger"]'::jsonb
    AND x.descripcion = 'Barrer' AND x.instrucciones_seguridad = 'Guantes' AND x.icono = '🧹' AND x.company_id = hkt.ca() AND x.project_id = hkt.pa1());
  ps := hkt.ps(x.id, hkt.su(2));
  ph := hkt.ph(x.id, hkt.inv(1));
  PERFORM hkt.ok('C4 los puentes llevan cantidad, obligatoria, el tenant sellado por el trigger y creado_por sellado',
    ps.cantidad = 3 AND ps.company_id = hkt.ca() AND ps.project_id = hkt.pa1() AND ps.creado_por = hkt.uid(3)
    AND (hkt.ps(x.id, hkt.su(1))).cantidad = 1
    AND ph.cantidad = 2 AND ph.obligatoria AND ph.creado_por = hkt.uid(3) AND (hkt.ph(x.id, hkt.inv(3))).cantidad = 1 AND NOT (hkt.ph(x.id, hkt.inv(3))).obligatoria);
  SELECT * INTO x FROM public.plantillas_tarea_cargo WHERE titulo = 'Mínima' AND project_id = hkt.pa1();
  PERFORM hkt.ok('C5 la fila mínima: guardia / seguridad, ícono por defecto, sin duración, sin recursos',
    x.cargo = 'guardia' AND x.servicio = 'seguridad' AND x.icono = '🔐' AND x.duracion_estimada_min IS NULL AND x.checklist = '[]'::jsonb
    AND (SELECT count(*) FROM public.plantilla_tarea_suministros WHERE plantilla_tarea_id = x.id) = 0);
  SELECT * INTO x FROM public.plantillas_tarea_cargo WHERE titulo = 'Poda' AND project_id = hkt.pa1();
  PERFORM hkt.ok('C6 equipo obligatorio en Poda', (hkt.ph(x.id, hkt.inv(4))).obligatoria);
  l := hkt.lote((v->>'lote_id')::uuid);
  PERFORM hkt.ok('C7 el lote queda «aplicado», con quién y cuándo, y su resultado', l.estado = 'aplicado' AND l.aplicado_por = hkt.uid(3) AND l.aplicado_at IS NOT NULL
    AND (l.resultado->>'actividades_creadas')::int = 3);
  r2 := public.plantillas_importar_aplicar((v->>'lote_id')::uuid);
  PERFORM hkt.ok('C8 reaplicar el mismo lote devuelve el resultado con «reutilizada» y no duplica', (r2->>'reutilizada')::boolean AND (r2->>'actividades_creadas')::int = 3
    AND r2->'plantilla_ids' = r->'plantilla_ids' AND hkt.n_pl() = n0 + 3);
  PERFORM hkt.root();
END $$;

-- ── D · el mismo contenido no entra dos veces ───────────────────────────────
DO $$
DECLARE v jsonb; n0 int := hkt.n_pl(); ids uuid[]; msg text;
  filas jsonb := $j$[
    {"titulo":"Barrido de gradas","cargo":"Conserje","servicio":"Limpieza","descripcion":"Barrer","instrucciones_seguridad":"Guantes","duracion_min":"15","icono":"🧹","area":"Pasillo","orden":"2","requiere_foto":"si","requiere_checklist":"si","checklist":"Barrer|Recoger","insumos":"escoba; Bolsa x 3","herramientas":"Trapeador x2!","equipo":"Hidrolavadora"},
    {"titulo":"Mínima","cargo":"Guardia","servicio":"Seguridad"},
    {"titulo":"Poda","cargo":"Jardinero","servicio":"Jardinería","equipo":"Pulidora!"}
  ]$j$::jsonb;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), filas, 'limpio.csv');
  PERFORM hkt.ok('D1 el mismo contenido otra vez: la vista previa lo marca como duplicado de un lote aplicado (y los títulos ahora existen)',
    (v->'resumen'->>'duplicado_de_lote_aplicado')::boolean AND hkt.err(v, 1, 'titulo') LIKE 'Ya existe una actividad%');
  msg := hkt.mensaje_de(format('SELECT public.plantillas_importar_aplicar(%L)', v->>'lote_id'));
  PERFORM hkt.ok('D2 aplicarlo → PLANTILLAS_IMPORT_DUPLICADO (23505) antes de evaluar nada', msg LIKE 'PLANTILLAS_IMPORT_DUPLICADO%'
    AND hkt.estado_de(format('SELECT public.plantillas_importar_aplicar(%L)', v->>'lote_id')) = '23505' AND hkt.n_pl() = n0);
  -- Si las actividades de ese lote ya no están, el mismo contenido puede volver a cargarse.
  PERFORM hkt.root();
  SELECT array_agg(x::uuid) INTO ids FROM jsonb_array_elements_text((SELECT j FROM hkt.res WHERE k = 'c_res')->'plantilla_ids') x;
  DELETE FROM public.plantillas_tarea_cargo WHERE id = ANY (ids);
  PERFORM hkt.como(hkt.uid(3));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), filas, 'limpio.csv');
  PERFORM hkt.ok('D3 borradas sus actividades (las puentes caen en cascada), el mismo contenido ya no cuenta como duplicado y se aplica',
    NOT (v->'resumen'->>'duplicado_de_lote_aplicado')::boolean
    AND (public.plantillas_importar_aplicar((v->>'lote_id')::uuid)->>'actividades_creadas')::int = 3);
  PERFORM hkt.root();
END $$;

-- ── E · re-evaluación al aplicar ────────────────────────────────────────────
DO $$
DECLARE v jsonb; n0 int; msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), $j$[
    {"titulo":"Nueva E","cargo":"conserje","servicio":"limpieza","duracion_min":"5","insumos":"Bolsa"}
  ]$j$::jsonb, 'tarde.csv');
  PERFORM hkt.ok('E1 vista previa limpia', (v->'resumen'->>'con_error')::int = 0);
  -- Entre la vista previa y el guardado, alguien crea esa actividad a mano.
  PERFORM hkt.root();
  INSERT INTO public.plantillas_tarea_cargo (company_id, project_id, cargo, titulo, servicio) VALUES (hkt.ca(), hkt.pa1(), 'conserje', 'nueva e', 'otro');
  n0 := hkt.n_pl();
  PERFORM hkt.como(hkt.uid(3));
  msg := hkt.mensaje_de(format('SELECT public.plantillas_importar_aplicar(%L)', v->>'lote_id'));
  PERFORM hkt.ok('E2 al aplicar se re-evalúa contra HOY: la actividad ya existe → PLANTILLAS_IMPORT_CON_ERRORES y nada escrito',
    msg LIKE 'PLANTILLAS_IMPORT_CON_ERRORES%' AND hkt.n_pl() = n0 AND (hkt.lote((v->>'lote_id')::uuid)).estado = 'previsualizado');
  PERFORM hkt.root();
END $$;

-- ── F · descartar ───────────────────────────────────────────────────────────
DO $$
DECLARE v jsonb; d jsonb; aplicado uuid := ((SELECT j FROM hkt.res WHERE k = 'c')->>'lote_id')::uuid;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), '[{"titulo":"Dani","cargo":"conserje","servicio":"otro"}]'::jsonb, 'd.csv');
  d := public.plantillas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.ok('F1 descartar un lote previsualizado', d->>'estado' = 'descartado' AND (hkt.lote((v->>'lote_id')::uuid)).estado = 'descartado');
  PERFORM hkt.ok('F2 un lote descartado ya no se aplica → 23514', hkt.estado_de(format('SELECT public.plantillas_importar_aplicar(%L)', v->>'lote_id')) = '23514');
  PERFORM hkt.ok('F3 un lote aplicado no se descarta → 23514', hkt.estado_de(format('SELECT public.plantillas_importar_descartar(%L)', aplicado)) = '23514');
  PERFORM hkt.ok('F4 lote inexistente → 23514', hkt.estado_de(format('SELECT public.plantillas_importar_descartar(%L)', gen_random_uuid())) = '23514'
    AND hkt.estado_de(format('SELECT public.plantillas_importar_aplicar(%L)', gen_random_uuid())) = '23514');
  PERFORM hkt.root();
END $$;

-- ── G · permisos y alcance ──────────────────────────────────────────────────
DO $$
DECLARE fila constant text := '[{"titulo":"Eva","cargo":"conserje","servicio":"otro"}]';
        fila2 constant text := '[{"titulo":"Eva","cargo":"conserje","servicio":"otro","area":"Jardín","insumos":"Trapo","herramientas":"Trapeador"}]';
        fila3 constant text := '[{"titulo":"Eva","cargo":"conserje","servicio":"otro","insumos":"Escoba"}]';
        msg text; v jsonb; n0 int := hkt.n_pl();
BEGIN
  PERFORM hkt.como(hkt.uid(6));
  msg := hkt.mensaje_de(format('SELECT public.plantillas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv'));
  PERFORM hkt.ok('G1 ver la pestaña sin poder crear → PLANTILLAS_IMPORT_PERMISO (42501)', msg LIKE 'PLANTILLAS_IMPORT_PERMISO%'
    AND hkt.estado_de(format('SELECT public.plantillas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv')) = '42501');
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('G2 sin permiso del catálogo → 42501', hkt.estado_de(format('SELECT public.plantillas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv')) = '42501');
  PERFORM hkt.como(hkt.uid(4));
  msg := hkt.mensaje_de(format('SELECT public.plantillas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv'));
  PERFORM hkt.ok('G3 operadora de PA2 sobre PA1 → PLANTILLAS_IMPORT_PROYECTO (23514)', msg LIKE 'PLANTILLAS_IMPORT_PROYECTO%');
  v := public.plantillas_importar_previsualizar(hkt.pa2(), fila2::jsonb, 'g.csv');
  PERFORM hkt.ok('G4 … y sobre su proyecto sí (área, insumo y herramienta se resuelven en PA2)', (v->'resumen'->>'validas')::int = 1
    AND (hkt.fila(v, 1)->'datos'->>'area_id')::uuid = hkt.ar(6)
    AND (public.plantillas_importar_aplicar((v->>'lote_id')::uuid)->>'actividades_creadas')::int = 1);
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('G5 admin de OTRA empresa → 23514', hkt.estado_de(format('SELECT public.plantillas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv')) = '23514');
  PERFORM hkt.como(hkt.uid(1));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), fila3::jsonb, 'g.csv');
  PERFORM hkt.ok('G6 la dueña previsualiza sin permisos explícitos (y ve los insumos)', (v->'resumen'->>'validas')::int = 1);
  PERFORM public.plantillas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.como(hkt.uid(2));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), fila::jsonb, 'g.csv');
  PERFORM hkt.ok('G7 el admin acotado a PA1 también', (v->'resumen'->>'validas')::int = 1);
  PERFORM public.plantillas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.ok('G7b … pero no sobre PA2 (no asignado) → 23514', hkt.estado_de(format('SELECT public.plantillas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa2(), fila, 'g.csv')) = '23514');
  PERFORM hkt.como(hkt.uid(13));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), fila::jsonb, 'g.csv');
  PERFORM hkt.ok('G8 operadora con acceso por ASIGNACIÓN y permiso de crear: sí', (v->'resumen'->>'validas')::int = 1);
  PERFORM public.plantillas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.como(hkt.uid(11));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), fila3::jsonb, 'g.csv');
  PERFORM hkt.ok('G9 quien crea pero no edita también carga', (v->'resumen'->>'validas')::int = 1);
  PERFORM public.plantillas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.como(hkt.uid(10));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), fila3::jsonb, 'g.csv');
  PERFORM hkt.ok('G10 sin permiso de ver Suministros: un insumo por nombre falla con un mensaje claro (no «no existe»)',
    (v->'resumen'->>'con_error')::int = 1 AND hkt.err(v, 1, 'insumos') LIKE '%ver la pestaña Suministros%');
  v := public.plantillas_importar_previsualizar(hkt.pa1(), fila::jsonb, 'g.csv');
  PERFORM hkt.ok('G10b … y sin insumos carga normal', (v->'resumen'->>'validas')::int = 1);
  PERFORM public.plantillas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.como(hkt.uid(14));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), '[{"titulo":"Eva inv","cargo":"conserje","servicio":"otro","insumos":"Escoba","herramientas":"Trapeador","equipo":"Hidrolavadora"}]'::jsonb, 'g.csv');
  PERFORM hkt.ok('G10c sin permiso de ver Inventario: herramientas y equipo por nombre fallan con un mensaje claro; el insumo sí se resuelve',
    (v->'resumen'->>'con_error')::int = 1 AND hkt.err(v, 1, 'herramientas') LIKE '%ver la pestaña Inventario%'
    AND hkt.err(v, 1, 'equipo') LIKE '%ver la pestaña Inventario%' AND hkt.err(v, 1, 'insumos') IS NULL);
  v := public.plantillas_importar_previsualizar(hkt.pa1(), fila3::jsonb, 'g.csv');
  PERFORM hkt.ok('G10d … y con solo insumos carga normal', (v->'resumen'->>'validas')::int = 1);
  PERFORM public.plantillas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.como(gen_random_uuid());
  PERFORM hkt.ok('G11 sesión sin perfil → 42501', hkt.estado_de(format('SELECT public.plantillas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv')) = '42501');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('G12 anon → 42501', hkt.estado_de(format('SELECT public.plantillas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv')) = '42501');
  PERFORM hkt.como(hkt.uid(3));
  msg := hkt.mensaje_de(format('SELECT public.plantillas_importar_previsualizar(%L, (SELECT jsonb_agg(%L::jsonb) FROM generate_series(1, 501)), %L)', hkt.pa1(), '{"titulo":"x"}', 'g.csv'));
  PERFORM hkt.ok('G13 501 filas → PLANTILLAS_IMPORT_LIMITE', msg LIKE 'PLANTILLAS_IMPORT_LIMITE%');
  PERFORM hkt.ok('G14 sin filas → PLANTILLAS_IMPORT_VACIA', hkt.mensaje_de(format('SELECT public.plantillas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), '[]', 'g.csv')) LIKE 'PLANTILLAS_IMPORT_VACIA%');
  PERFORM hkt.ok('G15 proyecto inexistente → PLANTILLAS_IMPORT_PROYECTO', hkt.mensaje_de(format('SELECT public.plantillas_importar_previsualizar(%L, %L::jsonb, %L)', gen_random_uuid(), fila, 'g.csv')) LIKE 'PLANTILLAS_IMPORT_PROYECTO%');
  PERFORM hkt.ok('G16 nada de lo anterior escribió actividades (salvo la de PA2)', hkt.n_pl() = n0 + 1);
  PERFORM hkt.root();
END $$;

-- ── H · candado por RPC y lectura de lotes ──────────────────────────────────
DO $$
DECLARE aplicado uuid := ((SELECT j FROM hkt.res WHERE k = 'c')->>'lote_id')::uuid; msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  msg := hkt.mensaje_de(format($f$INSERT INTO public.plantillas_importaciones (company_id, project_id, contenido_sha256) VALUES (%L, %L, 'x')$f$, hkt.ca(), hkt.pa1()));
  PERFORM hkt.ok('H1 ni la dueña fabrica un lote a mano → PLANTILLAS_IMPORT_SOLO_RPC (42501)', msg LIKE 'PLANTILLAS_IMPORT_SOLO_RPC%'
    AND hkt.estado_de(format($f$INSERT INTO public.plantillas_importaciones (company_id, project_id, contenido_sha256) VALUES (%L, %L, 'x')$f$, hkt.ca(), hkt.pa1())) = '42501');
  PERFORM hkt.ok('H2 ni marca «aplicado» a mano → 42501', hkt.estado_de(format($f$UPDATE public.plantillas_importaciones SET estado = 'descartado' WHERE id = %L$f$, aplicado)) = '42501');
  PERFORM hkt.ok('H3 ni inserta filas a mano → 42501', hkt.estado_de(format($f$INSERT INTO public.plantillas_importacion_filas (lote_id, company_id, fila, origen) VALUES (%L, %L, 99, '{}')$f$, aplicado, hkt.ca())) = '42501');
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('H4 la operadora lee los lotes de su proyecto', (SELECT count(*) FROM public.plantillas_importaciones WHERE project_id = hkt.pa1()) >= 5
    AND (SELECT count(*) FROM public.plantillas_importacion_filas f JOIN public.plantillas_importaciones l ON l.id = f.lote_id WHERE l.id = aplicado) = 3);
  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('H5 la operadora de PA2 solo ve los de PA2', (SELECT count(*) FROM public.plantillas_importaciones WHERE project_id = hkt.pa1()) = 0
    AND (SELECT count(*) FROM public.plantillas_importaciones WHERE project_id = hkt.pa2()) = 1);
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('H6 otra empresa no ve ninguno', (SELECT count(*) FROM public.plantillas_importaciones) = 0 AND (SELECT count(*) FROM public.plantillas_importacion_filas) = 0);
  PERFORM hkt.ok('H7 nadie borra lotes por la API', hkt.estado_de(format('DELETE FROM public.plantillas_importaciones WHERE id = %L', aplicado)) = '42501');
  PERFORM hkt.root();
END $$;

-- ── I · inventario ──────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.ok('I1 RLS activa en las dos tablas, con policies',
    (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('plantillas_importaciones', 'plantillas_importacion_filas'))
    AND (SELECT count(DISTINCT tablename) FROM pg_policies WHERE tablename IN ('plantillas_importaciones', 'plantillas_importacion_filas')) = 2);
  PERFORM hkt.ok('I2 ACL: las RPC para authenticated, nunca anon; el trigger del candado no es ejecutable',
    has_function_privilege('authenticated', 'public.plantillas_importar_previsualizar(uuid,jsonb,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.plantillas_importar_previsualizar(uuid,jsonb,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.plantillas_importar_aplicar(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.plantillas_importar_aplicar(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.plantillas_importar_descartar(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.plantillas_importar_descartar(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.plantillas_recursos_en_bloque(uuid,uuid[],text,jsonb,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.plantillas_recursos_en_bloque(uuid,uuid[],text,jsonb,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.plantillas_import_evaluar(uuid,uuid,jsonb,int)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.plantillas_tg_imp_solo_rpc()', 'EXECUTE'));
  PERFORM hkt.ok('I3 las RPC son SECURITY INVOKER (rigen las RLS del catálogo y de las puentes del llamador)',
    (SELECT bool_and(NOT prosecdef) FROM pg_proc WHERE proname IN ('plantillas_importar_previsualizar', 'plantillas_importar_aplicar', 'plantillas_importar_descartar', 'plantillas_import_evaluar', 'plantillas_recursos_en_bloque')));
  PERFORM hkt.ok('I4 anon y authenticated no tienen DELETE sobre los lotes',
    NOT has_table_privilege('authenticated', 'public.plantillas_importaciones', 'DELETE') AND NOT has_table_privilege('anon', 'public.plantillas_importaciones', 'SELECT'));
END $$;

-- ── J · recursos en bloque ──────────────────────────────────────────────────
DO $$
DECLARE p1 uuid := hkt.pl_id('Barrido de gradas', hkt.pa1()); p2 uuid := hkt.pl_id('Mínima', hkt.pa1()); p3 uuid := hkt.pl_id('Poda', hkt.pa1());
        r jsonb; s0 int; h0 int; msg text;
        sum1 constant text := '[{"id":"ac000000-0000-0000-0000-000000000001","cantidad":2},{"id":"ac000000-0000-0000-0000-000000000002"}]';
        inv1 constant text := '[{"id":"ad000000-0000-0000-0000-000000000004","obligatoria":true}]';
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  r := public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p1, p2, p3], 'agregar', sum1::jsonb, inv1::jsonb);
  PERFORM hkt.ok('J1 agregar 2 insumos + 1 equipo a 3 actividades: 9 pares, 6 agregados y 3 que ya estaban (Barrido ya tenía Escoba y Bolsa; Poda, la Pulidora)',
    (r->>'plantillas')::int = 3 AND (r->>'recursos')::int = 3 AND (r->>'pares')::int = 9 AND (r->>'agregados')::int = 6 AND (r->>'ya_estaban')::int = 3
    AND (r->>'quitados')::int = 0);
  PERFORM hkt.ok('J2 los pares nuevos llevan la cantidad y la obligatoria pedidas, el tenant del trigger y creado_por; los existentes no cambian',
    (hkt.ps(p2, hkt.su(1))).cantidad = 2 AND (hkt.ps(p2, hkt.su(2))).cantidad = 1 AND (hkt.ps(p2, hkt.su(1))).creado_por = hkt.uid(3)
    AND (hkt.ps(p2, hkt.su(1))).company_id = hkt.ca() AND (hkt.ph(p2, hkt.inv(4))).obligatoria AND (hkt.ph(p1, hkt.inv(4))).obligatoria
    AND (hkt.ps(p1, hkt.su(2))).cantidad = 3 AND (hkt.ps(p1, hkt.su(1))).cantidad = 1);
  r := public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p1, p2, p3], 'agregar', sum1::jsonb, inv1::jsonb);
  PERFORM hkt.ok('J3 repetir la misma operación: 0 agregados, 9 ya estaban (ON CONFLICT DO NOTHING)', (r->>'agregados')::int = 0 AND (r->>'ya_estaban')::int = 9);
  r := public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p1, p2, p3], 'quitar', '[{"id":"ac000000-0000-0000-0000-000000000001"}]'::jsonb, '[]'::jsonb);
  PERFORM hkt.ok('J4 quitar Escoba de las 3: 3 quitados, 0 no estaban; Bolsa sigue', (r->>'quitados')::int = 3 AND (r->>'no_estaban')::int = 0
    AND (hkt.ps(p1, hkt.su(1))).id IS NULL AND (hkt.ps(p1, hkt.su(2))).id IS NOT NULL);
  r := public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p1, p2, p3], 'quitar', '[{"id":"ac000000-0000-0000-0000-000000000001"}]'::jsonb, '[]'::jsonb);
  PERFORM hkt.ok('J5 quitar otra vez: 0 quitados, 3 no estaban', (r->>'quitados')::int = 0 AND (r->>'no_estaban')::int = 3);
  s0 := hkt.n_ps(); h0 := hkt.n_ph();
  msg := hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L, %L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p1, hkt.pl(3), 'agregar', sum1, '[]'));
  PERFORM hkt.ok('J6 una actividad de OTRO proyecto en la lista → PLANTILLAS_BLOQUE_ALCANCE (23514) y nada escrito', msg LIKE 'PLANTILLAS_BLOQUE_ALCANCE%'
    AND hkt.estado_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L, %L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p1, hkt.pl(3), 'agregar', sum1, '[]')) = '23514'
    AND hkt.n_ps() = s0);
  PERFORM hkt.ok('J7 un insumo de OTRO proyecto (junto a uno válido) → 23514 y nada escrito (atómico)',
    hkt.estado_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar',
      '[{"id":"ac000000-0000-0000-0000-000000000001"},{"id":"ac000000-0000-0000-0000-000000000006"}]', '[]')) = '23514' AND hkt.n_ps() = s0);
  PERFORM hkt.ok('J8 un insumo inactivo no se agrega → 23514; quitarlo sí se admite (0 quitados)',
    hkt.estado_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', '[{"id":"ac000000-0000-0000-0000-000000000003"}]', '[]')) = '23514'
    AND (public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p2], 'quitar', '[{"id":"ac000000-0000-0000-0000-000000000003"}]'::jsonb, '[]'::jsonb)->>'quitados')::int = 0);
  PERFORM hkt.ok('J9 equipo dado de baja no se agrega → 23514',
    hkt.estado_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', '[]', '[{"id":"ad000000-0000-0000-0000-000000000005"}]')) = '23514');
  PERFORM hkt.ok('J10 acción inválida → PLANTILLAS_BLOQUE_ACCION', hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'x', sum1, '[]')) LIKE 'PLANTILLAS_BLOQUE_ACCION%');
  PERFORM hkt.ok('J11 sin actividades → VACIO; sin recursos → VACIO',
    hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), 'agregar', sum1, '[]')) LIKE 'PLANTILLAS_BLOQUE_VACIO%'
    AND hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', '[]', '[]')) LIKE 'PLANTILLAS_BLOQUE_VACIO%');
  PERFORM hkt.ok('J12 cantidad 0 o decimal en herramienta → PLANTILLAS_BLOQUE_RECURSO',
    hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', '[{"id":"ac000000-0000-0000-0000-000000000001","cantidad":0}]', '[]')) LIKE 'PLANTILLAS_BLOQUE_RECURSO%'
    AND hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', '[]', '[{"id":"ad000000-0000-0000-0000-000000000001","cantidad":1.5}]')) LIKE 'PLANTILLAS_BLOQUE_RECURSO%');
  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('J13 quien solo ve → PLANTILLAS_BLOQUE_PERMISO (42501)', hkt.estado_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', sum1, '[]')) = '42501');
  PERFORM hkt.como(hkt.uid(11));
  PERFORM hkt.ok('J14 quien crea pero no edita → 42501', hkt.estado_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', sum1, '[]')) = '42501');
  PERFORM hkt.como(hkt.uid(10));
  msg := hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', sum1, '[]'));
  PERFORM hkt.ok('J15 quien edita pero no ve Suministros: insumos → PERMISO con mensaje claro; herramientas sí',
    msg LIKE 'PLANTILLAS_BLOQUE_PERMISO%Suministros%'
    AND (public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p2], 'agregar', '[]'::jsonb, '[{"id":"ad000000-0000-0000-0000-000000000001"}]'::jsonb)->>'agregados')::int = 1);
  PERFORM hkt.como(hkt.uid(14));
  msg := hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', '[]', '[{"id":"ad000000-0000-0000-0000-000000000002"}]'));
  PERFORM hkt.ok('J15b quien edita pero no ve Inventario: herramientas → PERMISO con mensaje claro; insumos sí',
    msg LIKE 'PLANTILLAS_BLOQUE_PERMISO%Inventario%'
    AND (public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p2], 'agregar', '[{"id":"ac000000-0000-0000-0000-000000000002"}]'::jsonb, '[]'::jsonb)->>'ya_estaban')::int = 1);
  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('J16 operadora de PA2 sobre PA1 → PLANTILLAS_BLOQUE_PROYECTO', hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', sum1, '[]')) LIKE 'PLANTILLAS_BLOQUE_PROYECTO%');
  PERFORM hkt.como(hkt.uid(1));
  r := public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p1, p2, p3], 'agregar', '[{"id":"ac000000-0000-0000-0000-000000000001","cantidad":5}]'::jsonb, '[]'::jsonb);
  PERFORM hkt.ok('J17 la dueña agrega sin permisos explícitos (3 agregados, cantidad 5)', (r->>'agregados')::int = 3 AND (hkt.ps(p3, hkt.su(1))).cantidad = 5);
  PERFORM hkt.como(gen_random_uuid());
  PERFORM hkt.ok('J18 sesión sin perfil → 42501', hkt.estado_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', sum1, '[]')) = '42501');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('J19 anon → 42501', hkt.estado_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', sum1, '[]')) = '42501');
  PERFORM hkt.root();
END $$;
