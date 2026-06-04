// serv:S11 — Tests de la lógica pura fiscal (máquina de estados, validación de
// NIT/RFC, builder del DTE canónico). Determinista: timestamps inyectados.

import { describe, it, expect } from 'vitest'
import {
  TRANSICIONES_FISCAL,
  ESTADO_FISCAL_INICIAL,
  normalizarEstadoFiscal,
  esEstadoFiscalTerminal,
  puedeTransicionarFiscal,
  puedeTimbrar,
  aplicarTransicionFiscal,
  validarNitGt,
  validarRfcMx,
  validarIdentificadorReceptor,
  monedaPorRegimen,
  construirDteCanonico,
  validarDteParaTimbrar,
  type ConfigEmisor,
  type ConfigReceptor,
  type FacturaParaDte,
} from '../businessFiscal'
import type { DteCanonico } from '../../types/fiscal'

// ── Máquina de estados ────────────────────────────────────────────────────────
describe('businessFiscal — máquina de estados', () => {
  it('estado inicial es borrador', () => {
    expect(ESTADO_FISCAL_INICIAL).toBe('borrador')
  })

  it('normaliza estados desconocidos/nulos a borrador', () => {
    expect(normalizarEstadoFiscal(null)).toBe('borrador')
    expect(normalizarEstadoFiscal(undefined)).toBe('borrador')
    expect(normalizarEstadoFiscal('what')).toBe('borrador')
    expect(normalizarEstadoFiscal('timbrado')).toBe('timbrado')
  })

  it('solo cancelado es terminal', () => {
    expect(esEstadoFiscalTerminal('cancelado')).toBe(true)
    expect(esEstadoFiscalTerminal('timbrado')).toBe(false)
    expect(esEstadoFiscalTerminal('borrador')).toBe(false)
    expect(esEstadoFiscalTerminal('rechazado')).toBe(false)
  })

  it('transiciones válidas del happy path', () => {
    expect(puedeTransicionarFiscal('borrador', 'emitir')).toEqual({ ok: true, estado: 'por_timbrar' })
    expect(puedeTransicionarFiscal('por_timbrar', 'timbrar')).toEqual({ ok: true, estado: 'timbrado' })
    expect(puedeTransicionarFiscal('timbrado', 'cancelar')).toEqual({ ok: true, estado: 'cancelado' })
  })

  it('rechazo y reintento', () => {
    expect(puedeTransicionarFiscal('por_timbrar', 'rechazar')).toEqual({ ok: true, estado: 'rechazado' })
    expect(puedeTransicionarFiscal('rechazado', 'reintentar')).toEqual({ ok: true, estado: 'por_timbrar' })
  })

  it('transiciones inválidas devuelven ok:false con mensaje', () => {
    const r = puedeTransicionarFiscal('borrador', 'timbrar')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('inválida')
    expect(puedeTransicionarFiscal('cancelado', 'cancelar').ok).toBe(false)
    expect(puedeTransicionarFiscal('timbrado', 'timbrar').ok).toBe(false)
    expect(puedeTransicionarFiscal('borrador', 'cancelar').ok).toBe(false)
  })

  it('puedeTimbrar solo en por_timbrar (idempotencia)', () => {
    expect(puedeTimbrar('por_timbrar')).toBe(true)
    expect(puedeTimbrar('borrador')).toBe(false)
    expect(puedeTimbrar('timbrado')).toBe(false)
    expect(puedeTimbrar('rechazado')).toBe(false)
    expect(puedeTimbrar(null)).toBe(false)
  })

  it('no hay transiciones desde estados terminales', () => {
    expect(TRANSICIONES_FISCAL.cancelado).toEqual({})
  })
})

