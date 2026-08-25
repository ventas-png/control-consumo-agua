-- HALLAZGO DE SEGURIDAD: el portal podía AUTOAPROBARSE una solicitud de renta.
--
-- La policy vigente `solicitud_renta_unidad_insert` (20260713100000:95) trae la
-- rama:
--     current_user_role() = 'cliente' AND cliente_id = get_my_cliente_id()
-- SIN restricción de estado. Un residente con el anon key puede insertar
-- directamente una fila con estado='aprobada' y tipo_aprobado='ambas' — y con
-- eso las policies de 20260514000006 le abren `contratos_arrendamiento` y
-- `reservas_str` de su unidad. La segunda rama del mismo policy sí exigía
-- estado='pendiente', pero solo aplica cuando cliente_id NO es el suyo, así que
-- nunca actúa como freno.
--
-- 20260828000000 intentó endurecer esto recreando `solicitud_renta_cliente_insert`
-- con `contrato_id IS NULL`. No sirvió: esa policy la habían dejado sin efecto
-- 20260519000003 y 20260713100000, y las policies permisivas se combinan con
-- **OR** — agregar una más estricta no quita lo que la laxa ya concede.
--
-- ARREGLO: el portal deja de escribir la tabla. Todas sus escrituras pasan por
-- los RPC SECURITY DEFINER de 20260829000200, que validan propiedad de la
-- unidad, completitud y estado. Las ramas de cliente salen de insert y update;
-- el staff queda exactamente como estaba (gate RBAC por permiso del tab).
--
-- El SELECT del cliente sí se AMPLÍA: hoy solo matchea `unidades.cliente_id`
-- legacy, así que el propietario del modelo dual (unidad_residentes, fase 3)
-- no veía su propia solicitud. Se agrega la rama por mis_unidades_propietario_ids().
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS + CREATE.
-- REVERSA: recrear las policies de 20260713100000 (y la de 20260828000000).

-- La policy inefectiva de 20260828000000: se retira para no dejar rastro de un
-- endurecimiento que no endurece.
DROP POLICY IF EXISTS "solicitud_renta_cliente_insert" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_cliente_select" ON public.solicitud_renta_unidad;

-- ── INSERT: solo staff con el permiso del tab ────────────────────────────────
DROP POLICY IF EXISTS "solicitud_renta_unidad_insert" ON public.solicitud_renta_unidad;
CREATE POLICY "solicitud_renta_unidad_insert" ON public.solicitud_renta_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_renta')
    )
  );

-- ── UPDATE: idéntico al de 20260713100000 (ya era solo staff) ────────────────
-- Se recrea para que la definición vigente quede en esta migración, junto al
-- resto del modelo.
DROP POLICY IF EXISTS "solicitud_renta_unidad_update" ON public.solicitud_renta_unidad;
CREATE POLICY "solicitud_renta_unidad_update" ON public.solicitud_renta_unidad
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_renta')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_renta')
    )
  );

-- ── SELECT: staff igual, cliente repuntado al modelo dual ────────────────────
DROP POLICY IF EXISTS "solicitud_renta_unidad_select" ON public.solicitud_renta_unidad;
CREATE POLICY "solicitud_renta_unidad_select" ON public.solicitud_renta_unidad
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_renta')
    )
    OR (
      public.current_user_role() = 'cliente'
      AND (
        cliente_id = public.get_my_cliente_id()
        OR unidad_id IN (SELECT public.mis_unidades_propietario_ids())
      )
    )
  );
