// ============================================================================
// secretsCrypto — cifrado en reposo de secretos por tenant (P0 #7).
// ============================================================================
// Las tablas deny-all (company_payment_secrets, fiscal_pac_secrets,
// payfac_secrets, company_email_configs) guardan credenciales de pago/PAC/
// PayFac y tokens OAuth. Hoy están protegidas por RLS (solo service_role), pero
// EN TEXTO PLANO: un volcado de backup o una fuga de la service_role_key las
// expone. Este módulo las cifra con AES-256-GCM.
//
// La LLAVE vive SOLO en el entorno de las edge functions
// (TENANT_SECRETS_ENC_KEY, base64 de 32 bytes) — nunca en la base. Así el motor
// de BD jamás ve la llave: aunque se filtre la BD, el ciphertext es inútil sin
// la llave del entorno.
//
// Envelope: "enc:v1:" + base64( iv(12 bytes) || ciphertext+tag ).
//
// DISEÑO NO-DISRUPTIVO (expand→migrate→contract):
//   - encryptSecret: si NO hay llave configurada, devuelve el texto plano tal
//     cual (passthrough) → cablear estos helpers en writers/readers es un NO-OP
//     hasta que un operador provisiona la llave.
//   - decryptSecret / decryptWithKey: lectura DUAL — si el valor no lleva el
//     prefijo "enc:v1:" se asume texto plano legacy y se devuelve sin tocar. Así
//     conviven filas viejas (plano) y nuevas (cifradas) durante el backfill.
//   - Idempotencia: cifrar un valor ya cifrado lo devuelve igual.
//
// El núcleo (importAesKey / encryptWithKey / decryptWithKey / isEncrypted) es
// puro y testeable en vitest (no toca Deno.env); los wrappers encryptSecret /
// decryptSecret leen la llave del entorno.

const PREFIX = 'enc:v1:'
const IV_LEN = 12 // AES-GCM nonce estándar (96 bits)
const KEY_LEN = 32 // AES-256

// ── base64 (global atob/btoa: disponible en Deno, Node 20+ y navegadores) ──
function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** ¿El valor almacenado es un ciphertext de este módulo (vs. texto plano legacy)? */
export function isEncrypted(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.startsWith(PREFIX)
}

/** Importa una llave AES-256-GCM cruda (32 bytes). */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== KEY_LEN) {
    throw new Error(`La llave AES debe ser de ${KEY_LEN} bytes (recibidos ${raw.length})`)
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Importa la llave desde su forma base64 (como viene en TENANT_SECRETS_ENC_KEY). */
export async function importAesKeyBase64(b64: string): Promise<CryptoKey> {
  return importAesKey(b64decode(b64))
}

/** Cifra con una llave explícita. Idempotente si ya está cifrado. */
export async function encryptWithKey(key: CryptoKey, plaintext: string): Promise<string> {
  if (isEncrypted(plaintext)) return plaintext
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  )
  const packed = new Uint8Array(iv.length + ct.length)
  packed.set(iv, 0)
  packed.set(ct, iv.length)
  return PREFIX + b64encode(packed)
}

/**
 * Descifra con una llave explícita (o null). Lectura DUAL: los valores sin el
 * prefijo se devuelven tal cual (texto plano legacy). Un valor cifrado sin
 * llave disponible lanza — es un estado de error ruidoso a propósito.
 */
export async function decryptWithKey(key: CryptoKey | null, stored: string): Promise<string> {
  if (!isEncrypted(stored)) return stored
  if (!key) throw new Error('Valor cifrado pero no hay llave de descifrado disponible (TENANT_SECRETS_ENC_KEY)')
  const packed = b64decode(stored.slice(PREFIX.length))
  const iv = packed.subarray(0, IV_LEN)
  const ct = packed.subarray(IV_LEN)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}

// ── Wrappers atados al entorno (edge functions) ────────────────────────────
// Cachea la llave importada por proceso. `typeof Deno` evita ReferenceError si
// el módulo se importa fuera de Deno (p.ej. vitest en Node), donde no hay env →
// la llave queda null → passthrough.
let keyCache: Promise<CryptoKey | null> | undefined
function envKey(): Promise<CryptoKey | null> {
  if (keyCache) return keyCache
  keyCache = (async () => {
    const b64 = (typeof Deno !== 'undefined' ? Deno.env.get('TENANT_SECRETS_ENC_KEY') : undefined) ?? ''
    if (!b64) return null
    return importAesKeyBase64(b64)
  })()
  return keyCache
}

/** Cifra un secreto para guardarlo. Sin llave configurada → passthrough (texto plano). */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await envKey()
  return key ? encryptWithKey(key, plaintext) : plaintext
}

/** Descifra un secreto leído. Texto plano legacy → passthrough. null → null. */
export async function decryptSecret(stored: string | null | undefined): Promise<string | null> {
  if (stored == null) return null
  return decryptWithKey(await envKey(), stored)
}
