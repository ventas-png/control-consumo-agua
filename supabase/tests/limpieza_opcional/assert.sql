-- ============================================================================
-- INVARIANTES de 20261226000100 (el paso opcional de una rutina deja de contar
-- como pendiente). Corre sobre la cadena REAL + fixture.sql. Cada comprobación
-- imprime «OK  …»; la primera que no se cumple aborta la corrida.
--
--   A · ASIGNAR      la tarea copia si el paso es obligatorio; dos pasos que
--                    caen en la misma tarea la dejan obligatoria si cualquiera
--                    lo es, en cualquier orden; dos opcionales, opcional; lo que
--                    el turno ya tenía no se toca.
--   B · CALENDARIO   `pendientes` cuenta sólo obligatorias; el opcional sin
--                    hacer (pendiente, omitido o anulado) va a
--                    `opcionales_sin_hacer`; hecho, suma en `hechas` y sale de
--                    ahí. Vale también para un día pasado (Atrasadas).
--   C · MATERIALIZAR la misma copia y la misma regla en «Generar tareas» por
--                    jornada; la segunda corrida no cambia nada.
--   D · LA COLUMNA   una tarea creada fuera de una rutina nace obligatoria, y
--                    NULL no se acepta.
-- ============================================================================
\set ON_ERROR_STOP on

-- ── A · asignar ──────────────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT lo.como('EDI');

SELECT lo.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.limpieza_asignar_rutinas(lo.id('B1'), ARRAY[lo.id('RO')])),
  '3/0', 'A1 · la rutina con dos pasos opcionales genera sus tres tareas');
RESET ROLE;
SELECT lo.chk(lo.tareas('B1'),
  'Barrido de piso@Apartamento 1AB:o, Limpieza de vidrios@Apartamento 1AB:x, Repaso de manijas@Apartamento 1C:x',
  'A2 · cada tarea copia si su paso es obligatorio');

SET ROLE authenticated;
SELECT lo.como('EDI');
SELECT lo.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.limpieza_asignar_rutinas(lo.id('B2'), ARRAY[lo.id('RO'), lo.id('RX')])),
  '3/1', 'A3 · opcional (RO) + obligatorio (RX) en la misma tarea: una sola');
SELECT lo.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.limpieza_asignar_rutinas(lo.id('B3'), ARRAY[lo.id('RX'), lo.id('RO')])),
  '3/1', 'A4 · y en el orden inverso, también una');
SELECT lo.chk(
  (SELECT generadas FROM public.limpieza_asignar_rutinas(lo.id('B4'), ARRAY[lo.id('RY'), lo.id('RO')])),
  3, 'A5 · dos opcionales en la misma tarea');
SELECT lo.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.limpieza_asignar_rutinas(lo.id('B5'), ARRAY[lo.id('RL')])),
  '1/1', 'A6 · el paso legado y la parada de la misma rutina caen en una tarea');
SELECT lo.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.limpieza_asignar_rutinas(lo.id('B6'), ARRAY[lo.id('RO'), lo.id('RZ')])),
  '4/0', 'A6b · vidrios en 1AB (opcional, RO) y en 1C (obligatorio, RZ) son dos tareas');
RESET ROLE;

SELECT lo.chk(
  (SELECT obligatoria FROM public.tareas_bloque
    WHERE bloque_id = lo.id('B2') AND plantilla_id = lo.id('VIDRIOS')),
  true, 'A7 · RO + RX: la tarea es obligatoria (gana la exigencia)');
SELECT lo.chk(
  (SELECT obligatoria FROM public.tareas_bloque
    WHERE bloque_id = lo.id('B3') AND plantilla_id = lo.id('VIDRIOS')),
  true, 'A8 · RX + RO: también, no depende del orden');
SELECT lo.chk(
  (SELECT obligatoria FROM public.tareas_bloque
    WHERE bloque_id = lo.id('B4') AND plantilla_id = lo.id('VIDRIOS')),
  false, 'A9 · RY + RO: dos opcionales dejan la tarea opcional');
SELECT lo.chk(lo.tareas('B5'),
  'Limpieza de vidrios@Apartamento 1AB:o',
  'A10 · RL: el paso legado es opcional y la parada no, así que la tarea es obligatoria');
SELECT lo.chk(
  (SELECT string_agg(titulo || ':' || CASE WHEN obligatoria THEN 'o' ELSE 'x' END, ',' ORDER BY orden)
     FROM public.tareas_bloque WHERE bloque_id = lo.id('B2') AND plantilla_id <> lo.id('VIDRIOS')),
  'Barrido de piso:o,Repaso de manijas:x',
  'A11 · lo que no choca conserva lo de su paso');

SELECT lo.chk(lo.tareas('B6'),
  'Barrido de piso@Apartamento 1AB:o, Limpieza de vidrios@Apartamento 1AB:x, '
  || 'Repaso de manijas@Apartamento 1C:x, Limpieza de vidrios@Apartamento 1C:o',
  'A11b · y cada una con lo de su paso: la regla es por TAREA (actividad y área), no por actividad');

-- Lo que el turno ya tenía no se toca: B1 tiene VIDRIOS@1AB opcional (de RO).
SET ROLE authenticated;
SELECT lo.como('EDI');
SELECT lo.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.limpieza_asignar_rutinas(lo.id('B1'), ARRAY[lo.id('RX')])),
  '0/1', 'A12 · asignar RX a un turno que ya tiene esa tarea no crea nada');
