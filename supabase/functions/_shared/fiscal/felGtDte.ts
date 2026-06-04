// serv:S11 — Mapeo PURO del DTE canónico → estructura del DTE FEL (Guatemala).
//
// PAC-AGNOSTIC dentro de GT: Ainnova, Infile y Megaprint certifican el MISMO DTE
// FEL del Acuerdo de Directorio SAT 13-2018; lo único que cambia entre ellos es el
// TRANSPORTE (endpoint/credenciales/firma), no la forma del documento. Por eso este
// mapeo vive aparte del adapter de Ainnova y es reutilizable por cualquier
// certificador GT.
//
// Esta capa produce una ESTRUCTURA intermedia (FelDte), NO el XML final ni la firma:
//   - El XML del SAT GT (GTDocumento, namespaces dte:) y la Firma Electrónica los
//     arma/aplica el transporte del PAC (ainnovaProvider) cuando se confirme el
//     contrato + se carguen credenciales. Mantener el XML/firma fuera de aquí deja
//     esta capa pura, testeable y `deno check`-limpia.
//
// NOTA FEL (clave): en FEL los precios/totales del Item son IVA-INCLUIDOS. Para una
// línea con total T (con IVA) al 12 %: MontoGravable = T/1.12, MontoImpuesto = T −
// MontoGravable, Precio = T. El DTE canónico ya trae subtotal (base sin IVA),
// ivaMonto y total (con IVA) coherentes, así que mapeamos directo sin recalcular la
// tasa (evita drift con el cálculo de la Factura).

import type { DteCanonico, LineaDte, TipoDocumentoFiscal } from './types.ts'

/** Tipos de DTE del catálogo FEL (subset que este sistema puede emitir). */
export type TipoDteFel =
  | 'FACT' // Factura
  | 'NCRE' // Nota de crédito
  | 'NDEB' // Nota de débito
  | 'RECI' // Recibo
  | 'NABN' // Nota de abono

/** Dirección en el formato FEL (Emisor/Receptor). */
export interface FelDireccion {
  direccion: string
  codigoPostal: string
  municipio: string
  departamento: string
  /** Código de país ISO; GT por defecto. */
  pais: string
}

/** Emisor del DTE FEL. */
export interface FelEmisor {
  /** NIT del emisor, normalizado (sin guiones, mayúsculas). */
  nitEmisor: string
  nombreEmisor: string
  /** Código de establecimiento del emisor ante SAT (>=1). */
  codigoEstablecimiento: number
  nombreComercial: string
  /** Afiliación al IVA (GEN = régimen general). */
  afiliacionIVA: string
  direccion: FelDireccion
}

/** Receptor del DTE FEL. */
export interface FelReceptor {
  /** ID del receptor: NIT normalizado o 'CF' (Consumidor Final). */
  idReceptor: string
  nombreReceptor: string
  direccion: FelDireccion
}

/** Un impuesto de una línea (FEL maneja IVA por línea). */
export interface FelImpuesto {
  /** Nombre corto del impuesto (IVA). */
  nombreCorto: string
  /** Código de la unidad gravable (1 = bienes/servicios gravados al IVA). */
  codigoUnidadGravable: number
  /** Base gravable (sin IVA). */
  montoGravable: number
  /** Monto del impuesto (IVA). */
  montoImpuesto: number
}

/** Una línea/Item del DTE FEL (precios IVA-incluidos). */
export interface FelItem {
  numeroLinea: number
  /** B = bien, S = servicio. */
  bienOServicio: 'B' | 'S'
  cantidad: number
  unidadMedida: string
  descripcion: string
  /** Precio unitario IVA-incluido. */
  precioUnitario: number
  /** Precio = cantidad * precioUnitario (IVA-incluido), antes de descuento. */
  precio: number
  descuento: number
  impuestos: FelImpuesto[]
  /** Total de la línea (precio − descuento), IVA-incluido. */
  total: number
}

