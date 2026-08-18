-- Portal: el PROPIETARIO da de baja su autorización de renta (o retira una
-- solicitud pendiente).
--
-- Hasta ahora la autorización de renta solo la resolvía la administración
-- (aprobada/rechazada) y no había forma de que el propietario retirara su
-- unidad del arrendamiento. Reglas de producto (confirmadas):
--   • Con solicitud PENDIENTE: "Retirar solicitud".
--   • Con autorización APROBADA: "Dar de baja la autorización".
--   • Si hay inquilino activo, la baja revoca EN CASCADA su acceso y el de su
--     núcleo familiar (mismo criterio que portal_quitar_inquilino,
--     20260825000000). Las cuentas no se eliminan.
--
-- Mecánica del nuevo estado 'baja':
--   • El índice único idx_solicitud_renta_unidad_activa (20260513000001) solo
--     cuenta pendiente|aprobada → la unidad queda libre para solicitar de nuevo.
--   • La RLS de reservas_str/contratos_arrendamiento (20260514000006) exige
--     estado='aprobada' → el acceso del portal a rentas se cierra solo.
--   • El CHECK de estado era inline en 20260513000001; se recrea incluyendo
--     'baja'. El DO-block dropea el constraint por DEFINICIÓN (no por nombre)
--     por si el autogenerado difiere en prod.

-- ── 1) Estado 'baja' en el CHECK ─────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'solicitud_renta_unidad'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%estado%'
  LOOP
    EXECUTE format('ALTER TABLE public.solicitud_renta_unidad DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.solicitud_renta_unidad
  ADD CONSTRAINT solicitud_renta_unidad_estado_check
  CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'baja'));

-- ── 2) portal_baja_renta ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_baja_renta(p_unidad_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_sol        public.solicitud_renta_unidad%ROWTYPE;
  v_inquilino  uuid;
  v_familiares int := 0;
  v_inq_rev    boolean := false;
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo el propietario puede dar de baja la autorización desde el portal.';
  END IF;
  IF p_unidad_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_propietario_ids() x WHERE x = p_unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: la unidad no le pertenece.';
  END IF;

  -- La solicitud VIVA de la unidad (el índice único garantiza a lo sumo una).
  -- FOR UPDATE: dos bajas concurrentes (o baja vs resolución del admin)
  -- serializan aquí.
  SELECT * INTO v_sol
    FROM public.solicitud_renta_unidad
   WHERE unidad_id = p_unidad_id AND estado IN ('pendiente', 'aprobada')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La unidad no tiene solicitud ni autorización de renta vigente.';
  END IF;

  UPDATE public.solicitud_renta_unidad
     SET estado = 'baja', fecha_resolucion = now()
   WHERE id = v_sol.id;

  -- Cascada: sin autorización no hay inquilino. Se revoca el arrendatario
  -- activo y los familiares de SU núcleo (la familia del propietario y las
  -- filas legacy con núcleo NULL no se tocan). Cuentas intactas.
  SELECT ur.cliente_id INTO v_inquilino
    FROM public.unidad_residentes ur
   WHERE ur.unidad_id = p_unidad_id AND ur.tipo = 'arrendatario' AND ur.activo = true
   LIMIT 1;
  IF FOUND THEN
    DELETE FROM public.unidad_residentes
    WHERE unidad_id = p_unidad_id AND tipo = 'familiar' AND nucleo_cliente_id = v_inquilino;
    GET DIAGNOSTICS v_familiares = ROW_COUNT;

    DELETE FROM public.unidad_residentes
    WHERE unidad_id = p_unidad_id AND cliente_id = v_inquilino AND tipo = 'arrendatario';
    v_inq_rev := true;
  END IF;

  RETURN jsonb_build_object(
    'estado_anterior', v_sol.estado,
    'inquilino_revocado', v_inq_rev,
    'familiares_revocados', v_familiares
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.portal_baja_renta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_baja_renta(uuid) TO authenticated;
COMMENT ON FUNCTION public.portal_baja_renta(uuid) IS
  'El propietario retira su solicitud de renta pendiente o da de baja la autorización aprobada de su unidad (estado=baja). Con inquilino activo, revoca en cascada su acceso y el de su núcleo familiar. Devuelve {estado_anterior, inquilino_revocado, familiares_revocados}.';
