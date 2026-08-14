-- Portal propietario vs inquilino — ESCRITURAS del residente al modelo dual.
--
-- La fase 2 (20260713000000..040000) centralizó en mis_unidades_ids() las policies
-- de SELECT del residente, y con la fase 3 el helper se volvió dual (propietario ∪
-- unidad_residentes). Las de ESCRITURA quedaron fuera de aquel alcance y siguen en
-- el patrón legacy `unidades.cliente_id = mi cliente`: el QA del primer inquilino
-- real (20260822000000) lo hizo visible — ve todo el portal pero cada creación
-- revienta con "new row violates row-level security policy" (reservas_amenidades).
--
-- Se repuntan al helper las escrituras que el portal del residente ejecuta:
--   • reservas_amenidades INSERT (reservar) y UPDATE (cancelar — la policy vigente
--     del MVP era company-wide, un cliente ni siquiera cumplía USING: la
--     cancelación desde el portal afectaba 0 filas en silencio).
--   • tickets_mantenimiento INSERT (reportar mantenimiento).
--   • visitantes INSERT (pre-registrar visitantes).
--   • mensajes_portal INSERT (mensajes a la administración).
--   • RPCs de paquetería paquete_firmar_recepcion / paquete_autorizar_salida
--     (su guard interno comparaba unidades.cliente_id; ahora usa el helper).
--
-- Mismo criterio que la fase 2: solo cambia la RAMA RESIDENTE (subquery inline →
-- helper); is_super_admin() y las ramas de staff quedan idénticas. Para el
-- propietario legacy la conducta es EXACTAMENTE la de hoy (el helper lo incluye
-- por unidades.cliente_id); lo nuevo es que el residente de unidad_residentes
-- (inquilino/familiar) queda cubierto — que es como ya se comporta el SELECT.
--
-- FUERA DE ALCANCE (pre-existente, también roto para el PROPIETARIO): la reserva
-- de amenidades CON tarifa "cargar a la unidad" inserta además una fila en
-- cuotas_condominio, cuyas policies INSERT/UPDATE son staff-only desde
-- 20260518000009 — dar a un residente escritura directa sobre una tabla de dinero
-- exige una RPC atómica aparte (reservar+cargar), no un ensanche de policy.

-- ── reservas_amenidades ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "reservas_amenidades_insert" ON public.reservas_amenidades;
CREATE POLICY "reservas_amenidades_insert" ON public.reservas_amenidades
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.amenidades'))
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

-- UPDATE: la rama staff conserva el alcance del MVP (company-wide, sin gate de
-- permiso) para no romper flujos de operadores existentes; solo se AGREGA la
-- rama residente.
DROP POLICY IF EXISTS "reservas_amenidades_update" ON public.reservas_amenidades;
CREATE POLICY "reservas_amenidades_update" ON public.reservas_amenidades
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id())
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  )
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id())
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

-- ── tickets_mantenimiento ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tickets_mantenimiento_insert" ON public.tickets_mantenimiento;
CREATE POLICY "tickets_mantenimiento_insert" ON public.tickets_mantenimiento
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.mantenimiento'))
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

-- ── visitantes ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "visitantes_insert" ON public.visitantes;
CREATE POLICY "visitantes_insert" ON public.visitantes
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.visitantes'))
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

-- ── mensajes_portal ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "mensajes_portal_insert" ON public.mensajes_portal;
CREATE POLICY "mensajes_portal_insert" ON public.mensajes_portal
  FOR INSERT TO authenticated
  WITH CHECK (
    unidad_id IN (SELECT public.mis_unidades_ids())
  );

