// T3 · plat:P10 — Hooks de ESCRITURA del dominio SSO.
//
// Toda escritura pasa por el edge `sso-admin` (deriva company_id de la sesión,
// exige owner/admin, gestiona SOLO la empresa del caller). El cliente NUNCA
// escribe directo company_id ni el proveedor SAML. Tras cada mutación se invalida
// la query de dominios del tenant para refrescar la UI.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ssoKeys } from './keys'
import type { SsoDomain } from './schemas'

/** Metadata IdP que sube el admin (subset persistible + sincronizable). */
export interface SsoIdpMetadataInput {
  metadata_url?: string
  metadata_xml?: string
  entity_id?: string
  acs_url?: string
  attribute_mapping?: Record<string, string>
}

/** Respuesta genérica del edge sso-admin. */
interface SsoAdminResponse {
  ok?: boolean
  error?: string
  domain?: SsoDomain
  parked?: boolean
  provider_id?: string | null
  message?: string
  verification?: {
    method: string
    record_name: string
    record_value: string
    verified: boolean
    note: string
  }
}

/** Invoca el edge sso-admin con una acción y devuelve la respuesta tipada. */
async function callSsoAdmin(body: Record<string, unknown>): Promise<SsoAdminResponse> {
  const { data, error } = await supabase.functions.invoke<SsoAdminResponse>('sso-admin', { body })
  if (error) throw new Error(error.message)
  if (data && data.ok === false) throw new Error(data.error ?? 'La operación de SSO falló.')
  return data ?? {}
}

/** Asocia un dominio a la empresa (el dominio es UNIQUE global). */
export function useUpsertSsoDomainMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (domain: string) => callSsoAdmin({ action: 'upsert_domain', domain }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ssoKeys.domains(companyId) }),
  })
}

/** Quita un dominio SSO de la empresa. */
export function useDeleteSsoDomainMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callSsoAdmin({ action: 'delete_domain', id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ssoKeys.domains(companyId) }),
  })
}

/** Activa/desactiva SSO obligatorio (el backend bloquea enforce sin verified). */
export function useSetSsoEnforcedMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; enforced: boolean }) =>
      callSsoAdmin({ action: 'set_enforced', id: vars.id, enforced: vars.enforced }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ssoKeys.domains(companyId) }),
  })
}

/** Inicia la verificación de propiedad: devuelve token + instrucciones DNS. */
export function useStartSsoVerificationMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callSsoAdmin({ action: 'start_verification', id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ssoKeys.domains(companyId) }),
  })
}

/**
 * Guarda la metadata del IdP e intenta sincronizar el proveedor SAML en GoTrue.
 * Si SSO no está habilitado en el proyecto, la respuesta trae `parked: true` y la
 * config queda persistida igualmente (handshake parqueado).
 */
export function useSaveSsoMetadataMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; metadata: SsoIdpMetadataInput }) =>
      callSsoAdmin({ action: 'save_metadata', id: vars.id, metadata: vars.metadata }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ssoKeys.domains(companyId) }),
  })
}
