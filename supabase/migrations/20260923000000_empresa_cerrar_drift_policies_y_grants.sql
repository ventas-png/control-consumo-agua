-- ════════════════════════════════════════════════════════════════════════════
-- empresa — cerrar el drift de SEGURIDAD · MEDIA (baseline desde 2026-09-01)
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ ES `empresa`. Una tabla legacy con la identidad de UNA empresa —id,
-- nombre, direccion, telefono, nit, logo_url— y SIN COLUMNA DE TENANT. Eso no
-- es un detalle: significa que no hay por dónde acotarla. Todos los usuarios
-- autenticados de todos los tenants ven exactamente las mismas filas, y no
-- puede ser de otro modo mientras la tabla siga sin `company_id`. La identidad
-- real del tenant vive en `companies`; esto es un residuo de antes.
--
-- ── EL HALLAZGO ────────────────────────────────────────────────────────────
--
-- #826 §3.3 declara `tabla:empresa/policies` como SEGURIDAD · MEDIA y lo deja
-- con el comportamiento deseado SIN DETERMINAR: «quitar las policies podría
-- romper la administración real». Producción tiene CINCO policies; el
-- repositorio declara UNA. Las cuatro que sobran:
--
--   · `empresa_insert_by_role`  — INSERT a `public`, guardada sólo por
--   · `empresa_update_by_role`  — UPDATE a `public`,  `current_user_role()`
--   · `empresa_delete_by_role`  — DELETE a `public`,  `= 'admin'`
--
--     `current_user_role()` es `SELECT role FROM app_users WHERE id =
--     auth.uid()`, y `app_users.role` es un rol POR EMPRESA. El predicado
--     mira el rol y NO mira de qué empresa es: cualquier admin de cualquier
--     tenant inserta, modifica o borra las filas que todos los demás leen.
--     No es un permiso de más — es que la puerta no comprueba de dónde viene
--     quien la cruza.
--
--     No es explotable por `anon`: sin sesión `auth.uid()` es NULL,
--     `current_user_role()` devuelve NULL y `NULL = 'admin'` no es TRUE. La
--     cláusula `TO public` asusta más de lo que hace. Pero ver la nota sobre
--     los grants más abajo, porque ahí sí está el arma cargada.
--
--   · `empresa_select_by_role` — SELECT a `authenticated` con una lista de
--     diez roles. Conviviendo con `empresa_select_authenticated`, que es
--     `USING (true)`, no concede ni deniega nada: dos policies permisivas se
--     unen con OR, así que la lista de roles es ruido que aparenta control.
--
-- ── EL COMPORTAMIENTO DESEADO, DETERMINADO ─────────────────────────────────
--
-- #826 lo dejó abierto; se cierra acá con el mismo método que esa auditoría
-- aplicó a `security_logs` — buscar quién llama de verdad:
--
--   ESCRITORES: ninguno. Ni una migración, ni un script, ni `src/`, ni una
--   sola edge function escribe esta tabla. Se buscaron INSERT/UPDATE/DELETE
--   sobre `public.empresa` en todo el repositorio y no hay ninguno.
--
--   LECTORES: uno solo, `useEmpresaQuery` (`src/domain/agua/queries.ts`), que
--   hace `select('*').limit(1)` SIN filtro y devuelve `rows[0]`.
--
-- Con cero escritores, las tres policies de escritura no tienen un llamador
-- legítimo que proteger, y la cuarta no concede nada. El lado correcto es el
-- REPOSITORIO, y la postura que ya razonó `20260729000000` —RLS encendida,
-- `anon` nada, `authenticated` sólo lectura— sigue siendo el mínimo
-- defendible. Esta migración la hace valer también en producción.
--
-- ── LA SEGUNDA CAPA: LOS GRANTS ────────────────────────────────────────────
--
-- Misma lección que 20260910000001 dejó escrita para `security_logs`. Hoy
-- `anon` y `authenticated` tienen los SIETE privilegios sobre `empresa`, por
-- el grant por defecto que Supabase da sobre `public` — y en esto producción y
-- el repositorio COINCIDEN (el grupo `tabla:empresa/grants` no está en la
-- baseline, que es como se sabe que no difieren). La RLS los contiene, pero es
-- una sola capa, y es la que falló: `empresa_insert_by_role` sólo llega a ser
-- algo PORQUE `authenticated` además tiene el grant de INSERT. Quitar las
-- policies y dejar los grants deja cargada la siguiente policy permisiva que
-- alguien agregue a mano. Se cierran las dos.
--
-- ── LA POSTURA QUE QUEDA ───────────────────────────────────────────────────
--
--   RLS            habilitada (no se toca; se re-afirma)
--   policies       UNA: `empresa_select_authenticated`, la del repositorio.
--                  Ninguna de INSERT/UPDATE/DELETE: con RLS activa, su
--                  ausencia las deniega.
--   anon           NADA. Ni un privilegio.
--   authenticated  SELECT y nada más. Lo necesita para que la policy pueda
--                  concederle algo: una policy se evalúa con el rol que
--                  consulta, y sin el grant de tabla no leería igual.
--   service_role   SELECT. No escribe nadie, así que no se le deja escribir.
--   postgres       intacto — el dueño sigue pudiendo sembrar o purgar, así que
--                  esto no deja la tabla sin mantenimiento posible.
--
-- ── LO QUE ESTO **NO** ES ──────────────────────────────────────────────────
--
-- NO es aislamiento multi-tenant, y no puede serlo: sin columna de tenant,
-- todos los autenticados siguen viendo las mismas filas. Lo que cierra es la
-- ESCRITURA cruzada, que es lo que #826 marcó. El aislamiento de verdad exige
-- decidir el follow-up que `20260729000000` ya dejó anotado —retirar la tabla,
-- porque `companies` cubre la identidad del tenant, o darle `company_id` con
-- backfill— y eso necesita mirar las filas de producción y una decisión de
-- producto. No se hace acá.
--
-- ── QUÉ CAMBIA DE CADA LADO ────────────────────────────────────────────────
--
--   · Los cuatro `DROP POLICY` sólo hacen algo en PRODUCCIÓN: el repositorio
--     nunca declaró esas policies, así que sobre la reconstrucción son no-ops.
--   · Los REVOKE/GRANT hacen algo en LOS DOS lados, porque hoy los grants son
--     idénticos. El auditor clasificará `tabla:empresa/grants` como CAMBIO
--     PLANIFICADO (P == M, R ≠ M) hasta que esto llegue a producción.
--
-- La entrada `tabla:empresa/policies` de `drift-conocido.json` NO se retira
-- acá: se retira cuando el auditor demuestre la convergencia con una huella de
-- producción tomada DESPUÉS de aplicar esto. Ni se amplía la baseline ni se
-- tocan hashes.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Las cuatro policies que sobran ─────────────────────────────────────
-- `IF EXISTS`: en la reconstrucción no existen, y la migración tiene que
-- aplicar igual sobre una base limpia.
DROP POLICY IF EXISTS "empresa_insert_by_role" ON public.empresa;
DROP POLICY IF EXISTS "empresa_update_by_role" ON public.empresa;
DROP POLICY IF EXISTS "empresa_delete_by_role" ON public.empresa;
DROP POLICY IF EXISTS "empresa_select_by_role" ON public.empresa;

