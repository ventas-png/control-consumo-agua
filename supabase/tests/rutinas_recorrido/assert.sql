-- ============================================================================
-- INVARIANTES de 20261102000000 (rutinas como recorrido por áreas).
-- Corre sobre la cadena REAL + fixture.sql. Cada comprobación imprime
-- «OK  …»; la primera que no se cumple aborta la corrida.
--
--   A · RECORRIDO   guardar en orden; la misma actividad en varias paradas;
--                   reordenar conserva las filas (y sus notas); quitar una
--                   parada se lleva sus pasos; los pasos legados sobreviven si
--                   vienen en la foto y se van si no.
--   B · ATÓMICO     una foto inválida (área repetida, actividad repetida, área
--                   o actividad de otro proyecto, forma incorrecta) no deja
--                   NADA a medias.
--   C · TENANT      el trigger sella el tenant de la parada; un paso no cuelga
--                   de la parada de otra rutina.
--   D · RLS         sin permiso o desde la empresa vecina la rutina «no
--                   existe» y no se ve ninguna parada; anon ni invoca la RPC.
--   E · MATERIALIZAR área de la parada (no la de la actividad); orden rutina →
--                   parada → paso, detrás de lo manual; la misma actividad en
--                   dos áreas son dos tareas; «ya existe» mira el área; el área
--                   inactiva no genera; la anulada no revive; idempotente.
--   F · ÍNDICE      cargar la misma actividad dos veces en el mismo bloque y
--                   área sigue chocando (también sin área).
--   G · BORRADO     el área usada no se borra; borrar la rutina se lleva su
--                   recorrido. (La purga de una empresa con recorridos va en
--                   assert_purga.sql, sobre la forma de llaves de producción.)
-- ============================================================================
\set ON_ERROR_STOP on

-- ── A · el recorrido ─────────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT rr.como('OPL');

INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, servicio)
VALUES ('c9000000-0000-0000-0000-000000000001', rr.id('D'), rr.id('D1'), 'Rutina Lunes AM', 'limpieza');

SELECT rr.chk(
  (SELECT paradas || '/' || pasos FROM public.guardar_recorrido_rutina(
     'c9000000-0000-0000-0000-000000000001',
     rr.rec('A1:BARRER,VIDRIOS', 'A2:BARRER', 'A3:'))),
  '3/3', 'A1 · guardar devuelve paradas y pasos');
SELECT rr.chk(rr.foto('c9000000-0000-0000-0000-000000000001'),
  'Apartamento 1AB: Barrido de piso, Limpieza de vidrios | Apartamento 1C: Barrido de piso | Gradas: ',
  'A1 · las áreas en orden, cada una con sus actividades; una parada puede quedar vacía');
