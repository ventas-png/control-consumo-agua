-- ════════════════════════════════════════════════════════════════════════════
-- payment_requests — cerrar la lectura pública sin autenticar
-- ════════════════════════════════════════════════════════════════════════════
--
-- LO QUE HAY EN PRODUCCIÓN HOY (leído del catálogo el 2026-09-01, solo lectura):
--
--   payment_requests_select · SELECT · TO public · USING (true)
--
-- `public` en Postgres incluye a `anon`, y `anon` conserva el GRANT de SELECT
-- sobre la tabla (privilegios por defecto de Supabase: anon=arwdDxtm/postgres).
-- Con RLS activa pero una policy permisiva que devuelve `true`, la RLS no
-- controla nada: **cualquiera con la clave anon pública —que viaja en el bundle
-- del SPA— puede leer la tabla entera, de todos los tenants**, incluidos
-- cliente_id, company_id, monto, provider, estado, stripe_payment_intent,
-- paypal_order_id, numero_comprobante, referencia, comision y recargo.
--
-- Ninguna migración del repositorio declara esa policy: se creó fuera de banda
-- y nadie la revisó nunca. Por eso el drift no es cosmético — es el mecanismo
-- por el que un CI verde deja de ser evidencia (#826, #827).
--
-- POR QUÉ EL REPOSITORIO ES EL LADO CORRECTO, Y NO UNA OPINIÓN
-- `src/test/rls/rlsHarness.test.ts` ya afirma por escrito la postura contraria,
-- en dos listas independientes:
--   · NO_SELECT_TABLES = ['payment_requests'] — «sólo service_role (BYPASSRLS)
--     las lee. Para authenticated Y anon el SELECT devuelve 0 filas.
--     payment_requests guarda el camino de dinero del pago en línea; sus filas
--     nunca deben proyectarse a un cliente (auditoría 2026-07-16, S5)».
--   · ANON_DENY_TABLES — «anon no debe leer NINGUNA fila».
-- El harness corre contra un esquema construido desde el repositorio, así que
-- pasaba mientras producción decía lo contrario.
--
-- QUIÉN LEE DE VERDAD (verificado archivo por archivo)
--   · src/ — CERO lecturas. No existe un solo `from('payment_requests')`.
--   · Edge functions — create-payment-intent:243, create-charge:456,
--     confirm-charge:105 y 242, stripe-webhook-handler:179/216. TODAS usan el
--     cliente `admin`/`adminClient` construido con SUPABASE_SERVICE_ROLE_KEY,
--     que es BYPASSRLS: ni la policy ni el GRANT le afectan.
--   · El cliente `callerClient` (ANON_KEY + JWT del llamador) de esas mismas
--     funciones se usa SÓLO para `auth.getUser()` y leer `app_users`. Nunca
--     toca payment_requests.
--   · RPC — `superadmin_comisiones_resumen(uuid)` devuelve agregados mensuales
--     y ya exige `is_super_admin()`; se queda como está (necesidad demostrada:
--     src/domain/superadmin/queries.ts:373).
-- No hay ningún consumidor legítimo que lea la tabla como anon o authenticated.
--
-- QUÉ HACE ESTA MIGRACIÓN, Y QUÉ NO
-- Quita la policy y el privilegio. Las dos cosas, a propósito: la policy sola
-- dejaría el GRANT vivo esperando a la próxima policy permisiva, y el REVOKE
-- solo dejaría la policy como documentación falsa de una postura que no rige.
-- Sin policy de SELECT y sin GRANT, un SELECT de anon/authenticated falla por
-- privilegio (42501) antes de llegar a evaluar RLS.
--
-- NO se crea ninguna policy de SELECT de reemplazo. No hace falta ninguna, y
-- una `USING (true)`, un `auth.role()` o un `TO authenticated` sin filtro por
-- fila reabrirían el mismo agujero con otro nombre.
-- NO se tocan INSERT ni UPDATE: `payment_requests_insert` y
-- `payment_requests_update` ya están acotadas por `company_id =
-- get_my_company_id()` y quedan intactas.
-- NO se toca service_role, que es quien hace el trabajo real.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) La policy que abre la tabla ──────────────────────────────────────────
-- IF EXISTS porque el repositorio nunca la declaró: en una base construida
-- desde supabase/migrations no existe, y en producción sí. La migración tiene
-- que ser correcta en las dos.
DROP POLICY IF EXISTS payment_requests_select ON public.payment_requests;

-- ── 2) El privilegio que la haría alcanzable ────────────────────────────────
-- PUBLIC no figura hoy en el ACL de la tabla (postgres, anon, authenticated y
-- service_role sí). Se revoca igual: es barato, es idempotente, y cubre el caso
-- de que un GRANT a PUBLIC entre por otra vía.
REVOKE SELECT ON public.payment_requests FROM PUBLIC;
REVOKE SELECT ON public.payment_requests FROM anon;
REVOKE SELECT ON public.payment_requests FROM authenticated;

-- ── 3) La RPC de reconciliación ─────────────────────────────────────────────
-- `reconciliar_payment_requests_pendientes()` es SECURITY DEFINER y la dispara
-- pg_cron cada 15 minutos (20260717000000). Su migración original revocó
-- EXECUTE de PUBLIC, pero `authenticated` lo conserva por los privilegios por
-- defecto de Supabase — y producción lo confirma. No devuelve filas de la
-- tabla (sólo un contador), así que no es una vía de lectura; pero deja que
-- cualquier usuario autenticado dispare a mano un barrido que CAMBIA `estado`
-- en lote y lanza hasta 50 POST a confirm-charge. Nada en `src/` la invoca: su
-- único llamador es el cron, que corre como el dueño. Sin necesidad
-- demostrada, se cierra.
REVOKE EXECUTE ON FUNCTION public.reconciliar_payment_requests_pendientes() FROM authenticated;

COMMIT;

COMMENT ON TABLE public.payment_requests IS
  'Camino de dinero del pago en línea. SIN policy de SELECT y SIN GRANT de '
  'SELECT para anon/authenticated: la leen sólo service_role (BYPASSRLS) desde '
  'las edge functions de pago, y el agregado de superadmin_comisiones_resumen. '
  'Cualquier policy de SELECT que se agregue aquí tiene que acotar por fila '
  '(company_id / cliente_id) y justificar un consumidor real; USING (true) '
  'reabre la exposición sin autenticar que cerró 20260907001300.';
