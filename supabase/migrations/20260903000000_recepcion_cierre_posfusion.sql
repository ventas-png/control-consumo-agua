-- ════════════════════════════════════════════════════════════════════════════
-- Recepción — cierre posfusión: validar el CHECK y retirar el respaldo
-- ════════════════════════════════════════════════════════════════════════════
-- Mantenimiento de lo que la unificación Paquetería ↔ Correspondencia
-- (20260828000300 … 20260902000000) dejó a propósito para después:
--
--   1. `paquetes_estado_chk` se creó NOT VALID. Protege lo nuevo, pero no
--      afirma nada sobre lo viejo.
--   2. `correspondencia_condominio_respaldo` guarda las filas originales de
--      `correspondencia_condominio` tal como estaban antes de migrarlas.
--
-- Esta migración cierra los dos, en ese orden, y ABORTA antes de tocar nada si
-- lo que encuentra no cuadra. No hay `IF EXISTS` que se trague un error ni
-- `ON CONFLICT DO NOTHING` que convierta una sorpresa en un verde: la única
-- rama silenciosa es la de la tabla que YA fue retirada, que es ausencia
-- esperada y no una anomalía.
--
-- APPEND-ONLY. No modifica ninguna migración histórica. Su timestamp es
-- posterior a 20260902000000, el último de la cadena de recepción.
--
-- DE UN SOLO USO, COMO EL RESTO DE LA CADENA. El DROP de abajo no se puede
-- deshacer volviéndola a correr; en una base que ya la recibió, la parte del
-- respaldo entra por su rama de no-op y la de validación es idempotente
-- (validar un CHECK ya validado no hace nada).
--
-- ATOMICIDAD: DEPENDE DE QUIÉN LA APLIQUE, Y POR ESO CONVERGE.
-- `apply-migrations-prod.yml` manda el archivo entero como UNA consulta a la
-- Management API, y Postgres lo corre en una transacción implícita: o todo o
-- nada. `psql -f` y el CLI, en cambio, van en autocommit, así que un aborto en
-- la sección 4 deja ya cometido el VALIDATE de la sección 2.
--
-- No se fuerza un BEGIN/COMMIT explícito: si el aplicador ya abrió su propia
-- transacción, un COMMIT de más se la cerraría antes de tiempo. Lo que hace
-- inofensiva la diferencia es que reaplicar converge — la auditoría se rehace,
-- VALIDATE sobre una constraint ya validada es un no-op, y la verificación del
-- respaldo se repite entera. El escenario 8 de
-- `scripts/cierre-posfusion-sandbox.sh` lo ejercita: abortar, reparar el dato y
-- volver a aplicar termina en el mismo estado final.
--
-- LO QUE DELIBERADAMENTE NO HACE: retirar la vista
-- `public.correspondencia_condominio`. Ver la sección 3.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1) Auditoría del vocabulario clase/estado ───────────────────────────────
--
-- `VALIDATE CONSTRAINT` recorre la tabla y, si encuentra una fila que no
-- cumple, aborta con un mensaje que nombra la constraint y UNA fila. Eso no
-- sirve para arreglar nada: no dice cuántas hay, ni de qué clases, ni con qué
-- estados. Así que primero se audita aquí, con la MISMA expresión que la
-- constraint (20260901000000), y se enumeran las combinaciones ofensoras
-- —clase, estado, cuántas filas y una muestra de ids— antes de intentar nada.
--
-- Se agrupa por (clase, estado) y no se reporta sólo un total: un conteo dice
-- que hay un problema, la enumeración dice cuál.
--
-- `IS NOT TRUE` y no `IS FALSE`: `clase` y `estado` son NOT NULL desde
-- 20260420000002 y 20260829000600, así que hoy coinciden; si algún día alguien
-- afloja esa restricción, esto se queda del lado estricto en vez de dejar pasar
-- una fila indeterminada que el CHECK sí toleraría.
DO $$
DECLARE
  v_detalle text;
  v_total   bigint;
