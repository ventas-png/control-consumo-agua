import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

export interface NotifyPackageResult {
  success?: boolean
  notified?: number
  emailed?: number
  whatsapp?: 'sent' | 'not_configured' | 'error'
  skipped?: string
  error?: string
}

// Dispara el aviso al residente (in-app + correo + WhatsApp) vía la edge function
// notify-package, autenticando con el JWT del usuario actual. El llamador debe
// envolverlo en try/catch: un fallo del aviso no debe romper el registro.
export async function notifyPackage(paqueteId: string): Promise<NotifyPackageResult> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''
  const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-package`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ paquete_id: paqueteId }),
  })
  const json = await res.json().catch(() => ({})) as NotifyPackageResult
  if (!res.ok) throw new Error(json.error ?? 'No se pudo enviar el aviso')
  return json
}
