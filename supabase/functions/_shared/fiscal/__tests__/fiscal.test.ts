// serv:S11 — Tests del adapter fiscal edge (Deno) corridos con vitest
// (igual que el resto de _shared/__tests__). Cubren: SandboxProvider
// determinista, getFiscalProvider (sandbox vs stub real), y el espejo de la
// máquina de estados / builder respecto al lado Vite.

import { describe, it, expect } from 'vitest'
import { SandboxProvider } from '../sandboxProvider.ts'
import { getFiscalProvider } from '../getFiscalProvider.ts'
import { PacNoConfiguradoError } from '../provider.ts'
import {
  construirDteCanonico,
  puedeTimbrar,
  aplicarTransicionFiscal,
  validarNitGt,
  validarRfcMx,
} from '../stateMachine.ts'
import type { DteCanonico } from '../types.ts'

function dteEjemplo(): DteCanonico {
  return construirDteCanonico({
    factura: { id: 'reg-1', subtotal: 100, ivaTasa: 0.12, ivaMonto: 12, total: 112, descripcion: 'agua' },
    emisor: { regimen: 'fel_gt', nombre: 'Aguas SA', nit: '12345679' },
    receptor: { nombre: 'Juan', nit: 'CF' },
    fechaEmision: '2026-06-04T00:00:00.000Z',
  })
}

describe('SandboxProvider', () => {
  it('timbra y devuelve UUID/serie/numero simulados', async () => {
    const p = new SandboxProvider()
    const r = await p.timbrar(dteEjemplo())
    expect(r.ok).toBe(true)
    expect(r.uuidFiscal).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/)
    expect(r.serie).toBe('FEL-SANDBOX')
    expect(r.numero).toMatch(/^\d{6}$/)
    expect(r.numeroAutorizacion).toBe(r.uuidFiscal)
    expect(r.fechaCertificacion).toBe('2026-06-04T00:00:00.000Z')
    expect(r.raw?.sandbox).toBe(true)
  })

  it('es DETERMINISTA: mismo DTE → mismo UUID', async () => {
    const p = new SandboxProvider()
    const a = await p.timbrar(dteEjemplo())
    const b = await p.timbrar(dteEjemplo())
    expect(a.uuidFiscal).toBe(b.uuidFiscal)
    expect(a.numero).toBe(b.numero)
  })

  it('DTEs distintos → UUIDs distintos', async () => {
    const p = new SandboxProvider()
    const a = await p.timbrar(dteEjemplo())
    const otro = construirDteCanonico({
      factura: { id: 'reg-2', subtotal: 250, ivaTasa: 0.12, descripcion: 'otra' },
      emisor: { regimen: 'fel_gt', nombre: 'Aguas SA', nit: '12345679' },
      receptor: { nombre: 'Ana', nit: 'CF' },
      fechaEmision: '2026-06-04T00:00:00.000Z',
    })
    const b = await p.timbrar(otro)
    expect(a.uuidFiscal).not.toBe(b.uuidFiscal)
  })

  it('serie MX para CFDI', async () => {
    const p = new SandboxProvider()
    const dteMx = construirDteCanonico({
      factura: { subtotal: 100, ivaTasa: 0.16, descripcion: 'x' },
      emisor: { regimen: 'cfdi_mx', nombre: 'MX', rfc: 'ABC230101AB1' },
      receptor: { nombre: 'Cliente', rfc: 'GODE561231GR8', usoCfdi: 'G03' },
      fechaEmision: '2026-06-04T00:00:00.000Z',
    })
    const r = await p.timbrar(dteMx)
    expect(r.serie).toBe('CFDI-SANDBOX')
  })

  it('cancelar y consultarEstado responden ok', async () => {
    const p = new SandboxProvider()
    expect((await p.cancelar('UUID-1', 'error')).ok).toBe(true)
    expect((await p.consultarEstado('UUID-1')).ok).toBe(true)
  })
})

describe('getFiscalProvider', () => {
  it('devuelve Sandbox por defecto (sin proveedor)', () => {
    expect(getFiscalProvider('fel_gt').nombre).toBe('sandbox')
    expect(getFiscalProvider('cfdi_mx', {}).nombre).toBe('sandbox')
  })

  it('devuelve Sandbox cuando proveedor=sandbox', () => {
    expect(getFiscalProvider('fel_gt', { proveedor: 'sandbox' }).nombre).toBe('sandbox')
    expect(getFiscalProvider('fel_gt', { proveedor: 'SANDBOX' }).nombre).toBe('sandbox')
  })

  it('proveedor real GT → stub que lanza PacNoConfiguradoError al timbrar', async () => {
    const p = getFiscalProvider('fel_gt', { proveedor: 'infile', companyId: 'c1' })
    expect(p.nombre).toBe('infile')
    await expect(p.timbrar(dteEjemplo())).rejects.toBeInstanceOf(PacNoConfiguradoError)
  })

  it('proveedor real MX → stub que lanza PacNoConfiguradoError al timbrar', async () => {
    const p = getFiscalProvider('cfdi_mx', { proveedor: 'facturama' })
    expect(p.nombre).toBe('facturama')
    await expect(p.timbrar(dteEjemplo())).rejects.toBeInstanceOf(PacNoConfiguradoError)
  })
})

// Espejo: smoke test de que la lógica replicada en el edge se comporta igual que
// el lado Vite (los tests exhaustivos viven en src/lib/__tests__/businessFiscal).
describe('stateMachine (espejo Deno)', () => {
  it('puedeTimbrar solo en por_timbrar', () => {
    expect(puedeTimbrar('por_timbrar')).toBe(true)
    expect(puedeTimbrar('borrador')).toBe(false)
  })

  it('aplicarTransicionFiscal timbrar', () => {
    const p = aplicarTransicionFiscal('por_timbrar', 'timbrar', '2026-06-04T00:00:00.000Z')
    expect(p).toEqual({ estado: 'timbrado', fecha_certificacion: '2026-06-04T00:00:00.000Z', error: null })
  })

  it('validaciones de NIT/RFC funcionan', () => {
    expect(validarNitGt('12345679')).toBe(true)
    expect(validarNitGt('CF')).toBe(true)
    expect(validarRfcMx('GODE561231GR8')).toBe(true)
    expect(validarRfcMx('bad')).toBe(false)
  })
})
