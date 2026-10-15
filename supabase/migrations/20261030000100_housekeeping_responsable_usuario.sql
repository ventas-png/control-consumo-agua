-- ════════════════════════════════════════════════════════════════════════════
-- Housekeeping · el RESPONSABLE del servicio es un usuario real, no un texto libre
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ CAMBIA
--   `servicios_housekeeping.responsable` era un nombre que escribía el supervisor
--   («Nombre del limpiador»): no decía a quién corresponde el servicio ni si esa
--   persona puede siquiera abrir el proyecto. Ahora el responsable es un USUARIO
--   (`responsable_user_id` → app_users), elegido entre los ELEGIBLES del proyecto,
--   y la elegibilidad la valida la base en cada INSERT/UPDATE: también frente a
--   una petición directa a la API, no solo en el selector de la pantalla.
--
-- IDENTIDADES SEPARADAS (ninguna se mezcla con otra; reasignar no toca sellos)
--   creado_por                      quién creó el servicio       sellar_actor (20260731000000)
--   responsable_user_id             quién es responsable         elegido; validado aquí
--   responsable_asignado_por / _en  quién lo asignó y cuándo     sellado aquí (auth.uid(), now())
--   iniciado_por / completado_por   quién lo inició / completó   trg_hk_sellar_ejecucion (20261028000000)
--   servicio_housekeeping_fotos.creado_por  quién subió cada foto  (20261028000000)
--
-- ELEGIBLE = cuenta de app_users que
--   · está habilitada (`activo`), es de la MISMA empresa del servicio y no es cliente;
--   · tiene el permiso del módulo `condominios.tab.housekeeping` con la MISMA regla
--     que user_has_permission() —perfil exento, deny sobre allow, caducidad— pero
--     evaluada para ESA cuenta: usuario_tiene_permiso();
--   · tiene acceso efectivo al proyecto con la MISMA regla que can_access_project()
--     —rol exento de empresa, project_id heredado o asignación explícita— evaluada
--     para ESA cuenta: usuario_acceso_a_proyecto() (20260906000400).
--   Dicho de otro modo: elegible ⇔ activo ∧ misma empresa ∧ no cliente ∧ hk_acceso
--   evaluada COMO esa cuenta. No hay otra interpretación de permisos ni de
--   exenciones: la suite lo demuestra por equivalencia, cuenta por cuenta.
--
-- QUIÉN ASIGNA
--   Quien escribe la fila. Las policies de servicios_housekeeping (hk_acceso,
--   20261028000100) ya exigen empresa + acceso al proyecto + permiso para crear o
--   editar; esta migración no las toca. Asignar NO concede nada: ninguna policy
--   mira responsable_user_id. Si después se revoca el acceso del responsable, la
--   fila y la asignación se conservan y el selector deja de ofrecerlo: la pantalla
--   muestra «requiere reasignación». Sus permisos no se amplían.
--
-- COMPATIBILIDAD
--   `responsable` (texto) se conserva tal cual, como «responsable anterior sin
--   vincular». NO se vincula por coincidencia de nombre ni se reasigna nada en
--   bloque: esta migración no escribe ninguna fila.
--
-- LO QUE NO ES OBLIGATORIO EN LA BASE
--   responsable_user_id admite NULL: los servicios anteriores no lo tienen y otras
--   escrituras (cron, importaciones) pueden no asignarlo. Que un servicio NUEVO
--   lleve responsable lo exige la pantalla al crear; la base solo garantiza que, si
--   lo lleva, es elegible.
--
-- REVERSIÓN: scripts/reversion-housekeeping-responsable.sql
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Columnas ──────────────────────────────────────────────────────────────
ALTER TABLE public.servicios_housekeeping
  ADD COLUMN IF NOT EXISTS responsable_user_id      uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsable_asignado_por uuid REFERENCES auth.users(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsable_asignado_en  timestamptz;

CREATE INDEX IF NOT EXISTS idx_hk_responsable_user ON public.servicios_housekeeping(responsable_user_id);

COMMENT ON COLUMN public.servicios_housekeeping.responsable IS
  'Texto libre heredado (anterior a 20261030000100): «responsable anterior sin vincular». No se vincula por nombre; se conserva hasta que se elija un usuario.';
COMMENT ON COLUMN public.servicios_housekeeping.responsable_user_id IS
  'Usuario responsable del servicio. Elegible = habilitado, de la empresa del servicio, con acceso al proyecto y permiso condominios.tab.housekeeping (hk_responsable_elegible); lo valida trg_hk_responsable en INSERT/UPDATE. No concede acceso.';
COMMENT ON COLUMN public.servicios_housekeeping.responsable_asignado_por IS
  'Quién asignó (o retiró) el responsable. Lo sella la BD con auth.uid() al cambiar responsable_user_id; lo que mande el cliente se ignora.';
COMMENT ON COLUMN public.servicios_housekeeping.responsable_asignado_en IS
  'Cuándo cambió por última vez responsable_user_id. Lo sella la BD.';

-- ── 2) El permiso de OTRA cuenta, con la regla de user_has_permission() ─────
-- user_has_permission() responde por auth.uid(); el selector y el trigger
-- necesitan la misma respuesta para una cuenta cualquiera. Misma estructura,
-- mismo orden (perfil exento → deny → allow), misma caducidad. Lo usan solo
-- funciones SECURITY DEFINER: no se expone como oráculo «¿qué puede fulano?».
CREATE OR REPLACE FUNCTION public.usuario_tiene_permiso(p_user_id uuid, p_permiso text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH cuenta AS (
    SELECT role FROM public.app_users WHERE id = p_user_id
  )
  SELECT
    CASE
      WHEN p_user_id IS NULL THEN false
      WHEN (SELECT role FROM cuenta) IN ('super_admin', 'superadmin', 'company_owner', 'admin') THEN true
      WHEN EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = p_user_id
          AND rp.permission_key = p_permiso
          AND rp.effect = 'deny'
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
      ) THEN false
      ELSE EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = p_user_id
          AND rp.permission_key = p_permiso
          AND rp.effect = 'allow'
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
      )
    END
