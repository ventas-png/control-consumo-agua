-- ════════════════════════════════════════════════════════════════════════════
-- Tareas de bloque: paridad de garantías con la ejecución de limpieza
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ AHORA
-- `tareas_bloque` (20260424000060) nunca se alteró y quedó muy por debajo de
-- `ejecuciones_limpieza`: sin CHECK de estado, sin unicidad, sin saber quién
-- cerró, sin anulación lógica y sin los campos de triaje (novedad, prioridad,
-- requiere_mantenimiento). Antes de que la limpieza pueda materializar sus
-- rutinas ahí —el plan de un solo motor operativo— la tabla tiene que ofrecer
-- las mismas garantías, o migrar sería una regresión de todo lo que 20260904*
-- acaba de construir.
--
-- Además arrastra dos problemas VIVOS que esta migración cierra:
--
--   · UN BUG EN PRODUCCIÓN. La migración de trazabilidad (20260731000000:253)
--     declaró el par de cierre como ('completado_en','completado_por') cuando
--     la columna real, creada en 20260424000060:45 y nunca renombrada, es
--     `completada_en` (femenino). Consecuencias encadenadas: `completado_por`
--     jamás se creó, su índice tampoco, el trigger `trg_sellar_cierre` no se
--     instaló, y las DOS versiones de la RPC `actividad_equipo`
--     (20260731000300 y 20260829000600:541-546) referencian columnas
--     inexistentes. PL/pgSQL no valida nombres al crear la función, así que se
--     crearon bien y REVIENTAN EN RUNTIME con 42703 en cuanto se ejecuta esa
--     rama. Que la UI escriba `completada_en` sin errores (TareasPersonalTab)
--     confirma cuál es el nombre real.
--
--   · UN AGUJERO DE PERMISOS. Las policies legadas `company_rw_tareas_bloque`
--     y `company_rw_revisiones_tarea` (20260424000060:78-84) nunca se
--     dropearon: son FOR ALL y solo comprueban la empresa, así que al OR-earse
--     con las RBAC dejan el gate por permiso en letra muerta. Mismo patrón ya
--     cerrado para company_rw_areas y company_rw_plantillas_cargo en 20260904*.
--
-- OJO CON LA CADENA DE RLS. Las policies de tareas_bloque y revisiones_tarea
-- derivan el tenant con un EXISTS sobre `bloques_turno`, y ese EXISTS también
-- pasa por la RLS del padre: nombrar un permiso en la hija no sirve de nada si
-- el padre no lo acepta. Por eso el gate de bloques_turno se ensancha aquí
-- también (verificado en el sandbox: sin ese paso, prog_limpieza ve 0 tareas).
--
-- OJO CON EL RE-GATEO. La policy RBAC de `tareas_bloque` (20260519000002) se
-- gateó con `condominios.tab.panel_turno`, pero PanelTurnoTab NO toca esa
-- tabla: quienes la leen y escriben son tareas_personal, revision_tareas,
-- desempeno_personal y reporte_consolidado. Dropear la legada sin corregir el
-- gate dejaría esos cuatro tabs sin acceso. Aquí se re-declara con el conjunto
-- REAL de consumidores, incluido `prog_limpieza` para que la limpieza pueda
-- materializar sus rutinas sin pedir permisos del módulo Seguridad (mismo
-- criterio que 20260904000100 aplicó al SELECT del catálogo de actividades).
--
-- LO QUE NO HACE: no migra ninguna ejecución de limpieza a `tareas_bloque` ni
-- crea rutinas. Esto solo nivela el terreno.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, constraints con guarda por conname,
-- CREATE INDEX IF NOT EXISTS y DROP POLICY IF EXISTS antes de cada CREATE.
--
-- REVERSA: DROP de las columnas nuevas (sus CHECKs e índices caen con ellas);
-- DROP de los triggers trg_sellar_cierre / trg_tareas_bloque_anulacion;
-- recrear las policies legadas y las de 20260519000002. La RPC vuelve a su
-- forma de 20260829000600 (que es la rota).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Quién cerró la tarea — el par de cierre, con el hito CORRECTO
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tareas_bloque
  ADD COLUMN IF NOT EXISTS completado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tareas_bloque.completado_por IS
  'Usuario que marcó completada_en. Lo sella la BD (trg_sellar_cierre) y no es falsificable desde el navegador. NULL en las filas cerradas antes de esta migración.';

