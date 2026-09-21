-- ════════════════════════════════════════════════════════════════════════════
-- Convergencia de drift: puntos_control_ruta y visitas_control
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ ES ESTO. NO agrega funcionalidad. Escribe en el repositorio lo que
-- producción YA TIENE en estas dos tablas y que ninguna migración declaraba.
-- Sobre producción es un no-op verificado celda por celda; lo que cambia es la
-- reconstrucción, que hasta ahora describía otra cosa.
--
-- POR QUÉ AHORA
-- `20260424000059` creó las dos tablas, y después las 86 migraciones huérfanas
-- de marzo–junio 2026 (inventario en #826) las modificaron a mano sin dejar
-- archivo. Desde el 2026-09-01 eso vive declarado en `drift-conocido.json` como
-- seis grupos: columnas, constraints e índices de cada tabla.
--
-- Mientras ese drift siga declarado, CUALQUIER PR que agregue una columna a
-- estas tablas queda bloqueado. El auditor compara tres puntos —producción (P),
-- la rama base (M) y el PR (R)— y para estos grupos P ≠ M de antemano; al
-- tocarlas, R pasa a ser un tercer valor y el veredicto es `CAMBIO AMBIGUO`,
-- que falla en falso a propósito: con tres valores distintos no hay con qué
-- decidir si el PR arregla el drift o lo empeora.
--
-- No se puede desbloquear desde el PR que agrega la columna. Un grupo pasa sólo
-- si `M == R` (no tocar la tabla), `P == M` (arreglar la base — inalcanzable
-- desde un PR cuyo M es el merge-base) o `P == R` (imposible: producción no
-- tiene la columna nueva). De ahí que la convergencia vaya ANTES y sola.
--
-- Con esto mergeado, `P == M` para los seis grupos y los PRs siguientes que
-- toquen estas tablas salen `CAMBIO PLANIFICADO`, que es lo correcto.
--
-- LAS SEIS DIFERENCIAS, MEDIDAS CONTRA EL CATÁLOGO REAL
--
--   puntos_control_ruta
--     columnas    `created_at` es NOT NULL en producción y nullable en el repo
--     constraints la FK de `area_id` lleva ON DELETE CASCADE
--     índices     el índice (ruta_id, orden) se llama
--                 `puntos_control_ruta_ruta_id_orden_idx`, no `idx_puntos_ruta`
--
--   visitas_control
--     columnas    `created_at` es NOT NULL en producción y nullable en el repo
--     constraints la FK de `punto_id` lleva ON DELETE CASCADE, y existe un
--                 CHECK sobre `estado` que ninguna migración declara
--     índices     el índice (ronda_id) se llama `visitas_control_ronda_id_idx`,
--                 no `idx_visitas_ronda`
--
-- ⚠️ EL CHECK DE `estado` SE DECLARA TAL CUAL ESTÁ, Y ESTÁ MAL
-- Producción admite ('pendiente','visitado','con_novedad','omitido') y la
-- aplicación escribe 'ok' y 'novedad' (`EstadoVisitaControl`, `VISITA_CONFIG`,
-- `marcarVisita()`), desde `20260424000059`. Es decir: marcar un punto de una
-- ronda viola ese CHECK, y `public.visitas_control` tiene CERO filas en
-- producción, lo que es consistente con que el checklist nunca haya podido
-- cerrarse.
--
-- Aquí se declara el CHECK EQUIVOCADO a propósito. Esta migración documenta lo
-- que hay, no lo que debería haber: mezclar la convergencia con la corrección
-- volvería a producir tres valores distintos y el mismo `CAMBIO AMBIGUO` que
-- viene a cerrar. El vocabulario se corrige en la migración siguiente, que ya
-- sale `CAMBIO PLANIFICADO` porque este archivo dejó P == M.
--
-- NO-OP SOBRE PRODUCCIÓN, Y VERIFICADO ANTES DE ACTUAR
-- Cada bloque MIDE el catálogo y sólo escribe si hace falta. Ninguno hace
-- DROP/CREATE a ciegas: recrear una constraint que ya está bien toma un
-- ACCESS EXCLUSIVE y revalida la tabla entera para dejarla igual, y además
-- taparía una constraint homónima con OTRA definición — que es justo lo que
-- habría que ver.
--
-- NO TOCA LAS POLICIES. `tabla:*/policies` también difiere en ambas tablas,
-- pero toda diferencia de RLS es seguridad hasta que alguien demuestre lo
-- contrario: se clasifica y se resuelve en #826, no de pasada aquí. Esos dos
-- grupos siguen declarados en la baseline y el auditor los sigue tratando como
-- «objeto que el PR no toca».
--
-- IDEMPOTENTE: todo dentro de DO $$ con guardia por catálogo.
--
-- REVERSA: no tiene sentido revertirla —dejaría al repositorio describiendo un
-- esquema que producción no tiene—, pero si hiciera falta:
--   ALTER TABLE public.visitas_control DROP CONSTRAINT visitas_control_estado_check;
--   ALTER INDEX public.puntos_control_ruta_ruta_id_orden_idx RENAME TO idx_puntos_ruta;
--   ALTER INDEX public.visitas_control_ronda_id_idx RENAME TO idx_visitas_ronda;
--   (y volver las dos FK a NO ACTION y los created_at a nullable)
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. `created_at` NOT NULL en las dos tablas
-- ────────────────────────────────────────────────────────────────────────────
-- Ambas ya tienen DEFAULT now(), así que no hay fila que pueda traerlo NULL
-- salvo un INSERT que lo ponga explícitamente. En producción ya es NOT NULL.
DO $$
DECLARE
  v_tabla text;
  v_nulas bigint;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['puntos_control_ruta', 'visitas_control'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_tabla
        AND a.attname = 'created_at' AND NOT a.attnotnull
    ) THEN
      -- Fail-closed: si hubiera filas con NULL, el SET NOT NULL fallaría con un
      -- mensaje genérico. Se mide antes para que el error diga qué pasó.
      EXECUTE format('SELECT count(*) FROM public.%I WHERE created_at IS NULL', v_tabla)
        INTO v_nulas;
      IF v_nulas > 0 THEN
        RAISE EXCEPTION
          'CONVERGENCIA: %.created_at tiene % fila(s) en NULL; producción lo tiene NOT NULL. Rellenalas antes de aplicar esto.',
          v_tabla, v_nulas;
      END IF;
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_at SET NOT NULL', v_tabla);
      RAISE NOTICE 'CONVERGENCIA: %.created_at → NOT NULL', v_tabla;
    ELSE
      RAISE NOTICE 'CONVERGENCIA: %.created_at ya era NOT NULL', v_tabla;
    END IF;
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Las dos FK que en producción borran en cascada
-- ────────────────────────────────────────────────────────────────────────────
-- `puntos_control_ruta.area_id` → areas_condominio   ON DELETE CASCADE
-- `visitas_control.punto_id`    → puntos_control_ruta ON DELETE CASCADE
--
-- Sólo se recrea la que NO esté ya en cascada: en producción ambas lo están y
-- este bloque no escribe nada. Se compara con `confdeltype`, la celda del
-- catálogo ('c' = CASCADE), y no el texto de `pg_get_constraintdef`.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('puntos_control_ruta', 'puntos_control_ruta_area_id_fkey', 'area_id', 'areas_condominio'),
      ('visitas_control',     'visitas_control_punto_id_fkey',   'punto_id', 'puntos_control_ruta')
    ) AS t(tabla, conname, columna, referencia)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = r.tabla
        AND con.conname = r.conname AND con.contype = 'f'
    ) THEN
      RAISE EXCEPTION
        'CONVERGENCIA: no existe la FK %.% que esta migración esperaba encontrar.',
        r.tabla, r.conname;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = r.tabla
        AND con.conname = r.conname AND con.confdeltype = 'c'
    ) THEN
      RAISE NOTICE 'CONVERGENCIA: %.% ya borraba en cascada', r.tabla, r.conname;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tabla, r.conname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) ON DELETE CASCADE',
      r.tabla, r.conname, r.columna, r.referencia);
    RAISE NOTICE 'CONVERGENCIA: %.% → ON DELETE CASCADE', r.tabla, r.conname;
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. El CHECK de `estado` que sólo existía en producción
-- ────────────────────────────────────────────────────────────────────────────
-- Se declara EXACTAMENTE como está allá, vocabulario equivocado incluido (ver
-- la advertencia de la cabecera). La corrección va en la migración siguiente.
--
-- NOT VALID no: producción lo tiene validado y la tabla está vacía, así que la
-- validación no cuesta nada y una constraint NOT VALID hashearía distinto.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitas_control_estado_check') THEN
    RAISE NOTICE 'CONVERGENCIA: visitas_control_estado_check ya existía';
  ELSE
    ALTER TABLE public.visitas_control
      ADD CONSTRAINT visitas_control_estado_check
      CHECK (estado IN ('pendiente', 'visitado', 'con_novedad', 'omitido'));
    RAISE NOTICE 'CONVERGENCIA: visitas_control_estado_check declarado';
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Los dos índices que en producción tienen otro nombre
-- ────────────────────────────────────────────────────────────────────────────
-- Cubren las mismas columnas; lo único que difiere es cómo se llaman, y el
-- nombre es parte de la huella. Se RENOMBRA (no se recrea): un DROP + CREATE
-- sobre una tabla con datos deja una ventana sin índice, y un rename es
-- instantáneo y sólo toca el catálogo.
--
-- En producción el nombre viejo no existe y el nuevo sí, así que los dos
-- bloques caen en su rama de no-op.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('idx_puntos_ruta',   'puntos_control_ruta_ruta_id_orden_idx'),
      ('idx_visitas_ronda', 'visitas_control_ronda_id_idx')
    ) AS t(viejo, nuevo)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = r.nuevo) THEN
      RAISE NOTICE 'CONVERGENCIA: el índice % ya se llamaba así', r.nuevo;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = r.viejo) THEN
      RAISE EXCEPTION
        'CONVERGENCIA: no existe ni % ni %; el índice que esta migración renombra desapareció.',
        r.viejo, r.nuevo;
    END IF;
    EXECUTE format('ALTER INDEX public.%I RENAME TO %I', r.viejo, r.nuevo);
    RAISE NOTICE 'CONVERGENCIA: índice % → %', r.viejo, r.nuevo;
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Postcondición: o converge, o falla
-- ────────────────────────────────────────────────────────────────────────────
-- Una migración de convergencia que «casi» converge es peor que ninguna: deja
-- el auditor rojo y a quien la lea creyendo que el asunto está cerrado.
DO $$
DECLARE
  faltantes text[] := ARRAY[]::text[];
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('puntos_control_ruta', 'visitas_control')
      AND a.attname = 'created_at' AND NOT a.attnotnull
  ) THEN faltantes := faltantes || 'created_at sigue nullable'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    WHERE con.conname IN ('puntos_control_ruta_area_id_fkey', 'visitas_control_punto_id_fkey')
      AND con.confdeltype <> 'c'
  ) THEN faltantes := faltantes || 'alguna FK no borra en cascada'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitas_control_estado_check')
  THEN faltantes := faltantes || 'falta visitas_control_estado_check'; END IF;

  FOR i IN 1..1 LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                     AND indexname = 'puntos_control_ruta_ruta_id_orden_idx')
    THEN faltantes := faltantes || 'falta puntos_control_ruta_ruta_id_orden_idx'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                     AND indexname = 'visitas_control_ronda_id_idx')
    THEN faltantes := faltantes || 'falta visitas_control_ronda_id_idx'; END IF;
  END LOOP;

  IF array_length(faltantes, 1) > 0 THEN
    RAISE EXCEPTION 'CONVERGENCIA incompleta: %', array_to_string(faltantes, '; ');
  END IF;

  RAISE NOTICE 'CONVERGENCIA: las seis diferencias quedaron declaradas.';
END;
$$;
