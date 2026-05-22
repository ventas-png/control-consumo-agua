import emailjs from '@emailjs/browser'
import type { Registro, Empresa, Ruta } from '../types'
import { APP_CONFIG } from './config'
import { generarReciboPDFBase64 } from './pdf'
import { supabase } from './supabase'

export function initEmailJS(): void {
  emailjs.init(APP_CONFIG.EMAILJS_PUBLIC_KEY)
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

async function getAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ''
}

// Check if the company has Gmail configured and return the company_id to use with send-email
async function getGmailConfig(companyId: string | undefined): Promise<{ configured: boolean; company_id: string | null }> {
  if (!companyId) return { configured: false, company_id: null }
  const { data } = await supabase
    .from('company_email_configs')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle()
  return { configured: !!data, company_id: companyId }
}

async function sendViaGmailApi(
  companyId: string,
  templateKey: string,
  toEmail: string,
  toName: string,
  vars: Record<string, string>
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
    const err = await res.json() as { error?: string }
    throw new Error(err.error ?? 'send-email function failed')
  }
}

export async function enviarReciboEmail(
  email: string,
  registro: Registro,
  empresa: Empresa,
  moneda = ''
): Promise<void> {
  const gmailConfig = await getGmailConfig(empresa.id)

  if (gmailConfig.configured && gmailConfig.company_id) {
    await sendViaGmailApi(
      gmailConfig.company_id,
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
        mes: registro.mes ?? '',
        moneda,
      }
    )
    return
  }

  // Fallback: EmailJS
  const fullDataUrl = registro.foto
  let base64DataFoto: string | null = null
  let fileExtension = 'jpg'

  if (fullDataUrl) {
    const parts = fullDataUrl.split(',')
    if (parts.length === 2) {
      base64DataFoto = parts[1]
      const mimePart = parts[0].match(/:(.*?);/)
      if (mimePart?.[1]) {
        const mimeType = mimePart[1]
        if (mimeType.includes('png')) fileExtension = 'png'
        else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) fileExtension = 'jpg'
        else if (mimeType.includes('heic')) fileExtension = 'heic'
      }
    }
  }

  const adjunto_final = base64DataFoto
    ? `Foto_Medidor_${registro.cliente_nombre.replace(/\s/g, '_')}_${Date.now()}.${fileExtension}|${base64DataFoto}`
    : null

  const pdfBase64Data = generarReciboPDFBase64(registro, empresa)
  const pdf_adjunto_final = pdfBase64Data
    ? `Recibo_${registro.cliente_nombre.replace(/\s/g, '_')}_${Date.now()}.pdf|${pdfBase64Data}`
    : null

  const params = {
    to_email: email,
    nombre_cliente: registro.cliente_nombre,
    lectura_actual: registro.lectura_actual,
    lectura_anterior: registro.lectura_anterior,
    consumo: registro.consumo,
    total_pagar: registro.monto_calculado.toFixed(2),
    fecha: new Date().toLocaleDateString(),
    nombre_empresa: empresa.nombre ?? 'Control de Consumo de Agua',
    tipo_cobro: registro.tipo_cobro,
    foto_adjunta: adjunto_final,
    pdf_adjunto: pdf_adjunto_final,
  }

  await emailjs.send(APP_CONFIG.EMAILJS_SERVICE_ID, APP_CONFIG.EMAILJS_TEMPLATE_RECIBO, params)
}

export async function enviarNotificacionRuta(ruta: Ruta, companyId?: string): Promise<void> {
  if (!ruta.asignado_email) return

  const gmailConfig = await getGmailConfig(companyId)

  if (gmailConfig.configured && gmailConfig.company_id) {
    await sendViaGmailApi(
      gmailConfig.company_id,
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
      }
    )
    return
  }

  // Fallback: EmailJS
  const params = {
    to_email: ruta.asignado_email,
    to_name: ruta.asignado_nombre ?? ruta.asignado_email,
    ruta_nombre: ruta.nombre,
    ruta_descripcion: ruta.descripcion ?? '',
    fecha_programada: ruta.fecha_programada ?? 'Sin fecha definida',
    total_clientes: String(ruta.cliente_ids.length),
  }
  await emailjs.send(APP_CONFIG.EMAILJS_SERVICE_ID, APP_CONFIG.EMAILJS_TEMPLATE_RUTA_ASIGNADA, params)
}

export interface BroadcastEmailResult {
  sent: string[]
  failed: { email: string; error: string }[]
}

export async function enviarComunicadoBroadcast(
  clientes: { id: string; email: string; nombre: string }[],
  broadcast: { title: string; body: string; sent_by_name: string },
  companyId?: string
): Promise<BroadcastEmailResult> {
  const sent: string[] = []
  const failed: { email: string; error: string }[] = []

  const gmailConfig = await getGmailConfig(companyId)

  for (const cliente of clientes) {
    if (!cliente.email) continue
    try {
      if (gmailConfig.configured && gmailConfig.company_id) {
        await sendViaGmailApi(
          gmailConfig.company_id,
          'difusion',
          cliente.email,
          cliente.nombre,
          {
            to_name: cliente.nombre,
            subject: broadcast.title,
            message: broadcast.body,
            from_name: broadcast.sent_by_name,
            empresa_nombre: 'Control de Consumo de Agua',
          }
        )
      } else {
        await emailjs.send(APP_CONFIG.EMAILJS_SERVICE_ID, APP_CONFIG.EMAILJS_TEMPLATE_DIFUSION, {
          to_email: cliente.email,
          to_name: cliente.nombre,
          subject: broadcast.title,
          message: broadcast.body,
          from_name: broadcast.sent_by_name,
        })
      }
      sent.push(cliente.email)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ email: cliente.email, error: msg })
    }
  }

  return { sent, failed }
}

// Send a custom email from the superadmin to a company
export async function enviarNotificacionSuperAdmin(
  toEmail: string,
  toName: string,
  templateKey: 'bienvenida_empresa' | 'notificacion_empresa',
  vars: Record<string, string>
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
    const err = await res.json() as { error?: string }
    throw new Error(err.error ?? 'send-email function failed')
  }
}