-- El par correcto: (completada_en, completado_por). El de 20260731000000
-- apuntaba a `completado_en`, que no existe.
DROP TRIGGER IF EXISTS trg_sellar_cierre ON public.tareas_bloque;
CREATE TRIGGER trg_sellar_cierre
  BEFORE UPDATE ON public.tareas_bloque
  FOR EACH ROW EXECUTE FUNCTION public.sellar_cierre('completada_en', 'completado_por');

CREATE INDEX IF NOT EXISTS idx_tareas_bloque_completado_por
  ON public.tareas_bloque(completado_por)
  WHERE completado_por IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Triaje y anulación lógica: la paridad con ejecuciones_limpieza
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tareas_bloque
  ADD COLUMN IF NOT EXISTS novedad                text,
  ADD COLUMN IF NOT EXISTS prioridad              text,
  ADD COLUMN IF NOT EXISTS requiere_mantenimiento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anulada_en             timestamptz,
  ADD COLUMN IF NOT EXISTS anulada_por            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_anulacion       text;

COMMENT ON COLUMN public.tareas_bloque.novedad IS
  'Lo que el operativo encontró y no le toca resolver a él (espeja ejecuciones_limpieza.novedad).';
COMMENT ON COLUMN public.tareas_bloque.requiere_mantenimiento IS
  'El operativo marca la tarea como necesitada de mantenimiento; el admin la ve en el resumen de novedades.';
COMMENT ON COLUMN public.tareas_bloque.anulada_en IS
  'Anulación lógica: la fila fue un error. Se conserva con su evidencia; la UI la excluye del checklist activo. NULL = vigente.';

DO $ANULACION$
BEGIN
  -- Estado controlado: hasta ahora era texto libre.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_bloque_estado_check') THEN
    ALTER TABLE public.tareas_bloque
      ADD CONSTRAINT tareas_bloque_estado_check
      CHECK (estado IN ('pendiente', 'completada', 'con_observacion', 'omitida'))
      NOT VALID;   -- NOT VALID: el histórico de 2026-04 no tiene garantías
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_bloque_prioridad_check') THEN
    ALTER TABLE public.tareas_bloque
      ADD CONSTRAINT tareas_bloque_prioridad_check
      CHECK (prioridad IS NULL OR prioridad IN ('baja', 'media', 'alta'));
  END IF;

  -- Anular exige decir por qué; restaurar limpia el trío completo.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_bloque_anulacion_check') THEN
    ALTER TABLE public.tareas_bloque
      ADD CONSTRAINT tareas_bloque_anulacion_check
      CHECK (
        (anulada_en IS NULL AND anulada_por IS NULL AND motivo_anulacion IS NULL)
        OR (anulada_en IS NOT NULL AND btrim(coalesce(motivo_anulacion, '')) <> '')
      );
  END IF;
END;
$ANULACION$;

DROP TRIGGER IF EXISTS trg_tareas_bloque_anulacion ON public.tareas_bloque;
CREATE TRIGGER trg_tareas_bloque_anulacion
  BEFORE UPDATE ON public.tareas_bloque
  FOR EACH ROW EXECUTE FUNCTION public.sellar_cierre('anulada_en', 'anulada_por');

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Una plantilla, una tarea por bloque
-- ────────────────────────────────────────────────────────────────────────────
-- Hoy "Cargar tareas del cargo" (TareasPersonalTab) duplica el checklist
-- entero si se pulsa dos veces. Índice PARCIAL porque plantilla_id es
-- nullable: las tareas ad-hoc (sin plantilla) pueden repetir título.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tareas_bloque_plantilla
  ON public.tareas_bloque(bloque_id, plantilla_id)
  WHERE plantilla_id IS NOT NULL;

COMMENT ON INDEX public.uq_tareas_bloque_plantilla IS
  'Una tarea por plantilla y bloque: cargar el checklist dos veces deja de duplicarlo. Parcial: las tareas ad-hoc (plantilla_id NULL) no se ven afectadas.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS: retirar las legadas y re-gatear al conjunto REAL de consumidores
-- ────────────────────────────────────────────────────────────────────────────
-- Antes de tocar las hijas: `bloques_turno`. Las policies de tareas_bloque y
-- revisiones_tarea derivan el tenant con un EXISTS sobre el bloque padre, y
-- ese EXISTS TAMBIÉN pasa por la RLS de bloques_turno. Si Limpieza no puede
-- ver el bloque, tampoco ve sus tareas por mucho que su policy la nombre. Por
-- eso el gate del padre se ensancha primero, conservando los dos permisos que
-- ya aceptaba (20260820000000:449-452).
DROP POLICY IF EXISTS "bloques_turno_select" ON public.bloques_turno;
CREATE POLICY "bloques_turno_select" ON public.bloques_turno
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.revision_tareas')
             OR public.user_has_permission('condominios.tab.desempeno_personal')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  );