-- ── paquete_firmar_recepcion: guard interno al helper dual ───────────────────
-- Cuerpo idéntico a 20260523000003 salvo la condición de identidad.
CREATE OR REPLACE FUNCTION public.paquete_firmar_recepcion(
  p_paquete_id uuid,
  p_firma_path text,
  p_nombre     text
) RETURNS public.paquetes_recibidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.paquetes_recibidos;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.paquetes_recibidos p
    WHERE p.id = p_paquete_id
      AND p.estado = 'pendiente'
      -- Residente activo de la unidad (propietario legacy ∪ unidad_residentes);
      -- el helper ya filtra unidades.activo y membresías activas.
      AND p.unidad_id IN (SELECT public.mis_unidades_ids())
  ) THEN
    RAISE EXCEPTION 'No autorizado o paquete no disponible';
  END IF;

  UPDATE public.paquetes_recibidos
     SET estado             = 'entregado',
         firma_path         = p_firma_path,
         entregado_a_nombre = COALESCE(NULLIF(btrim(p_nombre), ''), entregado_a_nombre),
         entregado_via      = 'portal',
         hora_entrega       = now()
   WHERE id = p_paquete_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.paquete_firmar_recepcion(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paquete_firmar_recepcion(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.paquete_firmar_recepcion(uuid, text, text) TO authenticated;

-- ── paquete_autorizar_salida: guard interno al helper dual ───────────────────
-- Cuerpo idéntico a 20260724000000 (CSPRNG con schema calificado) salvo la
-- condición de identidad de la unidad.
CREATE OR REPLACE FUNCTION public.paquete_autorizar_salida(
  p_unidad_id            uuid,
  p_tipo                 text,
  p_descripcion          text,
  p_autorizado_nombre    text,
  p_autorizado_documento text DEFAULT NULL,
  p_autorizado_telefono  text DEFAULT NULL,
  p_fotos                text[] DEFAULT NULL,
  p_notas                text DEFAULT NULL
) RETURNS public.paquetes_recibidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unidad   public.unidades;
  v_row      public.paquetes_recibidos;
  v_codigo   text;
  v_alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- espejo de lib/tokens
BEGIN
  SELECT * INTO v_unidad
    FROM public.unidades
   WHERE id = p_unidad_id
     AND activo = true
     AND id IN (SELECT public.mis_unidades_ids());
  IF v_unidad.id IS NULL THEN
    RAISE EXCEPTION 'No autorizado para esta unidad';
  END IF;
  IF coalesce(btrim(p_descripcion), '') = '' THEN
    RAISE EXCEPTION 'La descripción es obligatoria';
  END IF;
  IF coalesce(btrim(p_autorizado_nombre), '') = '' THEN
    RAISE EXCEPTION 'Debe indicar a quién autoriza el retiro';
  END IF;

  -- B5: CSPRNG (pgcrypto) + alfabeto no ambiguo, 8 chars ≈ 40 bits.
  -- pgcrypto vive en `extensions` (ver 20260318000001): calificar el schema es
  -- obligatorio con `search_path = public`.
  SELECT string_agg(
           substr(v_alfabeto, (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alfabeto)) + 1, 1),
           ''
         )
    INTO v_codigo
    FROM generate_series(1, 8);

  INSERT INTO public.paquetes_recibidos (
    company_id, project_id, unidad_id, direccion, tipo, descripcion,
    autorizado_nombre, autorizado_documento, autorizado_telefono,
    fotos, notas, estado, codigo_retiro
  ) VALUES (
    v_unidad.company_id, v_unidad.project_id, v_unidad.id, 'saliente_tercero',
    coalesce(nullif(btrim(p_tipo), ''), 'paquete'), btrim(p_descripcion),
    btrim(p_autorizado_nombre), nullif(btrim(p_autorizado_documento), ''), nullif(btrim(p_autorizado_telefono), ''),
    p_fotos, nullif(btrim(p_notas), ''), 'pendiente', v_codigo
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.paquete_autorizar_salida(uuid,text,text,text,text,text,text[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paquete_autorizar_salida(uuid,text,text,text,text,text,text[],text) FROM anon;
GRANT EXECUTE ON FUNCTION public.paquete_autorizar_salida(uuid,text,text,text,text,text,text[],text) TO authenticated;

COMMENT ON FUNCTION public.paquete_autorizar_salida(uuid,text,text,text,text,text,text[],text) IS
  'El residente (propietario o inquilino vía unidad_residentes) autoriza la salida de un paquete para retiro por un tercero; código con CSPRNG (extensions.gen_random_bytes) sobre alfabeto no ambiguo.';
