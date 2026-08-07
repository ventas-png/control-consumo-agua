// Tests de la lógica pura del tracking de entrega/lectura (com:N4/N26, épica
// #301). Como el resto de tests de edge fns, corre bajo vitest (no Deno)
// tratando el módulo como TS normal — Web Crypto existe en Node 18+.
// Cubre: round-trip del token firmado, rechazo de manipulación (anti-forja del
// endpoint público), construcción de la URL del píxel, inyección en el HTML y
// validez del GIF de respuesta.

import { describe, it, expect } from 'vitest'
import {
  appendTrackingPixel,
  buildPixelUrl,
  buildTrackingToken,
  ONE_PIXEL_GIF_BASE64,
  onePixelGifBytes,
  verifyTrackingToken,
} from '../deliveryTracking.ts'

const SECRET = 'super-secreto-de-prueba'
const OUTBOX_ID = '0b6f1a5e-2d3c-4e5f-8a9b-1c2d3e4f5a6b'
const TRACKING_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d'

describe('deliveryTracking/buildTrackingToken + verifyTrackingToken', () => {
  it('round-trip: un token construido verifica y devuelve kind/id', async () => {
    const token = await buildTrackingToken('o', OUTBOX_ID, SECRET)
    expect(await verifyTrackingToken(token, SECRET)).toEqual({ kind: 'o', id: OUTBOX_ID })

    const token2 = await buildTrackingToken('t', TRACKING_ID, SECRET)
    expect(await verifyTrackingToken(token2, SECRET)).toEqual({ kind: 't', id: TRACKING_ID })
  })

  it('rechaza firma manipulada (anti-forja: no se puede marcar leído ajeno)', async () => {
    const token = await buildTrackingToken('o', OUTBOX_ID, SECRET)
    const [kind, id, sig] = token.split(':')
    const flipped = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0')
    expect(await verifyTrackingToken(`${kind}:${id}:${flipped}`, SECRET)).toBeNull()
  })

  it('rechaza id sustituido aunque la firma sea de otro id válido', async () => {
    const token = await buildTrackingToken('o', OUTBOX_ID, SECRET)
    const sig = token.split(':')[2]
    expect(await verifyTrackingToken(`o:${TRACKING_ID}:${sig}`, SECRET)).toBeNull()
  })

  it('rechaza kind sustituido (un token de log no marca outbox y viceversa)', async () => {
    const token = await buildTrackingToken('o', OUTBOX_ID, SECRET)
    const [, id, sig] = token.split(':')
    expect(await verifyTrackingToken(`t:${id}:${sig}`, SECRET)).toBeNull()
  })

  it('rechaza secreto distinto, malformados, kinds desconocidos y no-uuid', async () => {
    const token = await buildTrackingToken('o', OUTBOX_ID, SECRET)
    expect(await verifyTrackingToken(token, 'otro-secreto')).toBeNull()
    expect(await verifyTrackingToken(null, SECRET)).toBeNull()
    expect(await verifyTrackingToken(undefined, SECRET)).toBeNull()
    expect(await verifyTrackingToken('', SECRET)).toBeNull()
    expect(await verifyTrackingToken('o:sin-firma', SECRET)).toBeNull()
    expect(await verifyTrackingToken(`x:${OUTBOX_ID}:deadbeef`, SECRET)).toBeNull()
    expect(await verifyTrackingToken('o:no-es-uuid:deadbeef', SECRET)).toBeNull()
    // Sin secreto configurado el verificador es fail-closed.
    expect(await verifyTrackingToken(token, '')).toBeNull()
  })

  it('la firma es case-insensitive en hex pero exige longitud exacta', async () => {
    const token = await buildTrackingToken('t', TRACKING_ID, SECRET)
    const [kind, id, sig] = token.split(':')
    expect(await verifyTrackingToken(`${kind}:${id}:${sig.toUpperCase()}`, SECRET)).toEqual({ kind: 't', id: TRACKING_ID })
    expect(await verifyTrackingToken(`${kind}:${id}:${sig}00`, SECRET)).toBeNull()
    expect(await verifyTrackingToken(`${kind}:${id}:${sig.slice(0, -2)}`, SECRET)).toBeNull()
  })
})

describe('deliveryTracking/buildPixelUrl', () => {
  it('apunta al edge track-email-open con el token URL-encoded', () => {
    const url = buildPixelUrl('https://abc.supabase.co', 'o:x:y')
    expect(url).toBe('https://abc.supabase.co/functions/v1/track-email-open?t=o%3Ax%3Ay')
  })

  it('normaliza el slash final de la base', () => {
    expect(buildPixelUrl('https://abc.supabase.co/', 'tok')).toBe(
      'https://abc.supabase.co/functions/v1/track-email-open?t=tok',
    )
  })
})

describe('deliveryTracking/appendTrackingPixel', () => {
  it('inserta antes de </body> cuando existe (case-insensitive)', () => {
    const out = appendTrackingPixel('<html><body><p>Hola</p></BODY></html>', 'https://x/p.gif')
    expect(out).toContain('<img src="https://x/p.gif"')
    expect(out.indexOf('<img')).toBeLessThan(out.indexOf('</BODY>'))
  })

  it('appendea al final cuando no hay </body>', () => {
    const out = appendTrackingPixel('<p>Hola</p>', 'https://x/p.gif')
    expect(out.endsWith('/>')).toBe(true)
    expect(out.startsWith('<p>Hola</p>')).toBe(true)
  })

  it('el img es invisible (1x1, display:none) y sin alt visible', () => {
    const out = appendTrackingPixel('<p>a</p>', 'https://x/p.gif')
    expect(out).toContain('width="1"')
    expect(out).toContain('height="1"')
    expect(out).toContain('display:none')
    expect(out).toContain('alt=""')
  })
})

describe('deliveryTracking/onePixelGifBytes', () => {
  it('decodifica a un GIF válido (magic GIF89a + terminador ;)', () => {
    const bytes = onePixelGifBytes()
    expect(bytes.length).toBe(42)
    // 'GIF89a'
    expect(Array.from(bytes.slice(0, 6))).toEqual([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    // Trailer del formato GIF (';').
    expect(bytes[bytes.length - 1]).toBe(0x3b)
    // Round-trip contra la constante exportada.
    expect(btoa(String.fromCharCode(...bytes))).toBe(ONE_PIXEL_GIF_BASE64)
  })
})
