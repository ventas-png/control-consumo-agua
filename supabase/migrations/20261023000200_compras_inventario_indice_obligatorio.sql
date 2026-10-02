-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · CORRECCIÓN DEL BLOQUE C · LA PROTECCIÓN DE INVENTARIO NO ES OPCIONAL
--
-- DEFECTO (20261022000000, ya aplicada: NO se edita)
--   El índice único `uq_mov_suministro_origen_recepcion` (una entrada y como mucho una salida
--   compensatoria por renglón de recepción) se creaba SOLO si no había duplicados; si los había,
--   la migración emitía un WARNING y seguía adelante SIN la protección: un despliegue «exitoso»
--   que dejaba el kardex expuesto a doble entrada en reintentos y sesiones simultáneas. Además
--   `CREATE UNIQUE INDEX IF NOT EXISTS` daba por bueno cualquier índice previo con ese nombre,
--   aunque estuviera inválido o definido de otra forma.
--
-- CORRECCIÓN
--   Esta migración EXIGE que el índice exista, sea único, esté válido y listo, y tenga la definición
--   esperada: (origen_tabla, origen_id) WHERE origen_tabla IN ('recepcion_lineas',
--   'recepcion_lineas_anulada') AND origen_id IS NOT NULL.
--     · Con movimientos duplicados: SE DETIENE con un diagnóstico (qué renglón, cuántos movimientos y
--       sus ids). NO se omite con un WARNING y NO se borra ni se modifica ningún movimiento: los
--       duplicados históricos exigen una intervención autorizada y revisada por una persona.
--     · Con un índice del mismo nombre INVÁLIDO: se reconstruye (REINDEX, en la misma transacción) y
--       se vuelve a verificar.
--     · Con un índice del mismo nombre y OTRA definición: SE DETIENE (no se pisa a ciegas).
--     · Sin índice: se crea.
--   La tabla se bloquea (SHARE ROW EXCLUSIVE) mientras se comprueba y se crea, para que ninguna
--   sesión inserte un duplicado entre la comprobación y el índice. En producción el índice ya
--   existe y es válido (diagnóstico de solo lectura): esta migración no cambia nada allí salvo
--   verificarlo.
-- CÓMO REVERTIR: no hay nada que revertir (solo verifica o crea la protección).
-- IMPACTO EN DATOS: ninguno. No borra ni modifica movimientos.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_dup    text;
  v_idx    record;
  v_cols   text[];
  v_pred   text;
  v_ok     boolean;
BEGIN
  LOCK TABLE public.movimientos_suministro IN SHARE ROW EXCLUSIVE MODE;

  -- 1. Duplicados históricos: se detiene con el detalle, no se omite la protección.
  SELECT string_agg(format('  · %s %s: %s movimientos (ids %s)', d.origen_tabla, d.origen_id, d.n, d.ids), E'\n'
                    ORDER BY d.origen_tabla, d.origen_id)
    INTO v_dup
    FROM (
      SELECT m.origen_tabla, m.origen_id, count(*) AS n, string_agg(m.id::text, ', ' ORDER BY m.id) AS ids
        FROM public.movimientos_suministro m
       WHERE m.origen_tabla IN ('recepcion_lineas', 'recepcion_lineas_anulada') AND m.origen_id IS NOT NULL
       GROUP BY m.origen_tabla, m.origen_id HAVING count(*) > 1
       ORDER BY m.origen_tabla, m.origen_id
       LIMIT 50
    ) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION E'COMPRAS_INVENTARIO_DUPLICADOS: hay movimientos de recepción duplicados y la protección de inventario no puede instalarse. NO se omite ni se corrige solo.\n%\nRevisar a mano con una intervención autorizada (hasta 50 renglones mostrados) y volver a aplicar.', v_dup
      USING ERRCODE = 'unique_violation';
  END IF;

  -- 2. ¿Existe un índice con ese nombre? Debe ser el esperado y estar válido.
  SELECT i.indisvalid, i.indisready, i.indisunique, i.indexrelid, i.indrelid
    INTO v_idx
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'uq_mov_suministro_origen_recepcion';

  IF FOUND THEN
    IF v_idx.indrelid <> 'public.movimientos_suministro'::regclass THEN
      RAISE EXCEPTION 'COMPRAS_INVENTARIO_INDICE: uq_mov_suministro_origen_recepcion existe pero pertenece a otra tabla.';
    END IF;
    IF NOT (v_idx.indisvalid AND v_idx.indisready) THEN
      REINDEX INDEX public.uq_mov_suministro_origen_recepcion;
    END IF;
  ELSE
    CREATE UNIQUE INDEX uq_mov_suministro_origen_recepcion
      ON public.movimientos_suministro (origen_tabla, origen_id)
      WHERE origen_tabla IN ('recepcion_lineas', 'recepcion_lineas_anulada') AND origen_id IS NOT NULL;
  END IF;

  -- 3. Verificación final: instalado, único, válido, listo y con la definición esperada.
  SELECT i.indisvalid AND i.indisready AND i.indisunique AND i.indnatts = 2,
         ARRAY(SELECT a.attname::text FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.ord),
         pg_get_expr(i.indpred, i.indrelid)
    INTO v_ok, v_cols, v_pred
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'uq_mov_suministro_origen_recepcion';

  IF NOT FOUND OR NOT COALESCE(v_ok, false)
     OR v_cols IS DISTINCT FROM ARRAY['origen_tabla', 'origen_id']
     OR v_pred IS NULL
     OR v_pred NOT LIKE '%recepcion_lineas%' OR v_pred NOT LIKE '%recepcion_lineas_anulada%'
     OR v_pred NOT LIKE '%origen_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'COMPRAS_INVENTARIO_INDICE: uq_mov_suministro_origen_recepcion no quedó instalado como único, válido y con la definición esperada (columnas %, predicado %). No se continúa sin la protección.',
      v_cols, v_pred;
  END IF;
END $$;
