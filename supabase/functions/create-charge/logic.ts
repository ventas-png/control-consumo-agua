// Lógica pura de create-charge, extraída del handler para poder testearla en
// aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js → corre directo
// en vitest (solo importa TIPOS de _shared/payments, que ya es puro). El handler
// (index.ts) importa estos símbolos: el comportamiento no cambia, solo se mueve
// la definición a un archivo importable desde los tests.

import type {
  AmbientePago,
  CobroCanonico,
  EstadoCobroProveedor,
} from '../_shared/payments/index.ts'

/** Mapea el estado normalizado del provider al estado de payment_requests. */
export function estadoPaymentRequest(estado: EstadoCobroProveedor): string {
  switch (estado) {
    case 'aprobado':
      return 'succeeded'
    case 'rechazado':
    case 'error':
      return 'failed'
    default:
      // 'pendiente' | 'requiere_accion' → esperando confirmación/retorno.
      return 'pending'
  }
}

/** Credenciales del ambiente desde el jsonb opaco de la bóveda. */
export function credsDeAmbiente(credenciales: unknown, ambiente: AmbientePago): Record<string, unknown> | null {
  if (typeof credenciales !== 'object' || credenciales === null) return null
  const v = (credenciales as Record<string, unknown>)[ambiente]
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Ambiente del cobro: SOLO el literal 'prod' activa prod; todo lo demás → sandbox. */
export function parseAmbiente(v: unknown): AmbientePago {
  return v === 'prod' ? 'prod' : 'sandbox'
}

/** Datos del cliente que alimentan el recibo (fila de `clientes`, ya leída). */
export interface ClienteCobro {
  nombre?: string
  email?: string
  telefono?: string
  nit?: string
}

/**
 * Construye el CobroCanonico que se manda al payfac. Idéntico al objeto inline
 * del handler: descripción con trim + fallback, referencia interna registro →
 * cliente, URLs de retorno derivadas de `base` solo si no vienen explícitas, y
 * metadata multi-tenant que incluye registro_id SOLO cuando existe.
 */
export function buildCobroCanonico(input: {
  monto: number
  moneda: string
  descripcion?: string | null
  registroId: string | null
  clienteId: string
  companyId: string
  cli: ClienteCobro | null
  /** APP_URL || origin || '' — resuelto por el handler. */
  base: string
  urlRetorno?: string | null
  urlCancelacion?: string | null
}): CobroCanonico {
  const { monto, moneda, registroId, clienteId, companyId, cli, base } = input
  return {
    monto,
    moneda,
    descripcion: input.descripcion?.trim() || `Pago de servicio — ${cli?.nombre ?? 'Cliente'}`,
    referenciaInterna: registroId ?? clienteId,
    pagador: {
      nombre: cli?.nombre ?? null,
      email: cli?.email ?? null,
      telefono: cli?.telefono ?? null,
      identificador: cli?.nit ?? null,
    },
    urlRetorno: input.urlRetorno ?? (base ? `${base}/portal?pago=ok` : null),
    urlCancelacion: input.urlCancelacion ?? (base ? `${base}/portal?pago=cancelado` : null),
    metadata: { company_id: companyId, cliente_id: clienteId, ...(registroId ? { registro_id: registroId } : {}) },
  }
}