SELECT rr.chk(
  (SELECT count(*)::int FROM public.rutina_actividades
    WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001' AND plantilla_tarea_id = rr.id('BARRER')),
  2, 'A1 · la MISMA actividad vive en dos paradas');

RESET ROLE;
-- Notas puestas a mano: deben sobrevivir a un reordenamiento.
UPDATE public.rutina_actividades SET notas = 'ojo con el tapete'
 WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001' AND plantilla_tarea_id = rr.id('VIDRIOS');
UPDATE public.rutina_areas SET notas = 'llave en portería'
 WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001' AND area_id = rr.id('A1');
CREATE TEMP TABLE ids_antes AS
  SELECT id, plantilla_tarea_id, rutina_area_id FROM public.rutina_actividades
   WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE paradas_antes AS
  SELECT id, area_id FROM public.rutina_areas WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001';
GRANT SELECT ON ids_antes, paradas_antes TO authenticated;
SET ROLE authenticated;
SELECT rr.como('OPL');

-- Reordenar: Gradas primero, en A1 vidrios antes que barrer (y barrer opcional),
-- y el Apartamento 1C fuera.
SELECT rr.chk(
  (SELECT paradas || '/' || pasos FROM public.guardar_recorrido_rutina(
     'c9000000-0000-0000-0000-000000000001',
     rr.rec('A3:', 'A1:VIDRIOS,BARRER?'))),
  '2/2', 'A2 · reordenar devuelve lo que quedó');
SELECT rr.chk(rr.foto('c9000000-0000-0000-0000-000000000001'),
  'Gradas:  | Apartamento 1AB: Limpieza de vidrios, Barrido de piso?',
  'A2 · nuevo orden de paradas y de pasos; la obligatoriedad viaja en la foto');
SELECT rr.chk(
  (SELECT count(*)::int FROM public.rutina_actividades ra JOIN ids_antes i USING (id)),
  2, 'A2 · los pasos que siguen conservan su FILA (no se borran y recrean)');
SELECT rr.chk(
  (SELECT notas FROM public.rutina_actividades
    WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001' AND plantilla_tarea_id = rr.id('VIDRIOS')),
  'ojo con el tapete', 'A2 · …y con ella sus notas');
SELECT rr.chk(
  (SELECT notas FROM public.rutina_areas ra JOIN paradas_antes p USING (id) WHERE ra.area_id = rr.id('A1')),
  'llave en portería', 'A2 · la parada que sigue conserva su fila y sus notas');
SELECT rr.chk(
  (SELECT count(*)::int FROM public.rutina_areas
    WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001' AND area_id = rr.id('A2')),
  0, 'A2 · la parada que no vino en la foto se fue…');
SELECT rr.chk(
  (SELECT count(*)::int FROM public.rutina_actividades ra JOIN ids_antes i USING (id)
    WHERE i.rutina_area_id = (SELECT id FROM paradas_antes WHERE area_id = rr.id('A2'))),
  0, 'A2 · …y se llevó sus pasos');

-- Pasos legados (sin parada), como los de una rutina anterior a esta migración.
RESET ROLE;
INSERT INTO public.rutina_actividades (company_id, project_id, rutina_id, plantilla_tarea_id, orden)
VALUES (rr.id('D'), rr.id('D1'), 'c9000000-0000-0000-0000-000000000001', rr.id('BARRER'), 0);
SET ROLE authenticated;
SELECT rr.como('OPL');
SELECT rr.chk(
  (SELECT pasos FROM public.guardar_recorrido_rutina(
     'c9000000-0000-0000-0000-000000000001',
     rr.rec('-:BARRER', 'A3:', 'A1:VIDRIOS,BARRER?'))),
  3, 'A3 · el paso legado que viene en la foto (grupo sin área) se conserva');
SELECT rr.chk(rr.foto('c9000000-0000-0000-0000-000000000001'),
  '(sin área): Barrido de piso | Gradas:  | Apartamento 1AB: Limpieza de vidrios, Barrido de piso?',
  'A3 · el grupo legado convive con las paradas');
SELECT rr.chk(
  (SELECT pasos FROM public.guardar_recorrido_rutina(
     'c9000000-0000-0000-0000-000000000001',
     rr.rec('A3:', 'A1:VIDRIOS,BARRER?'))),
  2, 'A3 · y si la foto ya no lo trae, se va');

-- ── B · una foto inválida no deja nada a medias ───────────────────────────────
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000001',
                  rr.rec('A2:BARRER', 'A1:', 'A2:'))$$,
  '23505', 'B1 · área repetida en el recorrido');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000001',
                  rr.rec('A2:BARRER,VIDRIOS,BARRER'))$$,
  '23505', 'B2 · actividad repetida en la misma parada');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000001',
                  rr.rec('-:BARRER', '-:VIDRIOS'))$$,
  '23505', 'B3 · dos grupos sin área');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000001',
                  rr.rec('A2:BARRER', 'AX:'))$$,
  '23514', 'B4 · área de OTRO proyecto de la misma empresa: la rechaza el trigger, con su código');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000001',
                  rr.rec('A2:BARRER', 'AC:'))$$,
  '23514', 'B5 · área de OTRA empresa');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000001',
                  rr.rec('A2:BARRER', 'A1:PX'))$$,
  '23514', 'B6 · actividad de otro proyecto');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000001',
                  '{"area_id": null}'::jsonb)$$,
  '22023', 'B7 · la foto no es un arreglo');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000001',
                  '[{"area_id": null, "actividades": {"x": 1}}]'::jsonb)$$,
  '22023', 'B8 · «actividades» no es un arreglo');
SELECT rr.chk(rr.foto('c9000000-0000-0000-0000-000000000001'),
  'Gradas:  | Apartamento 1AB: Limpieza de vidrios, Barrido de piso?',
  'B · tras ocho fotos rechazadas el recorrido es exactamente el último bueno');