-- ── 2 · La RLS sigue habilitada ────────────────────────────────────────────
-- Idempotente. Se re-afirma para que la postura quede escrita en un solo sitio
-- y no dependa de que nadie la haya apagado por fuera.
ALTER TABLE public.empresa ENABLE ROW LEVEL SECURITY;

-- ── 3 · La única policy autoritativa, re-declarada ─────────────────────────
-- Misma definición que `20260729000000`: sobre la reconstrucción el par
-- DROP+CREATE deja el objeto idéntico y no mueve la huella (el hash de
-- `/policies` cubre nombre, cmd, roles, permisividad, USING y WITH CHECK — no
-- el COMMENT). Se repite para que producción termine con EXACTAMENTE ésta y no
-- con una variante editada a mano.
DROP POLICY IF EXISTS "empresa_select_authenticated" ON public.empresa;
CREATE POLICY "empresa_select_authenticated" ON public.empresa
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY "empresa_select_authenticated" ON public.empresa IS
  'Tabla legacy SIN columna de tenant: no admite acotación por empresa, así que esto NO es aislamiento multi-tenant — todos los autenticados leen las mismas filas. Cierra el acceso de anon y deja la tabla en solo-lectura; la ausencia deliberada de policies de INSERT/UPDATE/DELETE las deniega. Retirar la tabla (companies ya cubre la identidad del tenant) o darle company_id con backfill sigue siendo follow-up. Auditoría 2026-07-28 (Bloque A · PR-1); escritura cruzada y grants cerrados en 20260923000000 (#826 §3.3).';

