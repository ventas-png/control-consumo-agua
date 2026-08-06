// agua:A6 — Tipos de pagos, convenios y cálculo de costos del módulo Agua.
// Incluye CompanyPaymentConfig (Stripe/PayPal) compartido por agua + condominios.

export type FormaPago =
  | 'efectivo'
  | 'transferencia'
  | 'deposito'
  | 'tarjeta_credito'
  | 'tarjeta_debito'
  | 'cheque'
  | 'convenio_pago'
  | 'otro';

export type TipoAplicacion = 'pago_total' | 'abono' | 'convenio';
export type EstadoPago = 'pendiente' | 'verificado' | 'rechazado' | 'aplicado';
export type EstadoConvenio = 'activo' | 'completado' | 'incumplido' | 'cancelado';

export interface Pago {
  id: string;
  registro_id?: string | null;
  cliente_id: string;
  project_id?: string | null;
  monto: number;
  metodo: FormaPago;
  referencia?: string | null;
  numero_documento?: string | null;
  tipo_aplicacion?: TipoAplicacion;
  convenio_id?: string | null;
  comprobante_url?: string | null;
  comprobante_tipo?: 'imagen' | 'pdf' | null;
  verification_status?: EstadoPago;
  verification_notes?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  stripe_payment_intent_id?: string | null;
  paypal_transaction_id?: string | null;
  estado: EstadoPago;
  notas?: string | null;
  created_by?: string | null;
  created_at: string;
  cliente_nombre?: string;
}

export interface CompanyPaymentConfig {
  stripe_public_key?: string | null;
  stripe_configured: boolean;
  stripe_activo?: boolean;
  paypal_client_id?: string | null;
  paypal_configured: boolean;
  paypal_activo?: boolean;
}

// ── Cobros pluggable (payfac) ─────────────────────────────────────────────────
// ESPEJA supabase/functions/_shared/payments/types.ts. La empresa/locación elige
// su payfac (companies/projects.proveedor_pago) y solo conecta credenciales, igual
// que la facturación FEL elige su PAC. Las CREDENCIALES viven en payfac_secrets
// (service-role-only): el cliente NUNCA las lee, solo el estatus (PayfacEstatus).

/** Payfac elegible. 'sandbox' es el default de pruebas (cobro simulado). */
export type ProveedorPago = 'sandbox' | 'stripe' | 'paypal' | 'qpaypro' | 'visanet';

/** Ambiente de credenciales/cobro. */
export type AmbientePago = 'sandbox' | 'prod';

/** Config de pago EFECTIVA resuelta (override locación↔empresa). */
export interface ConfigPagoEfectiva {
  proveedorPago: string;
  moneda: string;
  /** Ambiente de cobro efectivo ('sandbox' default; 'prod' = cobros REALES). */
  ambiente: AmbientePago;
  desdeLocacion: boolean;
}

/**
 * Estatus NO sensible de credenciales del payfac (fila de la RPC payfac_estatus).
 * NUNCA incluye `credenciales` — solo flags de presencia + estado del último ping.
 */
export interface PayfacEstatus {
  id: string;
  company_id: string;
  project_id: string | null;
  proveedor: string;
  estado_conexion: 'desconocido' | 'ok' | 'error';
  estado_mensaje: string | null;
  estado_probado_en: string | null;
  tiene_sandbox: boolean;
  tiene_prod: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaymentRequest {
  id: string;
  cliente_id: string;
  registro_id?: string | null;
  company_id: string;
  monto: number;
  provider: 'stripe' | 'paypal' | 'manual';
  estado: 'pending' | 'succeeded' | 'failed' | 'pending_verification';
  stripe_payment_intent?: string | null;
  paypal_order_id?: string | null;
  numero_comprobante?: string | null;
  referencia?: string | null;
  notas?: string | null;
  created_at: string;
  updated_at: string;
}

/** Una cuota del calendario de pagos de un convenio (P1 · cobranza). */
export interface ConvenioCuota {
  /** Número de cuota (1-based). */
  numero: number;
  /** Fecha de vencimiento (YYYY-MM-DD). */
  fecha_vencimiento: string;
  /** Monto de la cuota (la última absorbe el residual de redondeo). */
  monto: number;
}

export interface ConvenioPago {
  id: string;
  cliente_id: string;
  project_id?: string | null;
  company_id?: string | null;
  numero_convenio: string;
  descripcion?: string | null;
  monto_total: number;
  monto_pagado: number;
  cuotas_pactadas?: number | null;
  /** Calendario de cuotas (fechas + montos). null en convenios legacy sin calendario. */
  cuotas?: ConvenioCuota[] | null;
  fecha_inicio: string;
  fecha_vencimiento?: string | null;
  estado: EstadoConvenio;
  registro_ids: string[];
  notas?: string | null;
  created_by?: string | null;
  created_at: string;
  // join opcional
  cliente_nombre?: string;
}

export interface CostoCalculo {
  total: number;
  tipo_cobro: 'Canon Fijo' | 'Consumo Normal' | 'Consumo con Exceso' | 'Consumo Escalonado';
  desglose: {
    tramo: 1 | 2 | 3 | 'escalonado';
    canon_fijo?: number;
    consumo_m3?: number;
    precio_m3?: number;
    derecho_m3?: number;
    exceso_m3?: number;
    precio_exceso?: number;
    monto_base?: number;
    monto_exceso?: number;
    /** Detalle por bloque cuando la tarifa es escalonada. */
    tramos?: Array<{ desde_m3: number; hasta_m3: number | null; precio_m3: number; m3: number; monto: number }>;
  };
}