/** Una frase del DTE (escenarios ISR/IVA exigidos por SAT según el régimen). */
export interface FelFrase {
  tipoFrase: number
  codigoEscenario: number
}

/** Total de un impuesto agregado del DTE. */
export interface FelTotalImpuesto {
  nombreCorto: string
  totalMontoImpuesto: number
}

/** DTE FEL completo (estructura intermedia, pre-XML/firma). */
export interface FelDte {
  tipo: TipoDteFel
  /** Fecha/hora de emisión (ISO 8601). */
  fechaHoraEmision: string
  /** Moneda ISO 4217 (GTQ). */
  codigoMoneda: string
  emisor: FelEmisor
  receptor: FelReceptor
  frases: FelFrase[]
  items: FelItem[]
  totalImpuestos: FelTotalImpuesto[]
  granTotal: number
}

/**
 * Opciones del emisor que NO viven en el DTE canónico pero el DTE FEL exige.
 * Tienen defaults razonables; los que dependen del régimen del emisor (frases ISR,
 * afiliación IVA, establecimiento) deben confirmarse contra el alta del emisor en
 * SAT/Ainnova. El edge los deriva de la config fiscal efectiva (establecimiento, etc.).
 */
export interface FelOpciones {
  /** projects.establecimiento (>=1). Default 1. */
  codigoEstablecimiento?: number | string | null
  nombreComercial?: string | null
  /** Afiliación IVA del emisor (GEN por defecto). */
  afiliacionIVA?: string | null
  /** Unidad de medida de las líneas (UNI por defecto). */
  unidadMedida?: string | null
  /** B (bien) o S (servicio). El cobro de agua es un servicio → 'S' por defecto. */
  bienOServicio?: 'B' | 'S' | null
  /** Frases del DTE (ISR/IVA). Default []: deben confirmarse por régimen del emisor. */
  frases?: FelFrase[] | null
  /** Override de la dirección del emisor (los faltantes caen al default GT). */
  direccionEmisor?: Partial<FelDireccion> | null
  /** Override de la dirección del receptor. */
  direccionReceptor?: Partial<FelDireccion> | null
}

const PAIS_DEFAULT = 'GT'
const MONEDA_DEFAULT = 'GTQ'

/** Dirección placeholder válida para GT cuando no se conoce la real (ej. receptor CF). */
const DIRECCION_GT_DEFAULT: FelDireccion = {
  direccion: 'Ciudad',
  codigoPostal: '01001',
  municipio: 'Guatemala',
  departamento: 'Guatemala',
  pais: PAIS_DEFAULT,
}

/** Redondeo a 2 decimales estable (mismo criterio que el builder canónico). */
function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Normaliza un NIT GT para FEL: sin guiones/espacios, en mayúsculas. */
export function normalizarNitFel(nit: string | null | undefined): string {
  return (nit ?? '').trim().toUpperCase().replace(/[\s-]/g, '')
}

/** Mapea el tipo canónico al código de DTE FEL. */
export function tipoDteFel(tipo: TipoDocumentoFiscal): TipoDteFel {
  switch (tipo) {
    case 'nota_credito':
      return 'NCRE'
    case 'nota_debito':
      return 'NDEB'
    case 'recibo':
      return 'RECI'
    case 'nota_abono':
      return 'NABN'
    case 'factura':
    default:
      return 'FACT'
  }
}

/** Convierte el código de establecimiento a entero >=1 (default 1). */
function establecimiento(v: number | string | null | undefined): number {
  if (v == null || v === '') return 1
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1
}

