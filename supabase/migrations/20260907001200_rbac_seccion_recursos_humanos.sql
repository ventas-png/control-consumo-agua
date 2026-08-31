-- ════════════════════════════════════════════════════════════════════════════
-- Sección "Recursos Humanos" en el catálogo RBAC
--
-- POR QUÉ
-- El Módulo Completo agrupa los tabs en secciones (components/condominios/
-- sections.ts) y el editor de roles agrupa los permisos por `permissions.
-- category`. Ambos usaban las mismas llaves, y el personal quedaba repartido:
-- el expediente y la formación colgaban de "Administración" (junto a los
-- documentos y la configuración del condominio) y el trabajo que se le asigna
-- —tareas y limpieza— de "Operaciones" (junto a proveedores y órdenes de
-- compra). Quien armaba un rol para la persona que administra al personal
-- tenía que ir a dos bloques y arrastraba permisos que no quería dar.
--
-- QUÉ CAMBIA
-- Se reclasifican a la categoría `recursos_humanos` los cinco tabs de la
-- sección nueva, con sus claves de acción:
--   personal              expediente del empleado
--   capacitacion_personal formación y certificados
--   tareas_cond           tareas asignadas al personal
--   prog_limpieza         programación de limpieza
--   actividad_equipo      lo que cada persona reportó (medición)
--
-- LAS CLAVES NO CAMBIAN, SOLO SU CATEGORÍA. `condominios.tab.tareas_cond` y
-- `condominios.tab.prog_limpieza` siguen llamándose igual, así que las policies
-- que gatean sobre ellas (20260518000010, 20260807130000, 20260904000200,
-- 20260904000300, 20260907000100…) siguen valiendo y ningún rol pierde acceso.
--
-- `actividad_equipo` ES NUEVO EN EL CATÁLOGO
-- El tab existe desde 20260731000300 pero nunca se sembró su permiso, y
-- `hasPermission()` es fail-closed: hoy solo lo ve un rol exento (super_admin /
-- company_owner / admin) y ningún rol personalizado podía recibirlo. Se siembra
-- aquí y hereda los grants de `condominios.tab.personal`, que es el tab cuyo
-- trabajo continúa (quien ya ve el expediente del empleado es quien mide su
-- actividad). Se respeta el `effect` allow/deny tal cual.
--
-- ── DOS DECISIONES QUE NO SON DE ESTILO ────────────────────────────────────
--
-- (a) NADA DE `LIKE`, CLAVES EXACTAS. En `LIKE`, el guion bajo es un COMODÍN de
--     un carácter, y cuatro de estos cinco tabs lo llevan en el nombre:
--     `LIKE 'condominios.tab.actividad_equipo%'` también casa
--     `condominios.tab.actividadXequipo`. Hoy no existe esa clave y el patrón
--     sería inofensivo, pero el catálogo lo escribe gente y una clave vecina
--     entraría sin que nada avise. Las 30 claves de la sección (5 tabs × base +
--     5 acciones) se materializan explícitas en `_rrhh_claves` y todo el resto
--     de la migración se une contra esa tabla por igualdad.
--
-- (b) GUARDA DE POSTCONDICIÓN (paso 6). Un `UPDATE` que no encuentra filas no
--     es un error para Postgres: si alguien renombra `condominios.tab.
--     tareas_cond` aguas arriba, esta migración pasa en verde, la sección queda
--     coja en el editor de roles y nadie se entera hasta que un administrador
--     no encuentra el permiso. La guarda convierte esa deriva silenciosa en un
--     fallo de despliegue ruidoso, que es la convención de las migraciones de
--     este repo que validan antes de tocar datos.
--
-- IMPACTO EN DATOS: solo catálogo RBAC y role_permissions. Ningún dato de
-- negocio. `trg_audit_role_permissions` registra los grants nuevos solo.
--
-- CÓMO REVERTIR
--   UPDATE public.permissions SET category = 'administracion'
--    WHERE key IN ('condominios.tab.personal','condominios.tab.capacitacion_personal')
--       OR key LIKE 'condominios.tab.personal.%'
--       OR key LIKE 'condominios.tab.capacitacion\_personal.%';
--   UPDATE public.permissions SET category = 'operaciones'
--    WHERE key IN ('condominios.tab.tareas_cond','condominios.tab.prog_limpieza')
--       OR key LIKE 'condominios.tab.tareas\_cond.%'
--       OR key LIKE 'condominios.tab.prog\_limpieza.%';
--   DELETE FROM public.role_permissions WHERE permission_key LIKE 'condominios.tab.actividad\_equipo%';
--   DELETE FROM public.permissions      WHERE key            LIKE 'condominios.tab.actividad\_equipo%';
--
-- Idempotente: ON CONFLICT DO NOTHING en todo INSERT, UPDATE acotado por
-- categoría destino, y la guarda vuelve a pasar en la segunda corrida.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. Las 30 claves de la sección, explícitas y sin comodines ──────────────
-- `accion` NULL = la clave base de 3 segmentos, que es la visibilidad ("Ver")
-- por la convención de 20260518000005.
CREATE TEMP TABLE _rrhh_claves (
  tab    text NOT NULL,
  accion text,
  key    text PRIMARY KEY,
  nueva  boolean NOT NULL
);

INSERT INTO _rrhh_claves (tab, accion, key, nueva)
SELECT
  t.tab,
  a.accion,
  'condominios.tab.' || t.tab || COALESCE('.' || a.accion, ''),
  t.nueva
