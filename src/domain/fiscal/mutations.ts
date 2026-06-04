// serv:S11 · Núcleo fiscal FEL/CFDI — Hooks de ESCRITURA (timbrado).
//
// Dispara el TIMBRADO de una Factura (registro) invocando el edge
// `timbrar-documento` (provider-agnostic; hoy contra el Sandbox, sin PAC real) e
// invalida las query keys de `documentos_fiscales` para que el badge/estatus de
// la UI de cobros se refresque.
//
// FUENTE DE VERDAD de la máquina de estados fiscal: `src/lib/businessFiscal.ts`
// (puro). Aquí solo CONSUMIMOS `puedeTimbrar`/`normalizarEstadoFiscal` para el
// gate defensivo antes de tocar la red — NO se duplica ni se reimplementa la
// lógica de transición. El edge vuelve a validar la transición del lado servidor
// (idempotencia: solo timbra documentos en `por_timbrar`); este gate es UX +
// defense-in-depth, no la autoridad.
//
// Separación de responsabilidades (igual que facturacion/mutations.ts):
//   - keys.ts / queries.ts → LECTURA (no se tocan aquí, solo se consumen).
//   - mutations.ts (este archivo) → ESCRITURA + invalidación.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { fiscalKeys } from './keys'
import {
  normalizarEstadoFiscal,
  puedeTransicionarFiscal,
} from '../../lib/businessFiscal'
import type {
  EstadoFiscal,
  RegimenFiscalConfig,
} from '../../types/fiscal'

// ════════════════════════════════════════════════════════════════════════════
// Helpers PUROS (testeables sin Supabase) — gating del botón "Timbrar".
// ════════════════════════════════════════════════════════════════════════════

/**
 * ¿Se puede disparar el timbrado para una Factura dado el estado del ÚLTIMO
 * documento fiscal asociado (o `null`/`undefined` si aún no existe ninguno)?
 *
 * El edge `timbrar-documento` CREA el documento en `por_timbrar` y lo timbra en
 * una sola llamada, así que el gate no es exactamente `puedeTimbrar(estado)` (que
 * exige `por_timbrar`): razona sobre el último documento del registro:
 *
 *   - sin documento (null) → timbrable (primer intento).
 *   - 'rechazado'          → timbrable (reintento: el edge crea uno nuevo).
 *   - 'por_timbrar'        → NO (ya hay uno encolado/en vuelo; evita duplicar).
 *   - 'timbrado'           → NO (ya certificado; no re-timbrar).
 *   - 'cancelado'          → NO (terminal).
 *
 * Determinista y sin I/O para poder testearlo en aislamiento.
 */
export function puedeDispararTimbrado(
  estadoUltimoDoc: string | null | undefined,
): boolean {
  if (estadoUltimoDoc == null) return true
  const estado = normalizarEstadoFiscal(estadoUltimoDoc)
  // 'rechazado' admite 'reintentar' en la máquina → es re-timbrable.
  return estado === 'rechazado' || puedeTransicionarFiscal(estado, 'reintentar').ok
}

