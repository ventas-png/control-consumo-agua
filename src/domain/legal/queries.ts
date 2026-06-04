// plat:P33 — Hooks de LECTURA del dominio "legal".
//
// Lee el estado legal del usuario vía la RPC SECURITY DEFINER get_legal_status
// (acotada por auth.uid(); ver migración 20260604260000): documentos vigentes
// aplicables + si el usuario ya aceptó la versión vigente. Convención de
// src/domain/README.md.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { legalKeys } from './keys'

export type LegalDocType = 'tos' | 'privacy' | 'dpa'
export type LegalAudience = 'user' | 'company'

/** Una fila de get_legal_status(): documento vigente + estado de aceptación. */
export interface LegalDocStatus {
  doc_type: LegalDocType
  version: string
  title: string
  url: string | null
  summary: string | null
  audience: LegalAudience
  accepted: boolean
  accepted_at: string | null
}

/**
 * Documentos legales vigentes aplicables al usuario actual y si ya los aceptó.
 * La RPC ya los acota a auth.uid() y filtra el DPA a owner/admin. `.rpc(...)` se
 * tipa laxo sin tipos generados, así que se castea — mismo patrón que sesiones.
 */
export function useLegalStatusQuery(enabled = true) {
  return useQuery<LegalDocStatus[]>({
    queryKey: legalKeys.status(),
    queryFn: async () =>
      ((await runQuery((signal) =>
        supabase.rpc('get_legal_status').abortSignal(signal))) ?? []) as unknown as LegalDocStatus[],
    enabled,
  })
}
