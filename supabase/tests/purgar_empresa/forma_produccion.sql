-- ════════════════════════════════════════════════════════════════════════════
-- Deforma las llaves foráneas del esquema reconstruido hasta la forma MEDIDA en
-- producción el 2026-10-12 (pg_constraint, solo SELECT; inventario completo en
-- docs/PURGA_EMPRESA.md). Sólo las que tocan a la purga:
--
--   · 5 FK que en producción SÍ tienen ON DELETE CASCADE y en el repositorio no:
--     areas_condominio.project_id, mensajes_portal.company_id/project_id,
--     plantillas_tarea_cargo.project_id, rutas_ronda.project_id;
--   · 3 FK que existen en el repositorio y NO en producción:
--     plantillas_tarea_cargo.company_id, rutas_ronda.company_id,
--     amenidades_bloqueos.company_id.
--
-- Así la misma suite prueba la purga contra las DOS formas: la que se
-- reconstruye desde supabase/migrations y la que de verdad tiene producción.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

ALTER TABLE public.areas_condominio
  DROP CONSTRAINT areas_condominio_project_id_fkey,
  ADD CONSTRAINT areas_condominio_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.mensajes_portal
  DROP CONSTRAINT mensajes_portal_company_id_fkey,
  ADD CONSTRAINT mensajes_portal_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  DROP CONSTRAINT mensajes_portal_project_id_fkey,
  ADD CONSTRAINT mensajes_portal_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.plantillas_tarea_cargo
  DROP CONSTRAINT plantillas_tarea_cargo_company_id_fkey,
  DROP CONSTRAINT plantillas_tarea_cargo_project_id_fkey,
  ADD CONSTRAINT plantillas_tarea_cargo_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.rutas_ronda
  DROP CONSTRAINT rutas_ronda_company_id_fkey,
  DROP CONSTRAINT rutas_ronda_project_id_fkey,
  ADD CONSTRAINT rutas_ronda_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.amenidades_bloqueos DROP CONSTRAINT amenidades_bloqueos_company_id_fkey;
