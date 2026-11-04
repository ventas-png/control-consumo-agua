// Qué login social se ofrece en cada plataforma.
//
// App Review Guideline 4.8 (Login Services): una app de iOS que ofrece iniciar
// sesión con un tercero (Google) tiene que ofrecer también una opción
// equivalente que limite los datos a nombre y correo y permita ocultar el
// correo — en la práctica, Sign in with Apple. Mientras no exista el proveedor
// `apple` (pendiente; ver MOBILE.md, paso 4 y notas de diseño), la app de iOS
// simplemente NO muestra el botón de Google, con lo que la regla no aplica.
// La web (incluido Safari en un iPhone, donde Capacitor reporta 'web') y la app
// de Android no cambian: Google Play no tiene esta regla.
import { isNative, getPlatform } from './platform'

/** `false` solo dentro de la app nativa de iOS; `true` en web y en Android. */
export function mostrarLoginConGoogle(): boolean {
  return !(isNative() && getPlatform() === 'ios')
}
