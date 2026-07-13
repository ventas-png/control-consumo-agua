// Cobros pluggable — Tests del adapter de payfac (Deno) corridos con vitest (igual
// que el resto de _shared/__tests__). Cubren: SandboxPaymentProvider determinista,
// getPaymentProvider (sandbox vs qpaypro vs stubs), el adapter REAL de QPayPro con
// fetch mockeado, y el resolver de config efectiva (espejo del lado Vite).

import { describe, it, expect, vi, afterEach } from 'vitest'
import { SandboxPaymentProvider } from '../sandboxProvider.ts'
import { QPayProProvider } from '../qpayproProvider.ts'
import { getPaymentProvider } from '../getPaymentProvider.ts'
import { PayfacNoConfiguradoError } from '../provider.ts'
import { resolverConfigPagoEfectiva, normalizarMonedaISO } from '../resolverConfigPago.ts'
import { credsDeAmbiente, credencialesEfectivasDeAmbiente } from '../credenciales.ts'
import type { CobroCanonico } from '../types.ts'

function cobroEjemplo(over: Partial<CobroCanonico> = {}): CobroCanonico {
  return {
    monto: 150.5,
    moneda: 'GTQ',
    descripcion: 'Pago de agua junio',
    referenciaInterna: 'reg-1',
    pagador: { nombre: 'Juan Perez', email: 'juan@x.com' },
    ...over,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SandboxPaymentProvider', () => {
  it('crea un cobro aprobado con referencia simulada', async () => {
    const p = new SandboxPaymentProvider()
    const r = await p.crearCobro(cobroEjemplo())
    expect(r.ok).toBe(true)
    expect(r.estado).toBe('aprobado')
    expect(r.referencia).toMatch(/^SBX-[0-9A-F]+$/)
    expect(r.raw?.sandbox).toBe(true)
  })

  it('es DETERMINISTA: mismo cobro → misma referencia', async () => {
    const p = new SandboxPaymentProvider()
    const a = await p.crearCobro(cobroEjemplo())
    const b = await p.crearCobro(cobroEjemplo())
    expect(a.referencia).toBe(b.referencia)
  })

  it('cobros distintos → referencias distintas', async () => {
    const p = new SandboxPaymentProvider()
    const a = await p.crearCobro(cobroEjemplo({ monto: 10 }))
    const b = await p.crearCobro(cobroEjemplo({ monto: 20 }))
    expect(a.referencia).not.toBe(b.referencia)
  })

  it('ping y reembolso responden ok', async () => {
    const p = new SandboxPaymentProvider()
    expect((await p.consultarEstado('ping:c1:empresa')).ok).toBe(true)
    expect((await p.reembolsar('SBX-1', 10)).ok).toBe(true)
  })
})

describe('getPaymentProvider', () => {
  it('devuelve Sandbox por defecto (sin proveedor)', () => {
    expect(getPaymentProvider().nombre).toBe('sandbox')
    expect(getPaymentProvider({ proveedor: 'sandbox' }).nombre).toBe('sandbox')
    expect(getPaymentProvider({ proveedor: 'SANDBOX' }).nombre).toBe('sandbox')
  })

  it('devuelve el adapter REAL de QPayPro', () => {
    const p = getPaymentProvider({ proveedor: 'qpaypro', ambiente: 'sandbox' })
    expect(p.nombre).toBe('qpaypro')
    expect(p).toBeInstanceOf(QPayProProvider)
  })

  it('visanet/paypal → stub que lanza PayfacNoConfiguradoError al cobrar', async () => {
    const v = getPaymentProvider({ proveedor: 'visanet' })
    expect(v.nombre).toBe('visanet')
    await expect(v.crearCobro(cobroEjemplo())).rejects.toBeInstanceOf(PayfacNoConfiguradoError)
    const pp = getPaymentProvider({ proveedor: 'paypal' })
    await expect(pp.crearCobro(cobroEjemplo())).rejects.toBeInstanceOf(PayfacNoConfiguradoError)
  })

  it('stripe → stub que apunta a su flujo dedicado', async () => {
    const s = getPaymentProvider({ proveedor: 'stripe' })
    expect(s.nombre).toBe('stripe')
    await expect(s.crearCobro(cobroEjemplo())).rejects.toBeInstanceOf(PayfacNoConfiguradoError)
  })

  it('proveedor desconocido → PayfacNoConfiguradoError', () => {
    expect(() => getPaymentProvider({ proveedor: 'inexistente' })).toThrow(PayfacNoConfiguradoError)
  })
})

