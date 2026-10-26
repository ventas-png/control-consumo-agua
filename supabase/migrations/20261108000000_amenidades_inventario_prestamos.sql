-- ============================================================================
-- Amenidades con inventario asignado: el residente pide el equipo al reservar,
-- la administración lo entrega y lo recibe, y lo que falta cuesta reposición
-- ============================================================================
-- PROBLEMA. «Préstamo de equipos» (`prestamos_equipo`, fase 11) era una
-- libreta suelta: el equipo se tecleaba como texto libre, no sabía de qué fila
-- del inventario salía ni a qué reserva pertenecía, y nada limitaba cuánto se
-- podía prestar de algo que ya estaba en circulación. Las reservas de
-- amenidades, por su lado, no tenían forma de pedir mesas, sillas o el
-- proyector: el residente lo escribía en las notas y alguien lo apuntaba a
-- mano. Al cerrar la reserva no quedaba constancia de qué se entregó, qué
-- volvió ni cuánto costaba lo que faltó.
--
-- DISEÑO.
--
--   1. `amenidad_inventario` dice qué filas del inventario se prestan con cada
--      amenidad y hasta cuánto por reserva. Empresa y proyecto los sella la
--      base desde la amenidad; la FK compuesta al inventario impide ligar un
--      equipo de otro condominio.
--
--   2. `prestamos_equipo` se ata al inventario (`inventario_id`) y a la
--      reserva (`reserva_id`). Nace un estado previo a la entrega
--      ('solicitado') y uno de cierre sin entrega ('cancelado'); se guarda lo
--      pedido, lo entregado (`cantidad`), lo devuelto, el costo unitario de
--      reposición congelado al prestar y el monto de reposición que resulta
--      de los faltantes, con la cuota que lo cobró si se generó.
--
--   3. Disponibilidad en UN solo lugar: `prestamo_equipo_disponible` resta
--      del inventario lo que está prestado (en circulación, cualquier fecha)
--      y lo solicitado para esa misma fecha. El trigger de `prestamos_equipo`
--      la aplica a TODO camino de escritura —portal, panel o RPC— bajo lock
--      de la fila del inventario, así dos solicitudes concurrentes no se
--      reparten lo mismo. Un equipo dado de baja o en reparación no se presta.
--
--   4. El residente pide el equipo en la misma transacción de la reserva
--      (`portal_reservar_amenidad` gana `p_equipos`) y consulta el catálogo
--      con disponibilidad por RPC (`portal_equipos_amenidad`): por RLS sólo ve
--      sus propios préstamos, así que no podría calcularla él.
--
--   5. Entregar y recibir son RPC (`prestamos_equipo_entregar` /
--      `prestamos_equipo_recibir`): varias filas en una transacción, sello de
--      fecha y hora en el servidor, y la autorización contempla a quien hace
--      el check-in/check-out de la reserva (acción `amenidades.edit`) además
--      de quien administra los préstamos (`prestamos.edit`). Al recibir se
--      calcula la reposición (faltantes × costo congelado, o el monto que la
--      administración indique) y, si se pide, se genera UNA cuota 'amenidad'
--      a la unidad por el total. `reserva_equipos_solicitar` deja que el panel
--      agregue equipo a una reserva ya creada.
--
--   6. Cancelar una reserva cancela sus solicitudes de equipo todavía no
--      entregadas (trigger en `reservas_amenidades`), venga la cancelación del
--      portal o del panel.
--
-- Horas = reloj de pared 'America/Guatemala', como `portal_reservar_amenidad`.
--
-- REVERSIÓN.
--   DROP FUNCTION IF EXISTS public.prestamos_equipo_recibir(jsonb, text, boolean);
--   DROP FUNCTION IF EXISTS public.prestamos_equipo_entregar(jsonb, text, text);
--   DROP FUNCTION IF EXISTS public.reserva_equipos_solicitar(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.reserva_equipos_registrar_solicitud(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.portal_equipos_amenidad(uuid, date);
--   DROP FUNCTION IF EXISTS public.portal_reservar_amenidad(uuid,uuid,date,time,time,int,text,text,boolean,jsonb);
--   -- y volver a crear la firma de 20260822040000 (sin p_equipos).
--   DROP TRIGGER IF EXISTS trg_reserva_cancelada_cancela_prestamos ON public.reservas_amenidades;
--   DROP FUNCTION IF EXISTS public.reserva_cancelada_cancela_prestamos();
--   DROP TRIGGER IF EXISTS trg_prestamo_valida_disponibilidad ON public.prestamos_equipo;
--   DROP FUNCTION IF EXISTS public.prestamo_valida_disponibilidad();
--   DROP FUNCTION IF EXISTS public.prestamo_equipo_puede_gestionar(public.prestamos_equipo);
--   DROP FUNCTION IF EXISTS public.prestamo_equipo_disponible(uuid, date, uuid);
--   ALTER TABLE public.prestamos_equipo
--     DROP CONSTRAINT IF EXISTS prestamos_equipo_estado_check,
--     DROP CONSTRAINT IF EXISTS prestamos_equipo_devuelta_check,
--     DROP COLUMN IF EXISTS inventario_id, DROP COLUMN IF EXISTS reserva_id,
--     DROP COLUMN IF EXISTS cantidad_solicitada, DROP COLUMN IF EXISTS cantidad_devuelta,
--     DROP COLUMN IF EXISTS costo_reposicion_unitario, DROP COLUMN IF EXISTS monto_reposicion,
--     DROP COLUMN IF EXISTS cuota_reposicion_id, DROP COLUMN IF EXISTS observaciones_devolucion;
--   DROP TABLE IF EXISTS public.amenidad_inventario;
-- ============================================================================

-- ── 1. amenidad_inventario: qué se presta con cada amenidad ──────────────────
CREATE TABLE public.amenidad_inventario (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id               uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  amenidad_id              uuid        NOT NULL REFERENCES public.amenidades(id) ON DELETE CASCADE,
  inventario_id            uuid        NOT NULL,
  cantidad_max_por_reserva int,
  notas                    text,
  creado_por               uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amenidad_inventario_unico UNIQUE (amenidad_id, inventario_id),
  CONSTRAINT amenidad_inventario_max_check CHECK (cantidad_max_por_reserva IS NULL OR cantidad_max_por_reserva > 0),
  -- Ancla `inventario_id_tenant_uq` (20260904000300): el equipo tiene que ser
  -- de la misma empresa y proyecto que la amenidad. Si el equipo se borra del
  -- inventario, deja de ofrecerse.
  CONSTRAINT amenidad_inventario_recurso_fk
    FOREIGN KEY (inventario_id, company_id, project_id)
    REFERENCES public.inventario_condominio(id, company_id, project_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.amenidad_inventario IS
  'Equipo del inventario que se presta con una amenidad (amenidades ↔ inventario_condominio). El residente elige de aquí al reservar.';
COMMENT ON COLUMN public.amenidad_inventario.cantidad_max_por_reserva IS
  'Tope por reserva. NULL = hasta lo que haya disponible.';
COMMENT ON COLUMN public.amenidad_inventario.company_id IS
  'Denormalizado de la amenidad. Lo sella la BD (amenidad_inventario_sellar_tenant); lo que mande el cliente se ignora.';
COMMENT ON COLUMN public.amenidad_inventario.project_id IS
  'Denormalizado de la amenidad. Lo sella la BD (amenidad_inventario_sellar_tenant); lo que mande el cliente se ignora.';

CREATE INDEX idx_amenidad_inventario_amenidad  ON public.amenidad_inventario(amenidad_id);
CREATE INDEX idx_amenidad_inventario_inventario ON public.amenidad_inventario(inventario_id);

-- Empresa y proyecto salen SIEMPRE de la amenidad. Corre con los permisos de
-- quien escribe: para enlazar hay que poder ver la amenidad.
CREATE OR REPLACE FUNCTION public.amenidad_inventario_sellar_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT a.company_id, a.project_id INTO NEW.company_id, NEW.project_id
    FROM public.amenidades a WHERE a.id = NEW.amenidad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amenidad no encontrada.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.amenidad_inventario_sellar_tenant() FROM PUBLIC, anon;

CREATE TRIGGER trg_amenidad_inventario_sellar_tenant
  BEFORE INSERT OR UPDATE ON public.amenidad_inventario
  FOR EACH ROW EXECUTE FUNCTION public.amenidad_inventario_sellar_tenant();

-- `creado_por` lo sella el trigger genérico de 20260731000000 si la tabla
-- está en su lista; esta tabla es nueva, así que se sella aquí.
CREATE OR REPLACE FUNCTION public.amenidad_inventario_sellar_creado_por()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.creado_por := auth.uid();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.amenidad_inventario_sellar_creado_por() FROM PUBLIC, anon;

CREATE TRIGGER trg_amenidad_inventario_creado_por
  BEFORE INSERT ON public.amenidad_inventario
  FOR EACH ROW EXECUTE FUNCTION public.amenidad_inventario_sellar_creado_por();

ALTER TABLE public.amenidad_inventario ENABLE ROW LEVEL SECURITY;

-- Leer: igual que `amenidades_select` (20260713040000) — staff con el tab y
-- residente de un proyecto de la amenidad. El residente sólo ve ids y topes;
-- nombre, costo y disponibilidad le llegan por `portal_equipos_amenidad`.
CREATE POLICY amenidad_inventario_select ON public.amenidad_inventario
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.amenidades'))
    OR (project_id IN (SELECT public.mis_proyectos_ids()))
  );

-- Escribir: enlazar equipo es configurar la amenidad (acción edit; create al
-- crearla). Mismo átomo que `amenidades_bloqueos_insert` (20261104000300).
CREATE POLICY amenidad_inventario_insert ON public.amenidad_inventario
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'create') OR public.condominios_puede_actuar('amenidades', 'edit')) ))));
CREATE POLICY amenidad_inventario_update ON public.amenidad_inventario
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'edit')) ))));
CREATE POLICY amenidad_inventario_delete ON public.amenidad_inventario
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('amenidades', 'edit') OR public.condominios_puede_actuar('amenidades', 'delete')) ))));