$$;

COMMENT ON FUNCTION public.usuario_tiene_permiso(uuid, text) IS
  'Espejo de user_has_permission() para una cuenta cualquiera (no el llamador): perfil exento, deny sobre allow, caducidad de user_roles. Solo la llaman funciones SECURITY DEFINER.';

REVOKE EXECUTE ON FUNCTION public.usuario_tiene_permiso(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 3) ¿Esta cuenta puede ser responsable de un servicio de este proyecto? ──
-- COALESCE: una cuenta inexistente o sin empresa no debe salir con «no se sabe».
-- El proyecto tiene que ser de la MISMA empresa que la fila: un rol exento de otra
-- empresa pasa usuario_acceso_a_proyecto() con cualquier proyecto (no mira la
-- empresa del proyecto), y aquí no basta.
CREATE OR REPLACE FUNCTION public.hk_responsable_elegible(p_user_id uuid, p_company uuid, p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT u.activo
         AND u.company_id = p_company
         AND COALESCE(u.role, '') <> 'cliente'
         AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project AND p.company_id = p_company)
         AND public.usuario_tiene_permiso(u.id, 'condominios.tab.housekeeping')
         AND public.usuario_acceso_a_proyecto(u.id, p_project)
        FROM public.app_users u
       WHERE u.id = p_user_id
         AND p_company IS NOT NULL
         AND p_project IS NOT NULL
    ),
    false
  )
$$;

COMMENT ON FUNCTION public.hk_responsable_elegible(uuid, uuid, uuid) IS
  'Habilitado, de la empresa del servicio, no cliente, con permiso condominios.tab.housekeeping (usuario_tiene_permiso) y acceso al proyecto (usuario_acceso_a_proyecto). La usan el trigger y el catálogo del selector.';