-- ── C · tenant ───────────────────────────────────────────────────────────────
-- El cliente manda un tenant ajeno: el trigger lo reemplaza por el de la rutina.
INSERT INTO public.rutina_areas (company_id, project_id, rutina_id, area_id, orden)
VALUES (rr.id('D'), rr.id('D2'), 'c9000000-0000-0000-0000-000000000001', rr.id('A2'), 9);
SELECT rr.chk(
  (SELECT project_id FROM public.rutina_areas
    WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001' AND area_id = rr.id('A2')),
  rr.id('D1'), 'C1 · la parada toma el tenant de su rutina, no el que manda el cliente');

INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, servicio)
VALUES ('c9000000-0000-0000-0000-000000000002', rr.id('D'), rr.id('D1'), 'Otra rutina', 'limpieza');
SELECT rr.error(
  $$INSERT INTO public.rutina_actividades (company_id, project_id, rutina_id, rutina_area_id, plantilla_tarea_id)
    SELECT rr.id('D'), rr.id('D1'), 'c9000000-0000-0000-0000-000000000002', id, rr.id('BARRER')
      FROM public.rutina_areas WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001' LIMIT 1$$,
  '23503', 'C2 · un paso no puede colgar de la parada de OTRA rutina');
SELECT rr.error(
  $$INSERT INTO public.rutina_areas (company_id, project_id, rutina_id, area_id)
    VALUES (rr.id('D'), rr.id('D1'), 'c9000000-0000-0000-0000-000000000001', rr.id('A2'))$$,
  '23505', 'C3 · una parada por área y rutina');

-- ── D · RLS ──────────────────────────────────────────────────────────────────
SELECT rr.como('SINP');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  'P0002', 'D1 · sin el permiso del tab la rutina «no existe»');
SELECT rr.chk((SELECT count(*)::int FROM public.rutina_areas), 0, 'D1 · y no ve ninguna parada');
SELECT rr.como('OPC');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  'P0002', 'D2 · la empresa vecina, con el MISMO permiso, tampoco');
SELECT rr.chk((SELECT count(*)::int FROM public.rutina_areas), 0, 'D2 · ni ve las paradas de D');
SELECT rr.error(
  $$INSERT INTO public.rutina_areas (company_id, project_id, rutina_id, area_id)
    VALUES (rr.id('C'), rr.id('C1'), 'c9000000-0000-0000-0000-000000000001', rr.id('A1'))$$,
  '42501', 'D2 · ni puede colarle una parada a una rutina de D');
RESET ROLE;
SELECT rr.chk(
  (SELECT count(*)::int FROM public.rutina_areas WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001'),
  3, 'D · los intentos ajenos no tocaron el recorrido');
SET ROLE anon;
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  '42501', 'D3 · anon ni puede invocar la RPC');
SELECT rr.error($$SELECT count(*) FROM public.rutina_areas$$,
  '42501', 'D3 · ni leer la tabla');
RESET ROLE;

-- ── E · materializar ─────────────────────────────────────────────────────────
-- Rutina con jornada: un paso legado (VIDRIOS, cuya actividad declara Gradas),
-- A1 con BARRER y VIDRIOS, A2 con BARRER y la Bodega INACTIVA con BARRER.
SET ROLE authenticated;
SELECT rr.como('OPL');
INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, servicio, plantilla_horario_id)
VALUES ('c9000000-0000-0000-0000-000000000003', rr.id('D'), rr.id('D1'), 'Recorrido mañana', 'limpieza', rr.id('H1'));
SELECT rr.chk(
  (SELECT paradas || '/' || pasos FROM public.guardar_recorrido_rutina(
     'c9000000-0000-0000-0000-000000000003',
     rr.rec('-:VIDRIOS', 'A1:BARRER,VIDRIOS', 'A2:BARRER', 'A4:BARRER'))),
  '3/5', 'E0 · el recorrido admite la parada de un área inactiva (es definición)');
RESET ROLE;

-- Lo puesto a mano en B1 antes de materializar: BARRER en el Apartamento 1AB.
INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo, area_id, orden)
VALUES (rr.id('B1'), rr.id('BARRER'), 'Barrido de piso (a mano)', rr.id('A1'), 0);

SET ROLE authenticated;
SELECT rr.como('OPL');
SELECT rr.chk(
  (SELECT generadas || '/' || omitidas_existente || '/' || omitidas_bloque_cerrado
     FROM public.materializar_rutinas_turno(rr.id('D1'), DATE '2026-11-10', DATE '2026-11-11')),
  '3/1/4', 'E1 · 3 nuevas en B1; la de A1 ya estaba; las 4 de B2 no entran a un turno cerrado');