BEGIN
  WITH invalidas AS (
    SELECT clase, estado, id
      FROM public.paquetes_recibidos
     WHERE (
       CASE clase
         WHEN 'paquete'         THEN estado IN ('pendiente','entregado','devuelto')
         WHEN 'correspondencia' THEN estado IN ('pendiente','atendido','archivado','devuelto')
         ELSE false
       END
     ) IS NOT TRUE
  ), agrupadas AS (
    SELECT clase, estado, count(*) AS filas, (array_agg(id ORDER BY id))[1:5] AS muestra
      FROM invalidas
     GROUP BY clase, estado
  )
  SELECT string_agg(
           format('  · clase=%L estado=%L → %s fila(s); ids: %s',
                  clase, estado, filas, array_to_string(muestra, ', ')),
           E'\n' ORDER BY clase, estado),
         (SELECT count(*) FROM invalidas)
    INTO v_detalle, v_total
    FROM agrupadas;

  IF v_detalle IS NOT NULL THEN
    RAISE EXCEPTION
      E'paquetes_recibidos tiene % fila(s) fuera del vocabulario de estados por clase.\n%',
      v_total, v_detalle
      USING HINT =
        'Vocabulario admitido — paquete: pendiente|entregado|devuelto; '
        'correspondencia: pendiente|atendido|archivado|devuelto. '
        'Corregí esas filas y volvé a aplicar esta migración. '
        'No se validó la constraint ni se retiró el respaldo.';
  END IF;

  RAISE NOTICE 'Vocabulario clase/estado: sin combinaciones inválidas.';
END $$;


-- ── 2) El CHECK deja de ser una promesa sobre el futuro ─────────────────────
--
-- Con la auditoría en verde, VALIDATE no puede fallar por datos; si fallara,
-- sería porque la constraint no existe o cambió de forma, y también hay que
-- enterarse. Un CHECK NOT VALID no protege de un UPDATE sobre una fila que ya
-- lo incumplía: valida sólo lo que se escribe, no lo que ya estaba.
ALTER TABLE public.paquetes_recibidos VALIDATE CONSTRAINT paquetes_estado_chk;


-- ── 3) La vista `correspondencia_condominio` SE QUEDA ───────────────────────
--
-- 20260829000600 sustituyó la tabla por una vista de compatibilidad de sólo
-- lectura con el vocabulario viejo. Ni el repositorio ni la base muestran
-- dependencias internas: la app escribe y lee `paquetes_recibidos`.
--
-- Aun así NO se retira. «No encontré consumidores» no es «no hay consumidores»:
-- un reporte externo, un SQL ad-hoc guardado, un webhook de un tercero o un
-- export programado no dejan rastro en este repositorio. El coste de conservar
-- la vista es una definición de veinte líneas; el de retirarla a ciegas es que
-- algo de fuera empiece a fallar sin que nadie relacione la causa.
--
-- Para retirarla hace falta evidencia positiva de que nadie la consulta
-- —logs de `pg_stat_statements` o de PostgREST durante un periodo
-- representativo—, no la ausencia de evidencia en contra. Queda anotado aquí
-- para que la próxima persona no lo confunda con un olvido.
COMMENT ON VIEW public.correspondencia_condominio IS
  'Compatibilidad de SOLO LECTURA tras la unificación (20260829000600). Las escrituras van a paquetes_recibidos con clase=''correspondencia''. RETENIDA A PROPÓSITO (20260903000000): no se le conocen consumidores internos, pero no está demostrado que no existan externos; retirarla exige evidencia positiva de desuso, no ausencia de referencias en el repo.';


-- ── 4) Retirada del respaldo de correspondencia ─────────────────────────────
--
-- El respaldo existe para probar UNA cosa: que la unificación no perdió ni
-- deformó ninguna fila. Borrarlo sin comprobarlo tira la única prueba que
-- queda, así que aquí se rehace la verificación entera antes del DROP.
--
-- CÓMO SE COMPARA. No por conteos y no por una muestra de campos: se reconstruye
-- para cada fila respaldada el valor que la cadena de migraciones DEBIÓ dejar en
-- `paquetes_recibidos`, campo por campo, replicando las expresiones tal como
-- están escritas en los archivos originales:
--
--   · el INSERT..SELECT de 20260829000600 (normalizaciones de categoría,
--     estado, dirección y prioridad incluidas);
--   · el relleno de acuse de 20260831000000, reemitido en 20260901000000, que
--     ES parte de lo que la cadena hizo y por tanto del valor esperado.
--
-- Si un campo no coincide, se nombra el id y el campo. Una divergencia puede
-- ser una edición legítima posterior hecha desde la app —y entonces el respaldo
-- ya no representa el estado migrado—, o un fallo real de la migración. Las dos
-- merecen que un humano mire antes de destruir la evidencia, así que las dos
-- abortan.
--
-- SÓLO EN UN SENTIDO. Se comprueba que todo lo respaldado esté en destino, no
-- al revés: la correspondencia creada DESPUÉS de la unificación no está en el
-- respaldo por construcción, y exigirla sería un falso positivo garantizado.
--
-- El `to_regclass` de arriba del todo es la única rama silenciosa de esta
-- migración: si la tabla ya no está, no hay nada que retirar. plpgsql planifica
-- cada sentencia cuando el control llega a ella, así que las referencias a la
-- tabla que hay más abajo no se resuelven en ese caso.
DO $$
DECLARE
  v_filas       bigint;
  v_faltantes   text;
  v_divergentes text;
  v_relleno     CONSTANT text := 'No registrado (acuse anterior a 2026-08-31)';
