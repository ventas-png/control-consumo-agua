-- ════════════════════════════════════════════════════════════════════════════
-- `bloques_turno`: el repositorio describe otra tabla que producción
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ CIERRA. La entrada `tabla:bloques_turno/columnas` de la baseline del
-- auditor de drift, declarada el 2026-09-01 y con este origen (#826): la tabla
-- la creó una de las 86 migraciones huérfanas de marzo–junio 2026, aplicadas a
-- mano y nunca escritas como archivo, y el `CREATE TABLE IF NOT EXISTS` del
-- repositorio no tocó la tabla que ya existía. Desde entonces las dos
-- descripciones divergen sin que nada lo note.
--
-- QUÉ DIFIERE, EXACTAMENTE. Se leyó el catálogo de producción el 2026-09-10 y
-- se comparó campo a campo —nombre, tipo, NOT NULL, default, identidad,
-- generación y collation— contra la reconstrucción de las 459 migraciones del
-- repositorio. Las 20 columnas están en las dos, con el mismo tipo. Difieren
-- DOS atributos, y ninguno más:
--
--   columna       producción              repositorio
--   ─────────────────────────────────────────────────────────────────
--   turno         SIN default             DEFAULT 'manana'::text
--   created_at    NOT NULL                acepta NULL
--
-- (El ORDEN de las columnas también difiere, pero no cuenta: la huella
-- serializa `ORDER BY attname COLLATE "C"`, así que compara el conjunto y no la
-- posición. Tampoco se compara la collation. Se verificó en fingerprint.sql
-- antes de dar el diagnóstico por bueno, porque un orden distinto NO se puede
-- arreglar con una migración forward-only: haría falta reescribir la tabla.)
--
-- HACIA DÓNDE SE RECONCILIA, Y POR QUÉ. Las dos alineaciones van del lado del
-- REPOSITORIO hacia el de producción, no al revés. Es una decisión, y estas son
-- sus razones:
--
--   · Consecuencia práctica: ejecutada contra producción, esta migración es un
--     NO-OP. `DROP DEFAULT` sobre una columna que no tiene default no hace
--     nada, y `SET NOT NULL` sobre una columna que ya lo es sale por la puerta
--     de atrás del catálogo sin escanear la tabla. Cero filas tocadas, cero
--     backfill, cero riesgo de bloqueo largo sobre la tabla que más crece.
--     El drift se cierra sin desplegar nada, que es exactamente lo que hace
--     falta cuando desplegar requiere una autorización que todavía no está.
--
--   · `created_at NOT NULL`: producción tiene razón. Una marca de creación que
--     puede faltar no sirve para ordenar ni para auditar, y el `DEFAULT now()`
--     está en los dos lados, así que nadie escribe NULL a propósito. Acá el
--     repositorio se APRIETA.
--
--   · `turno` sin default: producción también tiene razón, y no por costumbre.
--     `turno` es NOT NULL, así que la pregunta es qué pasa cuando alguien
--     olvida ponerlo. Con `DEFAULT 'manana'`, un bloque de turno NOCTURNO se
--     guarda callado como de mañana: dato equivocado, sin error, y descubierto
--     semanas después al leer un reporte. Sin default, ese INSERT falla en el
--     acto. Se comprobó que nada depende de él: el único INSERT del repositorio
--     —`generar_bloques_turno`, 20260820000200— nombra `turno` explícitamente,
--     y producción lleva meses corriendo sin el default. Si algún día se quiere
--     un valor por omisión, que se decida a propósito y no por herencia de un
--     `CREATE TABLE` de abril.
--
-- POR QUÉ VA EN SU PROPIO PR, Y ANTES QUE #844. El auditor compara TRES vías:
-- producción (P), la rama base (M) y el PR (R). Mientras P ≠ M, cualquier PR
-- que además toque estas columnas deja las tres distintas —P ≠ M ≠ R— y eso es
-- `CAMBIO AMBIGUO`: no se puede decidir si el PR arregla o empeora, y el auditor
-- falla cerrado. Es justo lo que le pasa a #844, que agrega la columna
-- `politica`. Metiendo esta reconciliación DENTRO de #844 la ambigüedad no se
-- iría, porque M seguiría sin la corrección. Sólo se cierra si M pasa a valer lo
-- que vale P, y para eso esto tiene que estar en main primero.
--
-- LA BASELINE ENCOGE, Y ES OBLIGATORIO. Este PR quita la entrada
-- `tabla:bloques_turno/columnas` de `drift-conocido.json`. No es aflojar el
-- auditor: es lo contrario. El auditor ROMPE si una entrada declarada deja de
-- corresponder a un drift real («resuelto» en su veredicto), justamente para
-- forzar la poda en el mismo PR que lo arregla. Las otras dos entradas de esta
-- tabla —`/constraints` y `/indices`— siguen declaradas y sin tocar: esta
-- migración no las cambia.
--
-- REVERSIÓN
--   ALTER TABLE public.bloques_turno ALTER COLUMN turno SET DEFAULT 'manana'::text;
--   ALTER TABLE public.bloques_turno ALTER COLUMN created_at DROP NOT NULL;
--   (y reponer la entrada de la baseline desde el histórico de git)
--
-- IDEMPOTENTE: las dos sentencias son declarativas —fijan un estado, no lo
-- incrementan— así que repetirlas no hace nada.
-- ════════════════════════════════════════════════════════════════════════════

-- Guard: `SET NOT NULL` falla si hay filas con NULL, y su mensaje no dice
-- cuántas. En producción no puede haberlas —la columna ya es NOT NULL— y en un
-- entorno reconstruido la tabla está vacía; pero si alguna vez esta migración
-- corre sobre una copia con datos viejos, mejor un error que diga el número.
DO $$
DECLARE v_nulos bigint;
BEGIN
  SELECT count(*) INTO v_nulos FROM public.bloques_turno WHERE created_at IS NULL;
  IF v_nulos > 0 THEN
    RAISE EXCEPTION
      'ABORTADO: % bloque(s) de turno sin created_at. Rellenarlos antes de exigir NOT NULL: '
      'UPDATE public.bloques_turno SET created_at = now() WHERE created_at IS NULL;', v_nulos;
  END IF;
END $$;

ALTER TABLE public.bloques_turno ALTER COLUMN turno      DROP DEFAULT;
ALTER TABLE public.bloques_turno ALTER COLUMN created_at SET NOT NULL;

COMMENT ON COLUMN public.bloques_turno.turno IS
  'Franja del bloque (manana/tarde/noche). SIN valor por omisión a propósito: es NOT NULL, y un default haría que un bloque nocturno mal enviado se guardara callado como de mañana. Quien inserta lo dice.';
COMMENT ON COLUMN public.bloques_turno.created_at IS
  'Cuándo se creó el bloque. NOT NULL con DEFAULT now(): una marca de creación que puede faltar no sirve ni para ordenar ni para auditar.';

-- ════════════════════════════════════════════════════════════════════════════
-- SEGUNDA PARTE · los CONSTRAINTS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Misma tabla, mismo origen, otra entrada de la baseline:
-- `tabla:bloques_turno/constraints`. Se leyó `pg_get_constraintdef` de los dos
-- lados. Los dos tienen NUEVE constraints, pero no los mismos:
--
--   nombre                              producción            repositorio
--   ───────────────────────────────────────────────────────────────────────
--   bloques_turno_company_id_fkey       AUSENTE               FK → companies(id)
--   bloques_turno_estado_check          CHECK del dominio     AUSENTE
--   bloques_turno_personal_id_fkey      ON DELETE CASCADE     sin acción
--   bloques_turno_project_id_fkey       ON DELETE CASCADE     sin acción
--   (los otros cinco coinciden exactamente)
--
-- LAS CUATRO SE RECONCILIAN HACIA PRODUCCIÓN, y las cuatro son NO-OP allá. Tres
-- de ellas porque producción ya tiene la forma correcta y sólo hay que traerla
-- al repositorio:
--
--   · `estado_check` VALIDA el dominio de `estado` (pendiente / en_curso /
--     completado / cancelado). El repositorio no lo tenía: cualquier entorno
--     reconstruido aceptaba un estado inventado que producción rechaza.
--   · `personal_id` y `project_id` con ON DELETE CASCADE. Sin la acción, borrar
--     un condominio o dar de baja a una persona fallaba con un error de FK en
--     vez de llevarse sus bloques. Producción hace lo segundo desde siempre.
--
-- Y LA CUARTA ES UNA DECISIÓN, QUE CONVIENE LEER DESPACIO. La FK de `company_id`
-- existe SÓLO en el repositorio. Producción nunca la tuvo. Hay dos formas de
-- cerrar esa diferencia y hacen cosas muy distintas:
--
--   (a) agregarla a producción — mejora la integridad de verdad, y es barata:
--       son 24 filas, 144 kB y CERO huérfanos, medido el 2026-09-10. Pero es
--       una ESCRITURA en producción, necesita autorización, y hasta que se
--       despliegue y se refresque la huella deja las tres vías distintas: este
--       PR se pondría ambiguo, y con él #844.
--   (b) quitarla del repositorio — no cambia nada en producción, porque allá
--       nunca estuvo, y hace que el repositorio DEJE DE AFIRMAR una garantía
--       que el sistema vivo no da. Es lo que este auditor existe para lograr.
--
-- Se elige (b), y no por comodidad: (a) no aumenta la seguridad de producción
-- ni un día antes de desplegarse, y mientras tanto bloquea todo lo demás. Con
-- (b) el repositorio dice la verdad hoy, y agregar la FK A LOS DOS LADOS pasa a
-- ser un cambio deliberado y trivial —24 filas, sin huérfanos— que el auditor
-- clasificará como CAMBIO PLANIFICADO y dejará pasar limpio. Queda anotado como
-- lo que es: un seguimiento pendiente, no un problema resuelto.
--
-- Lo que NO se pierde por quitarla: `project_id` sigue con su FK, y un proyecto
-- pertenece a una empresa; la RLS de `bloques_turno` exige
-- `company_id = get_my_company_id()`; y la FK compuesta que agrega #844 ancla la
-- terna entera cuando el bloque tiene jornada.

DO $$
DECLARE v_def text;
BEGIN
  -- (1) El CHECK del dominio de `estado`, que producción sí valida.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'bloques_turno_estado_check'
                    AND conrelid = 'public.bloques_turno'::regclass) THEN
    ALTER TABLE public.bloques_turno
      ADD CONSTRAINT bloques_turno_estado_check
      CHECK (estado = ANY (ARRAY['pendiente'::text, 'en_curso'::text,
                                 'completado'::text, 'cancelado'::text]));
  END IF;

  -- (2) La FK de company_id, que sólo existe en el repositorio. Ver arriba.
  ALTER TABLE public.bloques_turno DROP CONSTRAINT IF EXISTS bloques_turno_company_id_fkey;

  -- (3) y (4) Las dos FK que en producción sí borran en cascada. Se comparan
  -- por definición y no por presencia: existen en los dos lados, y lo que
  -- difiere es la acción. Donde ya coincide —producción— esto no hace nada.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conname = 'bloques_turno_personal_id_fkey'
     AND conrelid = 'public.bloques_turno'::regclass;
  IF v_def IS DISTINCT FROM 'FOREIGN KEY (personal_id) REFERENCES personal_condominio(id) ON DELETE CASCADE' THEN
    ALTER TABLE public.bloques_turno DROP CONSTRAINT IF EXISTS bloques_turno_personal_id_fkey;
    ALTER TABLE public.bloques_turno
      ADD CONSTRAINT bloques_turno_personal_id_fkey
      FOREIGN KEY (personal_id) REFERENCES public.personal_condominio(id) ON DELETE CASCADE;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conname = 'bloques_turno_project_id_fkey'
     AND conrelid = 'public.bloques_turno'::regclass;
  IF v_def IS DISTINCT FROM 'FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE' THEN
    ALTER TABLE public.bloques_turno DROP CONSTRAINT IF EXISTS bloques_turno_project_id_fkey;
    ALTER TABLE public.bloques_turno
      ADD CONSTRAINT bloques_turno_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
END $$;
