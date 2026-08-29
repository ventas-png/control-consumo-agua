-- Semilla POSTERIOR a las migraciones. El fixture de tareas_bloque_paridad ya
-- trae dos de las tres familias de permisos que acepta la policy de INSERT:
-- Beto (tareas_personal) y Hugo (prog_limpieza). Aquí se completa el tablero:
--
--   · Tomás, con SOLO `turnos` — la tercera familia. Las pruebas adversariales
--     corren POR FAMILIA: que una puerta esté cerrada no dice nada de las
--     otras dos.
--   · Ana (admin) ya existe: user_has_permission le dice sí a todo, y por eso
--     es el caso que prueba que el contrato del alta NO tiene bypass por rol
--     de empresa.

INSERT INTO auth.users (id) VALUES ('e0000000-0000-0000-0000-00000000000f');
INSERT INTO public.app_users (id, full_name, company_id, role) VALUES
  ('e0000000-0000-0000-0000-00000000000f', 'Tomás Turnos',
   'aaaaaaaa-0000-0000-0000-000000000001', 'operator');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('cccccccc-0000-0000-0000-000000000003', 'condominios.tab.turnos', 'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('e0000000-0000-0000-0000-00000000000f', 'cccccccc-0000-0000-0000-000000000003');

-- Silvia, super_admin DE PLATAFORMA (20260907001100): sin compañía y sin
-- user_roles — la rama de empresa (get_my_company_id + permisos) le da false
-- por diseño, así que TODO lo que le entre o se le rechace pasa por la rama
-- `is_super_admin()` a solas. Es el caso que 20260907000900 dejó exento del
-- contrato del alta y el que 20260907001100 mete dentro.
INSERT INTO auth.users (id) VALUES ('e0000000-0000-0000-0000-000000000010');
INSERT INTO public.app_users (id, full_name, company_id, role) VALUES
  ('e0000000-0000-0000-0000-000000000010', 'Silvia Superadmin', NULL, 'super_admin');
