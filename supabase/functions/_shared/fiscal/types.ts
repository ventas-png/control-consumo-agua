// serv:S11 — Tipos del núcleo fiscal FEL/CFDI para el lado EDGE (Deno).
//
// FRONTERA Deno/Vite: el edge NO importa src/. Estos tipos ESPEJAN
// src/types/fiscal.ts (el cron de mora hizo lo mismo al espejar calcularMora).
// Si cambia uno, actualizar el otro — son contratos paralelos a propósito.
//
// Provider-agnostic: ningún tipo de PAC concreto aparece aquí.

export type RegimenFiscal = 'fel_gt' | 'cfdi_mx'

// Régimen tal como se guarda (incluye 'ninguno'). ESPEJA RegimenFiscalConfig de
// src/types/fiscal.ts.
export type RegimenFiscalConfig = RegimenFiscal | 'ninguno'

export type TipoDocumentoFiscal =
  | 'factura'
  | 'nota_credito'
  | 'nota_debito'
  | 'recibo'
  | 'nota_abono'

export type EstadoFiscal =
  | 'borrador'
  | 'por_timbrar'
  | 'timbrado'
  | 'rechazado'
  | 'cancelado'

export type AccionFiscal =
  | 'emitir'
  | 'timbrar'
  | 'rechazar'
  | 'reintentar'
  | 'cancelar'

export interface DireccionFiscal {
  linea1?: string | null
  ciudad?: string | null
  departamento?: string | null
  codigoPostal?: string | null
  pais?: string | null
}

export interface EmisorFiscal {
  nit?: string | null
  rfc?: string | null
  nombre: string
  direccion?: DireccionFiscal | null
}

export interface ReceptorFiscal {
  nit?: string | null
  rfc?: string | null
  nombre: string
  usoCfdi?: string | null
}

export interface LineaDte {
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  ivaMonto: number
  total: number
}

export interface DteCanonico {
  regimen: RegimenFiscal
  tipo: TipoDocumentoFiscal
  moneda: string
  fechaEmision: string
  emisor: EmisorFiscal
  receptor: ReceptorFiscal
  lineas: LineaDte[]
  subtotal: number
  ivaTasa: number
  ivaMonto: number
  total: number
  registroId?: string | null
}

// Respuesta NORMALIZADA de cualquier proveedor tras timbrar. El edge la persiste
// en documentos_fiscales.
export interface ResultadoTimbrado {
  ok: boolean
  uuidFiscal?: string | null
  serie?: string | null
  numero?: string | null
  numeroAutorizacion?: string | null
  fechaCertificacion?: string | null
  raw?: Record<string, unknown> | null
  error?: string | null
}

// Config fiscal del emisor/receptor que recibe el builder y el provider.
export interface ConfigEmisor {
  regimen: RegimenFiscal
  nombre: string
  nombreFiscal?: string | null
  nit?: string | null
  rfc?: string | null
  direccion?: DireccionFiscal | null
}

export interface ConfigReceptor {
  nombre: string
  nombreFiscal?: string | null
  nit?: string | null
  rfc?: string | null
  usoCfdi?: string | null
}

export interface FacturaParaDte {
  id?: string | null
  subtotal: number
  ivaTasa: number
  ivaMonto?: number | null
  total?: number | null
  descripcion: string
  mes?: string | null
}

// ── Config fiscal por nivel + config efectiva (override empresa↔locación) ─────
// serv:S11 (habilitación "selecciona y conecta"). ESPEJA src/types/fiscal.ts.
// La config del EMISOR vive a nivel EMPRESA (companies) y la LOCACIÓN (projects)
// puede sobreescribir campos. resolverConfigFiscalEfectiva combina ambos.

export interface ConfigFiscalEmpresa {
  regimenFiscal?: RegimenFiscalConfig | null
  nombre?: string | null
  nombreFiscal?: string | null
  nit?: string | null
  taxId?: string | null
  rfc?: string | null
  proveedorTimbrado?: string | null
  codigoPostal?: string | null
}

export interface ConfigFiscalLocacion {
  regimenFiscal?: RegimenFiscalConfig | null
  nombre?: string | null
  nombreFiscal?: string | null
  nit?: string | null
  rfc?: string | null
  proveedorTimbrado?: string | null
  establecimiento?: string | null
  lugarExpedicion?: string | null
  serieFiscal?: string | null
}

export interface ConfigFiscalEfectiva {
  regimenFiscal: RegimenFiscalConfig
  nombreFiscal: string | null
  nit: string | null
  rfc: string | null
  proveedorTimbrado: string
  establecimiento: string | null
  lugarExpedicion: string | null
  serieFiscal: string | null
  desdeLocacion: boolean
}
