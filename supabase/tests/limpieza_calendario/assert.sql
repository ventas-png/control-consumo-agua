-- ============================================================================
-- INVARIANTES de 20261103000000 (calendario de limpieza: rutinas por persona y día).
-- Corre sobre la cadena REAL + fixture.sql. Cada comprobación imprime
-- «OK  …»; la primera que no se cumple aborta la corrida.
--
--   A · LEER      el mes trae turnos, persona y jornada; basta VER el tab; sin
--                 el tab, sin acceso al condominio o desde la empresa vecina no
--                 se lee; el rango está acotado; anon ni la invoca.
--   B · ASIGNAR   crea las tareas del recorrido en el orden pedido (parada →
--                 paso, área de la parada, sin áreas inactivas), detrás de lo que
--                 había; no duplica; el calendario lo refleja. Ver no alcanza;
--                 sin acceso al condominio, día pasado, turno cerrado y rutinas
--                 inválidas se rechazan sin escribir nada.
--   C · QUITAR    borra sólo esa rutina; lo trabajado (foto, revisión) lo
--                 impide entero; quitar lo que no está es 0; quitar todo deja el
--                 turno libre para «Asignación turnos».
--   D · EXPOSICIÓN anon no invoca nada; los helpers internos no se exponen.
-- ============================================================================
\set ON_ERROR_STOP on

-- ── A · leer el mes ──────────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT lc.como('EDI');

SELECT lc.chk(
  (SELECT string_agg(personal_nombre || '|' || personal_cargo || '|' || (fecha - CURRENT_DATE) || '|' ||
                     COALESCE(jornada_nombre, '-') || '|' || COALESCE(jornada_codigo, '-') || '|' || estado,
                     ', ' ORDER BY fecha)
     FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE - 5, CURRENT_DATE + 10)),
  'Ana Pérez|conserje|-3|Mañana|MA|pendiente, Ana Pérez|conserje|5|Mañana|MA|pendiente, '
  || 'Ana Pérez|conserje|6|Mañana|MA|pendiente, Ana Pérez|conserje|7|Mañana|MA|completado, '
  || 'Ana Pérez|conserje|8|Mañana|MA|pendiente',
  'A1 · el mes trae los turnos de D1 con persona, cargo y jornada (nada de D2)');

SELECT lc.chk(
  (SELECT rutinas || jsonb_build_array(otras_tareas)
     FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE + 5, CURRENT_DATE + 5)),
  '[0]'::jsonb,
  'A2 · un turno sin nada: sin rutinas y sin tareas sueltas');

SELECT lc.como('VER');
SELECT lc.chk(
  (SELECT count(*)::int FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE, CURRENT_DATE + 10)),
  4, 'A3 · VER el tab basta para leer el calendario');

SELECT lc.como('SINP');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE, CURRENT_DATE + 10)$$,
  '42501', 'A4 · sin el tab de Limpieza no se lee', 'No autorizado');

SELECT lc.como('EDD2');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE, CURRENT_DATE + 10)$$,
  '42501', 'A5 · sin acceso a ESE condominio no se lee', 'fuera de tu alcance');

SELECT lc.como('EDC');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE, CURRENT_DATE + 10)$$,
  '42501', 'A6 · la empresa vecina no lee');

SELECT lc.como('EDI');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE, CURRENT_DATE + 93)$$,
  '22003', 'A7 · el rango está acotado a 92 días');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE, CURRENT_DATE - 1)$$,
  '22023', 'A8 · un rango al revés se rechaza');
RESET ROLE;

-- ── B · asignar ──────────────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT lc.como('EDI');
SELECT lc.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('R2'), lc.id('R1')])),
  '4/0', 'B1 · dos rutinas de una vez: 1 + 3 tareas (la parada de un área inactiva no genera)');
RESET ROLE;

