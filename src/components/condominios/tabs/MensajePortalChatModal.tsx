// Conversación de un mensaje del residente a la administración. La UI del hilo
// es <ConversacionModal>; acá vive solo lo propio de `mensajes_portal`.
//   * residente → PortalMiUnidadTab, desde su tarjeta de mensaje.
//   * staff     → el mismo tab en modo admin: responde en el hilo (y al hacerlo
//                 marca el mensaje como respondido) o deja una nota interna.
//
// `respuesta`/`respondido_en` (la respuesta única anterior al hilo) siguen
// mostrándose en la tarjeta; las respuestas nuevas van todas acá.
import { ConversacionModal, type EnvioHilo } from '../../shared/ConversacionModal'
import { notify } from '../../shared/Dialog'
import { fetchComentariosMensajePortal } from '../../../domain/condominios/tabQueries'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ComentarioMensajePortal, MensajePortal } from '../../../types'

interface Props {
  mensaje: MensajePortal
  /** Nombre que firma los mensajes enviados desde este modal. */
  autorNombre: string
  /** auth user id del autor: sus mensajes van a la derecha. */
  autorUserId?: string
  /** false → hilo de solo lectura (sin caja de mensaje). */
  canWrite?: boolean
  /** Staff: habilita notas internas y marca el mensaje como respondido. */
  esStaff?: boolean
  onClose: () => void
  /** Se llama si el envío cambió el estado del mensaje. */
  onRefresh?: () => void
}

const TIPO_LABEL: Record<string, string> = {
  consulta: '💬 Consulta',
  queja: '😤 Queja',
  sugerencia: '💡 Sugerencia',
  emergencia: '🚨 Emergencia',
}

const ESTADO_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  nuevo:      { label: 'Nuevo',      bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  leido:      { label: 'Leído',      bg: 'var(--at-chip)',         color: 'var(--at-ink-3)' },
  respondido: { label: 'Respondido', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  cerrado:    { label: 'Cerrado',    bg: 'var(--at-chip)',         color: 'var(--at-ink-3)' },
}

export function MensajePortalChatModal({
  mensaje, autorNombre, autorUserId, canWrite = true, esStaff = false, onClose, onRefresh,
}: Props) {
  async function cargar(): Promise<ComentarioMensajePortal[]> {
    return fetchComentariosMensajePortal<ComentarioMensajePortal>(mensaje.id)
  }

  async function enviar({ contenido, fotos, archivos, interno }: EnvioHilo): Promise<string | null> {
    const { error } = await createCondominioRow('comentarios_mensaje_portal', {
      // El company_id tiene que ser el del mensaje: RLS lo exige en las dos
      // ramas, y el residente no tiene company propia.
      company_id: mensaje.company_id,
      mensaje_id: mensaje.id,
      autor_nombre: autorNombre.trim() || 'Residente',
      contenido,
      foto_urls: fotos,
      archivo_urls: archivos,
      es_interno: interno,
    })
    if (error) return error.message
    // Una respuesta visible del equipo cierra el pendiente; una nota interna no
    // (el residente no la ve, así que el mensaje sigue esperando respuesta).
    if (esStaff && !interno && mensaje.estado !== 'respondido' && mensaje.estado !== 'cerrado') {
      const { error: eEstado } = await updateCondominioRow('mensajes_portal', mensaje.id, {
        estado: 'respondido',
        respondido_en: new Date().toISOString(),
      })
      if (eEstado) notify({ variant: 'error', title: 'Mensaje enviado, estado sin cambiar', text: eEstado.message })
      else onRefresh?.()
    }
    return null
  }

  const ec = ESTADO_LABEL[mensaje.estado] ?? ESTADO_LABEL.nuevo

  return (
    <ConversacionModal
      titulo={mensaje.asunto}
      subtitulo={
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ec.bg, color: ec.color }}>
            {ec.label}
          </span>
          <span>{TIPO_LABEL[mensaje.tipo] ?? mensaje.tipo}</span>
          <span>· Enviado el {new Date(mensaje.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </span>
      }
      original={{
        etiqueta: 'Mensaje original',
        // La respuesta única heredada se muestra como parte del original: es de
        // antes del hilo y no tiene autor ni fecha propios que pintar aparte.
        texto: mensaje.respuesta
          ? `${mensaje.cuerpo}\n\n— Respuesta de administración —\n${mensaje.respuesta}`
          : mensaje.cuerpo,
        fotos: mensaje.foto_urls ?? [],
        archivos: mensaje.archivo_urls ?? [],
      }}
      cargar={cargar}
      enviar={enviar}
      autorUserId={autorUserId}
      canWrite={canWrite}
      esStaff={esStaff}
      placeholder={esStaff ? 'Responda al residente…' : 'Escriba a la administración…'}
      folder="mensajes-portal"
      onClose={onClose}
    />
  )
}