-- La ESCRITURA del bloque no se ensancha a los tabs de solo lectura: crear o
-- cerrar un turno sigue siendo de quien gestiona turnos o tareas de personal.
-- prog_limpieza entra porque materializará rutinas sobre esos bloques.
DROP POLICY IF EXISTS "bloques_turno_insert" ON public.bloques_turno;
CREATE POLICY "bloques_turno_insert" ON public.bloques_turno
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "bloques_turno_update" ON public.bloques_turno;
CREATE POLICY "bloques_turno_update" ON public.bloques_turno
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "company_rw_tareas_bloque" ON public.tareas_bloque;
DROP POLICY IF EXISTS "company_rw_revisiones_tarea" ON public.revisiones_tarea;

-- tareas_bloque: el tenant se deriva del bloque padre (la tabla no tiene
-- company_id propio), igual que en 20260519000002.
DROP POLICY IF EXISTS "tareas_bloque_select" ON public.tareas_bloque;
CREATE POLICY "tareas_bloque_select" ON public.tareas_bloque
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.revision_tareas')
             OR public.user_has_permission('condominios.tab.desempeno_personal')
             OR public.user_has_permission('condominios.tab.prog_limpieza'))
    )
  );

DROP POLICY IF EXISTS "tareas_bloque_insert" ON public.tareas_bloque;
CREATE POLICY "tareas_bloque_insert" ON public.tareas_bloque
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.prog_limpieza'))
    )
  );

DROP POLICY IF EXISTS "tareas_bloque_update" ON public.tareas_bloque;
CREATE POLICY "tareas_bloque_update" ON public.tareas_bloque
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.revision_tareas')
             OR public.user_has_permission('condominios.tab.prog_limpieza'))
    )
  )
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.revision_tareas')
             OR public.user_has_permission('condominios.tab.prog_limpieza'))
    )
  );

-- DELETE endurecido a la par de la limpieza: el checklist ejecutado es
-- evidencia. Corregir un error es ANULAR con motivo; borrar queda para los
-- roles de empresa (y solo mientras la tarea no se haya cerrado).
DROP POLICY IF EXISTS "tareas_bloque_delete" ON public.tareas_bloque;
CREATE POLICY "tareas_bloque_delete" ON public.tareas_bloque
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin() OR (
      tareas_bloque.completada_en IS NULL
      AND EXISTS (
        SELECT 1 FROM public.bloques_turno b
        WHERE b.id = tareas_bloque.bloque_id
          AND b.company_id = public.get_my_company_id()
          AND public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
      )
    )
  );

-- revisiones_tarea: nunca tuvo policies RBAC (solo la legada). Se declaran las
-- cuatro con el gate de quien revisa.
DROP POLICY IF EXISTS "revisiones_tarea_select" ON public.revisiones_tarea;
CREATE POLICY "revisiones_tarea_select" ON public.revisiones_tarea
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = revisiones_tarea.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.revision_tareas')
             OR public.user_has_permission('condominios.tab.desempeno_personal')
             OR public.user_has_permission('condominios.tab.tareas_personal'))
    )
  );

DROP POLICY IF EXISTS "revisiones_tarea_insert" ON public.revisiones_tarea;
CREATE POLICY "revisiones_tarea_insert" ON public.revisiones_tarea
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = revisiones_tarea.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.revision_tareas'))
    )
  );

DROP POLICY IF EXISTS "revisiones_tarea_update" ON public.revisiones_tarea;
CREATE POLICY "revisiones_tarea_update" ON public.revisiones_tarea
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = revisiones_tarea.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.revision_tareas'))
    )
  )
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = revisiones_tarea.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.revision_tareas'))
    )
  );

DROP POLICY IF EXISTS "revisiones_tarea_delete" ON public.revisiones_tarea;
CREATE POLICY "revisiones_tarea_delete" ON public.revisiones_tarea
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = revisiones_tarea.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Reparar la RPC actividad_equipo
-- ────────────────────────────────────────────────────────────────────────────
-- Copia literal de la de 20260829000600 con UN cambio: `tb.completado_en` pasa
-- a `tb.completada_en` (el nombre real). `tb.completado_por` ya existe gracias
-- a la sección 1. Sin esto, el tab de actividad del equipo sigue reventando
-- con 42703 en cuanto un usuario tiene tareas cerradas en el rango.

