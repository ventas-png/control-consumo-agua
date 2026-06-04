// plat:P20 — Hooks de ESCRITURA del dominio "branding".
//
// Upsert del color de marca. RLS exige owner/admin del propio tenant (o
// super_admin). Tras éxito invalida la key del branding de la empresa.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { brandingKeys } from './keys'

export interface GuardarBrandingVars {
  companyId: string
  /** Hex #rrggbb, o null para restablecer el tema por defecto. */
  primaryColor: string | null
}

export function useGuardarBrandingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: GuardarBrandingVars) => {
      const { error } = await supabase
        .from('company_branding')
        .upsert({ company_id: vars.companyId, primary_color: vars.primaryColor }, { onConflict: 'company_id' })
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: brandingKeys.company(vars.companyId) })
    },
  })
}
