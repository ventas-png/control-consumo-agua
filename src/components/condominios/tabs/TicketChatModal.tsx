// Conversación de un ticket de mantenimiento: hilo tipo chat entre el residente
// y el equipo del condominio, con fotos adjuntas por mensaje.
//
// Un solo componente para los dos lados (`esStaff` cambia lo que se puede hacer,
// no lo que se ve) para que ambos lean el MISMO hilo — si el portal y el panel
// tuvieran cada uno su visor, se separarían a la primera corrección.
//   * residente → PortalMisTicketsTab (toca una solicitud de su lista).
//   * staff     → MantenimientoTab (botón 💬 del ticket): además puede cambiar el
//                 estado con el mensaje y marcarlo como nota interna.
//
// Carga su propio hilo (no llega por props): el modal se monta bajo demanda para
// UN ticket, así que la lectura vive donde se usa y se refresca sola al enviar.
import { useCallback, useEffect, useRef, useState } from 'react'
import { EditModal } from '../../shared/EditModal'
import { ImageGallery } from '../../shared/ImageGallery'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { notify } from '../../shared/Dialog'
import { fetchComentariosTicket } from '../../../domain/condominios/tabQueries'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ComentarioTicket, EstadoTicket, TicketMantenimiento } from '../../../types'

interface Props {
  ticket: TicketMantenimiento
  companyId: string
  /** Nombre que firma los mensajes enviados desde este modal. */
  autorNombre: string
  /**
   * auth user id del autor. Los mensajes con `creado_por` igual se pintan como
   * propios (burbuja a la derecha). Las filas anteriores al sellado de
   * trazabilidad no lo tienen y caen del lado del interlocutor.
   */
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

function horaCorta(iso: string) {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function TicketChatModal({
  ticket, companyId, autorNombre, autorUserId,
  canWrite = true, esStaff = false, onClose, onRefresh,
}: Props) {
  const [mensajes, setMensajes]   = useState<ComentarioTicket[]>([])
  const [cargando, setCargando]   = useState(true)
  const [texto, setTexto]         = useState('')
  const [fotos, setFotos]         = useState<string[]>([])
  const [estadoNuevo, setEstado]  = useState<'' | EstadoTicket>('')
  const [interno, setInterno]     = useState(false)
  const [enviando, setEnviando]   = useState(false)
  const finRef = useRef<HTMLDivElement>(null)

  const cargar = useCallback(async () => {
    const filas = await fetchComentariosTicket<ComentarioTicket>(ticket.id)
    setMensajes(filas)
    setCargando(false)
  }, [ticket.id])

  useEffect(() => { void cargar() }, [cargar])

  // Chat: al abrir y tras enviar se mira el final del hilo, no el principio.
  // `?.()` porque jsdom no implementa scrollIntoView (y el modal se testea).
  useEffect(() => {
    finRef.current?.scrollIntoView?.({ block: 'end' })
  }, [mensajes.length])

  async function enviar() {
    const contenido = texto.trim()
    if (!contenido && fotos.length === 0) {
      notify({ variant: 'warning', title: 'Mensaje vacío', text: 'Escriba un mensaje o adjunte una foto.' })
      return
    }
    setEnviando(true)
    const cambiaEstado = esStaff && estadoNuevo && estadoNuevo !== ticket.estado
    const { error } = await createCondominioRow('comentarios_ticket', {
      company_id: companyId,
      ticket_id: ticket.id,
      autor_nombre: autorNombre.trim() || 'Residente',
      contenido,
      foto_urls: fotos,
      // Solo el staff registra cambios de estado / notas internas: RLS rechaza
      // ambos en la rama del residente, así que ni se envían.
      estado_nuevo: cambiaEstado ? estadoNuevo : null,
      es_interno: esStaff ? interno : false,
    })
    if (error) {
      setEnviando(false)
      notify({ variant: 'error', title: 'No se pudo enviar', text: error.message })
      return
    }
    if (cambiaEstado) {
      const patch: Record<string, unknown> = { estado: estadoNuevo }
      if (estadoNuevo === 'cerrado') patch.fecha_cierre = new Date().toISOString()
      const { error: eEstado } = await updateCondominioRow('tickets_mantenimiento', ticket.id, patch)
      if (eEstado) notify({ variant: 'error', title: 'Mensaje enviado, estado sin cambiar', text: eEstado.message })
      else onRefresh?.()
    }
    setEnviando(false)
    setTexto(''); setFotos([]); setEstado(''); setInterno(false)
    await cargar()
  }

  const t = tono(ticket.estado)

  return (
    <EditModal
      title={ticket.titulo}
      size="sm"
      onClose={onClose}
      subtitle={
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: t.bg, color: t.color }}>
            {ESTADO_LABEL[ticket.estado] ?? ticket.estado}
          </span>
          <span>Reportado el {new Date(ticket.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </span>
      }
      footer={canWrite ? (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            placeholder={esStaff ? 'Responda al residente…' : 'Escriba un mensaje al equipo…'}
            rows={2}
            aria-label="Mensaje"
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)', resize: 'vertical', fontFamily: 'inherit' }}
          />
          <MultiImageUploader
            values={fotos}
            onChange={setFotos}
            folder="tickets"
            label="Adjuntar fotos"
            maxFiles={4}
          />
          {esStaff && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={interno} onChange={e => setInterno(e.target.checked)} />
                Nota interna
              </label>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={enviar}
              disabled={enviando}
              style={{ padding: '10px 22px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: enviando ? 'wait' : 'pointer', fontSize: 13.5 }}>
              {enviando ? 'Enviando…' : '➤ Enviar mensaje'}
            </button>
          </div>
        </div>
      ) : undefined}
    >
      {/* Reporte original: encabeza el hilo como el primer "mensaje". */}
      <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          Reporte original
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--at-ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {ticket.descripcion || 'Sin descripción.'}
        </div>
        {ticket.foto_urls?.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <ImageGallery urls={ticket.foto_urls} maxVisible={4} />
          </div>
        )}
      </div>

      {/* Hilo */}
      {cargando ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--at-ink-3)', fontSize: 13 }}>Cargando conversación…</div>
      ) : mensajes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>💬</div>
          <p style={{ margin: 0, fontSize: 13 }}>
            Todavía no hay mensajes.{canWrite ? ' Escriba el primero abajo.' : ''}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mensajes.map(m => {
            const mio = !!autorUserId && m.creado_por === autorUserId
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mio ? 'flex-end' : 'flex-start' }}>
                <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-ink-2)' }}>{mio ? 'Yo' : m.autor_nombre}</span>
                  <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{horaCorta(m.created_at)}</span>
                  {m.es_interno && (
                    <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>
                      🔒 Interna
                    </span>
                  )}
                  {m.estado_nuevo && (
                    <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: tono(m.estado_nuevo).bg, color: tono(m.estado_nuevo).color }}>
                      → {ESTADO_LABEL[m.estado_nuevo] ?? m.estado_nuevo}
                    </span>
                  )}
                </div>
                <div style={{
                  maxWidth: '85%',
                  background: mio ? 'var(--at-primary-tint)' : 'var(--at-surface-2)',
                  border: `1px solid ${mio ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`,
                  borderRadius: 12,
                  padding: '9px 12px',
                }}>
                  {m.contenido && (
                    <div style={{ fontSize: 13.5, color: 'var(--at-ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.contenido}</div>
                  )}
                  {m.foto_urls?.length > 0 && (
                    <div style={{ marginTop: m.contenido ? 8 : 0 }}>
                      <ImageGallery urls={m.foto_urls} maxVisible={4} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={finRef} />
        </div>
      )}
    </EditModal>
  )
}
