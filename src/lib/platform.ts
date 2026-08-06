// Punto único de detección de plataforma. Todo el código específico de la app
// nativa (Capacitor) se guarda detrás de `isNative()` para que el build web y su
// comportamiento no cambien: en web `Capacitor.isNativePlatform()` es `false` y
// las ramas nativas nunca se ejecutan.
import { Capacitor } from '@capacitor/core'

/** `true` dentro de la app nativa iOS/Android; `false` en el navegador web. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/** Plataforma actual: 'ios' | 'android' en nativo, 'web' en el navegador. */
export function getPlatform(): 'ios' | 'android' | 'web' {
  return Capacitor.getPlatform() as 'ios' | 'android' | 'web'
}