BEGIN
  IF to_regclass('public.correspondencia_condominio_respaldo') IS NULL THEN
    RAISE NOTICE 'correspondencia_condominio_respaldo no existe: ya fue retirada. Nada que hacer.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.correspondencia_condominio_respaldo' INTO v_filas;
  RAISE NOTICE 'Respaldo presente con % fila(s). Verificando antes de retirarlo.', v_filas;

  -- (a) ¿Está cada fila respaldada, con su id y su clase?
  SELECT string_agg(format('  · %s', r.id), E'\n' ORDER BY r.id)
    INTO v_faltantes
    FROM public.correspondencia_condominio_respaldo r
   WHERE NOT EXISTS (
     SELECT 1 FROM public.paquetes_recibidos p
      WHERE p.id = r.id AND p.clase = 'correspondencia'
   );

  IF v_faltantes IS NOT NULL THEN
    RAISE EXCEPTION
      E'El respaldo tiene filas SIN equivalente en paquetes_recibidos (clase=''correspondencia''):\n%',
      v_faltantes
      USING HINT =
        'No se retiró el respaldo. Esas piezas de correspondencia no llegaron al motor '
        'unificado o cambiaron de clase; hay que reponerlas antes de destruir la copia.';
  END IF;

  -- (b) ¿Coincide cada campo con lo que la cadena debió escribir?
  WITH esperado AS (
    SELECT
      r.id,
      r.company_id,
      r.project_id,
      r.unidad_id,
      CASE WHEN r.unidad_id IS NULL THEN 'administracion' ELSE 'unidad' END AS destinatario_tipo,
      CASE WHEN r.categoria IN ('carta','notificacion_legal','factura','circular','otro')
           THEN r.categoria ELSE 'otro' END                                  AS tipo,
      r.asunto            AS descripcion,
      r.remitente,
      r.destinatario,
      r.numero_guia       AS num_guia,
      r.empresa_mensajeria,
      CASE WHEN r.estado IN ('pendiente','atendido','archivado')
           THEN r.estado ELSE 'archivado' END                                AS estado,
      CASE r.tipo WHEN 'salida' THEN 'saliente' ELSE 'entrante' END          AS direccion,
      CASE WHEN r.prioridad = 'urgente' THEN 'urgente' ELSE 'normal' END     AS prioridad,
      r.fecha_limite,
      r.fecha             AS fecha_pieza,
      r.observaciones     AS notas,
      r.fotos,
      r.firma_path,
      r.entregado_via,
      r.created_at        AS hora_recepcion,
      r.recibido_por,
      r.entregado_por,
      r.creado_por,
      r.created_at,
      -- El relleno de acuse se aplicó a la correspondencia ya ATENDIDA a la que
      -- le faltaba nombre u hora. Se reproduce su condición exacta sobre el
      -- estado ESPERADO, que es el que tenía la fila cuando aquel UPDATE corrió.
      (
        CASE WHEN r.estado IN ('pendiente','atendido','archivado')
             THEN r.estado ELSE 'archivado' END
      ) = 'atendido'
      AND (r.entregado_a_nombre IS NULL OR btrim(r.entregado_a_nombre) = '' OR r.hora_entrega IS NULL)
                                                                             AS hubo_relleno,
      r.entregado_a_nombre AS entregado_a_nombre_original,
      r.hora_entrega       AS hora_entrega_original
      FROM public.correspondencia_condominio_respaldo r
  ), comparado AS (
    SELECT
      e.id,
      array_remove(ARRAY[
        CASE WHEN p.company_id         IS DISTINCT FROM e.company_id         THEN 'company_id'         END,
        CASE WHEN p.project_id         IS DISTINCT FROM e.project_id         THEN 'project_id'         END,
        CASE WHEN p.unidad_id          IS DISTINCT FROM e.unidad_id          THEN 'unidad_id'          END,
        CASE WHEN p.destinatario_tipo  IS DISTINCT FROM e.destinatario_tipo  THEN 'destinatario_tipo'  END,
        CASE WHEN p.tipo               IS DISTINCT FROM e.tipo               THEN 'tipo'               END,
        CASE WHEN p.descripcion        IS DISTINCT FROM e.descripcion        THEN 'descripcion'        END,
        CASE WHEN p.remitente          IS DISTINCT FROM e.remitente          THEN 'remitente'          END,
        CASE WHEN p.destinatario       IS DISTINCT FROM e.destinatario       THEN 'destinatario'       END,
        CASE WHEN p.num_guia           IS DISTINCT FROM e.num_guia           THEN 'num_guia'           END,
        CASE WHEN p.empresa_mensajeria IS DISTINCT FROM e.empresa_mensajeria THEN 'empresa_mensajeria' END,
        CASE WHEN p.estado             IS DISTINCT FROM e.estado             THEN 'estado'             END,
        CASE WHEN p.direccion          IS DISTINCT FROM e.direccion          THEN 'direccion'          END,
        CASE WHEN p.prioridad          IS DISTINCT FROM e.prioridad          THEN 'prioridad'          END,
        CASE WHEN p.fecha_limite       IS DISTINCT FROM e.fecha_limite       THEN 'fecha_limite'       END,
        CASE WHEN p.fecha_pieza        IS DISTINCT FROM e.fecha_pieza        THEN 'fecha_pieza'        END,
        CASE WHEN p.notas              IS DISTINCT FROM e.notas              THEN 'notas'              END,
        CASE WHEN p.fotos              IS DISTINCT FROM e.fotos              THEN 'fotos'              END,
        CASE WHEN p.firma_path         IS DISTINCT FROM e.firma_path         THEN 'firma_path'         END,
        CASE WHEN p.entregado_via      IS DISTINCT FROM e.entregado_via      THEN 'entregado_via'      END,
        CASE WHEN p.hora_recepcion     IS DISTINCT FROM e.hora_recepcion     THEN 'hora_recepcion'     END,
        CASE WHEN p.recibido_por       IS DISTINCT FROM e.recibido_por       THEN 'recibido_por'       END,
        CASE WHEN p.entregado_por      IS DISTINCT FROM e.entregado_por      THEN 'entregado_por'      END,
        CASE WHEN p.creado_por         IS DISTINCT FROM e.creado_por         THEN 'creado_por'         END,
        CASE WHEN p.created_at         IS DISTINCT FROM e.created_at         THEN 'created_at'         END,
        CASE WHEN p.entregado_a_nombre IS DISTINCT FROM (
               CASE WHEN e.hubo_relleno
                    THEN COALESCE(NULLIF(btrim(e.entregado_a_nombre_original), ''), v_relleno)
                    ELSE e.entregado_a_nombre_original END)
             THEN 'entregado_a_nombre' END,
        CASE WHEN p.hora_entrega IS DISTINCT FROM (
               CASE WHEN e.hubo_relleno
                    THEN COALESCE(e.hora_entrega_original, e.hora_recepcion)
                    ELSE e.hora_entrega_original END)
             THEN 'hora_entrega' END
      ], NULL) AS campos
      FROM esperado e
      JOIN public.paquetes_recibidos p ON p.id = e.id
  )
  SELECT string_agg(format('  · %s → %s', id, array_to_string(campos, ', ')), E'\n' ORDER BY id)
    INTO v_divergentes
    FROM comparado
   WHERE cardinality(campos) > 0;

  IF v_divergentes IS NOT NULL THEN
    RAISE EXCEPTION
      E'El respaldo NO coincide con lo migrado; no se retira. Filas y campos que divergen:\n%',
      v_divergentes
      USING HINT =
        'Puede ser una edición legítima hecha desde la app después de la unificación —y entonces '
        'el respaldo ya no representa el estado migrado— o un fallo de la migración. Revisalo a '
        'mano; si la divergencia es esperada, retirá la tabla manualmente tras confirmarlo.';
  END IF;

  DROP TABLE public.correspondencia_condominio_respaldo;
  RAISE NOTICE 'Respaldo verificado (% fila(s)) y retirado.', v_filas;
END $$;
