// serv:S11 — Catálogo de PACs/Certificadores + lógica PURA de la UI fiscal
// "selecciona tu PAC y solo conecta" (parte 2). Sin React/Supabase: solo datos +
// funciones testeables (igual que clientes/receptorFiscal.ts). La UI
// (FiscalConfigSection) consume esto; la FUENTE DE VERDAD del override
// empresa↔locación sigue siendo resolverConfigFiscalEfectiva (businessFiscal.ts),
// aquí solo derivamos qué se MUESTRA (selector + qué campos heredan).
import type {
  ConfigFiscalEfectiva,
  ConfigFiscalLocacion,
  RegimenFiscal,
  RegimenFiscalConfig,
} from '../../types/fiscal'

// ════════════════════════════════════════════════════════════════════════════
// 1. Catálogo de PACs por régimen.
// ════════════════════════════════════════════════════════════════════════════
//
// `value` es el identificador que se persiste en proveedor_timbrado y resuelve
// getFiscalProvider (hoy todo cae al SandboxProvider hasta que exista el adapter
// real de cada PAC). 'sandbox' es el default de pruebas en AMBOS regímenes.

export interface PacOpcion {
  /** Identificador estable que se guarda en proveedor_timbrado. */
  value: string
  /** Nombre legible para el selector. */
  label: string
}

/** Opción de pruebas, disponible en cualquier régimen (default). */
export const PAC_SANDBOX: PacOpcion = {
  value: 'sandbox',
  label: 'Sandbox (pruebas) — sin PAC real',
}

/** PACs/Certificadores de Guatemala (FEL / SAT GT). */
export const PACS_FEL_GT: PacOpcion[] = [
  // Ainnova (grupo Guatefacturas): certificador con adapter REAL en curso (serv:S11).
  { value: 'ainnova', label: 'Ainnova' },
  { value: 'infile', label: 'Infile' },
  { value: 'guatefacturas', label: 'Guatefacturas (G4S)' },
  { value: 'megaprint', label: 'Megaprint' },
]

/** PACs de México (CFDI 4.0 / SAT MX). */
export const PACS_CFDI_MX: PacOpcion[] = [
  { value: 'facturama', label: 'Facturama' },
  { value: 'finkok', label: 'Finkok' },
  { value: 'sw_sapien', label: 'SW sapien' },
]

/**
 * PACs elegibles para un régimen, con Sandbox SIEMPRE primero (default de
 * pruebas). Para 'ninguno' (la empresa/locación no factura) solo se ofrece
 * Sandbox: no hay PAC real que conectar hasta elegir FEL o CFDI.
 */
export function pacsParaRegimen(regimen: RegimenFiscalConfig): PacOpcion[] {
  if (regimen === 'fel_gt') return [PAC_SANDBOX, ...PACS_FEL_GT]
  if (regimen === 'cfdi_mx') return [PAC_SANDBOX, ...PACS_CFDI_MX]
  return [PAC_SANDBOX]
}

