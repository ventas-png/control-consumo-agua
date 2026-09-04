-- ════════════════════════════════════════════════════════════════════════════
-- Recursos Humanos absorbe la jornada, que vivía en Seguridad
--
-- POR QUÉ
-- 20260907001200 creó la sección con el expediente, la formación y el trabajo
-- que sale de Operaciones. Faltaba lo más grande, y estaba en Seguridad: la
-- jornada entera. Turnos, plantillas de cargo, ausencias, horas y extras,
-- presencia y panel de turno estaban ahí porque el guardia es quien más turnos
-- tiene — no porque programar una jornada sea vigilar. Con ellos se mudan el
-- trabajo que se asigna al personal (tareas por turno con su revisión, rutas de
-- ronda) y la vara con la que se le mide (desempeño).
--
-- El efecto práctico es el mismo que motivó la sección: quien armaba el rol de
-- la persona que administra al personal tenía que abrir el bloque de Seguridad
-- entero —visitantes, paquetería, incidentes, bitácora de guardia— para llegar
-- a las ausencias. Diez tabs, 60 claves con sus acciones.
--
-- QUÉ SE MUDA (y qué NO)
--   turnos              programar la cobertura        plantillas_cargo   los cargos que la definen
--   ausencias           vacaciones y permisos         horas_extra        el cómputo para planilla
--   presencia           asistencia                    panel_turno        el tablero de la jornada
--   tareas_personal     el trabajo del turno          rutas_ronda        el recorrido asignado
--   revision_tareas     su revisión administrativa    desempeno_personal la medición
--
-- `revision_tareas` (Revisión Admin) viaja con `tareas_personal`: es su
-- contraparte, y dejarlo en Seguridad habría partido un mismo flujo entre dos
-- secciones — se asigna en RRHH y se revisa en otro sitio.
--
-- LAS CLAVES NO CAMBIAN, SOLO SU CATEGORÍA — igual que en 20260907001200, y por
-- la misma razón: hay policies que gatean sobre estos nombres. `turnos`,
-- `ausencias` y `horas_extra` los sembró 20260820000400; el resto,
-- 20260518000005. Ninguno se renombra, así que nada que dependa de ellos se
-- entera. `CONDOMINIOS_TAB_ACCESS` tampoco cambia: el rol seguridad conserva
-- exactamente los tabs que ya tenía.
--
-- MISMAS DOS DECISIONES QUE 20260907001200, y por los mismos motivos:
--   (a) claves exactas, sin `LIKE` — el guion bajo es COMODÍN, y siete de estos
--       nueve tabs lo llevan en el nombre;
--   (b) guarda de postcondición — un UPDATE que no encuentra filas no es un
--       error para Postgres, así que un renombre aguas arriba pasaría en verde
--       dejando la sección coja.
--
-- IMPACTO EN DATOS: solo `permissions.category`. Ni una fila de negocio, ni un
-- grant nuevo: a diferencia de 20260907001200, aquí no se siembra ningún tab —
-- los nueve ya existen en el catálogo con todas sus acciones.
--
-- CÓMO REVERTIR
--   UPDATE public.permissions SET category = 'seguridad'
--    WHERE key IN ('condominios.tab.turnos','condominios.tab.plantillas_cargo',
--                  'condominios.tab.ausencias','condominios.tab.horas_extra',
--                  'condominios.tab.presencia','condominios.tab.panel_turno',
--                  'condominios.tab.tareas_personal','condominios.tab.rutas_ronda',
--                  'condominios.tab.desempeno_personal')
--       OR key LIKE 'condominios.tab.turnos.%'
--       OR key LIKE 'condominios.tab.plantillas\_cargo.%'
--       OR key LIKE 'condominios.tab.ausencias.%'
--       OR key LIKE 'condominios.tab.horas\_extra.%'
--       OR key LIKE 'condominios.tab.presencia.%'
--       OR key LIKE 'condominios.tab.panel\_turno.%'
--       OR key LIKE 'condominios.tab.tareas\_personal.%'
--       OR key LIKE 'condominios.tab.revision\_tareas.%'
--       OR key LIKE 'condominios.tab.rutas\_ronda.%'
--       OR key LIKE 'condominios.tab.desempeno\_personal.%';
--
-- Idempotente: el UPDATE está acotado por categoría destino y la guarda vuelve
-- a pasar en la segunda corrida.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. Las 60 claves que se mudan, explícitas y sin comodines ───────────────
CREATE TEMP TABLE _rrhh_jornada (
  tab    text NOT NULL,
  accion text,
  key    text PRIMARY KEY
);

INSERT INTO _rrhh_jornada (tab, accion, key)
SELECT
  t.tab,
  a.accion,
  'condominios.tab.' || t.tab || COALESCE('.' || a.accion, '')
FROM (VALUES
  ('turnos'),
  ('plantillas_cargo'),
  ('ausencias'),
  ('horas_extra'),
  ('presencia'),
  ('panel_turno'),
  ('tareas_personal'),
  ('revision_tareas'),
  ('rutas_ronda'),
  ('desempeno_personal')
) AS t(tab)
CROSS JOIN (VALUES
  (NULL::text),
  ('create'),
  ('edit'),
  ('change_status'),
  ('approve'),
  ('delete')
) AS a(accion);

-- ── 1. Reclasificación ──────────────────────────────────────────────────────
UPDATE public.permissions p
SET category = 'recursos_humanos'
FROM _rrhh_jornada c
WHERE p.key = c.key
  AND p.category IS DISTINCT FROM 'recursos_humanos';

-- ── 2. Guarda de postcondición (ver cabecera, decisión (b)) ─────────────────
DO $$
DECLARE
  faltantes   text[];
  descolgadas text[];
BEGIN
  SELECT array_agg(c.key ORDER BY c.key) INTO faltantes
  FROM _rrhh_jornada c
  LEFT JOIN public.permissions p ON p.key = c.key
  WHERE p.key IS NULL;

  IF faltantes IS NOT NULL THEN
    RAISE EXCEPTION
      'RRHH/jornada: % clave(s) no existen en el catálogo: %. '
      'Si se renombró un tab, las policies que gatean sobre su clave quedaron sin efecto.',
      array_length(faltantes, 1), faltantes;
  END IF;

  SELECT array_agg(p.key ORDER BY p.key) INTO descolgadas
  FROM _rrhh_jornada c
  JOIN public.permissions p ON p.key = c.key
  WHERE p.category IS DISTINCT FROM 'recursos_humanos';

  IF descolgadas IS NOT NULL THEN
    RAISE EXCEPTION
      'RRHH/jornada: % clave(s) quedaron fuera de la categoría recursos_humanos: %.',
      array_length(descolgadas, 1), descolgadas;
  END IF;

  RAISE NOTICE
    'RRHH/jornada: 60 claves reclasificadas; ninguna renombrada.';
END $$;

DROP TABLE _rrhh_jornada;
