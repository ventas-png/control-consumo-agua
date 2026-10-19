-- ============================================================================
-- La PURGA de una empresa con recorridos (purgar_empresa, 20261029000100 y
-- 20261030000000) no se traba en la tabla nueva.
--
-- rutina_areas referencia su área con RESTRICT y cae con el proyecto por
-- CASCADE: el mismo par que ya tienen tareas_condominio o rutinas_limpieza.
-- Corre sobre la forma de llaves MEDIDA en producción
-- (supabase/tests/purgar_empresa/forma_produccion.sql), donde
-- areas_condominio.project_id es CASCADE. En la forma del repositorio esa FK es
-- NO ACTION (drift declarado, #826) y ninguna empresa con áreas referenciadas
-- se puede purgar, con o sin esta migración: lo fija assert_areas.sql de la
-- suite de purga, no ésta.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT rr.sistema();
INSERT INTO rr.ids (alias, id) VALUES
  ('E',  'c0000000-0000-0000-0000-00000000000e'),
  ('E1', 'c1000000-0000-0000-0000-0000000000e1'),
  ('SA', 'c2000000-0000-0000-0000-0000000000aa');
INSERT INTO public.companies (id, nombre, max_projects) VALUES (rr.id('E'), 'Empresa E', 5);
INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES (rr.id('E1'), rr.id('E'), 'E1', 'condominio');
INSERT INTO auth.users (id, email) VALUES (rr.id('SA'), 'sa@rr.test');
INSERT INTO public.app_users (id, full_name, role) VALUES (rr.id('SA'), 'Superadmin', 'super_admin');
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, icono)
VALUES ('c4000000-0000-0000-0000-0000000000e1', rr.id('E'), rr.id('E1'), 'Lobby E1', '🏢');
-- Sin actividades a propósito: desde 20261031000300 la purga de una empresa con
-- actividades del catálogo se traba en RRHH_CARGO_EN_USO, con o sin esta
-- migración (hallazgo aparte). Lo que se mide aquí es la PARADA y su RESTRICT
-- hacia el área, también desde la cabecera legada.
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, icono)
VALUES ('c4000000-0000-0000-0000-0000000000e2', rr.id('E'), rr.id('E1'), 'Gradas E1', '🪜');
INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, servicio, area_id)
VALUES ('c9000000-0000-0000-0000-0000000000e1', rr.id('E'), rr.id('E1'), 'Rutina E1', 'limpieza',
        'c4000000-0000-0000-0000-0000000000e1');
SELECT rr.chk(
  (SELECT paradas FROM public.guardar_recorrido_rutina('c9000000-0000-0000-0000-0000000000e1',
     jsonb_build_array(jsonb_build_object('area_id', 'c4000000-0000-0000-0000-0000000000e1'),
                       jsonb_build_object('area_id', 'c4000000-0000-0000-0000-0000000000e2')))),
  2, 'G3 · recorrido de dos paradas en la empresa E');
UPDATE public.companies SET activa = false, suspended_at = now() - interval '120 days' WHERE id = rr.id('E');
SELECT public.purgar_empresa(rr.id('E'), rr.id('SA'), 'Empresa E', 90);
SELECT rr.chk(
  (SELECT count(*)::int FROM public.rutina_areas WHERE company_id = rr.id('E'))
  + (SELECT count(*)::int FROM public.companies WHERE id = rr.id('E')),
  0, 'G3 · la purga de la empresa se lleva su recorrido sin trabarse');
