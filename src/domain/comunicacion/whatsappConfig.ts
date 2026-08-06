// com — Config de WhatsApp Cloud API por tenant (bóveda deny-all
// company_whatsapp_configs). Espeja el patrón payfac (domain/cobros):
//   - useEstatusWhatsAppQuery       → RPC whatsapp_estatus (metadata, sin token).
//   - useGuardarCredencialesWhatsAppMutation → edge whatsapp-save-credentials.
//   - useProbarConexionWhatsAppMutation      → edge whatsapp-test-connection.
// El access_token JAMÁS se lee desde el cliente: la tabla es deny-all y el edge
// lo cifra al escribir; el estatus solo expone `tiene_token`.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { db, supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { comunicacionKeys } from './keys'

export interface WhatsAppEstatus {
  id: string
  company_id: string
  provider: string
  phone_number_id: string
  template_default: string | null
  template_lang: string | null
  is_active: boolean
  estado_conexion: 'desconocido' | 'ok' | 'error'
  estado_mensaje: string | null
  estado_probado_en: string | null
  tiene_token: boolean
  created_at: string | null
  updated_at: string | null
}

/**
 * Estatus (NO sensible) de la config de WhatsApp del tenant vía la RPC
 * whatsapp_estatus (SECURITY DEFINER, fail-closed a admin/owner). Devuelve 0 o 1
 * fila (UNIQUE por company_id). NUNCA proyecta el access_token.
 */
export function useEstatusWhatsAppQuery(companyId?: string) {
  return useQuery<WhatsAppEstatus | null>({
    queryKey: comunicacionKeys.whatsappEstatus(companyId),
    queryFn: async () => {
      const rows =
        (await runQuery((signal) =>
          db.rpc('whatsapp_estatus', { p_company_id: companyId! }).abortSignal(signal),
        )) ?? []
      const r = rows[0]
      if (!r) return null
      return { ...r, estado_conexion: r.estado_conexion as WhatsAppEstatus['estado_conexion'] }
    },
    enabled: !!companyId,
  })
}

export interface GuardarCredencialesWhatsAppVars {
  companyId?: string
  phoneNumberId: string
  accessToken: string
  templateDefault?: string | null
  templateLang?: string | null
  isActive?: boolean
}

/** Respuesta del edge whatsapp-save-credentials (SOLO flags, jamás el token). */
export interface GuardarCredencialesWhatsAppResult {
  ok?: boolean
  company_id?: string
  provider?: string
  phone_number_id?: string
  tiene_token?: boolean
  estado_conexion?: string
  error?: string
}

/**
 * Guarda las credenciales de WhatsApp vía el edge `whatsapp-save-credentials`
 * (la bóveda es deny-all: el cliente NUNCA escribe el token directo). Tras
 * guardar invalida el estatus (estado_conexion vuelve a 'desconocido').
 */
export function useGuardarCredencialesWhatsAppMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: GuardarCredencialesWhatsAppVars): Promise<GuardarCredencialesWhatsAppResult> => {
      const { data, error } = await supabase.functions.invoke<GuardarCredencialesWhatsAppResult>(
        'whatsapp-save-credentials',
        {
          body: {
            ...(vars.companyId ? { company_id: vars.companyId } : {}),
            phone_number_id: vars.phoneNumberId,
            access_token: vars.accessToken,
            template_default: vars.templateDefault ?? null,
            template_lang: vars.templateLang ?? null,
            ...(vars.isActive !== undefined ? { is_active: vars.isActive } : {}),
          },
        },
      )
      if (error) throw new Error(error.message)
      if (data && data.ok === false) throw new Error(data.error ?? 'No se pudieron guardar las credenciales.')
      return data ?? {}
    },
    onSuccess: () => {
      if (companyId) void qc.invalidateQueries({ queryKey: comunicacionKeys.whatsappEstatus(companyId) })
    },
  })
}

/** Respuesta del edge whatsapp-test-connection. */
export interface ProbarConexionWhatsAppResult {
  ok?: boolean
  estado_conexion?: 'ok' | 'error'
  estado_mensaje?: string
  error?: string
}

/**
 * Prueba la conexión con Meta vía el edge `whatsapp-test-connection` (GET no
 * destructivo del phone_number_id). El edge persiste el estatus; refrescamos.
 */
export function useProbarConexionWhatsAppMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { companyId?: string }): Promise<ProbarConexionWhatsAppResult> => {
      const { data, error } = await supabase.functions.invoke<ProbarConexionWhatsAppResult>(
        'whatsapp-test-connection',
        { body: { ...(vars.companyId ? { company_id: vars.companyId } : {}) } },
      )
      if (error) throw new Error(error.message)
      return data ?? {}
    },
    onSuccess: () => {
      if (companyId) void qc.invalidateQueries({ queryKey: comunicacionKeys.whatsappEstatus(companyId) })
    },
  })
}
