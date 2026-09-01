// domain/auth/mfaActions.ts — I/O del segundo factor TOTP (T7/PR3). Wrappers
// finos sobre `supabase.auth.mfa.*` para que la UI (PerfilSection) no importe
// supabase. Las DECISIONES puras (validar código, seleccionar factor,
// clasificar error) viven en `mfa.ts`; aquí sólo el acceso a la red.
import { supabase } from '../../lib/supabase'
import type { FactorLike } from './mfa'

/** Lista los factores MFA del usuario. `data.all` incluye todos los tipos. */
export async function listMfaFactors(): Promise<{
  data: { all?: FactorLike[] } | null
  error: string | null
}> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  return { data: data ?? null, error: error?.message ?? null }
}

/** Inicia el enrolamiento de un factor TOTP; devuelve el otpauth:// + secret. */
export async function enrollTotpFactor(friendlyName: string): Promise<{
  // `uri` es el otpauth:// que va CODIFICADO dentro del QR: con eso la UI dibuja
  // el QR localmente (qrcode.react).
  //
  // `totp.qr_code` —el SVG ya renderizado que devuelve la API— se omite A
  // PROPÓSITO: pintarlo exige dangerouslySetInnerHTML, y no exponerlo por esta
  // frontera es lo que impide que alguien vuelva a ese camino sin darse cuenta.
  // El objeto en runtime sí lo trae; simplemente no se declara.
  data: { id: string; totp: { secret: string; uri: string } } | null
  error: string | null
}> {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName })
  return { data: data ?? null, error: error?.message ?? null }
}

/** Crea un challenge para un factor (paso previo a verify). */
export async function challengeMfaFactor(
  factorId: string,
): Promise<{ data: { id: string } | null; error: string | null }> {
  const { data, error } = await supabase.auth.mfa.challenge({ factorId })
  return { data: data ?? null, error: error?.message ?? null }
}

/** Verifica el código TOTP contra un challenge. */
export async function verifyMfaFactor(
  factorId: string,
  challengeId: string,
  code: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code })
  return { error: error?.message ?? null }
}

/** Desenrola (elimina) un factor por id. */
export async function unenrollMfaFactor(factorId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  return { error: error?.message ?? null }
}
