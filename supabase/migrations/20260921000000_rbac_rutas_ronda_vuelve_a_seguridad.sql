-- ════════════════════════════════════════════════════════════════════════════
-- Rutas de Ronda vuelve a Seguridad
--
-- POR QUÉ
-- 20260907001400 se llevó diez tabs de Seguridad a Recursos Humanos con un
-- criterio correcto —programar una jornada no es vigilar— y en el paquete viajó
-- `rutas_ronda` bajo el rótulo de "el trabajo que se le asigna al personal".
--
-- Ese rótulo no aplica. Una ruta de ronda no reparte horas ni cubre puestos:
-- describe QUÉ SE VIGILA y EN QUÉ ORDEN. Su contraparte no es el turno del
-- guardia, es la ronda que ejecuta en el tab Seguridad, con sus visitas de
-- control y sus novedades. Definirla en Recursos Humanos obliga a quien lleva
-- la vigilancia a pedir un permiso del bloque de personal para cambiar un punto
-- del recorrido, y parte en dos secciones un mismo circuito: el recorrido se
-- define en un sitio y se ejecuta en otro.
--
-- QUÉ CAMBIA: la CATEGORÍA de las 6 claves de `condominios.tab.rutas_ronda`
-- vuelve a 'seguridad'. Nada más.
--
-- QUÉ NO CAMBIA
--   · Las CLAVES no se renombran. Las policies de `rutas_ronda`,
--     `puntos_control_ruta` y `visitas_control` (20260519000002) gatean sobre
--     `condominios.tab.rutas_ronda`: un rename las dejaría apuntando al vacío.
--   · El ACCESO EFECTIVO por rol. `CONDOMINIOS_TAB_ACCESS` ya daba el tab a los
--     roles seguridad y administrador_general antes de 20260907001400 y lo
--     siguió dando después: agrupar es presentación, no autorización. Quien lo
--     tuviera concedido a mano en un rol personalizado lo conserva — la fila de
--     `role_permissions` referencia la clave, no la categoría.
--
-- IMPACTO EN DATOS: solo `permissions.category`. Ni una fila de negocio.
--
-- CÓMO REVERTIR
--   UPDATE public.permissions SET category = 'recursos_humanos'
--    WHERE key = 'condominios.tab.rutas_ronda'
--       OR key LIKE 'condominios.tab.rutas\_ronda.%';
--
-- Idempotente: el UPDATE está acotado por categoría destino y la guarda vuelve
-- a pasar en la segunda corrida.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. Las 6 claves que se mueven, explícitas y sin comodines ──────────────
-- Sin `LIKE`: en un patrón LIKE el guion bajo es COMODÍN de un carácter, y
-- `rutas_ronda` lo lleva — `LIKE 'condominios.tab.rutas_ronda%'` casaría también
-- `condominios.tab.rutasXronda`. Misma decisión que 20260907001200/001400.
CREATE TEMP TABLE _ronda_a_seguridad (
  accion text,
  key    text PRIMARY KEY
);

INSERT INTO _ronda_a_seguridad (accion, key)
SELECT a.accion, 'condominios.tab.rutas_ronda' || COALESCE('.' || a.accion, '')
FROM (VALUES
  (NULL::text),
  ('create'),
  ('edit'),
  ('change_status'),
  ('approve'),
  ('delete')
) AS a(accion);

-- ── 1. Reclasificación ─────────────────────────────────────────────────────
UPDATE public.permissions p
SET category = 'seguridad'
FROM _ronda_a_seguridad c
WHERE p.key = c.key
  AND p.category IS DISTINCT FROM 'seguridad';

-- ── 2. Guarda de postcondición ─────────────────────────────────────────────
-- Un UPDATE que no encuentra filas no es error para Postgres: sin esta guarda,
-- un renombre aguas arriba pasaría en verde dejando la sección coja.
DO $$
DECLARE
  faltantes   text[];
  descolgadas text[];
BEGIN
  SELECT array_agg(c.key ORDER BY c.key) INTO faltantes
  FROM _ronda_a_seguridad c
  LEFT JOIN public.permissions p ON p.key = c.key
  WHERE p.key IS NULL;

  IF faltantes IS NOT NULL THEN
    RAISE EXCEPTION
      'RONDA/seguridad: % clave(s) no existen en el catálogo: %. '
      'Si se renombró el tab, las policies que gatean sobre su clave quedaron sin efecto.',
      array_length(faltantes, 1), faltantes;
  END IF;

  SELECT array_agg(p.key ORDER BY p.key) INTO descolgadas
  FROM _ronda_a_seguridad c
  JOIN public.permissions p ON p.key = c.key
  WHERE p.category IS DISTINCT FROM 'seguridad';

  IF descolgadas IS NOT NULL THEN
    RAISE EXCEPTION
      'RONDA/seguridad: % clave(s) quedaron fuera de la categoría seguridad: %.',
      array_length(descolgadas, 1), descolgadas;
  END IF;

  RAISE NOTICE 'RONDA/seguridad: 6 claves reclasificadas; ninguna renombrada.';
END $$;

DROP TABLE _ronda_a_seguridad;
