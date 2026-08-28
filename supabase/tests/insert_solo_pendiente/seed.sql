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