describe('QPayProProvider (adapter real, fetch mockeado)', () => {
  const creds = { x_login: 'login123', x_api_key: 'apikey456', x_private_key: 'priv789' }

  it('sin credenciales → ok:false estado error (no lanza)', async () => {
    const p = new QPayProProvider({ proveedor: 'qpaypro', credenciales: null })
    const r = await p.crearCobro(cobroEjemplo())
    expect(r.ok).toBe(false)
    expect(r.estado).toBe('error')
    expect(r.error).toMatch(/credenciales/i)
  })

  it('respuesta con URL de checkout → requiere_accion + redirectUrl', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ url: 'https://sandboxpayments.qpaypro.com/checkout/abc123', x_trans_id: 'TX-1' }), { status: 200 }),
    ))
    const p = new QPayProProvider({ proveedor: 'qpaypro', ambiente: 'sandbox', credenciales: creds })
    const r = await p.crearCobro(cobroEjemplo())
    expect(r.ok).toBe(true)
    expect(r.estado).toBe('requiere_accion')
    expect(r.redirectUrl).toContain('qpaypro.com/checkout')
    expect(r.referencia).toBe('TX-1')
  })

  it('manda x_login/x_amount/x_currency_code en el body al host de sandbox', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ x_response_code: '1', x_trans_id: 'TX-2' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const p = new QPayProProvider({ proveedor: 'qpaypro', ambiente: 'sandbox', credenciales: creds })
    const r = await p.crearCobro(cobroEjemplo({ monto: 99.9, moneda: 'GTQ' }))
    expect(r.estado).toBe('aprobado')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('sandboxpayments.qpaypro.com/checkout/register_transaction_store')
    const body = String(init.body)
    expect(body).toContain('x_login=login123')
    expect(body).toContain('x_amount=99.90')
    expect(body).toContain('x_currency_code=GTQ')
  })

  it('código de respuesta 2 → rechazado (ok:true, estado rechazado)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ x_response_code: '2', x_response_reason_text: 'Fondos insuficientes' }), { status: 200 }),
    ))
    const p = new QPayProProvider({ proveedor: 'qpaypro', credenciales: creds })
    const r = await p.crearCobro(cobroEjemplo())
    expect(r.ok).toBe(true)
    expect(r.estado).toBe('rechazado')
    expect(r.error).toMatch(/fondos/i)
  })

  it('fallo de red → ok:false estado error (no lanza)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const p = new QPayProProvider({ proveedor: 'qpaypro', credenciales: creds })
    const r = await p.crearCobro(cobroEjemplo())
    expect(r.ok).toBe(false)
    expect(r.estado).toBe('error')
    expect(r.error).toMatch(/no se pudo contactar/i)
  })

  it('ping valida presencia de credenciales SIN red', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const conCreds = new QPayProProvider({ proveedor: 'qpaypro', credenciales: creds })
    expect((await conCreds.consultarEstado('ping:c1:empresa')).ok).toBe(true)
    const sinCreds = new QPayProProvider({ proveedor: 'qpaypro', credenciales: {} })
    expect((await sinCreds.consultarEstado('ping:c1:empresa')).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('resolverConfigPagoEfectiva (espejo Deno)', () => {
  it('sin override: hereda el payfac de la empresa', () => {
    const c = resolverConfigPagoEfectiva({ proveedorPago: 'qpaypro', monedaDefault: 'GTQ' }, null)
    expect(c.proveedorPago).toBe('qpaypro')
    expect(c.moneda).toBe('GTQ')
    expect(c.desdeLocacion).toBe(false)
  })

  it('la locación sobreescribe y desdeLocacion=true', () => {
    const c = resolverConfigPagoEfectiva(
      { proveedorPago: 'sandbox', monedaDefault: 'GTQ' },
      { proveedorPago: 'qpaypro' },
    )
    expect(c.proveedorPago).toBe('qpaypro')
    expect(c.desdeLocacion).toBe(true)
  })

  it('defaults seguros: sandbox + GTQ', () => {
    const c = resolverConfigPagoEfectiva(null, null)
    expect(c.proveedorPago).toBe('sandbox')
    expect(c.moneda).toBe('GTQ')
  })
})

describe('credencialesEfectivasDeAmbiente (herencia locación→empresa)', () => {
  const blobEmpresa = { sandbox: { x_login: 'emp-sbx' }, prod: { x_login: 'emp-prod' } }

  it('sin fila de locación → hereda las credenciales de la empresa', () => {
    expect(credencialesEfectivasDeAmbiente(null, blobEmpresa, 'sandbox')).toEqual({ x_login: 'emp-sbx' })
    expect(credencialesEfectivasDeAmbiente(undefined, blobEmpresa, 'prod')).toEqual({ x_login: 'emp-prod' })
  })

  it('la locación con credenciales del ambiente GANA sobre la empresa', () => {
    const blobLoc = { sandbox: { x_login: 'loc-sbx' } }
    expect(credencialesEfectivasDeAmbiente(blobLoc, blobEmpresa, 'sandbox')).toEqual({ x_login: 'loc-sbx' })
  })

  it('herencia POR AMBIENTE: locación solo con prod hereda el sandbox de la empresa', () => {
    const blobLoc = { prod: { x_login: 'loc-prod' } }
    expect(credencialesEfectivasDeAmbiente(blobLoc, blobEmpresa, 'sandbox')).toEqual({ x_login: 'emp-sbx' })
    expect(credencialesEfectivasDeAmbiente(blobLoc, blobEmpresa, 'prod')).toEqual({ x_login: 'loc-prod' })
  })

  it('fila de locación solo-estatus (sin credenciales) no bloquea la herencia', () => {
    expect(credencialesEfectivasDeAmbiente({}, blobEmpresa, 'sandbox')).toEqual({ x_login: 'emp-sbx' })
  })

  it('sin credenciales en ningún nivel → null', () => {
    expect(credencialesEfectivasDeAmbiente(null, null, 'sandbox')).toBeNull()
    expect(credencialesEfectivasDeAmbiente({}, {}, 'prod')).toBeNull()
  })
})

describe('credsDeAmbiente', () => {
  it('lee el ambiente pedido del blob { sandbox, prod }', () => {
    const blob = { sandbox: { x_login: 'a' }, prod: { x_login: 'b' } }
    expect(credsDeAmbiente(blob, 'sandbox')).toEqual({ x_login: 'a' })
    expect(credsDeAmbiente(blob, 'prod')).toEqual({ x_login: 'b' })
  })

  it('tolera blobs no-objeto o ambientes malformados → null', () => {
    expect(credsDeAmbiente(null, 'sandbox')).toBeNull()
    expect(credsDeAmbiente('enc:v1:xxx', 'sandbox')).toBeNull()
    expect(credsDeAmbiente({ sandbox: ['no-objeto'] }, 'sandbox')).toBeNull()
    expect(credsDeAmbiente({ prod: {} }, 'sandbox')).toBeNull()
  })
})

describe('normalizarMonedaISO (espejo Deno)', () => {
  it("'Q' (projects.moneda) → GTQ; '$'/'usd' → USD", () => {
    expect(normalizarMonedaISO('Q')).toBe('GTQ')
    expect(normalizarMonedaISO('GTQ')).toBe('GTQ')
    expect(normalizarMonedaISO('$')).toBe('USD')
    expect(normalizarMonedaISO('usd')).toBe('USD')
  })

  it('respeta ISO de 3 letras; vacío/desconocido → GTQ', () => {
    expect(normalizarMonedaISO('mxn')).toBe('MXN')
    expect(normalizarMonedaISO('')).toBe('GTQ')
    expect(normalizarMonedaISO('€')).toBe('GTQ')
  })
})
