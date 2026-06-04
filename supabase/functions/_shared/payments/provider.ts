// Cobros pluggable — Interfaz del adapter PLUGGABLE del payfac + tipos del resolver.
//
// Provider-agnostic: el resto del sistema (las edge functions create-charge /
// payfac-test-connection) habla SOLO con esta interfaz. Cambiar de payfac =
// cambiar la implementación que devuelve getPaymentProvider(), sin tocar el caller.
//
// Espeja _shared/fiscal/provider.ts (FiscalProvider). Diferencia clave: las
// CREDENCIALES del payfac SÍ llegan al provider (en config.credenciales), porque
// hay adapters REALES (QPayPro). El edge las lee de la bóveda payfac_secrets
// (service-role-only) y las inyecta; el provider queda como adapter HTTP PURO
// (sin acceso a BD → testeable con fetch mockeado).

import type {
  AmbientePago,
  CobroCanonico,
  ProveedorPago,
  ResultadoCobro,
} from './types.ts'

/**
 * Contrato que cualquier payfac debe cumplir. Métodos normalizados a la forma
 * neutral del repo (ResultadoCobro), no a la del payfac.
 */
export interface PaymentProvider {
  /** Identificador del payfac (ej. 'sandbox', 'qpaypro', 'visanet'). */
  readonly nombre: string

  /**
   * Crea un cobro a partir del cobro canónico. Devuelve un ResultadoCobro
   * normalizado: aprobado / pendiente / requiere_accion (redirectUrl o
   * clientSecret) / rechazado. NUNCA lanza por un rechazo de negocio (tarjeta
   * declinada → ok:true, estado:'rechazado'); solo lanza por fallos de
   * infraestructura irrecuperables.
   */
  crearCobro(cobro: CobroCanonico): Promise<ResultadoCobro>

  /**
   * Consulta el estado de un cobro por su referencia del payfac. Se usa para
   * CONFIRMAR (server-to-server) tras el retorno de un hosted checkout y para
   * reconciliar cobros que quedaron en limbo. También sirve de "ping" de
   * conexión cuando la referencia es del tipo `ping:` (valida credenciales sin
   * crear un cobro real).
   */
  consultarEstado(referencia: string): Promise<ResultadoCobro>

  /**
   * Reembolsa (total o parcial) un cobro ya aprobado por su referencia. `monto`
   * opcional (ausente = total). Análogo a cancelar() en fiscal.
   */
  reembolsar(referencia: string, monto?: number, motivo?: string): Promise<ResultadoCobro>
}

/**
 * Config que el resolver pasa al provider. Incluye las CREDENCIALES del ambiente
 * elegido (las inyecta el edge desde la bóveda; el provider NO toca BD).
 */
export interface PaymentProviderConfig {
  /** Tenant dueño del cobro (llave de las credenciales en la bóveda). */
  companyId?: string | null
  /** Payfac configurado (companies/projects.proveedor_pago). */
  proveedor?: string | null
  /** Ambiente a usar ('sandbox' | 'prod'). Default 'sandbox'. */
  ambiente?: AmbientePago
  /** Moneda efectiva del tenant (companies.default_currency). */
  moneda?: string | null
  /**
   * Credenciales del ambiente elegido, leídas de payfac_secrets.credenciales
   * [ambiente] por el edge (service_role) e inyectadas aquí. Objeto OPACO: cada
   * adapter sabe qué llaves usar (ej. QPayPro: x_login / x_api_key / x_private_key).
   * null/vacío = sin credenciales (los adapters reales lo reportan como error).
   */
  credenciales?: Record<string, unknown> | null
}

/** Error tipado cuando el payfac elegido no tiene adapter/credenciales todavía. */
export class PayfacNoConfiguradoError extends Error {
  constructor(proveedor: string, detalle?: string | null) {
    super(
      `Payfac "${proveedor}" no está configurado todavía` +
        (detalle ? `: ${detalle}` : '') +
        '. Elija un payfac soportado y conecte sus credenciales.',
    )
    this.name = 'PayfacNoConfiguradoError'
  }
}

/** Normaliza un proveedor guardado a ProveedorPago (cae a 'sandbox' si vacío). */
export function normalizarProveedorPago(v: string | null | undefined): string {
  return (v ?? 'sandbox').trim().toLowerCase() || 'sandbox'
}

/** Type guard: ¿es un ProveedorPago conocido del catálogo? */
export function esProveedorPagoConocido(v: string): v is ProveedorPago {
  return v === 'sandbox' || v === 'stripe' || v === 'paypal' || v === 'qpaypro' || v === 'visanet'
}
