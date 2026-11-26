-- ════════════════════════════════════════════════════════════════════════════
-- Convergencia de drift: las columnas de tareas_bloque
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ ES ESTO. NO agrega funcionalidad. Escribe en el repositorio lo que
-- producción YA TIENE en las columnas de `tareas_bloque`, que desde el
-- 2026-09-01 vive declarado como drift (`tabla:tareas_bloque/columnas` en
-- scripts/schema-drift/drift-conocido.json, inventario #826). Sobre producción
-- es un no-op verificado columna por columna; lo que cambia es la
-- reconstrucción, que hasta ahora describía otra tabla.
--
-- POR QUÉ AHORA. Los pasos opcionales de las rutinas de limpieza necesitan una
-- columna nueva, `tareas_bloque.obligatoria`, copiada del paso al asignar la
-- rutina. Con el drift declarado, P ≠ M de antemano y el auditor de tres vías
-- cierra ese PR como CAMBIO AMBIGUO. Mismo argumento que 20261101000000 (los
-- índices de esta misma tabla, antes de #951) y 20260913040200 (las columnas
-- de bloques_turno, antes de #844): no se puede desbloquear desde el PR que
-- trae el cambio, así que la convergencia va ANTES y sola. Con esto en main,
-- P == M para el grupo y la columna nueva sale CAMBIO PLANIFICADO.
--
-- LAS CUATRO DIFERENCIAS, MEDIDAS CONTRA EL CATÁLOGO REAL
-- `pg_attribute` de producción, 2026-11-26, sólo SELECT. Las 30 columnas del
-- repositorio están allá con el mismo tipo; difieren cuatro cosas y ninguna
-- más:
--
--   columna     producción                    repositorio
--   ─────────────────────────────────────────────────────────────────────────
--   foto_url    text, acepta NULL             no existe
--   icono       text DEFAULT '📋', acepta NULL no existe
--   created_at  NOT NULL DEFAULT now()        acepta NULL, DEFAULT now()
--   orden       acepta NULL, DEFAULT 0        NOT NULL DEFAULT 0
--
-- Con las cuatro aplicadas sobre la cadena del repositorio, el grupo da
-- EXACTAMENTE la huella que scripts/schema-drift/huella-produccion.json
-- registra para producción (8e820305…afd9c8eb, 32 columnas), y ningún otro
-- grupo del catálogo se mueve. Lo prueba supabase/tests/tareas_bloque_columnas.
--
-- (El ORDEN físico de las columnas también difiere y no cuenta: la huella
-- serializa `ORDER BY attname COLLATE "C"`. Tampoco se miran comentarios.)
--
-- HACIA DÓNDE, Y POR QUÉ. Todo va del repositorio hacia producción. Para que el
-- grupo quede RESUELTO la reconstrucción tiene que ser idéntica a producción:
-- cualquier diferencia que quede deja P ≠ M y el PR siguiente sigue ambiguo.
--
--   · `foto_url` e `icono`: legado de la tabla que creó una migración huérfana
--     de marzo–junio 2026. Ninguna pantalla las escribe —la evidencia va en
--     `foto_urls` (jsonb) desde 20260906000000— pero existen allá y
--     database.types.ts (generado desde producción) ya las lista. Se declaran
--     igual que allá; retirarlas sería otra decisión, con su propio PR.
--   · `created_at NOT NULL`: producción tiene razón. Una marca de creación que
--     puede faltar no sirve para ordenar ni para auditar; el default está a
--     ambos lados. El repositorio se APRIETA.
--   · `orden` sin NOT NULL: aquí el repositorio era el más estricto, y se
--     AFLOJA a sabiendas. Apretar producción no sería un no-op (escanea la tabla
--     y falla si hay alguna fila con NULL) y dejaría las tres huellas distintas,
--     que es justo el bloqueo que esto viene a quitar. El default 0 sigue en los
--     dos lados, ningún INSERT del repositorio manda NULL y database.types.ts ya
--     tipa `orden: number | null`. Volver a exigirlo es un cambio planificado
--     aparte, con su auditoría de filas en producción.
--
-- NO-OP SOBRE PRODUCCIÓN, Y VERIFICADO ANTES DE ACTUAR. Cada bloque mide el
-- catálogo y sólo escribe si hace falta, y lo dice con un NOTICE
-- «CONVERGENCIA: …». Un tipo distinto del esperado aborta toda la migración en
-- vez de adivinar (ERRCODE 55000).
--
-- NO TOCA `tabla:tareas_bloque/constraints`, que sigue declarado: es otro
-- grupo y el PR siguiente no lo necesita.
--
-- IDEMPOTENTE: todo dentro de DO $$ con guardia por catálogo.
--
-- REVERSA: no tiene sentido revertirla —dejaría al repositorio describiendo un
-- esquema que producción no tiene—, pero si hiciera falta (sólo en una base
-- reconstruida; en producción borraría columnas que ya estaban):
--   ALTER TABLE public.tareas_bloque ALTER COLUMN orden SET NOT NULL;
--   ALTER TABLE public.tareas_bloque ALTER COLUMN created_at DROP NOT NULL;
--   ALTER TABLE public.tareas_bloque DROP COLUMN icono, DROP COLUMN foto_url;
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tipo text;
  v_def  text;
BEGIN
  -- ── 1. foto_url text (legado; la evidencia vive en foto_urls) ─────────────
  SELECT format_type(a.atttypid, a.atttypmod), pg_get_expr(d.adbin, d.adrelid)
    INTO v_tipo, v_def
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.tareas_bloque'::regclass
    AND a.attname = 'foto_url' AND a.attnum > 0 AND NOT a.attisdropped;

  IF NOT FOUND THEN
    ALTER TABLE public.tareas_bloque ADD COLUMN foto_url text;
    RAISE NOTICE 'CONVERGENCIA: agregada foto_url text';
  ELSIF v_tipo <> 'text' OR v_def IS NOT NULL THEN
    RAISE EXCEPTION 'tareas_bloque.foto_url existe con otra forma (% default %): no se adivina', v_tipo, v_def
      USING ERRCODE = '55000';
  ELSE
    RAISE NOTICE 'CONVERGENCIA: foto_url ya estaba';
  END IF;

  -- ── 2. icono text DEFAULT '📋' ────────────────────────────────────────────
  SELECT format_type(a.atttypid, a.atttypmod), pg_get_expr(d.adbin, d.adrelid)
    INTO v_tipo, v_def
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.tareas_bloque'::regclass
    AND a.attname = 'icono' AND a.attnum > 0 AND NOT a.attisdropped;

  IF NOT FOUND THEN
    ALTER TABLE public.tareas_bloque ADD COLUMN icono text DEFAULT '📋'::text;
    RAISE NOTICE 'CONVERGENCIA: agregada icono text DEFAULT 📋';
  ELSIF v_tipo <> 'text' THEN
    RAISE EXCEPTION 'tareas_bloque.icono existe con otro tipo (%): no se adivina', v_tipo
      USING ERRCODE = '55000';
  ELSIF v_def IS DISTINCT FROM '''📋''::text' THEN
    ALTER TABLE public.tareas_bloque ALTER COLUMN icono SET DEFAULT '📋'::text;
    RAISE NOTICE 'CONVERGENCIA: icono con el default de producción';
  ELSE
    RAISE NOTICE 'CONVERGENCIA: icono ya estaba';
  END IF;

  -- ── 3. created_at NOT NULL ────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid = 'public.tareas_bloque'::regclass
               AND attname = 'created_at' AND NOT attnotnull) THEN
    -- En producción este bloque no corre: la columna ya es NOT NULL. En una base
    -- reconstruida, una fila con created_at NULL hace fallar el SET NOT NULL con
    -- su error de siempre (23502), y está bien: no se inventa una fecha de
    -- creación, ni se le pasa un UPDATE a una tabla con triggers de sellado.
    ALTER TABLE public.tareas_bloque ALTER COLUMN created_at SET NOT NULL;
    RAISE NOTICE 'CONVERGENCIA: created_at pasa a NOT NULL';
  ELSE
    RAISE NOTICE 'CONVERGENCIA: created_at ya era NOT NULL';
  END IF;

  -- ── 4. orden sin NOT NULL ─────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid = 'public.tareas_bloque'::regclass
               AND attname = 'orden' AND attnotnull) THEN
    ALTER TABLE public.tareas_bloque ALTER COLUMN orden DROP NOT NULL;
    RAISE NOTICE 'CONVERGENCIA: orden deja de ser NOT NULL (como en producción)';
  ELSE
    RAISE NOTICE 'CONVERGENCIA: orden ya aceptaba NULL';
  END IF;
END;
$$;
