-- ─── Contabilidad: la escritura pasa a depender del permiso RBAC ─────────────
-- Síntoma: un usuario con el rol "Finanzas / Contador" y platform.contabilidad.*
-- otorgado veía "Contabilidad" en el sidebar (que evalúa el permiso) pero al
-- entrar recibía "Acceso Denegado", y aun quitando ese guard de la UI la BD lo
-- habría dejado en solo-lectura: TODAS las policies de escritura y los guards de
-- las RPCs de contabilidad exigen literalmente
--   current_user_role() = ANY(ARRAY['company_owner','admin'])
-- e ignoran el catálogo RBAC (migraciones 20260611*).
--
-- Esta migración es ADITIVA: conserva intacto el acceso por rol legacy y le
-- suma la rama por permiso. Nadie que hoy pueda escribir deja de poder.
--
-- Nota de rendimiento: user_has_permission() es STABLE y SECURITY DEFINER; se
-- envuelve en (SELECT …) para que el planner la evalúe una vez por sentencia
-- (InitPlan) en lugar de una vez por fila, y se coloca DESPUÉS del chequeo de
-- rol para que los admins ni la ejecuten.

-- ── 1. Helper de autorización de escritura ──────────────────────────────────
-- Encapsula la regla en un solo lugar: super admin, rol legacy con acceso
-- total, o permiso RBAC de la acción pedida sobre el módulo Contabilidad.
-- user_has_permission ya devuelve true para super_admin/company_owner/admin,
-- pero el chequeo de rol se mantiene explícito para no depender de eso.
CREATE OR REPLACE FUNCTION public.conta_puede_escribir(p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
      OR public.current_user_role() = ANY(ARRAY['company_owner','admin'])
      OR public.user_has_permission('platform.contabilidad.' || p_action)
$$;

COMMENT ON FUNCTION public.conta_puede_escribir(text) IS
  'Autorización de escritura del módulo Contabilidad: rol legacy con acceso total o permiso RBAC platform.contabilidad.<accion>.';

GRANT EXECUTE ON FUNCTION public.conta_puede_escribir(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_puede_escribir(text) FROM anon;

-- ── 2. Policies de escritura de las tablas del módulo ───────────────────────
-- El SELECT no se toca: ya era "cualquiera de la empresa" y sigue igual.
-- conta_folios y conta_cierres_anuales tampoco: son deny-all para el cliente
-- (solo los escriben las funciones SECURITY DEFINER).
DO $$
DECLARE
  -- tabla, roles legacy que podían INSERTAR (update/delete siempre fueron
  -- company_owner/admin). facturas_proveedor y ordenes_pago admitían además
  -- 'operator': "solicita el operador, aprueba el admin".
  specs text[][] := ARRAY[
    ['conta_cuentas',        'company_owner,admin'],
    ['conta_asientos',       'company_owner,admin'],
    ['conta_asiento_lineas', 'company_owner,admin'],
    ['conta_tipos_cambio',   'company_owner,admin'],
    ['conta_mapeo_cuentas',  'company_owner,admin'],
    ['proveedores',          'company_owner,admin'],
    ['facturas_proveedor',   'company_owner,admin,operator'],
    ['ordenes_pago',         'company_owner,admin,operator'],
    ['presupuestos',         'company_owner,admin'],
    ['presupuesto_partidas', 'company_owner,admin'],
    ['cuentas_bancarias',    'company_owner,admin'],
    ['banco_movimientos',    'company_owner,admin']
  ];
  t            text;
  insert_roles text;
  ins_expr     text;
  upd_expr     text;
  del_expr     text;
  i            int;
BEGIN
  FOR i IN 1..array_length(specs, 1) LOOP
    t            := specs[i][1];
    insert_roles := specs[i][2];

    -- La rama de rol legacy va primero: un admin corta el OR sin tocar RBAC.
    ins_expr := format(
      $e$is_super_admin() OR (company_id = get_my_company_id() AND (
           current_user_role() = ANY(string_to_array(%L, ','))
           OR (SELECT public.user_has_permission('platform.contabilidad.create'))))$e$,
      insert_roles);
    upd_expr := $e$is_super_admin() OR (company_id = get_my_company_id() AND (
           current_user_role() = ANY(ARRAY['company_owner','admin'])
           OR (SELECT public.user_has_permission('platform.contabilidad.edit'))))$e$;
    del_expr := $e$is_super_admin() OR (company_id = get_my_company_id() AND (
           current_user_role() = ANY(ARRAY['company_owner','admin'])
           OR (SELECT public.user_has_permission('platform.contabilidad.delete'))))$e$;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
                   t || '_insert', t, ins_expr);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                   t || '_update', t, upd_expr, upd_expr);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
                   t || '_delete', t, del_expr);
  END LOOP;
