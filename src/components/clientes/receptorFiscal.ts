// serv:S11 — Validación PURA de los datos fiscales del RECEPTOR para el formulario
// de cliente. Reusa los validadores de formato de businessFiscal.ts (NIT módulo-11
// GT / RFC MX) — NO reimplementa el algoritmo. Vive aquí (componente, no en
// businessFiscal.ts, que es de #387 y no se toca) para poder testear el gate del
// form en aislamiento, sin renderizar el formulario entero.
import { validarNitGt, validarRfcMx } from '../../lib/businessFiscal'
import type { RegimenFiscalConfig } from '../../types/fiscal'

export interface ReceptorFiscalInput {
  nit?: string | null
  rfc?: string | null
}

/**
 * Devuelve los errores de formato de los datos fiscales del receptor según el
 * régimen del tenant. Reglas:
 *   - regimen 'ninguno' → no se valida nada (el tenant no emite comprobante).
 *   - El identificador es OPCIONAL: vacío no produce error (un receptor puede
 *     capturar sus datos fiscales después, o ser "CF" sin más).
 *   - Si está lleno, se valida el FORMATO con el validador del régimen:
 *       · fel_gt  → NIT (módulo-11), 'CF' aceptado como Consumidor Final.
 *       · cfdi_mx → RFC (estructura SAT).
 *
 * Lista vacía = válido.
 */
export function validarReceptorFiscal(
  regimen: RegimenFiscalConfig,
  receptor: ReceptorFiscalInput,
): string[] {
  const errores: string[] = []
  const nit = (receptor.nit ?? '').trim()
  const rfc = (receptor.rfc ?? '').trim()

  if (regimen === 'fel_gt') {
    if (nit && !validarNitGt(nit, { permitirCF: true })) {
      errores.push('NIT inválido (Guatemala). Verifique el dígito verificador o use "CF".')
    }
  } else if (regimen === 'cfdi_mx') {
    if (rfc && !validarRfcMx(rfc)) {
      errores.push('RFC inválido (México). Verifique el formato (ej. XAXX010101000).')
    }
  }
  return errores
}
