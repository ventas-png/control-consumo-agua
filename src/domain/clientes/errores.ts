// domain/clientes/errores.ts — Traducción de errores de persistencia de
// clientes a mensajes accionables.
//
// Contexto: `clientes.codigo` (clientes_codigo_key) y `clientes.cui_dui`
// (clientes_cui_dui_unique) son únicos a nivel PLATAFORMA, no por empresa, y
// desde el endurecimiento de `buscar_cliente_para_onboarding` (aislamiento de
// tenants) el lookup solo reporta coincidencias exactas 3-de-3. Un CUI o código
// ya usado por otro tenant llega hasta el INSERT y revienta con 23505 — que la
// UI mostraba como "Verifique conexión", ocultando la causa real.
//
// Acepta tanto el error-objeto de PostgREST/validatedInsert como el `string`
// que devuelven las mutations de domain (que ya aplanaron a `error.message`);
// el nombre del constraint viaja en el texto en ambos casos.

import { isValidationError } from '../../lib/validatedInsert'

interface ErrorLike {
  code?: string | null
  message?: string | null
  details?: string | null
}

export function mensajeErrorGuardarCliente(
  error: ErrorLike | string | null | undefined,
  accion: 'guardar' | 'actualizar' = 'guardar',
): string {
  const fallback = `No se pudo ${accion} el cliente. Verifique conexión.`
  if (!error) return fallback
  const err: ErrorLike = typeof error === 'string' ? { message: error } : error

  // Pre-validación Zod (validatedInsert): el mensaje ya es legible por campo.
  if (isValidationError(err)) return err.message ?? fallback

  const texto = `${err.message ?? ''} ${err.details ?? ''}`
  const esDuplicado = err.code === '23505' || /duplicate key|llave duplicada/i.test(texto)
  if (esDuplicado) {
    if (/cui_dui/i.test(texto)) {
      return 'Ya existe un cliente registrado con ese CUI/DUI en la plataforma. ' +
        'Verifique el número ingresado; si se trata del mismo cliente, use «Solicitar Cliente» ' +
        'con su CUI/DUI, fecha de nacimiento y correo exactos para vincularlo a su empresa.'
    }
    if (/codigo/i.test(texto)) {
      return 'El código de cliente ya está en uso por otro cliente. Ingrese un código diferente.'
    }
    return 'Ya existe un cliente con esos datos en la plataforma (registro duplicado).'
  }

  if (err.code === '42501' || /row-level security/i.test(texto)) {
    return `Su usuario no tiene permisos para ${accion} clientes. Contacte al administrador.`
  }

  return err.message ? `No se pudo ${accion} el cliente: ${err.message}` : fallback
}
