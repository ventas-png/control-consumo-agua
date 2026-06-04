// plat:P33 — Hooks de ESCRITURA del dominio "legal".
//
// Registra la aceptación de la versión vigente de un documento legal vía la RPC
// SECURITY DEFINER record_legal_acceptance (acotada por auth.uid()). Tras éxito
// invalida el estado legal. Convención de src/domain/README.md.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { legalKeys } from './keys'
import type { LegalDocType } from './queries'

/** Acepta la versión vigente del documento legal indicado para el usuario actual. */
export function useAceptarLegalMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (docType: LegalDocType) => {
      const { error } = await supabase.rpc('record_legal_acceptance', {
        p_doc_type: docType,
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: legalKeys.status() })
    },
  })
}