SELECT lc.chk(lc.tareas('BF'),
  'Sótanos:Limpieza de vidrios@Apartamento 1C, Niveles:Barrido de piso@Apartamento 1AB, '
  || 'Niveles:Limpieza de vidrios@Apartamento 1AB, Niveles:Barrido de piso@Apartamento 1C',
  'B2 · en el orden PEDIDO y, dentro de cada rutina, parada → paso; el área es la de la parada');

SELECT lc.chk(
  (SELECT string_agg(estado || '/' || duracion_estimada_min, ',' ORDER BY orden)
     FROM public.tareas_bloque WHERE bloque_id = lc.id('BF')),
  'pendiente/2,pendiente/5,pendiente/2,pendiente/5',
  'B3 · nacen pendientes y con la duración que declara la actividad');

SET ROLE authenticated;
SELECT lc.como('EDI');
SELECT lc.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('R1')])),
  '0/3', 'B4 · asignar otra vez no duplica');
SELECT lc.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('R3')])),
  '0/1', 'B5 · la actividad que otra rutina ya puso en esa área no se repite');

-- «Ya está» mira la ACTIVIDAD Y EL ÁREA: con «barrer» ya puesto en 1AB, la
-- rutina que barre 1AB y 1C sólo agrega lo de 1C (y sus vidrios de 1AB).
SELECT lc.chk(
  (SELECT generadas FROM public.limpieza_asignar_rutinas(lc.id('BF3'), ARRAY[lc.id('R3')])),
  1, 'B5b · un turno con «barrer» en 1AB');
SELECT lc.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.limpieza_asignar_rutinas(lc.id('BF3'), ARRAY[lc.id('R1')])),
  '2/1', 'B5c · la misma actividad en OTRA área sí entra: sólo se omite la de la misma área');
RESET ROLE;
SELECT lc.chk(lc.tareas('BF3'),
  'Repaso:Barrido de piso@Apartamento 1AB, Niveles:Limpieza de vidrios@Apartamento 1AB, '
  || 'Niveles:Barrido de piso@Apartamento 1C',
  'B5d · y entra detrás de lo que ya había');

-- Una tarea suelta (de «Tareas por turno») antes de asignar.
INSERT INTO public.tareas_bloque (bloque_id, titulo, orden) VALUES (lc.id('BF2'), 'Manual', 7);

SET ROLE authenticated;
SELECT lc.como('EDI');
SELECT lc.chk(
  (SELECT generadas FROM public.limpieza_asignar_rutinas(lc.id('BF2'), ARRAY[lc.id('R2'), lc.id('R2')])),
  1, 'B6 · la misma rutina dos veces en la lista cuenta una');
RESET ROLE;
SELECT lc.chk(
  (SELECT string_agg(titulo || '#' || orden, ',' ORDER BY orden)
     FROM public.tareas_bloque WHERE bloque_id = lc.id('BF2')),
  'Manual#7,Limpieza de vidrios#8',
  'B7 · lo asignado entra DETRÁS de lo que el turno ya tenía');

SET ROLE authenticated;
SELECT lc.como('VER');
SELECT lc.chk(
  (SELECT rutinas FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE + 5, CURRENT_DATE + 5)),
  jsonb_build_array(
    jsonb_build_object('rutina_id', lc.id('R2'), 'tareas', 1, 'pendientes', 1, 'hechas', 0, 'trabajadas', 0),
    jsonb_build_object('rutina_id', lc.id('R1'), 'tareas', 3, 'pendientes', 3, 'hechas', 0, 'trabajadas', 0)),
  'B8 · el calendario lista las rutinas del turno en el orden en que entraron');
SELECT lc.chk(
  (SELECT otras_tareas FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE + 6, CURRENT_DATE + 6)),
  1, 'B9 · y avisa de la tarea suelta, que no es de ninguna rutina');

SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('R3')])$$,
  '42501', 'B10 · VER no alcanza para asignar', 'programar la limpieza');
