-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261031000100_str_reservas_importar, ejercidas COMO cada persona
-- (JWT emulado + rol authenticated/anon).
--   A · vista previa: cada regla por campo, código repetido (existente / en el archivo),
--       solape y fila repetida como avisos, defectos; no escribe reservas
--   B · aplicar con errores: todo o nada, nada escrito
--   C · aplicar OK: reservas confirmadas con creado_por, unidad resuelta, total calculado;
--       reaplicar devuelve «reutilizada»
--   D · el mismo contenido no se importa dos veces mientras sus reservas sigan
--   E · re-evaluación al aplicar contra el estado de HOY
--   F · descartar
--   G · permisos y alcance: sin crear, sin permiso, otro proyecto, otra empresa, sin perfil,
--       anon, límite, vacío, proyecto inexistente; quién sí
--   H · candado: los lotes solo los escriben las RPC; quién los lee
--   I · inventario: ACL y RLS
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

CREATE OR REPLACE FUNCTION hkt.fila(p_vista jsonb, p_n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT f FROM jsonb_array_elements(p_vista->'filas') f WHERE (f->>'fila')::int = p_n $$;
CREATE OR REPLACE FUNCTION hkt.err(p_vista jsonb, p_n int, p_campo text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(e->>'mensaje', ' | ') FROM jsonb_array_elements(hkt.fila(p_vista, p_n)->'errores') e WHERE e->>'campo' = p_campo $$;
CREATE OR REPLACE FUNCTION hkt.adv(p_vista jsonb, p_n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(e->>'mensaje', ' | ') FROM jsonb_array_elements(hkt.fila(p_vista, p_n)->'advertencias') e $$;
CREATE OR REPLACE FUNCTION hkt.n_reservas() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*)::int FROM public.reservas_str $$;
CREATE OR REPLACE FUNCTION hkt.lote(p_id uuid) RETURNS public.str_importaciones LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.str_importaciones WHERE id = p_id $$;
CREATE TABLE IF NOT EXISTS hkt.res (k text PRIMARY KEY, j jsonb);
GRANT ALL ON hkt.res TO authenticated, anon, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- ── A · vista previa con errores por campo ──────────────────────────────────
DO $$
DECLARE v jsonb; n0 int := hkt.n_reservas(); l public.str_importaciones;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.str_reservas_importar_previsualizar(hkt.pa1(), $j$[
    {"unidad":"apto 1a","huesped_nombre":"Ana López","huesped_email":"ana@x.test","huesped_telefono":"+502 5555 0001","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12","hora_llegada_estimada":"15:00","hora_salida_estimada":"11:00","num_adultos":"2","num_ninos":"1","plataforma":"Airbnb","codigo_confirmacion":"HM-100","monto_noche":"100","politica_cancelacion":"flexible","mascotas":"sí","notas":"Cuna"},
    {"unidad":"Nada","huesped_nombre":"Beto","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12"},
    {"unidad":"dup","huesped_nombre":"Beto","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12"},
    {"unidad":"Vieja","huesped_nombre":"Beto","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12"},
    {"unidad":"Casa 3","huesped_nombre":"Beto","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-12","fecha_salida":"2026-12-10"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-13-01","fecha_salida":"2026-12-10"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12","hora_llegada_estimada":"25:00"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12","num_adultos":"0"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12","plataforma":"expedia"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12","politica_cancelacion":"rara"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12","monto_noche":"abc"},
    {"unidad":"Apto 2B","huesped_nombre":"B","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","huesped_email":"no-es-correo","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12","notas":"=cmd|' /C calc'!A0"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12","estado":"cancelada"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-20","fecha_salida":"2026-12-22","codigo_confirmacion":"hm-001"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-20","fecha_salida":"2026-12-22","codigo_confirmacion":"HM-003"},
    {"unidad":"Apto 1A","huesped_nombre":"Solapado","fecha_entrada":"2026-11-10","fecha_salida":"2026-11-11"},
    {"unidad":"apto 1a","huesped_nombre":"Ana López","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-24","fecha_salida":"2026-12-26","codigo_confirmacion":"HM-100"},
    {"unidad":"Apto 2B","huesped_nombre":"Mínimo","fecha_entrada":"2026-12-28","fecha_salida":"2026-12-29"}
  ]$j$::jsonb, 'prueba.csv');
  INSERT INTO hkt.res VALUES ('a', v);
  PERFORM hkt.ok('A0 la vista previa cuenta las 22 filas: 5 válidas, 17 con error, sin duplicado de lote', (v->'resumen'->>'total')::int = 22
    AND (v->'resumen'->>'validas')::int = 5 AND (v->'resumen'->>'con_error')::int = 17 AND (v->'resumen'->>'duplicado_de_lote_aplicado')::boolean = false
    AND (v->>'project_id')::uuid = hkt.pa1());
  PERFORM hkt.ok('A1 fila válida: unidad resuelta sin mayúsculas, total = noches × monto_noche, mascotas sí, plataforma normalizada, horas, personas',
    (hkt.fila(v, 1)->'datos'->>'unidad_id')::uuid = hkt.un(1) AND (hkt.fila(v, 1)->'datos'->>'noches')::int = 2
    AND (hkt.fila(v, 1)->'datos'->>'monto_total')::numeric = 200 AND (hkt.fila(v, 1)->'datos'->>'mascotas')::boolean
    AND hkt.fila(v, 1)->'datos'->>'plataforma' = 'airbnb' AND hkt.fila(v, 1)->'datos'->>'hora_llegada_estimada' = '15:00:00'
    AND (hkt.fila(v, 1)->'datos'->>'num_adultos')::int = 2 AND (hkt.fila(v, 1)->'datos'->>'num_ninos')::int = 1
    AND hkt.fila(v, 1)->'datos'->>'estado' = 'confirmada' AND hkt.fila(v, 1)->'datos'->>'codigo_confirmacion' = 'HM-100'
    AND jsonb_array_length(hkt.fila(v, 1)->'errores') = 0);
  PERFORM hkt.ok('A2 unidad inexistente → error (la importación no crea unidades)', hkt.err(v, 2, 'unidad') LIKE '%no existe%no crea unidades%');
  PERFORM hkt.ok('A3 nombre de unidad repetido en el proyecto → ambigua', hkt.err(v, 3, 'unidad') LIKE '%ambiguo%');
  PERFORM hkt.ok('A4 unidad inactiva → no existe', hkt.err(v, 4, 'unidad') LIKE '%no existe%');
  PERFORM hkt.ok('A5 unidad de OTRO proyecto de la empresa → no existe aquí', hkt.err(v, 5, 'unidad') LIKE '%no existe%');
  PERFORM hkt.ok('A6 salida antes de la entrada → error', hkt.err(v, 6, 'fecha_salida') LIKE '%posterior a la entrada%');
  PERFORM hkt.ok('A7 fecha que no existe → error', hkt.err(v, 7, 'fecha_entrada') LIKE '%no existe%');
  PERFORM hkt.ok('A8 hora que no existe → error', hkt.err(v, 8, 'hora_llegada_estimada') LIKE '%no existe%');
  PERFORM hkt.ok('A9 adultos 0 → error', hkt.err(v, 9, 'num_adultos') IS NOT NULL);
  PERFORM hkt.ok('A10 plataforma fuera del catálogo → error', hkt.err(v, 10, 'plataforma') LIKE '%Plataforma inválida%');
  PERFORM hkt.ok('A11 política fuera del catálogo → error', hkt.err(v, 11, 'politica_cancelacion') LIKE '%Política inválida%');
  PERFORM hkt.ok('A12 monto no numérico → error', hkt.err(v, 12, 'monto_noche') IS NOT NULL);
  PERFORM hkt.ok('A13 nombre de 1 carácter → error', hkt.err(v, 13, 'huesped_nombre') IS NOT NULL);
  PERFORM hkt.ok('A14 correo inválido → error', hkt.err(v, 14, 'huesped_email') IS NOT NULL);
  PERFORM hkt.ok('A15 fórmula en una celda → error', hkt.err(v, 15, 'notas') LIKE '%posible fórmula%');
  PERFORM hkt.ok('A16 columna «estado» → rechazada (el archivo no decide el estado)', hkt.err(v, 16, 'estado') LIKE '%no se admite%');
  PERFORM hkt.ok('A17 código ya usado por una reserva NO cancelada (sin distinguir mayúsculas) → error', hkt.err(v, 17, 'codigo_confirmacion') LIKE '%Ya hay una reserva con el código%');
  PERFORM hkt.ok('A18 código de una reserva CANCELADA → se admite', jsonb_array_length(hkt.fila(v, 18)->'errores') = 0);
  PERFORM hkt.ok('A19 solape con una reserva no cancelada de la unidad → válida con aviso', jsonb_array_length(hkt.fila(v, 19)->'errores') = 0 AND hkt.adv(v, 19) LIKE '%solapa%');
  PERFORM hkt.ok('A20 fila que repite otra del archivo (unidad, fechas, huésped) → válida con aviso', jsonb_array_length(hkt.fila(v, 20)->'errores') = 0 AND hkt.adv(v, 20) LIKE '%repite otra%');
  PERFORM hkt.ok('A21 código repetido dentro del archivo → error en la fila posterior', hkt.err(v, 21, 'codigo_confirmacion') LIKE '%se repite en otra fila%');
  PERFORM hkt.ok('A22 fila mínima: valores por omisión (1 adulto, directo, na, sin mascotas, sin montos)',
    jsonb_array_length(hkt.fila(v, 22)->'errores') = 0 AND (hkt.fila(v, 22)->'datos'->>'num_adultos')::int = 1
    AND hkt.fila(v, 22)->'datos'->>'plataforma' = 'directo' AND hkt.fila(v, 22)->'datos'->>'politica_cancelacion' = 'na'
    AND NOT (hkt.fila(v, 22)->'datos'->>'mascotas')::boolean AND hkt.fila(v, 22)->'datos'->>'monto_total' IS NULL);
  l := hkt.lote((v->>'lote_id')::uuid);
  PERFORM hkt.ok('A23 el lote queda «previsualizado» con sus 22 filas y quién lo cargó; ninguna reserva escrita',
    l.estado = 'previsualizado' AND l.created_by = hkt.uid(3) AND l.company_id = hkt.ca() AND l.project_id = hkt.pa1()
    AND (SELECT count(*) FROM public.str_importacion_filas WHERE lote_id = l.id) = 22 AND hkt.n_reservas() = n0
    AND (l.resumen->>'con_error')::int = 17);
  PERFORM hkt.root();
END $$;

-- ── B · aplicar con errores: nada ───────────────────────────────────────────
DO $$
DECLARE v jsonb := (SELECT j FROM hkt.res WHERE k = 'a'); n0 int := hkt.n_reservas(); msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  msg := hkt.mensaje_de(format('SELECT public.str_reservas_importar_aplicar(%L)', v->>'lote_id'));
  PERFORM hkt.ok('B1 aplicar un lote con errores → STR_IMPORT_CON_ERRORES (23514), todo o nada', msg LIKE 'STR_IMPORT_CON_ERRORES: 17 fila(s)%'
    AND hkt.estado_de(format('SELECT public.str_reservas_importar_aplicar(%L)', v->>'lote_id')) = '23514');
  PERFORM hkt.ok('B2 ninguna reserva escrita y el lote sigue «previsualizado»', hkt.n_reservas() = n0 AND (hkt.lote((v->>'lote_id')::uuid)).estado = 'previsualizado');
  PERFORM hkt.root();
END $$;

-- ── C · aplicar OK ──────────────────────────────────────────────────────────
DO $$
DECLARE v jsonb; r jsonb; r2 jsonb; n0 int := hkt.n_reservas(); l public.str_importaciones; x public.reservas_str;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.str_reservas_importar_previsualizar(hkt.pa1(), $j$[
    {"unidad":"Apto 1A","huesped_nombre":"Ana López","huesped_email":"ana@x.test","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12","hora_llegada_estimada":"15:00","num_adultos":"2","plataforma":"airbnb","codigo_confirmacion":"HM-100","monto_noche":"100","politica_cancelacion":"flexible","mascotas":"si","notas":"Cuna"},
    {"unidad":"Apto 2B","huesped_nombre":"Mínimo","fecha_entrada":"2026-12-28","fecha_salida":"2026-12-29"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-20","fecha_salida":"2026-12-22","codigo_confirmacion":"HM-003","monto_noche":"50","monto_total":"90"}
  ]$j$::jsonb, 'limpio.csv');
  INSERT INTO hkt.res VALUES ('c', v);
  PERFORM hkt.ok('C1 archivo limpio: 3 válidas', (v->'resumen'->>'validas')::int = 3 AND (v->'resumen'->>'con_error')::int = 0);
  r := public.str_reservas_importar_aplicar((v->>'lote_id')::uuid);
  INSERT INTO hkt.res VALUES ('c_res', r);
  PERFORM hkt.ok('C2 aplicar crea 3 reservas y devuelve sus ids', (r->>'reservas_creadas')::int = 3 AND jsonb_array_length(r->'reserva_ids') = 3
    AND (r->>'reutilizada')::boolean = false AND hkt.n_reservas() = n0 + 3);
  SELECT * INTO x FROM public.reservas_str WHERE codigo_confirmacion = 'HM-100';
  PERFORM hkt.ok('C3 la reserva nace confirmada, en la unidad resuelta, con total calculado y creado_por sellado por la base',
    x.estado = 'confirmada' AND x.unidad_id = hkt.un(1) AND x.company_id = hkt.ca() AND x.project_id = hkt.pa1()
    AND x.monto_total = 200 AND x.monto_noche = 100 AND x.mascotas AND x.plataforma = 'airbnb' AND x.politica_cancelacion = 'flexible'
    AND x.hora_llegada_estimada = time '15:00' AND x.num_adultos = 2 AND x.huesped_email = 'ana@x.test' AND x.notas = 'Cuna'
    AND x.creado_por = hkt.uid(3));
  SELECT * INTO x FROM public.reservas_str WHERE huesped_nombre = 'Beto' AND codigo_confirmacion = 'HM-003' AND estado = 'confirmada';
  PERFORM hkt.ok('C4 un monto_total explícito se respeta (no se recalcula)', x.monto_total = 90 AND x.monto_noche = 50);
  l := hkt.lote((v->>'lote_id')::uuid);
  PERFORM hkt.ok('C5 el lote queda «aplicado», con quién y cuándo, y su resultado', l.estado = 'aplicado' AND l.aplicado_por = hkt.uid(3) AND l.aplicado_at IS NOT NULL
    AND (l.resultado->>'reservas_creadas')::int = 3);
  r2 := public.str_reservas_importar_aplicar((v->>'lote_id')::uuid);
  PERFORM hkt.ok('C6 reaplicar el mismo lote devuelve el resultado con «reutilizada» y no duplica', (r2->>'reutilizada')::boolean AND (r2->>'reservas_creadas')::int = 3
    AND r2->'reserva_ids' = r->'reserva_ids' AND hkt.n_reservas() = n0 + 3);
  PERFORM hkt.root();
END $$;

-- ── D · el mismo contenido no entra dos veces ───────────────────────────────
DO $$
DECLARE v jsonb; n0 int := hkt.n_reservas(); ids uuid[]; msg text;
  filas jsonb := $j$[
    {"unidad":"Apto 1A","huesped_nombre":"Ana López","huesped_email":"ana@x.test","fecha_entrada":"2026-12-10","fecha_salida":"2026-12-12","hora_llegada_estimada":"15:00","num_adultos":"2","plataforma":"airbnb","codigo_confirmacion":"HM-100","monto_noche":"100","politica_cancelacion":"flexible","mascotas":"si","notas":"Cuna"},
    {"unidad":"Apto 2B","huesped_nombre":"Mínimo","fecha_entrada":"2026-12-28","fecha_salida":"2026-12-29"},
    {"unidad":"Apto 2B","huesped_nombre":"Beto","fecha_entrada":"2026-12-20","fecha_salida":"2026-12-22","codigo_confirmacion":"HM-003","monto_noche":"50","monto_total":"90"}
  ]$j$::jsonb;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.str_reservas_importar_previsualizar(hkt.pa1(), filas, 'limpio.csv');
  PERFORM hkt.ok('D1 el mismo contenido otra vez: la vista previa lo marca como duplicado de un lote aplicado (y las filas con código ahora tienen error)',
    (v->'resumen'->>'duplicado_de_lote_aplicado')::boolean AND hkt.err(v, 1, 'codigo_confirmacion') LIKE '%Ya hay una reserva%');
  msg := hkt.mensaje_de(format('SELECT public.str_reservas_importar_aplicar(%L)', v->>'lote_id'));
  PERFORM hkt.ok('D2 aplicarlo → STR_IMPORT_DUPLICADO (23505) antes de evaluar nada', msg LIKE 'STR_IMPORT_DUPLICADO%'
    AND hkt.estado_de(format('SELECT public.str_reservas_importar_aplicar(%L)', v->>'lote_id')) = '23505' AND hkt.n_reservas() = n0);
  -- Si las reservas de ese lote ya no están, el mismo contenido puede volver a cargarse.
  PERFORM hkt.root();
  SELECT array_agg(x::uuid) INTO ids FROM jsonb_array_elements_text((SELECT j FROM hkt.res WHERE k = 'c_res')->'reserva_ids') x;
  DELETE FROM public.reservas_str WHERE id = ANY (ids);
  PERFORM hkt.como(hkt.uid(3));
  v := public.str_reservas_importar_previsualizar(hkt.pa1(), filas, 'limpio.csv');
  PERFORM hkt.ok('D3 borradas sus reservas, el mismo contenido ya no cuenta como duplicado y se aplica',
    NOT (v->'resumen'->>'duplicado_de_lote_aplicado')::boolean
    AND (public.str_reservas_importar_aplicar((v->>'lote_id')::uuid)->>'reservas_creadas')::int = 3);
  PERFORM hkt.root();
END $$;

-- ── E · re-evaluación al aplicar ────────────────────────────────────────────
DO $$
DECLARE v jsonb; n0 int; msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.str_reservas_importar_previsualizar(hkt.pa1(), $j$[
    {"unidad":"Apto 2B","huesped_nombre":"Carla","fecha_entrada":"2027-03-01","fecha_salida":"2027-03-03","codigo_confirmacion":"HM-200"}
  ]$j$::jsonb, 'tarde.csv');
  PERFORM hkt.ok('E1 vista previa limpia', (v->'resumen'->>'con_error')::int = 0);
  -- Entre la vista previa y el guardado, alguien carga ese código a mano.
  PERFORM hkt.root();
  INSERT INTO public.reservas_str (company_id, project_id, unidad_id, huesped_nombre, fecha_entrada, fecha_salida, codigo_confirmacion)
    VALUES (hkt.ca(), hkt.pa1(), hkt.un(2), 'Manual', '2027-05-01', '2027-05-02', 'HM-200');
  n0 := hkt.n_reservas();
  PERFORM hkt.como(hkt.uid(3));
  msg := hkt.mensaje_de(format('SELECT public.str_reservas_importar_aplicar(%L)', v->>'lote_id'));
  PERFORM hkt.ok('E2 al aplicar se re-evalúa contra HOY: el código ya existe → STR_IMPORT_CON_ERRORES y nada escrito',
    msg LIKE 'STR_IMPORT_CON_ERRORES%' AND hkt.n_reservas() = n0 AND (hkt.lote((v->>'lote_id')::uuid)).estado = 'previsualizado');
  PERFORM hkt.root();
END $$;

-- ── F · descartar ───────────────────────────────────────────────────────────
DO $$
DECLARE v jsonb; d jsonb; aplicado uuid := ((SELECT j FROM hkt.res WHERE k = 'c')->>'lote_id')::uuid;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.str_reservas_importar_previsualizar(hkt.pa1(), '[{"unidad":"Apto 2B","huesped_nombre":"Dani","fecha_entrada":"2027-04-01","fecha_salida":"2027-04-02"}]'::jsonb, 'd.csv');
  d := public.str_reservas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.ok('F1 descartar un lote previsualizado', d->>'estado' = 'descartado' AND (hkt.lote((v->>'lote_id')::uuid)).estado = 'descartado');
  PERFORM hkt.ok('F2 un lote descartado ya no se aplica → 23514', hkt.estado_de(format('SELECT public.str_reservas_importar_aplicar(%L)', v->>'lote_id')) = '23514');
  PERFORM hkt.ok('F3 un lote aplicado no se descarta → 23514', hkt.estado_de(format('SELECT public.str_reservas_importar_descartar(%L)', aplicado)) = '23514');
  PERFORM hkt.ok('F4 lote inexistente → 23514', hkt.estado_de(format('SELECT public.str_reservas_importar_descartar(%L)', gen_random_uuid())) = '23514'
    AND hkt.estado_de(format('SELECT public.str_reservas_importar_aplicar(%L)', gen_random_uuid())) = '23514');
  PERFORM hkt.root();
END $$;

-- ── G · permisos y alcance ──────────────────────────────────────────────────
DO $$
DECLARE fila constant text := '[{"unidad":"Apto 2B","huesped_nombre":"Eva","fecha_entrada":"2027-06-01","fecha_salida":"2027-06-02"}]';
        fila2 constant text := '[{"unidad":"Casa 3","huesped_nombre":"Eva","fecha_entrada":"2027-06-01","fecha_salida":"2027-06-02"}]';
        msg text; v jsonb; n0 int := hkt.n_reservas();
BEGIN
  PERFORM hkt.como(hkt.uid(6));
  msg := hkt.mensaje_de(format('SELECT public.str_reservas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv'));
  PERFORM hkt.ok('G1 ver la pestaña sin poder crear → STR_IMPORT_PERMISO (42501)', msg LIKE 'STR_IMPORT_PERMISO%'
    AND hkt.estado_de(format('SELECT public.str_reservas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv')) = '42501');
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('G2 sin permiso de STR → 42501', hkt.estado_de(format('SELECT public.str_reservas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv')) = '42501');
  PERFORM hkt.como(hkt.uid(4));
  msg := hkt.mensaje_de(format('SELECT public.str_reservas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv'));
  PERFORM hkt.ok('G3 operadora de PA2 sobre PA1 → STR_IMPORT_PROYECTO (23514)', msg LIKE 'STR_IMPORT_PROYECTO%');
  v := public.str_reservas_importar_previsualizar(hkt.pa2(), fila2::jsonb, 'g.csv');
  PERFORM hkt.ok('G4 … y sobre su proyecto sí (la unidad se resuelve en PA2)', (v->'resumen'->>'validas')::int = 1
    AND (public.str_reservas_importar_aplicar((v->>'lote_id')::uuid)->>'reservas_creadas')::int = 1);
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('G5 admin de OTRA empresa → 23514', hkt.estado_de(format('SELECT public.str_reservas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv')) = '23514');
  PERFORM hkt.como(hkt.uid(1));
  v := public.str_reservas_importar_previsualizar(hkt.pa1(), fila::jsonb, 'g.csv');
  PERFORM hkt.ok('G6 la dueña previsualiza sin permisos explícitos', (v->'resumen'->>'validas')::int = 1);
  PERFORM public.str_reservas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.como(hkt.uid(2));
  v := public.str_reservas_importar_previsualizar(hkt.pa1(), fila::jsonb, 'g.csv');
  PERFORM hkt.ok('G7 el admin acotado a PA1 también', (v->'resumen'->>'validas')::int = 1);
  PERFORM public.str_reservas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.ok('G7b … pero no sobre PA2 (no asignado) → 23514', hkt.estado_de(format('SELECT public.str_reservas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa2(), fila2, 'g.csv')) = '23514');
  PERFORM hkt.como(hkt.uid(13));
  v := public.str_reservas_importar_previsualizar(hkt.pa1(), fila::jsonb, 'g.csv');
  PERFORM hkt.ok('G8 operadora con acceso por ASIGNACIÓN y permiso de crear: sí', (v->'resumen'->>'validas')::int = 1);
  PERFORM public.str_reservas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.como(gen_random_uuid());
  PERFORM hkt.ok('G9 sesión sin perfil → 42501', hkt.estado_de(format('SELECT public.str_reservas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv')) = '42501');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('G10 anon → 42501', hkt.estado_de(format('SELECT public.str_reservas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), fila, 'g.csv')) = '42501');
  PERFORM hkt.como(hkt.uid(3));
  msg := hkt.mensaje_de(format('SELECT public.str_reservas_importar_previsualizar(%L, (SELECT jsonb_agg(%L::jsonb) FROM generate_series(1, 501)), %L)', hkt.pa1(), '{"unidad":"Apto 2B"}', 'g.csv'));
  PERFORM hkt.ok('G11 501 filas → STR_IMPORT_LIMITE', msg LIKE 'STR_IMPORT_LIMITE%');
  PERFORM hkt.ok('G12 sin filas → STR_IMPORT_VACIA', hkt.mensaje_de(format('SELECT public.str_reservas_importar_previsualizar(%L, %L::jsonb, %L)', hkt.pa1(), '[]', 'g.csv')) LIKE 'STR_IMPORT_VACIA%');
  PERFORM hkt.ok('G13 proyecto inexistente → STR_IMPORT_PROYECTO', hkt.mensaje_de(format('SELECT public.str_reservas_importar_previsualizar(%L, %L::jsonb, %L)', gen_random_uuid(), fila, 'g.csv')) LIKE 'STR_IMPORT_PROYECTO%');
  PERFORM hkt.ok('G14 nada de lo anterior escribió reservas (salvo la de PA2)', hkt.n_reservas() = n0 + 1);
  PERFORM hkt.root();
END $$;

-- ── H · candado por RPC y lectura de lotes ──────────────────────────────────
DO $$
DECLARE aplicado uuid := ((SELECT j FROM hkt.res WHERE k = 'c')->>'lote_id')::uuid; msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  msg := hkt.mensaje_de(format($f$INSERT INTO public.str_importaciones (company_id, project_id, contenido_sha256) VALUES (%L, %L, 'x')$f$, hkt.ca(), hkt.pa1()));
  PERFORM hkt.ok('H1 ni la dueña fabrica un lote a mano → STR_IMPORT_SOLO_RPC (42501)', msg LIKE 'STR_IMPORT_SOLO_RPC%'
    AND hkt.estado_de(format($f$INSERT INTO public.str_importaciones (company_id, project_id, contenido_sha256) VALUES (%L, %L, 'x')$f$, hkt.ca(), hkt.pa1())) = '42501');
  PERFORM hkt.ok('H2 ni marca «aplicado» a mano → 42501', hkt.estado_de(format($f$UPDATE public.str_importaciones SET estado = 'descartado' WHERE id = %L$f$, aplicado)) = '42501');
  PERFORM hkt.ok('H3 ni inserta filas a mano → 42501', hkt.estado_de(format($f$INSERT INTO public.str_importacion_filas (lote_id, company_id, fila, origen) VALUES (%L, %L, 99, '{}')$f$, aplicado, hkt.ca())) = '42501');
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('H4 la operadora lee los lotes de su proyecto', (SELECT count(*) FROM public.str_importaciones WHERE project_id = hkt.pa1()) >= 5
    AND (SELECT count(*) FROM public.str_importacion_filas f JOIN public.str_importaciones l ON l.id = f.lote_id WHERE l.id = aplicado) = 3);
  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('H5 la operadora de PA2 solo ve los de PA2', (SELECT count(*) FROM public.str_importaciones WHERE project_id = hkt.pa1()) = 0
    AND (SELECT count(*) FROM public.str_importaciones WHERE project_id = hkt.pa2()) = 1);
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('H6 otra empresa no ve ninguno', (SELECT count(*) FROM public.str_importaciones) = 0 AND (SELECT count(*) FROM public.str_importacion_filas) = 0);
  PERFORM hkt.ok('H7 nadie borra lotes por la API', hkt.estado_de(format('DELETE FROM public.str_importaciones WHERE id = %L', aplicado)) = '42501');
  PERFORM hkt.root();
END $$;

-- ── I · inventario ──────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.ok('I1 RLS activa en las dos tablas, con policies',
    (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('str_importaciones', 'str_importacion_filas'))
    AND (SELECT count(DISTINCT tablename) FROM pg_policies WHERE tablename IN ('str_importaciones', 'str_importacion_filas')) = 2);
  PERFORM hkt.ok('I2 ACL: las RPC para authenticated, nunca anon; el trigger del candado no es ejecutable',
    has_function_privilege('authenticated', 'public.str_reservas_importar_previsualizar(uuid,jsonb,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.str_reservas_importar_previsualizar(uuid,jsonb,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.str_reservas_importar_aplicar(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.str_reservas_importar_aplicar(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.str_reservas_importar_descartar(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.str_reservas_importar_descartar(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.str_import_evaluar(uuid,uuid,jsonb,int)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.str_tg_imp_solo_rpc()', 'EXECUTE'));
  PERFORM hkt.ok('I3 las RPC son SECURITY INVOKER (rige la RLS de reservas_str del llamador)',
    (SELECT bool_and(NOT prosecdef) FROM pg_proc WHERE proname IN ('str_reservas_importar_previsualizar', 'str_reservas_importar_aplicar', 'str_reservas_importar_descartar', 'str_import_evaluar')));
  PERFORM hkt.ok('I4 anon y authenticated no tienen DELETE sobre los lotes',
    NOT has_table_privilege('authenticated', 'public.str_importaciones', 'DELETE') AND NOT has_table_privilege('anon', 'public.str_importaciones', 'SELECT'));
END $$;
