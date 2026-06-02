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
  tipo_cobro: 'Canon Fijo' | 'Consumo Normal' | 'Consumo con Exceso';
  desglose: {
    tramo: 1 | 2 | 3;
    canon_fijo?: number;
    consumo_m3?: number;
    precio_m3?: number;
    derecho_m3?: number;
    exceso_m3?: number;
    precio_exceso?: number;
    monto_base?: number;
    monto_exceso?: number;
  };
}

