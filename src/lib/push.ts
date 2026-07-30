// Notificaciones push nativas (APNs en iOS, FCM en Android) — Fase 3.
//
// ESTADO: cliente listo, pero requiere configuración externa antes de funcionar:
//   - Android: proyecto Firebase + google-services.json en android/app/.
//   - iOS: capability Push Notifications + clave APNs en Apple Developer.
//   - Backend: la Edge Function supabase/functions/send-push despacha el push
//     cuando se crea una notificación in-app. Ver MOBILE.md.
//
// Este módulo registra el dispositivo y guarda su token en la tabla device_tokens
// (RLS por usuario). Es 100% defensivo: cualquier fallo se ignora para no afectar
// el arranque ni el login. No-op en web.
import { isNative, getPlatform } from './platform'
import { supabase } from './supabase'

/**
 * Pide permiso de notificaciones, registra el dispositivo y persiste el token en
 * `device_tokens`. Llamar tras autenticar (con el user_id de la sesión activa).
 */
export async function initPushNotifications(userId: string): Promise<void> {
  if (!isNative() || !userId) return
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
    // push-notifications no disponible o sin configurar: se ignora
  }
}
