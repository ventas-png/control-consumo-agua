-- ============================================================================
-- Mover una unidad de proyecto arrastra sus contadores (y su historial)
-- ============================================================================
-- POR QUÉ. La regla ya declarada en 20260522000001 es: si un contador tiene
-- unidad, su proyecto y su empresa son SIEMPRE los de esa unidad. Aquel trigger
-- la cumple cuando se escribe el CONTADOR. Faltaba el otro lado: cuando lo que
-- cambia de proyecto es la UNIDAD, nadie tocaba sus contadores y se quedaban en
-- el proyecto viejo.
--
-- Caso real: 129 contadores de «Viñas del Sur Condominio Fase 1» se cargaron
-- por error en «21B+». Se corrigió el proyecto de cada unidad a mano, pero los
-- contadores siguieron en 21B+: la carga masiva del historial de lecturas (que
-- busca el contador por número de serie EN el proyecto elegido) los rechazaba
-- en Viñas 1 con «el contador no existe en el proyecto elegido» y los aceptaba
-- en 21B+.
--
-- QUÉ HACE.
--   1. Trigger en `unidades`: al cambiar su proyecto o empresa, sus contadores
--      pasan al mismo proyecto y empresa.
--   2. Trigger en `contadores`: al cambiar su proyecto o empresa (por la vía
--      que sea: el paso 1, cambiar de unidad, edición), su historial importado
--      (`agua_historial_lecturas`, dato de comparación, no cobra) lo sigue. Sin
--      esto el historial quedaría en el proyecto viejo, invisible para quien
--      sólo alcanza el nuevo.
--   3. Corrige los contadores que hoy están en un proyecto distinto al de su
--      unidad.
--
-- QUÉ NO HACE. No toca `registros`: una lectura ya cobrada conserva el
-- proyecto con el que se facturó (mover cobros entre proyectos cambia reportes
-- y contabilidad, y es una decisión aparte).
--
-- SECURITY DEFINER en ambas funciones: quien mueve la unidad puede no tener
-- permiso de edición sobre los contadores en el proyecto de origen; con
-- INVOKER la RLS saltaría esas filas EN SILENCIO y reaparecería justo el
-- desfase que esto cierra. No conceden nada: sólo copian proyecto/empresa de
-- la fila que el propio usuario ya pudo escribir. No son RPC (REVOKE).
--
-- Los triggers se declaran SIN lista de columnas y con WHEN: un `UPDATE OF
-- project_id` no dispara cuando el proyecto lo cambia otro trigger BEFORE (que
-- es justo lo que hace `trg_contadores_sync_project` al cambiar `unidad_id`).
--
-- IMPACTO EN DATOS (medido en producción antes de escribirla): 131 contadores
-- cambian de proyecto — 129 de 21B+ → Viñas del Sur Fase 1, 1 de Viñas del Sur
-- Fase 3 → La Arboleda CVH, 1 de Edificio SQ → Parajes Vermont—. Ninguno
-- cambia de empresa. Ninguno tiene historial importado; sólo uno tiene una
-- lectura en `registros`, que se queda como está.
--
-- CÓMO REVERTIR: scripts/reversion-unidad-arrastra-contadores.sql.
-- Idempotente: se puede aplicar dos veces.

-- ── 1. unidades → contadores ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unidad_arrastra_contadores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.contadores c
     SET project_id = NEW.project_id,
         company_id = COALESCE(NEW.company_id, c.company_id)
   WHERE c.unidad_id = NEW.id
     AND (c.project_id IS DISTINCT FROM NEW.project_id
          OR c.company_id IS DISTINCT FROM COALESCE(NEW.company_id, c.company_id));
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.unidad_arrastra_contadores() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_unidades_arrastra_contadores ON public.unidades;
CREATE TRIGGER trg_unidades_arrastra_contadores
  AFTER UPDATE ON public.unidades
  FOR EACH ROW
  WHEN (NEW.project_id IS NOT NULL
        AND (OLD.project_id IS DISTINCT FROM NEW.project_id
             OR OLD.company_id IS DISTINCT FROM NEW.company_id))
  EXECUTE FUNCTION public.unidad_arrastra_contadores();

-- ── 2. contadores → agua_historial_lecturas ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.contador_arrastra_historial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- `trg_agua_historial_lecturas_coherente` vuelve a leer proyecto y empresa
  -- del contador (ya actualizado: este trigger es AFTER) y los impone.
  UPDATE public.agua_historial_lecturas h
     SET project_id = NEW.project_id,
         company_id = NEW.company_id
   WHERE h.contador_id = NEW.id
     AND (h.project_id IS DISTINCT FROM NEW.project_id
          OR h.company_id IS DISTINCT FROM NEW.company_id);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contador_arrastra_historial() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contadores_arrastra_historial ON public.contadores;
CREATE TRIGGER trg_contadores_arrastra_historial
  AFTER UPDATE ON public.contadores
  FOR EACH ROW
  WHEN (OLD.project_id IS DISTINCT FROM NEW.project_id
        OR OLD.company_id IS DISTINCT FROM NEW.company_id)
  EXECUTE FUNCTION public.contador_arrastra_historial();

-- ── 3. Corrección de lo ya desfasado ────────────────────────────────────────
-- El criterio es la regla: proyecto y empresa del contador = los de su unidad.
-- El historial de esos contadores lo mueve el trigger del paso 2.
UPDATE public.contadores c
   SET project_id = u.project_id,
       company_id = COALESCE(u.company_id, c.company_id)
  FROM public.unidades u
 WHERE u.id = c.unidad_id
   AND u.project_id IS NOT NULL
   AND (c.project_id IS DISTINCT FROM u.project_id
        OR c.company_id IS DISTINCT FROM COALESCE(u.company_id, c.company_id));

-- Historial que ya estuviera en un proyecto distinto al de su contador.
UPDATE public.agua_historial_lecturas h
   SET project_id = c.project_id,
       company_id = c.company_id
  FROM public.contadores c
 WHERE c.id = h.contador_id
   AND (h.project_id IS DISTINCT FROM c.project_id
        OR h.company_id IS DISTINCT FROM c.company_id);
