-- ============================================================================
-- Habilitación fiscal "selecciona y conecta" — serv:S11 (épica #305).
-- Config fiscal POR LOCACIÓN (override de empresa) + BÓVEDA de credenciales PAC.
-- ============================================================================
-- Banda de migración EXCLUSIVA de este PR: 20260604230000–20260604235959.
--
-- CONTEXTO (follow-up del núcleo FEL/CFDI, migración 20260604220000 / PR #387):
--   El núcleo agnóstico ya puso la config fiscal del EMISOR a nivel EMPRESA
--   (companies.regimen_fiscal/rfc/nombre_fiscal/proveedor_timbrado) y la tabla
--   de comprobantes documentos_fiscales. Este PR habilita que cada EMPRESA y
--   LOCACIÓN elija su PAC y solo conecte credenciales:
--     1. Config fiscal por LOCACIÓN (columnas nullable en `projects`) que hace
--        OVERRIDE de la config de la empresa cuando está presente.
--     2. BÓVEDA de credenciales del PAC (tabla `fiscal_pac_secrets`), keyed por
--        (company_id, project_id) — project_id NULL = nivel empresa.
--
-- LOCACIÓN = `projects`. Cada empresa tiene varios proyectos/locaciones
--   (condominios / sistemas de agua). El identificador tributario, el régimen,
--   el establecimiento (GT) y el lugar de expedición / serie (MX) pueden diferir
--   por locación (sucursales con NIT/establecimiento propio, o CSD distinto en
--   MX), de ahí el override.
--
-- SEMÁNTICA DEL OVERRIDE (la implementa resolverConfigFiscalEfectiva en
--   src/lib/businessFiscal.ts y su espejo Deno):
--     config_efectiva.campo = projects.campo ?? companies.campo
--   Es decir, CADA columna fiscal nullable en projects, si NO es NULL, gana
--   sobre la de la empresa; si es NULL, se HEREDA de la empresa. Todas son
--   nullable a propósito: "NULL = hereda de la empresa". El régimen se resuelve
--   igual (projects.regimen_fiscal ?? companies.regimen_fiscal).
--
-- PATRÓN DE SECRETOS (réplica EXACTA de company_payment_secrets,
--   create_payment_secrets_table 20260408000001 + add_rls_policy
--   20260409000004): PostgreSQL no soporta RLS por columna, así que el SECRETO
--   vive en una tabla SEPARADA con RLS habilitado + una policy "deny all"
--   (USING false / WITH CHECK false). Resultado: SOLO service_role (que bypassa
--   RLS) puede leer/escribir el secreto. El cliente NUNCA lo lee — lee el
--   ESTATUS/metadata (proveedor + estado_conexion) por una vista segura o RPC,
--   nunca las credenciales. Aquí NO hay GRANT a anon/authenticated.
--
-- POR QUÉ TABLA NUEVA (y no columnas en projects/companies):
--   - Igual que payment_secrets: separar el secreto de la fila visible es la
--     ÚNICA forma de ocultar una columna sensible bajo RLS de tabla.
--   - Keyed por (company_id, project_id NULL=empresa) → soporta credenciales a
--     nivel empresa (compartidas) y override por locación, espejando el override
--     de la config fiscal.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CREATE TABLE/INDEX IF NOT EXISTS,
--   DROP CONSTRAINT/POLICY/TRIGGER IF EXISTS + recreate. Re-ejecutable.
--
-- SEGURIDAD (lección 20260603120000 / 20260604200000 / 20260604220000): la única
--   función nueva es SECURITY INVOKER (trigger updated_at). Aun así se le revoca
--   EXECUTE a public/anon/authenticated por nombre. La vista de ESTATUS es
--   security_invoker (no DEFINER) y solo expone metadata NO sensible.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Config fiscal por LOCACIÓN — columnas nullable en `projects`.
--    Todas NULL = "hereda de la empresa". Si NO son NULL, hacen OVERRIDE de la
--    columna homónima en companies (resolverConfigFiscalEfectiva).
-- ────────────────────────────────────────────────────────────────────────────

-- Régimen fiscal de la locación. NULL = hereda companies.regimen_fiscal.
--   'fel_gt' | 'cfdi_mx' | 'ninguno'. A diferencia de companies (NOT NULL DEFAULT
--   'ninguno'), aquí es NULLABLE: una locación sin valor usa el de la empresa.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS regimen_fiscal text;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_regimen_fiscal_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_regimen_fiscal_check
  CHECK (regimen_fiscal IS NULL OR regimen_fiscal IN ('fel_gt', 'cfdi_mx', 'ninguno'));

-- NIT emisor de la locación (Guatemala). NULL = hereda companies.nit/tax_id.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS nit text;

-- RFC emisor de la locación (México). NULL = hereda companies.rfc.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS rfc text;

-- Razón social / nombre fiscal del emisor en la locación. NULL = hereda
-- companies.nombre_fiscal (que a su vez cae a companies.nombre).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS nombre_fiscal text;

-- PAC/Certificador que timbra los comprobantes de la locación. NULL = hereda
-- companies.proveedor_timbrado. Texto libre (resuelto por getFiscalProvider).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS proveedor_timbrado text;

-- ESTABLECIMIENTO (Guatemala / FEL): código de establecimiento del emisor ante
-- SAT GT (un NIT puede tener varios establecimientos; cada sucursal/locación
-- factura con el suyo). NULL = hereda companies (no existe a nivel empresa hoy:
-- en ese caso el builder usa el default del PAC). Solo aplica a fel_gt.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS establecimiento text;

-- LUGAR DE EXPEDICIÓN (México / CFDI 4.0): código postal del lugar de expedición
-- del comprobante (atributo LugarExpedicion del CFDI). Suele ser el CP del CSD/
-- sucursal de la locación. NULL = hereda companies.address_postal_code. Solo
-- aplica a cfdi_mx.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS lugar_expedicion text;

-- SERIE FISCAL (México / CFDI): serie del folio del comprobante por locación
-- (cada sucursal puede emitir con su propia serie). NULL = sin serie (el PAC/
-- builder decide). Solo aplica a cfdi_mx.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS serie_fiscal text;

COMMENT ON COLUMN public.projects.regimen_fiscal IS
  'Override del régimen fiscal por locación (serv:S11). NULL = hereda companies.regimen_fiscal. fel_gt|cfdi_mx|ninguno. Lo resuelve resolverConfigFiscalEfectiva.';
COMMENT ON COLUMN public.projects.nit IS
  'NIT emisor por locación (Guatemala/FEL). NULL = hereda companies.nit/tax_id. Override por sucursal con NIT propio.';
COMMENT ON COLUMN public.projects.rfc IS
  'RFC emisor por locación (México/CFDI). NULL = hereda companies.rfc.';
COMMENT ON COLUMN public.projects.nombre_fiscal IS
  'Razón social del emisor por locación. NULL = hereda companies.nombre_fiscal (que cae a companies.nombre).';
COMMENT ON COLUMN public.projects.proveedor_timbrado IS
  'PAC/Certificador por locación (serv:S11). NULL = hereda companies.proveedor_timbrado. Las CREDENCIALES NO van aquí: van en fiscal_pac_secrets (service-role-only).';
COMMENT ON COLUMN public.projects.establecimiento IS
  'Código de establecimiento del emisor ante SAT GT (FEL). NULL = default. Solo aplica a regimen_fiscal=fel_gt.';
COMMENT ON COLUMN public.projects.lugar_expedicion IS
  'Lugar de expedición del CFDI (México): CP del CSD/sucursal. NULL = hereda companies.address_postal_code. Solo aplica a cfdi_mx.';
COMMENT ON COLUMN public.projects.serie_fiscal IS
  'Serie del folio del comprobante por locación (México/CFDI). NULL = sin serie. Solo aplica a cfdi_mx.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. BÓVEDA de credenciales del PAC — tabla `fiscal_pac_secrets`.
--    Patrón EXACTO de company_payment_secrets: RLS habilitado + policy "deny
--    all" → SOLO service_role accede. El cliente jamás lee el secreto.
--    Keyed por (company_id, project_id NULL=nivel empresa) para soportar
--    credenciales compartidas de la empresa y override por locación.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fiscal_pac_secrets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant dueño de las credenciales. ON DELETE CASCADE: si se borra la empresa,
  -- sus credenciales del PAC se van con ella.
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Locación cuyas credenciales son éstas. NULL = credenciales a NIVEL EMPRESA
  -- (compartidas por las locaciones que no tengan las suyas). ON DELETE CASCADE:
  -- borrar la locación borra su override de credenciales.
  project_id      uuid        REFERENCES public.projects(id) ON DELETE CASCADE,

  -- PAC/Certificador al que pertenecen estas credenciales (ej. 'sandbox',
  -- 'infile', 'guatefactura', 'facturama', 'finkok'). Snapshot informativo;
  -- el proveedor efectivo lo decide la config fiscal (proveedor_timbrado).
  proveedor       text        NOT NULL DEFAULT 'sandbox',

  -- Credenciales del PAC, separadas por ambiente. jsonb opaco para el resto del
  -- sistema: SOLO el adapter (service_role, en el edge) lo lee. Forma sugerida:
  --   { "sandbox": { ... }, "prod": { ... } }
  -- (usuario/clave/token/certificado-base64/llave, según el PAC). NUNCA se
  -- proyecta al cliente.
  credenciales    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Resultado del último "probar conexión" contra el PAC (lo escribe el edge
  -- fiscal-test-connection). Metadata NO sensible: SÍ se puede exponer al
  -- cliente (vía la vista de estatus), a diferencia de `credenciales`.
  --   'desconocido' → nunca se probó.
  --   'ok'          → el último ping respondió bien.
  --   'error'       → el último ping falló (ver estado_mensaje).
  estado_conexion text        NOT NULL DEFAULT 'desconocido'
                              CHECK (estado_conexion IN ('desconocido', 'ok', 'error')),

  -- Mensaje legible del último ping (NULL si nunca se probó / si fue ok sin nota).
  estado_mensaje  text,

  -- Cuándo se probó la conexión por última vez (NULL = nunca).
  estado_probado_en timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Unicidad por (company_id, project_id): UNA fila de credenciales por locación
-- (y una por empresa cuando project_id IS NULL). NULLS NOT DISTINCT trata el
-- NULL de empresa como un único valor, así no se duplican credenciales de nivel
-- empresa. Sirve además de target para ON CONFLICT (upsert) del edge.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_pac_secrets_company_project
  ON public.fiscal_pac_secrets (company_id, project_id) NULLS NOT DISTINCT;

-- Lookup por tenant (listar credenciales de una empresa).
CREATE INDEX IF NOT EXISTS idx_fiscal_pac_secrets_company_id
  ON public.fiscal_pac_secrets (company_id);

-- updated_at automático. SECURITY INVOKER (no DEFINER): no escala privilegios.
CREATE OR REPLACE FUNCTION public.set_fiscal_pac_secrets_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Aunque es función TRIGGER, se revoca EXECUTE a public/anon/authenticated por
-- nombre (lección 20260603120000): no se asume que revocar PUBLIC cubra a
-- anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.set_fiscal_pac_secrets_updated_at()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fiscal_pac_secrets_updated_at ON public.fiscal_pac_secrets;
CREATE TRIGGER trg_fiscal_pac_secrets_updated_at
  BEFORE UPDATE ON public.fiscal_pac_secrets
  FOR EACH ROW EXECUTE FUNCTION public.set_fiscal_pac_secrets_updated_at();

-- RLS habilitado + policy "deny all" = SOLO service_role accede (idéntico a
-- company_payment_secrets / add_rls_policy_company_payment_secrets). El cliente
-- NUNCA lee/escribe esta tabla; lo hacen las edge functions con service_role.
ALTER TABLE public.fiscal_pac_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny access to all" ON public.fiscal_pac_secrets;
CREATE POLICY "Deny access to all" ON public.fiscal_pac_secrets
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "Deny access to all" ON public.fiscal_pac_secrets IS
  'Deny all access except service_role. Esta tabla contiene credenciales del PAC y solo debe accederse desde Edge Functions con service_role key (patrón company_payment_secrets).';

COMMENT ON TABLE public.fiscal_pac_secrets IS
  'Bóveda de credenciales del PAC/Certificador (serv:S11, épica #305). Keyed por (company_id, project_id NULL=nivel empresa). RLS service-role-only (policy "Deny access to all"): el cliente NUNCA lee `credenciales`. La escritura y el "probar conexión" los hacen edge functions (fiscal-test-connection / timbrar-documento) con service_role. El estatus NO sensible (proveedor + estado_conexion) se expone vía la RPC fiscal_pac_estatus.';
COMMENT ON COLUMN public.fiscal_pac_secrets.project_id IS
  'Locación de las credenciales. NULL = nivel empresa (compartidas). Espeja el override de la config fiscal por locación.';
COMMENT ON COLUMN public.fiscal_pac_secrets.credenciales IS
  'Credenciales del PAC por ambiente { sandbox, prod }. jsonb OPACO: SOLO el adapter (service_role) lo lee. NUNCA se proyecta al cliente.';
COMMENT ON COLUMN public.fiscal_pac_secrets.estado_conexion IS
  'Resultado del último "probar conexión": desconocido|ok|error. Metadata NO sensible (expuesta vía la RPC fiscal_pac_estatus).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RPC de ESTATUS por tenant (SECURITY DEFINER acotado).
--    Como fiscal_pac_secrets es deny-all bajo RLS (ni siquiera authenticated ve
--    filas), exponemos el ESTATUS NO sensible vía una RPC SECURITY DEFINER que:
--      - valida que el llamante sea admin/owner del tenant (o super_admin),
--      - devuelve SOLO metadata (proveedor + estado_conexion + flags), NUNCA
--        `credenciales`.
--    Esto permite a la UI mostrar "conectado/sin conectar" sin que el secreto
--    salga jamás de service_role.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fiscal_pac_estatus(p_company_id uuid)
RETURNS TABLE (
  id                uuid,
  company_id        uuid,
  project_id        uuid,
  proveedor         text,
  estado_conexion   text,
  estado_mensaje    text,
  estado_probado_en timestamptz,
  tiene_sandbox     boolean,
  tiene_prod        boolean,
  created_at        timestamptz,
  updated_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Autorización: super_admin ve cualquier tenant; admin/owner solo el suyo.
  IF NOT (
    public.is_super_admin()
    OR (
      p_company_id = public.get_my_company_id()
      AND public.current_user_role() IN ('company_owner', 'admin')
    )
  ) THEN
    RAISE EXCEPTION 'No autorizado para consultar el estatus fiscal de este tenant';
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.company_id, s.project_id, s.proveedor,
    s.estado_conexion, s.estado_mensaje, s.estado_probado_en,
    (s.credenciales ? 'sandbox') AS tiene_sandbox,
    (s.credenciales ? 'prod')    AS tiene_prod,
    s.created_at, s.updated_at
  FROM public.fiscal_pac_secrets s
  WHERE s.company_id = p_company_id;
END;
$$;

-- SECURITY DEFINER → cerrar el RPC directo a roles no esperados por nombre
-- (lección 20260603120000 / 20260604210000) y conceder solo a authenticated
-- (la propia función valida rol) + service_role.
REVOKE EXECUTE ON FUNCTION public.fiscal_pac_estatus(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_pac_estatus(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.fiscal_pac_estatus(uuid) IS
  'Estatus NO sensible de credenciales del PAC por tenant (serv:S11). SECURITY DEFINER acotado: valida admin/owner del tenant (o super_admin) y devuelve SOLO metadata (proveedor + estado_conexion + flags tiene_sandbox/tiene_prod), NUNCA el jsonb `credenciales`. El secreto jamás sale de service_role.';
