-- ─── Fix: "Admin Agua" no puede escribir unidades (regresión) ───────────────
-- Tras 20260521000003, las políticas RLS de `unidades` exigen las claves
-- platform.unidades.create/edit/change_status para INSERT/UPDATE/DELETE.
--
-- Un "Admin de Agua" se crea (EmpresaSection.tsx) con tier de plataforma
-- 'operator' (rol Operador Plataforma = ...202, que solo tiene
-- platform.unidades.view) + el rol RBAC "Admin Agua" (= ...101, que hasta ahora
-- solo tenía claves agua.*). Ninguno otorga escritura sobre unidades y no se crea
-- user_project_assignment, así que todas las ramas de la RLS de unidades fallan.
-- Antes funcionaba porque el usuario era app_users.role='admin' (god-mode).
--
-- La gestión de unidades es parte natural de la administración del sistema de
-- agua (contadores → unidades → clientes). Este parche es ADITIVO y acotado:
-- otorga al rol "Admin Agua" las claves de escritura de unidades. No restaura el
-- god-mode (no toca clientes/configuración/comunicación/condominios) y no
-- modifica ninguna política, así que ningún usuario pierde acceso.

INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('00000000-0000-0000-0000-000000000101', 'platform.unidades.view',          'allow'),
  ('00000000-0000-0000-0000-000000000101', 'platform.unidades.create',        'allow'),
  ('00000000-0000-0000-0000-000000000101', 'platform.unidades.edit',          'allow'),
  ('00000000-0000-0000-0000-000000000101', 'platform.unidades.change_status', 'allow')
ON CONFLICT DO NOTHING;