/** Error lanzado ANTES de tocar la red cuando el documento no es timbrable. */
export class TimbradoNoPermitidoError extends Error {
  readonly estadoActual: EstadoFiscal | null
  constructor(estadoActual: EstadoFiscal | null, mensaje?: string) {
    super(
      mensaje ??
        `No se puede timbrar: el comprobante está en estado "${estadoActual ?? 'desconocido'}".`,
    )
    this.name = 'TimbradoNoPermitidoError'
    this.estadoActual = estadoActual
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Mutación · TIMBRAR un comprobante (invoca el edge `timbrar-documento`).
// ════════════════════════════════════════════════════════════════════════════

/** Respuesta normalizada del edge `timbrar-documento` (caso éxito o rechazo). */
export interface TimbrarDocumentoResult {
  ok?: boolean
  documento_id?: string
  estado?: EstadoFiscal
  uuid_fiscal?: string | null
  serie?: string | null
  numero?: string | null
  proveedor?: string | null
  error?: string
  detalles?: string[]
}

export interface TimbrarDocumentoVars {
  /** Factura (registros.id) a timbrar. */
  registroId: string
  /**
   * Estado del ÚLTIMO documento fiscal del registro, si ya existe alguno. Se usa
   * para el gate defensivo (evita re-timbrar / duplicar). `null`/omitido = no hay
   * documento todavía (primer intento, permitido).
   */
  estadoUltimoDoc?: string | null
  /** Tipo de comprobante (default 'factura'). Reservado para follow-up. */
  tipo?: string
}

/**
 * Dispara el timbrado de una Factura. Gate defensivo con la máquina de estados
 * ANTES de la red; luego `supabase.functions.invoke('timbrar-documento')`. Tras
 * la respuesta invalida las keys de `documentos_fiscales` (raíz del dominio +
 * scope company/registro) para refrescar el badge de estatus.
 *
 * `companyId` se usa solo para acotar la invalidación a las vistas del tenant.
 */
export function useTimbrarDocumentoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      registroId,
      estadoUltimoDoc,
      tipo,
    }: TimbrarDocumentoVars): Promise<TimbrarDocumentoResult> => {
      // Gate defensivo: la UI ya oculta el botón, pero revalidamos antes del
      // invoke. El edge vuelve a validar del lado servidor (autoridad real).
      if (!puedeDispararTimbrado(estadoUltimoDoc)) {
        throw new TimbradoNoPermitidoError(normalizarEstadoFiscal(estadoUltimoDoc))
      }

      const { data, error } = await supabase.functions.invoke<TimbrarDocumentoResult>(
        'timbrar-documento',
        { body: { registro_id: registroId, ...(tipo ? { tipo } : {}) } },
      )
      if (error) throw new Error(error.message)
      // El edge devuelve 4xx/5xx con { error, detalles } en el cuerpo para
      // rechazos de negocio (DTE inválido, rechazo del PAC). functions.invoke no
      // siempre los eleva a `error`, así que también miramos el cuerpo.
      if (data && data.ok === false) {
        const detalle = data.detalles?.length ? ` (${data.detalles.join('; ')})` : ''
        throw new Error((data.error ?? 'El comprobante fue rechazado.') + detalle)
      }
      return data ?? {}
    },
    onSuccess: (_data, vars) => {
      // Refresca toda la lectura fiscal del tenant + la del registro concreto.
      void qc.invalidateQueries({ queryKey: fiscalKeys.all })
      if (companyId) void qc.invalidateQueries({ queryKey: fiscalKeys.documentos(companyId) })
      void qc.invalidateQueries({
        queryKey: fiscalKeys.documentosPorRegistro(vars.registroId),
      })
    },
  })
}

// ════════════════════════════════════════════════════════════════════════════
// Query · Régimen fiscal del tenant (companies.regimen_fiscal).
// ════════════════════════════════════════════════════════════════════════════
//
// La UI (form de cliente) necesita saber el régimen del emisor para mostrar el
// campo correcto del receptor (NIT en GT vs RFC + Uso CFDI en MX) y elegir el
// validador. Es una LECTURA de `companies`, pero vive aquí (no en queries.ts) por
// ownership: queries.ts es de #387 y no se toca. Es de scope company y de un solo
// campo, así que el acoplamiento es mínimo.

/**
 * Régimen fiscal del tenant. `'ninguno'` (default de la migración) cuando el
 * tenant aún no emite comprobante fiscal — la UI usa eso para no exigir
 * NIT/RFC ni mostrar campos fiscales del receptor.
 */
export function useRegimenFiscalQuery(companyId?: string) {
  return useQuery({
    queryKey: [...fiscalKeys.all, 'regimen', companyId ?? null] as const,
    queryFn: async (): Promise<RegimenFiscalConfig> => {
      const rows = await runQuery<{ regimen_fiscal: string | null }[]>((signal) =>
        supabase
          .from('companies')
          .select('regimen_fiscal')
          .eq('id', companyId!)
          .limit(1)
          .abortSignal(signal),
      )
      const r = rows?.[0]?.regimen_fiscal
      return r === 'fel_gt' || r === 'cfdi_mx' ? r : 'ninguno'
    },
    enabled: !!companyId,
  })
}
