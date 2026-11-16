-- ════════════════════════════════════════════════════════════════════════════
-- Recuperación de 20261125000000_rentas_modulo (Manejo de Rentas)
--
-- NO es una migración: se ejecuta a mano, por bloques, sólo si hace falta.
--   A · apagar el servicio (reversible, conserva todo)           ← lo normal
--   B · inventario de lo que hay (solo lectura)
--   C · reversión completa con respaldo previo (destruye datos)
--   D · comprobaciones
-- ════════════════════════════════════════════════════════════════════════════

-- ── A · Apagar el servicio ──────────────────────────────────────────────────
-- Con servicio_rentas = false la RLS de las cuatro tablas no deja leer ni
-- escribir a nadie de la empresa y el menú «Manejo Rentas» desaparece. Los
-- datos quedan intactos; volver a `true` los devuelve tal cual.
-- UPDATE public.companies SET servicio_rentas = false WHERE id = '<empresa>';
-- Para todas las empresas:
-- UPDATE public.companies SET servicio_rentas = false WHERE servicio_rentas;

-- ── B · Inventario (solo lectura) ───────────────────────────────────────────
SELECT c.id, c.nombre, c.servicio_rentas,
       (SELECT count(*) FROM public.rentas_propiedades p WHERE p.company_id = c.id) AS propiedades,
       (SELECT count(*) FROM public.rentas_reservas   r WHERE r.company_id = c.id) AS reservas,
       (SELECT count(*) FROM public.rentas_contratos  k WHERE k.company_id = c.id) AS contratos,
       (SELECT count(*) FROM public.rentas_inventario i WHERE i.company_id = c.id) AS articulos
  FROM public.companies c
 WHERE c.servicio_rentas
    OR EXISTS (SELECT 1 FROM public.rentas_propiedades p WHERE p.company_id = c.id)
 ORDER BY c.nombre;

-- Roles que recibieron permisos de Rentas.
SELECT r.name, r.company_id, count(*) AS claves
  FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
 WHERE rp.permission_key LIKE 'rentas.%'
 GROUP BY r.name, r.company_id ORDER BY r.name;

-- ── C · Reversión completa (DESTRUYE los datos de Rentas) ───────────────────
-- Antes: publicar una versión del front SIN el módulo (o apagar el servicio en
-- todas las empresas, bloque A). `reservas_str` NO se toca: las reservas de
-- propiedades enlazadas siguen en la pestaña STR de su condominio.
--
-- BEGIN;
--   CREATE SCHEMA IF NOT EXISTS respaldo_rentas;
--   CREATE TABLE respaldo_rentas.propiedades AS TABLE public.rentas_propiedades;
--   CREATE TABLE respaldo_rentas.reservas    AS TABLE public.rentas_reservas;
--   CREATE TABLE respaldo_rentas.contratos   AS TABLE public.rentas_contratos;
--   CREATE TABLE respaldo_rentas.inventario  AS TABLE public.rentas_inventario;
--   CREATE TABLE respaldo_rentas.grants AS
--     SELECT * FROM public.role_permissions WHERE permission_key LIKE 'rentas.%';
--   CREATE TABLE respaldo_rentas.servicio AS
--     SELECT id, servicio_rentas FROM public.companies WHERE servicio_rentas;
--
--   DROP TABLE IF EXISTS public.rentas_inventario;
--   DROP TABLE IF EXISTS public.rentas_contratos;
--   DROP TABLE IF EXISTS public.rentas_reservas;
--   DROP TABLE IF EXISTS public.rentas_propiedades;   -- arrastra triggers y policies
--   DROP FUNCTION IF EXISTS public.rentas_hija_coherente();
--   DROP FUNCTION IF EXISTS public.rentas_propiedad_coherente();
--   DROP FUNCTION IF EXISTS public.rentas_propiedad_accesible(uuid);
--   DROP FUNCTION IF EXISTS public.rentas_servicio_activo();
--   DELETE FROM public.role_permissions WHERE permission_key LIKE 'rentas.%';
--   DELETE FROM public.permissions WHERE key LIKE 'rentas.%';
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS servicio_rentas;
-- COMMIT;

-- ── D · Comprobaciones ──────────────────────────────────────────────────────
SELECT relname, relrowsecurity FROM pg_class
 WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'rentas\_%' AND relkind = 'r' ORDER BY 1;
SELECT tablename, count(*) AS policies FROM pg_policies WHERE tablename LIKE 'rentas\_%' GROUP BY 1 ORDER BY 1;
SELECT count(*) AS claves_rbac FROM public.permissions WHERE key LIKE 'rentas.%';