END $$;

-- ── 3. Guards de las RPCs SECURITY DEFINER ──────────────────────────────────
-- Las RPCs llevan el mismo chequeo de rol embebido en el cuerpo. En vez de
-- recopiar cientos de líneas —que revertiría en silencio los arreglos
-- posteriores— se reescribe la definición VIGENTE sustituyendo solo esa
-- subexpresión.
--
-- Las funciones se descubren por nombre en pg_proc en lugar de fijar firmas:
-- el trabajo de ledger las re-firmó varias veces (conta_revaluar_fx pasó a
-- (date,boolean,uuid) y la vieja (date,boolean) fue DROPeada; conta_cierre_anual
-- quedó con dos overloads y el guard vive en (int,uuid), no en el wrapper
-- (int)). Descubrir por nombre cubre todos los overloads que hoy lleven el
-- guard, sin depender de firmas que vuelvan a cambiar.
DO $$
DECLARE
  -- función → acción RBAC que debe exigir
  acciones jsonb := jsonb_build_object(
    'conta_publicar_asiento',        'change_status',
    'conta_anular_asiento',          'change_status',
    'conta_cierre_anual',            'change_status',
    'conta_revaluar_fx',             'create',
    'banco_conciliar_movimiento',    'change_status',
    'banco_desconciliar_movimiento', 'change_status',
    'banco_ajuste_conciliacion',     'create'
  );
  patron constant text :=
    'public\.current_user_role\(\)\s*=\s*ANY\(ARRAY\[''company_owner'',''admin''\]\)';
  r      record;
  faltan text[];
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS ident, acciones ->> p.proname AS accion
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND acciones ? p.proname
      AND p.prosrc ~ patron
    ORDER BY p.proname
  LOOP
    EXECUTE regexp_replace(
      pg_get_functiondef(r.oid),
      patron,
      '(public.current_user_role() = ANY(ARRAY[''company_owner'',''admin''])'
        || ' OR public.user_has_permission(''platform.contabilidad.' || r.accion || '''))',
      'g');
    RAISE NOTICE 'conta rbac: guard actualizado en % (platform.contabilidad.%)', r.ident, r.accion;
  END LOOP;

  -- Red de seguridad: toda función listada debe haber quedado con la rama por
  -- permiso. Si alguna no la tiene, su guard cambió de forma (o la función ya
  -- no existe) y la migración falla en vez de dejar el guard viejo en pie.
  SELECT array_agg(k ORDER BY k) INTO faltan
  FROM jsonb_object_keys(acciones) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = k
      AND p.prosrc LIKE '%platform.contabilidad.%'
  );
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'conta rbac: sin actualizar % — el guard cambió de forma, revisar a mano', faltan;
  END IF;
END $$;

-- ── 4. El rol plantilla "Finanzas / Contador" recibe el módulo ──────────────
-- Se sembró en 20260518000006 con claves condominios.tab.* únicamente, y cuando
-- 20260703000000 creó platform.contabilidad.* solo re-otorgó platform.* al rol
-- "Admin Plataforma". Un rol descrito como "Sección Finanzas completa" tiene que
-- traer Contabilidad de fábrica; cada empresa puede revocar acciones concretas
-- desde el editor de roles.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT '00000000-0000-0000-0000-000000000003'::uuid, p.key, 'allow'
FROM public.permissions p
WHERE p.key LIKE 'platform.contabilidad.%'
ON CONFLICT DO NOTHING;
