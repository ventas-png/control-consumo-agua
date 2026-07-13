// domain/cobros/paymentConfig.ts — Acceso a datos de la configuración de
// proveedores de pago (T7/PR3). Baja a domain/ lo que vivía inline en
// StripePayPalConfig (columnas de `companies` + edges save-payment-config /
// test-stripe) y el override crudo de payfac por locación de PayfacConfigSection
// (`projects.proveedor_pago`). La validación de credenciales y los toasts se
// quedan en la UI; aquí sólo el I/O. Convive con las mutations payfac (hooks
// react-query) de mutations.ts: estas son funciones planas, imperativas, porque
// StripePayPalConfig maneja su propio estado de carga/guardado.
// `db` = la misma instancia tipada (tablas/columnas chequeadas); `supabase` queda
// para functions.invoke (edges), que no pasa por el esquema generado.
import { db, supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import type { TablesUpdate } from '../../types/database.types'

/** Columnas de `companies` que consume la pantalla de config Stripe/PayPal. */
export interface CompanyPaymentConfigRow {
  stripe_public_key: string | null
  stripe_configured: boolean | null
  stripe_activo: boolean | null
  paypal_client_id: string | null
  paypal_configured: boolean | null
  paypal_activo: boolean | null
}

/** Lee la config de pago de la empresa (Stripe/PayPal). */
export async function fetchCompanyPaymentConfig(
  companyId: string,
): Promise<{ data: CompanyPaymentConfigRow | null; error: string | null }> {
  const { data, error } = await db
    .from('companies')
    .select('stripe_public_key,stripe_configured,stripe_activo,paypal_client_id,paypal_configured,paypal_activo')
    .eq('id', companyId)
    .single()
  // La fila tipada coincide columna a columna con CompanyPaymentConfigRow (sin cast).
  return { data: data ?? null, error: error?.message ?? null }
}

/** Activa/desactiva un proveedor (patch ya armado por la UI: {stripe_activo} | {paypal_activo}). */
export async function setCompanyProviderActivo(
  companyId: string,
  patch: Record<string, unknown>,
): Promise<{ error: string | null }> {
  // Firma pública laxa (la UI arma el patch); la frontera lo castea al Update generado.
  const { error } = await db.from('companies').update(patch as TablesUpdate<'companies'>).eq('id', companyId)
  return { error: error?.message ?? null }
}

export interface SavePaymentConfigInput {
  companyId: string
  provider: string
  publicKey: string
  secretKey: string
}

/**
 * Guarda las credenciales de un proveedor vía el edge `save-payment-config` (el
 * secreto nunca se persiste desde el cliente). Devuelve `{ error }`.
 */
export async function savePaymentConfig(
  input: SavePaymentConfigInput,
): Promise<{ error: string | null }> {
  const { error } = await supabase.functions.invoke('save-payment-config', {
    body: {
      companyId: input.companyId,
      provider: input.provider,
      publicKey: input.publicKey,
      secretKey: input.secretKey,
    },
  })
  return { error: error?.message ?? null }
}

/** Prueba la conexión con Stripe vía el edge `test-stripe`. Devuelve `{ error }`. */
export async function testStripeConnection(companyId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.functions.invoke('test-stripe', { body: { companyId } })
  return { error: error?.message ?? null }
}

/**
 * Override CRUDO del payfac de una locación (`projects.proveedor_pago` +
 * `projects.ambiente_pago`): permite distinguir "hereda" (NULL) de "propio"
 * (con valor). `null` si no existe la fila. Mantiene el `abortSignal` (vía
 * runQuery) para cancelar al cambiar de ámbito.
 */
export async function fetchProjectProveedorPagoOverride(
  projectId: string,
): Promise<{ proveedorPago: string | null; ambientePago: string | null } | null> {
  // Sin migrar a `db` a propósito: `ambiente_pago` (#592) entró a prod DESPUÉS de
  // la última regeneración de database.types.ts, así que el cliente tipado aún no
  // conoce la columna. Migrar al regenerar tipos.
  const rows = await runQuery<Array<{ proveedor_pago: string | null; ambiente_pago: string | null }>>((signal) =>
    supabase.from('projects').select('proveedor_pago,ambiente_pago').eq('id', projectId).limit(1).abortSignal(signal),
  )
  const p = rows?.[0]
  return p ? { proveedorPago: p.proveedor_pago ?? null, ambientePago: p.ambiente_pago ?? null } : null
}
