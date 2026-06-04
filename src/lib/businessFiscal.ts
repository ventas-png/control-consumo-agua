// serv:S11 — Lógica PURA del núcleo de Facturación Electrónica Fiscal FEL/CFDI.
//
// Sin I/O, sin React, sin Supabase: solo funciones puras testeables. Espeja el
// estilo de la máquina de estados de Factura en src/lib/business.ts
// (puedeTransicionarFactura / aplicarTransicionFactura), pero para el ciclo de
// vida FISCAL del comprobante (documentos_fiscales), que es independiente del
// ciclo de cobro de la Factura.
//
// NO se toca business.ts: el dominio fiscal es nuevo y separado.
//
// FRONTERA Deno/Vite: el edge (supabase/functions) NO importa src/. Las partes
// que el edge necesita (máquina de estados + builder del DTE canónico) se
// ESPEJAN en supabase/functions/_shared/fiscal/ (como el cron de mora espejó
// calcularMora). Este archivo es la fuente de verdad del lado Vite.

import type {
  AccionFiscal,
  DteCanonico,
  EmisorFiscal,
  EstadoFiscal,
  LineaDte,
  ReceptorFiscal,
  RegimenFiscal,
  TipoDocumentoFiscal,
} from '../types/fiscal'

// ════════════════════════════════════════════════════════════════════════════
// 1. Máquina de estados del comprobante fiscal.
// ════════════════════════════════════════════════════════════════════════════
//
//   borrador ─emitir→ por_timbrar ─timbrar→ timbrado ─cancelar→ cancelado
//                          ▲   └────rechazar→ rechazado ─reintentar┘
//
//   - borrador:    se construyó el comprobante, aún no se manda al PAC.
//   - por_timbrar: listo y encolado para certificar (idempotencia: el edge solo
//                  timbra documentos en este estado).
//   - timbrado:    el certificador devolvió UUID/sello OK.
//   - rechazado:   el certificador lo rechazó (se puede corregir y reintentar).
//   - cancelado:   cancelación fiscal de un comprobante ya timbrado (terminal).

export const TRANSICIONES_FISCAL: Record<
  EstadoFiscal,
  Partial<Record<AccionFiscal, EstadoFiscal>>
> = {
  borrador: { emitir: 'por_timbrar' },
  por_timbrar: { timbrar: 'timbrado', rechazar: 'rechazado' },
  rechazado: { reintentar: 'por_timbrar' },
  timbrado: { cancelar: 'cancelado' },
  cancelado: {}, // terminal
}

/** Estado inicial seguro de un comprobante recién construido. */
export const ESTADO_FISCAL_INICIAL: EstadoFiscal = 'borrador'

/** Normaliza un estado desconocido/nulo al inicial seguro ('borrador'). */
export function normalizarEstadoFiscal(estado?: string | null): EstadoFiscal {
  switch (estado) {
    case 'borrador':
    case 'por_timbrar':
    case 'timbrado':
    case 'rechazado':
    case 'cancelado':
      return estado
    default:
      return ESTADO_FISCAL_INICIAL
  }
}

/**
 * Estados terminales: ya no admiten transición. Solo 'cancelado'.
 * (timbrado NO es terminal: aún puede cancelarse.)
 */
export function esEstadoFiscalTerminal(estado?: string | null): boolean {
  return normalizarEstadoFiscal(estado) === 'cancelado'
}

export interface ResultadoTransicionFiscal {
  ok: boolean
  estado?: EstadoFiscal
  error?: string
}

/**
 * Valida si una acción es aplicable al estado actual SIN mutar. Normaliza el
 * estado de entrada. Devuelve el estado destino si es válida.
 */
export function puedeTransicionarFiscal(
  estadoActual: string | null | undefined,
  accion: AccionFiscal,
): ResultadoTransicionFiscal {
  const actual = normalizarEstadoFiscal(estadoActual)
  const destino = TRANSICIONES_FISCAL[actual]?.[accion]
  if (!destino) {
    return {
      ok: false,
      error: `Transición fiscal inválida: no se puede "${accion}" un comprobante en estado "${actual}".`,
    }
  }
  return { ok: true, estado: destino }
}

