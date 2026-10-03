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
--   Esta migración EXIGE que el índice exista, sea único, esté válido y listo, y tenga EXACTAMENTE la
--   definición esperada (comparada contra un índice de referencia, no por fragmentos de texto): (origen_tabla, origen_id) WHERE origen_tabla IN ('recepcion_lineas',
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
  v_pred   text;
  v_ok     boolean;
  v_found  boolean;
  v_def    jsonb;
  v_ref    jsonb;
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

  -- 3. Verificación final: válido, listo y con la definición EXACTA. No se busca texto en el predicado
  --    (un `AND cantidad > 0` también contiene los fragmentos esperados y dejaría sin proteger los
  --    movimientos con cantidad <= 0). Se construye un índice de referencia con la definición esperada,
  --    dentro de esta misma transacción y bajo el mismo bloqueo, y se comparan los catálogos campo a
  --    campo (columnas, clases de operador, colaciones, opciones, método de acceso, unicidad, NULLS
  --    NOT DISTINCT, expresiones y el predicado desparseado por el propio servidor, que no arrastra
  --    posiciones de texto como sí hace el árbol almacenado). El de referencia se elimina al terminar.
  CREATE UNIQUE INDEX uq_mov_suministro_origen_recepcion_ref
    ON public.movimientos_suministro (origen_tabla, origen_id)
    WHERE origen_tabla IN ('recepcion_lineas', 'recepcion_lineas_anulada') AND origen_id IS NOT NULL;

  SELECT jsonb_build_object(
           'am', c.relam, 'tabla', i.indrelid, 'unico', i.indisunique,
           'natts', i.indnatts, 'nkey', i.indnkeyatts,
           'cols', i.indkey::text, 'clases', i.indclass::text, 'colaciones', i.indcollation::text,
           'opciones', i.indoption::text, 'nulls_no_distintos', to_jsonb(i) -> 'indnullsnotdistinct',
           'expresiones', pg_get_expr(i.indexprs, i.indrelid), 'predicado', pg_get_expr(i.indpred, i.indrelid)),
         i.indisvalid AND i.indisready,
         pg_get_expr(i.indpred, i.indrelid)
    INTO v_def, v_ok, v_pred
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'uq_mov_suministro_origen_recepcion';
  v_found := FOUND;

  SELECT jsonb_build_object(
           'am', c.relam, 'tabla', i.indrelid, 'unico', i.indisunique,
           'natts', i.indnatts, 'nkey', i.indnkeyatts,
           'cols', i.indkey::text, 'clases', i.indclass::text, 'colaciones', i.indcollation::text,
           'opciones', i.indoption::text, 'nulls_no_distintos', to_jsonb(i) -> 'indnullsnotdistinct',
           'expresiones', pg_get_expr(i.indexprs, i.indrelid), 'predicado', pg_get_expr(i.indpred, i.indrelid))
    INTO v_ref
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'uq_mov_suministro_origen_recepcion_ref';

  DROP INDEX public.uq_mov_suministro_origen_recepcion_ref;

  IF NOT v_found OR NOT COALESCE(v_ok, false) OR v_def IS DISTINCT FROM v_ref THEN
    RAISE EXCEPTION 'COMPRAS_INVENTARIO_INDICE: uq_mov_suministro_origen_recepcion no está instalado como único, válido y con la definición exacta esperada (predicado actual: %). Debe proteger todo movimiento de recepcion_lineas / recepcion_lineas_anulada con origen_id. No se continúa sin la protección.',
      COALESCE(v_pred, '(sin predicado)');
  END IF;
END $$;
