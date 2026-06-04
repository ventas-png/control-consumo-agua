// Cobros pluggable — Catálogo de PAYFACS + lógica PURA de la UI "elige tu payfac y
// solo conecta". Sin React/Supabase: solo datos + funciones testeables (igual que
// pacCatalogo.ts del lado fiscal). La UI (PayfacConfigSection) consume esto; la
// FUENTE DE VERDAD del override empresa↔locación sigue siendo
// resolverConfigPagoEfectiva (businessPagos.ts).

import type { ProveedorPago } from '../types/pagos'

// ════════════════════════════════════════════════════════════════════════════
// 1. Esquema de credenciales por payfac (qué campos captura la UI por ambiente).
// ════════════════════════════════════════════════════════════════════════════

/** Un campo de credencial que el usuario captura para conectar el payfac. */
export interface PayfacCampoCredencial {
  /** Llave que se guarda en credenciales[ambiente][key] (ej. 'x_login'). */
  key: string
  /** Etiqueta legible para el formulario. */
  label: string
  /** Render como password (no se muestra en claro). Default true para secretos. */
  secreto?: boolean
  /** ¿Es obligatorio para que el payfac funcione? */
  requerido?: boolean
  /** Ayuda/placeholder corto. */
  placeholder?: string
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Catálogo de payfacs.
// ════════════════════════════════════════════════════════════════════════════
//
// `value` es el identificador que se persiste en proveedor_pago y resuelve
// getPaymentProvider. `disponible` = tiene adapter REAL integrado de punta a punta
// hoy (sandbox + qpaypro); los demás son elegibles pero su cobro real es follow-up.

export interface PayfacOpcion {
  value: ProveedorPago
  label: string
  /** ¿Adapter real integrado hoy? (sandbox/qpaypro = true). */
  disponible: boolean
  /** Nota corta para la UI (país, estado, dónde se configura). */
  nota?: string
  /** Campos de credenciales a capturar. Vacío = no se conecta aquí. */
  campos: PayfacCampoCredencial[]
}

/** Opción de pruebas, disponible siempre (default). Cobro simulado, sin creds. */
export const PAYFAC_SANDBOX: PayfacOpcion = {
  value: 'sandbox',
  label: 'Sandbox (pruebas) — cobro simulado',
  disponible: true,
  nota: 'Aprueba todo, sin cobro real. Default mientras no conectes un payfac.',
  campos: [],
}

/** QPayPro — payfac de Guatemala (API estilo Authorize.Net AIM). REAL. */
export const PAYFAC_QPAYPRO: PayfacOpcion = {
  value: 'qpaypro',
  label: 'QPayPro (Guatemala)',
  disponible: true,
  nota: 'Pasarela guatemalteca. Checkout hospedado (no manejamos datos de tarjeta).',
  campos: [
    { key: 'x_login', label: 'x_login', requerido: true, secreto: false, placeholder: 'Merchant login' },
    { key: 'x_api_key', label: 'x_api_key', requerido: true, secreto: true },
    { key: 'x_private_key', label: 'x_private_key', secreto: true },
    { key: 'x_api_secret', label: 'x_api_secret', secreto: true },
  ],
}

/** Visanet — payfac regional. Pendiente de integrar (elegible, cobro = follow-up). */
export const PAYFAC_VISANET: PayfacOpcion = {
  value: 'visanet',
  label: 'Visanet',
  disponible: false,
  nota: 'Próximamente — el adapter de cobro está pendiente de integrar.',
  campos: [
    { key: 'merchant_id', label: 'Merchant ID', requerido: true, secreto: false },
    { key: 'api_key', label: 'API Key', requerido: true, secreto: true },
  ],
}

/** PayPal — pendiente de integrar en el modelo pluggable. */
export const PAYFAC_PAYPAL: PayfacOpcion = {
  value: 'paypal',
  label: 'PayPal',
  disponible: false,
  nota: 'Próximamente — el adapter de cobro está pendiente de integrar.',
  campos: [
    { key: 'client_id', label: 'Client ID', requerido: true, secreto: false },
    { key: 'client_secret', label: 'Client Secret', requerido: true, secreto: true },
  ],
}

/** Stripe — usa su pantalla/flujo DEDICADO; no pasa por el adapter genérico. */
export const PAYFAC_STRIPE: PayfacOpcion = {
  value: 'stripe',
  label: 'Stripe',
  disponible: false,
  nota: 'Se configura y cobra en su pantalla dedicada de Stripe (no aquí).',
  campos: [],
}

/** Catálogo completo, con Sandbox primero (default de pruebas). */
export const PAYFACS: PayfacOpcion[] = [
  PAYFAC_SANDBOX,
  PAYFAC_QPAYPRO,
  PAYFAC_VISANET,
  PAYFAC_PAYPAL,
  PAYFAC_STRIPE,
]

/** Payfacs elegibles para el selector (todo el catálogo). */
export function payfacsDisponibles(): PayfacOpcion[] {
  return PAYFACS
}

/** Opción del catálogo por value (o undefined si desconocido). */
export function payfacPorValue(value: string | null | undefined): PayfacOpcion | undefined {
  if (!value) return undefined
  return PAYFACS.find((p) => p.value === value)
}

/** Etiqueta legible de un payfac guardado (cae al propio value si es desconocido). */
export function etiquetaPayfac(value: string | null | undefined): string {
  if (!value) return PAYFAC_SANDBOX.label
  return payfacPorValue(value)?.label ?? value
}

/** Campos de credenciales que la UI debe capturar para un payfac. */
export function camposCredencial(value: string | null | undefined): PayfacCampoCredencial[] {
  return payfacPorValue(value)?.campos ?? []
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Presentación del estado de conexión (badge). Mismo criterio que el fiscal.
// ════════════════════════════════════════════════════════════════════════════

export interface EstadoConexionStyle {
  label: string
  icon: string
  bg: string
  color: string
}

/** Estilo del badge de estado_conexion (desconocido|ok|error). */
export function estadoConexionStyle(estado: string | null | undefined): EstadoConexionStyle {
  switch (estado) {
    case 'ok':
      return { label: 'Conectado', icon: '✅', bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' }
    case 'error':
      return { label: 'Error de conexión', icon: '⛔', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' }
    default:
      return { label: 'Sin probar', icon: '○', bg: 'var(--at-chip)', color: 'var(--at-ink-3)' }
  }
}
