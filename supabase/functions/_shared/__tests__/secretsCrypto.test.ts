import { describe, it, expect } from 'vitest'
import {
  isEncrypted,
  importAesKey,
  encryptWithKey,
  decryptWithKey,
  encryptSecret,
  decryptSecret,
} from '../secretsCrypto.ts'

async function freshKey(): Promise<CryptoKey> {
  return importAesKey(crypto.getRandomValues(new Uint8Array(32)))
}

describe('isEncrypted', () => {
  it('detecta el envelope enc:v1:', () => {
    expect(isEncrypted('enc:v1:abc')).toBe(true)
  })
  it('texto plano / null / undefined → false', () => {
    expect(isEncrypted('sk_live_123')).toBe(false)
    expect(isEncrypted(null)).toBe(false)
    expect(isEncrypted(undefined)).toBe(false)
  })
})

describe('importAesKey', () => {
  it('rechaza llaves que no son de 32 bytes', async () => {
    await expect(importAesKey(new Uint8Array(16))).rejects.toThrow(/32 bytes/)
  })
})

describe('encryptWithKey / decryptWithKey (núcleo puro)', () => {
  it('round-trip: descifrar lo cifrado devuelve el original', async () => {
    const key = await freshKey()
    const secret = 'sk_live_51ABCdef...zZ'
    const enc = await encryptWithKey(key, secret)
    expect(isEncrypted(enc)).toBe(true)
    expect(enc).not.toContain(secret)
    expect(await decryptWithKey(key, enc)).toBe(secret)
  })

  it('cada cifrado usa un IV distinto (no determinista)', async () => {
    const key = await freshKey()
    const a = await encryptWithKey(key, 'mismo-valor')
    const b = await encryptWithKey(key, 'mismo-valor')
    expect(a).not.toBe(b)
    expect(await decryptWithKey(key, a)).toBe('mismo-valor')
    expect(await decryptWithKey(key, b)).toBe('mismo-valor')
  })

  it('idempotente: cifrar un valor ya cifrado lo deja igual', async () => {
    const key = await freshKey()
    const enc = await encryptWithKey(key, 'token')
    expect(await encryptWithKey(key, enc)).toBe(enc)
  })

  it('preserva UTF-8 / cadenas largas (tokens OAuth, jsonb de credenciales)', async () => {
    const key = await freshKey()
    const secret = JSON.stringify({ usuario: 'José', clave: 'áéíóú-ñ-🔐', n: 'x'.repeat(4000) })
    expect(await decryptWithKey(key, await encryptWithKey(key, secret))).toBe(secret)
  })

  it('lectura DUAL: un valor sin prefijo (texto plano legacy) se devuelve tal cual', async () => {
    const key = await freshKey()
    expect(await decryptWithKey(key, 'sk_plano_legacy')).toBe('sk_plano_legacy')
  })

  it('valor cifrado sin llave → lanza (estado de error ruidoso)', async () => {
    const key = await freshKey()
    const enc = await encryptWithKey(key, 'x')
    await expect(decryptWithKey(null, enc)).rejects.toThrow(/no hay llave/)
  })

  it('texto plano sin llave → passthrough (no lanza)', async () => {
    expect(await decryptWithKey(null, 'plano')).toBe('plano')
  })

  it('manipulación del ciphertext → falla la autenticación GCM', async () => {
    const key = await freshKey()
    const enc = await encryptWithKey(key, 'no-me-manipules')
    // Voltea un carácter del cuerpo base64 (tras el prefijo).
    const body = enc.slice('enc:v1:'.length)
    const flipped = (body[10] === 'A' ? 'B' : 'A') + body.slice(1) // corrompe el inicio
    const tampered = 'enc:v1:' + body.slice(0, 10) + flipped[0] + body.slice(11)
    await expect(decryptWithKey(key, tampered)).rejects.toBeTruthy()
  })

  it('llave equivocada → no descifra', async () => {
    const k1 = await freshKey()
    const k2 = await freshKey()
    const enc = await encryptWithKey(k1, 'secreto')
    await expect(decryptWithKey(k2, enc)).rejects.toBeTruthy()
  })
})

describe('encryptSecret / decryptSecret (wrappers de entorno)', () => {
  // En vitest (Node) no existe Deno.env → sin llave → passthrough. Esto valida
  // el comportamiento NO-DISRUPTIVO: cablear los wrappers antes de provisionar
  // la llave no cambia nada.
  it('sin llave: encryptSecret devuelve el texto plano', async () => {
    expect(await encryptSecret('sk_live_x')).toBe('sk_live_x')
  })
  it('sin llave: decryptSecret de texto plano lo devuelve igual', async () => {
    expect(await decryptSecret('sk_live_x')).toBe('sk_live_x')
  })
  it('decryptSecret(null) → null', async () => {
    expect(await decryptSecret(null)).toBeNull()
    expect(await decryptSecret(undefined)).toBeNull()
  })
})
