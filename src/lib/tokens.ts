// Tokens y códigos CRIPTOGRÁFICOS compartidos (B5, auditoría 2026-07-16 S3).
//
// Regla: cualquier código que autorice una acción (retiro de paquete, pase de
// visita, etc.) se genera con crypto.getRandomValues — NUNCA Math.random()
// (PRNG predecible: un atacante que observe algunos códigos puede inferir los
// siguientes). Extraído del patrón de garita (ControlAccesosQRTab, P0 #8 de la
// auditoría 2026-07-10) para que todos los flujos lo compartan.

// Alfabeto sin caracteres ambiguos (0/O, 1/I/L): el guardia o el tercero lo
// teclea/lee sin confusión. 31 chars ≈ 4.95 bits por carácter.
export const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Token criptográfico legible de `len` caracteres del alfabeto no ambiguo.
 * 12 chars ≈ 59 bits (pases de garita) · 8 chars ≈ 40 bits (códigos de retiro
 * de un solo uso). El sesgo del módulo (256 % 31 ≠ 0) es < 0.2% por carácter —
 * irrelevante para estos tamaños.
 */
export function generarToken(len = 12): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]
  return out
}
