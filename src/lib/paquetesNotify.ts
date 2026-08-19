import { supabase } from './supabase'
import { logger } from './logger'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

export interface NotifyPackageResult {
  success?: boolean
  notified?: number
  emailed?: number
  whatsapp?: 'sent' | 'not_configured' | 'error'
  skipped?: string
  error?: string
}

interface NotifyOptions {
  maxAttempts?: number
  // Delays entre intentos en ms. Si la lista tiene menos entradas que
  // (maxAttempts - 1), el último delay se reutiliza para los reintentos finales.
  retryDelaysMs?: number[]
}

const DEFAULT_OPTIONS: Required<NotifyOptions> = {
  maxAttempts: 3,
  retryDelaysMs: [800, 2000],
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Dispara el aviso al residente (in-app + correo + WhatsApp) vía la edge function
// notify-package, autenticando con el JWT del usuario actual.
//
// Sirve a las DOS clases del motor de recepción (20260829000000): paquetería y
// correspondencia. La función resuelve el texto, la sección del portal y la
// plantilla de correo a partir de `clase`, así que el llamador solo pasa el id.
// El endpoint conserva el nombre `notify-package` a propósito: renombrarlo
// significa desplegar una función nueva y dejar la vieja viva en Supabase, sin
// ganancia para nadie. El nombre de la URL no es el contrato; lo es el payload.
//
// Retry policy: por defecto, hasta 3 intentos con backoff exponencial corto
// (0ms → 800ms → 2000ms). Los reintentos solo se hacen ante errores transitorios
// (5xx, fetch rejection). Errores 4xx no se reintentan porque indican un
// problema de payload/autenticación que no se va a resolver repitiendo.
//
// El llamador puede capturar el throw final con try/catch: el fallo del aviso
// no debe romper el registro del paquete. Cada intento se traza con `logger`
// para que Sentry tenga el breadcrumb completo si la sesión termina en crash.
export async function notificarPieza(
  paqueteId: string,
  opts: NotifyOptions = {},
): Promise<NotifyPackageResult> {
  const { maxAttempts, retryDelaysMs } = { ...DEFAULT_OPTIONS, ...opts }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''

  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paquete_id: paqueteId }),
      })
      const json = await res.json().catch(() => ({})) as NotifyPackageResult

      if (res.ok) {
        if (attempt > 1) {
          logger.info('paquetesNotify:retry_succeeded', { paqueteId, attempt, maxAttempts })
        }
        return json
      }

      // 4xx no se reintenta (es del cliente/payload, no transitorio).
      if (res.status >= 400 && res.status < 500) {
        const msg = json.error ?? `notify-package falló con ${res.status}`
        logger.warn('paquetesNotify:client_error_no_retry', { paqueteId, status: res.status, msg })
        throw new Error(msg)
      }

      // 5xx: intento siguiente con backoff.
      lastError = new Error(json.error ?? `notify-package falló con ${res.status}`)
      logger.warn('paquetesNotify:server_error_will_retry', {
        paqueteId, attempt, maxAttempts, status: res.status,
      })
    } catch (err) {
      // Fetch rejection (red caída, CORS, etc.): reintentar.
      lastError = err
      // Si el catch atrapó el throw del 4xx anterior, no debemos seguir.
      if (err instanceof Error && err.message.includes('notify-package falló con 4')) {
        throw err
      }
      logger.warn('paquetesNotify:network_error_will_retry', {
        paqueteId, attempt, maxAttempts, error: String(err),
      })
    }

    if (attempt < maxAttempts) {
      const delayIdx = Math.min(attempt - 1, retryDelaysMs.length - 1)
      await sleep(retryDelaysMs[delayIdx])
    }
  }

  // Agotados todos los intentos.
  logger.error('paquetesNotify:exhausted', { paqueteId, maxAttempts }, lastError)
  throw lastError instanceof Error
    ? lastError
    : new Error('No se pudo enviar el aviso tras varios intentos')
}
