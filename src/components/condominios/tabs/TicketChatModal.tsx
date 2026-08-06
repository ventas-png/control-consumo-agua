// Conversación de un ticket de mantenimiento entre el residente y el equipo.
// La UI del hilo es <ConversacionModal>; acá vive solo lo propio del ticket:
// qué se lee/escribe (comentarios_ticket) y el cambio de estado del staff.
//   * residente → PortalMisTicketsTab (toca una solicitud de su lista).
//   * staff     → MantenimientoTab (botón 💬 del ticket).
import { useState } from 'react'
import { ConversacionModal, type EnvioHilo } from '../../shared/ConversacionModal'
import { notify } from '../../shared/Dialog'
import { fetchComentariosTicket } from '../../../domain/condominios/tabQueries'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ComentarioTicket, EstadoTicket, TicketMantenimiento } from '../../../types'

interface Props {
  ticket: TicketMantenimiento
  companyId: string
  /** Nombre que firma los mensajes enviados desde este modal. */
  autorNombre: string
  /** auth user id del autor: sus mensajes van a la derecha. */
  autorUserId?: string
  /** false → hilo de solo lectura (sin caja de mensaje). */
  canWrite?: boolean
  /** Staff: habilita cambio de estado con el mensaje y notas internas. */
  esStaff?: boolean
  onClose: () => void
  /** Se llama solo si el mensaje cambió el estado del ticket. */
  onRefresh?: () => void
}

const ESTADO_LABEL: Record<string, string> = {
  abierto: 'Abierto',
  en_proceso: 'En proceso',
  resuelto: 'Resuelto',
  cerrado: 'Cerrado',
}

const ESTADO_TONO: Record<string, { bg: string; color: string }> = {
  abierto:    { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  en_proceso: { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  resuelto:   { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  cerrado:    { bg: 'var(--at-chip)',         color: 'var(--at-ink-3)' },
}

const ESTADOS: EstadoTicket[] = ['abierto', 'en_proceso', 'resuelto', 'cerrado']

function tono(estado: string) {
  return ESTADO_TONO[estado] ?? ESTADO_TONO.abierto
}

export function TicketChatModal({
  ticket, companyId, autorNombre, autorUserId,
  canWrite = true, esStaff = false, onClose, onRefresh,
}: Props) {
  const [estadoNuevo, setEstado] = useState<'' | EstadoTicket>('')

  async function cargar(): Promise<ComentarioTicket[]> {
    return fetchComentariosTicket<ComentarioTicket>(ticket.id)
  }

  async function enviar({ contenido, fotos, archivos, interno }: EnvioHilo): Promise<string | null> {
    const cambiaEstado = esStaff && estadoNuevo && estadoNuevo !== ticket.estado
    const { error } = await createCondominioRow('comentarios_ticket', {
      company_id: companyId,
      ticket_id: ticket.id,
      autor_nombre: autorNombre.trim() || 'Residente',
      contenido,
      foto_urls: fotos,
      archivo_urls: archivos,
      // Solo el staff registra cambios de estado / notas internas: RLS rechaza
      // ambos en la rama del residente, así que ni se envían.
      estado_nuevo: cambiaEstado ? estadoNuevo : null,
      es_interno: interno,
    })
    if (error) return error.message
    if (cambiaEstado) {
      const patch: Record<string, unknown> = { estado: estadoNuevo }
      if (estadoNuevo === 'cerrado') patch.fecha_cierre = new Date().toISOString()
      const { error: eEstado } = await updateCondominioRow('tickets_mantenimiento', ticket.id, patch)
      if (eEstado) notify({ variant: 'error', title: 'Mensaje enviado, estado sin cambiar', text: eEstado.message })
      else { setEstado(''); onRefresh?.() }
    }
    return null
  }

  const t = tono(ticket.estado)

  return (
    <ConversacionModal
      titulo={ticket.titulo}
      subtitulo={
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: t.bg, color: t.color }}>
            {ESTADO_LABEL[ticket.estado] ?? ticket.estado}
          </span>
          <span>Reportado el {new Date(ticket.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </span>
      }
      original={{
        etiqueta: 'Reporte original',
        texto: ticket.descripcion || 'Sin descripción.',
        fotos: ticket.foto_urls ?? [],
        archivos: ticket.archivo_urls ?? [],
      }}
      cargar={cargar}
      enviar={enviar}
      etiquetaMensaje={m => m.estado_nuevo
        ? { texto: `→ ${ESTADO_LABEL[m.estado_nuevo] ?? m.estado_nuevo}`, ...tono(m.estado_nuevo) }
        : null}
      controlesStaff={
        <select
          value={estadoNuevo}
          onChange={e => setEstado(e.target.value as '' | EstadoTicket)}
          aria-label="Cambiar estado del ticket"
          style={{ flex: 1, minWidth: 180, padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13, background: 'var(--at-surface)' }}>
          <option value="">Sin cambio de estado</option>
          {ESTADOS.filter(e => e !== ticket.estado).map(e => (
            <option key={e} value={e}>→ {ESTADO_LABEL[e]}</option>
          ))}
        </select>
      }
      autorUserId={autorUserId}
      canWrite={canWrite}
      esStaff={esStaff}
      placeholder={esStaff ? 'Responda al residente…' : 'Escriba un mensaje al equipo…'}
      folder="tickets"
      onClose={onClose}
    />
  )
}