/**
 * ¿El comprobante puede TIMBRARSE ahora? Solo si está en 'por_timbrar'.
 * Atajo semántico sobre puedeTransicionarFiscal(estado, 'timbrar') que usa el
 * edge antes de llamar al PAC (idempotencia: no re-timbrar lo ya timbrado).
 */
export function puedeTimbrar(estadoActual: string | null | undefined): boolean {
  return puedeTransicionarFiscal(estadoActual, 'timbrar').ok
}

/** Campos que la transición setea sobre la fila de documentos_fiscales. */
export interface ParcheTransicionFiscal {
  estado: EstadoFiscal
  /** Solo en 'timbrar' (éxito): timestamp de certificación. */
  fecha_certificacion?: string
  /** Solo en 'rechazar': mensaje de error. En éxito se limpia (null). */
  error?: string | null
}

/**
 * Aplica una transición y devuelve el parche a persistir. Fail-fast: lanza si la
 * transición es inválida (validar antes con puedeTransicionarFiscal para manejar
 * el error sin throw). Espeja aplicarTransicionFactura de business.ts.
 *
 * @param ahora   ISO timestamp a estampar (default now). Parametrizado para tests.
 * @param errorMsg  mensaje de error a guardar cuando accion='rechazar'.
 */
export function aplicarTransicionFiscal(
  estadoActual: string | null | undefined,
  accion: AccionFiscal,
  ahora: string = new Date().toISOString(),
  errorMsg?: string,
): ParcheTransicionFiscal {
  const res = puedeTransicionarFiscal(estadoActual, accion)
  if (!res.ok || !res.estado) {
    throw new Error(res.error ?? 'Transición fiscal inválida.')
  }
  const parche: ParcheTransicionFiscal = { estado: res.estado }
  if (accion === 'timbrar') {
    parche.fecha_certificacion = ahora
    parche.error = null // limpia cualquier error de un rechazo previo
  } else if (accion === 'rechazar') {
    parche.error = errorMsg ?? 'Rechazado por el certificador.'
  } else if (accion === 'reintentar') {
    parche.error = null
  }
  return parche
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Validación de identificadores tributarios (por FORMATO, no contra el SAT).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Valida un NIT de Guatemala por formato. Reglas:
 *   - 'CF' (Consumidor Final) es válido (sin NIT del receptor).
 *   - Dígitos seguidos de un dígito verificador que puede ser 0-9 o 'K'.
 *   - Se valida el dígito verificador con el algoritmo módulo-11 del SAT GT.
 *
 * Acepta NIT con o sin guion (ej. '1234567-8' o '12345678'). Vacío/nulo = false
 * salvo que se permita 'CF' explícitamente (ver permitirCF).
 */
export function validarNitGt(
  nit: string | null | undefined,
  opciones?: { permitirCF?: boolean },
): boolean {
  if (nit == null) return false
  const limpio = nit.trim().toUpperCase().replace(/-/g, '')
  if (limpio === '') return false
  // Consumidor Final.
  if (limpio === 'CF') return opciones?.permitirCF ?? true

  // Cuerpo: dígitos; verificador: dígito 0-9 o K.
  if (!/^[0-9]+[0-9K]$/.test(limpio)) return false

  const cuerpo = limpio.slice(0, -1)
  const verificador = limpio.slice(-1)

  // Algoritmo módulo-11 (SAT GT): pondera cada dígito del cuerpo por su posición
  // (de mayor a menor, empezando en len+1), suma, módulo 11; el verificador es
  // (11 - resto) % 11, donde 10 → 'K'.
  let suma = 0
  const n = cuerpo.length
  for (let i = 0; i < n; i++) {
    const digito = Number(cuerpo[i])
    suma += digito * (n + 1 - i)
  }
  const modulo = suma % 11
  const calculado = (11 - modulo) % 11
  const esperado = calculado === 10 ? 'K' : String(calculado)
  return verificador === esperado
}

/**
 * Valida un RFC de México por formato (persona física o moral). NO valida la
 * homoclave contra el SAT; solo la estructura oficial:
 *   - Persona moral: 3 letras + 6 dígitos (fecha AAMMDD) + 3 alfanum (homoclave).
 *   - Persona física: 4 letras + 6 dígitos + 3 alfanum.
 *   - 'XAXX010101000' (RFC genérico nacional) y 'XEXX010101000' (extranjero) se
 *     aceptan como válidos.
 */
export function validarRfcMx(rfc: string | null | undefined): boolean {
  if (rfc == null) return false
  const limpio = rfc.trim().toUpperCase()
  if (limpio === '') return false
  // 3 (moral) o 4 (física) letras/&/Ñ, 6 dígitos de fecha, 3 de homoclave.
  const re = /^([A-ZÑ&]{3,4})([0-9]{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([A-Z0-9]{2})([0-9A])$/
  return re.test(limpio)
}

/**
 * Valida el identificador del receptor según el régimen. Atajo que delega en el
 * validador correcto. Para FEL permite 'CF' por defecto.
 */
export function validarIdentificadorReceptor(
  regimen: RegimenFiscal,
  identificador: string | null | undefined,
): boolean {
  return regimen === 'fel_gt'
    ? validarNitGt(identificador, { permitirCF: true })
    : validarRfcMx(identificador)
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Builder del "DTE canónico" (forma intermedia provider-agnostic).
// ════════════════════════════════════════════════════════════════════════════

/** Subconjunto de la Factura (registro) que necesita el builder. */
export interface FacturaParaDte {
  id?: string | null
  /** Subtotal sin IVA (registros.monto_calculado). */
  subtotal: number
  /** Tasa de IVA aplicada como fracción [0,1] (registros.iva_tasa). */
  ivaTasa: number
  /** Monto de IVA (registros.iva_monto). Si falta, se deriva de subtotal*tasa. */
  ivaMonto?: number | null
  /** Total (registros.total_a_pagar / monto_con_iva). Si falta, subtotal+iva. */
  total?: number | null
  /** Descripción de la línea (ej. "Consumo de agua — junio 2026"). */
  descripcion: string
  /** Periodo/mes para la descripción si no se pasa una explícita. */
  mes?: string | null
}

/** Config fiscal del emisor (desde companies). */
export interface ConfigEmisor {
  regimen: RegimenFiscal
  nombre: string
  nombreFiscal?: string | null
  nit?: string | null
  rfc?: string | null
  direccion?: EmisorFiscal['direccion']
}

/** Config fiscal del receptor (desde clientes). */
export interface ConfigReceptor {
  nombre: string
  nombreFiscal?: string | null
  nit?: string | null
  rfc?: string | null
  usoCfdi?: string | null
}

/** Redondeo a 2 decimales estable (evita errores de coma flotante). */
function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Moneda por defecto según régimen (ISO 4217). */
export function monedaPorRegimen(regimen: RegimenFiscal): string {
  return regimen === 'fel_gt' ? 'GTQ' : 'MXN'
}

/**
 * Construye el DTE canónico desde la Factura + config de emisor/receptor.
 * Provider-agnostic: NO contiene nada específico de un PAC. Determinista
 * (acepta `fechaEmision` para tests). Calcula las líneas/totales de forma
 * consistente y redondeada.
 *
 * Reglas:
 *   - Hoy una sola línea (el cobro de agua del registro). Multi-línea es
 *     follow-up cuando existan cargos adicionales.
 *   - ivaMonto/total se toman de la Factura si vienen; si no, se derivan.
 *   - nombre fiscal cae a nombre comercial si falta.
 *   - moneda por defecto según régimen; se puede sobreescribir.
 */
export function construirDteCanonico(params: {
  factura: FacturaParaDte
  emisor: ConfigEmisor
  receptor: ConfigReceptor
  tipo?: TipoDocumentoFiscal
  moneda?: string
  fechaEmision?: string
}): DteCanonico {
  const { factura, emisor, receptor } = params
  const regimen = emisor.regimen
  const tipo: TipoDocumentoFiscal = params.tipo ?? 'factura'
  const moneda = params.moneda ?? monedaPorRegimen(regimen)
  const fechaEmision = params.fechaEmision ?? new Date().toISOString()

  const subtotal = redondear2(factura.subtotal)
  const ivaTasa = factura.ivaTasa
  const ivaMonto = redondear2(
    factura.ivaMonto != null ? factura.ivaMonto : subtotal * ivaTasa,
  )
  const total = redondear2(
    factura.total != null ? factura.total : subtotal + ivaMonto,
  )

  const descripcion =
    factura.descripcion?.trim() ||
    (factura.mes ? `Consumo de agua — ${factura.mes}` : 'Consumo de agua')

  // Una sola línea con cantidad 1 (el monto ya es el subtotal calculado).
  const linea: LineaDte = {
    descripcion,
    cantidad: 1,
    precioUnitario: subtotal,
    subtotal,
    ivaMonto,
    total,
  }

  const emisorFiscal: EmisorFiscal = {
    nombre: (emisor.nombreFiscal?.trim() || emisor.nombre).trim(),
    nit: emisor.nit ?? null,
    rfc: emisor.rfc ?? null,
    direccion: emisor.direccion ?? null,
  }

  const receptorFiscal: ReceptorFiscal = {
    nombre: (receptor.nombreFiscal?.trim() || receptor.nombre).trim(),
    nit: receptor.nit ?? null,
    rfc: receptor.rfc ?? null,
    usoCfdi: receptor.usoCfdi ?? null,
  }

  return {
    regimen,
    tipo,
    moneda,
    fechaEmision,
    emisor: emisorFiscal,
    receptor: receptorFiscal,
    lineas: [linea],
    subtotal,
    ivaTasa,
    ivaMonto,
    total,
    registroId: factura.id ?? null,
  }
}

/**
 * Valida que un DTE canónico esté completo para timbrar (chequeos de negocio,
 * no de PAC). Devuelve la lista de problemas (vacía = listo). El edge la usa
 * antes de marcar 'por_timbrar' / llamar al adapter.
 */
export function validarDteParaTimbrar(dte: DteCanonico): string[] {
  const errores: string[] = []

  if (!dte.emisor?.nombre?.trim()) errores.push('Falta el nombre fiscal del emisor.')
  if (!dte.receptor?.nombre?.trim()) errores.push('Falta el nombre fiscal del receptor.')

  // Identificador tributario del EMISOR según régimen.
  if (dte.regimen === 'fel_gt') {
    if (!validarNitGt(dte.emisor?.nit, { permitirCF: false })) {
      errores.push('El NIT del emisor (Guatemala) es inválido o falta.')
    }
    if (!validarIdentificadorReceptor('fel_gt', dte.receptor?.nit)) {
      errores.push('El NIT del receptor (Guatemala) es inválido. Use "CF" si no lo proporciona.')
    }
  } else {
    if (!validarRfcMx(dte.emisor?.rfc)) {
      errores.push('El RFC del emisor (México) es inválido o falta.')
    }
    if (!validarRfcMx(dte.receptor?.rfc)) {
      errores.push('El RFC del receptor (México) es inválido o falta.')
    }
    if (!dte.receptor?.usoCfdi?.trim()) {
      errores.push('Falta el uso del CFDI del receptor (México).')
    }
  }

  if (!dte.lineas || dte.lineas.length === 0) {
    errores.push('El comprobante no tiene líneas de detalle.')
  }
  if (!(dte.total > 0)) {
    errores.push('El total del comprobante debe ser mayor a 0.')
  }
  if (dte.ivaTasa < 0 || dte.ivaTasa > 1) {
    errores.push('La tasa de IVA debe ser una fracción entre 0 y 1.')
  }

  return errores
}
