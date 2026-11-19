-- ════════════════════════════════════════════════════════════════════════════
-- Recuperación de 20261204000000_unidad_proyecto_arrastra_contadores
--
-- NO es una migración: se ejecuta a mano, por bloques, sólo si hace falta.
-- Regla general: preferir AVANZAR con una migración nueva.
--   A · inventario (solo lectura)
--   B · quitar los triggers (reversible: se vuelven a crear re-aplicando la migración)
--
-- La corrección de datos del paso 3 de la migración no guarda el proyecto
-- anterior de cada contador y devolverlo sería reabrir el desfase (contador en
-- un proyecto, su unidad en otro). Si hiciera falta mover un contador, se mueve
-- su unidad o se le asigna otra.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A · Inventario (solo lectura) ───────────────────────────────────────────
-- Contadores en un proyecto distinto al de su unidad: debe dar 0 filas.
SELECT c.id, c.numero_serie, c.project_id AS proyecto_contador, u.project_id AS proyecto_unidad
  FROM public.contadores c
  JOIN public.unidades u ON u.id = c.unidad_id
 WHERE c.project_id IS DISTINCT FROM u.project_id;

-- Historial en un proyecto distinto al de su contador: debe dar 0 filas.
SELECT h.id, h.contador_id, h.project_id AS proyecto_historial, c.project_id AS proyecto_contador
  FROM public.agua_historial_lecturas h
  JOIN public.contadores c ON c.id = h.contador_id
 WHERE h.project_id IS DISTINCT FROM c.project_id;

-- ── B · Quitar los triggers ─────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_unidades_arrastra_contadores ON public.unidades;
-- DROP TRIGGER IF EXISTS trg_contadores_arrastra_historial ON public.contadores;
-- DROP FUNCTION IF EXISTS public.unidad_arrastra_contadores();
-- DROP FUNCTION IF EXISTS public.contador_arrastra_historial();
