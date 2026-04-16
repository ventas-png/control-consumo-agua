import emailjs from '@emailjs/browser'
import type { Registro, Empresa, Ruta } from '../types'
import { APP_CONFIG } from './config'
import { generarReciboPDFBase64 } from './pdf'

export function initEmailJS(): void {
  emailjs.init(APP_CONFIG.EMAILJS_PUBLIC_KEY)
}

export async function enviarReciboEmail(
  email: string,
  registro: Registro,
  empresa: Empresa
): Promise<void> {
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

export async function enviarNotificacionRuta(ruta: Ruta): Promise<void> {
  if (!ruta.asignado_email) return
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
  broadcast: { title: string; body: string; sent_by_name: string }
): Promise<BroadcastEmailResult> {
  const sent: string[] = []
  const failed: { email: string; error: string }[] = []

  for (const cliente of clientes) {
    if (!cliente.email) continue
    try {
      await emailjs.send(APP_CONFIG.EMAILJS_SERVICE_ID, APP_CONFIG.EMAILJS_TEMPLATE_DIFUSION, {
        to_email: cliente.email,
        to_name: cliente.nombre,
        subject: broadcast.title,
        message: broadcast.body,
        from_name: broadcast.sent_by_name,
      })
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
  empresa: Empresa
): Promise<void> {
  const resetLink = `${window.location.origin}${window.location.pathname}?reset_token=${token}`
  const params = {
    to_email: email,
    reset_link: resetLink,
    empresa_nombre: empresa.nombre ?? 'Control de Consumo de Agua',
    hora_expiracion: '1 hora',
  }
  await emailjs.send(
    APP_CONFIG.EMAILJS_SERVICE_ID,
    APP_CONFIG.EMAILJS_TEMPLATE_PASSWORD_RESET,
    params
  )
}
