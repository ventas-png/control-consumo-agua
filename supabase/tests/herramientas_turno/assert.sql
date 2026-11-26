-- ============================================================================
-- INVARIANTES de 20261231000000 (herramientas de un turno con su nombre).
-- Corre sobre la cadena REAL + fixture.sql. Cada comprobación imprime
-- «OK  …»; la primera que no se cumple aborta la corrida.
--
--   A · EL REPORTE  sólo con Limpieza, la puente llega sin nombre por la RLS de
--                   los catálogos (lo que veía la pantalla), y la RPC trae el
--                   nombre y el estado de cada herramienta, del equipo o del
--                   artículo legado de Inventario, sin abrir los catálogos.
--   B · ALCANCE     sólo las actividades de ESE turno y de su condominio; cada
--                   herramienta una vez por actividad; un turno sin tareas no
--                   trae nada.
--   C · QUIÉN       Mis tareas, Turnos y Revisión también leen; Desempeño,
--                   Equipos solo y ningún tab no; otro condominio, la empresa
--                   vecina y un turno inexistente se rechazan.
--   D · EXPOSICIÓN  anon no la invoca; DEFINER, STABLE, search_path vacío y
--                   exactamente las siete columnas.
-- ============================================================================
\set ON_ERROR_STOP on

-- ── A · el reporte: sólo Limpieza ────────────────────────────────────────────
SET ROLE authenticated;
SELECT ht.como('LIMP');

-- Lo que hacía la pantalla (PostgREST: la puente con su embed). La puente se
-- lee; el equipo y el artículo de Inventario, no.
SELECT ht.chk(
  (SELECT count(*)::int || ' filas, ' || count(e.nombre)::int || ' con nombre de equipo, '
          || count(i.nombre)::int || ' con nombre de Inventario'
     FROM public.plantilla_tarea_herramientas h
     LEFT JOIN public.equipos_comunes e ON e.id = h.equipo_id
     LEFT JOIN public.inventario_condominio i ON i.id = h.inventario_id
    WHERE h.plantilla_tarea_id IN (ht.id('BARRER'), ht.id('VIDRIOS'))),
  '4 filas, 0 con nombre de equipo, 0 con nombre de Inventario',
  'A1 · sólo con Limpieza, la puente con su embed llega sin nombre (la causa del «Herramienta»)');

SELECT ht.chk(ht.lista('B1'),
  'Escoba×1!/operativo, Jalador×1/disponible, Pulidora×1/baja, Trapeador×2/operativo',
  'A2 · la RPC trae nombre, cantidad, obligatoria y estado de cada herramienta del turno');

SELECT ht.chk(
  (SELECT string_agg(h.nombre || ':' || (h.equipo_id IS NOT NULL) || '/' || (h.inventario_id IS NOT NULL), ', '
                     ORDER BY h.nombre COLLATE "C")
     FROM public.herramientas_del_turno(ht.id('B1')) h
    WHERE h.plantilla_tarea_id = ht.id('VIDRIOS')),
  'Jalador:false/true, Pulidora:true/false',
  'A3 · el vínculo LEGADO a Inventario trae su nombre igual que el equipo, y cada uno dice de dónde viene');

SELECT ht.chk(
  (SELECT count(*)::int FROM public.equipos_comunes) + (SELECT count(*)::int FROM public.inventario_condominio),
  0, 'A4 · y los catálogos siguen cerrados para Limpieza: la RPC no abrió Equipos ni Inventario');
RESET ROLE;

-- ── B · alcance ──────────────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT ht.como('LIMP');
SELECT ht.chk(
  (SELECT count(*)::int || '/' || count(DISTINCT (h.plantilla_tarea_id, COALESCE(h.equipo_id, h.inventario_id)))::int
     FROM public.herramientas_del_turno(ht.id('B1')) h),
  '4/4', 'B1 · «barrer» está dos veces en el turno (dos áreas) y su herramienta sale una vez por actividad');

SELECT ht.chk(
  (SELECT count(*)::int FROM public.herramientas_del_turno(ht.id('B1')) h
    WHERE h.nombre IN ('Aspiradora', 'Hidrolavadora D2')),
  0, 'B2 · ni lo de las actividades de OTRO turno (Aspiradora) ni el catálogo de OTRO condominio (Hidrolavadora D2)');

