// Sign in with Apple con «Ocultar mi correo»: Apple entrega un alias
// @privaterelay.appleid.com en vez del correo real. Ese alias nunca coincide con
// el correo que la empresa tiene en el padrón, así que el onboarding OAuth pide
// el correo registrado cuando detecta el alias (ver OAuthOnboardingScreen y la
// edge function complete-oauth-onboarding, que aplica la misma regla del lado
// del servidor).
export const DOMINIO_RELAY_APPLE = 'privaterelay.appleid.com'

/** `true` si el correo es un alias privado de Apple (Hide My Email). */
export function esCorreoPrivadoDeApple(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase().endsWith(`@${DOMINIO_RELAY_APPLE}`)
}
