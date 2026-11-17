-- ════════════════════════════════════════════════════════════════════════════
-- Recuperación de 20261130000000_agua_historial_lecturas
--
-- NO es una migración: se ejecuta a mano, por bloques, sólo si hace falta.
-- Regla general: preferir AVANZAR con una migración nueva.
--   A · inventario (solo lectura)
--   B · cerrar la importación sin perder el historial (reversible)
--   C · reversión completa (DESTRUCTIVA: borra el historial importado)
--
-- OJO: la importación pudo SUBIR `contadores.lectura_inicial` de contadores
-- sin lecturas. Borrar la tabla no lo deshace: si hace falta, el inventario A
-- lista qué contadores tienen historial para revisarlos a mano.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A · Inventario (solo lectura) ───────────────────────────────────────────
SELECT p.company_id, h.project_id, count(*) AS filas,
       count(DISTINCT h.contador_id) AS contadores,
       min(h.fecha) AS desde, max(h.fecha) AS hasta
  FROM public.agua_historial_lecturas h
  JOIN public.projects p ON p.id = h.project_id
 GROUP BY p.company_id, h.project_id
 ORDER BY filas DESC;

-- Contadores con historial y su lectura inicial actual (para revisar a mano).
-- SELECT c.id, c.numero_serie, c.lectura_inicial,
--        (SELECT h.lectura FROM public.agua_historial_lecturas h
--          WHERE h.contador_id = c.id AND h.lectura IS NOT NULL
--          ORDER BY h.fecha DESC LIMIT 1) AS ultima_del_historial
--   FROM public.contadores c
--  WHERE EXISTS (SELECT 1 FROM public.agua_historial_lecturas h WHERE h.contador_id = c.id);

-- ── B · Cerrar la importación (el historial queda y se sigue leyendo) ───────
-- REVOKE EXECUTE ON FUNCTION public.agua_historial_lecturas_importar(uuid, jsonb) FROM authenticated;
-- Para reabrir: GRANT EXECUTE ON FUNCTION public.agua_historial_lecturas_importar(uuid, jsonb) TO authenticated;

-- ── C · Reversión completa ──────────────────────────────────────────────────
-- Antes: exportar la tabla. El front tolera que falte (el historial llega vacío
-- y la comparación vuelve a usar sólo las lecturas del sistema).
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.agua_historial_lecturas_importar(uuid, jsonb);
--   DROP TABLE IF EXISTS public.agua_historial_lecturas;
--   DROP FUNCTION IF EXISTS public.agua_historial_lecturas_coherente();
-- COMMIT;
