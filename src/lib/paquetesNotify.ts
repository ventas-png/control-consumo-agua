import { supabase } from './supabase'
import { logger } from './logger'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

export interface NotifyPackageResult {
  success?: boolean
  notified?: number
  emailed?: number
  whatsapp?: 'sent' | 'not_configured' | 'error'
  /** true si algún canal entregó. Lo decide el servidor; ver `avisoEntregado`. */
  delivered?: boolean
  skipped?: string
  error?: string
}

/** Cómo le fue al aviso, para que la UI diga la verdad. */
export type ResultadoAviso =
  | { estado: 'entregado'; detalle: NotifyPackageResult }
  /**
   * Ya se había avisado (o hay otra ejecución dentro del lease). NO es un fallo
   * y no se ofrece reintentar: reintentar solo mandaría un segundo aviso al
   * residente. Va aparte de `sin_canales` porque decirle al operador "no tiene
   * datos de contacto" cuando el correo ya salió es información falsa.
   */
  | { estado: 'ya_avisado'; detalle: NotifyPackageResult }
  /** El servidor respondió OK pero ningún canal entregó (sin contacto, canales caídos). */
  | { estado: 'sin_canales'; detalle: NotifyPackageResult }
  /** No se pudo ni preguntar: red caída, 4xx/5xx tras los reintentos. */
  | { estado: 'fallo'; error: Error }

/** Motivos por los que el servidor no volvió a enviar porque ya estaba hecho. */
const YA_AVISADO = ['already_notified', 'aviso_en_curso']

/**
 * ¿Entregó algo? El servidor manda `delivered`; para respuestas de una versión
 * anterior de la edge function se deriva de los contadores, y NUNCA se asume
 * entregado por el mero hecho de que la llamada devolviera 200.
 */
export function avisoEntregado(r: NotifyPackageResult): boolean {
  if (typeof r.delivered === 'boolean') return r.delivered
  return (r.notified ?? 0) > 0 || (r.emailed ?? 0) > 0 || r.whatsapp === 'sent'
}

/**
 * Envoltura que NO lanza: devuelve qué pasó realmente para que la pantalla
 * pueda mostrar éxito, advertencia o fallo — y ofrecer reintentar.
 *
 * Existe porque el patrón anterior (`try { notificarPieza() } catch {}`) se
 * tragaba el error y la UI decía "Se avisó al residente" aunque no hubiera
 * salido un solo aviso.
 */
export async function intentarAvisar(
  paqueteId: string,
  opts: NotifyOptions = {},
): Promise<ResultadoAviso> {
  try {
    const detalle = await notificarPieza(paqueteId, opts)
    if (avisoEntregado(detalle)) return { estado: 'entregado', detalle }
    if (detalle.skipped && YA_AVISADO.includes(detalle.skipped)) {
      return { estado: 'ya_avisado', detalle }
    }
    return { estado: 'sin_canales', detalle }
  } catch (err) {
    return { estado: 'fallo', error: err instanceof Error ? err : new Error(String(err)) }
  }
}

/**
 * Error HTTP del endpoint de aviso, con el status a la vista.
 *
 * Existe para que la decisión de reintentar dependa del CÓDIGO y no del texto:
 * el mensaje lo escribe el servidor y puede ser cualquier cosa.
 */
export class ErrorAvisoHttp extends Error {
  readonly status: number
  constructor(mensaje: string, status: number) {
    super(mensaje)
    this.name = 'ErrorAvisoHttp'
    this.status = status
  }
  /** 4xx es del payload o de la autorización: repetirlo da exactamente lo mismo. */
  get reintentable(): boolean {
    return this.status < 400 || this.status >= 500
  }
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
// Sirve a las DOS clases del motor de recepción (20260829000600): paquetería y
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
        throw new ErrorAvisoHttp(msg, res.status)
      }

      // 5xx: intento siguiente con backoff.
      lastError = new Error(json.error ?? `notify-package falló con ${res.status}`)
      logger.warn('paquetesNotify:server_error_will_retry', {
        paqueteId, attempt, maxAttempts, status: res.status,
      })
    } catch (err) {
      // Fetch rejection (red caída, CORS, etc.): reintentar.
      lastError = err
      // El 4xx que lanzamos arriba se reconoce por su STATUS, no por su texto.
      // Antes se comprobaba `message.includes('notify-package falló con 4')`, que
      // solo acertaba cuando el servidor NO mandaba `error` en el body: en cuanto
      // respondía `{"error":"Forbidden"}` el mensaje era "Forbidden", la
      // comprobación fallaba y un 401/403/404 se reintentaba tres veces con
      // backoff — ruido garantizado y ni un aviso más entregado.
      if (err instanceof ErrorAvisoHttp && !err.reintentable) {
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
