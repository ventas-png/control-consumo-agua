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
-- EL PAR DE CIERRE YA ESTÁ ARREGLADO, y no por esta migración. Cuando se
-- escribió, `completado_por` no existía en el esquema declarado, el trigger
-- `trg_sellar_cierre` no estaba instalado y la RPC `actividad_equipo` reventaba
-- con 42703: la trazabilidad (20260731000000:253) había colgado el par de
-- `completado_en` y la columna real es `completada_en`. Todo eso lo cerró
-- 20260906000200 contra producción y contra el esquema declarado. Aquí se
-- conservan la columna y el trigger de la sección 1 —son idempotentes y dejan
-- la garantía escrita en el archivo que la exige— y se retiró la copia de la
-- RPC, que sólo habría duplicado 200 líneas destinadas a divergir.
--
-- Lo que SÍ sigue vivo y esta migración cierra:
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
-- criterio que 20260904000200 aplicó al SELECT del catálogo de actividades).
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
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
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
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "bloques_turno_update" ON public.bloques_turno;
CREATE POLICY "bloques_turno_update" ON public.bloques_turno
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
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
    (SELECT public.is_super_admin()) OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = (SELECT public.get_my_company_id())
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
    (SELECT public.is_super_admin()) OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.prog_limpieza'))
    )
  );

DROP POLICY IF EXISTS "tareas_bloque_update" ON public.tareas_bloque;
CREATE POLICY "tareas_bloque_update" ON public.tareas_bloque
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin()) OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.revision_tareas')
             OR public.user_has_permission('condominios.tab.prog_limpieza'))
    )
  )
  WITH CHECK (
    (SELECT public.is_super_admin()) OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = (SELECT public.get_my_company_id())
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
    (SELECT public.is_super_admin()) OR (
      tareas_bloque.completada_en IS NULL
      AND EXISTS (
        SELECT 1 FROM public.bloques_turno b
        WHERE b.id = tareas_bloque.bloque_id
          AND b.company_id = (SELECT public.get_my_company_id())
          AND (SELECT public.current_user_role()) = ANY(ARRAY['company_owner', 'admin'])
      )
    )
  );

-- revisiones_tarea: nunca tuvo policies RBAC (solo la legada). Se declaran las
-- cuatro con el gate de quien revisa.
DROP POLICY IF EXISTS "revisiones_tarea_select" ON public.revisiones_tarea;
CREATE POLICY "revisiones_tarea_select" ON public.revisiones_tarea
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin()) OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = revisiones_tarea.bloque_id
        AND b.company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.revision_tareas')
             OR public.user_has_permission('condominios.tab.desempeno_personal')
             OR public.user_has_permission('condominios.tab.tareas_personal'))
    )
  );

DROP POLICY IF EXISTS "revisiones_tarea_insert" ON public.revisiones_tarea;
CREATE POLICY "revisiones_tarea_insert" ON public.revisiones_tarea
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin()) OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = revisiones_tarea.bloque_id
        AND b.company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.revision_tareas'))
    )
  );

DROP POLICY IF EXISTS "revisiones_tarea_update" ON public.revisiones_tarea;
CREATE POLICY "revisiones_tarea_update" ON public.revisiones_tarea
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin()) OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = revisiones_tarea.bloque_id
        AND b.company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.revision_tareas'))
    )
  )
  WITH CHECK (
    (SELECT public.is_super_admin()) OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = revisiones_tarea.bloque_id
        AND b.company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.revision_tareas'))
    )
  );

DROP POLICY IF EXISTS "revisiones_tarea_delete" ON public.revisiones_tarea;
CREATE POLICY "revisiones_tarea_delete" ON public.revisiones_tarea
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin()) OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = revisiones_tarea.bloque_id
        AND b.company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.current_user_role()) = ANY(ARRAY['company_owner', 'admin'])
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 5. La RPC actividad_equipo ya está reparada — aquí no se toca
-- ────────────────────────────────────────────────────────────────────────────
-- La versión original de esta migración traía una copia literal de
-- `actividad_equipo` con `tb.completado_en` cambiado por `tb.completada_en`.
-- 20260906000200 hizo exactamente eso, y además re-apuntó el trigger de
-- sellado, así que repetirlo aquí dejaría DOS copias del mismo cuerpo de 200
-- líneas en el repositorio: la próxima vez que haya que tocar esa consulta,
-- una de las dos se quedaría atrás sin que nada avise.
--
-- Se retira a propósito. Si alguna vez hiciera falta reintroducirla, el sitio
-- es una migración nueva, no ésta.
