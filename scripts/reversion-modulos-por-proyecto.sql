-- ════════════════════════════════════════════════════════════════════════════
-- Recuperación de 20261127000000_modulos_por_proyecto
--
-- NO es una migración: se ejecuta a mano, por bloques, sólo si hace falta.
-- Regla general: preferir AVANZAR con una migración nueva.
--   A · inventario (solo lectura)
--   B · volver a encender todos los módulos de una empresa (reversible, sin tocar el esquema)
--   C · quitar las compuertas
--   D · portal del residente como antes
--   E · quitar las columnas (sólo con el front anterior ya publicado)
-- ════════════════════════════════════════════════════════════════════════════

-- ── A · Inventario (solo lectura) ───────────────────────────────────────────
-- Proyectos con algún módulo apagado.
SELECT c.nombre AS empresa, p.id, p.nombre, p.modulo_agua, p.modulo_condominios, p.modulo_rentas
  FROM public.projects p JOIN public.companies c ON c.id = p.company_id
 WHERE NOT (p.modulo_agua AND p.modulo_condominios AND p.modulo_rentas)
 ORDER BY c.nombre, p.nombre;

-- ── B · Encender todo en una empresa ────────────────────────────────────────
-- UPDATE public.projects SET modulo_agua = true, modulo_condominios = true, modulo_rentas = true
--  WHERE company_id = '<empresa>';

-- ── C · Quitar las compuertas ───────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_projects_modulos_guard ON public.projects;
-- DROP FUNCTION IF EXISTS public.projects_modulos_guard();
-- DROP TRIGGER IF EXISTS trg_rentas_propiedades_modulo_proyecto ON public.rentas_propiedades;
-- DROP FUNCTION IF EXISTS public.rentas_propiedad_modulo_proyecto();

-- ── D · Portal del residente como antes ─────────────────────────────────────
-- Re-ejecutar el CREATE OR REPLACE FUNCTION public.portal_mis_unidades() de
-- supabase/migrations/20260822000000_portal_inquilino_selfservice.sql (bloque 2)
-- con su REVOKE/GRANT. Hay que hacerlo ANTES de E: la versión nueva lee las columnas.

-- ── E · Quitar las columnas ─────────────────────────────────────────────────
-- Sólo después de C y D, y con el front anterior publicado (el nuevo las lee en
-- una consulta aparte y tolera que no existan, pero «Módulos» dejaría de ofrecerse).
-- ALTER TABLE public.projects
--   DROP COLUMN IF EXISTS modulo_agua,
--   DROP COLUMN IF EXISTS modulo_condominios,
--   DROP COLUMN IF EXISTS modulo_rentas;
