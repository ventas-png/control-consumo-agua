-- Visualizador Plataforma: drop water defaults so the role matches its name.
--
-- The migration 20260518000013_rbac_platform_modules seeded this system role
-- with four agua.* view permissions (dashboard, mapa, tabla, servicios_energia)
-- as a mirror of the legacy `viewer` app_users role. Migration ...000013 also
-- auto-assigned the role to every existing `viewer`/`visor` user.
--
-- This auto-grant collides with explicit role assignments. When an admin
-- assigns a condominios-only role like "Guardia Nocturno" to a user whose
-- legacy platform role is `viewer`, the user still inherits the four agua
-- views from "Visualizador Plataforma" and the sidebar shows Dashboard,
-- Energía, Mapa and Historial — water tabs they were never meant to see.
--
-- Fix: leave the role in place (it remains a valid assignment target so
-- existing references in user_roles keep working) but strip its permission
-- grants so it no longer leaks water views by default. Admins who want
-- water visualization for a user must assign an explicit water role or a
-- custom role.

DELETE FROM public.role_permissions
WHERE role_id = '00000000-0000-0000-0000-000000000203'
  AND permission_key IN (
    'agua.dashboard.view',
    'agua.mapa.view',
    'agua.tabla.view',
    'agua.servicios_energia.view'
  );

-- Refresh the description so the role's intent is unambiguous going forward.
UPDATE public.roles
SET description = 'Marcador de visualizador a nivel plataforma. No otorga acceso a agua ni a condominios por defecto: combinar con un rol específico de servicio.'
WHERE id = '00000000-0000-0000-0000-000000000203';