/** Etiqueta legible de un proveedor guardado (cae al propio value si es desconocido). */
export function etiquetaPac(value: string | null | undefined): string {
  if (!value) return PAC_SANDBOX.label
  const todos = [PAC_SANDBOX, ...PACS_FEL_GT, ...PACS_CFDI_MX]
  return todos.find((p) => p.value === value)?.label ?? value
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Catálogo de regímenes (para el editor del emisor).
// ════════════════════════════════════════════════════════════════════════════

export interface RegimenOpcion {
  value: RegimenFiscalConfig
  label: string
}

export const REGIMEN_OPCIONES: RegimenOpcion[] = [
  { value: 'ninguno', label: 'No emite comprobante fiscal' },
  { value: 'fel_gt', label: 'FEL — Factura Electrónica en Línea (Guatemala)' },
  { value: 'cfdi_mx', label: 'CFDI 4.0 (México)' },
]

/** Régimen "real" (con PAC) o null si 'ninguno'. */
export function regimenReal(
  regimen: RegimenFiscalConfig | null | undefined,
): RegimenFiscal | null {
  return regimen === 'fel_gt' || regimen === 'cfdi_mx' ? regimen : null
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Lógica de HERENCIA mostrada (qué campos overridea la locación).
// ════════════════════════════════════════════════════════════════════════════
//
// La UI marca cada campo del emisor como "Heredado (empresa)" o "Propio
// (locación)". A NIVEL EMPRESA (sin locación) nada hereda: la empresa es el
// origen. A NIVEL LOCACIÓN, un campo hereda si su override de la locación está
// vacío (null/''); si la locación aporta valor, es propio. Es el mismo criterio
// (override = locacion ?? empresa) que aplica resolverConfigFiscalEfectiva,
// expresado para la presentación — sin reimplementar la resolución del valor.

/** Campos fiscales del emisor que el editor gestiona por nivel. */
export type CampoFiscal =
  | 'regimenFiscal'
  | 'nombreFiscal'
  | 'nit'
  | 'rfc'
  | 'proveedorTimbrado'
  | 'establecimiento'
  | 'lugarExpedicion'
  | 'serieFiscal'

/** Origen efectivo de un campo: heredado de la empresa o propio de la locación. */
export type OrigenCampo = 'heredado' | 'locacion'

/** ¿Un override de locación aporta valor? (null/'' = no → hereda). */
function tieneValor(v: string | null | undefined): boolean {
  return v != null && v.trim() !== ''
}

/**
 * Decide el origen (heredado vs locación) de cada campo fiscal para la vista.
 *
 *   - `ambito === 'empresa'` (sin locación): TODO es 'heredado' es engañoso —
 *     a nivel empresa los campos son el origen, así que devolvemos 'locacion'
 *     solo cuando hay locación. Para empresa, todos los campos son del propio
 *     nivel y la UI no muestra el chip de herencia (ver `mostrarHerencia`).
 *   - `ambito === 'locacion'`: un campo es 'locacion' (override propio) si el
 *     valor correspondiente en la fila de la locación tiene valor; si no,
 *     'heredado' de la empresa.
 *
 * `establecimiento` y `serieFiscal` NO existen a nivel empresa: si la locación
 * no los aporta, quedan vacíos (no "heredados"); los tratamos como 'locacion'
 * (propios del nivel locación, simplemente sin capturar).
 */
export function origenCampos(
  ambito: 'empresa' | 'locacion',
  locacion: ConfigFiscalLocacion | null | undefined,
): Record<CampoFiscal, OrigenCampo> {
  if (ambito === 'empresa' || !locacion) {
    // A nivel empresa todos los campos son del propio nivel (no heredan).
    return {
      regimenFiscal: 'locacion',
      nombreFiscal: 'locacion',
      nit: 'locacion',
      rfc: 'locacion',
      proveedorTimbrado: 'locacion',
      establecimiento: 'locacion',
      lugarExpedicion: 'locacion',
      serieFiscal: 'locacion',
    }
  }
  const o = (v: string | null | undefined): OrigenCampo =>
    tieneValor(v) ? 'locacion' : 'heredado'
  return {
    regimenFiscal: o(locacion.regimenFiscal),
    nombreFiscal: o(locacion.nombreFiscal ?? locacion.nombre),
    nit: o(locacion.nit),
    rfc: o(locacion.rfc),
    proveedorTimbrado: o(locacion.proveedorTimbrado),
    // Solo existen a nivel locación: si vienen vacíos, siguen siendo del nivel
    // locación (sin capturar), no heredados de la empresa.
    establecimiento: 'locacion',
    lugarExpedicion: o(locacion.lugarExpedicion),
    serieFiscal: 'locacion',
  }
}

/** ¿La vista debe mostrar chips de herencia? Solo cuando hay locación elegida. */
export function mostrarHerencia(ambito: 'empresa' | 'locacion'): boolean {
  return ambito === 'locacion'
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Presentación del estado de conexión (badge).
// ════════════════════════════════════════════════════════════════════════════

export interface EstadoConexionStyle {
  label: string
  icon: string
  bg: string
  color: string
}

/**
 * Estilo del badge de estado_conexion. Acepta cualquier string; un valor
 * desconocido o ausente cae a 'desconocido' (nunca probado).
 */
export function estadoConexionStyle(
  estado: string | null | undefined,
): EstadoConexionStyle {
  switch (estado) {
    case 'ok':
      return { label: 'Conectado', icon: '✅', bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' }
    case 'error':
      return { label: 'Error de conexión', icon: '⛔', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' }
    default:
      return { label: 'Sin probar', icon: '○', bg: 'var(--at-chip)', color: 'var(--at-ink-3)' }
  }
}

/**
 * Régimen que aplica para mostrar los campos del editor del emisor, a partir de
 * la config efectiva (lo que el builder usaría). 'ninguno' → null (no factura).
 */
export function regimenDeConfig(
  config: Pick<ConfigFiscalEfectiva, 'regimenFiscal'> | null | undefined,
): RegimenFiscal | null {
  return config ? regimenReal(config.regimenFiscal) : null
}
