-- ============================================================================
-- Núcleo de Facturación Electrónica Fiscal FEL/CFDI — serv:S11 (épica #305)
-- PROVIDER-AGNOSTIC: modelo de datos + config fiscal de emisor/receptor.
-- ============================================================================
-- Banda de migración EXCLUSIVA de este PR: 20260604220000–20260604225959.
--
-- CONTEXTO (follow-up del agregado Factura de T4, migración 20260604160000):
--   La Factura de agua vive como columnas de estado/IVA/mora sobre `registros`
--   (agua:C4). Este PR agrega la capa FISCAL por encima: el comprobante que se
--   declara ante la autoridad tributaria.
--     - Guatemala (FEL): un DTE (Documento Tributario Electrónico) se firma y
--       CERTIFICA vía un Certificador autorizado (GFACE/PAC) ante SAT, que
--       devuelve número de AUTORIZACIÓN (UUID), serie y número.
--     - México (CFDI 4.0): el comprobante se TIMBRA por un PAC, que devuelve
--       UUID (folio fiscal) + sello.
--
--   Este PR es FOUNDATION y AGNÓSTICO DE PROVEEDOR: NO integra ningún PAC real
--   ni guarda credenciales. El timbrado real (HTTP al certificador) es un
--   follow-up que decide el dueño (proveedor + creds en Vault). Aquí queda el
--   MODELO + el enganche para un adapter pluggable (ver supabase/functions/
--   _shared/fiscal/ y la edge function timbrar-documento).
--
-- POR QUÉ TABLA NUEVA `documentos_fiscales` (y NO más columnas en `registros`):
--   - Cardinalidad 1:N — una Factura (registro) puede generar varios documentos
--     fiscales a lo largo de su vida: el comprobante original, una nota de
--     crédito posterior, un reintento tras un rechazo del PAC, etc.
--   - El payload fiscal (request/response del certificador, sellos, cadenas)
--     es voluminoso y de naturaleza distinta al cobro; mezclarlo en `registros`
--     ensuciaría la entidad de cobro que ya consume toda la UI de agua.
--   - Ciclo de vida propio (borrador→por_timbrar→timbrado/rechazado→cancelado)
--     independiente de la máquina de estados de cobro de la Factura.
--
-- CONFIG FISCAL DEL EMISOR (companies): se REUSA lo que ya existe
--   (`nit`, `tax_id`, `tax_id_type`, `country`, `address_line1/city/state/
--   postal_code`, `iva_tasa_default`); se agregan SOLO los campos fiscales
--   faltantes (régimen, rfc, nombre fiscal, proveedor de timbrado).
-- CONFIG FISCAL DEL RECEPTOR (clientes): `cui_dui`/`numero_facturacion` son ID
--   personal / nº de cuenta, NO el identificador tributario del comprobante; se
--   agregan `nit`/`rfc`/`nombre_fiscal`/`uso_cfdi` (faltantes).
--
-- RLS: hereda el patrón de tenant del repo (get_my_company_id() + roles +
--   is_super_admin()), igual que user_invitations (20260604130000). La escritura
--   del comprobante la hace la edge function `timbrar-documento` con
--   service_role (bypassa RLS); las policies cubren además lectura del tenant.
--
-- SEGURIDAD (lección 20260603120000 / 20260604200000): la única función nueva es
--   SECURITY INVOKER (trigger updated_at, no SECURITY DEFINER), así que NO añade
--   superficie de escalada vía RPC. Aun así se le revoca EXECUTE a public/anon/
--   authenticated por nombre (los triggers no dependen del grant del rol) — y NO
--   hay GRANT a anon/authenticated en la tabla.
--
-- IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--   DROP CONSTRAINT/POLICY IF EXISTS + recreate. Re-ejecutable sin efectos.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Config fiscal del EMISOR por tenant (columnas en `companies`).
--    Reusa nit/tax_id/dirección/iva ya existentes; agrega solo lo fiscal nuevo.
-- ────────────────────────────────────────────────────────────────────────────

-- Régimen fiscal del tenant: define qué motor de comprobante aplica.
--   'fel_gt'  → Factura Electrónica en Línea (Guatemala, SAT).
--   'cfdi_mx' → CFDI 4.0 (México, SAT MX).
--   'ninguno' → el tenant no emite comprobante fiscal (default; no rompe nada).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS regimen_fiscal text NOT NULL DEFAULT 'ninguno';

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_regimen_fiscal_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_regimen_fiscal_check
  CHECK (regimen_fiscal IN ('fel_gt', 'cfdi_mx', 'ninguno'));

-- RFC del emisor (México). El NIT de GT ya vive en companies.nit / tax_id; aquí
-- se agrega el RFC para tenants MX (nullable: solo aplica a cfdi_mx).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS rfc text;

-- Razón social / nombre fiscal del emisor para el comprobante (puede diferir del
-- `nombre` comercial). Nullable: si NULL, el builder cae a `nombre`.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS nombre_fiscal text;

-- Qué proveedor (PAC / Certificador) timbra los comprobantes de este tenant.
-- Texto libre por ahora (ej. 'sandbox', 'infile', 'guatefactura', 'facturama',
-- 'finkok'); lo resuelve getFiscalProvider() en el adapter. Default 'sandbox'
-- para que dev/test funcione sin configurar un PAC real.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS proveedor_timbrado text NOT NULL DEFAULT 'sandbox';

COMMENT ON COLUMN public.companies.regimen_fiscal IS
  'Régimen de facturación electrónica del tenant (serv:S11): fel_gt (Guatemala/SAT) | cfdi_mx (México/SAT MX) | ninguno. Lo consume getFiscalProvider() del adapter.';
COMMENT ON COLUMN public.companies.rfc IS
  'RFC del emisor (México/CFDI). El NIT de Guatemala vive en companies.nit/tax_id. Nullable: solo aplica a regimen_fiscal=cfdi_mx.';
COMMENT ON COLUMN public.companies.nombre_fiscal IS
  'Razón social del emisor para el comprobante fiscal (puede diferir del nombre comercial). Si NULL, el builder del DTE usa companies.nombre.';
COMMENT ON COLUMN public.companies.proveedor_timbrado IS
  'PAC/Certificador que timbra los comprobantes del tenant (serv:S11). default sandbox. Las CREDENCIALES del PAC NO van aquí: van en Vault/tabla de secretos (follow-up), igual que company_payment_secrets.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Datos fiscales del RECEPTOR (columnas en `clientes`).
--    cui_dui/numero_facturacion ya existen pero son ID personal / nº de cuenta;
--    aquí va el identificador TRIBUTARIO que exige el comprobante.
-- ────────────────────────────────────────────────────────────────────────────

-- NIT del receptor (Guatemala). 'CF' (Consumidor Final) es válido cuando el
-- receptor no proporciona NIT; el builder/validador lo contempla. Nullable.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS nit text;

-- RFC del receptor (México). Nullable (solo aplica a cfdi_mx).
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS rfc text;

-- Nombre/razón social fiscal del receptor (puede diferir de `nombre`). Nullable.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS nombre_fiscal text;

-- Uso del CFDI (México): catálogo c_UsoCFDI del SAT MX (ej. 'G03' gastos en
-- general, 'P01' por definir). Texto libre por ahora; la UI lo restringirá al
-- catálogo. Nullable: solo aplica a cfdi_mx.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS uso_cfdi text;

COMMENT ON COLUMN public.clientes.nit IS
  'NIT tributario del receptor (Guatemala/FEL). ''CF'' = Consumidor Final cuando no proporciona NIT. Distinto de cui_dui (documento de identidad personal).';
COMMENT ON COLUMN public.clientes.rfc IS
  'RFC del receptor (México/CFDI). Nullable: solo aplica a regimen_fiscal=cfdi_mx.';
COMMENT ON COLUMN public.clientes.nombre_fiscal IS
  'Razón social del receptor para el comprobante fiscal (puede diferir del nombre del cliente).';
COMMENT ON COLUMN public.clientes.uso_cfdi IS
  'Uso del CFDI (catálogo c_UsoCFDI SAT MX, ej. G03/P01). Nullable: solo aplica a cfdi_mx.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Tabla `documentos_fiscales` — el comprobante fiscal (DTE/CFDI).
--    company_id denormalizado (FK→companies) para RLS limpia vía
--    get_my_company_id() — `registros` no expone company_id directo (scopea por
--    project_id→projects.company_id), así que duplicarlo aquí evita un join en
--    cada policy y sigue el patrón dominante de ~150 tablas del repo.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documentos_fiscales (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant (denormalizado para RLS). ON DELETE CASCADE: si se borra la empresa,
  -- sus comprobantes se van con ella.
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Factura origen (el `registro` de agua). ON DELETE RESTRICT: un comprobante
  -- fiscal timbrado es un registro legal — no debe borrarse la Factura mientras
  -- exista su documento fiscal. Nullable para permitir comprobantes futuros no
  -- ligados a un registro (no se usa hoy, pero no fuerza el FK).
  registro_id     uuid        REFERENCES public.registros(id) ON DELETE RESTRICT,

  -- Régimen del comprobante (snapshot del tenant al crearlo).
  regimen         text        NOT NULL
                              CHECK (regimen IN ('fel_gt', 'cfdi_mx')),

  -- Tipo de comprobante. Extensible (CHECK, no enum, para agregar tipos sin
  -- migración de tipo). 'factura' es el caso base; el resto son follow-up.
  tipo            text        NOT NULL DEFAULT 'factura'
                              CHECK (tipo IN (
                                'factura', 'nota_credito', 'nota_debito',
                                'recibo', 'nota_abono'
                              )),

  -- Estado del ciclo de vida fiscal (máquina en src/lib/businessFiscal.ts y su
  -- espejo Deno en _shared/fiscal/). borrador→por_timbrar→{timbrado|rechazado};
  -- timbrado→cancelado. rechazado puede reintentarse (→por_timbrar).
  estado          text        NOT NULL DEFAULT 'borrador'
                              CHECK (estado IN (
                                'borrador', 'por_timbrar', 'timbrado',
                                'rechazado', 'cancelado'
                              )),

  -- Proveedor (PAC/Certificador) que procesó/procesará el documento. Snapshot
  -- de companies.proveedor_timbrado al momento de timbrar (ej. 'sandbox').
  proveedor       text,

  -- Payload CANÓNICO enviado a timbrar (forma intermedia provider-agnostic, el
  -- "DTE canónico" que arma businessFiscal.construirDteCanonico). jsonb para
  -- auditar exactamente qué se mandó.
  request_payload jsonb,

  -- Respuesta cruda del proveedor (UUID, sellos, cadenas, errores). jsonb.
  response_payload jsonb,

  -- Identificadores fiscales devueltos por el certificador (NULL hasta timbrar):
  uuid_fiscal         text,   -- UUID de autorización (GT) / folio fiscal (MX).
  serie               text,   -- Serie del comprobante.
  numero              text,   -- Número correlativo del comprobante.
  numero_autorizacion text,   -- Nº de autorización SAT (GT); en MX suele = uuid_fiscal.
  fecha_certificacion timestamptz,  -- Cuándo certificó/timbró el PAC.

  -- Mensaje de error del último intento fallido (NULL si no hubo). Texto legible.
  error           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Índices:
--   - por estado: tableros / colas de timbrado ("¿qué está por_timbrar?").
--   - por registro_id: "¿qué comprobante(s) tiene esta Factura?".
--   - por uuid_fiscal: lookup de cancelación / consulta de estado al PAC.
CREATE INDEX IF NOT EXISTS idx_documentos_fiscales_estado
  ON public.documentos_fiscales(estado);

CREATE INDEX IF NOT EXISTS idx_documentos_fiscales_registro_id
  ON public.documentos_fiscales(registro_id);

CREATE INDEX IF NOT EXISTS idx_documentos_fiscales_company_id
  ON public.documentos_fiscales(company_id);

CREATE INDEX IF NOT EXISTS idx_documentos_fiscales_uuid_fiscal
  ON public.documentos_fiscales(uuid_fiscal)
  WHERE uuid_fiscal IS NOT NULL;

-- updated_at automático. SECURITY INVOKER (no DEFINER): no escala privilegios.
CREATE OR REPLACE FUNCTION public.set_documentos_fiscales_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Lección de seguridad (20260603120000): aunque es función TRIGGER (el grant del
-- rol no afecta su disparo), se revoca EXECUTE a public/anon/authenticated por
-- nombre para cerrar el RPC directo. anon/authenticated NO se asumen cubiertos
-- por revocar solo PUBLIC.
REVOKE EXECUTE ON FUNCTION public.set_documentos_fiscales_updated_at()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_documentos_fiscales_updated_at ON public.documentos_fiscales;
CREATE TRIGGER trg_documentos_fiscales_updated_at
  BEFORE UPDATE ON public.documentos_fiscales
  FOR EACH ROW EXECUTE FUNCTION public.set_documentos_fiscales_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS — patrón de tenant del repo (igual que user_invitations).
--    Lectura: cualquier usuario del tenant ve los comprobantes de su company;
--             super_admin ve todo.
--    Escritura: la hace la edge function `timbrar-documento` con service_role
--               (bypassa RLS). Las policies de INSERT/UPDATE quedan acotadas a
--               admin/owner del tenant para cubrir además el camino directo
--               autenticado si llegara a usarse. No hay GRANT a anon.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.documentos_fiscales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documentos_fiscales_select" ON public.documentos_fiscales;
CREATE POLICY "documentos_fiscales_select" ON public.documentos_fiscales
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR company_id = get_my_company_id()
  );

DROP POLICY IF EXISTS "documentos_fiscales_insert" ON public.documentos_fiscales;
CREATE POLICY "documentos_fiscales_insert" ON public.documentos_fiscales
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "documentos_fiscales_update" ON public.documentos_fiscales;
CREATE POLICY "documentos_fiscales_update" ON public.documentos_fiscales
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "documentos_fiscales_delete" ON public.documentos_fiscales;
CREATE POLICY "documentos_fiscales_delete" ON public.documentos_fiscales
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  );

