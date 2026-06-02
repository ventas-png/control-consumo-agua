// agua:A6 — Tipos del módulo de Servicios Energéticos (proveedores, tarifas,
// fuentes, facturas). Asociado al módulo Agua porque la generación eléctrica
// alimenta las fuentes de agua (bombeo).

// ── Módulo de Servicios Energéticos ────────────────────────────────────────

export type ModoSuministroEnergia = 'red' | 'solar_autonomo' | 'hibrido';

export interface ProveedorEnergia {
  id: string;
  project_id: string;
  company_id: string;
  nombre: string;
  nit?: string;
  contacto?: string;
  tipo: 'distribuidora' | 'comercializadora' | 'autogeneracion';
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface TarifaEnergia {
  id: string;
  project_id: string;
  company_id: string;
  proveedor_id: string;
  nombre: string;
  descripcion?: string;
  precio_kwh_energia: number;
  precio_kw_potencia: number;
  cargo_fijo: number;
  alumbrado_publico: number;
  alumbrado_tipo: 'fijo' | 'porcentual';
  iva_porcentaje: number;
  precio_kwh_exportado: number;
  moneda: string;
  activa: boolean;
  created_at: string;
  updated_at: string;
}

export interface FuenteEnergia {
  id: string;
  project_id: string;
  company_id: string;
  fuente_agua_id: string;
  nombre: string;
  modo_suministro: ModoSuministroEnergia;
  proveedor_id?: string;
  tarifa_id?: string;
  numero_medidor?: string;
  numero_cuenta?: string;
  potencia_contratada_kw?: number;
  capacidad_solar_kwp?: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface FacturaEnergia {
  id: string;
  project_id: string;
  company_id: string;
  fuente_energia_id: string;
  proveedor_id?: string;
  tarifa_id?: string;
  numero_factura?: string;
  periodo_inicio: string;
  periodo_fin: string;
  fecha_emision?: string;
  kwh_consumidos: number;
  kwh_generados: number;
  kwh_exportados: number;
  kw_demanda_max?: number;
  monto_energia: number;
  monto_potencia: number;
  monto_cargo_fijo: number;
  monto_alumbrado: number;
  monto_iva: number;
  monto_credito_exportacion: number;
  monto_otros: number;
  monto_total: number;
  moneda: string;
  estado: 'pendiente' | 'pagada' | 'vencida';
  fecha_pago?: string;
  archivo_factura_url?: string;
  notas?: string;
  created_at: string;
  updated_at: string;
}
