// serv:S11 — Helper PURO de timbrar-documento: mapea las filas crudas
// (registro/company/cliente) a la config + Factura que consume
// construirDteCanonico. Sin I/O ni supabase-js → deno-check limpio + testeable.
//
// Separa el "qué columnas → qué campos canónicos" del handler, para que el
// mapeo (la parte con reglas de negocio: nombre fiscal fallback, NIT vs RFC,
// CF por defecto) tenga tests propios.

import { construirDteCanonico } from '../_shared/fiscal/stateMachine.ts'
import type {
  ConfigEmisor,
  ConfigReceptor,
  DteCanonico,
  FacturaParaDte,
  RegimenFiscal,
} from '../_shared/fiscal/types.ts'

// Subconjuntos mínimos de cada tabla que necesita el builder (lo que el handler
// proyecta con .select()).
export interface CompanyRow {
  id: string
  nombre: string
  nombre_fiscal?: string | null
  nit?: string | null
  tax_id?: string | null
  rfc?: string | null
  regimen_fiscal?: string | null
  proveedor_timbrado?: string | null
  address_line1?: string | null
  address_city?: string | null
  address_state?: string | null
  address_postal_code?: string | null
  country?: string | null
  iva_tasa_default?: number | string | null
}

export interface ClienteRow {
  id: string
  nombre: string
  nombre_fiscal?: string | null
  nit?: string | null
  rfc?: string | null
  uso_cfdi?: string | null
}

export interface RegistroRow {
  id: string
  cliente_id?: string | null
  cliente_nombre?: string | null
  mes?: string | null
  monto_calculado?: number | string | null
  iva_tasa?: number | string | null
  iva_monto?: number | string | null
  monto_con_iva?: number | string | null
  total_a_pagar?: number | string | null
}

/** Convierte numeric de Postgres (que llega como string) a number seguro. */
function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** El régimen del comprobante deriva del tenant; 'ninguno'/inválido = null. */
export function regimenDeCompany(company: CompanyRow): RegimenFiscal | null {
  const r = company.regimen_fiscal
  return r === 'fel_gt' || r === 'cfdi_mx' ? r : null
}

/** Config fiscal del emisor desde la fila de companies. */
export function emisorDesdeCompany(
  company: CompanyRow,
  regimen: RegimenFiscal,
): ConfigEmisor {
  return {
    regimen,
    nombre: company.nombre,
    nombreFiscal: company.nombre_fiscal ?? null,
    // GT: NIT (companies.nit, fallback tax_id). MX: RFC.
    nit: company.nit ?? company.tax_id ?? null,
    rfc: company.rfc ?? null,
    direccion: {
      linea1: company.address_line1 ?? null,
      ciudad: company.address_city ?? null,
      departamento: company.address_state ?? null,
      codigoPostal: company.address_postal_code ?? null,
      pais: company.country ?? null,
    },
  }
}

/** Config fiscal del receptor desde la fila de clientes (o nombre del registro). */
export function receptorDesdeCliente(
  cliente: ClienteRow | null,
  registro: RegistroRow,
  regimen: RegimenFiscal,
): ConfigReceptor {
  const nombre = cliente?.nombre ?? registro.cliente_nombre ?? 'Consumidor Final'
  return {
    nombre,
    nombreFiscal: cliente?.nombre_fiscal ?? null,
    // GT: NIT del receptor; default 'CF' (Consumidor Final) si no hay.
    nit: regimen === 'fel_gt' ? (cliente?.nit ?? 'CF') : (cliente?.nit ?? null),
    rfc: cliente?.rfc ?? null,
    usoCfdi: cliente?.uso_cfdi ?? null,
  }
}

/** Factura para el builder desde la fila de registros + IVA por defecto del tenant. */
export function facturaDesdeRegistro(
  registro: RegistroRow,
  ivaTasaDefault: number,
): FacturaParaDte {
  const subtotal = num(registro.monto_calculado)
  const ivaTasa = registro.iva_tasa != null ? num(registro.iva_tasa) : ivaTasaDefault
  return {
    id: registro.id,
    subtotal,
    ivaTasa,
    ivaMonto: registro.iva_monto != null ? num(registro.iva_monto) : null,
    total:
      registro.total_a_pagar != null
        ? num(registro.total_a_pagar)
        : registro.monto_con_iva != null
          ? num(registro.monto_con_iva)
          : null,
    descripcion: registro.mes ? `Consumo de agua — ${registro.mes}` : 'Consumo de agua',
    mes: registro.mes ?? null,
  }
}

/**
 * Orquesta el armado del DTE canónico desde las filas crudas. Lanza si el tenant
 * no tiene régimen fiscal configurado (el handler lo traduce a 400).
 */
export function armarDteDesdeFilas(params: {
  company: CompanyRow
  cliente: ClienteRow | null
  registro: RegistroRow
  fechaEmision?: string
}): { dte: DteCanonico; regimen: RegimenFiscal } {
  const { company, cliente, registro } = params
  const regimen = regimenDeCompany(company)
  if (!regimen) {
    throw new Error(
      'El tenant no tiene un régimen fiscal configurado (companies.regimen_fiscal es "ninguno"). Configure FEL (GT) o CFDI (MX) antes de timbrar.',
    )
  }
  const ivaDefault = num(company.iva_tasa_default, 0.12)
  const dte = construirDteCanonico({
    factura: facturaDesdeRegistro(registro, ivaDefault),
    emisor: emisorDesdeCompany(company, regimen),
    receptor: receptorDesdeCliente(cliente, registro, regimen),
    fechaEmision: params.fechaEmision,
  })
  return { dte, regimen }
}
