// Tests del helper de rate-limit (I2, Track T5). Puros: getClientIp es parseo de headers
// y enforceRateLimit recibe el cliente por inyección, así que mockeamos `.rpc` sin Deno.
//
// Igual que emailRetryable.test.ts, corre bajo vitest (no Deno) y trata el módulo como TS.

import { describe, it, expect } from 'vitest'
import { getClientIp, enforceRateLimit, enforceRateLimits, type RpcClient } from '../rateLimit.ts'

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

  // Gaps T8 (infra:I22): cadena de fallback completa y XFF degenerado.
  it('un x-forwarded-for vacío cae a fly-client-ip (no devuelve string vacío)', () => {
    expect(getClientIp(mkReq({ 'x-forwarded-for': '   ', 'fly-client-ip': '7.7.7.7' }))).toBe('7.7.7.7')
  })

  it('recorta espacios alrededor del primer hop de x-forwarded-for', () => {
    expect(getClientIp(mkReq({ 'x-forwarded-for': '  8.8.8.8 , 9.9.9.9' }))).toBe('8.8.8.8')
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

  it('el 429 incluye Retry-After = windowSeconds (default 3600)', async () => {
    const res = await enforceRateLimit(clientReturning(false), { subject: 's', action: 'a', max: 1 }, cors)
    expect(res!.headers.get('Retry-After')).toBe('3600')
  })

  it('el 429 refleja Retry-After del windowSeconds custom', async () => {
    const res = await enforceRateLimit(clientReturning(false), { subject: 's', action: 'a', max: 1, windowSeconds: 60 }, cors)
    expect(res!.headers.get('Retry-After')).toBe('60')
  })

  it('fail-open (null) ante error de infra (data null)', async () => {
    const res = await enforceRateLimit(clientReturning(null), { subject: 'x', action: 'y', max: 1 }, cors)
    expect(res).toBeNull()
  })

  // Gaps T8 (infra:I22): solo `false` explícito bloquea; cuerpo y mensaje del 429.
  it('fail-open (null) cuando data es undefined (RPC no devolvió bool)', async () => {
    const res = await enforceRateLimit(clientReturning(undefined), { subject: 'x', action: 'y', max: 1 }, cors)
    expect(res).toBeNull()
  })

  it('NO bloquea con valores truthy ni con 0 (solo false estricto bloquea)', async () => {
    expect(await enforceRateLimit(clientReturning(true), { subject: 's', action: 'a', max: 1 }, cors)).toBeNull()
    expect(await enforceRateLimit(clientReturning(0), { subject: 's', action: 'a', max: 1 }, cors)).toBeNull()
  })

  it('el 429 lleva el mensaje por defecto en es-MX y Content-Type JSON', async () => {
    const res = await enforceRateLimit(clientReturning(false), { subject: 's', action: 'a', max: 1 }, cors)
    expect(res!.headers.get('Content-Type')).toBe('application/json')
    const payload = await res!.json() as { error: string }
    expect(payload.error).toMatch(/Demasiadas solicitudes/)
  })

  it('el 429 respeta el mensaje custom (opts.message)', async () => {
    const res = await enforceRateLimit(
      clientReturning(false),
      { subject: 's', action: 'a', max: 1, message: 'Mensaje propio' },
      cors,
    )
    const payload = await res!.json() as { error: string }
    expect(payload.error).toBe('Mensaje propio')
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

describe('enforceRateLimits (multi-dimensión)', () => {
  const cors = { 'Access-Control-Allow-Origin': 'https://x.test' }

  it('permite (null) cuando todos los límites pasan', async () => {
    const subjects: string[] = []
    const client: RpcClient = {
      rpc: (_fn, args) => { subjects.push(args.p_subject as string); return Promise.resolve({ data: true, error: null }) },
    }
    const res = await enforceRateLimits(client, [
      { subject: 'ip:1.1.1.1', action: 'signup_company', max: 5 },
      { subject: 'email:a@b.com', action: 'signup_company:email', max: 3 },
    ], cors)
    expect(res).toBeNull()
    expect(subjects).toEqual(['ip:1.1.1.1', 'email:a@b.com']) // ambos evaluados
  })

  it('corto-circuita en el primer límite excedido (no toca los siguientes)', async () => {
    const subjects: string[] = []
    // El primer límite (IP) devuelve false → debe parar antes de registrar el de email.
    const client: RpcClient = {
      rpc: (_fn, args) => {
        subjects.push(args.p_subject as string)
        const blocked = args.p_subject === 'ip:1.1.1.1'
        return Promise.resolve({ data: !blocked, error: null })
      },
    }
    const res = await enforceRateLimits(client, [
      { subject: 'ip:1.1.1.1', action: 'signup_company', max: 5 },
      { subject: 'email:a@b.com', action: 'signup_company:email', max: 3 },
    ], cors)
    expect(res!.status).toBe(429)
    expect(subjects).toEqual(['ip:1.1.1.1']) // el de email NO se evaluó → no se quema
  })

  it('dispara el 429 del segundo límite si el primero pasa pero el segundo no', async () => {
    const client: RpcClient = {
      rpc: (_fn, args) => Promise.resolve({ data: args.p_subject !== 'email:a@b.com', error: null }),
    }
    const res = await enforceRateLimits(client, [
      { subject: 'ip:1.1.1.1', action: 'signup_company', max: 5 },
      { subject: 'email:a@b.com', action: 'signup_company:email', max: 3 },
    ], cors)
    expect(res!.status).toBe(429)
  })
})