REVOKE EXECUTE ON FUNCTION public.hk_responsable_elegible(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 4) Validación y sello en la fila ────────────────────────────────────────
-- BEFORE INSERT OR UPDATE. SECURITY DEFINER para poder llamar a las funciones de
-- arriba (revocadas a authenticated) y leer app_users sin depender de la RLS
-- del usuario; auth.uid() sigue siendo el del llamador.
--   · Se valida cuando el responsable se pone o cambia, y también cuando cambia
--     la empresa o el proyecto de un servicio que ya tiene responsable (la
--     elegibilidad es por proyecto).
--   · Los sellos de asignación los pone la base al cambiar responsable_user_id
--     (también al retirarlo: queda quién lo retiró). Lo que mande el cliente en
--     esas dos columnas se ignora; si no cambia el responsable, se conservan.
--   · No toca creado_por, iniciado_*, completado_* ni `responsable` (texto).
CREATE OR REPLACE FUNCTION public.hk_responsable_validar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_cambia   boolean;
  v_revalida boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_cambia   := NEW.responsable_user_id IS NOT NULL;
    v_revalida := v_cambia;
    NEW.responsable_asignado_por := NULL;
    NEW.responsable_asignado_en  := NULL;
  ELSE
    v_cambia   := NEW.responsable_user_id IS DISTINCT FROM OLD.responsable_user_id;
    v_revalida := NEW.responsable_user_id IS NOT NULL
                  AND (v_cambia
                       OR NEW.company_id IS DISTINCT FROM OLD.company_id
                       OR NEW.project_id IS DISTINCT FROM OLD.project_id);
    NEW.responsable_asignado_por := OLD.responsable_asignado_por;
    NEW.responsable_asignado_en  := OLD.responsable_asignado_en;
  END IF;

  IF v_revalida
     AND NOT public.hk_responsable_elegible(NEW.responsable_user_id, NEW.company_id, NEW.project_id) THEN
    RAISE EXCEPTION 'HK_RESPONSABLE_NO_ELEGIBLE: el responsable debe ser un usuario habilitado de la empresa, con acceso al proyecto y al módulo de housekeeping'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_cambia THEN
    NEW.responsable_asignado_por := v_uid;
    NEW.responsable_asignado_en  := now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_responsable_validar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hk_responsable ON public.servicios_housekeeping;
CREATE TRIGGER trg_hk_responsable
  BEFORE INSERT OR UPDATE ON public.servicios_housekeeping
  FOR EACH ROW EXECUTE FUNCTION public.hk_responsable_validar();

-- ── 5) Catálogo del selector: los elegibles de un proyecto ──────────────────
-- Mismo motivo que personal_usuarios_asignables / rutas_operadores_asignables:
-- la policy de app_users no deja enumerar la empresa a quien no es owner/admin
-- y el selector tiene que funcionar para quien crea o edita servicios.
-- PERMISO: el llamador necesita hk_acceso(empresa, proyecto), lo mismo que para
-- escribir el servicio. Devuelve solo cuentas elegibles (ya habilitadas).
CREATE OR REPLACE FUNCTION public.hk_responsables_elegibles(p_project_id uuid)
RETURNS TABLE (
  id        uuid,
  full_name text,
  role      text,
  activo    boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT p.company_id INTO v_company
    FROM public.projects p
   WHERE p.id = p_project_id;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Proyecto inexistente' USING ERRCODE = '42501';
  END IF;

  IF NOT (public.is_super_admin() OR v_company = public.get_my_company_id()) THEN
    RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
  END IF;

  IF NOT public.hk_acceso(v_company, p_project_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    COALESCE(
      NULLIF(btrim(u.full_name), ''),
      NULLIF(split_part(au.email::text, '@', 1), ''),
      'Usuario ' || left(u.id::text, 8)
    ) AS full_name,
    COALESCE(u.role, '—') AS role,
    u.activo
  FROM public.app_users u
  LEFT JOIN auth.users au ON au.id = u.id
  WHERE u.company_id = v_company
    AND public.hk_responsable_elegible(u.id, v_company, p_project_id)
  ORDER BY 2 ASC, 1 ASC;
END;
$$;

COMMENT ON FUNCTION public.hk_responsables_elegibles(uuid) IS
  'Cuentas que pueden ser responsables de un servicio de housekeeping de ese proyecto (hk_responsable_elegible). Exige al llamador hk_acceso(empresa, proyecto).';

REVOKE EXECUTE ON FUNCTION public.hk_responsables_elegibles(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.hk_responsables_elegibles(uuid) TO authenticated;
