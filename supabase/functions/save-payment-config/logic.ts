// Lógica pura de save-payment-config, extraída del handler para poder testearla
// en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js → corre
// directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la definición a un archivo importable.
//
// Esta función guarda SECRETOS de pago por tenant: los invariantes críticos son
// (a) el gate de rol (solo company_owner/admin; ni siquiera super_admin), (b) el
// whitelist de proveedores y (c) que el secretKey vaya SOLO a la tabla aislada
// company_payment_secrets, NUNCA a la fila pública de companies.

/** Proveedores de pago configurables por esta función. */
export type PaymentProviderId = 'stripe' | 'paypal'

/**
 * `true` si el rol puede configurar pagos del tenant. Solo company_owner y
 * admin: super_admin NO está en el whitelist (a propósito, igual que el handler
 * original — la config de pagos es del tenant, no de la plataforma).
 */
export function puedeConfigurarPagos(role: string): boolean {
  return role === 'company_owner' || role === 'admin'
}

/** `true` si falta algún campo requerido (strings vacíos cuentan como faltantes). */
export function faltanCampos(body: {
  companyId?: string
  provider?: string
  publicKey?: string
  secretKey?: string
}): boolean {
  return !body.companyId || !body.provider || !body.publicKey || !body.secretKey
}

/** Whitelist de proveedores: cualquier otro valor se rechaza. */
export function esProveedorValido(provider: string): provider is PaymentProviderId {
  return provider === 'stripe' || provider === 'paypal'
}

/**
 * Construye los dos updates del guardado: el PÚBLICO (companies: llave pública +
 * flags configured/activo) y el SECRETO (company_payment_secrets: solo la llave
 * secreta). El secretKey JAMÁS aparece en companyUpdate. `nowIso` inyectable
 * para tests deterministas; default = ahora, igual que el handler original.
 */
export function buildConfigUpdates(
  provider: PaymentProviderId,
  companyId: string,
  publicKey: string,
  secretKey: string,
  nowIso: string = new Date().toISOString(),
): { companyUpdate: Record<string, unknown>; secretsUpdate: Record<string, unknown> } {
  if (provider === 'stripe') {
    return {
      companyUpdate: {
        stripe_public_key: publicKey,
        stripe_configured: true,
        stripe_activo: true,
      },
      secretsUpdate: {
        company_id: companyId,
        stripe_secret_key: secretKey,
        updated_at: nowIso,
      },
    }
  }
  return {
    companyUpdate: {
      paypal_client_id: publicKey,
      paypal_configured: true,
      paypal_activo: true,
    },
    secretsUpdate: {
      company_id: companyId,
      paypal_client_secret: secretKey,
      updated_at: nowIso,
    },
  }
}

/**
 * Update de rollback si el secreto NO se pudo guardar: desmarca configured y
 * activo del proveedor para no dejar a la empresa "configurada" sin secreto.
 */
export function buildRollbackUpdate(provider: PaymentProviderId): Record<string, unknown> {
  return provider === 'stripe'
    ? { stripe_configured: false, stripe_activo: false }
    : { paypal_configured: false, paypal_activo: false }
}
