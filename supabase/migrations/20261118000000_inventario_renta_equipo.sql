-- ════════════════════════════════════════════════════════════════════════════
-- Renta de equipo: el inventario dice qué se presta a un costo y cuánto por
-- unidad; la reserva cobra esa renta además de su tarifa
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- Desde 20261108000000 el residente pide al reservar el equipo que la amenidad
-- presta (mesas, sillas, el proyector) y la administración lo entrega y lo
-- recibe; lo que falta se cobra al costo de REPOSICIÓN. Pero prestarlo no
-- cuesta nada: no hay dónde decir que las sillas se rentan a Q 5 cada una ni
-- cómo sumar esa renta al cobro de la reserva. Hoy quien cobra la renta lo
-- apunta a mano en las notas.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `inventario_condominio.prestable_con_costo` (el toggle «se permite
--      prestar a un costo») y `costo_renta_unidad` (lo que se cobra por cada
--      unidad prestada). El toggle encendido EXIGE un monto mayor que cero; el
--      CHECK lo impone para cualquier camino de escritura.
--   2. `prestamos_equipo.costo_renta_unitario` (congelado al pedir, como el de
--      reposición: si después cambia el precio en el inventario, la reserva ya
--      hecha no cambia), `monto_renta` (lo SOLICITADO × el costo congelado: la
--      renta se calcula sobre lo que el cliente pide que se le tenga listo, no
--      sobre lo que al final se entregó) y `cuota_renta_id` (la cuota que la
--      cobró). La renta de una reserva es la suma de sus líneas vivas (todo
--      menos 'cancelado'); NO se denormaliza en `reservas_amenidades`: ese
--      grupo tiene drift declarado (#826) y el auditor de tres vías no puede
--      decidir un cambio sobre él. La pantalla la suma desde las líneas.
--   3. `portal_reservar_amenidad` cobra TARIFA + RENTA en la misma cuota
--      'amenidad' cuando la reserva queda confirmada con «cargar a la unidad»;
--      con «pagar al momento» el total se cobra en sitio. El método de pago se
--      exige si hay algo que cobrar (tarifa o renta), ya no sólo con tarifa.
--      Cancelar la reserva anula esa cuota entera (E7, 20261018000000), que es
--      lo correcto: las solicitudes de equipo se cancelan con la reserva.
--   4. `portal_equipos_amenidad` devuelve `costo_renta_unidad` para que el
--      residente vea la renta por unidad y el total antes de confirmar.
--   5. `reserva_equipos_solicitar` (el panel agrega equipo a una reserva ya
--      creada) gana `p_generar_cargo`: con true crea UNA cuota 'amenidad' por
--      la renta de lo agregado y la liga a las líneas (`cuota_renta_id`). Esa
--      cuota NO cuelga de `reservas_amenidades.cuota_id`, así que al cancelar
--      la reserva se anula con una solicitud, como cualquier otra cuota.
--      La firma cambia: se retira la de dos argumentos para no dejar dos
--      sobrecargas que PostgREST no sabría elegir.
--
-- LO QUE **NO** HACE: no toca `reservas_amenidades` ni ninguna policy o grant
-- de tabla; no agrega índices a `prestamos_equipo` (su grupo de índices tiene
-- drift declarado, #826).
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS; los CHECK se crean sólo si no existen;
-- las funciones son CREATE OR REPLACE sobre la misma firma, salvo
-- `reserva_equipos_solicitar`, cuya firma vieja se retira con IF EXISTS.
--
-- REVERSA:
--   DROP FUNCTION IF EXISTS public.reserva_equipos_solicitar(uuid, jsonb, boolean);
--   -- y volver a crear la firma (uuid, jsonb) de 20261108000000 §9.
--   -- portal_reservar_amenidad, portal_equipos_amenidad,
--   -- reserva_equipos_registrar_solicitud y prestamo_valida_disponibilidad:
--   -- volver a crear los cuerpos de 20261108000000 (misma firma).
--   DROP FUNCTION IF EXISTS public.reserva_equipos_renta(uuid, jsonb);
--   ALTER TABLE public.prestamos_equipo
--     DROP COLUMN IF EXISTS costo_renta_unitario, DROP COLUMN IF EXISTS monto_renta,
--     DROP COLUMN IF EXISTS cuota_renta_id;
--   ALTER TABLE public.inventario_condominio
--     DROP COLUMN IF EXISTS prestable_con_costo, DROP COLUMN IF EXISTS costo_renta_unidad;
--   (los DROP COLUMN arrastran sus CHECK).
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Inventario: se presta a un costo, y a cuánto la unidad
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.inventario_condominio
  ADD COLUMN IF NOT EXISTS prestable_con_costo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS costo_renta_unidad  numeric(12,2);

-- El toggle encendido exige el monto (> 0); apagado, el monto puede quedar
-- guardado o en NULL —la UI lo limpia—, pero nunca negativo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventario_renta_coherente') THEN
    ALTER TABLE public.inventario_condominio
      ADD CONSTRAINT inventario_renta_coherente CHECK (
        (costo_renta_unidad IS NULL OR costo_renta_unidad >= 0)
        AND (NOT prestable_con_costo OR (costo_renta_unidad IS NOT NULL AND costo_renta_unidad > 0)));
  END IF;
END;
$$;

COMMENT ON COLUMN public.inventario_condominio.prestable_con_costo IS
  'true = el equipo se presta a un costo: cada unidad que se pide con una reserva suma costo_renta_unidad al cobro de la reserva. false = se presta sin costo (sólo reposición de lo que falte).';
COMMENT ON COLUMN public.inventario_condominio.costo_renta_unidad IS
  'Renta por unidad prestada (moneda del proyecto). Obligatorio y > 0 cuando prestable_con_costo. Se congela en prestamos_equipo.costo_renta_unitario al pedir.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Préstamos: renta congelada por unidad, monto de la línea y su cuota
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.prestamos_equipo
  ADD COLUMN IF NOT EXISTS costo_renta_unitario numeric(12,2),
  ADD COLUMN IF NOT EXISTS monto_renta          numeric(12,2),
  ADD COLUMN IF NOT EXISTS cuota_renta_id       uuid REFERENCES public.cuotas_condominio(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prestamos_equipo_renta_no_negativa') THEN
    ALTER TABLE public.prestamos_equipo
      ADD CONSTRAINT prestamos_equipo_renta_no_negativa CHECK (
        (costo_renta_unitario IS NULL OR costo_renta_unitario >= 0)
        AND (monto_renta IS NULL OR monto_renta >= 0));
  END IF;
END;
$$;

COMMENT ON COLUMN public.prestamos_equipo.costo_renta_unitario IS
  'Renta por unidad congelada al vincular el préstamo (inventario_condominio.costo_renta_unidad si prestable_con_costo). NULL = el equipo se presta sin costo.';
COMMENT ON COLUMN public.prestamos_equipo.monto_renta IS
  'Renta de la línea: cantidad SOLICITADA × costo_renta_unitario. Se calcula sobre lo que el cliente pide que se le tenga listo; entregar menos no la cambia. NULL = sin renta.';
COMMENT ON COLUMN public.prestamos_equipo.cuota_renta_id IS
  'Cuota ''amenidad'' que cobró la renta de esta línea: la de la reserva cuando se pidió al reservar con cargo a la unidad, o la generada aparte al agregar equipo después. NULL = sin cargo propio (se cobra en sitio o quedó en la cuota de la reserva creada por el panel). La renta de una reserva es la suma de monto_renta de sus líneas no canceladas.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Cuánto cuesta la renta de lo que se pide (antes de escribir nada)
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER porque lee inventario_condominio, que el residente no ve
-- por RLS. Sólo la invocan las RPC (dueño): `authenticated` no la ejecuta
-- directo. Suma cantidad × costo_renta_unidad del equipo ENLAZADO a la
-- amenidad que se presta a un costo; lo que no está enlazado no suma aquí y
-- lo rechaza después reserva_equipos_registrar_solicitud.
CREATE OR REPLACE FUNCTION public.reserva_equipos_renta(
  p_amenidad_id uuid,
  p_equipos jsonb
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_equipos IS NULL OR jsonb_typeof(p_equipos) <> 'array' THEN 0::numeric
    ELSE COALESCE((
      SELECT round(sum(x.cantidad * inv.costo_renta_unidad), 2)
        FROM jsonb_to_recordset(p_equipos) AS x(inventario_id uuid, cantidad int)
        JOIN public.amenidad_inventario ai
          ON ai.amenidad_id = p_amenidad_id AND ai.inventario_id = x.inventario_id
        JOIN public.inventario_condominio inv ON inv.id = ai.inventario_id
       WHERE x.cantidad > 0
         AND inv.prestable_con_costo
         AND inv.costo_renta_unidad IS NOT NULL
    ), 0::numeric)
  END
$$;
REVOKE EXECUTE ON FUNCTION public.reserva_equipos_renta(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserva_equipos_renta(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.reserva_equipos_renta(uuid, jsonb) IS
  'Interno: renta total de [{inventario_id, cantidad}] para una amenidad: Σ cantidad × inventario_condominio.costo_renta_unidad del equipo enlazado que se presta a un costo. 0 si no hay nada que cobrar. No la ejecuta ningún usuario directo.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. El trigger de disponibilidad también congela la renta
-- ────────────────────────────────────────────────────────────────────────────
-- Cuerpo de 20261108000000 §4 línea a línea, más el snapshot de la renta
-- junto al de la reposición: así un préstamo suelto (Préstamo de equipos, sin
-- reserva) también sabe a cuánto se rentó cada unidad.
CREATE OR REPLACE FUNCTION public.prestamo_valida_disponibilidad()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv  public.inventario_condominio%ROWTYPE;
  v_disp int;
BEGIN
  IF NEW.inventario_id IS NULL THEN
    RETURN NEW;  -- préstamo libre (texto), como siempre
  END IF;
  IF NEW.estado NOT IN ('solicitado', 'prestado') THEN
    RETURN NEW;  -- cerrar o cancelar no descuenta nada
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.cantidad = OLD.cantidad
     AND NEW.estado = OLD.estado
     AND NEW.inventario_id IS NOT DISTINCT FROM OLD.inventario_id
     AND NEW.fecha_prestamo = OLD.fecha_prestamo THEN
    RETURN NEW;  -- cambió otra cosa (observaciones, depósito…)
  END IF;
  IF NEW.cantidad IS NULL OR NEW.cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a prestar debe ser mayor que cero.' USING ERRCODE = '23514';
  END IF;

  -- Lock del equipo: dos solicitudes del mismo equipo se serializan aquí.
  SELECT * INTO v_inv FROM public.inventario_condominio WHERE id = NEW.inventario_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El equipo no existe en el inventario.';
  END IF;
  IF v_inv.company_id <> NEW.company_id OR v_inv.project_id <> NEW.project_id THEN
    RAISE EXCEPTION 'El equipo pertenece a otro condominio.' USING ERRCODE = '42501';
  END IF;
  IF v_inv.estado IN ('dado_de_baja', 'en_reparacion') THEN
    RAISE EXCEPTION '"%" no está disponible para préstamo (%).', v_inv.nombre,
      CASE v_inv.estado WHEN 'dado_de_baja' THEN 'dado de baja' ELSE 'en reparación' END
      USING ERRCODE = '23514';
  END IF;

  -- Snapshot del inventario al vincular: nombre para la lista, costo para la
  -- reposición y renta por unidad (20261118000000), aunque después cambien.
  IF NEW.equipo_nombre IS NULL OR btrim(NEW.equipo_nombre) = '' THEN
    NEW.equipo_nombre := v_inv.nombre;
  END IF;
  IF NEW.costo_reposicion_unitario IS NULL THEN
    NEW.costo_reposicion_unitario := v_inv.costo_unitario;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.costo_renta_unitario IS NULL AND v_inv.prestable_con_costo THEN
    NEW.costo_renta_unitario := v_inv.costo_renta_unidad;
  END IF;
  -- La renta de la línea es lo SOLICITADO × la renta congelada; sólo se
  -- propone al nacer la línea (quien acumula cantidades la recalcula él).
  IF TG_OP = 'INSERT' AND NEW.monto_renta IS NULL AND NEW.costo_renta_unitario IS NOT NULL THEN
    NEW.monto_renta := round(COALESCE(NEW.cantidad_solicitada, NEW.cantidad) * NEW.costo_renta_unitario, 2);
  END IF;

  v_disp := COALESCE(public.prestamo_equipo_disponible(NEW.inventario_id, NEW.fecha_prestamo, NEW.id), 0);
  IF NEW.cantidad > v_disp THEN
    RAISE EXCEPTION 'De "%" sólo hay % disponible(s) para el %.',
      v_inv.nombre, GREATEST(v_disp, 0), to_char(NEW.fecha_prestamo, 'DD/MM/YYYY')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prestamo_valida_disponibilidad() FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Registrar la solicitud de equipo de una reserva: sella la renta
-- ────────────────────────────────────────────────────────────────────────────
-- Cuerpo de 20261108000000 §6 con la renta: la línea nueva nace con el costo
-- congelado y su monto; la que se acumula recalcula el monto con SU costo
-- congelado (no con el precio de hoy del inventario).
CREATE OR REPLACE FUNCTION public.reserva_equipos_registrar_solicitud(
  p_reserva_id uuid,
  p_equipos jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_res     public.reservas_amenidades%ROWTYPE;
  v_eq      record;
  v_max     int;
  v_previo  int;
  v_nombre  text;
  v_costo   numeric(12,2);
  v_renta_u numeric(12,2);
  v_n       int := 0;
BEGIN
  IF p_equipos IS NULL OR jsonb_typeof(p_equipos) <> 'array' OR jsonb_array_length(p_equipos) = 0 THEN
    RETURN 0;
  END IF;
  SELECT * INTO v_res FROM public.reservas_amenidades WHERE id = p_reserva_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.';
  END IF;

  FOR v_eq IN
    SELECT x.inventario_id, sum(x.cantidad)::int AS cantidad
      FROM jsonb_to_recordset(p_equipos) AS x(inventario_id uuid, cantidad int)
     GROUP BY x.inventario_id
  LOOP
    IF v_eq.inventario_id IS NULL OR COALESCE(v_eq.cantidad, 0) <= 0 THEN
      RAISE EXCEPTION 'Equipo solicitado inválido.';
    END IF;
    SELECT ai.cantidad_max_por_reserva, inv.nombre, inv.costo_unitario,
           CASE WHEN inv.prestable_con_costo THEN inv.costo_renta_unidad END
      INTO v_max, v_nombre, v_costo, v_renta_u
      FROM public.amenidad_inventario ai
      JOIN public.inventario_condominio inv ON inv.id = ai.inventario_id
     WHERE ai.amenidad_id = v_res.amenidad_id
       AND ai.inventario_id = v_eq.inventario_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uno de los equipos solicitados no se presta con esta amenidad.';
    END IF;
    -- El tope es por RESERVA: cuenta lo que esta reserva ya tiene pedido o
    -- entregado del mismo equipo.
    SELECT COALESCE(sum(p.cantidad), 0)::int INTO v_previo
      FROM public.prestamos_equipo p
     WHERE p.reserva_id = v_res.id
       AND p.inventario_id = v_eq.inventario_id
       AND p.estado IN ('solicitado', 'prestado');
    IF v_max IS NOT NULL AND v_previo + v_eq.cantidad > v_max THEN
      RAISE EXCEPTION 'De "%" se pueden solicitar hasta % por reserva (esta reserva ya tiene %).', v_nombre, v_max, v_previo;
    END IF;
    -- Misma fila de inventario ya solicitada en esta reserva: se suma, no se
    -- duplica (el trigger vuelve a validar la disponibilidad del total). La
    -- renta se recalcula con el costo congelado de ESA línea.
    UPDATE public.prestamos_equipo
       SET cantidad            = cantidad + v_eq.cantidad,
           cantidad_solicitada = COALESCE(cantidad_solicitada, cantidad) + v_eq.cantidad,
           monto_renta         = CASE WHEN costo_renta_unitario IS NOT NULL
                                      THEN round((COALESCE(cantidad_solicitada, cantidad) + v_eq.cantidad) * costo_renta_unitario, 2)
                                      ELSE monto_renta END
     WHERE reserva_id = v_res.id AND inventario_id = v_eq.inventario_id AND estado = 'solicitado';
    IF NOT FOUND THEN
      INSERT INTO public.prestamos_equipo
        (company_id, project_id, unidad_id, inventario_id, reserva_id,
         equipo_nombre, cantidad, cantidad_solicitada,
         fecha_prestamo, hora_prestamo, estado, costo_reposicion_unitario,
         costo_renta_unitario, monto_renta)
      VALUES
        (v_res.company_id, v_res.project_id, v_res.unidad_id, v_eq.inventario_id, v_res.id,
         v_nombre, v_eq.cantidad, v_eq.cantidad,
         v_res.fecha, v_res.hora_inicio, 'solicitado', v_costo,
         v_renta_u, CASE WHEN v_renta_u IS NOT NULL THEN round(v_eq.cantidad * v_renta_u, 2) END);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.reserva_equipos_registrar_solicitud(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserva_equipos_registrar_solicitud(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.reserva_equipos_registrar_solicitud(uuid, jsonb) IS
  'Interno: crea (o acumula) las solicitudes de equipo de una reserva a partir de [{inventario_id, cantidad}]. Exige que el equipo esté enlazado a la amenidad y respeta el tope por reserva; la disponibilidad la impone el trigger de prestamos_equipo. Congela la renta por unidad y calcula monto_renta sobre lo solicitado. No la ejecuta ningún usuario directo.';

-- ────────────────────────────────────────────────────────────────────────────
-- 6. portal_reservar_amenidad: la reserva cobra tarifa + renta
-- ────────────────────────────────────────────────────────────────────────────
-- Misma firma que 20261108000000 §7 (CREATE OR REPLACE). Cuerpo línea a línea
-- más: la renta se calcula ANTES de la cuota (reserva_equipos_renta), el
-- método de pago se exige si hay tarifa O renta, la cuota lleva el total y las
-- líneas de equipo quedan ligadas a esa cuota (cuota_renta_id) cuando se cargó
-- a la unidad. La reserva no guarda la renta: se lee de sus líneas.
CREATE OR REPLACE FUNCTION public.portal_reservar_amenidad(
  p_amenidad_id uuid,
  p_unidad_id uuid,
  p_fecha date,
  p_hora_inicio time,
  p_hora_fin time,
  p_num_invitados int DEFAULT 0,
  p_notas text DEFAULT NULL,
  p_metodo_pago text DEFAULT NULL,
  p_reglamento_aceptado boolean DEFAULT false,
  p_equipos jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_amen     public.amenidades%ROWTYPE;
  v_unidad   public.unidades%ROWTYPE;
  v_ahora    timestamp := (now() AT TIME ZONE 'America/Guatemala');
  v_tarifa   numeric(12,2) := 0;
  v_aplica   boolean;
  v_renta    numeric(12,2) := 0;
  v_total    numeric(12,2) := 0;
  v_cobra    boolean;
  v_estado   text;
  v_cuota_id uuid;
  v_reserva  public.reservas_amenidades%ROWTYPE;
  v_ini_min  int;
  v_fin_min  int;
  v_usadas   int;
  v_equipos  int := 0;
BEGIN
  -- Identidad: residente del portal con la unidad propia (dual: propietario
  -- legacy ∪ unidad_residentes), o STAFF del tenant con el mismo gate que tenía
  -- la policy de INSERT — la vista previa del portal (PortalResidenteTab) la usa
  -- el staff y reserva por este mismo camino.
  IF p_unidad_id IS NULL THEN
    RAISE EXCEPTION 'Unidad requerida.';
  END IF;
  SELECT * INTO v_unidad FROM public.unidades WHERE id = p_unidad_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unidad no encontrada o inactiva.';
  END IF;
  IF current_user_role() = 'cliente' THEN
    IF NOT EXISTS (SELECT 1 FROM public.mis_unidades_ids() x WHERE x = p_unidad_id) THEN
      RAISE EXCEPTION 'No autorizado: la unidad no le pertenece.';
    END IF;
  ELSIF NOT (is_super_admin()
             OR (v_unidad.company_id = get_my_company_id()
                 AND user_has_permission('condominios.tab.amenidades'))) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  -- LOCK de la amenidad: serializa las reservas concurrentes de la MISMA
  -- amenidad que pasan por este RPC — el chequeo de conflicto de abajo queda
  -- sin carrera. company/project se derivan de ESTA fila (trg_set_project_id de
  -- 20260729000600 impone project_id desde la amenidad y exige company_id igual).
  SELECT * INTO v_amen FROM public.amenidades
   WHERE id = p_amenidad_id AND activo = true
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amenidad no encontrada o inactiva.';
  END IF;
  IF v_amen.project_id IS DISTINCT FROM v_unidad.project_id THEN
    RAISE EXCEPTION 'La amenidad no pertenece al proyecto de la unidad.';
  END IF;

  -- Insumos básicos (espejo de hacerReserva + CHECK horas_validas de 20260524000000).
  IF p_fecha IS NULL OR p_hora_inicio IS NULL OR p_hora_fin IS NULL THEN
    RAISE EXCEPTION 'Fecha y horario son requeridos.';
  END IF;
  IF p_hora_fin <= p_hora_inicio THEN
    RAISE EXCEPTION 'La hora de fin debe ser posterior al inicio.';
  END IF;
  IF COALESCE(p_num_invitados, 0) < 0 THEN
    RAISE EXCEPTION 'Número de invitados inválido.';
  END IF;
  IF p_fecha < v_ahora::date THEN
    RAISE EXCEPTION 'No se puede reservar en fechas pasadas.';
  END IF;

  -- Reglamento.
  IF v_amen.reglamento IS NOT NULL AND NOT COALESCE(p_reglamento_aceptado, false) THEN
    RAISE EXCEPTION 'Debe leer y aceptar el reglamento antes de reservar.';
  END IF;

  -- Reglas configurables (espejo de validarReglasAmenidad).
  IF v_amen.duracion_max_horas IS NOT NULL AND v_amen.duracion_max_horas > 0
     AND (EXTRACT(EPOCH FROM (p_hora_fin - p_hora_inicio)) / 3600.0) > v_amen.duracion_max_horas THEN
    RAISE EXCEPTION 'La duración máxima permitida es de % horas.', v_amen.duracion_max_horas;
  END IF;
  IF v_amen.horas_minimas_antelacion IS NOT NULL AND v_amen.horas_minimas_antelacion > 0
     AND (p_fecha + p_hora_inicio) < v_ahora + (v_amen.horas_minimas_antelacion * interval '1 hour') THEN
    RAISE EXCEPTION 'Debes reservar con al menos % h de anticipación.', v_amen.horas_minimas_antelacion;
  END IF;
  IF v_amen.max_reservas_mes_unidad IS NOT NULL AND v_amen.max_reservas_mes_unidad > 0 THEN
    -- Server-side cuenta TODAS las reservas del mes (el cliente solo veía las
    -- futuras cargadas en memoria).
    SELECT count(*) INTO v_usadas
      FROM public.reservas_amenidades r
     WHERE r.amenidad_id = v_amen.id
       AND r.unidad_id = p_unidad_id
       AND r.estado <> 'cancelada'
       AND r.fecha >= date_trunc('month', p_fecha)::date
       AND r.fecha <  (date_trunc('month', p_fecha) + interval '1 month')::date;
    IF v_usadas >= v_amen.max_reservas_mes_unidad THEN
      RAISE EXCEPTION 'Esta unidad ya alcanzó el límite de % reserva(s) este mes para esta amenidad.',
        v_amen.max_reservas_mes_unidad;
    END IF;
  END IF;

  -- Bloqueos de la administración (hora NULL = día completo — espejo de
  -- bloqueoSolapaReserva).
  IF EXISTS (
    SELECT 1 FROM public.amenidades_bloqueos b
     WHERE b.amenidad_id = v_amen.id
       AND p_fecha BETWEEN b.fecha_inicio AND b.fecha_fin
       AND (b.hora_inicio IS NULL
            OR (p_hora_inicio < b.hora_fin AND p_hora_fin > b.hora_inicio))
  ) THEN
    RAISE EXCEPTION 'La amenidad no está disponible en esa fecha/horario (bloqueo de la administración).';
  END IF;

  -- Conflicto GLOBAL contra TODAS las reservas confirmadas (SECURITY DEFINER ve
  -- las de otras unidades, que el residente no ve — cierra la doble-reserva).
  -- En MINUTOS enteros clamped a [0,1440]: `time ± interval` en Postgres ENVUELVE
  -- (00:30 − 60min = 23:30), el mismo defecto que el wrap de addMinutosToTime JS.
  -- Solape medio-abierto idéntico al cliente: ini < efFin AND fin > efIni.
  v_ini_min := EXTRACT(HOUR FROM p_hora_inicio)::int * 60 + EXTRACT(MINUTE FROM p_hora_inicio)::int;
  v_fin_min := EXTRACT(HOUR FROM p_hora_fin)::int    * 60 + EXTRACT(MINUTE FROM p_hora_fin)::int;
  IF EXISTS (
    SELECT 1
      FROM public.reservas_amenidades r,
      LATERAL (SELECT
        GREATEST(0,
          EXTRACT(HOUR FROM r.hora_inicio)::int * 60 + EXTRACT(MINUTE FROM r.hora_inicio)::int
          - COALESCE(v_amen.minutos_preparacion_previa, 0))    AS ef_ini,
        LEAST(1440,
          EXTRACT(HOUR FROM r.hora_fin)::int * 60 + EXTRACT(MINUTE FROM r.hora_fin)::int
          + COALESCE(v_amen.minutos_preparacion_posterior, 0)) AS ef_fin
      ) e
     WHERE r.amenidad_id = v_amen.id
       AND r.fecha = p_fecha
       AND r.estado = 'confirmada'
       AND v_ini_min < e.ef_fin
       AND v_fin_min > e.ef_ini
  ) THEN
    RAISE EXCEPTION 'Esa amenidad ya está reservada en ese horario (o en su tiempo de preparación). Elige otro.';
  END IF;

  -- Tarifa SERVER-SIDE (nunca del cliente) — espejo de tarifaAplicable:
  -- EXTRACT(DOW): 0=domingo, 6=sábado (igual que getDay() sobre T12:00 local).
  IF v_amen.requiere_tarifa THEN
    IF EXTRACT(DOW FROM p_fecha) IN (0, 6) AND v_amen.tarifa_uso_finde IS NOT NULL THEN
      v_tarifa := v_amen.tarifa_uso_finde;
    ELSE
      v_tarifa := COALESCE(v_amen.tarifa_uso, 0);
    END IF;
  END IF;
  v_aplica := v_amen.requiere_tarifa AND v_tarifa > 0;

  -- Renta del equipo pedido (20261118000000), también SERVER-SIDE: lo que el
  -- residente pide × la renta por unidad del inventario. Se suma a la tarifa
  -- en el MISMO cobro; el equipo se registra más abajo y su monto congelado
  -- coincide con esta suma porque sale de las mismas filas.
  v_renta := COALESCE(public.reserva_equipos_renta(v_amen.id, p_equipos), 0);
  v_total := (CASE WHEN v_aplica THEN v_tarifa ELSE 0 END) + v_renta;
  v_cobra := v_total > 0;
  IF v_cobra THEN
    IF p_metodo_pago IS NULL OR p_metodo_pago NOT IN ('cargar_unidad', 'pagar_momento') THEN
      RAISE EXCEPTION 'Indica cómo pagarás % (cargar a la unidad o pagar al momento).',
        CASE WHEN v_aplica AND v_renta > 0 THEN 'la tarifa y la renta del equipo'
             WHEN v_renta > 0 THEN 'la renta del equipo'
             ELSE 'la tarifa' END;
    END IF;
  ELSE
    p_metodo_pago := NULL;  -- sin nada que cobrar no se persiste método (paridad con el flujo actual)
  END IF;

  v_estado := CASE WHEN v_amen.requiere_aprobacion THEN 'pendiente' ELSE 'confirmada' END;

  -- Cuota + reserva EN LA MISMA transacción: cualquier RAISE posterior revierte
  -- la cuota (muere la compensación best-effort del navegador). Cuota SOLO si
  -- confirmada + algo que cobrar + cargar_unidad; 'pendiente' nunca genera
  -- cuota — la crea el admin al aprobar (flujo existente de
  -- AmenidadesTab.aprobarReserva). La cuota lleva TARIFA + RENTA: una sola
  -- cuenta por cobrar por la reserva, que E7 anula entera al cancelarla.
  IF v_estado = 'confirmada' AND v_cobra AND p_metodo_pago = 'cargar_unidad' THEN
    INSERT INTO public.cuotas_condominio
      (company_id, project_id, unidad_id, concepto, monto, periodo,
       fecha_vencimiento, estado, notas, created_by)
    VALUES
      (v_amen.company_id, v_amen.project_id, p_unidad_id, 'amenidad', v_total,
       to_char(p_fecha, 'YYYY-MM'), p_fecha, 'pendiente',
       'Reserva ' || v_amen.nombre || ' ' || to_char(p_fecha, 'YYYY-MM-DD')
         || ' ' || left(p_hora_inicio::text, 5) || '-' || left(p_hora_fin::text, 5)
         || CASE WHEN v_renta > 0 THEN ' · incluye renta de equipo ' || to_char(v_renta, 'FM999999990.00') ELSE '' END,
       -- cuotas_condominio NO está en trg_sellar_creado_por (20260731000000):
       -- se sella aquí. rol_responsable queda NULL ⇒ visible para todos los
       -- residentes de la unidad (20260713070000).
       auth.uid())
    RETURNING id INTO v_cuota_id;
  END IF;

  INSERT INTO public.reservas_amenidades
    (company_id, amenidad_id, unidad_id, cliente_id, fecha, hora_inicio, hora_fin,
     num_invitados, notas, estado, monto_tarifa, metodo_pago_tarifa, tarifa_pagada,
     cuota_id, deposito_estado, reglamento_aceptado_at, created_by)
  VALUES
    (v_amen.company_id, v_amen.id, p_unidad_id, public.get_my_cliente_id(),
     p_fecha, p_hora_inicio, p_hora_fin,
     COALESCE(p_num_invitados, 0), NULLIF(btrim(p_notas), ''), v_estado,
     CASE WHEN v_aplica THEN v_tarifa END, p_metodo_pago, false,
     v_cuota_id,
     CASE WHEN v_amen.requiere_deposito THEN 'pendiente' ELSE 'no_aplica' END,
     CASE WHEN v_amen.reglamento IS NOT NULL THEN now() END,
     auth.uid())
  RETURNING * INTO v_reserva;
  -- project_id lo impone trg_set_project_id desde la amenidad (ignora el payload).

  -- Equipo solicitado con la reserva: mismo commit. Si alguno no alcanza (el
  -- trigger de prestamos_equipo lo rechaza), la reserva y su cuota se revierten
  -- y el residente ve por qué.
  v_equipos := public.reserva_equipos_registrar_solicitud(v_reserva.id, p_equipos);

  -- La renta pedida quedó dentro de la cuota de la reserva: las líneas lo saben.
  IF v_cuota_id IS NOT NULL AND v_renta > 0 THEN
    UPDATE public.prestamos_equipo
       SET cuota_renta_id = v_cuota_id
     WHERE reserva_id = v_reserva.id AND monto_renta > 0 AND cuota_renta_id IS NULL;
  END IF;

  -- monto_renta_equipo y monto_total_cobro son CALCULADOS (no columnas): el
  -- portal pinta el aviso con lo que de verdad se cobró.
  RETURN to_jsonb(v_reserva) || jsonb_build_object(
    'equipos_solicitados', v_equipos, 'monto_renta_equipo', NULLIF(v_renta, 0), 'monto_total_cobro', v_total);
END;
$fn$;

REVOKE ALL ON FUNCTION public.portal_reservar_amenidad(uuid,uuid,date,time,time,int,text,text,boolean,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_reservar_amenidad(uuid,uuid,date,time,time,int,text,text,boolean,jsonb) TO authenticated;
COMMENT ON FUNCTION public.portal_reservar_amenidad(uuid,uuid,date,time,time,int,text,text,boolean,jsonb) IS
  'El residente (propietario o inquilino vía mis_unidades_ids) reserva una amenidad. Valida TODO server-side (reglas, bloqueos, conflicto global bajo FOR UPDATE de la amenidad) y calcula la tarifa Y la renta del equipo pedido en el servidor; si hay algo que cobrar exige método de pago y, con cargar_unidad y reserva confirmada, crea UNA cuota ''amenidad'' por tarifa + renta en la misma transacción. `p_equipos` = [{inventario_id, cantidad}] del equipo enlazado a la amenidad: nace como préstamo ''solicitado'' en el mismo commit y se rechaza si no hay disponibilidad. Devuelve la reserva más equipos_solicitados, monto_renta_equipo (calculado) y monto_total_cobro. Horas = reloj de pared America/Guatemala.';

-- ────────────────────────────────────────────────────────────────────────────
-- 7. portal_equipos_amenidad: el catálogo dice la renta por unidad
-- ────────────────────────────────────────────────────────────────────────────
-- Misma firma que 20261108000000 §8; una clave más en cada fila.
CREATE OR REPLACE FUNCTION public.portal_equipos_amenidad(
  p_amenidad_id uuid,
  p_fecha date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_amen  public.amenidades%ROWTYPE;
  v_fecha date := COALESCE(p_fecha, (now() AT TIME ZONE 'America/Guatemala')::date);
  v_out   jsonb;
BEGIN
  SELECT * INTO v_amen FROM public.amenidades WHERE id = p_amenidad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amenidad no encontrada.';
  END IF;
  -- Residente de un proyecto de la amenidad, o staff del tenant con el tab
  -- (la vista previa del portal la usa el staff), igual que portal_reservar_amenidad.
  -- COALESCE(…, false): sin perfil, get_my_company_id() es NULL y el OR
  -- quedaría en NULL, que un IF no rechaza. Cerrado por defecto.
  IF current_user_role() = 'cliente' THEN
    IF NOT EXISTS (SELECT 1 FROM public.mis_proyectos_ids() x WHERE x = v_amen.project_id) THEN
      RAISE EXCEPTION 'No autorizado.';
    END IF;
  ELSIF NOT COALESCE(is_super_admin()
                     OR (v_amen.company_id = get_my_company_id()
                         AND user_has_permission('condominios.tab.amenidades')), false) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'inventario_id',            inv.id,
           'nombre',                   inv.nombre,
           'categoria',                inv.categoria,
           'descripcion',              inv.descripcion,
           'unidad_medida',            inv.unidad_medida,
           'costo_reposicion',         inv.costo_unitario,
           'costo_renta_unidad',       CASE WHEN inv.prestable_con_costo THEN inv.costo_renta_unidad END,
           'cantidad_max_por_reserva', ai.cantidad_max_por_reserva,
           'notas',                    ai.notas,
           'disponible',               GREATEST(0, COALESCE(public.prestamo_equipo_disponible(inv.id, v_fecha, NULL), 0))
         ) ORDER BY inv.nombre), '[]'::jsonb)
    INTO v_out
    FROM public.amenidad_inventario ai
    JOIN public.inventario_condominio inv ON inv.id = ai.inventario_id
   WHERE ai.amenidad_id = v_amen.id
     AND inv.estado NOT IN ('dado_de_baja', 'en_reparacion');
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.portal_equipos_amenidad(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_equipos_amenidad(uuid, date) TO authenticated;
COMMENT ON FUNCTION public.portal_equipos_amenidad(uuid, date) IS
  'Equipo que se presta con una amenidad y cuántas unidades quedan para una fecha (hoy si no se indica): [{inventario_id, nombre, categoria, descripcion, unidad_medida, costo_reposicion, costo_renta_unidad, cantidad_max_por_reserva, notas, disponible}]. costo_renta_unidad es NULL cuando el equipo se presta sin costo. Residente de un proyecto de la amenidad o staff del tenant con el tab de amenidades; cualquier otro, rechazo explícito.';

-- ────────────────────────────────────────────────────────────────────────────
-- 8. reserva_equipos_solicitar: el panel agrega equipo, y puede cobrarlo
-- ────────────────────────────────────────────────────────────────────────────
-- La firma cambia (gana `p_generar_cargo boolean DEFAULT false`): se retira la
-- de 20261108000000 §9 para no dejar dos sobrecargas.
DROP FUNCTION IF EXISTS public.reserva_equipos_solicitar(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.reserva_equipos_solicitar(
  p_reserva_id uuid,
  p_equipos jsonb,
  p_generar_cargo boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_res      public.reservas_amenidades%ROWTYPE;
  v_amen     public.amenidades%ROWTYPE;
  v_n        int;
  v_renta    numeric(12,2) := 0;
  v_cuota_id uuid;
  v_ahora    timestamp := (now() AT TIME ZONE 'America/Guatemala');
BEGIN
  SELECT * INTO v_res FROM public.reservas_amenidades WHERE id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.';
  END IF;
  -- COALESCE(…, false): sin perfil el OR queda en NULL y un IF no lo rechaza.
  IF NOT COALESCE(is_super_admin()
                  OR (v_res.company_id = get_my_company_id()
                      AND (public.condominios_puede_actuar('amenidades', 'edit')
                           OR public.condominios_puede_actuar('amenidades', 'create')
                           OR public.condominios_puede_actuar('prestamos', 'create'))), false) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF v_res.estado NOT IN ('pendiente', 'confirmada') THEN
    RAISE EXCEPTION 'La reserva está % y ya no admite equipo.', v_res.estado;
  END IF;
  IF v_res.checkout_at IS NOT NULL THEN
    RAISE EXCEPTION 'La reserva ya tiene check-out: el equipo se registra desde Préstamo de equipos.';
  END IF;

  -- La renta de lo que se agrega, con los precios de HOY del inventario: es
  -- lo que se congela en las líneas nuevas. (Una línea que se acumula usa su
  -- propio costo congelado; si el precio cambió, la diferencia es mínima y
  -- queda a la vista en monto_renta de la línea.)
  v_renta := COALESCE(public.reserva_equipos_renta(v_res.amenidad_id, p_equipos), 0);
  v_n := public.reserva_equipos_registrar_solicitud(v_res.id, p_equipos);

  -- Cargo aparte por la renta agregada: UNA cuota 'amenidad' a la unidad,
  -- ligada a las líneas vivas de la reserva que aún no tienen cuota de renta.
  IF COALESCE(p_generar_cargo, false) AND v_renta > 0 THEN
    SELECT * INTO v_amen FROM public.amenidades WHERE id = v_res.amenidad_id;
    INSERT INTO public.cuotas_condominio
      (company_id, project_id, unidad_id, concepto, monto, periodo,
       fecha_vencimiento, estado, notas, created_by)
    VALUES
      (v_res.company_id, v_res.project_id, v_res.unidad_id, 'amenidad', v_renta,
       to_char(v_res.fecha, 'YYYY-MM'), v_res.fecha, 'pendiente',
       left('Renta de equipo adicional — ' || COALESCE(v_amen.nombre, 'amenidad') || ' '
            || to_char(v_res.fecha, 'YYYY-MM-DD') || ' ' || left(v_res.hora_inicio::text, 5)
            || '-' || left(v_res.hora_fin::text, 5), 500),
       auth.uid())
    RETURNING id INTO v_cuota_id;
    UPDATE public.prestamos_equipo
       SET cuota_renta_id = v_cuota_id
     WHERE reserva_id = v_res.id
       AND estado IN ('solicitado', 'prestado')
       AND monto_renta > 0
       AND cuota_renta_id IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'reserva_id', v_res.id,
    'equipos_solicitados', v_n,
    'monto_renta', v_renta,
    'cuota_id', v_cuota_id,
    'registrado', v_ahora);
END;
$fn$;
REVOKE ALL ON FUNCTION public.reserva_equipos_solicitar(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_equipos_solicitar(uuid, jsonb, boolean) TO authenticated;
COMMENT ON FUNCTION public.reserva_equipos_solicitar(uuid, jsonb, boolean) IS
  'La administración agrega equipo ([{inventario_id, cantidad}]) a una reserva pendiente o confirmada sin check-out. Exige la empresa del tenant y la acción de amenidades (edit/create) o prestamos.create. Tope por reserva y disponibilidad se validan en la base. Devuelve monto_renta de lo agregado; con p_generar_cargo crea UNA cuota ''amenidad'' por esa renta y la liga a las líneas (cuota_renta_id).';

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Guardas de postcondición
-- ────────────────────────────────────────────────────────────────────────────
-- Que el archivo haya corrido no prueba que la base quedó como se describe:
-- se verifica que la sobrecarga vieja de reserva_equipos_solicitar ya no
-- existe (dos firmas dejarían a PostgREST sin saber cuál llamar), que el
-- toggle del inventario tiene su CHECK y que la RPC del portal cobra la renta.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'reserva_equipos_solicitar'
       AND pg_get_function_identity_arguments(p.oid) = 'p_reserva_id uuid, p_equipos jsonb'
  ) THEN
    RAISE EXCEPTION 'reserva_equipos_solicitar: sigue existiendo la firma (uuid, jsonb); PostgREST no podría elegir entre las dos sobrecargas';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.inventario_condominio'::regclass
       AND conname = 'inventario_renta_coherente'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'inventario_condominio: falta el CHECK inventario_renta_coherente; el toggle podría quedar encendido sin renta';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'portal_reservar_amenidad'
       AND p.prosrc LIKE '%reserva\_equipos\_renta%'
  ) THEN
    RAISE EXCEPTION 'portal_reservar_amenidad: el cuerpo no calcula la renta del equipo (reserva_equipos_renta)';
  END IF;
END;
$$;
