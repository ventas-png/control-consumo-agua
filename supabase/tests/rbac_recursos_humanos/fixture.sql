-- ════════════════════════════════════════════════════════════════════════════
-- Fixture: el catálogo RBAC tal como lo dejan 20260518000004 (esquema),
-- 20260518000005 (siembra por tab) y 20260703000000 (acciones por tab), justo
-- ANTES de 20260907001200.
--
-- No se copian las migraciones enteras: de ellas sólo importa la FORMA del
-- catálogo y el estado de partida de los cinco tabs. Lo que sí se reproduce
-- literal es lo que la migración bajo prueba consume: el PK de `permissions`,
-- el PK compuesto de `role_permissions` (del que depende cada ON CONFLICT DO
-- NOTHING) y la FK de `permission_key`, que es la que impide sembrar un grant
-- para una clave que no existe.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.permissions (
  key         text PRIMARY KEY,
  category    text NOT NULL,
  label       text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.roles (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  is_system  boolean NOT NULL DEFAULT false
);

CREATE TABLE public.role_permissions (
  role_id        uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  effect         text NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow', 'deny')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_key)
);

-- ── Claves base, con la categoría que tenían ANTES de la mudanza ────────────
-- Cuatro de los cinco tabs ya existen; `actividad_equipo` NO — ése es
-- precisamente el hueco que 20260907001200 viene a tapar.
INSERT INTO public.permissions (key, category, label, description) VALUES
  ('condominios.tab.personal',              'administracion', 'Personal',        'Personal'),
  ('condominios.tab.capacitacion_personal', 'administracion', 'Capacitación',    'Capacitación de personal'),
  ('condominios.tab.tareas_cond',           'operaciones',    'Tareas',          'Tareas del condominio'),
  ('condominios.tab.prog_limpieza',         'operaciones',    'Prog. limpieza',  'Programa de limpieza'),
  -- Vecinos que NO se mudan: sirven de control negativo (su categoría no debe
  -- moverse) y `documentos` cubre el caso del prefijo compartido.
  ('condominios.tab.documentos',            'administracion', 'Documentos',      'Documentos'),
  ('condominios.tab.inventario',            'operaciones',    'Inventario',      'Inventario'),
  ('condominios.tab.tareas_personal',       'seguridad',      'Tareas personal', 'Tareas del personal de seguridad');

-- ── Acciones derivadas (réplica de 20260703000000 parte 3) ──────────────────
INSERT INTO public.permissions (key, category, label, description)
SELECT
  p.key || '.' || a.akey,
  p.category,
  a.alabel || ' — ' || p.label,
  a.alabel || ' en ' || p.label
FROM public.permissions p
CROSS JOIN (VALUES
  ('create',        'Crear'),
  ('edit',          'Editar'),
  ('change_status', 'Cambiar estado'),
  ('approve',       'Autorizar / Denegar'),
  ('delete',        'Eliminar')
) AS a(akey, alabel)
WHERE p.key LIKE 'condominios.tab.%'
  AND array_length(string_to_array(p.key, '.'), 1) = 3;

-- ── Roles de prueba ─────────────────────────────────────────────────────────
INSERT INTO public.roles (id, name, is_system) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Administrador General', true),
  -- Rol que administra al personal con todas las acciones: debe estrenar
  -- actividad_equipo completo.
  ('00000000-0000-0000-0000-0000000000a1', 'RRHH completo',        false),
  -- Rol que SÓLO mira el expediente: debe estrenar SÓLO la visibilidad.
  ('00000000-0000-0000-0000-0000000000a2', 'RRHH sólo lectura',    false),
  -- Rol con deny explícito sobre personal: el deny tiene que viajar.
  ('00000000-0000-0000-0000-0000000000a3', 'Personal denegado',    false),
  -- Rol de operaciones con tareas y limpieza: no debe perder NADA con la
  -- mudanza de sección.
  ('00000000-0000-0000-0000-0000000000a4', 'Operaciones',          false),
  -- Rol sin nada que ver con personal: no debe ganar nada.
  ('00000000-0000-0000-0000-0000000000a5', 'Documentalista',       false);

INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'condominios.tab.personal',               'allow'),
  ('00000000-0000-0000-0000-0000000000a1', 'condominios.tab.personal.create',        'allow'),
  ('00000000-0000-0000-0000-0000000000a1', 'condominios.tab.personal.edit',          'allow'),
  ('00000000-0000-0000-0000-0000000000a1', 'condominios.tab.personal.change_status', 'allow'),
  ('00000000-0000-0000-0000-0000000000a1', 'condominios.tab.personal.approve',       'allow'),
  ('00000000-0000-0000-0000-0000000000a1', 'condominios.tab.personal.delete',        'allow'),

  ('00000000-0000-0000-0000-0000000000a2', 'condominios.tab.personal',               'allow'),

  ('00000000-0000-0000-0000-0000000000a3', 'condominios.tab.personal',               'deny'),
  ('00000000-0000-0000-0000-0000000000a3', 'condominios.tab.personal.edit',          'deny'),

  ('00000000-0000-0000-0000-0000000000a4', 'condominios.tab.tareas_cond',            'allow'),
  ('00000000-0000-0000-0000-0000000000a4', 'condominios.tab.tareas_cond.edit',       'allow'),
  ('00000000-0000-0000-0000-0000000000a4', 'condominios.tab.prog_limpieza',          'allow'),
  ('00000000-0000-0000-0000-0000000000a4', 'condominios.tab.prog_limpieza.create',   'allow'),
  ('00000000-0000-0000-0000-0000000000a4', 'condominios.tab.inventario',             'allow'),

  ('00000000-0000-0000-0000-0000000000a5', 'condominios.tab.documentos',             'allow'),
  ('00000000-0000-0000-0000-0000000000a5', 'condominios.tab.documentos.edit',        'allow');
