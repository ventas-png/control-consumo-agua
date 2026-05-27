import type { Registro, Empresa, Ruta } from '../types'
import { supabase } from './supabase'

// Cliente sin secretos: todos los envíos de email pasan por la edge function
// `send-email` (Gmail API por tenant) o, si llegamos a tener otro provider,
// por su correspondiente edge function. EmailJS fue eliminado en F2.1 porque
// su "public key" viaja en el bundle del navegador y un atacante podía
// reutilizarla para enviar correos con la cuenta del tenant (riesgo: spam,
// blacklist del dominio, factura inflada).
//
// Cada función envía solo si la empresa tiene Gmail configurado. Si no hay
// configuración, la función lanza un error claro indicando que el admin del
// tenant debe configurar Gmail en `/empresa` (Integraciones → Google Email).
// Esto deja el flujo a la vista del usuario en lugar de fallar en silencio.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

const NO_EMAIL_CONFIGURED_MSG =
  'Esta empresa no tiene Gmail conectado todavía. Pídele a un admin que lo configure en ' +
  'Empresa → Integraciones → Google Email para habilitar el envío de correos.'

async function getAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ''
}

// True si la empresa tiene Gmail conectado (config activa). Sin company_id no
// hay envío posible: probablemente el caller no tiene tenant cargado todavía.
async function hasGmailConfigured(companyId: string | undefined): Promise<boolean> {
  if (!companyId) return false
  const { data } = await supabase
    .from('company_email_configs')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle()
  return !!data
}

async function sendViaGmailApi(
  companyId: string,
  templateKey: string,
  toEmail: string,
  toName: string,
  vars: Record<string, string>,
): Promise<void> {
  const token = await getAuthToken()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      company_id: companyId,
      template_key: templateKey,
      to_email: toEmail,
      to_name: toName,
      vars,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'send-email function failed')
  }
}

export async function enviarReciboEmail(
  email: string,
  registro: Registro,
  empresa: Empresa,
): Promise<void> {
  if (!await hasGmailConfigured(empresa.id)) {
    throw new Error(NO_EMAIL_CONFIGURED_MSG)
  }
  await sendViaGmailApi(
    empresa.id!,
    'recibo',
    email,
    registro.cliente_nombre,
    {
      empresa_nombre: empresa.nombre ?? 'Control de Consumo de Agua',
      empresa_logo: '',
      nombre_cliente: registro.cliente_nombre,
      lectura_actual: String(registro.lectura_actual),
      lectura_anterior: String(registro.lectura_anterior),
      consumo: String(registro.consumo),
      total_pagar: registro.monto_calculado.toFixed(2),
      fecha: new Date().toLocaleDateString('es-GT'),
      tipo_cobro: registro.tipo_cobro ?? '',
      moneda: '',
    },
  )
}

export async function enviarNotificacionRuta(ruta: Ruta, companyId?: string): Promise<void> {
  if (!ruta.asignado_email) return
  if (!await hasGmailConfigured(companyId)) {
    throw new Error(NO_EMAIL_CONFIGURED_MSG)
  }
  await sendViaGmailApi(
    companyId!,
    'ruta_asignada',
    ruta.asignado_email,
    ruta.asignado_nombre ?? ruta.asignado_email,
    {
      to_name: ruta.asignado_nombre ?? ruta.asignado_email,
      ruta_nombre: ruta.nombre,
      ruta_descripcion: ruta.descripcion ?? '',
      fecha_programada: ruta.fecha_programada ?? 'Sin fecha definida',
      total_clientes: String(ruta.cliente_ids.length),
      empresa_nombre: 'Control de Consumo de Agua',
    },
  )
}

// Dispara el recordatorio de una ruta (email + notificación in-app) vía el edge
// function route-reminders, autenticando con el JWT del administrador actual.
export async function dispararRecordatorioRuta(
  rutaId: string,
  ocurrenciaId?: string,
): Promise<{ processed: number; emailed: number; notified: number }> {
  const token = await getAuthToken()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/route-reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(ocurrenciaId ? { ocurrencia_id: ocurrenciaId } : { ruta_id: rutaId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'No se pudo enviar el recordatorio')
  }
  return res.json() as Promise<{ processed: number; emailed: number; notified: number }>
}

export interface BroadcastEmailResult {
  sent: string[]
  failed: { email: string; error: string }[]
}

export async function enviarComunicadoBroadcast(
  clientes: { id: string; email: string; nombre: string }[],
  broadcast: { title: string; body: string; sent_by_name: string },
  companyId?: string,
): Promise<BroadcastEmailResult> {
  const sent: string[] = []
  const failed: { email: string; error: string }[] = []

  if (!await hasGmailConfigured(companyId)) {
    // Marcamos todos como fallidos con la misma causa. El caller decide cómo
    // presentárselo al usuario (toast / modal con CTA "Configurar Gmail").
    return {
      sent,
      failed: clientes.filter(c => c.email).map(c => ({ email: c.email, error: NO_EMAIL_CONFIGURED_MSG })),
    }
  }

  for (const cliente of clientes) {
    if (!cliente.email) continue
    try {
      await sendViaGmailApi(
        companyId!,
        'difusion',
        cliente.email,
        cliente.nombre,
        {
          to_name: cliente.nombre,
          subject: broadcast.title,
          message: broadcast.body,
          from_name: broadcast.sent_by_name,
          empresa_nombre: 'Control de Consumo de Agua',
        },
      )
      sent.push(cliente.email)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ email: cliente.email, error: msg })
    }
  }

  return { sent, failed }
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  empresa: Empresa,
): Promise<void> {
  const resetLink = `${window.location.origin}${window.location.pathname}?reset_token=${token}`

  if (!await hasGmailConfigured(empresa.id)) {
    throw new Error(NO_EMAIL_CONFIGURED_MSG)
  }

  await sendViaGmailApi(
    empresa.id!,
    'password_reset',
    email,
    email,
    {
      empresa_nombre: empresa.nombre ?? 'Control de Consumo de Agua',
      empresa_logo: '',
      reset_link: resetLink,
      hora_expiracion: '1 hora',
    },
  )
}

// Email del super admin a una empresa (canal de plataforma, no de tenant).
// Usa la misma edge function con `is_superadmin: true` para que se envíe
// desde la cuenta SMTP global de la plataforma, no la del tenant target.
export async function enviarNotificacionSuperAdmin(
  toEmail: string,
  toName: string,
  templateKey: 'bienvenida_empresa' | 'notificacion_empresa',
  vars: Record<string, string>,
): Promise<void> {
  const token = await getAuthToken()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      is_superadmin: true,
      template_key: templateKey,
      to_email: toEmail,
      to_name: toName,
      vars,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'send-email function failed')
  }
}
