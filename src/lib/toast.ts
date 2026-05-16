// Toast notification helpers — non-blocking feedback para success/error/info.
//
// Background: la app tenía 992 llamadas a `Swal.fire` en 182 archivos. La
// mayoría eran mensajes informativos cortos (toast pattern) que con sweetalert
// se mostraban como modales intrusivos que bloquean el flow del usuario. Esto
// migra esos casos a sonner — toast no-modal en esquina superior derecha que
// auto-dismiss en 4s.
//
// Cuándo usar toast vs Swal:
//   toast: success rápido, warning leve, error transitorio, info corto
//   Swal:  confirmaciones destructivas, formularios inline, mensajes largos
//          que requieren acknowledgment explícito
//
// Esta envoltura existe para que cambiar sonner por otra lib en el futuro
// solo toque este archivo.

import { toast as sonner } from 'sonner'

interface ToastOptions {
  /** ID estable para deduplicar toasts repetidos. */
  id?: string
  /** Duración en ms (default 4000 para success/info, 6000 para error). */
  duration?: number
  /** Descripción adicional debajo del título. */
  description?: string
}

export const toast = {
  /** Mensaje de éxito (verde, ~4s). */
  success(message: string, opts?: ToastOptions): void {
    sonner.success(message, { duration: 4000, ...opts })
  },

  /** Mensaje de error (rojo, ~6s — más largo para que el usuario lo lea). */
  error(message: string, opts?: ToastOptions): void {
    sonner.error(message, { duration: 6000, ...opts })
  },

  /** Advertencia (ámbar, ~5s). */
  warning(message: string, opts?: ToastOptions): void {
    sonner.warning(message, { duration: 5000, ...opts })
  },

  /** Mensaje neutro/informativo (~4s). */
  info(message: string, opts?: ToastOptions): void {
    sonner(message, { duration: 4000, ...opts })
  },

  /**
   * Toast de "guardando..." que se actualiza al terminar la promise.
   * Útil para operaciones async donde queremos mostrar progreso.
   *
   *   await toast.promise(saveProfile(), {
   *     loading: 'Guardando perfil...',
   *     success: 'Perfil guardado',
   *     error: 'No se pudo guardar',
   *   })
   */
  promise<T>(promise: Promise<T>, msgs: { loading: string; success: string; error: string }): Promise<T> {
    sonner.promise(promise, msgs)
    return promise
  },

  /** Cierra un toast específico por id. */
  dismiss(id?: string): void {
    sonner.dismiss(id)
  },
}
