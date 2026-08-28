-- ════════════════════════════════════════════════════════════════════════════
-- Reparar tareas_bloque_estado_check: el guard por NOMBRE no mira la DEFINICIÓN
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL AGUJERO. 20260907000100 (#803) protege el alta del CHECK de estado así:
--
--   IF NOT EXISTS (SELECT 1 FROM pg_constraint
--                  WHERE conname = 'tareas_bloque_estado_check') THEN ...
--
-- Un guard por conname da el constraint por bueno con solo ver el nombre. Pero
-- `tareas_bloque` existe en producción desde antes de las migraciones (la
-- serie 20260906* ya reparó sus columnas por lo mismo: la tabla real se creó
-- «por otra vía» y quedó con otra forma). Un entorno donde a esa tabla se le
-- haya colgado a mano un CHECK homónimo con el vocabulario VIEJO del módulo —
-- el de los bloques y del comentario de 20260424000060:25, en masculino:
--
--   CHECK (estado IN ('pendiente', 'en_curso', 'completado', 'omitido'))
--
-- pasa el guard sin instalar el canónico, y queda RECHAZANDO los tres cierres
-- que la UI escribe ('completada', 'con_observacion', 'omitida'): completar
-- una tarea revienta con 23514. Ninguna guarda lo ve: migraciones-vs-produccion
-- compara tablas y columnas, no definiciones de constraints (eso lo cierra el
-- mismo PR que trae esta migración), y en un esquema construido desde
-- supabase/migrations el conname coincide con la definición correcta.
--
-- Y EL DEFECTO DEL CAMINO FELIZ: aun donde el ADD sí corrió, 20260907000100 lo
-- dejó NOT VALID y ninguna migración lo valida después, así que el histórico
-- podía conservar valores fuera del dominio para siempre. Aquí se convierte lo
-- convertible, se aborta ante lo que no tiene decisión, y se VALIDA.
--
-- QUÉ HACE, EN ORDEN (una sola transacción):
--   1. Lee con pg_get_constraintdef la definición REAL del constraint que
--      lleve ese nombre. Si no es la canónica, lo dropea. La definición
--      canónica esperada se calcula EN ESTE MISMO SERVIDOR con un constraint
--      de andamiaje, no con un literal pegado: la forma exacta que imprime
--      pg_get_constraintdef es del servidor, y compararla contra un string
--      escrito a mano acoplaría la migración a una versión de Postgres.
--   2. Convierte los DOS valores legacy con equivalencia definida, explícitos:
--      'completado' → 'completada' y 'omitido' → 'omitida'. Después del drop y
--      antes del ADD: con el CHECK viejo puesto, el UPDATE a 'completada'
--      violaría justamente el constraint que se viene a quitar.
--      OJO CON trg_exigir_evidencia (20260907000400, ya vivo cuando esto
--      corre): gatea exactamente esta transición y su cabecera dice a
--      propósito que un script de migración de datos pasa por él igual. No se
--      desactiva — el bypass silencioso es lo que ese trigger existe para
--      evitar. Se usa su salida DOCUMENTADA: motivo_sin_evidencia, estampado
--      en el MISMO UPDATE y sólo en las filas a las que les falta la evidencia
--      que ellas mismas exigen (espejo de las tres condiciones del trigger).
--      Son cierres del régimen legacy, anteriores a la política de evidencia:
--      la fila queda diciendo por qué se le permitió el paso. Las que sí
--      traen su evidencia pasan limpias, sin motivo espurio.
--   3. Si queda CUALQUIER otro valor fuera del dominio — 'en_curso' incluido —
--      ABORTA con el inventario de lo encontrado. No hay equivalencia muda:
--      'en_curso' es un estado del BLOQUE de turno, no de la tarea de
--      checklist (TareasPersonalTab pinta las tareas con los cuatro cánones y
--      los bloques con en_curso/completado/incompleto), y mapearlo a
--      'pendiente' o a 'completada' es una decisión de producto que nadie
--      documentó. El aborto revierte la transacción entera: el constraint
--      dropeado en (1) vuelve solo.
--   4. Instala el CHECK canónico si no quedó uno canónico del paso (1).
--   5. VALIDATE CONSTRAINT — siempre. Tras (2)+(3) no puede fallar, y deja
--      convalidated = true también donde el constraint ya era canónico pero
--      NOT VALID. Sobre un constraint ya válido es un no-op.
--   6. Eco de sólo lectura: NOTICE con la definición final y convalidated.
--      Visible vía psql (sandbox, apply manual); la Management API del apply
--      automático descarta los NOTICE, así que el estado terminal en
--      PRODUCCIÓN se confirma con postdeploy.sql y lo vigila el drift guard.
--
-- IDEMPOTENTE: re-aplicada sobre el estado final, (1) no dropea (la definición
-- coincide), (2) y (3) no encuentran filas, (4) no agrega y (5) es no-op.
--
-- VERIFICACIÓN CONDUCTUAL: supabase/tests/reparar_estado_tareas_bloque/run.sh
-- monta el constraint homónimo viejo con datos legacy, el escenario con
-- 'en_curso' (aborta sin tocar nada) y el esquema declarado (solo valida).
-- POSTDEPLOY: supabase/tests/reparar_estado_tareas_bloque/postdeploy.sql es la
-- consulta de sólo lectura para confirmar convalidated y definición en prod.
--
-- REVERSA: recrear el CHECK anterior del entorno (si lo había) tras dropear el
-- canónico; las filas convertidas no guardan marca — la conversión es de ida.

DO $REPARAR$
DECLARE
  v_def_esperada text;
  v_def_actual   text;
  v_contype      "char";
  v_convalidated boolean;
  v_fuera        text;
  n_completado   bigint := 0;
  n_omitido      bigint := 0;
  n_sin_evidencia bigint := 0;
  n_fuera        bigint := 0;
BEGIN
  -- ── 1a. La definición canónica, tal como la imprime ESTE servidor ─────────
  ALTER TABLE public.tareas_bloque
    DROP CONSTRAINT IF EXISTS tareas_bloque_estado_check_esperada;
  ALTER TABLE public.tareas_bloque
    ADD CONSTRAINT tareas_bloque_estado_check_esperada
    CHECK (estado IN ('pendiente', 'completada', 'con_observacion', 'omitida'))
    NOT VALID;
  SELECT regexp_replace(pg_get_constraintdef(oid), '\s+NOT VALID$', '')
    INTO v_def_esperada
    FROM pg_constraint
   WHERE conrelid = 'public.tareas_bloque'::regclass
     AND conname  = 'tareas_bloque_estado_check_esperada';
  ALTER TABLE public.tareas_bloque
    DROP CONSTRAINT tareas_bloque_estado_check_esperada;
  IF v_def_esperada IS NULL THEN
    RAISE EXCEPTION 'reparar_estado_tareas_bloque: no se pudo calcular la definición canónica esperada';
  END IF;

  -- ── 1b. La definición REAL del homónimo, no su nombre ─────────────────────
  SELECT contype, regexp_replace(pg_get_constraintdef(oid), '\s+NOT VALID$', '')
    INTO v_contype, v_def_actual
    FROM pg_constraint
   WHERE conrelid = 'public.tareas_bloque'::regclass
     AND conname  = 'tareas_bloque_estado_check';

  -- Un homónimo que NI SIQUIERA es un CHECK (UNIQUE/FK colgado a mano con ese
  -- nombre) no se dropea a ciegas ni se deja reventar el ADD del paso 4 con un
  -- 42710 crudo: se aborta diciendo qué se encontró.
  IF v_contype IS NOT NULL AND v_contype <> 'c' THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'reparar_estado_tareas_bloque: existe un constraint llamado tareas_bloque_estado_check que NO es un CHECK (contype=%s): %s',
        v_contype, v_def_actual),
      HINT = 'Nada se modificó. Revisar qué es y quién lo creó antes de decidir; esta migración solo sabe reemplazar un CHECK.';
  END IF;

  IF v_def_actual IS NOT NULL AND v_def_actual IS DISTINCT FROM v_def_esperada THEN
    RAISE NOTICE 'reparar_estado_tareas_bloque: se retira el homónimo incompatible: %', v_def_actual;
    ALTER TABLE public.tareas_bloque DROP CONSTRAINT tareas_bloque_estado_check;
    v_def_actual := NULL;
  END IF;

  -- ── 2. Conversión EXPLÍCITA de los dos legacy con equivalencia definida ───
  -- La transición a 'completada' pasa por trg_exigir_evidencia (20260907000400)
  -- también desde aquí — su cabecera lo dice a propósito. No se desactiva: se
  -- usa su excepción DOCUMENTADA. motivo_sin_evidencia se estampa en el mismo
  -- UPDATE, SOLO donde falta la evidencia que la propia fila exige (espejo de
  -- las tres condiciones del trigger: foto, comentario, checklist completo).
  -- Son cierres del régimen legacy, anteriores a esa política; la fila queda
  -- diciendo por qué se le permitió el paso. Las que traen su evidencia — o no
  -- exigen ninguna — pasan limpias, sin motivo espurio.
  UPDATE public.tareas_bloque
     SET estado = 'completada',
         motivo_sin_evidencia = CASE
           WHEN COALESCE(btrim(motivo_sin_evidencia), '') <> '' THEN motivo_sin_evidencia
           WHEN (requiere_foto
                 AND jsonb_array_length(COALESCE(foto_urls, '[]'::jsonb)) = 0)
             OR (requiere_comentario
                 AND COALESCE(btrim(evidencia_texto), '') = '')
             OR (requiere_checklist
                 AND jsonb_array_length(COALESCE(checklist, '[]'::jsonb)) > 0
                 AND EXISTS (
                   SELECT 1
                   FROM generate_series(0, jsonb_array_length(COALESCE(checklist, '[]'::jsonb)) - 1) AS i
                   WHERE NOT (COALESCE(checklist_completado, '[]'::jsonb) @> to_jsonb(i))))
             THEN 'Cierre legacy (estado ''completado'', anterior a la política de evidencia de 20260907000400); convertido a ''completada'' por 20260907000700 sin re-exigir la evidencia.'
           ELSE motivo_sin_evidencia
         END
   WHERE estado = 'completado';
  GET DIAGNOSTICS n_completado = ROW_COUNT;
  SELECT count(*) INTO n_sin_evidencia FROM public.tareas_bloque
   WHERE motivo_sin_evidencia LIKE 'Cierre legacy (estado ''completado''%';
  UPDATE public.tareas_bloque SET estado = 'omitida' WHERE estado = 'omitido';
  GET DIAGNOSTICS n_omitido = ROW_COUNT;
  IF n_completado + n_omitido > 0 THEN
    RAISE NOTICE 'reparar_estado_tareas_bloque: convertidas % fila(s) completado→completada (% con motivo_sin_evidencia estampado) y % omitido→omitida',
      n_completado, n_sin_evidencia, n_omitido;
  END IF;

  -- ── 3. Lo que no tiene equivalencia documentada NO se adivina: se aborta ──
  SELECT count(*), string_agg(DISTINCT estado, ', ' ORDER BY estado)
    INTO n_fuera, v_fuera
    FROM public.tareas_bloque
   WHERE estado NOT IN ('pendiente', 'completada', 'con_observacion', 'omitida');
  IF n_fuera > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'reparar_estado_tareas_bloque: %s fila(s) de tareas_bloque con estado fuera del dominio canónico: %s',
        n_fuera, v_fuera),
      DETAIL = 'Solo completado→completada y omitido→omitida tienen conversión definida. '
               'Para en_curso (o cualquier otro valor) no hay decisión de producto documentada: '
               'en_curso es un estado del BLOQUE de turno, no de la tarea de checklist.',
      HINT = 'Nada se modificó (la transacción se revierte entera, el constraint dropeado vuelve). '
             'Documentar la equivalencia elegida y traerla en una migración NUEVA junto a esta conversión.';
  END IF;

  -- ── 4. El canónico, si el paso 1 no dejó uno ──────────────────────────────
  IF v_def_actual IS NULL THEN
    ALTER TABLE public.tareas_bloque
      ADD CONSTRAINT tareas_bloque_estado_check
      CHECK (estado IN ('pendiente', 'completada', 'con_observacion', 'omitida'))
      NOT VALID;
  END IF;

  -- ── 5. Validar SIEMPRE: el histórico queda dentro del dominio ─────────────
  ALTER TABLE public.tareas_bloque VALIDATE CONSTRAINT tareas_bloque_estado_check;

  -- ── 6. Eco de sólo lectura del estado terminal ────────────────────────────
  SELECT pg_get_constraintdef(oid), convalidated
    INTO v_def_actual, v_convalidated
    FROM pg_constraint
   WHERE conrelid = 'public.tareas_bloque'::regclass
     AND conname  = 'tareas_bloque_estado_check';
  RAISE NOTICE 'reparar_estado_tareas_bloque: tareas_bloque_estado_check → % · convalidated=%',
    v_def_actual, v_convalidated;
END;
$REPARAR$;
