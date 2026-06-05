// T3 · plat:P10 — Hooks/funciones de LECTURA del dominio SSO.
//
//   - `useSsoDomainsQuery(companyId)`: dominios SSO del tenant para la UI admin.
//     RLS los acota a owner/admin de ESA empresa (defensa primaria); igual
//     replicamos `.eq('company_id', cid)` como defense-in-depth.
//   - `lookupSsoDomain(domain)`: descubrimiento PRE-login (sin sesión) vía la RPC
//     anon-callable `sso_lookup_domain`. Función async PURA respecto al estado de
//     React (la usa también src/lib/sso.ts). Devuelve el resultado NORMALIZADO.
//   - `useSsoLookupQuery(domain)`: envoltorio react-query de lo anterior.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { ssoKeys } from './keys'
import { parseSsoLookup, type SsoDomain, type SsoLookupResult, SSO_LOOKUP_NONE } from './schemas'

/** Dominios SSO de un tenant (RLS: owner/admin de ESA empresa). */
export function useSsoDomainsQuery(companyId?: string) {
  return useQuery<SsoDomain[]>({
    queryKey: ssoKeys.domains(companyId),
    queryFn: async () =>
      (await runQuery<SsoDomain[]>((signal) =>
        supabase
          .from('company_sso_domains')
          .select('*')
          .eq('company_id', companyId!)
          .order('created_at', { ascending: true })
          .abortSignal(signal),
      )) ?? [],
    enabled: !!companyId,
  })
}

/**
 * Descubrimiento PRE-login: ¿este dominio usa SSO? Llama la RPC anon-callable
 * `sso_lookup_domain` y normaliza el resultado. FALLBACK GRACEFUL: ante dominio
 * vacío o cualquier error (incl. SSO no habilitado en el proyecto), devuelve
 * SSO_LOOKUP_NONE → el login se comporta como hoy (password).
 */
export async function lookupSsoDomain(domain: string): Promise<SsoLookupResult> {
  const d = (domain ?? '').trim().toLowerCase()
  if (!d) return SSO_LOOKUP_NONE
  try {
    const rows = await runQuery<unknown[]>((signal) =>
      supabase.rpc('sso_lookup_domain', { p_domain: d }).abortSignal(signal),
    )
    return parseSsoLookup(rows)
  } catch {
    // No romper el login si la RPC no existe / SSO no habilitado / red caída.
    return SSO_LOOKUP_NONE
  }
}

/** Envoltorio react-query del descubrimiento PRE-login (opcional). */
export function useSsoLookupQuery(domain?: string, enabled = true) {
  return useQuery<SsoLookupResult>({
    queryKey: ssoKeys.lookup(domain),
    queryFn: () => lookupSsoDomain(domain ?? ''),
    enabled: enabled && !!(domain ?? '').trim(),
    staleTime: 60_000,
  })
}