SELECT lc.como('SINP');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('R3')])$$,
  '42501', 'B11 · sin el tab no se asigna', 'programar la limpieza');
SELECT lc.como('EDD2');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('R3')])$$,
  '42501', 'B12 · con edición pero sin acceso a ESE condominio no se asigna', 'fuera de tu alcance');
SELECT lc.como('EDC');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('R3')])$$,
  '42501', 'B13 · la empresa vecina no asigna');

SELECT lc.como('EDI');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BP'), ARRAY[lc.id('R1')])$$,
  '55000', 'B14 · un día pasado no se programa', 'ya pasó');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BC'), ARRAY[lc.id('R1')])$$,
  '55000', 'B15 · un turno cerrado no recibe trabajo', 'cerrado');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('RINACT')])$$,
  '22023', 'B16 · una rutina inactiva no se asigna', 'inactiva');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('RD2')])$$,
  '22023', 'B17 · la rutina de otro condominio no se asigna', 'otro condominio');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('RVACIA')])$$,
  '22023', 'B18 · una rutina sin actividades activas se dice, no se «asigna» vacía', 'no tiene actividades activas');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[]::uuid[])$$,
  '22023', 'B19 · sin rutinas no hay nada que asignar');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('R1'), NULL])$$,
  '22023', 'B20 · un hueco en la lista se rechaza');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BF'), array_fill(lc.id('R1'), ARRAY[51]))$$,
  '22023', 'B21 · no más de 50 rutinas de una vez');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(gen_random_uuid(), ARRAY[lc.id('R1')])$$,
  'P0002', 'B22 · un turno inexistente se dice');
RESET ROLE;

SELECT lc.chk(
  (SELECT count(*)::int FROM public.tareas_bloque
    WHERE bloque_id IN (lc.id('BP'), lc.id('BC'), lc.id('BD2'))),
  0, 'B23 · ningún rechazo dejó tareas');

-- ── C · quitar ───────────────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT lc.como('VER');
SELECT lc.error(
  $$SELECT public.limpieza_quitar_rutina(lc.id('BF'), lc.id('R2'))$$,
  '42501', 'C1 · VER no alcanza para quitar', 'programar la limpieza');
SELECT lc.como('EDD2');
SELECT lc.error(
  $$SELECT public.limpieza_quitar_rutina(lc.id('BF'), lc.id('R2'))$$,
  '42501', 'C2 · sin acceso a ESE condominio no se quita', 'fuera de tu alcance');

SELECT lc.como('EDI');
SELECT lc.chk(public.limpieza_quitar_rutina(lc.id('BF'), lc.id('R2')), 1,
  'C3 · quitar borra las tareas de ESA rutina');
SELECT lc.chk(public.limpieza_quitar_rutina(lc.id('BF'), lc.id('R2')), 0,
  'C4 · quitar lo que ya no está: 0, sin error');
RESET ROLE;
SELECT lc.chk(lc.tareas('BF'),
  'Niveles:Barrido de piso@Apartamento 1AB, Niveles:Limpieza de vidrios@Apartamento 1AB, '
  || 'Niveles:Barrido de piso@Apartamento 1C',
  'C5 · las otras rutinas del turno quedan intactas');

-- Una foto en UNA de las tres tareas de R1.
UPDATE public.tareas_bloque SET foto_urls = '["evidencia.jpg"]'::jsonb
 WHERE id = (SELECT id FROM public.tareas_bloque
              WHERE bloque_id = lc.id('BF') AND rutina_id = lc.id('R1') ORDER BY orden LIMIT 1);

SET ROLE authenticated;
SELECT lc.como('EDI');
SELECT lc.error(
  $$SELECT public.limpieza_quitar_rutina(lc.id('BF'), lc.id('R1'))$$,
  '55000', 'C6 · con una foto, la rutina ya no se quita', 'trabajadas');