RESET ROLE;
SELECT rr.chk(
  (SELECT string_agg(tb.titulo || ' @ ' || COALESCE(a.nombre, '—'), ' → ' ORDER BY tb.orden)
     FROM public.tareas_bloque tb LEFT JOIN public.areas_condominio a ON a.id = tb.area_id
    WHERE tb.bloque_id = rr.id('B1')),
  'Barrido de piso (a mano) @ Apartamento 1AB → Limpieza de vidrios @ Gradas → Limpieza de vidrios @ Apartamento 1AB → Barrido de piso @ Apartamento 1C',
  'E2 · orden del recorrido detrás de lo manual; área de la PARADA (no la de la actividad); el paso legado conserva la regla vieja; la Bodega inactiva no genera');
SELECT rr.chk(
  (SELECT count(*)::int FROM public.tareas_bloque WHERE bloque_id = rr.id('B1') AND plantilla_id = rr.id('BARRER')),
  2, 'E3 · la misma actividad en dos áreas son dos tareas del mismo turno');
SELECT rr.chk(
  (SELECT count(*)::int FROM public.tareas_bloque
    WHERE bloque_id = rr.id('B1') AND rutina_id = 'c9000000-0000-0000-0000-000000000003'),
  3, 'E3 · con su linaje de rutina');

-- Anular una y volver a correr: no revive, no duplica.
UPDATE public.tareas_bloque SET anulada_en = now(), motivo_anulacion = 'el 1C está en obra'
 WHERE bloque_id = rr.id('B1') AND area_id = rr.id('A2');
SET ROLE authenticated;
SELECT rr.como('OPL');
SELECT rr.chk(
  (SELECT generadas || '/' || omitidas_existente
     FROM public.materializar_rutinas_turno(rr.id('D1'), DATE '2026-11-10', DATE '2026-11-10')),
  '0/4', 'E4 · segunda corrida: nada nuevo, las 4 cuentan como existentes (la anulada también)');
RESET ROLE;
SELECT rr.chk(
  (SELECT count(*)::int FROM public.tareas_bloque WHERE bloque_id = rr.id('B1') AND anulada_en IS NULL),
  3, 'E4 · la anulada sigue anulada');

-- ── F · el índice nuevo conserva la garantía vieja ───────────────────────────
SELECT rr.error(
  $$INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo, area_id)
    VALUES (rr.id('B1'), rr.id('VIDRIOS'), 'otra vez', rr.id('A3'))$$,
  '23505', 'F1 · la misma actividad dos veces en el mismo bloque y área choca');
INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo, area_id)
VALUES (rr.id('B1'), rr.id('BARRER'), 'sin área', NULL);
SELECT rr.error(
  $$INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo, area_id)
    VALUES (rr.id('B1'), rr.id('BARRER'), 'sin área otra vez', NULL)$$,
  '23505', 'F2 · y sin área también («Cargar tareas del cargo» dos veces no duplica)');
SELECT rr.chk(
  (SELECT count(*)::int FROM pg_indexes WHERE indexname = 'uq_tareas_bloque_plantilla'),
  0, 'F3 · el índice viejo (bloque, plantilla) ya no existe');
SELECT rr.chk(
  (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_tareas_bloque_plantilla_id'),
  'CREATE INDEX idx_tareas_bloque_plantilla_id ON public.tareas_bloque USING btree (plantilla_id)',
  'F4 · la FK plantilla_id tiene su índice líder (producción nunca lo tuvo)');

-- ── G · borrado ──────────────────────────────────────────────────────────────
-- Un área usada SÓLO por una parada (ninguna actividad ni tarea la nombra).
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, icono)
VALUES ('c4000000-0000-0000-0000-000000000005', rr.id('D'), rr.id('D1'), 'Azotea', '🏙️');
SET ROLE authenticated;
SELECT rr.como('OPL');
SELECT rr.chk(
  (SELECT paradas FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-000000000002',
     jsonb_build_array(jsonb_build_object('area_id', 'c4000000-0000-0000-0000-000000000005')))),
  1, 'G1 · una parada en la Azotea');
RESET ROLE;
SELECT rr.error($$DELETE FROM public.areas_condominio WHERE id = 'c4000000-0000-0000-0000-000000000005'$$,
  '23503', 'G1 · el área usada en un recorrido no se borra (su baja es activo=false)', 'rutina_areas_area_fk');
DELETE FROM public.rutinas_limpieza WHERE id = 'c9000000-0000-0000-0000-000000000001';
SELECT rr.chk(
  (SELECT count(*)::int FROM public.rutina_areas WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001')
  + (SELECT count(*)::int FROM public.rutina_actividades WHERE rutina_id = 'c9000000-0000-0000-0000-000000000001'),
  0, 'G2 · borrar la rutina se lleva paradas y pasos');
