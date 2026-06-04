// Cobros pluggable — Tipos del núcleo de PAGOS para el lado EDGE (Deno).
//
// Espeja el patrón de _shared/fiscal/types.ts pero para el PROCESADOR DE PAGOS
// (payfac) en vez del certificador (PAC). Provider-agnostic: ningún payfac
// concreto (qpaypro/stripe/…) aparece aquí.
//
// FRONTERA Deno/Vite: el edge NO importa src/. Estos tipos ESPEJAN
// src/types/pagos.ts (parte payfac). Si cambia uno, actualizar el otro.

/** Payfac elegible. 'sandbox' es el default de pruebas (cobro simulado). */
export type ProveedorPago =
  | 'sandbox'
  | 'stripe'
  | 'paypal'
  | 'qpaypro'
  | 'visanet'

/** Ambiente de credenciales/cobro. */
export type AmbientePago = 'sandbox' | 'prod'

/**
 * Estado NORMALIZADO de un cobro tras hablar con el payfac. Neutral al
 * proveedor (cada payfac mapea su propio set a éste):
 *   - 'aprobado'        → cobro autorizado/capturado.
 *   - 'pendiente'       → creado pero aún sin resolver (checkout abierto / async).
 *   - 'requiere_accion' → el cliente debe completar algo (redirect a hosted
 *                         checkout, 3DS, confirmar clientSecret…). Ver redirectUrl
 *                         / clientSecret.
 *   - 'rechazado'       → el payfac declinó (fondos, tarjeta, etc.).
 *   - 'error'           → fallo de infraestructura/credenciales (ver `error`).
 */
export type EstadoCobroProveedor =
  | 'aprobado'
  | 'pendiente'
  | 'requiere_accion'
  | 'rechazado'
  | 'error'

/**
 * Datos del pagador (cliente) que el payfac puede necesitar para el recibo / la
 * antifraude / el hosted checkout. Todo opcional: cada payfac usa lo que tenga.
 */
export interface PagadorCanonico {
  nombre?: string | null
  email?: string | null
  telefono?: string | null
  /** Identificador tributario (NIT en GT) si el payfac lo pide para el recibo. */
  identificador?: string | null
}

/**
 * Solicitud de cobro CANÓNICA (forma intermedia provider-agnostic), análoga al
 * DteCanonico de fiscal. El edge la construye desde la Factura/registro y se la
 * pasa al payfac elegido; cada adapter la traduce a su API.
 */
export interface CobroCanonico {
  /** Monto en unidades MAYORES (ej. 150.00 = Q150.00). El adapter convierte. */
  monto: number
  /** Moneda ISO 4217 (ej. 'GTQ', 'USD'). */
  moneda: string
  /** Descripción legible del cobro (aparece en el recibo del payfac). */
  descripcion: string
  /** Referencia interna nuestra (payment_request.id / registro_id) → x_invoice_num. */
  referenciaInterna?: string | null
  /** Datos del pagador (opcionales). */
  pagador?: PagadorCanonico | null
  /** URL de retorno tras un checkout exitoso (hosted checkout / redirect). */
  urlRetorno?: string | null
  /** URL de retorno si el cliente cancela el checkout. */
  urlCancelacion?: string | null
  /** Metadata libre (se reenvía al payfac cuando soporta metadata). */
  metadata?: Record<string, string> | null
}

/**
 * Respuesta NORMALIZADA de cualquier payfac tras crear/consultar/reembolsar un
 * cobro. Análoga a ResultadoTimbrado. El edge la persiste en payment_requests /
 * pagos. NUNCA contiene datos de tarjeta.
 */
export interface ResultadoCobro {
  /** ok=false SOLO para error de infraestructura/credenciales; un rechazo de
   *  negocio (tarjeta declinada) es ok=true con estado='rechazado'. */
  ok: boolean
  estado: EstadoCobroProveedor
  /** Referencia del payfac (id de transacción/checkout). → payment_requests.provider_ref. */
  referencia?: string | null
  /** Código de autorización del payfac (si aplica). */
  autorizacion?: string | null
  /** Stripe-style: el cliente confirma el pago con este secreto. */
  clientSecret?: string | null
  /** Hosted checkout / redirect: URL a la que enviar al cliente para pagar. */
  redirectUrl?: string | null
  /** Respuesta cruda del payfac (auditoría). Sin datos sensibles de tarjeta. */
  raw?: Record<string, unknown> | null
  /** Mensaje de error o motivo del rechazo (legible). */
  error?: string | null
}

// ── Config de pago por nivel + config efectiva (override empresa↔locación) ────
// Espeja ConfigFiscalEmpresa/Locacion/Efectiva. La config del payfac vive a nivel
// EMPRESA (companies.proveedor_pago) y la LOCACIÓN (projects.proveedor_pago)
// puede sobreescribirla. resolverConfigPagoEfectiva combina ambos.

export interface ConfigPagoEmpresa {
  /** companies.proveedor_pago (default 'sandbox'). */
  proveedorPago?: string | null
  /** Moneda por defecto del tenant (companies.default_currency). */
  monedaDefault?: string | null
}

export interface ConfigPagoLocacion {
  /** projects.proveedor_pago (NULL = hereda de la empresa). */
  proveedorPago?: string | null
}

export interface ConfigPagoEfectiva {
  /** Payfac efectivo resuelto (default 'sandbox'). */
  proveedorPago: string
  /** Moneda efectiva (default 'GTQ' si la empresa no la fijó). */
  moneda: string
  /** true si el proveedor provino del override de la locación. */
  desdeLocacion: boolean
}
