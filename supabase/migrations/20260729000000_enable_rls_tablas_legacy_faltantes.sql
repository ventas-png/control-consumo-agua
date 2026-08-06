-- ════════════════════════════════════════════════════════════════════════════
-- Habilitar RLS en las 3 tablas de `public` que ninguna migración cubría
-- (auditoría 2026-07-28, Bloque A · PR-1).
--
-- POR QUÉ
-- `20260610000808_fix_tenant_isolation_phase1.sql` (#3) existe exactamente para
-- cerrar esta clase de bug — su comentario dice "prod ya tiene RLS en estas
-- tablas, pero el repo nunca la habilitaba → deploys frescos/staging quedaban
-- expuestos" — y habilita RLS en 8 tablas. OMITE estas tres:
--
--   · fuentes_agua   (baseline phase2:89)  ← 8 policies que hoy son CÓDIGO MUERTO
--   · empresa        (baseline phase2:53)  ← sin RLS y sin ninguna policy
--   · user_sessions  (baseline phase2:80)  ← policy deny-all que NUNCA se evalúa
--
-- Sin RLS, los grants por defecto de Supabase dan a `anon` y `authenticated`
-- DML completo sobre la tabla: con solo la anon key —que viaja en el bundle del
-- navegador— se leen y escriben todas las filas de todos los tenants. Y una
-- policy sobre una tabla con RLS deshabilitada no se evalúa jamás, así que las
-- 8 de `fuentes_agua` y la deny-all de `user_sessions` no protegen nada.
--
-- ALCANCE REAL
-- `scripts/security-guard.mjs` corre cada noche contra PROD exigiendo RLS +
-- ≥1 policy en toda tabla de `public`, con allowlist vacío. Si está en verde,
-- prod ya tiene RLS en las tres y esta migración es un NO-OP allí. Lo que
-- arregla es el drift: cualquier deploy fresco, preview branch o staging
-- provisionado desde el repo SÍ quedaba abierto. Es idempotente por diseño.
--
-- FIRMA DEL DRIFT: `src/test/rls/rlsHarness.test.ts:252-263` afirma que
-- `user_sessions` es deny-all y pasa contra prod — la aserción se cumple donde
-- RLS se habilitó a mano, y se cumpliría sin significar nada donde no.
-- ════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------
-- 1. fuentes_agua — activa las 8 policies existentes (select/insert/
--    update/delete, ya acotadas por `company_id = get_my_company_id()`
--    en 20260417000012:238 y 20260521000003:249,258,272).
--    No hace falta añadir policies: solo faltaba encender RLS.
-- ---------------------------------------------------------------------
ALTER TABLE public.fuentes_agua ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 2. user_sessions — activa la policy deny-all de
--    20260318000002_add_rls_policies_password_reset_tokens_and_user_sessions.sql:16.
--    `sess` es un blob de sesión serializado (express-session, legacy): si
--    quedan filas vivas, leerlas es toma de cuentas.
--
--    NO se dropea la tabla aunque esté marcada "legacy": el harness de RLS
--    la usa como caso de prueba de deny-all. Retirarla es un follow-up que
--    debe tocar harness + tabla a la vez.
-- ---------------------------------------------------------------------
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 3. empresa — caso distinto a los dos anteriores, leer con atención.
--
--    Esta tabla NO TIENE COLUMNA DE TENANT (id, nombre, direccion, telefono,
--    nit, logo_url), así que una policy acotada por empresa es imposible: no
--    hay por dónde acotarla. Y a diferencia de las otras dos, SÍ la lee código
--    vivo — `src/domain/agua/queries.ts:144` vía `useEmpresaQuery`, expuesta
--    por `useAguaData`. Encender RLS sin policy la volvería deny-all y
--    rompería esa lectura en silencio.
--
--    Lo que hace esta migración es un ENDURECIMIENTO ESTRICTO, no aislamiento
--    multi-tenant:
--      antes → `anon` y `authenticated` pueden LEER y ESCRIBIR todas las filas.
--      ahora → `anon` no puede nada; `authenticated` solo LEE.
--    No hay policy de INSERT/UPDATE/DELETE a propósito: con RLS encendida, la
--    ausencia de policy para esas operaciones las deniega.
--
--    OJO: esto NO aísla tenants entre sí — todos los usuarios autenticados ven
--    las mismas filas. No puede ser de otro modo mientras la tabla no tenga
--    columna de tenant. El comentario de `queries.ts:137` ("objeto único del
--    tenant, RLS lo scopea") es incorrecto hoy y se corrige en este PR.
--
--    FOLLOW-UP (fuera de alcance aquí): decidir si `empresa` se retira —
--    `companies` ya cubre la identidad del tenant— o si recibe `company_id`
--    con backfill. Hasta entonces, esta policy es el mínimo defendible.
-- ---------------------------------------------------------------------
ALTER TABLE public.empresa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa_select_authenticated" ON public.empresa;
CREATE POLICY "empresa_select_authenticated" ON public.empresa
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY "empresa_select_authenticated" ON public.empresa IS
  'Tabla legacy SIN columna de tenant: no admite acotación por empresa. Esta policy solo cierra el acceso de `anon` y deja la tabla en solo-lectura para autenticados; NO es aislamiento multi-tenant. Retirar la tabla o añadirle company_id es follow-up (auditoría 2026-07-28, Bloque A · PR-1).';
