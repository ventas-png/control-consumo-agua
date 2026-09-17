-- ════════════════════════════════════════════════════════════════════════════
-- Las siete SECURITY DEFINER que una RECONSTRUCCIÓN deja abiertas a `anon`
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ PASÓ, Y DÓNDE SE VIO
-- En producción (nnsqmeigtgewatameexo) estas siete funciones NO comparten ACL:
-- alguien las endureció a mano, y las migraciones no registran ese REVOKE. En
-- la Preview limpia de #856 (couybkchcfsqmymlildc) —construida SÓLO desde el
-- repositorio— las siete quedaron con EXECUTE para `anon`, `authenticated` y
-- `service_role`, porque una Supabase nueva trae
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
--
-- y ninguna migración revoca nada después. Es decir: producción está cerrada y
-- el repositorio no sabe por qué. Cualquier entorno provisionado desde el repo
-- —preview, staging, una restauración— nace con el hueco que producción ya no
-- tiene. Es la misma clase de #378/#380 y de 20260825010000, pero al revés: no
-- es un REVOKE que falta escribir, es un REVOKE que ya se hizo y que el
-- repositorio nunca aprendió.
--
-- ESTA MIGRACIÓN NO CAMBIA PRODUCCIÓN. Sobre prod es un no-op: declara lo que
-- ya está. Lo que cambia es la RECONSTRUCCIÓN — que a partir de aquí reproduce
-- la matriz de producción en vez de inventar una más laxa.
--
-- ── LA MATRIZ, Y POR QUÉ NO ES LA MISMA PARA LAS SIETE ──────────────────────
-- «SECURITY DEFINER expuesta a anon» NO significa «hay que cerrarla a todos».
-- Dos de las siete están abiertas A PROPÓSITO, y cerrarlas rompería el
-- producto. Se declara la matriz de producción, celda por celda:
--
--   función                                        PUBLIC anon auth srv
--   ──────────────────────────────────────────────────────────────────
--   sso_lookup_domain(text)                          no    SÍ   SÍ   SÍ
--   buscar_cliente_para_onboarding(text,date,text)   no    no   SÍ   SÍ
--   migrate_custom_auth_to_supabase_unconfirmed()    no    no   no   SÍ
--   create_default_conversation_access_rules(uuid)   no    no   no   SÍ
--   fill_company_id_from_user()                      no    no   no   SÍ
--   fn_set_recipient_company_id()                    no    no   no   SÍ
--   set_updated_at()                                 no    no   no   SÍ
--
-- (1) `sso_lookup_domain` CONSERVA anon, y es la única que lo conserva.
--     El descubrimiento de SSO ocurre PRE-login: el navegador aún no tiene
--     sesión cuando pregunta si el dominio del correo va por SSO. Devuelve
--     exactamente {sso_available, enforced, provider_id} y sólo para dominios
--     con `verified = true` — ni company_id, ni identidad, ni nada del tenant.
--     Es la ÚNICA excepción anón registrada en
--     scripts/security-guard.allowlist.json (plat:P10, #428), y este archivo no
--     agrega ninguna: al contrario, deja a las otras seis fuera del hallazgo.
--
-- (2) `buscar_cliente_para_onboarding` CONSERVA authenticated, y pierde anon.
--     Dos caminos la usan y ninguno es anónimo:
--       · src/domain/clientes/queries.ts (ClientesSection) — pantalla de
--         administración, con sesión;
--       · las Edge Functions create-cliente-account y
--         complete-oauth-onboarding — con SERVICE ROLE, no con la llave anón.
--     El alta self-service SÍ es anónima, pero entra por la Edge Function, que
--     es donde vive el rate limit por IP y por correo. Dejarla anon-ejecutable
--     regalaría el enumerador de identidad (DPI + fecha de nacimiento + correo)
--     SIN ese tope — exactamente lo que el IDENTITY_ERROR genérico y el
--     `failClosed` de create-cliente-account existen para frenar.
--
-- (3) Las otras cinco quedan SÓLO para `service_role`. Tres de ellas son
--     funciones de trigger:
--       fill_company_id_from_user()   → fuentes_agua, registros_calidad
--       fn_set_recipient_company_id() → broadcast_recipients
--       set_updated_at()              → conversations, conversation_access_rules
--     REVOCAR SU INVOCACIÓN DIRECTA NO APAGA LOS TRIGGERS. Postgres verifica el
--     EXECUTE sobre la función de trigger en el `CREATE TRIGGER`, no en cada
--     disparo: el trigger corre con los privilegios con los que se creó. Ya
--     estaba demostrado en 20260612192952, 20260729000700 y en
--     supabase/tests/security_definer_anon §4/4; aquí se vuelve a demostrar con
--     estas tres, sobre tablas con su trigger puesto
--     (supabase/tests/acl_definer_expuestas_anon §6/7).
--     Las otras dos son de backend: `create_default_conversation_access_rules`
--     siembra las reglas de un tenant nuevo y `migrate_custom_auth_...` es un
--     placeholder legado que ni siquiera debe invocarse.
--
-- ── POR QUÉ SE REVOCA A LOS CUATRO ANTES DE CONCEDER ────────────────────────
-- El estado de partida NO es el mismo en todas partes: en producción la ACL ya
-- está endurecida; en una Supabase nueva las cuatro tienen EXECUTE por el
-- ALTER DEFAULT PRIVILEGES; en el Postgres pelado del arnés no hay ninguna. Una
-- migración que sólo CONCEDE depende de dónde corra. Revocar los cuatro y
-- conceder después exactamente los de la matriz deja la MISMA ACL en los tres
-- casos, y la deja igual si se aplica dos veces: REVOKE de un privilegio
-- ausente y GRANT de uno presente son no-ops.
--
-- AL DUEÑO NO SE LE CONCEDE NADA. `postgres` conserva EXECUTE sobre sus propias
-- funciones por definición, y por eso las SECURITY DEFINER anidadas siguen
-- funcionando. Concedérselo explícitamente sólo ensuciaría la ACL — y la huella
-- del auditor, que la lee entera.
--
-- NO SE TOCA NADA MÁS: ni un cuerpo de función, ni una policy, ni una tabla, ni
-- un trigger, ni los privilegios por defecto del esquema. Sólo siete ACLs.
--
-- FIRMAS COMPLETAS Y ESQUEMA EXPLÍCITO en cada sentencia: Postgres permite
-- overloads y cada uno tiene su propia ACL. Hoy ninguna de las siete está
-- sobrecargada, pero un REVOKE sin firma es una promesa que se rompe sola el
-- día que aparezca la segunda encarnación.
--
-- REVERSIÓN (volvería a abrir lo que este archivo cierra):
--   GRANT EXECUTE ON FUNCTION public.buscar_cliente_para_onboarding(text, date, text) TO anon;
--   GRANT EXECUTE ON FUNCTION public.migrate_custom_auth_to_supabase_unconfirmed() TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.create_default_conversation_access_rules(uuid) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.fill_company_id_from_user()   TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.fn_set_recipient_company_id() TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.set_updated_at()              TO anon, authenticated;
-- ════════════════════════════════════════════════════════════════════════════

-- ── (1) Excepción anónima deliberada: el descubrimiento de SSO es PRE-login ─
REVOKE EXECUTE ON FUNCTION public.sso_lookup_domain(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.sso_lookup_domain(text)
  TO anon, authenticated, service_role;

-- ── (2) Usuario con sesión y backend; NUNCA anón ────────────────────────────
REVOKE EXECUTE ON FUNCTION public.buscar_cliente_para_onboarding(text, date, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.buscar_cliente_para_onboarding(text, date, text)
  TO authenticated, service_role;

-- ── (3) Sólo backend ────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.migrate_custom_auth_to_supabase_unconfirmed()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.migrate_custom_auth_to_supabase_unconfirmed()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_default_conversation_access_rules(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.create_default_conversation_access_rules(uuid)
  TO service_role;

-- Las tres de trigger. El REVOKE cierra la Data API; el trigger sigue vivo
-- porque su EXECUTE se verificó en el CREATE TRIGGER, no en cada disparo.
REVOKE EXECUTE ON FUNCTION public.fill_company_id_from_user()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fill_company_id_from_user()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_set_recipient_company_id()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_set_recipient_company_id()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.set_updated_at()
  TO service_role;

-- ── Autoverificación: la matriz, celda por celda ────────────────────────────
-- Una migración de ACL que no comprueba la ACL resultante es una declaración de
-- intenciones. Se pregunta con has_function_privilege, que es lo que de verdad
-- decide en tiempo de ejecución, y no el texto del GRANT. Si algo no surtió
-- efecto, esto falla AQUÍ —en la preview branch o en el apply— y no seis
-- semanas después en el guard nocturno.
--
-- Un rol ausente no es un fallo (el arnés local corre sobre un Postgres pelado
-- donde anon/authenticated/service_role pueden no existir): lo que no se tolera
-- es que EXISTA y tenga una celda distinta de la declarada.
DO $$
DECLARE
  v_matriz text[][] := ARRAY[
    -- firma                                                       anon auth srv
    ['sso_lookup_domain(text)',                                    't', 't', 't'],
    ['buscar_cliente_para_onboarding(text, date, text)',           'f', 't', 't'],
    ['migrate_custom_auth_to_supabase_unconfirmed()',              'f', 'f', 't'],
    ['create_default_conversation_access_rules(uuid)',             'f', 'f', 't'],
    ['fill_company_id_from_user()',                                'f', 'f', 't'],
    ['fn_set_recipient_company_id()',                              'f', 'f', 't'],
    ['set_updated_at()',                                           'f', 'f', 't']
  ];
  v_roles text[] := ARRAY['anon', 'authenticated', 'service_role'];
  v_fn    text;
  v_oid   oid;
  v_i     int;
  v_j     int;
  v_esp   boolean;
  v_real  boolean;
BEGIN
  FOR v_i IN 1 .. array_length(v_matriz, 1) LOOP
    v_fn  := v_matriz[v_i][1];
    v_oid := to_regprocedure('public.' || v_fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION
        '20260911223000: no existe public.% — ¿se renombró o cambió de firma?', v_fn
        USING ERRCODE = '42883';
    END IF;

    -- PUBLIC nunca, en ninguna de las siete. Es el grant heredable: mientras
    -- viva, revocarle a `anon` su grant directo no sirve de nada (la lección de
    -- conta_puede_escribir en 20260818000000).
    IF has_function_privilege('public', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        '20260911223000: PUBLIC conserva EXECUTE sobre public.%', v_fn
        USING ERRCODE = '42501';
    END IF;

    FOR v_j IN 1 .. array_length(v_roles, 1) LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_roles[v_j]);
      v_esp  := v_matriz[v_i][v_j + 1] = 't';
      v_real := has_function_privilege(v_roles[v_j], v_oid, 'EXECUTE');
      IF v_real IS DISTINCT FROM v_esp THEN
        RAISE EXCEPTION
          '20260911223000: public.% — % tiene EXECUTE=% y la matriz declara %',
          v_fn, v_roles[v_j], v_real, v_esp
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ── Los comentarios, para que la próxima persona no tenga que deducirlo ─────
COMMENT ON FUNCTION public.sso_lookup_domain(text) IS
  'Descubrimiento de SSO por dominio de correo. ANON-EJECUTABLE A PROPÓSITO: ocurre PRE-login, sin sesión. Devuelve sólo {sso_available, enforced, provider_id} de dominios verified — nunca company_id, identidad ni datos del tenant. Única excepción anón declarada en scripts/security-guard.allowlist.json (plat:P10, #428); la ACL la fija 20260911223000.';

COMMENT ON FUNCTION public.buscar_cliente_para_onboarding(text, date, text) IS
  'Triple match (CUI/DUI + fecha de nacimiento + correo) para el onboarding. authenticated SÍ (pantalla de administración), anon NO: el alta self-service entra por las Edge Functions create-cliente-account / complete-oauth-onboarding, con service role y con el rate limit por IP y por correo que acota la enumeración de identidad. ACL fijada por 20260911223000.';

COMMENT ON FUNCTION public.migrate_custom_auth_to_supabase_unconfirmed() IS
  'Placeholder legado del traslado de auth propio a Supabase; no se invoca. Sólo service_role (20260911223000).';

COMMENT ON FUNCTION public.create_default_conversation_access_rules(uuid) IS
  'Siembra las reglas de acceso a conversaciones de una empresa nueva. Backend: sólo service_role (20260911223000).';

COMMENT ON FUNCTION public.fill_company_id_from_user() IS
  'Función de TRIGGER (fuentes_agua, registros_calidad): rellena company_id desde app_users. Ningún rol de API la invoca directo — sólo service_role conserva EXECUTE (20260911223000). Los triggers siguen disparando: Postgres verifica el EXECUTE en CREATE TRIGGER, no en cada disparo.';

COMMENT ON FUNCTION public.fn_set_recipient_company_id() IS
  'Función de TRIGGER (broadcast_recipients): hereda company_id del broadcast. Ningún rol de API la invoca directo — sólo service_role conserva EXECUTE (20260911223000). El trigger sigue disparando.';

COMMENT ON FUNCTION public.set_updated_at() IS
  'Función de TRIGGER (conversations, conversation_access_rules): sella updated_at. Ningún rol de API la invoca directo — sólo service_role conserva EXECUTE (20260911223000). El trigger sigue disparando.';
