-- ════════════════════════════════════════════════════════════════════════════
-- Qué dejó atrás el cálculo en el navegador: reporte de SÓLO LECTURA
-- ════════════════════════════════════════════════════════════════════════════
-- 20260910000000 cierra la puerta hacia adelante: desde ahora el consumo, la
-- tarifa y el importe los decide el servidor. Lo que ya está escrito sigue
-- estando escrito, y una parte de ello está mal: cadenas de lectura rotas por
-- el desempate al azar de `getUltimaLectura`, consumos que no son la resta de
-- sus propias lecturas, importes en cero con consumo positivo, filas cuyo
-- `project_id` no es el del contador.
--
-- ESTA MIGRACIÓN NO CORRIGE NADA. A propósito. Cada una de esas filas puede ser
-- un recibo emitido, cobrado y contabilizado: reescribirla en un `UPDATE`
-- masivo mueve dinero de clientes reales sin que nadie lo haya mirado. Lo que
-- hace es publicar el INVENTARIO, para que la corrección sea una decisión
-- humana, caso por caso, con su propio PR y su propio rastro.
--
--   · agua_lecturas_inconsistencias(project)          → una fila por hallazgo
--   · agua_lecturas_inconsistencias_resumen(project)  → el conteo por tipo
--
-- Ambas son STABLE (no pueden escribir aunque se quiera) y están acotadas a la
-- empresa del caller y a los proyectos que ya puede ver.
--
-- SEVERIDAD
--   alta         el dato es internamente contradictorio: se puede afirmar que
--                está mal sin saber nada del contexto.
--   media        es sospechoso y hay que mirarlo: puede tener explicación.
--   informativa  difiere del cálculo de HOY, que no es el mismo de entonces
--                (la tarifa pudo cambiar). No es un error por sí solo.
--
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.agua_lecturas_inconsistencias_resumen(uuid);
--   DROP FUNCTION IF EXISTS public.agua_lecturas_inconsistencias(uuid);
--
-- Idempotente: sólo CREATE OR REPLACE FUNCTION.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.agua_lecturas_inconsistencias(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  registro_id     uuid,
  project_id      uuid,
  contador_id     uuid,
  numero_serie    text,
  cliente_nombre  text,
  fecha           timestamptz,
  hallazgo        text,
  severidad       text,
  detalle         jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH alcance AS (
    -- El recorte es el mismo que ve el usuario en la aplicación: su empresa, y
    -- dentro de ella los proyectos a los que tiene acceso. Se FILTRA en vez de
    -- lanzar 42501 (patrón de agua_anomalias_consumo): un reporte que devuelve
    -- vacío es más útil que uno que revienta.
    SELECT p.id
      FROM public.projects p
     WHERE (public.is_super_admin() OR p.company_id = public.get_my_company_id())
       AND public.can_access_project(p.id)
       AND (p_project_id IS NULL OR p.id = p_project_id)
  ),
  vivas AS (
    SELECT r.id, r.project_id, r.contador_id, r.cliente_nombre, r.fecha,
           r.created_at, r.lectura_anterior, r.lectura_actual, r.consumo,
           r.tarifa_aplicada, r.tarifa_exceso_aplicada, r.canon_aplicado,
           r.monto_calculado, r.estado, r.monto_pagado, r.fecha_pago,
           r.es_reset, r.lectura_final_retirada, r.origen, r.secuencia,
           c.numero_serie,
           c.project_id AS contador_project_id,
           c.cantidad_derecho_servicio_m3,
           t.precio_m3       AS tarifa_hoy_precio,
           t.precio_m3_exceso AS tarifa_hoy_exceso,
           t.canon_fijo      AS tarifa_hoy_canon,
           t.consumo_minimo  AS tarifa_hoy_minimo,
           CASE WHEN jsonb_typeof(t.tramos) = 'array' THEN t.tramos ELSE NULL END AS tarifa_hoy_tramos,
           -- El MISMO orden total que usa agua_lectura_contexto: el reporte
           -- audita contra la regla nueva, no contra otra distinta.
           LAG(r.lectura_actual) OVER w AS prev_lectura,
           LAG(r.fecha)          OVER w AS prev_fecha,
           -- La fecha más alta que YA existía cuando esta fila se capturó. Es
           -- lo que detecta la retroactiva de verdad: no «viene antes en la
           -- serie» (eso es toda fila menos la última), sino «se escribió
           -- después de otra que ya cubría una fecha posterior».
           MAX(r.fecha) OVER (
             PARTITION BY r.contador_id ORDER BY r.created_at NULLS FIRST, r.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ) AS fecha_tope_al_capturar,
           (r.fecha AT TIME ZONE COALESCE(co.timezone, 'America/Guatemala'))::date AS dia_local,
           COUNT(*) OVER (
             PARTITION BY r.contador_id,
             (r.fecha AT TIME ZONE COALESCE(co.timezone, 'America/Guatemala'))::date
           ) AS lecturas_ese_dia
      FROM public.registros r
      JOIN alcance a          ON a.id = r.project_id
      LEFT JOIN public.contadores c ON c.id = r.contador_id
      LEFT JOIN public.projects  pr ON pr.id = r.project_id
      LEFT JOIN public.companies co ON co.id = pr.company_id
      LEFT JOIN public.tarifas   t  ON t.id = c.tarifa_id
     WHERE r.deleted_at IS NULL
    -- El MISMO orden total que usa agua_lectura_contexto, en ascendente.
    WINDOW w AS (PARTITION BY r.contador_id
                 ORDER BY COALESCE(r.secuencia, 0), r.fecha, r.created_at NULLS FIRST, r.id)
  ),
  recalculo AS (
    SELECT v.*, k.total AS monto_hoy, k.tipo_cobro AS tipo_cobro_hoy
      FROM vivas v
      LEFT JOIN LATERAL public.agua_costo_tarifa(
        v.consumo, v.tarifa_hoy_precio, v.tarifa_hoy_exceso, v.tarifa_hoy_canon,
        v.tarifa_hoy_minimo, v.tarifa_hoy_tramos, v.cantidad_derecho_servicio_m3
      ) k ON v.consumo IS NOT NULL AND v.consumo >= 0
  ),
  hallazgos AS (
    -- 1 · La cadena está rota: `lectura_anterior` no es la lectura vigente que
    --     la precede. Es la huella directa del desempate al azar y de la lista
    --     recortada en memoria.
    SELECT r.id AS registro_id, r.project_id, r.contador_id, r.numero_serie,
           r.cliente_nombre, r.fecha,
           'cadena_rota'::text AS hallazgo, 'alta'::text AS severidad,
           jsonb_build_object('lectura_anterior_guardada', r.lectura_anterior,
                              'lectura_anterior_real', r.prev_lectura) AS detalle
      FROM recalculo r
     WHERE r.prev_lectura IS NOT NULL
       AND r.lectura_anterior IS DISTINCT FROM r.prev_lectura

    UNION ALL
    -- 2 · El consumo no es la resta de sus propias lecturas (y no está marcado
    --     como reset, donde por definición no lo es).
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'consumo_incoherente', 'alta',
           jsonb_build_object('consumo_guardado', r.consumo,
                              'consumo_esperado', r.lectura_actual - r.lectura_anterior)
      FROM recalculo r
     WHERE r.es_reset IS NOT TRUE
       AND r.lectura_actual IS NOT NULL AND r.lectura_anterior IS NOT NULL
       AND r.consumo IS DISTINCT FROM (r.lectura_actual - r.lectura_anterior)

    UNION ALL
    -- 3 · Consumo positivo cobrado en cero. No hace falta saber la tarifa de
    --     entonces para afirmar que un recibo así está mal.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'monto_cero_con_consumo', 'alta',
           jsonb_build_object('consumo', r.consumo, 'tarifa_aplicada', r.tarifa_aplicada,
                              'canon_aplicado', r.canon_aplicado)
      FROM recalculo r
     WHERE COALESCE(r.consumo, 0) > 0
       AND COALESCE(r.monto_calculado, 0) = 0
       AND COALESCE(r.tarifa_aplicada, 0) > 0

    UNION ALL
    -- 4 · La lectura vive en un proyecto distinto al de su contador: la fila
    --     está contabilizada en el condominio equivocado.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'cruce_proyecto', 'alta',
           jsonb_build_object('project_id_registro', r.project_id,
                              'project_id_contador', r.contador_project_id)
      FROM recalculo r
     WHERE r.contador_project_id IS NOT NULL
       AND r.contador_project_id IS DISTINCT FROM r.project_id

    UNION ALL
    -- 5 · Nació cobrada. El selector «Estado Pago» de la captura permitía
    --     marcar 'pagado' al guardar, sin pago, sin fecha y sin rastro.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'pagada_sin_pago', 'alta',
           jsonb_build_object('estado', r.estado, 'monto_calculado', r.monto_calculado)
      FROM recalculo r
     WHERE r.estado = 'pagado'
       AND COALESCE(r.monto_pagado, 0) = 0
       AND r.fecha_pago IS NULL

    UNION ALL
    -- 6 · Varias lecturas vivas del mismo contador y día. Ahora es legal y se
    --     encadenan; en el histórico son justo las filas donde el desempate
    --     decidió el importe.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'varias_el_mismo_dia', 'media',
           jsonb_build_object('dia', r.dia_local, 'lecturas_ese_dia', r.lecturas_ese_dia)
      FROM recalculo r
     WHERE r.lecturas_ese_dia > 1

    UNION ALL
    -- 7 · Se capturó con fecha anterior a una lectura que ya existía: la regla
    --     nueva la rechazaría.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'retroactiva', 'media',
           jsonb_build_object('fecha', r.fecha, 'fecha_ya_cubierta', r.fecha_tope_al_capturar)
      FROM recalculo r
     WHERE r.fecha_tope_al_capturar IS NOT NULL
       AND r.fecha < r.fecha_tope_al_capturar

    UNION ALL
    -- 8 · Sin contador: no hay base contra la cual encadenar ni auditar. Son
    --     las filas del formulario de administrador, donde el operador tecleaba
    --     `lectura_anterior` y el canon a mano.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'sin_contador', 'media',
           jsonb_build_object('lectura_anterior', r.lectura_anterior,
                              'lectura_actual', r.lectura_actual)
      FROM recalculo r
     WHERE r.contador_id IS NULL

    UNION ALL
    -- 9 · El importe guardado tiene más de dos decimales: viene de un flotante
    --     de JavaScript sin redondear al contrato.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'monto_sin_redondear', 'media',
           jsonb_build_object('monto_calculado', r.monto_calculado)
      FROM recalculo r
     WHERE r.monto_calculado IS NOT NULL
       AND r.monto_calculado IS DISTINCT FROM round(r.monto_calculado, 2)

    UNION ALL
    -- 10 · Difiere de lo que daría la tarifa de HOY. Informativa a propósito:
    --      la tarifa pudo cambiar legítimamente después de emitir el recibo.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'difiere_de_tarifa_actual', 'informativa',
           jsonb_build_object('monto_guardado', r.monto_calculado,
                              'monto_con_tarifa_de_hoy', r.monto_hoy,
                              'tipo_cobro_guardado', r.tipo_cobro_hoy)
      FROM recalculo r
     WHERE r.monto_hoy IS NOT NULL
       AND r.monto_calculado IS NOT NULL
       AND abs(r.monto_calculado - r.monto_hoy) > 0.01
  )
  SELECT * FROM hallazgos
   ORDER BY CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
            fecha DESC NULLS LAST, registro_id
$$;

COMMENT ON FUNCTION public.agua_lecturas_inconsistencias(uuid) IS
  'Reporte de SÓLO LECTURA de lecturas de agua históricas cuyo dato es internamente contradictorio (cadena rota, consumo que no es la resta de sus lecturas, importe cero con consumo, cruce de proyecto, recibo nacido pagado) o sospechoso (varias el mismo día, retroactiva, sin contador, importe sin redondear). NO corrige nada: la corrección es una decisión humana con su propio PR. Acotado a la empresa del caller y a los proyectos que ya puede ver.';

REVOKE EXECUTE ON FUNCTION public.agua_lecturas_inconsistencias(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_lecturas_inconsistencias(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.agua_lecturas_inconsistencias_resumen(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (hallazgo text, severidad text, filas bigint, contadores bigint)
LANGUAGE sql
STABLE
-- SECURITY INVOKER (el default): no lee ninguna tabla por su cuenta, sólo
-- agrupa lo que devuelve agua_lecturas_inconsistencias(), que ya trae su propio
-- recorte de empresa y proyecto. Un SECURITY DEFINER aquí no añadiría ni un
-- privilegio y sí una superficie más que auditar.
SET search_path = ''
AS $$
  SELECT i.hallazgo, i.severidad, COUNT(*)::bigint,
         COUNT(DISTINCT i.contador_id)::bigint
    FROM public.agua_lecturas_inconsistencias(p_project_id) i
   GROUP BY i.hallazgo, i.severidad
   ORDER BY CASE i.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
            COUNT(*) DESC, i.hallazgo
$$;

COMMENT ON FUNCTION public.agua_lecturas_inconsistencias_resumen(uuid) IS
  'Conteo por tipo de hallazgo de agua_lecturas_inconsistencias(): cuántas filas y cuántos contadores distintos toca cada inconsistencia. Sólo lectura; hereda el mismo recorte de empresa y proyecto porque delega en ella.';

REVOKE EXECUTE ON FUNCTION public.agua_lecturas_inconsistencias_resumen(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_lecturas_inconsistencias_resumen(uuid) TO authenticated;
