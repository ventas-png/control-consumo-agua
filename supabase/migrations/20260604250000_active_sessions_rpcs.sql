-- ============================================================================
-- Sesiones activas del usuario (T3 Plataforma · plat:P9)
-- ============================================================================
-- Banda de migracion P9: 20260604250000.
--
-- Da al usuario visibilidad y control de SUS sesiones (los dispositivos donde
-- tiene la sesión abierta): listarlas y cerrarlas. Complementa plat:P11 (aviso de
-- nuevo dispositivo): si el usuario ve un acceso que no reconoce, lo cierra aquí.
--
-- `auth.sessions` (gestionada por GoTrue) tiene una fila por sesión con
-- user_agent, ip, created_at/updated_at/refreshed_at, not_after y aal. No es
-- accesible desde el cliente, así que exponemos 3 RPC SECURITY DEFINER ACOTADAS
-- POR auth.uid() — el usuario solo ve/cierra LAS SUYAS. El JWT lleva el claim
-- `session_id`, con el que marcamos/excluimos la sesión actual.
--
-- Seguridad: SECURITY DEFINER + search_path fijo. Estas son RPC DE USUARIO (las
-- invoca `authenticated` vía PostgREST), así que el grant correcto es a
-- `authenticated` con REVOKE de PUBLIC/anon — NO el patrón service-role-only (ese
-- es para workers). El filtro interno por auth.uid() impide ver o cerrar sesiones
-- ajenas; mismo patrón que get_user_permissions. Borrar la fila de auth.sessions
-- invalida la sesión (los FK de GoTrue cascadean a refresh_tokens/mfa_amr_claims).
--
-- Idempotente: CREATE OR REPLACE.
-- ============================================================================

-- ── Listado: sesiones del usuario actual, marcando la sesión en curso ─────────
CREATE OR REPLACE FUNCTION public.get_my_sessions()
RETURNS TABLE (
  id           uuid,
  created_at   timestamptz,
  updated_at   timestamptz,
  refreshed_at timestamptz,
  not_after    timestamptz,
  aal          text,
  user_agent   text,
  ip           text,
  is_current   boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current uuid := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;  -- sin sesión no hay nada que listar
  END IF;
  RETURN QUERY
    SELECT
      s.id,
      s.created_at,
      s.updated_at,
      (s.refreshed_at AT TIME ZONE 'UTC') AS refreshed_at,  -- naive (UTC) → timestamptz
      s.not_after,
      s.aal::text                          AS aal,
      s.user_agent,
      host(s.ip)                           AS ip,            -- inet → text sin máscara
      (s.id = v_current)                   AS is_current
    FROM auth.sessions s
    WHERE s.user_id = auth.uid()
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.get_my_sessions IS
  'plat:P9 — devuelve las sesiones (auth.sessions) del usuario actual (auth.uid()), marcando la sesión en curso (session_id del JWT). User-facing: GRANT a authenticated.';

-- ── Revocar una sesión concreta (solo si es del usuario) ──────────────────────
CREATE OR REPLACE FUNCTION public.revoke_my_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no autenticado';
  END IF;
  -- El WHERE incluye user_id = auth.uid(): imposible cerrar la sesión de otro.
  -- El cascade de GoTrue limpia refresh_tokens/mfa_amr_claims de la sesión.
  DELETE FROM auth.sessions s
  WHERE s.id = p_session_id
    AND s.user_id = auth.uid();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

COMMENT ON FUNCTION public.revoke_my_session IS
  'plat:P9 — cierra (borra de auth.sessions) una sesión del usuario actual. Devuelve true si existía y era suya. User-facing: GRANT a authenticated.';

-- ── Revocar todas las DEMÁS (cerrar sesión en todos los otros dispositivos) ───
CREATE OR REPLACE FUNCTION public.revoke_other_my_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current uuid := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no autenticado';
  END IF;
  -- Sin session_id en el JWT no podemos identificar la sesión en curso: no
  -- borramos nada para no cerrarla por error (fail-safe).
  IF v_current IS NULL THEN
    RETURN 0;
  END IF;
  DELETE FROM auth.sessions s
  WHERE s.user_id = auth.uid()
    AND s.id <> v_current;  -- conserva la sesión en curso
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.revoke_other_my_sessions IS
  'plat:P9 — cierra todas las sesiones del usuario actual EXCEPTO la sesión en curso (session_id del JWT). Devuelve cuántas cerró. User-facing: GRANT a authenticated.';

-- ── Grants (user-facing): REVOKE de PUBLIC/anon + GRANT a authenticated ───────
-- Seguro porque cada función se acota internamente a auth.uid().
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.get_my_sessions()',
    'public.revoke_my_session(uuid)',
    'public.revoke_other_my_sessions()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;