FROM (VALUES
  ('personal',              false),
  ('capacitacion_personal', false),
  ('tareas_cond',           false),
  ('prog_limpieza',         false),
  ('actividad_equipo',      true)
) AS t(tab, nueva)
CROSS JOIN (VALUES
  (NULL::text),
  ('create'),
  ('edit'),
  ('change_status'),
  ('approve'),
  ('delete')
) AS a(accion);

-- ── 1. Clave de visibilidad de actividad_equipo (3 segmentos = "Ver") ───────
INSERT INTO public.permissions (key, category, label, description)
SELECT c.key, 'recursos_humanos', 'Actividad equipo',
       'Actividad operativa reportada por cada persona del equipo'
FROM _rrhh_claves c
WHERE c.nueva AND c.accion IS NULL
ON CONFLICT (key) DO NOTHING;

-- ── 2. Acciones del tab (misma derivación que 20260703000000 parte 3) ───────
INSERT INTO public.permissions (key, category, label, description)
SELECT
  c.key,
  base.category,
  etiqueta.alabel || ' — ' || base.label,
  etiqueta.alabel || ' en ' || base.label
FROM _rrhh_claves c
JOIN public.permissions base
  ON base.key = 'condominios.tab.' || c.tab
JOIN (VALUES
  ('create',        'Crear'),
  ('edit',          'Editar'),
  ('change_status', 'Cambiar estado'),
  ('approve',       'Autorizar / Denegar'),
  ('delete',        'Eliminar')
) AS etiqueta(accion, alabel)
  ON etiqueta.accion = c.accion
WHERE c.nueva AND c.accion IS NOT NULL
ON CONFLICT (key) DO NOTHING;

-- ── 3. Administrador General de condominios: acceso completo ────────────────
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, p.key, 'allow'
FROM _rrhh_claves c
JOIN public.permissions p ON p.key = c.key
WHERE c.nueva
ON CONFLICT DO NOTHING;

-- ── 4. Herencia desde `personal` (ver cabecera) ─────────────────────────────
-- Acción a acción: quien tenía `personal.edit` estrena `actividad_equipo.edit`,
-- y quien sólo tenía la visibilidad estrena sólo la visibilidad. El `effect` se
-- copia tal cual: un deny explícito en el origen nace denegado en el destino.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT rp.role_id, destino.key, rp.effect
FROM public.role_permissions rp
JOIN _rrhh_claves origen
  ON origen.tab = 'personal' AND origen.key = rp.permission_key
JOIN _rrhh_claves destino
  ON destino.tab = 'actividad_equipo'
 AND destino.accion IS NOT DISTINCT FROM origen.accion
JOIN public.permissions p ON p.key = destino.key
ON CONFLICT DO NOTHING;

-- ── 5. Reclasificación de las 30 claves de la sección ───────────────────────
UPDATE public.permissions p
SET category = 'recursos_humanos'
FROM _rrhh_claves c
WHERE p.key = c.key
  AND p.category IS DISTINCT FROM 'recursos_humanos';

-- ── 6. Guarda de postcondición (ver cabecera, decisión (b)) ─────────────────
DO $$
DECLARE
  faltantes  text[];
  descolgadas text[];
  sin_heredar int;
BEGIN
  -- 6a · Ninguna clave de la sección puede faltar del catálogo. Si falta, o
  -- alguien la renombró aguas arriba —y entonces las policies que gatean sobre
  -- ella ya están apuntando al vacío— o el orden de migraciones cambió.
  SELECT array_agg(c.key ORDER BY c.key) INTO faltantes
  FROM _rrhh_claves c
  LEFT JOIN public.permissions p ON p.key = c.key
  WHERE p.key IS NULL;

  IF faltantes IS NOT NULL THEN
    RAISE EXCEPTION
      'RRHH: % clave(s) de la sección no existen en el catálogo: %. '
      'Si se renombró un tab, las policies que gatean sobre su clave quedaron sin efecto.',
      array_length(faltantes, 1), faltantes;
  END IF;

  -- 6b · Y todas tienen que haber quedado en la categoría nueva.
  SELECT array_agg(p.key ORDER BY p.key) INTO descolgadas
  FROM _rrhh_claves c
  JOIN public.permissions p ON p.key = c.key
  WHERE p.category IS DISTINCT FROM 'recursos_humanos';

  IF descolgadas IS NOT NULL THEN
    RAISE EXCEPTION
      'RRHH: % clave(s) quedaron fuera de la categoría recursos_humanos: %.',
      array_length(descolgadas, 1), descolgadas;
  END IF;

  -- 6c · La herencia tiene que ser total: ningún rol con una acción de
  -- `personal` puede quedarse sin la equivalente de `actividad_equipo`, o el
  -- tab nuevo nace invisible justo para quien administra al personal.
  SELECT count(*) INTO sin_heredar
  FROM public.role_permissions rp
  JOIN _rrhh_claves origen
    ON origen.tab = 'personal' AND origen.key = rp.permission_key
  JOIN _rrhh_claves destino
    ON destino.tab = 'actividad_equipo'
   AND destino.accion IS NOT DISTINCT FROM origen.accion
  WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions ya
    WHERE ya.role_id = rp.role_id AND ya.permission_key = destino.key
  );

  IF sin_heredar > 0 THEN
    RAISE EXCEPTION
      'RRHH: % grant(s) de personal no se propagaron a actividad_equipo.', sin_heredar;
  END IF;

  RAISE NOTICE
    'RRHH: 30 claves en recursos_humanos, ninguna renombrada, herencia de actividad_equipo completa.';
END $$;

DROP TABLE _rrhh_claves;
