-- ════════════════════════════════════════════════════════════════════════════
-- Recuperación de 20261128000000_rentas_finanzas
--
-- NO es una migración: se ejecuta a mano, por bloques, sólo si hace falta.
-- Regla general: preferir AVANZAR con una migración nueva.
--   A · inventario (solo lectura)
--   B · dejar de sembrar conceptos al contratar (reversible)
--   C · reversión completa (DESTRUCTIVA: borra desgloses, conceptos y gastos)
-- ════════════════════════════════════════════════════════════════════════════

-- ── A · Inventario (solo lectura) ───────────────────────────────────────────
SELECT c.id, c.nombre,
       (SELECT count(*) FROM public.rentas_conceptos x     WHERE x.company_id = c.id) AS conceptos,
       (SELECT count(*) FROM public.rentas_liquidaciones x WHERE x.company_id = c.id) AS desgloses,
       (SELECT count(*) FROM public.rentas_gastos x        WHERE x.company_id = c.id) AS gastos
  FROM public.companies c
 WHERE c.servicio_rentas
 ORDER BY c.nombre;

-- ── B · Dejar de sembrar conceptos ──────────────────────────────────────────
-- ALTER TABLE public.companies DISABLE TRIGGER trg_companies_rentas_conceptos;
-- Para reanudar: ALTER TABLE public.companies ENABLE TRIGGER trg_companies_rentas_conceptos;

-- ── C · Reversión completa ──────────────────────────────────────────────────
-- Antes: exportar las tres tablas. El front tolera que falten (las listas llegan
-- vacías y la pestaña Finanzas deja de aparecer al quitar las claves).
-- BEGIN;
--   DROP TRIGGER IF EXISTS trg_companies_rentas_conceptos ON public.companies;
--   DROP FUNCTION IF EXISTS public.companies_rentas_conceptos();
--   DROP TABLE IF EXISTS public.rentas_liquidaciones;
--   DROP TABLE IF EXISTS public.rentas_gastos;
--   DROP TABLE IF EXISTS public.rentas_conceptos;
--   DROP FUNCTION IF EXISTS public.rentas_liquidacion_coherente();
--   DROP FUNCTION IF EXISTS public.rentas_concepto_coherente();
--   DROP FUNCTION IF EXISTS public.rentas_sembrar_conceptos(uuid);
--   ALTER TABLE public.rentas_reservas
--     DROP CONSTRAINT IF EXISTS rentas_reservas_politica_check,
--     DROP CONSTRAINT IF EXISTS rentas_reservas_mascotas_check,
--     DROP COLUMN IF EXISTS politica_cancelacion,
--     DROP COLUMN IF EXISTS num_mascotas;
--   DELETE FROM public.role_permissions WHERE permission_key LIKE 'rentas.finanzas.%';
--   DELETE FROM public.permissions      WHERE key LIKE 'rentas.finanzas.%';
--   -- y volver a crear rentas_propiedades_select como en 20261125000000 (sin rentas.finanzas.view).
-- COMMIT;
