// Tests de la lógica pura de create-charge (infra:I22 · Track T8/T5). Como el
// resto de tests de edge fns, corre bajo vitest (no Deno) tratando el módulo como
// TS normal. Cubre: mapeo estado provider → payment_requests, lectura segura de
// credenciales por ambiente desde el jsonb opaco de la bóveda, parseo del
// ambiente (default sandbox) y construcción del CobroCanonico (fallbacks de
// descripción/URLs, referencia interna y metadata multi-tenant). El adapter de
// payfacs ya está cubierto en _shared/payments/__tests__ — aquí NO se duplica.

import { describe, it, expect } from 'vitest'
import {
  buildCobroCanonico,
  credsDeAmbiente,
  estadoPaymentRequest,
  parseAmbiente,
} from '../logic.ts'

describe('create-charge/estadoPaymentRequest', () => {
  it('aprobado → succeeded', () => {
    expect(estadoPaymentRequest('aprobado')).toBe('succeeded')
  })

  it('rechazado y error → failed (ambos cierran el request)', () => {
    expect(estadoPaymentRequest('rechazado')).toBe('failed')
    expect(estadoPaymentRequest('error')).toBe('failed')
  })

  it('pendiente y requiere_accion → pending (esperando confirmación/retorno)', () => {
    expect(estadoPaymentRequest('pendiente')).toBe('pending')
    expect(estadoPaymentRequest('requiere_accion')).toBe('pending')
  })
})

describe('create-charge/credsDeAmbiente', () => {
  const boveda = {
    sandbox: { x_login: 'sb-login', x_api_key: 'sb-key' },
    prod: { x_login: 'pr-login' },
  }

  it('devuelve SOLO las credenciales del ambiente pedido', () => {
    expect(credsDeAmbiente(boveda, 'sandbox')).toEqual({ x_login: 'sb-login', x_api_key: 'sb-key' })
    expect(credsDeAmbiente(boveda, 'prod')).toEqual({ x_login: 'pr-login' })
  })

  it('null si la bóveda no es un objeto (fila ausente o jsonb corrupto)', () => {
    expect(credsDeAmbiente(null, 'sandbox')).toBeNull()
    expect(credsDeAmbiente(undefined, 'sandbox')).toBeNull()
    expect(credsDeAmbiente('secreto', 'sandbox')).toBeNull()
  })

  it('null si el ambiente falta o no es un objeto plano (arrays no cuentan)', () => {
    expect(credsDeAmbiente({ sandbox: boveda.sandbox }, 'prod')).toBeNull()
    expect(credsDeAmbiente({ prod: ['x'] }, 'prod')).toBeNull()
    expect(credsDeAmbiente({ prod: 'plain-string' }, 'prod')).toBeNull()
  })
})

describe('create-charge/parseAmbiente', () => {
  it("solo el literal 'prod' activa prod", () => {
    expect(parseAmbiente('prod')).toBe('prod')
  })

  it('todo lo demás cae a sandbox (default seguro: nunca cobrar en prod por accidente)', () => {
    expect(parseAmbiente('sandbox')).toBe('sandbox')
    expect(parseAmbiente('PROD')).toBe('sandbox') // case-sensitive a propósito
    expect(parseAmbiente(undefined)).toBe('sandbox')
    expect(parseAmbiente('')).toBe('sandbox')
    expect(parseAmbiente('produccion')).toBe('sandbox')
  })
})

describe('create-charge/buildCobroCanonico', () => {
  const baseInput = {
    monto: 150.5,
    moneda: 'GTQ',
    registroId: 'reg-1' as string | null,
    clienteId: 'cli-1',
    companyId: 'co-1',
    cli: { nombre: 'Juan Pérez', email: 'juan@x.com', telefono: '5555', nit: 'CF' },
    base: 'https://app.administratodo.com',
  }

  it('pasa monto/moneda tal cual y arma el pagador desde la fila de clientes', () => {
    const cobro = buildCobroCanonico(baseInput)
    expect(cobro.monto).toBe(150.5)
    expect(cobro.moneda).toBe('GTQ')
    expect(cobro.pagador).toEqual({
      nombre: 'Juan Pérez',
      email: 'juan@x.com',
      telefono: '5555',
      identificador: 'CF',
    })
  })

  it('pagador con nulls cuando el cliente no existe o no tiene datos', () => {
    const cobro = buildCobroCanonico({ ...baseInput, cli: null })
    expect(cobro.pagador).toEqual({ nombre: null, email: null, telefono: null, identificador: null })
  })

  it('descripción: usa la del body con trim; vacía/espacios → fallback con nombre del cliente', () => {
    expect(buildCobroCanonico({ ...baseInput, descripcion: '  Cuota junio  ' }).descripcion).toBe('Cuota junio')
    expect(buildCobroCanonico({ ...baseInput, descripcion: '   ' }).descripcion).toBe('Pago de servicio — Juan Pérez')
    expect(buildCobroCanonico({ ...baseInput, cli: null }).descripcion).toBe('Pago de servicio — Cliente')
  })

  it('referencia interna: registro_id si existe, si no cae al cliente_id', () => {
    expect(buildCobroCanonico(baseInput).referenciaInterna).toBe('reg-1')
    expect(buildCobroCanonico({ ...baseInput, registroId: null }).referenciaInterna).toBe('cli-1')
  })

  it('URLs de retorno: explícitas ganan; si no, se derivan de base; sin base → null', () => {
    const explicito = buildCobroCanonico({ ...baseInput, urlRetorno: 'https://x/ok', urlCancelacion: 'https://x/no' })
    expect(explicito.urlRetorno).toBe('https://x/ok')
    expect(explicito.urlCancelacion).toBe('https://x/no')

    const derivado = buildCobroCanonico(baseInput)
    expect(derivado.urlRetorno).toBe('https://app.administratodo.com/portal?pago=ok')
    expect(derivado.urlCancelacion).toBe('https://app.administratodo.com/portal?pago=cancelado')

    const sinBase = buildCobroCanonico({ ...baseInput, base: '' })
    expect(sinBase.urlRetorno).toBeNull()
    expect(sinBase.urlCancelacion).toBeNull()
  })

  it('metadata multi-tenant: incluye registro_id SOLO cuando existe', () => {
    expect(buildCobroCanonico(baseInput).metadata).toEqual({
      company_id: 'co-1',
      cliente_id: 'cli-1',
      registro_id: 'reg-1',
    })
    expect(buildCobroCanonico({ ...baseInput, registroId: null }).metadata).toEqual({
      company_id: 'co-1',
      cliente_id: 'cli-1',
    })
  })
})
