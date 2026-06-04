// serv:S11 — ESPEJO Deno de la lógica pura fiscal de src/lib/businessFiscal.ts.
//
// El edge (Deno) no importa src/. Esta es la misma máquina de estados + builder
// del DTE canónico + validación de NIT/RFC, replicada para el runtime Deno (igual
// que el cron de mora replicó calcularMora). Mantener en sintonía con
// src/lib/businessFiscal.ts. Sin I/O, sin supabase-js → `deno check` limpio y
// testeable con vitest.

import type {
  AccionFiscal,
  ConfigEmisor,
  ConfigFiscalEfectiva,
  ConfigFiscalEmpresa,
  ConfigFiscalLocacion,
  ConfigReceptor,
  DteCanonico,
  EmisorFiscal,
  EstadoFiscal,
  FacturaParaDte,
  LineaDte,
  ReceptorFiscal,
  RegimenFiscal,
  RegimenFiscalConfig,
  TipoDocumentoFiscal,
} from './types.ts'

// ── Máquina de estados ────────────────────────────────────────────────────────
export const TRANSICIONES_FISCAL: Record<
  EstadoFiscal,
  Partial<Record<AccionFiscal, EstadoFiscal>>
> = {
  borrador: { emitir: 'por_timbrar' },
  por_timbrar: { timbrar: 'timbrado', rechazar: 'rechazado' },
  rechazado: { reintentar: 'por_timbrar' },
  timbrado: { cancelar: 'cancelado' },
  cancelado: {},
}

export const ESTADO_FISCAL_INICIAL: EstadoFiscal = 'borrador'

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

export function esEstadoFiscalTerminal(estado?: string | null): boolean {
  return normalizarEstadoFiscal(estado) === 'cancelado'
}

export interface ResultadoTransicionFiscal {
  ok: boolean
  estado?: EstadoFiscal
  error?: string
}

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

export function puedeTimbrar(estadoActual: string | null | undefined): boolean {
  return puedeTransicionarFiscal(estadoActual, 'timbrar').ok
}

export interface ParcheTransicionFiscal {
  estado: EstadoFiscal
  fecha_certificacion?: string
  error?: string | null
}

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
    parche.error = null
  } else if (accion === 'rechazar') {
    parche.error = errorMsg ?? 'Rechazado por el certificador.'
  } else if (accion === 'reintentar') {
    parche.error = null
  }
  return parche
}

// ── Validación de identificadores tributarios (por formato) ──────────────────
export function validarNitGt(
  nit: string | null | undefined,
  opciones?: { permitirCF?: boolean },
): boolean {
  if (nit == null) return false
  const limpio = nit.trim().toUpperCase().replace(/-/g, '')
  if (limpio === '') return false
  if (limpio === 'CF') return opciones?.permitirCF ?? true
  if (!/^[0-9]+[0-9K]$/.test(limpio)) return false
  const cuerpo = limpio.slice(0, -1)
  const verificador = limpio.slice(-1)
  let suma = 0
  const n = cuerpo.length
  for (let i = 0; i < n; i++) {
    suma += Number(cuerpo[i]) * (n + 1 - i)
  }
  const modulo = suma % 11
  const calculado = (11 - modulo) % 11
  const esperado = calculado === 10 ? 'K' : String(calculado)
  return verificador === esperado
}

export function validarRfcMx(rfc: string | null | undefined): boolean {
  if (rfc == null) return false
  const limpio = rfc.trim().toUpperCase()
  if (limpio === '') return false
  const re = /^([A-ZÑ&]{3,4})([0-9]{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([A-Z0-9]{2})([0-9A])$/
  return re.test(limpio)
}

export function validarIdentificadorReceptor(
  regimen: RegimenFiscal,
  identificador: string | null | undefined,
): boolean {
  return regimen === 'fel_gt'
    ? validarNitGt(identificador, { permitirCF: true })
    : validarRfcMx(identificador)
}

// ── Builder del DTE canónico ─────────────────────────────────────────────────
function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function monedaPorRegimen(regimen: RegimenFiscal): string {
  return regimen === 'fel_gt' ? 'GTQ' : 'MXN'
}

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

export function validarDteParaTimbrar(dte: DteCanonico): string[] {
  const errores: string[] = []
  if (!dte.emisor?.nombre?.trim()) errores.push('Falta el nombre fiscal del emisor.')
  if (!dte.receptor?.nombre?.trim()) errores.push('Falta el nombre fiscal del receptor.')

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

// ── Resolver de CONFIG FISCAL EFECTIVA (override empresa↔locación) ────────────
// serv:S11. ESPEJO Deno de resolverConfigFiscalEfectiva de
// src/lib/businessFiscal.ts. override.campo = locacion.campo ?? empresa.campo.
function nz(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = v.trim()
  return t === '' ? null : t
}

function override(
  locacion: string | null | undefined,
  empresa: string | null | undefined,
): string | null {
  return nz(locacion) ?? nz(empresa)
}

function normalizarRegimenConfig(
  r: string | null | undefined,
): RegimenFiscalConfig {
  return r === 'fel_gt' || r === 'cfdi_mx' || r === 'ninguno' ? r : 'ninguno'
}

export function resolverConfigFiscalEfectiva(
  empresa: ConfigFiscalEmpresa | null | undefined,
  locacion?: ConfigFiscalLocacion | null,
): ConfigFiscalEfectiva {
  const emp = empresa ?? {}
  const loc = locacion ?? {}

  const regimenLoc = nz(loc.regimenFiscal)
  const proveedorLoc = nz(loc.proveedorTimbrado)

  const regimenFiscal = regimenLoc
    ? normalizarRegimenConfig(regimenLoc)
    : normalizarRegimenConfig(emp.regimenFiscal)

  const nombreFiscal =
    override(loc.nombreFiscal, loc.nombre) ??
    override(emp.nombreFiscal, emp.nombre)

  const nit = override(loc.nit, null) ?? override(emp.nit, emp.taxId)
  const rfc = override(loc.rfc, emp.rfc)
  const proveedorTimbrado =
    override(loc.proveedorTimbrado, emp.proveedorTimbrado) ?? 'sandbox'
  const establecimiento = nz(loc.establecimiento)
  const lugarExpedicion = override(loc.lugarExpedicion, emp.codigoPostal)
  const serieFiscal = nz(loc.serieFiscal)

  return {
    regimenFiscal,
    nombreFiscal,
    nit,
    rfc,
    proveedorTimbrado,
    establecimiento,
    lugarExpedicion,
    serieFiscal,
    desdeLocacion: regimenLoc != null || proveedorLoc != null,
  }
}

export function regimenRealDeConfig(
  config: Pick<ConfigFiscalEfectiva, 'regimenFiscal'>,
): RegimenFiscal | null {
  return config.regimenFiscal === 'fel_gt' || config.regimenFiscal === 'cfdi_mx'
    ? config.regimenFiscal
    : null
}
