// Cobros pluggable — Tests del catálogo de payfacs + helpers PUROS de la UI.
import { describe, it, expect } from 'vitest'
import {
  payfacsDisponibles,
  payfacPorValue,
  etiquetaPayfac,
  camposCredencial,
  estadoConexionStyle,
  PAYFAC_SANDBOX,
} from '../payfacCatalogo'

describe('catálogo de payfacs', () => {
  it('incluye sandbox primero y los payfacs esperados', () => {
    const vals = payfacsDisponibles().map((p) => p.value)
    expect(vals[0]).toBe('sandbox')
    expect(vals).toEqual(expect.arrayContaining(['sandbox', 'qpaypro', 'visanet', 'paypal', 'stripe']))
  })

  it('sandbox y qpaypro están marcados como disponibles (adapter real)', () => {
    expect(payfacPorValue('sandbox')?.disponible).toBe(true)
    expect(payfacPorValue('qpaypro')?.disponible).toBe(true)
  })

  it('visanet/paypal/stripe NO están disponibles aún (elegibles, cobro follow-up)', () => {
    expect(payfacPorValue('visanet')?.disponible).toBe(false)
    expect(payfacPorValue('paypal')?.disponible).toBe(false)
    expect(payfacPorValue('stripe')?.disponible).toBe(false)
  })

  it('etiquetaPayfac cae al value si es desconocido y al sandbox si es vacío', () => {
    expect(etiquetaPayfac('qpaypro')).toBe('QPayPro (Guatemala)')
    expect(etiquetaPayfac('desconocido')).toBe('desconocido')
    expect(etiquetaPayfac(null)).toBe(PAYFAC_SANDBOX.label)
  })

  it('camposCredencial: qpaypro pide x_login + x_api_key; sandbox no pide nada', () => {
    const qp = camposCredencial('qpaypro').map((c) => c.key)
    expect(qp).toContain('x_login')
    expect(qp).toContain('x_api_key')
    expect(camposCredencial('sandbox')).toEqual([])
  })

  it('x_login es requerido y NO secreto; x_api_key es secreto', () => {
    const campos = camposCredencial('qpaypro')
    const login = campos.find((c) => c.key === 'x_login')
    const apiKey = campos.find((c) => c.key === 'x_api_key')
    expect(login?.requerido).toBe(true)
    expect(login?.secreto).toBe(false)
    expect(apiKey?.secreto).toBe(true)
  })

  it('estadoConexionStyle mapea ok/error/desconocido', () => {
    expect(estadoConexionStyle('ok').label).toBe('Conectado')
    expect(estadoConexionStyle('error').label).toBe('Error de conexión')
    expect(estadoConexionStyle(null).label).toBe('Sin probar')
    expect(estadoConexionStyle('valor-raro').label).toBe('Sin probar')
  })
})