describe('businessFiscal — aplicarTransicionFiscal', () => {
  const ahora = '2026-06-04T12:00:00.000Z'

  it('emitir → parche con estado por_timbrar', () => {
    expect(aplicarTransicionFiscal('borrador', 'emitir', ahora)).toEqual({ estado: 'por_timbrar' })
  })

  it('timbrar → estado timbrado + fecha_certificacion + limpia error', () => {
    expect(aplicarTransicionFiscal('por_timbrar', 'timbrar', ahora)).toEqual({
      estado: 'timbrado',
      fecha_certificacion: ahora,
      error: null,
    })
  })

  it('rechazar → estado rechazado + mensaje de error', () => {
    expect(aplicarTransicionFiscal('por_timbrar', 'rechazar', ahora, 'NIT inválido')).toEqual({
      estado: 'rechazado',
      error: 'NIT inválido',
    })
  })

  it('rechazar sin mensaje usa default', () => {
    const p = aplicarTransicionFiscal('por_timbrar', 'rechazar', ahora)
    expect(p.estado).toBe('rechazado')
    expect(p.error).toBeTruthy()
  })

  it('reintentar → por_timbrar y limpia error', () => {
    expect(aplicarTransicionFiscal('rechazado', 'reintentar', ahora)).toEqual({
      estado: 'por_timbrar',
      error: null,
    })
  })

  it('lanza en transición inválida (fail-fast)', () => {
    expect(() => aplicarTransicionFiscal('borrador', 'timbrar', ahora)).toThrow(/inválida/)
  })
})

// ── Validación NIT (Guatemala) ──────────────────────────────────────────────
describe('businessFiscal — validarNitGt', () => {
  // Vectores con dígito verificador calculado por el módulo-11 SAT GT.
  it('acepta NIT con dígito verificador correcto', () => {
    expect(validarNitGt('12345679')).toBe(true) // cuerpo 1234567 -> dv 9
    expect(validarNitGt('5519829')).toBe(true) // cuerpo 551982 -> dv 9
    expect(validarNitGt('801402166')).toBe(true) // cuerpo 80140216 -> dv 6
  })

  it('acepta NIT con guion', () => {
    expect(validarNitGt('1234567-9')).toBe(true)
  })

  it('acepta dígito verificador K', () => {
    // Buscar un cuerpo cuyo dv sea K (módulo da 1 → 11-1=10 → K).
    // cuerpo '6' -> suma=6*2=12, %11=1, (11-1)%11=10 -> 'K'
    expect(validarNitGt('6K')).toBe(true)
  })

  it('rechaza dígito verificador incorrecto', () => {
    expect(validarNitGt('12345670')).toBe(false)
    expect(validarNitGt('5519820')).toBe(false)
  })

  it('CF (Consumidor Final) según permitirCF', () => {
    expect(validarNitGt('CF')).toBe(true) // default permite
    expect(validarNitGt('cf')).toBe(true) // case-insensitive
    expect(validarNitGt('CF', { permitirCF: true })).toBe(true)
    expect(validarNitGt('CF', { permitirCF: false })).toBe(false)
  })

  it('rechaza vacío/nulo y formatos inválidos', () => {
    expect(validarNitGt(null)).toBe(false)
    expect(validarNitGt(undefined)).toBe(false)
    expect(validarNitGt('')).toBe(false)
    expect(validarNitGt('   ')).toBe(false)
    expect(validarNitGt('ABC')).toBe(false)
    expect(validarNitGt('12.34')).toBe(false)
  })
})

// ── Validación RFC (México) ──────────────────────────────────────────────────
describe('businessFiscal — validarRfcMx', () => {
  it('acepta RFC persona moral (12 chars)', () => {
    expect(validarRfcMx('ABC230101AB1')).toBe(true)
    expect(validarRfcMx('SAT970701NN3')).toBe(true)
  })

  it('acepta RFC persona física (13 chars)', () => {
    expect(validarRfcMx('GODE561231GR8')).toBe(true)
    expect(validarRfcMx('XEXX010101000')).toBe(true) // extranjero genérico
    expect(validarRfcMx('XAXX010101000')).toBe(true) // nacional genérico
  })

  it('es case-insensitive y trimea', () => {
    expect(validarRfcMx('  gode561231gr8  ')).toBe(true)
  })

  it('rechaza fechas inválidas', () => {
    expect(validarRfcMx('ABC231301AB1')).toBe(false) // mes 13
    expect(validarRfcMx('ABC230132AB1')).toBe(false) // día 32
  })

  it('rechaza longitudes/formatos inválidos', () => {
    expect(validarRfcMx(null)).toBe(false)
    expect(validarRfcMx('')).toBe(false)
    expect(validarRfcMx('AB230101AB1')).toBe(false) // 2 letras
    expect(validarRfcMx('ABCDE230101AB1')).toBe(false) // 5 letras
    expect(validarRfcMx('1234567')).toBe(false)
  })
})