/** Combina una dirección parcial con la del DTE canónico y el default GT. */
function resolverDireccion(
  base: DteCanonico['emisor']['direccion'] | null | undefined,
  override: Partial<FelDireccion> | null | undefined,
): FelDireccion {
  return {
    direccion: override?.direccion ?? base?.linea1 ?? DIRECCION_GT_DEFAULT.direccion,
    codigoPostal: override?.codigoPostal ?? base?.codigoPostal ?? DIRECCION_GT_DEFAULT.codigoPostal,
    municipio: override?.municipio ?? base?.ciudad ?? DIRECCION_GT_DEFAULT.municipio,
    departamento:
      override?.departamento ?? base?.departamento ?? DIRECCION_GT_DEFAULT.departamento,
    pais: override?.pais ?? base?.pais ?? PAIS_DEFAULT,
  }
}

/** Mapea una línea canónica a un Item FEL (IVA-incluido). */
function mapearItem(
  linea: LineaDte,
  numeroLinea: number,
  opts: { unidadMedida: string; bienOServicio: 'B' | 'S' },
): FelItem {
  const cantidad = linea.cantidad > 0 ? linea.cantidad : 1
  const precio = redondear2(linea.total) // FEL: precio IVA-incluido
  const precioUnitario = redondear2(precio / cantidad)
  const montoGravable = redondear2(linea.subtotal)
  const montoImpuesto = redondear2(linea.ivaMonto)
  return {
    numeroLinea,
    bienOServicio: opts.bienOServicio,
    cantidad,
    unidadMedida: opts.unidadMedida,
    descripcion: linea.descripcion,
    precioUnitario,
    precio,
    descuento: 0,
    impuestos: [
      {
        nombreCorto: 'IVA',
        codigoUnidadGravable: 1,
        montoGravable,
        montoImpuesto,
      },
    ],
    total: precio,
  }
}

/**
 * Construye el DTE FEL (estructura intermedia) desde el DTE canónico + opciones del
 * emisor. PURO y determinista. NO firma ni serializa XML — eso es del transporte.
 *
 * Precondición: `dte.regimen === 'fel_gt'` (lo garantiza el resolver del provider).
 * No revalida NIT/totales: ya lo hizo `validarDteParaTimbrar` en el edge.
 */
export function construirFelDte(dte: DteCanonico, opciones: FelOpciones = {}): FelDte {
  const unidadMedida = (opciones.unidadMedida ?? 'UNI').trim() || 'UNI'
  const bienOServicio: 'B' | 'S' = opciones.bienOServicio === 'B' ? 'B' : 'S'

  const items = dte.lineas.map((linea, i) =>
    mapearItem(linea, i + 1, { unidadMedida, bienOServicio })
  )

  const totalIva = redondear2(items.reduce((acc, it) => acc + it.impuestos[0].montoImpuesto, 0))
  const granTotal = redondear2(items.reduce((acc, it) => acc + it.total, 0))

  const idReceptor =
    normalizarNitFel(dte.receptor.nit) === '' ? 'CF' : normalizarNitFel(dte.receptor.nit)

  return {
    tipo: tipoDteFel(dte.tipo),
    fechaHoraEmision: dte.fechaEmision,
    codigoMoneda: dte.moneda || MONEDA_DEFAULT,
    emisor: {
      nitEmisor: normalizarNitFel(dte.emisor.nit),
      nombreEmisor: dte.emisor.nombre,
      codigoEstablecimiento: establecimiento(opciones.codigoEstablecimiento),
      nombreComercial: (opciones.nombreComercial ?? dte.emisor.nombre).trim(),
      afiliacionIVA: (opciones.afiliacionIVA ?? 'GEN').trim() || 'GEN',
      direccion: resolverDireccion(dte.emisor.direccion, opciones.direccionEmisor),
    },
    receptor: {
      idReceptor,
      nombreReceptor: dte.receptor.nombre,
      direccion:
        idReceptor === 'CF'
          ? { ...DIRECCION_GT_DEFAULT, ...(opciones.direccionReceptor ?? {}) }
          : resolverDireccion(null, opciones.direccionReceptor),
    },
    frases: opciones.frases ?? [],
    items,
    totalImpuestos: [{ nombreCorto: 'IVA', totalMontoImpuesto: totalIva }],
    granTotal,
  }
}
