// plat:P20 — Hooks de LECTURA del dominio "branding".
//
// Lee company_branding del tenant (RLS: miembros de la empresa). Convención de
// src/domain/README.md.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { brandingKeys } from './keys'

export interface CompanyBrandingRow {
  company_id: string
  primary_color: string | null
  updated_at?: string | null
  created_at?: string | null
}

/** Branding de la empresa (o null si no hay configurado). */
export function useBrandingQuery(companyId?: string) {
  return useQuery<CompanyBrandingRow | null>({
    queryKey: brandingKeys.company(companyId),
    queryFn: async () => {
      const rows = (await runQuery<CompanyBrandingRow[]>((signal) =>
        supabase.from('company_branding').select('*').eq('company_id', companyId!).abortSignal(signal))) ?? []
      return rows[0] ?? null
    },
    enabled: !!companyId,
  })
}
