-- ════════════════════════════════════════════════════════════════════════════
-- El insumo que se usa deja de ser gratis: consumo al cerrar la tarea
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL AGUJERO QUE CIERRA
-- `plantilla_tarea_suministros` (20260904000300) declara qué insumos lleva cada
-- actividad, y su propio COMMENT lo dice sin rodeos: «Planificación pura: sin
-- consumo ni descuento de stock.» Nadie descuenta nada. El conserje usa el
-- cloro y el inventario sigue diciendo que está lleno — así que `stock_minimo`
-- nunca dispara reposición, porque el stock nunca baja.
--
-- Es el mismo patrón de dato muerto que 20260907000400 cerró con
-- `requiere_foto`, con la diferencia de que este cuesta dinero.
--
-- EL MOTOR YA ESTABA — NO SE TOCA
-- 20260821000200 hizo de `movimientos_suministro` la ÚNICA fuente del stock:
-- `trg_suministros_stock` recalcula en la misma transacción, y
-- `trg_suministros_guard_stock` revierte en silencio cualquier UPDATE directo a
-- `stock_actual`. La salida ya tiene piso (`GREATEST(0, stock - cantidad)`) y ya
-- existen `origen_tabla`/`origen_id` con índice parcial. Consumir es insertar
-- una 'salida' con `origen_tabla = 'tareas_bloque'`; todo lo demás ya funciona.
--
-- POR QUÉ UNA RPC Y NO UN INSERT DESDE EL CLIENTE
-- Porque el conserje NO tiene `condominios.tab.suministros`, y
-- `movimientos_suministro_insert` exige justamente ese permiso
-- (20260518000010). Un INSERT desde la pantalla de tareas moriría por RLS. La
-- RPC es SECURITY DEFINER y se gatea por los permisos de LA TAREA — que es la
-- autorización correcta: quien puede cerrar la tarea puede declarar lo que
-- gastó haciéndola, sin por eso poder administrar el almacén.
--
-- COPIA, NO JOIN
-- El plan se congela por tarea en `tarea_bloque_suministros`. Es el principio de
-- 20260907000300: editar el catálogo mañana no debe reescribir lo que se pidió
-- hoy. Con un join vivo por `plantilla_id`, una tarea de la semana pasada se
-- descontaría con la receta de esta semana, y las tareas ad-hoc (plantilla_id
-- NULL) no consumirían nunca.
--
-- EL TRIGGER VA EN LA BASE Y NO EN LA RPC DE MATERIALIZAR
-- Hay TRES rutas de alta de tareas con plantilla: `materializar_rutinas_turno`
-- (20260907000300) y, en TareasPersonalTab, «desde plantilla» y «cargar
-- plantillas del cargo». Un trigger AFTER INSERT las cubre a las tres; tocar
-- sólo la RPC dejaría fuera las dos manuales.
--
-- LO QUE SE GASTÓ NO SE GUARDA DOS VECES
-- `tarea_bloque_suministros` guarda lo PLANIFICADO y un puntero al movimiento;
-- la cantidad REAL vive en `movimientos_suministro.cantidad`. Denormalizarla
-- aquí sería abrir una segunda fuente para el mismo número, que es exactamente
-- lo que 20260821000200 vino a cerrar.
--
-- SIN STOCK NO SE BLOQUEA
-- El insumo se gastó de verdad. Negar el registro haría que el histórico mienta
-- y no repone nada; el piso en 0 ya es del motor. La RPC devuelve qué faltó para
-- que la pantalla avise, y el cierre de la tarea no depende de eso.
--
-- IDEMPOTENTE: sí — CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP IF
-- EXISTS antes de cada trigger, y la RPC misma sólo toca filas con
-- `movimiento_id IS NULL` (volver a llamarla no descuenta dos veces).
--
-- REVERSA:
-- DROP FUNCTION public.consumir_insumos_tarea(uuid, jsonb);
-- DROP TRIGGER trg_tarea_copiar_insumos ON public.tareas_bloque;
-- DROP FUNCTION public.tarea_copiar_insumos_plantilla();
-- DROP TABLE public.tarea_bloque_suministros;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. El plan congelado por tarea
-- ────────────────────────────────────────────────────────────────────────────
-- `numeric(10,2)` en cantidad: la misma precisión que `stock_actual` y que
-- `plantilla_tarea_suministros.cantidad`. Planificar con más decimales de los
-- que el stock puede registrar sólo fabrica descuadres.
CREATE TABLE IF NOT EXISTS public.tarea_bloque_suministros (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid          NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  tarea_id             uuid          NOT NULL REFERENCES public.tareas_bloque(id) ON DELETE CASCADE,
  suministro_id        uuid          NOT NULL,
  cantidad_planificada numeric(10,2) NOT NULL,
  -- Snapshot del catálogo al momento de crear la tarea: renombrar el insumo o
  -- cambiarle la unidad no reescribe lo que decía la orden de aquel día.
  nombre_suministro    text          NOT NULL,
  unidad_medida        text          NOT NULL,
  -- NULL = todavía no se consumió. Es TODA la idempotencia de la RPC.
  -- ON DELETE SET NULL y no RESTRICT: borrar el movimiento (que sólo pueden
  -- owner/admin) es la forma de deshacer un consumo mal cargado, y deja la
  -- fila pendiente otra vez en vez de bloquear la corrección.
  movimiento_id        uuid          REFERENCES public.movimientos_suministro(id) ON DELETE SET NULL,
  -- Por qué no se consumió, cuando el operativo declara que no lo necesitó.
  motivo_no_usado      text,
  creado_por           uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT tbs_cantidad_check CHECK (cantidad_planificada > 0),
  CONSTRAINT tbs_unico UNIQUE (tarea_id, suministro_id),
  -- FK compuesta: el ancla `suministros_id_tenant_uq` la creó 20260904000300.
  -- RESTRICT porque borrar un insumo no debe borrar la constancia de haberlo
  -- gastado.
  CONSTRAINT tbs_suministro_fk
    FOREIGN KEY (suministro_id, company_id, project_id)
    REFERENCES public.suministros_condominio(id, company_id, project_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.tarea_bloque_suministros IS
  'Insumos planificados PARA UNA TAREA CONCRETA (snapshot de plantilla_tarea_suministros al crearse la tarea) y el movimiento de salida que los consumió. Copia y no join: editar el catálogo no reescribe lo que se pidió aquel día.';
COMMENT ON COLUMN public.tarea_bloque_suministros.cantidad_planificada IS
  'Lo que la receta pedía, en la unidad_medida del suministro. Lo REALMENTE usado vive en movimientos_suministro.cantidad, vía movimiento_id: aquí se guardaría dos veces el mismo número.';
COMMENT ON COLUMN public.tarea_bloque_suministros.movimiento_id IS
  'Salida que descontó este insumo. NULL = todavía no se consumió. La RPC sólo toca filas con NULL, así que volver a cerrar la tarea no descuenta dos veces.';
COMMENT ON COLUMN public.tarea_bloque_suministros.company_id IS
  'Denormalizado del bloque de la tarea. Lo sella la BD (tarea_copiar_insumos_plantilla); tareas_bloque no tiene tenant propio.';

CREATE INDEX IF NOT EXISTS idx_tbs_tarea       ON public.tarea_bloque_suministros(tarea_id);
CREATE INDEX IF NOT EXISTS idx_tbs_suministro  ON public.tarea_bloque_suministros(suministro_id);
CREATE INDEX IF NOT EXISTS idx_tbs_project     ON public.tarea_bloque_suministros(project_id, company_id);
-- Los pendientes de consumo: es el filtro de la RPC y el de la pantalla.
CREATE INDEX IF NOT EXISTS idx_tbs_pendientes
  ON public.tarea_bloque_suministros(tarea_id)
  WHERE movimiento_id IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Trazabilidad (20260731000000)
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.tarea_bloque_suministros;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.tarea_bloque_suministros
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

COMMENT ON COLUMN public.tarea_bloque_suministros.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema (el trigger de copia corre sin sesión en los jobs).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. La copia del plan al nacer la tarea
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: `plantilla_tarea_suministros` sí la puede leer el operativo
-- (su SELECT acepta `tareas_personal`), pero `suministros_condominio` NO — su
-- SELECT exige `condominios.tab.suministros` (20260518000010). Sin DEFINER, el
-- nombre y la unidad del insumo volverían NULL y el INSERT moriría por NOT NULL,
-- justo para el usuario que más necesita que funcione.
--
-- AFTER INSERT y no BEFORE: la fila de la tarea tiene que existir para que la
-- FK `tarea_id` se pueda verificar.
CREATE OR REPLACE FUNCTION public.tarea_copiar_insumos_plantilla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_project uuid;
BEGIN
  -- Tarea ad-hoc: no hay receta que copiar. No es un error.
  IF NEW.plantilla_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- `tareas_bloque` no tiene tenant propio: se deriva del bloque, igual que su
  -- RLS (20260907000100).
  SELECT b.company_id, b.project_id INTO v_company, v_project
  FROM public.bloques_turno b WHERE b.id = NEW.bloque_id;

  IF v_company IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.tarea_bloque_suministros
    (company_id, project_id, tarea_id, suministro_id,
     cantidad_planificada, nombre_suministro, unidad_medida)
  SELECT v_company, v_project, NEW.id, s.id, pts.cantidad, s.nombre, s.unidad_medida
  FROM public.plantilla_tarea_suministros pts
  JOIN public.suministros_condominio s ON s.id = pts.suministro_id
  WHERE pts.plantilla_tarea_id = NEW.plantilla_id
    -- El insumo dado de baja no se arrastra a tareas nuevas: la receta quedó
    -- desactualizada y descontar de un insumo inactivo sólo ensucia el almacén.
    AND s.activo
    -- La coherencia de tenant la garantiza la FK compuesta, pero filtrar aquí
    -- convierte una excepción que abortaría el alta de la tarea en una fila
    -- que simplemente no se copia. Crear el turno no debe fallar por una
    -- plantilla mal armada.
    AND s.company_id = v_company
    AND s.project_id = v_project
  ON CONFLICT (tarea_id, suministro_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tarea_copiar_insumos_plantilla() IS
  'Copia los insumos planificados de la plantilla a la tarea recién creada, congelando nombre y unidad. Cubre las tres rutas de alta (materializar_rutinas_turno, «desde plantilla» y «cargar plantillas del cargo») con una sola implementación.';

-- Regla (e) del migrations-guard: toda SECURITY DEFINER nueva revoca PUBLIC.
REVOKE EXECUTE ON FUNCTION public.tarea_copiar_insumos_plantilla() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tarea_copiar_insumos ON public.tareas_bloque;
CREATE TRIGGER trg_tarea_copiar_insumos
  AFTER INSERT ON public.tareas_bloque
  FOR EACH ROW EXECUTE FUNCTION public.tarea_copiar_insumos_plantilla();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. El consumo
-- ────────────────────────────────────────────────────────────────────────────
-- `p_consumos`: [{"suministro_id": uuid, "cantidad": numeric}]. Lo que no venga
-- en el arreglo no se toca — cerrar una tarea sin declarar insumos no consume
-- nada, que es lo correcto para las tareas que nunca tuvieron receta.
--
-- `cantidad = 0` es una respuesta VÁLIDA y distinta de omitir: el operativo
-- dice «esto no lo necesité». Se marca con motivo y no genera movimiento.
CREATE OR REPLACE FUNCTION public.consumir_insumos_tarea(
  p_tarea_id uuid,
  p_consumos jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  consumidos int,
  no_usados  int,
  sin_stock  jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company  uuid;
  v_project  uuid;
  v_titulo   text;
  v_fecha    date;
  fila       record;
  v_mov      uuid;
  v_stock    numeric(10,2);
  v_faltante jsonb := '[]'::jsonb;
BEGIN
  consumidos := 0;
  no_usados  := 0;

  SELECT b.company_id, b.project_id, t.titulo, b.fecha
    INTO v_company, v_project, v_titulo, v_fecha
  FROM public.tareas_bloque t
  JOIN public.bloques_turno b ON b.id = t.bloque_id
  WHERE t.id = p_tarea_id;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'tarea inexistente' USING ERRCODE = '42704';
  END IF;

  -- Guard de scope (20260729000200) + permiso del tab. La SECURITY DEFINER se
  -- salta la RLS, así que este control ES el control.
  PERFORM public.assert_company_scope(v_company);

  -- Los mismos gates que el UPDATE de `tareas_bloque` (20260907000100): quien
  -- puede cerrar la tarea puede declarar lo que gastó haciéndola. Nótese que
  -- `condominios.tab.suministros` NO está aquí a propósito — administrar el
  -- almacén y consumir de él son cosas distintas.
  IF NOT (public.is_super_admin()
          OR public.user_has_permission('condominios.tab.tareas_personal')
          OR public.user_has_permission('condominios.tab.turnos')
          OR public.user_has_permission('condominios.tab.revision_tareas')
          OR public.user_has_permission('condominios.tab.prog_limpieza')) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  FOR fila IN
    SELECT tbs.id,
           tbs.suministro_id,
           tbs.nombre_suministro,
           tbs.unidad_medida,
           -- Lo declarado por quien ejecutó; si no viene, lo planificado.
           COALESCE((c.item ->> 'cantidad')::numeric, tbs.cantidad_planificada) AS cantidad
    FROM public.tarea_bloque_suministros tbs
    JOIN LATERAL (
      SELECT j.item
      FROM jsonb_array_elements(COALESCE(p_consumos, '[]'::jsonb)) AS j(item)
      WHERE (j.item ->> 'suministro_id')::uuid = tbs.suministro_id
      LIMIT 1
    ) c ON true
    WHERE tbs.tarea_id = p_tarea_id
      -- TODA la idempotencia está en esta línea: una fila ya consumida no
      -- vuelve a tocarse, así que reintentar el cierre no descuenta dos veces.
      AND tbs.movimiento_id IS NULL
  LOOP
    IF fila.cantidad IS NULL OR fila.cantidad <= 0 THEN
      UPDATE public.tarea_bloque_suministros
         SET motivo_no_usado = 'Declarado como no usado al cerrar la tarea'
       WHERE id = fila.id;
      no_usados := no_usados + 1;
      CONTINUE;
    END IF;

    SELECT s.stock_actual INTO v_stock
    FROM public.suministros_condominio s WHERE s.id = fila.suministro_id;

    -- Se REGISTRA igual: el insumo se gastó de verdad, y el piso en 0 lo pone
    -- `suministros_tg_stock`. Lo que se devuelve es el aviso, no un bloqueo.
    -- La lectura de arriba va sin FOR UPDATE a propósito: bloquear la fila del
    -- catálogo para construir un aviso serializaría los cierres de turno entre
    -- sí. El descuento correcto lo garantiza el trigger, que sí toma el lock;
    -- lo único que puede quedar desactualizado es este mensaje.
    IF COALESCE(v_stock, 0) < fila.cantidad THEN
      v_faltante := v_faltante || jsonb_build_object(
        'suministro_id', fila.suministro_id,
        'nombre',        fila.nombre_suministro,
        'unidad',        fila.unidad_medida,
        'pedido',        fila.cantidad,
        'disponible',    COALESCE(v_stock, 0));
    END IF;

    -- `company_id`/`project_id` los sella `trg_set_project_id` desde el
    -- suministro padre (20260729000600); mandarlos aquí sería decorativo.
    INSERT INTO public.movimientos_suministro
      (company_id, project_id, suministro_id, tipo, cantidad, motivo, fecha,
       origen_tabla, origen_id)
    VALUES
      (v_company, v_project, fila.suministro_id, 'salida', fila.cantidad,
       'Tarea de turno: ' || COALESCE(v_titulo, '(sin título)'),
       COALESCE(v_fecha, CURRENT_DATE),
       'tareas_bloque', p_tarea_id)
    RETURNING id INTO v_mov;

    UPDATE public.tarea_bloque_suministros
       SET movimiento_id = v_mov, motivo_no_usado = NULL
     WHERE id = fila.id;

    consumidos := consumidos + 1;
  END LOOP;

  sin_stock := v_faltante;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.consumir_insumos_tarea(uuid, jsonb) IS
  'Descuenta del almacén los insumos declarados al cerrar una tarea de turno, insertando salidas en movimientos_suministro con origen_tabla = tareas_bloque. Idempotente: sólo toca filas sin movimiento. No bloquea por falta de stock — devuelve el faltante para avisar.';

REVOKE EXECUTE ON FUNCTION public.consumir_insumos_tarea(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.consumir_insumos_tarea(uuid, jsonb) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ────────────────────────────────────────────────────────────────────────────
-- Molde de 20260907000100: el tenant de la tarea se deriva del bloque, y los
-- cuatro gates son los mismos que ven las tareas. La escritura la hace la RPC
-- (SECURITY DEFINER, no pasa por aquí); estas políticas son para que la
-- pantalla pueda LEER el plan y para que el administrador pueda corregirlo.
ALTER TABLE public.tarea_bloque_suministros ENABLE ROW LEVEL SECURITY;

-- Mínimo privilegio: anon no toca la tabla; authenticated pasa por RLS.
-- Sin DELETE para nadie salvo service_role: quitar la constancia de un consumo
-- es reescribir el historial del almacén, y para eso está el `ajuste`.
REVOKE ALL ON public.tarea_bloque_suministros FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.tarea_bloque_suministros TO authenticated;
GRANT ALL ON public.tarea_bloque_suministros TO service_role;

DROP POLICY IF EXISTS "tarea_bloque_suministros_select" ON public.tarea_bloque_suministros;
CREATE POLICY "tarea_bloque_suministros_select" ON public.tarea_bloque_suministros
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.revision_tareas')
             OR public.user_has_permission('condominios.tab.desempeno_personal')
             OR public.user_has_permission('condominios.tab.prog_limpieza')
             OR public.user_has_permission('condominios.tab.suministros')))
  );

-- INSERT y UPDATE quedan para corregir el plan a mano (agregar un insumo que la
-- plantilla no traía, ajustar la cantidad antes de cerrar). Se exige el permiso
-- de ejecución de tareas, no el del almacén.
DROP POLICY IF EXISTS "tarea_bloque_suministros_insert" ON public.tarea_bloque_suministros;
CREATE POLICY "tarea_bloque_suministros_insert" ON public.tarea_bloque_suministros
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "tarea_bloque_suministros_update" ON public.tarea_bloque_suministros;
CREATE POLICY "tarea_bloque_suministros_update" ON public.tarea_bloque_suministros
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.revision_tareas')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.revision_tareas')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  );