describe('businessFiscal — validarIdentificadorReceptor', () => {
  it('FEL usa NIT y permite CF', () => {
    expect(validarIdentificadorReceptor('fel_gt', 'CF')).toBe(true)
    expect(validarIdentificadorReceptor('fel_gt', '12345679')).toBe(true)
    expect(validarIdentificadorReceptor('fel_gt', 'bad')).toBe(false)
  })

  it('CFDI usa RFC', () => {
    expect(validarIdentificadorReceptor('cfdi_mx', 'GODE561231GR8')).toBe(true)
    expect(validarIdentificadorReceptor('cfdi_mx', 'CF')).toBe(false)
  })
})

// ── Builder del DTE canónico ─────────────────────────────────────────────────
describe('businessFiscal — construirDteCanonico', () => {
  const fecha = '2026-06-04T00:00:00.000Z'
  const facturaGt: FacturaParaDte = {
    id: 'reg-1',
    subtotal: 100,
    ivaTasa: 0.12,
    ivaMonto: 12,
    total: 112,
    descripcion: 'Consumo de agua — junio 2026',
  }
  const emisorGt: ConfigEmisor = {
    regimen: 'fel_gt',
    nombre: 'Aguas SA',
    nombreFiscal: 'Aguas Sociedad Anónima',
    nit: '12345679',
  }
  const receptorGt: ConfigReceptor = { nombre: 'Juan Pérez', nit: 'CF' }

  it('arma un DTE GT coherente y determinista', () => {
    const dte = construirDteCanonico({
      factura: facturaGt,
      emisor: emisorGt,
      receptor: receptorGt,
      fechaEmision: fecha,
    })
    expect(dte.regimen).toBe('fel_gt')
    expect(dte.tipo).toBe('factura')
    expect(dte.moneda).toBe('GTQ')
    expect(dte.fechaEmision).toBe(fecha)
    expect(dte.emisor.nombre).toBe('Aguas Sociedad Anónima') // usa nombreFiscal
    expect(dte.receptor.nombre).toBe('Juan Pérez')
    expect(dte.receptor.nit).toBe('CF')
    expect(dte.subtotal).toBe(100)
    expect(dte.ivaMonto).toBe(12)
    expect(dte.total).toBe(112)
    expect(dte.lineas).toHaveLength(1)
    expect(dte.lineas[0]).toMatchObject({ cantidad: 1, precioUnitario: 100, total: 112 })
    expect(dte.registroId).toBe('reg-1')
  })

  it('deriva ivaMonto y total cuando faltan', () => {
    const dte = construirDteCanonico({
      factura: { subtotal: 200, ivaTasa: 0.12, descripcion: 'x' },
      emisor: emisorGt,
      receptor: receptorGt,
      fechaEmision: fecha,
    })
    expect(dte.ivaMonto).toBe(24) // 200 * 0.12
    expect(dte.total).toBe(224)
  })

  it('redondea a 2 decimales', () => {
    const dte = construirDteCanonico({
      factura: { subtotal: 33.333, ivaTasa: 0.12, descripcion: 'x' },
      emisor: emisorGt,
      receptor: receptorGt,
      fechaEmision: fecha,
    })
    expect(dte.subtotal).toBe(33.33)
    expect(dte.ivaMonto).toBe(4) // 33.33 * 0.12 = 3.9996 -> 4.00
  })

  it('cae a nombre comercial si no hay nombre fiscal', () => {
    const dte = construirDteCanonico({
      factura: facturaGt,
      emisor: { regimen: 'fel_gt', nombre: 'Solo Comercial', nit: '12345679' },
      receptor: receptorGt,
      fechaEmision: fecha,
    })
    expect(dte.emisor.nombre).toBe('Solo Comercial')
  })

  it('moneda por defecto MXN para CFDI', () => {
    const dte = construirDteCanonico({
      factura: { subtotal: 100, ivaTasa: 0.16, descripcion: 'x' },
      emisor: { regimen: 'cfdi_mx', nombre: 'Empresa MX', rfc: 'ABC230101AB1' },
      receptor: { nombre: 'Cliente', rfc: 'GODE561231GR8', usoCfdi: 'G03' },
      fechaEmision: fecha,
    })
    expect(dte.moneda).toBe('MXN')
    expect(dte.ivaMonto).toBe(16)
    expect(dte.receptor.usoCfdi).toBe('G03')
  })

  it('respeta tipo y moneda explícitos', () => {
    const dte = construirDteCanonico({
      factura: facturaGt,
      emisor: emisorGt,
      receptor: receptorGt,
      tipo: 'nota_credito',
      moneda: 'USD',
      fechaEmision: fecha,
    })
    expect(dte.tipo).toBe('nota_credito')
    expect(dte.moneda).toBe('USD')
  })
})

