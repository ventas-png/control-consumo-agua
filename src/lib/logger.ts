// Logger estructurado — wrapper finito alrededor de console + Sentry breadcrumbs.
//
// Motivación: tener un único punto de entrada para registrar info técnica desde
// hooks, componentes y libs, con dos garantías:
//
//   1. En producción NO se imprime nivel 'debug' (ruido + posibles leaks).
//   2. Cada llamada deja un breadcrumb estructurado en Sentry que ayuda a
//      reconstruir la sesión cuando llega un crash.
//
// Uso típico:
//
//   import { logger } from '@/lib/logger'
//   logger.debug('lecturas:loaded', { count: rows.length })
//   logger.warn('storage:retry', { attempt: 2 })
//   logger.error('payment:failed', { paymentId }, error)
//
// El reemplazo gradual de los console.log/error repartidos por la base se hará
// en PRs siguientes (sin urgencia: este archivo solo introduce la herramienta).

import * as Sentry from '@sentry/react'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const IS_PROD = import.meta.env.MODE === 'production'

interface LogContext {
  [key: string]: unknown
}

function emit(level: LogLevel, message: string, context?: LogContext, error?: unknown): void {
  // En prod ignoramos debug: ni se imprime ni se envía a Sentry como breadcrumb.
  if (IS_PROD && level === 'debug') return

  // Sentry breadcrumb: queda en el error report si la sesión termina en crash.
  // No hace nada si Sentry no está inicializado (sin DSN configurado).
  // Mapeo de niveles: nuestro 'warn' equivale a 'warning' en Sentry SeverityLevel.
  const sentryLevel = level === 'warn' ? 'warning' : level
  Sentry.addBreadcrumb({
    category: 'app',
    message,
    level: sentryLevel,
    data: context,
  })

  // Consola: text formateado para que sea fácil filtrar en devtools.
  const prefix = `[${level.toUpperCase()}] ${message}`
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : level === 'info' ? console.info : console.debug
  if (context && error !== undefined) {
    fn(prefix, context, error)
  } else if (context) {
    fn(prefix, context)
  } else if (error !== undefined) {
    fn(prefix, error)
  } else {
    fn(prefix)
  }

  // Errores explícitos también se capturan como exception en Sentry para
  // que generen issue. El breadcrumb anterior queda como contexto previo.
  if (level === 'error' && error !== undefined) {
    Sentry.captureException(error, context ? { extra: context } : undefined)
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info:  (message: string, context?: LogContext) => emit('info',  message, context),
  warn:  (message: string, context?: LogContext) => emit('warn',  message, context),
  error: (message: string, context?: LogContext, error?: unknown) => emit('error', message, context, error),
}