SELECT lc.chk(
  (SELECT (r->>'trabajadas')::int
     FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE + 5, CURRENT_DATE + 5) c,
          jsonb_array_elements(c.rutinas) r
    WHERE r->>'rutina_id' = lc.id('R1')::text),
  1, 'C7 · y el calendario lo sabe (no ofrece el ✕)');
RESET ROLE;
SELECT lc.chk(
  (SELECT count(*)::int FROM public.tareas_bloque WHERE bloque_id = lc.id('BF') AND rutina_id = lc.id('R1')),
  3, 'C8 · rechazada entera: no borró ni las que no tenían foto');

-- Una revisión también es trabajo.
INSERT INTO public.revisiones_tarea (tarea_id, bloque_id, estado)
SELECT id, bloque_id, 'pendiente' FROM public.tareas_bloque
 WHERE bloque_id = lc.id('BF2') AND rutina_id = lc.id('R2');
SET ROLE authenticated;
SELECT lc.como('EDI');
SELECT lc.error(
  $$SELECT public.limpieza_quitar_rutina(lc.id('BF2'), lc.id('R2'))$$,
  '55000', 'C9 · una revisión también cuenta como trabajada', 'trabajadas');
RESET ROLE;
DELETE FROM public.revisiones_tarea WHERE bloque_id = lc.id('BF2');

SET ROLE authenticated;
SELECT lc.como('EDI');
SELECT lc.chk(public.limpieza_quitar_rutina(lc.id('BF2'), lc.id('R2')), 1,
  'C10 · sin la revisión, se quita');
SELECT lc.error(
  $$SELECT public.limpieza_quitar_rutina(lc.id('BP'), lc.id('R1'))$$,
  '55000', 'C11 · de un día pasado no se quita', 'ya pasó');
SELECT lc.error(
  $$SELECT public.limpieza_quitar_rutina(lc.id('BC'), lc.id('R1'))$$,
  '55000', 'C12 · de un turno cerrado no se quita', 'cerrado');
RESET ROLE;

-- Quitar todo lo asignado deja el turno libre otra vez: «Asignación turnos» lo
-- puede borrar (turnos_asegurar_bloque_libre exige que no tenga tareas).
DELETE FROM public.tareas_bloque WHERE bloque_id = lc.id('BF2') AND titulo = 'Manual';
DELETE FROM public.bloques_turno WHERE id = lc.id('BF2');
SELECT lc.chk((SELECT count(*)::int FROM public.bloques_turno WHERE id = lc.id('BF2')), 0,
  'C13 · sin las rutinas, el turno vuelve a quedar libre para re-planificarse');

-- ── D · exposición ───────────────────────────────────────────────────────────
SET ROLE anon;
SELECT lc.error(
  $$SELECT * FROM public.limpieza_asignar_rutinas(lc.id('BF'), ARRAY[lc.id('R1')])$$,
  '42501', 'D1 · anon no invoca asignar', 'permission denied');
SELECT lc.error(
  $$SELECT public.limpieza_quitar_rutina(lc.id('BF'), lc.id('R1'))$$,
  '42501', 'D2 · anon no invoca quitar', 'permission denied');
SELECT lc.error(
  $$SELECT * FROM public.limpieza_calendario(lc.id('D1'), CURRENT_DATE, CURRENT_DATE)$$,
  '42501', 'D3 · anon no lee el calendario', 'permission denied');
RESET ROLE;

SET ROLE authenticated;
SELECT lc.como('EDI');
SELECT lc.error(
  $$SELECT public.limpieza_tarea_trabajada(t) FROM public.tareas_bloque t LIMIT 1$$,
  '42501', 'D4 · el criterio de «trabajada» no se expone', 'permission denied');
SELECT lc.error(
  $$SELECT public.limpieza_asegurar_turno_programable(b) FROM public.bloques_turno b LIMIT 1$$,
  '42501', 'D5 · los controles internos no se exponen', 'permission denied');
RESET ROLE;
