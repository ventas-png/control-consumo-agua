-- ════════════════════════════════════════════════════════════════════════════
-- PURGA DE EMPRESA ATÓMICA: `purgar_empresa` (edge `delete-company`)
--
-- QUÉ FALLABA
-- El edge `delete-company` escribía en la base pieza por pieza, cada una en su
-- propia transacción: desligaba a los superadministradores, borraba UNA A UNA a
-- todas las personas de la empresa (también al `company_owner`, también en
-- `auth`), insertaba la fila `DELETE` en `audit_log` y, AL FINAL, borraba
-- `companies`. Si ese último `DELETE` fallaba, la empresa quedaba viva y sin
-- ninguna persona, y la auditoría decía que se había borrado. Y fallaba seguro:
--
--   · Toda empresa que haya usado Contabilidad tiene cuentas `es_sistema` en
--     `conta_cuentas`, y `conta_cuenta_proteger_borrado` las defiende contra el
--     borrado salvo con `conta.allow_system_write` encendido. Medido el
--     2026-10-12 en producción (solo SELECT): la ÚNICA empresa hoy elegible para
--     purga tiene 49. La cascada desde `companies` reventaba ahí.
--   · Seis llaves foráneas hacia `companies(id)` y dos hacia `projects(id)` no
--     tienen `ON DELETE` (NO ACTION) en producción —ver
--     docs/PURGA_EMPRESA.md—; el repositorio declara además
--     otras siete (tres y cuatro). Una fila en cualquiera de esas tablas
--     bloquea el `DELETE`, y
--     NO ACTION se comprueba al final de la sentencia, ANTES de que la cascada
--     por otra ruta (p. ej. vía `projects`) haya llegado a borrarla.
--   · Los errores del INSERT de auditoría y del UPDATE que desligaba al
--     superadministrador se ignoraban.
--
-- QUÉ HACE `purgar_empresa(empresa, actor, nombre, días de gracia, suscripción, ensayo)`
-- Todas las escrituras de base de datos de la purga, en UNA transacción. Si
-- cualquier paso falla —una compuerta, una llave foránea, un guard de
-- inmutabilidad, el INSERT de auditoría— se revierte TODO: la empresa, sus
-- personas, sus datos y la auditoría quedan exactamente como estaban.
--   1. Compuertas, en el MISMO orden que `checkPurgeGates` del edge, con la
--      empresa bloqueada (FOR UPDATE): el actor es superadministrador; el
--      nombre de confirmación coincide EXACTO; la empresa está suspendida; la
--      suspensión cumple los días de gracia; el actor no pertenece a la
--      empresa. El edge ya las comprobó antes de cancelar Stripe; aquí se
--      repiten porque la base es la que decide y porque entre las dos
--      lecturas alguien pudo reactivar la empresa.
--   2. Superadministradores colgados de la empresa (o de uno de sus
--      proyectos): se DESLIGAN (`company_id = NULL, project_id = NULL`), no se
--      borran. Cualquier otra cuenta que conserve un `project_id` de la
--      empresa lo pierde (`app_users` no tiene FK que lo haga).
--   3. Personas de la empresa (todo `app_users` con su `company_id` que no sea
--      superadministrador, `company_owner` incluido) y CUENTAS CLIENTE
--      exclusivas de la empresa (ver más abajo): se borran de `app_users`.
--      Sus identidades en `auth.users` las borra el edge DESPUÉS del COMMIT
--      con `auth.admin.deleteUser`: la función las devuelve en
--      `usuarios_auth`, y la misma lista queda en la auditoría.
--   4. Fila `DELETE` en `audit_log` con la fila completa de la empresa, los
--      conteos y los parámetros de la purga.
--   5. Datos: primero las filas de las tablas cuya FK hacia `companies` o
--      `projects` es NO ACTION/RESTRICT (`purgar_empresa_bloqueantes`, que
--      lee las FK del catálogo: funciona igual con la forma del repositorio y
--      con la de producción, que difieren); después `projects` y por último
--      `companies`, que arrastran el resto por sus `ON DELETE CASCADE`.
--   6. Clientes exclusivos de la empresa (ver más abajo).
--
-- ENSAYO (`p_ensayo => true`): hace TODO lo anterior y al final lanza
-- `PURGA_ENSAYO_OK`, que revierte la transacción entera. El edge lo usa antes
-- de cancelar la suscripción de Stripe: si la purga no va a poder completarse
-- (un guard de inmutabilidad, una FK), se entera sin haber tocado Stripe. Una
-- excepción es la única forma de deshacer desde dentro de una función.
--
-- CUENTAS CLIENTE (decisión, documentada en docs/PURGA_EMPRESA.md)
-- Un cliente (`clientes`) puede estar vinculado a VARIAS empresas
-- (`company_clientes`, «visibilidad entre empresas»), y su cuenta de portal
-- (`app_users` con `role = 'cliente'`, `company_id` siempre NULL) apunta a él
-- por `cliente_id`. Se considera EXCLUSIVO de la empresa purgada el cliente
-- cuyo proyecto (si tiene) es de la empresa y que no está vinculado a ninguna
-- otra. Para esos:
--   · su cuenta de portal se borra (app_users aquí, auth en el edge): no le
--     queda ninguna empresa que ver, y conservar la identidad sería conservar
--     datos personales de un inquilino purgado;
--   · su fila de `clientes` se borra (la FK `clientes.project_id` es SET NULL:
--     sin esto sobrevivía huérfana, con nombre, correo y documento, para
--     siempre y sin dueño). Arrastra lo que cuelga de ella por CASCADE.
-- Un cliente vinculado TAMBIÉN a otra empresa se conserva con su cuenta: sólo
-- pierde el vínculo con la purgada (`company_clientes` cae en cascada y
-- `clientes.project_id` queda NULL por su FK).
--
-- LO QUE SIGUE BLOQUEANDO, A PROPÓSITO (fail-closed, no se rodea)
-- `conta.allow_system_write` se enciende SÓLO dentro de esta transacción: es el
-- mecanismo que el esquema reserva a las funciones SECURITY DEFINER para las
-- escrituras de sistema (cuentas de catálogo, asientos, presupuestos, contratos).
-- Los guards que NO tienen ese escape —bitácoras inmutables
-- (`conta_tg_bitacora_inmutable`: pasarela_eventos, conta_notas_credito…),
-- aplicaciones de saldo a favor, anticipos, turnos iniciados, recepciones fuera
-- de borrador, reglas vigentes— siguen abortando la purga con su mensaje. Que una
-- empresa con historia financiera inmutable se pueda purgar o no es una
-- decisión de negocio que esta migración no toma.
--
-- PERMISOS: sólo `service_role` (el edge). Ni anon ni authenticated.
--
-- PRUEBAS: supabase/tests/purgar_empresa/run.sh, contra un Postgres real y con
-- la forma de llaves del repositorio Y la de producción. Los comentarios
-- `[compuerta:…]` / `[paso:…]` del cuerpo delimitan los bloques que ese runner
-- quita uno por uno (mutantes): la suite tiene que fallar sin cada uno.
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.purgar_empresa(uuid, uuid, text, integer, text, boolean);
--   DROP FUNCTION public.purgar_empresa_bloqueantes(uuid, uuid[]);
--   (el edge anterior no funcionaba: ver supabase/functions/delete-company).
-- IMPACTO EN DATOS: ninguno al aplicar. Sólo dos funciones nuevas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Filas que bloquean el DELETE de projects/companies ─────────────────────
-- Borra, para la empresa y sus proyectos, las filas de toda tabla de `public`
-- cuya FK de una columna hacia `companies(id)` o `projects(id)` sea NO ACTION
-- o RESTRICT. Se leen del catálogo y no de una lista escrita a mano porque el
-- repositorio y producción NO tienen las mismas (medido: 5 difieren y 3 sólo
-- existen en el repositorio), y una lista fija se queda atrás el día que
-- alguien añade una tabla.
--
-- ORDEN: el que la base acepte. Una tabla puede no poder vaciarse todavía
-- porque otra fila la referencia con RESTRICT; ese intento va en su propio
-- subbloque, se deshace sólo él (23503) y se reintenta en la pasada siguiente.
-- Lo que no se pueda borrar aquí se deja: lo resuelven las cascadas del DELETE
-- de projects/companies o, si tampoco, ese DELETE falla y la purga entera se
-- revierte. CUALQUIER otro error (un guard de inmutabilidad, por ejemplo) se
-- propaga de inmediato.
CREATE OR REPLACE FUNCTION public.purgar_empresa_bloqueantes(p_company_id uuid, p_proyectos uuid[])
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_fk        record;
  v_ids       uuid[];
  v_hay       boolean;
  v_filas     bigint;
  v_total     integer := 0;
  v_pasada    integer := 0;
  v_avance    boolean;
  v_pendiente boolean;
