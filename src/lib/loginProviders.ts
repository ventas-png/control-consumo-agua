// Qué login social se ofrece en cada plataforma.
//
// App Review Guideline 4.8 (Login Services): una app de iOS que ofrece iniciar
// sesión con un tercero (Google) tiene que ofrecer también una opción
// equivalente que limite los datos a nombre y correo y permita ocultar el
// correo: Sign in with Apple.
//
// Sign in with Apple se activa por build con VITE_APPLE_SIGN_IN=true, y solo
// después de configurar Apple Developer y el proveedor `apple` en Supabase
// (MOBILE.md, paso 4). Sin la variable, la app de iOS NO muestra Google, con lo
// que la regla no aplica; con ella, iOS vuelve a ofrecer Google y Apple. La web
// (incluido Safari en un iPhone, donde Capacitor reporta 'web') siempre ofrece
// Google y, con la variable, también Apple. Android ofrece solo Google: Google
// Play no tiene esta regla y Apple no lo exige fuera de iOS.
import { isNative, getPlatform } from './platform'

/** `true` cuando el build lleva VITE_APPLE_SIGN_IN=true (o 1): proveedor configurado. */
export function appleSignInHabilitado(): boolean {
  const valor = String(import.meta.env.VITE_APPLE_SIGN_IN ?? '').trim().toLowerCase()
  return valor === 'true' || valor === '1'
}

function esAppDeIos(): boolean {
  return isNative() && getPlatform() === 'ios'
}

/** Apple: en web y en la app de iOS, solo con el proveedor configurado. Nunca en Android. */
export function mostrarLoginConApple(): boolean {
  return appleSignInHabilitado() && (!isNative() || esAppDeIos())
}

/** Google: siempre en web y Android; en la app de iOS solo si también se ofrece Apple (4.8). */
export function mostrarLoginConGoogle(): boolean {
  return !esAppDeIos() || mostrarLoginConApple()
}
