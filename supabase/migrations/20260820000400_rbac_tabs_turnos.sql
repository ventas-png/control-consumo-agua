-- ════════════════════════════════════════════════════════════════════════════
-- Control de asignación de turnos (5/5): catálogo RBAC de los tabs nuevos
--
-- POR QUÉ
-- `hasPermission()` es fail-closed: exige la fila explícita en `permissions`.
-- Sin esta migración, los tres tabs nuevos son invisibles para todo el que no
-- sea rol exento (super_admin / company_owner / admin), y —peor— las policies
-- de 20260820000000 y 20260820000100 gatean sobre claves que no existirían en
-- el catálogo, así que ni siquiera un rol personalizado podría recibirlas.
--
-- LOS TRES TABS, Y POR QUÉ TRES Y NO UNO
-- Son tres decisiones que toman personas distintas:
--   `turnos`      planificar la cobertura (jornadas y reglas de asignación)
--   `ausencias`   autorizar vacaciones, permisos y suspensiones, y declarar el
--                 calendario de festivos
--   `horas_extra` computar la jornada para planilla
-- Un solo permiso obligaría a que quien programa el turno del guardia pueda
-- también aprobarse vacaciones y cerrar horas. La separación es el punto.
--
-- HERENCIA DE GRANTS (parte 4 de cada bloque)
-- Cada tab nuevo copia los grants del tab existente cuyo trabajo continúa, para
-- que un rol personalizado no estrene los tres tabs sin permisos:
--   turnos      ← condominios.tab.tareas_personal  (quien ya arma los turnos)
--   ausencias   ← condominios.tab.presencia        (quien ya lleva asistencia)
--   horas_extra ← condominios.tab.personal         (quien ya ve el expediente
--                                                   y el salario)
-- Se respeta el `effect` allow/deny tal cual: un rol con deny explícito en el
-- tab de origen estrena el nuevo también denegado, que es lo que su
-- administrador quiso decir.
--
-- IMPACTO EN DATOS: solo inserta en el catálogo RBAC y en role_permissions.
-- Ningún dato de negocio. `trg_audit_role_permissions` ya registra los grants
-- en permission_audit_log sin que haya que tocar nada.
--
-- CÓMO REVERTIR
--   DELETE FROM public.role_permissions WHERE permission_key LIKE 'condominios.tab.turnos%'
--      OR permission_key LIKE 'condominios.tab.ausencias%'
--      OR permission_key LIKE 'condominios.tab.horas_extra%';
--   DELETE FROM public.permissions WHERE key LIKE 'condominios.tab.turnos%'
--      OR key LIKE 'condominios.tab.ausencias%'
--      OR key LIKE 'condominios.tab.horas_extra%';
--
-- Idempotente: ON CONFLICT DO NOTHING en todo.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Claves de visibilidad (3 segmentos = "Ver", convención 20260518000005) ──
INSERT INTO public.permissions (key, category, label, description) VALUES
  ('condominios.tab.turnos',      'seguridad', 'Asignación turnos', 'Jornadas y reglas de asignación de turnos al personal'),
  ('condominios.tab.ausencias',   'seguridad', 'Ausencias',         'Vacaciones, permisos, suspensiones y calendario de días no laborables'),
  ('condominios.tab.horas_extra', 'seguridad', 'Horas y extras',    'Cómputo de horario normal y horas extras laboradas')
ON CONFLICT (key) DO NOTHING;

-- ── 2. Acciones de cada tab (misma derivación que 20260703000000 parte 3) ───
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
WHERE p.key IN (
  'condominios.tab.turnos',
  'condominios.tab.ausencias',
  'condominios.tab.horas_extra'
)
ON CONFLICT (key) DO NOTHING;

-- ── 3. Administrador General de condominios: acceso completo ────────────────
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, p.key, 'allow'
FROM public.permissions p
WHERE p.key LIKE 'condominios.tab.turnos%'
   OR p.key LIKE 'condominios.tab.ausencias%'
   OR p.key LIKE 'condominios.tab.horas_extra%'
ON CONFLICT DO NOTHING;

-- ── 4. Herencia desde el tab que cada uno continúa (ver cabecera) ───────────
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT rp.role_id, p.key, rp.effect
FROM public.role_permissions rp
JOIN public.permissions p
  ON p.key = replace(rp.permission_key, 'condominios.tab.tareas_personal', 'condominios.tab.turnos')
WHERE rp.permission_key = 'condominios.tab.tareas_personal'
   OR rp.permission_key LIKE 'condominios.tab.tareas_personal.%'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT rp.role_id, p.key, rp.effect
FROM public.role_permissions rp
JOIN public.permissions p
  ON p.key = replace(rp.permission_key, 'condominios.tab.presencia', 'condominios.tab.ausencias')
WHERE rp.permission_key = 'condominios.tab.presencia'
   OR rp.permission_key LIKE 'condominios.tab.presencia.%'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT rp.role_id, p.key, rp.effect
FROM public.role_permissions rp
JOIN public.permissions p
  ON p.key = replace(rp.permission_key, 'condominios.tab.personal', 'condominios.tab.horas_extra')
WHERE rp.permission_key = 'condominios.tab.personal'
   OR rp.permission_key LIKE 'condominios.tab.personal.%'
ON CONFLICT DO NOTHING;