COMMENT ON TABLE public.documentos_fiscales IS
  'Comprobante fiscal electrónico FEL(GT)/CFDI(MX) (serv:S11, épica #305). Ciclo: borrador→por_timbrar→{timbrado|rechazado}, timbrado→cancelado. Provider-agnostic: lo timbra el adapter en supabase/functions/_shared/fiscal/ (hoy SandboxProvider). 1:N con registros (Factura). Escritura por timbrar-documento (service_role); lectura per-tenant vía RLS.';
COMMENT ON COLUMN public.documentos_fiscales.regimen IS
  'fel_gt (Guatemala/SAT) | cfdi_mx (México/SAT MX). Snapshot de companies.regimen_fiscal al crear.';
COMMENT ON COLUMN public.documentos_fiscales.estado IS
  'Estado fiscal. Máquina en src/lib/businessFiscal.ts (puedeTimbrar/aplicarTransicionFiscal) y su espejo Deno. Terminal: cancelado.';
COMMENT ON COLUMN public.documentos_fiscales.request_payload IS
  'DTE canónico (forma intermedia provider-agnostic) enviado a timbrar. Lo arma businessFiscal.construirDteCanonico desde la Factura.';
COMMENT ON COLUMN public.documentos_fiscales.uuid_fiscal IS
  'UUID de autorización (GT) / folio fiscal (MX) devuelto por el certificador. NULL hasta timbrar.';
