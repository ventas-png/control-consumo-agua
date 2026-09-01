// domain/functionError.ts — El mensaje REAL de una edge function.
//
// POR QUÉ EXISTE
// `supabase.functions.invoke` no devuelve el cuerpo cuando la función responde
// un status no-2xx: `error.message` es siempre la misma cadena genérica ("Edge
// Function returned a non-2xx status code") y el `{ error: "…" }` que la función
// escribió queda enterrado en `error.context`, sin leer.
//
// Eso importa justo donde más: los límites de tasa de los endpoints anónimos
// responden 429 y —desde que `signup-company` y `create-cliente-account` son
// fail-closed— 503 con "Servicio temporalmente no disponible. Intenta de nuevo
// en unos minutos.". Sin este helper la UI enseña la cadena genérica del SDK y
// el usuario no se entera de que basta con reintentar en un rato.
//
// El helper estaba DUPLICADO literalmente en domain/shared/mutations.ts y
// domain/portal/mutations.ts. Vive aquí para que sumar un tercer caso (auth)
// no signifique una tercera copia.

import { FunctionsHttpError } from '@supabase/supabase-js'

/**
 * Extrae el mensaje que la edge function puso en el body `{ error }`. Si el
 * error no es de HTTP, el body no es JSON o ya se consumió, cae al `message`
 * del error — nunca lanza.
 */
export async function extractFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string } | null
      if (body?.error) return body.error
    } catch {
      // body no-JSON o ya consumido: cae al mensaje genérico
    }
  }
  const msg = (error as { message?: unknown } | null)?.message
  return typeof msg === 'string' ? msg : String(error)
}
