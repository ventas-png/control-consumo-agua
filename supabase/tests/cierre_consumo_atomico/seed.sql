-- Semilla PROPIA, encima de la de consumo_insumos (que ya sembró la receta de
-- «Limpiar la piscina», T1..T4 y la ruta de materialización).
--
-- Corre como superusuario: la RLS no aplica aquí. La identidad se declara en
-- los asserts con `app.uid`.

-- ── La empresa vecina ───────────────────────────────────────────────────────
-- Diego tiene EXACTAMENTE los permisos de Ana (tareas_personal) pero en OTRA
-- compañía: si el gate de la RPC mirara sólo el permiso y no el scope, Diego
-- podría cerrar y consumir tareas ajenas conociendo el UUID.
INSERT INTO public.companies (id) VALUES ('c0000000-0000-0000-0000-000000000002');
INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (id) VALUES ('a0000000-0000-0000-0000-00000000000d');
INSERT INTO public.app_users (id, full_name, company_id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000d', 'Diego (conserje vecino)',
   'c0000000-0000-0000-0000-000000000002', 'operador');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('a0000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-00000000000d');
INSERT INTO public.role_permissions (role_id, permission_key) VALUES
  ('d0000000-0000-0000-0000-00000000000d', 'condominios.tab.tareas_personal');

-- ── Tareas para los escenarios nuevos ───────────────────────────────────────
-- `uq_tareas_bloque_plantilla` impide repetir (bloque, plantilla): cada
-- escenario que necesita la receta completa recibe su propio bloque.
INSERT INTO public.bloques_turno
  (id, company_id, project_id, personal_id, fecha, estado) VALUES
  -- T5: cierre por 'con_observacion' y consumo declarado DESPUÉS (RPC vieja).
  ('70000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   '2026-09-12', 'en_curso'),
  -- T6: las dos sesiones concurrentes sincronizadas con barrera.
  ('70000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   '2026-09-13', 'en_curso');

INSERT INTO public.tareas_bloque (id, bloque_id, plantilla_id, titulo, orden) VALUES
  ('a1000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000004',
   '80000000-0000-0000-0000-000000000001', 'Limpiar la piscina', 0),
  ('a1000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000005',
   '80000000-0000-0000-0000-000000000001', 'Limpiar la piscina', 0);