RESET ROLE;
SELECT lo.chk(
  (SELECT obligatoria FROM public.tareas_bloque
    WHERE bloque_id = lo.id('B1') AND plantilla_id = lo.id('VIDRIOS')),
  false, 'A13 · y la tarea que ya estaba sigue como estaba (opcional)');

-- ── B · el calendario ────────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT lo.como('EDI');
SELECT lo.chk(lo.cifras('B1', 'RO'),
  'tareas=3 pendientes=1 hechas=0 opcionales_sin_hacer=2',
  'B1 · sin hacer nada: pendiente sólo la obligatoria; las dos opcionales aparte');
RESET ROLE;

-- La opcional de vidrios se hace (completada sin evidencia: no la exige).
UPDATE public.tareas_bloque SET estado = 'completada', completada_en = now()
 WHERE bloque_id = lo.id('B1') AND plantilla_id = lo.id('VIDRIOS');
SET ROLE authenticated;
SELECT lo.como('EDI');
SELECT lo.chk(lo.cifras('B1', 'RO'),
  'tareas=3 pendientes=1 hechas=1 opcionales_sin_hacer=1',
  'B2 · la opcional hecha suma en hechas y sale de las opcionales sin hacer');
RESET ROLE;

-- La otra opcional se omite: sigue sin hacer.
UPDATE public.tareas_bloque SET estado = 'omitida'
 WHERE bloque_id = lo.id('B1') AND plantilla_id = lo.id('REPASO');
SET ROLE authenticated;
SELECT lo.como('EDI');
SELECT lo.chk(lo.cifras('B1', 'RO'),
  'tareas=3 pendientes=1 hechas=1 opcionales_sin_hacer=1',
  'B3 · la opcional omitida sigue sin hacer, y no es pendiente');
RESET ROLE;

-- Un día pasado (lo que suma «Atrasadas»): dos tareas de RO cargadas a mano,
-- una obligatoria y una opcional, las dos pendientes; y una opcional anulada.
INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, rutina_id, titulo, area_id, orden, obligatoria) VALUES
  (lo.id('BP'), lo.id('BARRER'),  lo.id('RO'), 'Barrido de piso',     lo.id('A1'), 0, true),
  (lo.id('BP'), lo.id('VIDRIOS'), lo.id('RO'), 'Limpieza de vidrios', lo.id('A1'), 1, false),
  (lo.id('BP'), lo.id('REPASO'),  lo.id('RO'), 'Repaso de manijas',   lo.id('A2'), 2, false);
UPDATE public.tareas_bloque
   SET anulada_en = now(), anulada_por = lo.id('EDI'), motivo_anulacion = 'No correspondía'
 WHERE bloque_id = lo.id('BP') AND plantilla_id = lo.id('REPASO');
SET ROLE authenticated;
SELECT lo.como('EDI');
SELECT lo.chk(lo.cifras('BP', 'RO'),
  'tareas=3 pendientes=1 hechas=0 opcionales_sin_hacer=2',
  'B4 · en un día pasado sólo la obligatoria queda atrasada; la opcional anulada tampoco se hizo');
RESET ROLE;

-- ── C · «Generar tareas» por jornada ─────────────────────────────────────────
SET ROLE authenticated;
SELECT lo.como('EDI');
SELECT lo.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.materializar_rutinas_turno(lo.id('D1'), CURRENT_DATE + 9, CURRENT_DATE + 9)),
  '3/0', 'C1 · RM y RM2 sobre el turno de su jornada: cuatro pasos, tres tareas');
RESET ROLE;
SELECT lo.chk(
  (SELECT string_agg(t.titulo || '@' || a.nombre || ':' || CASE WHEN t.obligatoria THEN 'o' ELSE 'x' END,
                     ', ' ORDER BY t.titulo)
     FROM public.tareas_bloque t JOIN public.areas_condominio a ON a.id = t.area_id
    WHERE t.bloque_id = lo.id('BM')),
  'Barrido de piso@Apartamento 1AB:o, Limpieza de vidrios@Apartamento 1C:x, Repaso de manijas@Apartamento 1C:o',
  'C2 · copia el paso; el repaso opcional de RM y obligatorio de RM2 queda obligatorio');

SET ROLE authenticated;
SELECT lo.como('EDI');
SELECT lo.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.materializar_rutinas_turno(lo.id('D1'), CURRENT_DATE + 9, CURRENT_DATE + 9)),
  '0/4', 'C3 · la segunda corrida no crea nada');
RESET ROLE;
SELECT lo.chk(
  (SELECT count(*) FILTER (WHERE obligatoria)::int || '/' || count(*)::int
     FROM public.tareas_bloque WHERE bloque_id = lo.id('BM')),
  '2/3', 'C4 · ni cambia lo que ya estaba');

-- ── D · la columna ───────────────────────────────────────────────────────────
INSERT INTO public.tareas_bloque (bloque_id, titulo, orden) VALUES (lo.id('B5'), 'Tarea suelta', 9);
SELECT lo.chk(
  (SELECT obligatoria FROM public.tareas_bloque WHERE bloque_id = lo.id('B5') AND titulo = 'Tarea suelta'),
  true, 'D1 · la tarea creada fuera de una rutina nace obligatoria');
SELECT lo.error(
  $$INSERT INTO public.tareas_bloque (bloque_id, titulo, orden, obligatoria) VALUES (lo.id('B5'), 'Sin dato', 10, NULL)$$,
  '23502', 'D2 · obligatoria no acepta NULL');