describe('businessFiscal — monedaPorRegimen', () => {
  it('GTQ para GT, MXN para MX', () => {
    expect(monedaPorRegimen('fel_gt')).toBe('GTQ')
    expect(monedaPorRegimen('cfdi_mx')).toBe('MXN')
  })
})

describe('businessFiscal — validarDteParaTimbrar', () => {
  function dteGtValido(): DteCanonico {
    return construirDteCanonico({
      factura: { subtotal: 100, ivaTasa: 0.12, descripcion: 'agua' },
      emisor: { regimen: 'fel_gt', nombre: 'Aguas SA', nit: '12345679' },
      receptor: { nombre: 'Juan', nit: 'CF' },
      fechaEmision: '2026-06-04T00:00:00.000Z',
    })
  }

  it('DTE GT válido no tiene errores', () => {
    expect(validarDteParaTimbrar(dteGtValido())).toEqual([])
  })

  it('detecta NIT de emisor inválido (GT)', () => {
    const dte = dteGtValido()
    dte.emisor.nit = 'bad'
    const errs = validarDteParaTimbrar(dte)
    expect(errs.some((e) => e.includes('NIT del emisor'))).toBe(true)
  })

  it('detecta NIT de receptor inválido (GT)', () => {
    const dte = dteGtValido()
    dte.receptor.nit = '???'
    const errs = validarDteParaTimbrar(dte)
    expect(errs.some((e) => e.includes('NIT del receptor'))).toBe(true)
  })

  it('CFDI exige RFC de ambos y uso CFDI', () => {
    const dte = construirDteCanonico({
      factura: { subtotal: 100, ivaTasa: 0.16, descripcion: 'x' },
      emisor: { regimen: 'cfdi_mx', nombre: 'MX', rfc: 'bad' },
      receptor: { nombre: 'Cliente', rfc: 'bad', usoCfdi: null },
      fechaEmision: '2026-06-04T00:00:00.000Z',
    })
    const errs = validarDteParaTimbrar(dte)
    expect(errs.some((e) => e.includes('RFC del emisor'))).toBe(true)
    expect(errs.some((e) => e.includes('RFC del receptor'))).toBe(true)
    expect(errs.some((e) => e.includes('uso del CFDI'))).toBe(true)
  })

  it('detecta total no positivo', () => {
    const dte = dteGtValido()
    dte.total = 0
    const errs = validarDteParaTimbrar(dte)
    expect(errs.some((e) => e.includes('total'))).toBe(true)
  })
})
