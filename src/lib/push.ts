// Notificaciones push nativas (APNs en iOS, FCM en Android) — Fase 3.
//
// ESTADO: cliente listo, pero requiere configuración externa antes de funcionar:
//   - Android: proyecto Firebase + google-services.json en android/app/.
//   - iOS: capability Push Notifications + clave APNs en Apple Developer.
//   - Backend: la Edge Function supabase/functions/send-push despacha el push
//     cuando se crea una notificación in-app. Ver MOBILE.md.
//
// Este módulo registra el dispositivo y guarda su token en la tabla device_tokens
// (RLS por usuario). No-op en web.
//
// SOLO SE ACTIVA CON VITE_PUSH_ENABLED=true, y esa variable solo debe ponerse
// cuando Firebase y APNs ya están configurados (MOBILE.md, paso 6). No es una
// precaución de estilo: sin `google-services.json`, en Android `register()`
// llama a `FirebaseMessaging.getInstance()`, que lanza "Default FirebaseApp is
// not initialized". El puente de Capacitor atrapa esa excepción en el hilo del
// plugin y la RELANZA (`throw new RuntimeException(ex)` en Bridge.callPluginMethod),
// así que Android mata la app — el try/catch de abajo no puede evitarlo, porque
// el fallo ocurre en código nativo, no en esta promesa. Y como el registro corre
// en cada login y en cada arranque con sesión, la app se cerraría al abrirse.
// En iOS no se cae (el fallo llega como evento `registrationError`), pero pediría
// permiso de notificaciones para algo que todavía no funciona.
import { isNative, getPlatform } from './platform'
import { supabase } from './supabase'

/** `true` cuando el build lleva VITE_PUSH_ENABLED=true (o 1): Firebase y APNs listos. */
export function pushHabilitado(): boolean {
  const valor = String(import.meta.env.VITE_PUSH_ENABLED ?? '').trim().toLowerCase()
  return valor === 'true' || valor === '1'
}

/**
 * Pide permiso de notificaciones, registra el dispositivo y persiste el token en
 * `device_tokens`. Llamar tras autenticar (con el user_id de la sesión activa).
 */
export async function initPushNotifications(userId: string): Promise<void> {
  if (!isNative() || !userId || !pushHabilitado()) return
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return

    // El token llega de forma asíncrona por el evento 'registration'.
    // Se registra con una función SECURITY DEFINER en vez de un upsert directo:
    // si otro usuario había iniciado sesión antes en este mismo teléfono, la fila
    // del token es suya y RLS bloquearía el update (ver la migración).
    await PushNotifications.addListener('registration', (token) => {
      void supabase
        .rpc('register_device_token', { p_token: token.value, p_platform: getPlatform() })
        .then(({ error }) => {
          if (error) console.warn('[push] no se pudo registrar el token:', error.message)
        })
    })

    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[push] registration error:', err)
    })

    await PushNotifications.register()
  } catch {
    // Fallos del lado JS (plugin ausente, permiso rechazado). Los fallos nativos de
    // Firebase no llegan aquí: por eso la guarda de pushHabilitado() de arriba.
  }
}
