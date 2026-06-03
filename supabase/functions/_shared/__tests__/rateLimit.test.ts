// Tests del helper de rate-limit (I2, Track T5). Puros: getClientIp es parseo de headers
// y enforceRateLimit recibe el cliente por inyección, así que mockeamos `.rpc` sin Deno.
//
// Igual que emailRetryable.test.ts, corre bajo vitest (no Deno) y trata el módulo como TS.

import { describe, it, expect } from 'vitest'
import { getClientIp, enforceRateLimit, type RpcClient } from '../rateLimit.ts'

const mkReq = (headers: Record<string, string>) => new Request('https://x.test', { headers })

describe('getClientIp', () => {
  it('prefiere cf-connecting-ip sobre el resto', () => {
    expect(getClientIp(mkReq({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe('1.1.1.1')
  })

  it('usa el primer hop de x-forwarded-for', () => {
    expect(getClientIp(mkReq({ 'x-forwarded-for': '3.3.3.3, 4.4.4.4, 5.5.5.5' }))).toBe('3.3.3.3')
  })

  it('cae a fly-client-ip si no hay cf ni xff', () => {
    expect(getClientIp(mkReq({ 'fly-client-ip': '6.6.6.6' }))).toBe('6.6.6.6')
  })

  it("devuelve 'unknown' sin headers de IP", () => {
    expect(getClientIp(mkReq({}))).toBe('unknown')
  })
})

describe('enforceRateLimit', () => {
  const cors = { 'Access-Control-Allow-Origin': 'https://x.test' }
  const clientReturning = (data: unknown): RpcClient => ({ rpc: () => Promise.resolve({ data, error: null }) })

  it('permite (null) cuando rate_limit_hit devuelve true', async () => {
    const res = await enforceRateLimit(clientReturning(true), { subject: 'ip:1.1.1.1', action: 'signup_company', max: 5 }, cors)
    expect(res).toBeNull()
  })

  it('bloquea con 429 cuando devuelve false', async () => {
    const res = await enforceRateLimit(clientReturning(false), { subject: 'ip:1.1.1.1', action: 'signup_company', max: 5 }, cors)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(429)
    expect(res!.headers.get('Access-Control-Allow-Origin')).toBe('https://x.test')
  })

  it('fail-open (null) ante error de infra (data null)', async () => {
    const res = await enforceRateLimit(clientReturning(null), { subject: 'x', action: 'y', max: 1 }, cors)
    expect(res).toBeNull()
  })

  it('pasa los argumentos correctos al RPC (incl. ventana en segundos)', async () => {
    let captured: { fn: string; args: Record<string, unknown> } | undefined
    const client: RpcClient = {
      rpc: (fn, args) => { captured = { fn, args }; return Promise.resolve({ data: true, error: null }) },
    }
    await enforceRateLimit(client, { subject: 'ip:9.9.9.9', action: 'signup_company', max: 5, windowSeconds: 60 }, cors)
    expect(captured?.fn).toBe('rate_limit_hit')
    expect(captured?.args).toEqual({ p_subject: 'ip:9.9.9.9', p_action: 'signup_company', p_max_count: 5, p_window: '60 seconds' })
  })

  it('usa 3600s por defecto cuando no se pasa windowSeconds', async () => {
    let captured: Record<string, unknown> | undefined
    const client: RpcClient = {
      rpc: (_fn, args) => { captured = args; return Promise.resolve({ data: true, error: null }) },
    }
    await enforceRateLimit(client, { subject: 's', action: 'a', max: 1 }, cors)
    expect(captured?.p_window).toBe('3600 seconds')
  })
})
