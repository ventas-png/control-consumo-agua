-- ════════════════════════════════════════════════════════════════════════════
-- `bloques_turno`: el repositorio describe otras columnas que producción
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
