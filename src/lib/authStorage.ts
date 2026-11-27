// Dónde guarda Supabase la sesión (el token) según dónde corre la app.
//
//   - Pestaña del navegador: sessionStorage. La sesión no sobrevive al cierre de
//     la pestaña. Es una decisión de seguridad anterior a este archivo y sigue en
//     pie: una computadora compartida no se queda con la sesión de nadie.
//   - App nativa (Capacitor) y web instalada como app (PWA): localStorage. Ahí
//     sessionStorage se vacía cada vez que el sistema cierra la app —en el
//     teléfono, a cada rato—, y obligaría a escribir correo y contraseña en cada
//     apertura. Quien instala la app en su dispositivo espera lo contrario.
//
// Los dos son SÍNCRONOS, y tiene que seguir siendo así. Aquí hubo un adaptador
// asíncrono sobre @capacitor/preferences y se revirtió: en un iPhone real el
// login se colgaba —el token llegaba, pero `signInWithPassword` nunca resolvía
// porque el guardado de la sesión se quedaba pendiente— y el usuario solo veía
// «la conexión tardó demasiado» a los 20 s.
//
// LO QUE CAMBIA EN LA WEB INSTALADA. En la app nativa el WebView solo carga
// nuestro propio bundle empaquetado; la PWA es la web de siempre, con su CSP y
// su SRI como defensa frente a XSS, y ahora con el token persistente mientras
// la sesión siga abierta. Es el comportamiento por defecto de supabase-js y se
// aceptó a propósito para la app instalada (ver docs/PWA_INSTALACION.md). Lo
// que lo acota: «Cerrar sesión» borra el token, y «Sesiones activas» en Mi
// perfil permite cerrar la de un dispositivo perdido. En una tablet compartida
// (portería) hay que cerrar sesión al cambiar de turno, igual que en la nativa.
//
// La caché de la sesión de la app (lib/authSession.ts: nombre, rol, permisos)
// sigue en sessionStorage en todos los casos: al reabrir se reconstruye desde el
// servidor a partir del token (hooks/auth/useOAuthSession).
import { isNative } from './platform'
import { estaInstalada } from './pwaInstall'

/** `true` donde la sesión debe sobrevivir a cerrar la app: nativa o web instalada. */
export function sesionPersistente(): boolean {
  return isNative() || estaInstalada()
}

/** Almacén (síncrono) para la sesión de Supabase. Se decide una vez, al arrancar. */
export function almacenDeSesion(): Storage {
  return sesionPersistente() ? window.localStorage : window.sessionStorage
}
