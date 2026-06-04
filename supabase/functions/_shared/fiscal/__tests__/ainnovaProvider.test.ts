// serv:S11 — Tests del adapter de Ainnova (FEL GT). Cubren lo VERIFICABLE sin red:
//   - identidad del provider y selección de endpoint por ambiente,
//   - validación/tolerancia de credenciales desde el jsonb opaco de la bóveda,
//   - fail-safe HONESTO del transporte (no finge timbrado: lanza error tipado).
// El transporte real (SOAP/firma) se prueba end-to-end cuando se confirme el
// contrato de Ainnova; aquí garantizamos que jamás aparente valor fiscal sin él.

import { describe, it, expect } from 'vitest'
import {
  AinnovaProvider,
  AINNOVA,
  AINNOVA_ENDPOINTS,
  AinnovaCredencialesError,
  AinnovaContratoNoConfirmadoError,
} from '../ainnovaProvider.ts'
import { construirDteCanonico } from '../stateMachine.ts'
import type { CredencialesPacPorAmbiente } from '../provider.ts'
import type { DteCanonico } from '../types.ts'

function dte(): DteCanonico {
  return construirDteCanonico({
    factura: { id: 'reg-1', subtotal: 100, ivaTasa: 0.12, ivaMonto: 12, total: 112, descripcion: 'agua' },
    emisor: { regimen: 'fel_gt', nombre: 'Aguas SA', nit: '1234567-9' },
    receptor: { nombre: 'Juan', nit: 'CF' },
    fechaEmision: '2026-06-04T00:00:00.000Z',
  })
}

const creds = (c: CredencialesPacPorAmbiente): { credenciales: CredencialesPacPorAmbiente } => ({
  credenciales: c,
})

describe('AINNOVA_ENDPOINTS', () => {
  it('define host de Guatefacturas para sandbox y prod', () => {
    expect(AINNOVA_ENDPOINTS.sandbox).toContain('dte.guatefacturas.com')
    expect(AINNOVA_ENDPOINTS.prod).toContain('dte.guatefacturas.com')
    expect(AINNOVA_ENDPOINTS.sandbox).not.toBe(AINNOVA_ENDPOINTS.prod)
  })
})

describe('AinnovaProvider — identidad', () => {
  it("nombre es 'ainnova'", () => {
    expect(new AinnovaProvider({}).nombre).toBe(AINNOVA)
  })
})

describe('AinnovaProvider — credenciales', () => {
  it('sin credenciales del ambiente → AinnovaCredencialesError al timbrar', async () => {
    const p = new AinnovaProvider({ ambiente: 'sandbox', credenciales: null })
    await expect(p.timbrar(dte())).rejects.toBeInstanceOf(AinnovaCredencialesError)
  })

  it('credenciales incompletas (solo usuario) → AinnovaCredencialesError', async () => {
    const p = new AinnovaProvider({ ambiente: 'sandbox', ...creds({ sandbox: { usuario: 'u' } }) })
    await expect(p.timbrar(dte())).rejects.toBeInstanceOf(AinnovaCredencialesError)
  })

  it('credenciales del OTRO ambiente no sirven (prod sin creds prod)', async () => {
    const p = new AinnovaProvider({ ambiente: 'prod', ...creds({ sandbox: { usuario: 'u', clave: 'p' } }) })
    await expect(p.timbrar(dte())).rejects.toBeInstanceOf(AinnovaCredencialesError)
  })

  it('tolera llaves equivalentes (user/password) → pasa validación de creds', async () => {
    const p = new AinnovaProvider({ ambiente: 'sandbox', ...creds({ sandbox: { user: 'u', password: 'p' } }) })
    // Si la extracción de creds fallara, lanzaría AinnovaCredencialesError;
    // como pasa, llega al transporte (aún no confirmado).
    await expect(p.timbrar(dte())).rejects.toBeInstanceOf(AinnovaContratoNoConfirmadoError)
  })
})

describe('AinnovaProvider — fail-safe del transporte (NO finge timbrado)', () => {
  const ok = { ambiente: 'sandbox' as const, ...creds({ sandbox: { usuario: 'u', clave: 'p' } }) }

  it('timbrar con creds válidas lanza AinnovaContratoNoConfirmadoError (no ok:true)', async () => {
    const p = new AinnovaProvider(ok)
    await expect(p.timbrar(dte())).rejects.toBeInstanceOf(AinnovaContratoNoConfirmadoError)
  })

  it('cancelar lanza AinnovaContratoNoConfirmadoError', async () => {
    const p = new AinnovaProvider(ok)
    await expect(p.cancelar('UUID-1', '01')).rejects.toBeInstanceOf(AinnovaContratoNoConfirmadoError)
  })

  it('consultarEstado lanza AinnovaContratoNoConfirmadoError', async () => {
    const p = new AinnovaProvider(ok)
    await expect(p.consultarEstado('UUID-1')).rejects.toBeInstanceOf(AinnovaContratoNoConfirmadoError)
  })
})