-- ── 4 · Los grants: cerrar y volver a abrir sólo lo necesario ──────────────
-- `FROM PUBLIC` primero y por separado: un privilegio HEREDADO de PUBLIC no se
-- quita revocándoselo al rol. Misma lección ya pagada en 20260729000700,
-- 20260825010000, 20260909000000 y 20260910000001.
REVOKE ALL ON public.empresa FROM PUBLIC;
REVOKE ALL ON public.empresa FROM anon;
REVOKE ALL ON public.empresa FROM authenticated;
REVOKE ALL ON public.empresa FROM service_role;

GRANT SELECT ON public.empresa TO authenticated;  -- sin esto, la policy no concede nada
GRANT SELECT ON public.empresa TO service_role;

-- ── 5 · Verificación DENTRO de la propia migración ─────────────────────────
--
-- Un REVOKE sin autoridad no falla: emite un WARNING y sale 0. Si esto se
-- aplicara con un rol que no puede revocar, la migración quedaría registrada
-- como aplicada con la puerta abierta. Se mide el RESULTADO y se aborta.
--
-- Los roles se comprueban con guardas de existencia: los arneses de
-- `supabase/tests/` levantan clústeres donde `anon` o `service_role` pueden no
-- existir, y ahí la ausencia del rol es la ausencia del privilegio.
DO $verificar$
DECLARE
  v_priv text;
  v_rol  text;
  v_n    int;
BEGIN
  -- (a) Nadie salvo el dueño escribe: ni anon, ni authenticated, ni service_role.
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol);
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_rol, 'public.empresa', v_priv) THEN
        RAISE EXCEPTION 'empresa: % conserva % después del REVOKE', v_rol, v_priv
          USING HINT = 'El REVOKE no tuvo autoridad, o algo volvió a conceder el privilegio.';
      END IF;
    END LOOP;
  END LOOP;

  -- (b) anon tampoco lee.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND has_table_privilege('anon', 'public.empresa', 'SELECT') THEN
    RAISE EXCEPTION 'empresa: anon conserva SELECT después del REVOKE';
  END IF;

  -- (c) authenticated SÍ conserva SELECT: sin el grant de tabla, la policy no
  --     llega a conceder nada y useEmpresaQuery se rompería en silencio.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND NOT has_table_privilege('authenticated', 'public.empresa', 'SELECT') THEN
    RAISE EXCEPTION 'empresa: authenticated se quedó sin SELECT'
      USING HINT = 'Una policy se evalúa con el rol que consulta: sin el grant, USING (true) no alcanza.';
  END IF;

  -- (d) RLS habilitada.
  IF NOT (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'empresa') THEN
    RAISE EXCEPTION 'empresa: la RLS quedó DESHABILITADA';
  END IF;

  -- (e) UNA sola policy, y es la autoritativa. Se mira lo que QUEDA, no que el
  --     DROP haya corrido: un DROP que no encuentra la policy no es error para
  --     Postgres, así que contar los DROP no probaría nada.
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'empresa';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'empresa: quedaron % policies, se esperaba exactamente 1', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'empresa'
                    AND policyname = 'empresa_select_authenticated' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'empresa: la policy que queda no es empresa_select_authenticated';
  END IF;
END
$verificar$;