BEGIN
  LOOP
    v_pasada    := v_pasada + 1;
    v_avance    := false;
    v_pendiente := false;

    FOR v_fk IN
      SELECT k.conrelid::regclass AS tabla,
             a.attname            AS columna,
             (k.confrelid = 'public.companies'::regclass) AS hacia_empresa
        FROM pg_catalog.pg_constraint k
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
       WHERE k.contype = 'f'
         AND k.confdeltype IN ('a', 'r')
         AND k.confrelid IN ('public.companies'::regclass, 'public.projects'::regclass)
         AND cardinality(k.conkey) = 1
         AND k.connamespace = 'public'::regnamespace
       ORDER BY k.conrelid::regclass::text COLLATE "C", a.attname COLLATE "C"
    LOOP
      v_ids := CASE WHEN v_fk.hacia_empresa THEN ARRAY[p_company_id] ELSE p_proyectos END;
      CONTINUE WHEN COALESCE(cardinality(v_ids), 0) = 0;

      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = ANY ($1))', v_fk.tabla, v_fk.columna)
        INTO v_hay USING v_ids;
      CONTINUE WHEN NOT v_hay;

      BEGIN
        EXECUTE format('DELETE FROM %s WHERE %I = ANY ($1)', v_fk.tabla, v_fk.columna) USING v_ids;
        GET DIAGNOSTICS v_filas = ROW_COUNT;
        v_total  := v_total + v_filas;
        v_avance := true;
      EXCEPTION WHEN foreign_key_violation THEN
        v_pendiente := true;
      END;
    END LOOP;

    EXIT WHEN NOT v_pendiente OR NOT v_avance OR v_pasada >= 20;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.purgar_empresa_bloqueantes(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- ── La purga ────────────────────────────────────────────────────────────────
-- Los códigos de error (prefijo del mensaje) los traduce el edge a HTTP en
-- `mapPurgeRpcError` (supabase/functions/delete-company/logic.ts).
CREATE OR REPLACE FUNCTION public.purgar_empresa(
  p_company_id             uuid,
  p_actor_id               uuid,
  p_confirm_name           text,
  p_grace_days             integer,
  p_stripe_subscription_id text    DEFAULT NULL,
  p_ensayo                 boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa         public.companies;
  v_proyectos       uuid[];
  v_superadmins     uuid[];
  v_personas        uuid[];
  v_clientes        uuid[];
  v_cuentas_cliente uuid[];
  v_usuarios_auth   uuid[];
  v_n_unidades      bigint;
  v_n_desligados    bigint;
  v_filas           bigint;
BEGIN
  -- [compuerta:parametros]
  IF p_company_id IS NULL OR p_actor_id IS NULL OR p_confirm_name IS NULL
     OR p_grace_days IS NULL OR p_grace_days < 1 OR p_ensayo IS NULL THEN
    RAISE EXCEPTION 'PURGA_PARAMETROS: faltan la empresa, el actor o el nombre de confirmación, o los días de gracia no son un entero positivo.'
      USING ERRCODE = '22023';
  END IF;
  -- [/compuerta:parametros]

  -- [compuerta:superadmin]
  IF NOT EXISTS (SELECT 1 FROM public.app_users u
                  WHERE u.id = p_actor_id AND u.role IN ('super_admin', 'superadmin')) THEN
    RAISE EXCEPTION 'PURGA_SOLO_SUPERADMIN: sólo un superadministrador puede purgar una empresa.'
      USING ERRCODE = '42501';
  END IF;
  -- [/compuerta:superadmin]

  SELECT c.* INTO v_empresa FROM public.companies c WHERE c.id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PURGA_EMPRESA_NO_ENCONTRADA: la empresa % no existe.', p_company_id
      USING ERRCODE = 'P0002';
  END IF;

  -- [compuerta:nombre]
  IF p_confirm_name IS DISTINCT FROM v_empresa.nombre THEN
    RAISE EXCEPTION 'PURGA_NOMBRE_NO_COINCIDE: el nombre de confirmación no coincide con el nombre de la empresa.'
      USING ERRCODE = '22023';
  END IF;
  -- [/compuerta:nombre]

  -- [compuerta:suspendida]
  IF v_empresa.activa THEN
    RAISE EXCEPTION 'PURGA_EMPRESA_ACTIVA: la empresa debe estar suspendida antes de eliminarse.'
      USING ERRCODE = '55000';
  END IF;
  -- [/compuerta:suspendida]

  -- [compuerta:gracia]
  IF v_empresa.suspended_at IS NULL
     OR v_empresa.suspended_at + make_interval(days => p_grace_days) > now() THEN
    RAISE EXCEPTION 'PURGA_EN_GRACIA: la empresa debe llevar al menos % días suspendida antes de la purga definitiva.', p_grace_days
      USING ERRCODE = '55000';
  END IF;
  -- [/compuerta:gracia]

  -- [compuerta:actor_ajeno]
  IF EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = p_actor_id AND u.company_id = p_company_id) THEN
    RAISE EXCEPTION 'PURGA_ACTOR_DE_LA_EMPRESA: no puedes eliminar una empresa a la que pertenece tu propia cuenta.'
      USING ERRCODE = '22023';
  END IF;
  -- [/compuerta:actor_ajeno]

  -- ── Quién y qué ──────────────────────────────────────────────────────────
  v_proyectos := ARRAY(SELECT p.id FROM public.projects p WHERE p.company_id = p_company_id ORDER BY p.id);

  v_superadmins := ARRAY(
    SELECT u.id FROM public.app_users u
     WHERE u.role IN ('super_admin', 'superadmin')
       AND (u.company_id = p_company_id OR u.project_id = ANY (v_proyectos))
     ORDER BY u.id);

  v_personas := ARRAY(
    SELECT u.id FROM public.app_users u
     WHERE u.company_id = p_company_id
       AND u.role NOT IN ('super_admin', 'superadmin')
     ORDER BY u.id);

  v_clientes := ARRAY(
    SELECT cl.id FROM public.clientes cl
     WHERE (cl.project_id = ANY (v_proyectos)
            OR EXISTS (SELECT 1 FROM public.company_clientes cc
                        WHERE cc.cliente_id = cl.id AND cc.company_id = p_company_id))
       AND (cl.project_id IS NULL OR cl.project_id = ANY (v_proyectos))
       AND NOT EXISTS (SELECT 1 FROM public.company_clientes cc
                        WHERE cc.cliente_id = cl.id AND cc.company_id <> p_company_id)
     ORDER BY cl.id);

  v_cuentas_cliente := ARRAY(
    SELECT u.id FROM public.app_users u
     WHERE u.role = 'cliente' AND u.cliente_id = ANY (v_clientes)
     ORDER BY u.id);

  v_usuarios_auth := v_personas || v_cuentas_cliente;

  SELECT count(*) INTO v_n_unidades FROM public.unidades un WHERE un.company_id = p_company_id;

  -- Escritura de sistema, sólo en esta transacción (ver cabecera).
  -- [paso:escritura_sistema]
  PERFORM set_config('conta.allow_system_write', 'on', true);
  -- [/paso:escritura_sistema]

  -- ── Auditoría: en la misma transacción que todo lo demás ─────────────────
  -- Si este INSERT falla, no se borra nada. Si algo de lo que sigue falla,
  -- esta fila también se revierte: la auditoría nunca dice que se borró una
  -- empresa que sigue viva.
  -- [paso:auditoria]
  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, company_id, before)
  VALUES (
    'companies', p_company_id, 'DELETE', p_actor_id, p_company_id,
    to_jsonb(v_empresa) || jsonb_build_object(
      'deleted_counts', jsonb_build_object(
        'projects',        cardinality(v_proyectos),
        'unidades',        v_n_unidades,
        'usuarios',        cardinality(v_personas),
        'cuentas_cliente', cardinality(v_cuentas_cliente),
        'clientes',        cardinality(v_clientes)),
      'grace_days',                   p_grace_days,
      'stripe_subscription_canceled', p_stripe_subscription_id,
      'usuarios_auth',                to_jsonb(v_usuarios_auth),
      'superadmins_desligados',       to_jsonb(v_superadmins)));
  -- [/paso:auditoria]

  -- ── Superadministradores: se desligan, no se borran ──────────────────────
  -- [paso:desligar]
  UPDATE public.app_users u SET company_id = NULL, project_id = NULL
   WHERE u.id = ANY (v_superadmins);
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> cardinality(v_superadmins) THEN
    RAISE EXCEPTION 'PURGA_INCOMPLETA: se esperaban % superadministradores por desligar y se desligaron %.',
      cardinality(v_superadmins), v_filas;
  END IF;
  -- [/paso:desligar]

  -- ── Personas y cuentas cliente exclusivas ────────────────────────────────
  -- user_roles y el rol de ajustes (roles.user_override_for) caen por sus
  -- FK ON DELETE CASCADE hacia app_users.
  -- [paso:personas]
  DELETE FROM public.app_users u WHERE u.id = ANY (v_usuarios_auth);
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> cardinality(v_usuarios_auth) THEN
    RAISE EXCEPTION 'PURGA_INCOMPLETA: se esperaban % personas por borrar y se borraron %.',
      cardinality(v_usuarios_auth), v_filas;
  END IF;
  -- [/paso:personas]

  -- Cualquier otra cuenta que siguiera apuntando a un proyecto de la empresa.
  UPDATE public.app_users u SET project_id = NULL WHERE u.project_id = ANY (v_proyectos);
  GET DIAGNOSTICS v_n_desligados = ROW_COUNT;

  -- ── Datos ────────────────────────────────────────────────────────────────
  -- [paso:bloqueantes]
  PERFORM public.purgar_empresa_bloqueantes(p_company_id, v_proyectos);
  -- [/paso:bloqueantes]
  DELETE FROM public.projects p WHERE p.company_id = p_company_id;
  PERFORM public.purgar_empresa_bloqueantes(p_company_id, v_proyectos);

  DELETE FROM public.companies c WHERE c.id = p_company_id;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'PURGA_INCOMPLETA: la empresa % no se borró.', p_company_id;
  END IF;

  -- Clientes exclusivos: DESPUÉS de la empresa, cuando ya no los referencian
  -- sus cuotas, cargos ni auxiliares contables (que cayeron en cascada).
  -- [paso:clientes]
  DELETE FROM public.clientes cl WHERE cl.id = ANY (v_clientes);
  -- [/paso:clientes]

  -- [paso:ensayo]
  IF p_ensayo THEN
    RAISE EXCEPTION 'PURGA_ENSAYO_OK: la purga de la empresa % se completaría; el ensayo se revierte sin cambios.', p_company_id
      USING ERRCODE = 'P0001';
  END IF;
  -- [/paso:ensayo]

  RETURN jsonb_build_object(
    'company_id',             p_company_id,
    'nombre',                 v_empresa.nombre,
    'logo_url',               v_empresa.logo_url,
    'usuarios_auth',          to_jsonb(v_usuarios_auth),
    'personas',               cardinality(v_personas),
    'cuentas_cliente',        cardinality(v_cuentas_cliente),
    'clientes',               cardinality(v_clientes),
    'proyectos',              cardinality(v_proyectos),
    'unidades',               v_n_unidades,
    'superadmins_desligados', cardinality(v_superadmins),
    'cuentas_proyecto_desligadas', v_n_desligados);
END;
$$;

REVOKE ALL ON FUNCTION public.purgar_empresa(uuid, uuid, text, integer, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_empresa(uuid, uuid, text, integer, text, boolean) TO service_role;

COMMENT ON FUNCTION public.purgar_empresa(uuid, uuid, text, integer, text, boolean) IS
  'Purga definitiva y atómica de una empresa (edge delete-company). Todo o nada; devuelve los ids de auth.users que el edge borra tras el COMMIT. Sólo service_role.';