CREATE OR REPLACE FUNCTION public.actividad_equipo(
  p_project_id uuid,
  p_desde      date DEFAULT (now() - interval '30 days')::date,
  p_hasta      date DEFAULT now()::date
)
RETURNS TABLE (
  usuario_id            uuid,
  usuario_nombre        text,
  usuario_rol           text,
  lecturas              bigint,
  lecturas_m3           numeric,
  limpiezas             bigint,
  checklists            bigint,
  rondas_iniciadas      bigint,
  puntos_marcados       bigint,
  visitas_registradas   bigint,
  paquetes              bigint,
  solicitudes_creadas   bigint,
  tareas_cerradas       bigint,
  total                 bigint,
  ultima_actividad      timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_desde   timestamptz := p_desde::timestamptz;
  -- p_hasta es inclusivo para el usuario: "al 31" incluye todo el día 31.
  v_hasta   timestamptz := (p_hasta + 1)::timestamptz;
BEGIN
  IF NOT (
    public.is_super_admin()
    OR (v_company IS NOT NULL
        AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin']))
  ) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH hechos AS (
    -- Lecturas de agua capturadas
    SELECT r.creado_por AS uid, 'lecturas'::text AS tipo,
           COALESCE(r.consumo, 0)::numeric AS m3, r.fecha AS cuando
      FROM public.registros r
     WHERE r.project_id = p_project_id
       AND r.deleted_at IS NULL
       AND r.creado_por IS NOT NULL
       AND r.fecha >= v_desde AND r.fecha < v_hasta

    -- Limpieza: ejecuciones del programa + tareas de bloque completadas
    UNION ALL
    SELECT pl.ejecutado_por, 'limpiezas', 0, pl.ultima_ejecucion::timestamptz
      FROM public.programacion_limpieza pl
     WHERE pl.project_id = p_project_id
       AND pl.ejecutado_por IS NOT NULL
       AND pl.ultima_ejecucion >= v_desde AND pl.ultima_ejecucion < v_hasta

    UNION ALL
    SELECT sh.creado_por, 'limpiezas', 0, sh.fecha::timestamptz
      FROM public.servicios_housekeeping sh
     WHERE sh.project_id = p_project_id
       AND sh.creado_por IS NOT NULL
       AND sh.fecha >= v_desde AND sh.fecha < v_hasta

    UNION ALL
    SELECT tb.completado_por, 'limpiezas', 0, tb.completada_en
      FROM public.tareas_bloque tb
      JOIN public.bloques_turno bt ON bt.id = tb.bloque_id
     WHERE bt.project_id = p_project_id
       AND tb.completado_por IS NOT NULL
       AND tb.completada_en >= v_desde AND tb.completada_en < v_hasta

    -- Checklists e inspecciones de área + bitácora de mantenimiento firmada
    UNION ALL
    SELECT ca.creado_por, 'checklists', 0, ca.fecha::timestamptz
      FROM public.checklist_areas ca
     WHERE ca.project_id = p_project_id
       AND ca.creado_por IS NOT NULL
       AND ca.fecha >= v_desde AND ca.fecha < v_hasta

    UNION ALL
    SELECT bm.creado_por, 'checklists', 0, bm.fecha::timestamptz
      FROM public.bitacora_manto bm
     WHERE bm.project_id = p_project_id
       AND bm.creado_por IS NOT NULL
       AND bm.fecha >= v_desde AND bm.fecha < v_hasta

    -- Rondas de seguridad abiertas y puntos de control marcados
    UNION ALL
    SELECT rs.creado_por, 'rondas_iniciadas', 0, rs.inicio
      FROM public.rondas_seguridad rs
     WHERE rs.project_id = p_project_id
       AND rs.creado_por IS NOT NULL
       AND rs.inicio >= v_desde AND rs.inicio < v_hasta

    UNION ALL
    SELECT vc.visitado_por, 'puntos_marcados', 0, vc.visitado_en
      FROM public.visitas_control vc
      JOIN public.rondas_seguridad rs2 ON rs2.id = vc.ronda_id
     WHERE rs2.project_id = p_project_id
       AND vc.visitado_por IS NOT NULL
       AND vc.visitado_en >= v_desde AND vc.visitado_en < v_hasta

    -- Visitas registradas en caseta
    UNION ALL
    SELECT v.registrado_por, 'visitas_registradas', 0, v.created_at
      FROM public.visitantes v
     WHERE v.project_id = p_project_id
       AND v.registrado_por IS NOT NULL
       AND v.created_at >= v_desde AND v.created_at < v_hasta

    -- Paquetes recibidos
    UNION ALL
    SELECT pr.creado_por, 'paquetes', 0, pr.created_at
      FROM public.paquetes_recibidos pr
     WHERE pr.project_id = p_project_id
       -- ÚNICO CAMBIO respecto de 20260731000300: la tabla ahora también
       -- guarda correspondencia. La métrica contaba paquetes y sigue contando
       -- paquetes; sin este filtro subiría sola el día de la unificación.
       AND pr.clase = 'paquete'
       AND pr.creado_por IS NOT NULL
       AND pr.created_at >= v_desde AND pr.created_at < v_hasta

    -- Solicitudes levantadas
    UNION ALL
    SELECT sr.creado_por, 'solicitudes_creadas', 0, sr.created_at
      FROM public.solicitudes_residente sr
     WHERE sr.project_id = p_project_id
       AND sr.creado_por IS NOT NULL
       AND sr.created_at >= v_desde AND sr.created_at < v_hasta

    UNION ALL
    SELECT sc.creado_por, 'solicitudes_creadas', 0, sc.created_at
      FROM public.solicitudes_concierge sc
     WHERE sc.project_id = p_project_id
       AND sc.creado_por IS NOT NULL
       AND sc.created_at >= v_desde AND sc.created_at < v_hasta

    -- Tareas cerradas
    UNION ALL
    SELECT tc.cerrado_por, 'tareas_cerradas', 0, tc.fecha_cierre::timestamptz
      FROM public.tareas_condominio tc
     WHERE tc.project_id = p_project_id
       AND tc.cerrado_por IS NOT NULL
       AND tc.fecha_cierre >= v_desde AND tc.fecha_cierre < v_hasta
  ),
  agregado AS (
    SELECT
      h.uid,
      count(*) FILTER (WHERE h.tipo = 'lecturas')            AS lecturas,
      COALESCE(sum(h.m3) FILTER (WHERE h.tipo = 'lecturas'), 0) AS lecturas_m3,
      count(*) FILTER (WHERE h.tipo = 'limpiezas')           AS limpiezas,
      count(*) FILTER (WHERE h.tipo = 'checklists')          AS checklists,
      count(*) FILTER (WHERE h.tipo = 'rondas_iniciadas')    AS rondas_iniciadas,
      count(*) FILTER (WHERE h.tipo = 'puntos_marcados')     AS puntos_marcados,
      count(*) FILTER (WHERE h.tipo = 'visitas_registradas') AS visitas_registradas,
      count(*) FILTER (WHERE h.tipo = 'paquetes')            AS paquetes,
      count(*) FILTER (WHERE h.tipo = 'solicitudes_creadas') AS solicitudes_creadas,
      count(*) FILTER (WHERE h.tipo = 'tareas_cerradas')     AS tareas_cerradas,
      count(*)                                               AS total,
      max(h.cuando)                                          AS ultimo_hecho
    FROM hechos h
    GROUP BY h.uid
  ),
  ultima_bitacora AS (
    SELECT b.usuario_id AS uid, max(b.created_at) AS ultima
      FROM public.bitacora_acciones b
     WHERE b.project_id = p_project_id
       AND b.usuario_id IS NOT NULL
       AND b.created_at >= v_desde AND b.created_at < v_hasta
     GROUP BY b.usuario_id
  )
  SELECT
    a.uid,
    COALESCE(NULLIF(au.full_name, ''), 'Usuario ' || left(a.uid::text, 8)),
    COALESCE(au.role, '—'),
    a.lecturas, a.lecturas_m3, a.limpiezas, a.checklists,
    a.rondas_iniciadas, a.puntos_marcados, a.visitas_registradas,
    a.paquetes, a.solicitudes_creadas, a.tareas_cerradas, a.total,
    GREATEST(a.ultimo_hecho, ub.ultima)
  FROM agregado a
  LEFT JOIN public.app_users au ON au.id = a.uid
  LEFT JOIN ultima_bitacora ub  ON ub.uid = a.uid
  ORDER BY a.total DESC, 2 ASC;
END;
$$;

-- Los GRANT de la RPC no se repiten: CREATE OR REPLACE conserva la ACL
-- existente, y 20260829000600 ya la dejó revocada de PUBLIC/anon y concedida a
-- authenticated/service_role.