SELECT ht.chk(ht.lista('B3'), 'Aspiradora×1/operativo', 'B3 · el otro turno trae lo suyo');
SELECT ht.chk(ht.lista('B2'), '', 'B4 · un turno sin tareas no trae nada');
RESET ROLE;

-- ── C · quién lee ────────────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT ht.como('EJEC');
SELECT ht.chk(ht.lista('B1'),
  'Escoba×1!/operativo, Jalador×1/disponible, Pulidora×1/baja, Trapeador×2/operativo',
  'C1 · «Mis tareas» (quien ejecuta) también lee');
SELECT ht.como('TURN');
SELECT ht.chk((SELECT count(*)::int FROM public.herramientas_del_turno(ht.id('B1'))), 4,
  'C2 · «Asignación turnos» también lee');
SELECT ht.como('REV');
SELECT ht.chk((SELECT count(*)::int FROM public.herramientas_del_turno(ht.id('B1'))), 4,
  'C3 · «Revisión de tareas» también lee');

SELECT ht.como('DESEMP');
SELECT ht.error($$SELECT * FROM public.herramientas_del_turno(ht.id('B1'))$$,
  '42501', 'C4 · «Desempeño» lee el turno pero no lo ejecuta: no lee sus herramientas', 'No autorizado');
SELECT ht.como('EQUIP');
SELECT ht.error($$SELECT * FROM public.herramientas_del_turno(ht.id('B1'))$$,
  '42501', 'C5 · el tab de Equipos solo no alcanza: hace falta uno que trabaje el turno', 'No autorizado');
SELECT ht.como('SINP');
SELECT ht.error($$SELECT * FROM public.herramientas_del_turno(ht.id('B1'))$$,
  '42501', 'C6 · sin ningún tab no se lee', 'No autorizado');

SELECT ht.como('LIMPD2');
SELECT ht.error($$SELECT * FROM public.herramientas_del_turno(ht.id('B1'))$$,
  '42501', 'C7 · sin acceso al condominio de ESE turno no se lee', 'fuera de tu alcance');
SELECT ht.chk(ht.lista('BD2'), 'Hidrolavadora D2×1!/operativo', 'C8 · y el de su condominio sí');

SELECT ht.como('LIMP');
SELECT ht.error($$SELECT * FROM public.herramientas_del_turno(ht.id('BD2'))$$,
  '42501', 'C9 · ni al revés: Limpieza de D1 no lee un turno de D2', 'fuera de tu alcance');

SELECT ht.como('LIMPC');
SELECT ht.error($$SELECT * FROM public.herramientas_del_turno(ht.id('B1'))$$,
  '42501', 'C10 · la empresa vecina, con los mismos permisos, la frena el control de empresa', 'no autorizado');

SELECT ht.como('LIMP');
SELECT ht.error($$SELECT * FROM public.herramientas_del_turno(gen_random_uuid())$$,
  '42501', 'C11 · un turno inexistente se rechaza', 'Turno inexistente');
RESET ROLE;

-- ── D · exposición ───────────────────────────────────────────────────────────
SELECT ht.chk(
  has_function_privilege('anon', 'public.herramientas_del_turno(uuid)', 'EXECUTE')::text || '/'
  || has_function_privilege('authenticated', 'public.herramientas_del_turno(uuid)', 'EXECUTE')::text || '/'
  || has_function_privilege('service_role', 'public.herramientas_del_turno(uuid)', 'EXECUTE')::text,
  'false/true/true', 'D1 · anon no la invoca; authenticated y service_role sí');

SET ROLE anon;
SELECT ht.error($$SELECT * FROM public.herramientas_del_turno(ht.id('B1'))$$,
  '42501', 'D2 · y llamada como anon, la base la niega', 'permission denied');
RESET ROLE;

SELECT ht.chk(
  (SELECT p.prosecdef::text || '/' || p.provolatile::text || '/' || array_to_string(p.proconfig, ',')
     FROM pg_proc p WHERE p.oid = 'public.herramientas_del_turno(uuid)'::regprocedure),
  'true/s/search_path=""', 'D3 · SECURITY DEFINER, STABLE y search_path vacío');

SELECT ht.chk(
  pg_get_function_result('public.herramientas_del_turno(uuid)'::regprocedure),
  'TABLE(plantilla_tarea_id uuid, equipo_id uuid, inventario_id uuid, cantidad integer, obligatoria boolean, nombre text, estado text)',
  'D4 · devuelve exactamente siete columnas: del catálogo, sólo nombre y estado');