-- ── 2. prestamos_equipo: atado al inventario y a la reserva ─────────────────
ALTER TABLE public.prestamos_equipo
  ADD COLUMN IF NOT EXISTS inventario_id             uuid REFERENCES public.inventario_condominio(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reserva_id                uuid REFERENCES public.reservas_amenidades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cantidad_solicitada       int,
  ADD COLUMN IF NOT EXISTS cantidad_devuelta         int,
  ADD COLUMN IF NOT EXISTS costo_reposicion_unitario numeric(12,2),
  ADD COLUMN IF NOT EXISTS monto_reposicion          numeric(12,2),
  ADD COLUMN IF NOT EXISTS cuota_reposicion_id       uuid REFERENCES public.cuotas_condominio(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS observaciones_devolucion  text;

-- NOT VALID: las filas legadas se teclearon libres; lo nuevo sí se exige.
ALTER TABLE public.prestamos_equipo
  DROP CONSTRAINT IF EXISTS prestamos_equipo_estado_check,
  ADD  CONSTRAINT prestamos_equipo_estado_check
    CHECK (estado IN ('solicitado', 'prestado', 'devuelto', 'dañado', 'perdido', 'cancelado')) NOT VALID;

ALTER TABLE public.prestamos_equipo
  DROP CONSTRAINT IF EXISTS prestamos_equipo_devuelta_check,
  ADD  CONSTRAINT prestamos_equipo_devuelta_check
    CHECK (cantidad_devuelta IS NULL OR (cantidad_devuelta >= 0 AND cantidad_devuelta <= cantidad));

-- SIN ÍNDICES NUEVOS sobre prestamos_equipo a propósito: sus índices ya
-- difieren entre producción y el repositorio (`tabla:prestamos_equipo/indices`
-- en scripts/schema-drift/drift-conocido.json, #826) y el auditor de tres
-- vías no puede decidir un cambio sobre un grupo con drift declarado. Los
-- índices por reserva_id e inventario_id van con la migración que haga
-- converger ese grupo; la tabla es chica y las búsquedas por equipo o por
-- reserva no lo resienten mientras tanto.

COMMENT ON COLUMN public.prestamos_equipo.estado IS
  'solicitado = pedido con la reserva, aún no entregado · prestado = en circulación · devuelto / dañado / perdido = cerrado al recibir · cancelado = no se entregó';
COMMENT ON COLUMN public.prestamos_equipo.cantidad IS
  'Cantidad ENTREGADA (en una solicitud, la pedida hasta que se entrega). Es la que descuenta disponibilidad.';
COMMENT ON COLUMN public.prestamos_equipo.cantidad_solicitada IS
  'Lo que pidió el residente al reservar; `cantidad` puede quedar por debajo si se entregó menos.';
COMMENT ON COLUMN public.prestamos_equipo.costo_reposicion_unitario IS
  'Costo unitario del inventario congelado al vincular el préstamo: lo que cuesta reponer cada unidad que falte.';
COMMENT ON COLUMN public.prestamos_equipo.monto_reposicion IS
  'Lo que la unidad debe por faltantes o daños al recibir (faltantes × costo congelado, o el monto que indicó la administración).';
COMMENT ON COLUMN public.prestamos_equipo.cuota_reposicion_id IS
  'Cuota ''amenidad'' que cobró la reposición, si se generó al recibir.';

-- ── 3. Disponibilidad: inventario − prestado − solicitado para esa fecha ────
-- SECURITY DEFINER porque cuenta préstamos de TODAS las unidades, que un
-- residente no ve por RLS. Sólo la invocan el trigger y las RPC (dueño);
-- `authenticated` no la ejecuta directo: un conteo por uuid adivinado no es
-- información que haya que regalar.
CREATE OR REPLACE FUNCTION public.prestamo_equipo_disponible(
  p_inventario_id uuid,
  p_fecha date,
  p_excluir_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (CASE WHEN i.estado IN ('dado_de_baja', 'en_reparacion') THEN 0 ELSE i.cantidad END)
       - COALESCE((
           SELECT sum(p.cantidad)::int
             FROM public.prestamos_equipo p
            WHERE p.inventario_id = i.id
              AND (p_excluir_id IS NULL OR p.id <> p_excluir_id)
              AND (p.estado = 'prestado'
                   OR (p.estado = 'solicitado' AND p.fecha_prestamo = p_fecha))
         ), 0)
    FROM public.inventario_condominio i
   WHERE i.id = p_inventario_id
$$;
REVOKE EXECUTE ON FUNCTION public.prestamo_equipo_disponible(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.prestamo_equipo_disponible(uuid, date, uuid) TO service_role;
COMMENT ON FUNCTION public.prestamo_equipo_disponible(uuid, date, uuid) IS
  'Unidades de un equipo del inventario que se pueden prestar para una fecha: cantidad (0 si está de baja o en reparación) menos lo prestado (cualquier fecha) y lo solicitado para esa fecha. `p_excluir_id` deja fuera el préstamo que se está escribiendo.';

-- ── 4. Toda escritura de préstamo ligado al inventario pasa por aquí ────────
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

  -- Snapshot del inventario al vincular: nombre para la lista y costo para
  -- la reposición, aunque después cambien en el inventario.
  IF NEW.equipo_nombre IS NULL OR btrim(NEW.equipo_nombre) = '' THEN
    NEW.equipo_nombre := v_inv.nombre;
  END IF;
  IF NEW.costo_reposicion_unitario IS NULL THEN
    NEW.costo_reposicion_unitario := v_inv.costo_unitario;
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

DROP TRIGGER IF EXISTS trg_prestamo_valida_disponibilidad ON public.prestamos_equipo;
CREATE TRIGGER trg_prestamo_valida_disponibilidad
  BEFORE INSERT OR UPDATE ON public.prestamos_equipo
  FOR EACH ROW EXECUTE FUNCTION public.prestamo_valida_disponibilidad();

-- ── 5. Reserva cancelada ⇒ sus solicitudes de equipo no entregadas, también ─
-- SECURITY DEFINER: la cancelación la hace el residente (RPC) o un staff con
-- `amenidades.edit` que quizá no tiene `prestamos.edit`; la policy de UPDATE
-- de prestamos_equipo no debe decidir si la reserva se puede cancelar.
CREATE OR REPLACE FUNCTION public.reserva_cancelada_cancela_prestamos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.estado = 'cancelada' AND OLD.estado IS DISTINCT FROM 'cancelada' THEN
    UPDATE public.prestamos_equipo
       SET estado = 'cancelado',
           observaciones = concat_ws(' · ', observaciones, 'Reserva cancelada')
     WHERE reserva_id = NEW.id AND estado = 'solicitado';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserva_cancelada_cancela_prestamos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reserva_cancelada_cancela_prestamos ON public.reservas_amenidades;
CREATE TRIGGER trg_reserva_cancelada_cancela_prestamos
  AFTER UPDATE OF estado ON public.reservas_amenidades
  FOR EACH ROW EXECUTE FUNCTION public.reserva_cancelada_cancela_prestamos();

-- ── 6. Registrar la solicitud de equipo de una reserva (uso interno) ────────
-- Lo comparten el portal (dentro de portal_reservar_amenidad) y el panel
-- (reserva_equipos_solicitar). NO lo ejecuta ningún usuario: quien lo llama
-- ya autorizó. Valida que el equipo se preste con la amenidad y el tope por
-- reserva; la disponibilidad la impone el trigger al insertar.
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
  v_res    public.reservas_amenidades%ROWTYPE;
  v_eq     record;
  v_max    int;
  v_previo int;
  v_nombre text;
  v_costo  numeric(12,2);
  v_n      int := 0;
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
    SELECT ai.cantidad_max_por_reserva, inv.nombre, inv.costo_unitario
      INTO v_max, v_nombre, v_costo
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
    -- duplica (el trigger vuelve a validar la disponibilidad del total).
    UPDATE public.prestamos_equipo
       SET cantidad = cantidad + v_eq.cantidad,
           cantidad_solicitada = COALESCE(cantidad_solicitada, cantidad - v_eq.cantidad) + v_eq.cantidad
     WHERE reserva_id = v_res.id AND inventario_id = v_eq.inventario_id AND estado = 'solicitado';
    IF NOT FOUND THEN
      INSERT INTO public.prestamos_equipo
        (company_id, project_id, unidad_id, inventario_id, reserva_id,
         equipo_nombre, cantidad, cantidad_solicitada,
         fecha_prestamo, hora_prestamo, estado, costo_reposicion_unitario)
      VALUES
        (v_res.company_id, v_res.project_id, v_res.unidad_id, v_eq.inventario_id, v_res.id,
         v_nombre, v_eq.cantidad, v_eq.cantidad,
         v_res.fecha, v_res.hora_inicio, 'solicitado', v_costo);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.reserva_equipos_registrar_solicitud(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserva_equipos_registrar_solicitud(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.reserva_equipos_registrar_solicitud(uuid, jsonb) IS
  'Interno: crea (o acumula) las solicitudes de equipo de una reserva a partir de [{inventario_id, cantidad}]. Exige que el equipo esté enlazado a la amenidad y respeta el tope por reserva; la disponibilidad la impone el trigger de prestamos_equipo. No la ejecuta ningún usuario directo.';

-- ── 7. portal_reservar_amenidad: la reserva viaja con su equipo ─────────────
-- La firma cambia (gana `p_equipos jsonb DEFAULT NULL`), así que se retira la
-- de 20260822040000 para no dejar dos sobrecargas que PostgREST no sabría
-- elegir. El cuerpo es el de 20260822040000 línea a línea más el bloque de
-- equipo al final: si un equipo no alcanza, la reserva entera se revierte.
DROP FUNCTION IF EXISTS public.portal_reservar_amenidad(uuid,uuid,date,time,time,int,text,text,boolean);

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
  IF v_aplica THEN
    IF p_metodo_pago IS NULL OR p_metodo_pago NOT IN ('cargar_unidad', 'pagar_momento') THEN
      RAISE EXCEPTION 'Indica cómo pagarás la tarifa (cargar a la unidad o pagar al momento).';
    END IF;
  ELSE
    p_metodo_pago := NULL;  -- sin tarifa no se persiste método (paridad con el flujo actual)
  END IF;

  v_estado := CASE WHEN v_amen.requiere_aprobacion THEN 'pendiente' ELSE 'confirmada' END;

  -- Cuota + reserva EN LA MISMA transacción: cualquier RAISE posterior revierte
  -- la cuota (muere la compensación best-effort del navegador). Cuota SOLO si
  -- confirmada + tarifa + cargar_unidad; 'pendiente' nunca genera cuota — la
  -- crea el admin al aprobar (flujo existente de AmenidadesTab.aprobarReserva).
  IF v_estado = 'confirmada' AND v_aplica AND p_metodo_pago = 'cargar_unidad' THEN
    INSERT INTO public.cuotas_condominio
      (company_id, project_id, unidad_id, concepto, monto, periodo,
       fecha_vencimiento, estado, notas, created_by)
    VALUES
      (v_amen.company_id, v_amen.project_id, p_unidad_id, 'amenidad', v_tarifa,
       to_char(p_fecha, 'YYYY-MM'), p_fecha, 'pendiente',
       'Reserva ' || v_amen.nombre || ' ' || to_char(p_fecha, 'YYYY-MM-DD')
         || ' ' || left(p_hora_inicio::text, 5) || '-' || left(p_hora_fin::text, 5),
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

  RETURN to_jsonb(v_reserva) || jsonb_build_object('equipos_solicitados', v_equipos);
END;
$fn$;

REVOKE ALL ON FUNCTION public.portal_reservar_amenidad(uuid,uuid,date,time,time,int,text,text,boolean,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_reservar_amenidad(uuid,uuid,date,time,time,int,text,text,boolean,jsonb) TO authenticated;
COMMENT ON FUNCTION public.portal_reservar_amenidad(uuid,uuid,date,time,time,int,text,text,boolean,jsonb) IS
  'El residente (propietario o inquilino vía mis_unidades_ids) reserva una amenidad. Valida TODO server-side (reglas, bloqueos, conflicto global bajo FOR UPDATE de la amenidad) y calcula la tarifa en el servidor; si aplica cargar_unidad y la reserva queda confirmada, crea la cuota ''amenidad'' en la misma transacción. `p_equipos` = [{inventario_id, cantidad}] del equipo enlazado a la amenidad que el residente quiere que se le entregue: nace como préstamo ''solicitado'' en el mismo commit y se rechaza si no hay disponibilidad. Horas = reloj de pared America/Guatemala.';

-- ── 8. portal_equipos_amenidad: catálogo con disponibilidad para reservar ───
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
  'Equipo que se presta con una amenidad y cuántas unidades quedan para una fecha (hoy si no se indica): [{inventario_id, nombre, categoria, descripcion, unidad_medida, costo_reposicion, cantidad_max_por_reserva, notas, disponible}]. Residente de un proyecto de la amenidad o staff del tenant con el tab de amenidades; cualquier otro, rechazo explícito.';

-- ── 9. reserva_equipos_solicitar: el panel agrega equipo a una reserva ──────
CREATE OR REPLACE FUNCTION public.reserva_equipos_solicitar(
  p_reserva_id uuid,
  p_equipos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_res public.reservas_amenidades%ROWTYPE;
  v_n   int;
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
  v_n := public.reserva_equipos_registrar_solicitud(v_res.id, p_equipos);
  RETURN jsonb_build_object('reserva_id', v_res.id, 'equipos_solicitados', v_n);
END;
$fn$;
REVOKE ALL ON FUNCTION public.reserva_equipos_solicitar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_equipos_solicitar(uuid, jsonb) TO authenticated;
COMMENT ON FUNCTION public.reserva_equipos_solicitar(uuid, jsonb) IS
  'La administración agrega equipo ([{inventario_id, cantidad}]) a una reserva pendiente o confirmada sin check-out. Exige la empresa del tenant y la acción de amenidades (edit/create) o prestamos.create. Tope por reserva y disponibilidad se validan en la base.';

-- ── 10. Quién puede entregar o recibir un préstamo ──────────────────────────
-- Administra préstamos (`prestamos.edit`) o, si el préstamo cuelga de una
-- reserva, hace su check-in/check-out (`amenidades.edit`). SECURITY INVOKER:
-- sólo compone helpers que ya miran al llamante.
CREATE OR REPLACE FUNCTION public.prestamo_equipo_puede_gestionar(p public.prestamos_equipo)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- COALESCE(…, false): sin perfil el OR queda en NULL; cerrado por defecto.
  SELECT COALESCE(
    is_super_admin()
    OR ((p).company_id = get_my_company_id()
        AND (public.condominios_puede_actuar('prestamos', 'edit')
             OR ((p).reserva_id IS NOT NULL AND public.condominios_puede_actuar('amenidades', 'edit')))),
    false)
$$;
REVOKE EXECUTE ON FUNCTION public.prestamo_equipo_puede_gestionar(public.prestamos_equipo) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.prestamo_equipo_puede_gestionar(public.prestamos_equipo) TO authenticated, service_role;

-- ── 11. prestamos_equipo_entregar: constancia de lo que salió ───────────────
CREATE OR REPLACE FUNCTION public.prestamos_equipo_entregar(
  p_entregas jsonb,
  p_entregado_por text DEFAULT NULL,
  p_observaciones text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_e     record;
  v_p     public.prestamos_equipo%ROWTYPE;
  v_ahora timestamp := (now() AT TIME ZONE 'America/Guatemala');
  v_n     int := 0;
  v_canc  int := 0;
BEGIN
  IF p_entregas IS NULL OR jsonb_typeof(p_entregas) <> 'array' OR jsonb_array_length(p_entregas) = 0 THEN
    RAISE EXCEPTION 'Nada que entregar.';
  END IF;
  FOR v_e IN
    SELECT x.id, x.cantidad FROM jsonb_to_recordset(p_entregas) AS x(id uuid, cantidad int)
  LOOP
    SELECT * INTO v_p FROM public.prestamos_equipo WHERE id = v_e.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Préstamo no encontrado.';
    END IF;
    IF NOT public.prestamo_equipo_puede_gestionar(v_p) THEN
      RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
    END IF;
    IF v_p.estado <> 'solicitado' THEN
      RAISE EXCEPTION '"%" ya no está pendiente de entrega (%).', v_p.equipo_nombre, v_p.estado;
    END IF;
    -- Cantidad 0 = no se entregó: la solicitud se cierra sin préstamo.
    IF v_e.cantidad IS NOT NULL AND v_e.cantidad <= 0 THEN
      UPDATE public.prestamos_equipo
         SET estado = 'cancelado',
             observaciones = concat_ws(' · ', observaciones, 'No se entregó')
       WHERE id = v_p.id;
      v_canc := v_canc + 1;
      CONTINUE;
    END IF;
    -- El trigger vuelve a validar la disponibilidad con la cantidad final.
    UPDATE public.prestamos_equipo
       SET estado          = 'prestado',
           cantidad        = COALESCE(v_e.cantidad, cantidad),
           fecha_prestamo  = v_ahora::date,
           hora_prestamo   = v_ahora::time,
           entregado_por   = COALESCE(NULLIF(btrim(p_entregado_por), ''), entregado_por),
           observaciones   = COALESCE(NULLIF(btrim(p_observaciones), ''), observaciones)
     WHERE id = v_p.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('entregados', v_n, 'cancelados', v_canc);
END;
$fn$;
REVOKE ALL ON FUNCTION public.prestamos_equipo_entregar(jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prestamos_equipo_entregar(jsonb, text, text) TO authenticated;
COMMENT ON FUNCTION public.prestamos_equipo_entregar(jsonb, text, text) IS
  'Entrega préstamos ''solicitado'' ([{id, cantidad}]; cantidad NULL = la pedida, 0 = no se entregó y se cancela) en una transacción: estado ''prestado'', fecha y hora del servidor, quién entregó. Autoriza prestamos.edit o, si cuelga de una reserva, amenidades.edit.';

-- ── 12. prestamos_equipo_recibir: lo que volvió, lo que faltó y su costo ────
CREATE OR REPLACE FUNCTION public.prestamos_equipo_recibir(
  p_recepciones jsonb,
  p_recibido_por text DEFAULT NULL,
  p_generar_cargo boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_r        record;
  v_p        public.prestamos_equipo%ROWTYPE;
  v_ahora    timestamp := (now() AT TIME ZONE 'America/Guatemala');
  v_n        int := 0;
  v_dev      int;
  v_falt     int;
  v_estado   text;
  v_monto    numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_ids      uuid[] := '{}';
  v_detalle  text[] := '{}';
  v_unidad   uuid;
  v_company  uuid;
  v_project  uuid;
  v_mezcla   boolean := false;
  v_cuota_id uuid;
BEGIN
  IF p_recepciones IS NULL OR jsonb_typeof(p_recepciones) <> 'array' OR jsonb_array_length(p_recepciones) = 0 THEN
    RAISE EXCEPTION 'Nada que recibir.';
  END IF;
  FOR v_r IN
    SELECT x.id, x.cantidad_devuelta, x.estado, x.monto_reposicion, x.observaciones
      FROM jsonb_to_recordset(p_recepciones)
        AS x(id uuid, cantidad_devuelta int, estado text, monto_reposicion numeric, observaciones text)
  LOOP
    SELECT * INTO v_p FROM public.prestamos_equipo WHERE id = v_r.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Préstamo no encontrado.';
    END IF;
    IF NOT public.prestamo_equipo_puede_gestionar(v_p) THEN
      RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
    END IF;
    IF v_p.estado <> 'prestado' THEN
      RAISE EXCEPTION '"%" no está en préstamo (%).', v_p.equipo_nombre, v_p.estado;
    END IF;

    v_dev := COALESCE(v_r.cantidad_devuelta, v_p.cantidad);
    IF v_dev < 0 OR v_dev > v_p.cantidad THEN
      RAISE EXCEPTION 'La cantidad devuelta de "%" debe estar entre 0 y %.', v_p.equipo_nombre, v_p.cantidad;
    END IF;
    v_falt := v_p.cantidad - v_dev;
    v_estado := COALESCE(NULLIF(btrim(v_r.estado), ''), CASE WHEN v_falt > 0 THEN 'perdido' ELSE 'devuelto' END);
    IF v_estado NOT IN ('devuelto', 'dañado', 'perdido') THEN
      RAISE EXCEPTION 'Estado de recepción inválido: %.', v_estado;
    END IF;
    -- Reposición: lo que indique la administración o faltantes × costo congelado.
    v_monto := COALESCE(v_r.monto_reposicion, v_falt * COALESCE(v_p.costo_reposicion_unitario, 0));
    IF v_monto < 0 THEN
      RAISE EXCEPTION 'El monto de reposición no puede ser negativo.';
    END IF;
    IF v_monto = 0 THEN
      v_monto := NULL;
    END IF;

    UPDATE public.prestamos_equipo
       SET estado                   = v_estado,
           cantidad_devuelta        = v_dev,
           monto_reposicion         = v_monto,
           fecha_devolucion         = v_ahora::date,
           hora_devolucion          = v_ahora::time,
           recibido_por             = COALESCE(NULLIF(btrim(p_recibido_por), ''), recibido_por),
           observaciones_devolucion = NULLIF(btrim(v_r.observaciones), '')
     WHERE id = v_p.id;
    v_n := v_n + 1;

    IF v_monto IS NOT NULL THEN
      v_total   := v_total + v_monto;
      v_ids     := v_ids || v_p.id;
      v_detalle := v_detalle || (v_p.equipo_nombre
                    || CASE WHEN v_falt > 0 THEN ' ×' || v_falt::text ELSE '' END
                    || ' (' || v_estado || ')');
      IF v_unidad IS NULL AND NOT v_mezcla THEN
        v_unidad := v_p.unidad_id; v_company := v_p.company_id; v_project := v_p.project_id;
      ELSIF v_unidad IS DISTINCT FROM v_p.unidad_id THEN
        v_mezcla := true;
      END IF;
    END IF;
  END LOOP;

  -- Un solo cargo a la unidad por el total de lo que faltó o se dañó.
  IF p_generar_cargo AND v_total > 0 THEN
    IF v_unidad IS NULL THEN
      RAISE EXCEPTION 'El préstamo no tiene unidad: no se puede generar el cargo.';
    END IF;
    IF v_mezcla THEN
      RAISE EXCEPTION 'Los préstamos son de unidades distintas: recíbelos por separado para cargar a cada una.';
    END IF;
    INSERT INTO public.cuotas_condominio
      (company_id, project_id, unidad_id, concepto, monto, periodo,
       fecha_vencimiento, estado, notas, created_by)
    VALUES
      (v_company, v_project, v_unidad, 'amenidad', v_total,
       to_char(v_ahora::date, 'YYYY-MM'), v_ahora::date, 'pendiente',
       left('Reposición de equipo prestado: ' || array_to_string(v_detalle, ', '), 500),
       auth.uid())
    RETURNING id INTO v_cuota_id;
    UPDATE public.prestamos_equipo SET cuota_reposicion_id = v_cuota_id WHERE id = ANY(v_ids);
  END IF;

  RETURN jsonb_build_object('recibidos', v_n, 'monto_reposicion', v_total, 'cuota_id', v_cuota_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.prestamos_equipo_recibir(jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prestamos_equipo_recibir(jsonb, text, boolean) TO authenticated;
COMMENT ON FUNCTION public.prestamos_equipo_recibir(jsonb, text, boolean) IS
  'Recibe préstamos ''prestado'' ([{id, cantidad_devuelta, estado?, monto_reposicion?, observaciones?}]) en una transacción: cierra en devuelto/dañado/perdido, sella fecha, hora y quién recibió, y calcula la reposición (faltantes × costo congelado, o el monto indicado). Con p_generar_cargo crea UNA cuota ''amenidad'' a la unidad por el total y la liga a cada préstamo. Autoriza prestamos.edit o, si cuelga de una reserva, amenidades.edit.';
