-- Datos de las mediciones de carga (se ejecuta sobre una base con la forma de la suite: fixture.sql + la migración). Uso: psql -v n=400000 -f preparar.sql
--   · empresa D: un proyecto PESADO b3f…00dd (N filas en amenidades) asignado a su propietario DOW, y dos pequeños b3f…00d1/00d2 con una asignación (DOP) para una víctima de la MISMA empresa
--     (otro propietario de D, DOW2);
--   · empresa C: cuatro proyectos pequeños b3f…0001-0004, cada uno con una asignación (OP1), y cuatro de D (b3f…00d1-00d4) para el coste.
-- Todo con el prefijo b3f00000-: se borra y se vuelve a crear en cada ejecución.
\set N :n
DELETE FROM public.user_project_assignments WHERE project_id::text LIKE 'b3f00000-%';
DELETE FROM public.projects WHERE id::text LIKE 'b3f00000-%';
INSERT INTO auth.users (id) VALUES ('a5e00000-0000-0000-0000-0000000000e2') ON CONFLICT DO NOTHING;
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES ('a5e00000-0000-0000-0000-0000000000e2', 'a5c00000-0000-0000-0000-000000000002', 'ASG propietario 2 de D', 'company_owner') ON CONFLICT DO NOTHING;
SET session_replication_role = replica;       -- sin el tope de proyectos del plan
INSERT INTO public.projects (id, company_id, nombre) VALUES ('b3f00000-0000-0000-0000-0000000000dd', 'a5c00000-0000-0000-0000-000000000002', 'ASG carga PD');
INSERT INTO public.projects (id, company_id, nombre) SELECT ('b3f00000-0000-0000-0000-00000000000' || g)::uuid, 'a5c00000-0000-0000-0000-000000000001', 'ASG carga C' || g FROM generate_series(1, 4) g;
INSERT INTO public.projects (id, company_id, nombre) SELECT ('b3f00000-0000-0000-0000-0000000000d' || g)::uuid, 'a5c00000-0000-0000-0000-000000000002', 'ASG carga D' || g FROM generate_series(1, 4) g;
SET session_replication_role = origin;
INSERT INTO public.user_project_assignments (user_id, project_id) VALUES ('a5e00000-0000-0000-0000-000000000004', 'b3f00000-0000-0000-0000-0000000000dd');
INSERT INTO public.user_project_assignments (user_id, project_id) SELECT 'a5e00000-0000-0000-0000-000000000021', ('b3f00000-0000-0000-0000-00000000000' || g)::uuid FROM generate_series(1, 4) g;
INSERT INTO public.user_project_assignments (user_id, project_id) SELECT 'a5e00000-0000-0000-0000-000000000012', ('b3f00000-0000-0000-0000-0000000000d' || g)::uuid FROM generate_series(1, 4) g;
INSERT INTO public.amenidades (company_id, project_id, nombre) SELECT 'a5c00000-0000-0000-0000-000000000002', 'b3f00000-0000-0000-0000-0000000000dd', 'a' || g FROM generate_series(1, :N) g;
ANALYZE public.amenidades;
