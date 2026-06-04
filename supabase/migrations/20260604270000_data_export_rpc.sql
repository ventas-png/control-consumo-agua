-- ============================================================================
-- Export de datos del titular (T3 Plataforma · plat:P35 · GDPR)
-- ============================================================================
-- Banda de migración P35: 20260604270000.
--
-- Derecho de acceso/portabilidad (GDPR / Ley de Protección de Datos): el usuario
-- descarga SUS datos personales en un JSON. Una sola RPC SECURITY DEFINER
-- acotada por auth.uid() reúne lo que tenemos del titular y lo devuelve como
-- jsonb; el cliente lo descarga (sin edge function ni red extra).
--
-- Secciones: perfil (app_users + email/last_sign_in de auth.users), aceptaciones
-- legales (plat:P33), notificaciones in-app, eventos de seguridad (security_logs)
-- y sesiones (auth.sessions). Listas voluminosas (eventos/notifs) se acotan a las
-- 1000 más recientes para mantener el payload manejable.
--
-- Seguridad: SECURITY DEFINER + search_path fijo; user-facing → REVOKE PUBLIC/anon
-- + GRANT authenticated. TODO se filtra por auth.uid(): el usuario solo exporta
-- LO SUYO. Idempotente (CREATE OR REPLACE).
--
-- Follow-ups: derecho de supresión/anonimización (borrado) con su flujo de
-- aprobación; incluir adjuntos/archivos; paginar para cuentas muy grandes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autenticado';
  END IF;

  SELECT jsonb_build_object(
    'export_version', 1,
    'generated_at', now(),
    'user_id', v_uid,

    'profile', (
      SELECT jsonb_build_object(
        'email', u.email,
        'full_name', au.full_name,
        'role', au.role,
        'company_id', au.company_id,
        'project_id', au.project_id,
        'cliente_id', au.cliente_id,
        'created_at', au.created_at,
        'last_sign_in_at', u.last_sign_in_at
      )
      FROM auth.users u
      LEFT JOIN public.app_users au ON au.id = u.id
      WHERE u.id = v_uid
    ),

    'legal_acceptances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'doc_type', la.doc_type, 'version', la.version,
        'locale', la.locale, 'accepted_at', la.accepted_at
      ) ORDER BY la.accepted_at)
      FROM public.legal_acceptances la
      WHERE la.user_id = v_uid
    ), '[]'::jsonb),

    'notifications', COALESCE((
      SELECT jsonb_agg(n.ev ORDER BY n.ts DESC)
      FROM (
        SELECT jsonb_build_object(
          'tipo', un.tipo, 'titulo', un.titulo, 'cuerpo', un.cuerpo,
          'leido', un.leido, 'created_at', un.created_at
        ) AS ev, un.created_at AS ts
        FROM public.user_notifications un
        WHERE un.user_id = v_uid
        ORDER BY un.created_at DESC
        LIMIT 1000
      ) n
    ), '[]'::jsonb),

    'security_events', COALESCE((
      SELECT jsonb_agg(s.ev ORDER BY s.ts DESC)
      FROM (
        SELECT jsonb_build_object(
          'event_type', sl.event_type, 'ip_address', sl.ip_address,
          'user_agent', sl.user_agent, 'timestamp', sl.timestamp
        ) AS ev, sl.timestamp AS ts
        FROM public.security_logs sl
        WHERE sl.user_id = v_uid
        ORDER BY sl.timestamp DESC
        LIMIT 1000
      ) s
    ), '[]'::jsonb),

    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'created_at', se.created_at, 'updated_at', se.updated_at,
        'user_agent', se.user_agent, 'ip', host(se.ip)
      ) ORDER BY se.updated_at DESC NULLS LAST)
      FROM auth.sessions se
      WHERE se.user_id = v_uid
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.export_my_data IS
  'plat:P35 (GDPR) — devuelve los datos personales del usuario actual (auth.uid()) como jsonb para descarga: perfil, aceptaciones legales, notificaciones, eventos de seguridad y sesiones. User-facing: GRANT a authenticated.';

-- ── Grant (user-facing): REVOKE de PUBLIC/anon + GRANT a authenticated ────────
REVOKE EXECUTE ON FUNCTION public.export_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO authenticated;
