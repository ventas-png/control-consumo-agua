import { useCallback, useEffect, useState } from 'react'
import { notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { ImageGallery } from '../../shared/ImageGallery'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { MultiFileUploader, ListaAdjuntos } from '../../shared/FileUploader'
import { TicketChatModal } from './TicketChatModal'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { fetchConteoComentariosTickets } from '../../../domain/condominios/tabQueries'
import { formatFechaCalendario } from '../../../lib/format'
import type { TicketMantenimiento } from '../../../types'

interface Props {
  tickets: TicketMantenimiento[]
  unidadId: string
  proyectoId: string
  companyId: string
  /** Nombre con el que se firman los mensajes del residente en la conversación. */
  autorNombre?: string
  /** auth user id del residente: distingue sus mensajes en el hilo. */
  autorUserId?: string
  /**
   * Escribir en la conversación de un ticket. El residente siempre (la base lo
   * deja por su unidad); la vista previa del panel, con canEdit('portal'), lo
   * mismo que la base exige al staff.
   */
  canWrite?: boolean
  onRefresh: () => void
}

type EstadoTicket = 'abierto' | 'en_proceso' | 'resuelto' | 'cerrado'
type PrioridadTicket = 'baja' | 'media' | 'alta' | 'urgente'

const ESTADO_CONFIG: Record<EstadoTicket, { label: string; icon: string; bg: string; color: string }> = {
  abierto:    { label: 'Abierto',     icon: '🟡', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  en_proceso: { label: 'En proceso',  icon: '🔵', bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  resuelto:   { label: 'Resuelto',    icon: '🟢', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  cerrado:    { label: 'Cerrado',     icon: '⚪', bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
}

const PRIORIDAD_CONFIG: Record<PrioridadTicket, { label: string; bg: string; color: string }> = {
  baja:    { label: 'Baja',    bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  media:   { label: 'Media',   bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  alta:    { label: 'Alta',    bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  urgente: { label: 'Urgente', bg: '#fdf2f8', color: 'var(--at-accent-hover)' },
}

const FLUJO_TICKET: EstadoTicket[] = ['abierto', 'en_proceso', 'resuelto', 'cerrado']

/** "2026-07-20T10:00:00Z" → "20 jul" (fila) y "20 de julio de 2026, 10:00" (ficha), en hora local. */
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short' })
const fechaHoraLarga = (iso: string) => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
/** "domingo, 08 de noviembre" → "Domingo, 08 de noviembre". */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function blankForm() {
  return { titulo: '', descripcion: '', prioridad: 'media' as PrioridadTicket }
}

export function PortalMisTicketsTab({
  tickets, unidadId, proyectoId, companyId, autorNombre = '', autorUserId, canWrite = true, onRefresh,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [form, setForm]         = useState(blankForm())
  const [fotos, setFotos]       = useState<string[]>([])
  const [archivos, setArchivos] = useState<string[]>([])
  const [filtro, setFiltro]     = useState<EstadoTicket | 'todos'>('todos')
  const [conversacion, setConversacion] = useState<TicketMantenimiento | null>(null)
  const [conteoMensajes, setConteoMensajes] = useState<Record<string, number>>({})
  // Ticket abierto en la ficha, por id: así la ficha sigue a la fila cuando el padre recarga.
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const detalle = detalleId ? tickets.find(t => t.id === detalleId) ?? null : null

  const filtered = filtro === 'todos' ? tickets : tickets.filter(t => t.estado === filtro)
  const abiertos = tickets.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso').length

  // Badge "N mensajes" de cada tarjeta: un solo conteo para toda la lista, no un
  // hilo por ticket (los hilos se bajan al abrir la conversación).
  const ids = tickets.map(t => t.id).join(',')
  const cargarConteos = useCallback(async () => {
    const lista = ids ? ids.split(',') : []
    setConteoMensajes(await fetchConteoComentariosTickets(lista))
  }, [ids])
  useEffect(() => { void cargarConteos() }, [cargarConteos])

  function cerrarForm() {
    setShowForm(false)
    setForm(blankForm())
    setFotos([])
    setArchivos([])
  }

  async function enviarSolicitud() {
    if (!form.titulo.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el título de la solicitud.' }); return }
    setSaving(true)
    const { error } = await createCondominioRow('tickets_mantenimiento', {
      company_id: companyId, project_id: proyectoId,
      unidad_id: unidadId, tipo: 'correctivo',
      titulo: form.titulo.trim(), descripcion: form.descripcion.trim() || null,
      prioridad: form.prioridad, estado: 'abierto',
      foto_urls: fotos,
      archivo_urls: archivos,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: '¡Solicitud enviada!', text: 'El equipo de mantenimiento la atenderá pronto.', duration: 2000 })
    cerrarForm(); onRefresh()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>Mis solicitudes de mantenimiento</h3>
          {abiertos > 0 && <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--at-primary)' }}>{abiertos} solicitud{abiertos !== 1 ? 'es' : ''} en proceso</p>}
        </div>
        <button onClick={() => setShowForm(true)}
          style={{ padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-cta),var(--at-cta-hover))', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
          + Nueva solicitud
        </button>
      </div>

      {/* Formulario — ventana emergente: el reporte no compite por espacio con la
          lista de solicitudes, y en móvil ocupa la pantalla completa. */}
      {showForm && (
        <EditModal
          title="Reportar problema"
          subtitle="Cuéntenos qué necesita atención y adjunte fotos si ayudan a entenderlo."
          size="sm"
          onClose={cerrarForm}
          footer={
            <>
              <button onClick={cerrarForm} style={{ padding: '10px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={enviarSolicitud} disabled={saving} style={{ padding: '10px 22px', background: 'linear-gradient(135deg,var(--at-cta),var(--at-cta-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Enviando...' : '📤 Enviar solicitud'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label htmlFor="ticket-titulo" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>¿Qué necesita atención? *</label>
              <input id="ticket-titulo" autoFocus value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej. Fuga de agua en baño, Luz quemada en pasillo..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label htmlFor="ticket-descripcion" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Descripción detallada</label>
              <textarea id="ticket-descripcion" value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Cuéntenos más detalles del problema..." rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '6px' }}>Urgencia</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(['baja', 'media', 'alta', 'urgente'] as PrioridadTicket[]).map(p => {
                  const pc = PRIORIDAD_CONFIG[p]
                  return (
                    <button key={p} onClick={() => setForm(f => ({ ...f, prioridad: p }))}
                      aria-pressed={form.prioridad === p}
                      style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', border: '1.5px solid', borderColor: form.prioridad === p ? pc.color : 'var(--at-line)', background: form.prioridad === p ? pc.bg : 'var(--at-surface)', color: form.prioridad === p ? pc.color : 'var(--at-ink-3)' }}>
                      {pc.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <MultiImageUploader
              values={fotos}
              onChange={setFotos}
              folder="tickets"
              label="Fotos del problema"
              maxFiles={4}
            />
            <MultiFileUploader
              values={archivos}
              onChange={setArchivos}
              folder="tickets"
              label="Documentos (cotización, garantía…)"
              maxFiles={4}
            />
          </div>
        </EditModal>
      )}

      {/* Filtros: una fila deslizable (en el teléfono, en dos filas empujaban la lista) */}
      <div className="tab-strip-scrollable" style={{ display: 'flex', gap: '7px', overflowX: 'auto', marginBottom: '14px', paddingBottom: '2px' }}>
        {(['todos', 'abierto', 'en_proceso', 'resuelto', 'cerrado'] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)} aria-pressed={filtro === f}
            style={{ padding: '7px 13px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', border: 'none', whiteSpace: 'nowrap', flexShrink: 0,
              background: filtro === f ? 'var(--at-primary-tint)' : 'transparent', color: filtro === f ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {f === 'todos' ? `Todos (${tickets.length})` : `${ESTADO_CONFIG[f].icon} ${ESTADO_CONFIG[f].label}`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>🔧</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Sin solicitudes{filtro !== 'todos' ? ' con este estado' : ''}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(t => {
            const ec = ESTADO_CONFIG[t.estado as EstadoTicket] ?? ESTADO_CONFIG.abierto
            const pc = PRIORIDAD_CONFIG[t.prioridad as PrioridadTicket] ?? PRIORIDAD_CONFIG.media
            const nMensajes = conteoMensajes[t.id] ?? 0
            const fotos = t.foto_urls?.length ?? 0
            const archivos = t.archivo_urls?.length ?? 0
            const activo = t.estado === 'abierto' || t.estado === 'en_proceso'
            const abrir = () => setDetalleId(t.id)
            return (
              /* La tarjeta sólo resume; la ficha completa (descripción, fotos,
                 documentos, resolución y la conversación) abre en ventana al tocarla. */
              <div key={t.id} role="button" tabIndex={0} aria-label={t.titulo}
                onClick={abrir}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir() } }}
                style={{ background: 'var(--at-surface)', border: `1.5px solid ${activo ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`, borderRadius: '14px', padding: '12px 16px', display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer' }}>
                <span aria-hidden="true" style={{ width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '19px', background: ec.bg }}>🔧</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: '14.5px', color: 'var(--at-ink)' }}>{t.titulo}</span>
                    <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', flexShrink: 0 }}>{fechaCorta(t.created_at)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', margin: '5px 0' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 9px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, background: ec.bg, color: ec.color }}>
                      <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />{ec.label}
                    </span>
                    <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, background: pc.bg, color: pc.color }}>{pc.label}</span>
                  </div>
                  {/* Dos líneas bastan en la lista: el texto completo va en la ficha. */}
                  {t.descripcion && <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.descripcion}</div>}
                  {t.fecha_cierre && <div style={{ fontSize: '12px', color: 'var(--at-success)', marginTop: '6px' }}>✅ Resuelto el {fechaCorta(t.fecha_cierre)}</div>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center', marginTop: '6px', fontSize: '12px', color: 'var(--at-ink-3)' }}>
                    {nMensajes > 0 && <span style={{ fontWeight: 700, color: 'var(--at-primary)' }}>💬 {nMensajes}</span>}
                    {fotos > 0 && <span>📷 {fotos} foto{fotos === 1 ? '' : 's'}</span>}
                    {archivos > 0 && <span>📎 {archivos} archivo{archivos === 1 ? '' : 's'}</span>}
                    <span aria-hidden style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--at-primary)' }}>Ver ficha ›</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Ficha del ticket en ventana emergente (pantalla completa en el teléfono):
          descripción completa, fotos, documentos, quién lo atiende, resolución y,
          en el pie, la conversación con el equipo. Antes cada tarjeta traía
          desplegados la galería, los documentos y la barra de conversación. */}
      {detalle && (() => {
        const t = detalle
        const ec = ESTADO_CONFIG[t.estado as EstadoTicket] ?? ESTADO_CONFIG.abierto
        const pc = PRIORIDAD_CONFIG[t.prioridad as PrioridadTicket] ?? PRIORIDAD_CONFIG.media
        const nMensajes = conteoMensajes[t.id] ?? 0
        const datos: { label: string; value: string; color?: string }[] = [
          { label: 'Estado', value: ec.label, color: ec.color },
          { label: 'Urgencia', value: pc.label, color: pc.color },
          { label: 'Reportado', value: fechaHoraLarga(t.created_at) },
        ]
        if (t.asignado_a) datos.push({ label: 'Lo atiende', value: t.asignado_a })
        if (t.fecha_limite) datos.push({ label: 'Atención prevista', value: cap(formatFechaCalendario(t.fecha_limite, { weekday: 'long', day: '2-digit', month: 'long' }, 'es', t.fecha_limite)) })
        if (t.fecha_cierre) datos.push({ label: 'Resuelto el', value: fechaHoraLarga(t.fecha_cierre), color: 'var(--at-success)' })
        const seccion = { background: 'var(--at-surface-2)', borderRadius: 8, padding: 10, border: '1px solid var(--at-line)', marginBottom: 12 } as const
        return (
          <EditModal
            title={t.titulo}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 800, background: ec.bg, color: ec.color }}>{ec.icon} {ec.label}</span>
                <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 800, background: pc.bg, color: pc.color }}>{pc.label}</span>
                <span>📅 Reportado el {fechaCorta(t.created_at)}</span>
              </span>
            }
            size="lg"
            fullScreenOnMobile
            onClose={() => setDetalleId(null)}
            footer={
              <div className="at-ficha-acciones" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
                <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
                <Button variant="primary" onClick={() => setConversacion(t)}>💬 {nMensajes > 0 ? `Conversación (${nMensajes})` : 'Escribir al equipo'}</Button>
              </div>
            }
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
              {datos.map(d => (
                <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 7, padding: 8, border: '1px solid var(--at-line)', minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{d.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: d.color ?? 'var(--at-ink-2)', overflowWrap: 'anywhere' }}>{d.value}</div>
                </div>
              ))}
            </div>

            {t.descripcion && (
              <div style={seccion}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 4 }}>Descripción</div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--at-ink-2)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{t.descripcion}</p>
              </div>
            )}

            {t.notas_cierre && (
              <div style={{ ...seccion, background: 'var(--at-success-tint)', borderColor: 'var(--at-success-border)' }}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 4 }}>Resolución</div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--at-ink-2)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{t.notas_cierre}</p>
              </div>
            )}

            {t.foto_urls?.length > 0 && (
              <div style={seccion}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 6 }}>Fotos</div>
                <ImageGallery urls={t.foto_urls} maxVisible={8} />
              </div>
            )}

            {t.archivo_urls?.length > 0 && (
              <div style={seccion}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 6 }}>Documentos</div>
                <ListaAdjuntos paths={t.archivo_urls} />
              </div>
            )}

            {/* Dónde va la solicitud dentro del flujo (la etapa actual, resaltada). */}
            <div aria-hidden style={{ fontSize: 11, color: 'var(--at-ink-3)', display: 'flex', flexWrap: 'wrap', gap: '4px 6px', alignItems: 'center' }}>
              {FLUJO_TICKET.map((e, i) => (
                <span key={e} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && <span>→</span>}
                  <span style={e === t.estado ? { fontWeight: 700, color: ESTADO_CONFIG[e].color, background: ESTADO_CONFIG[e].bg, borderRadius: 20, padding: '1px 8px' } : undefined}>
                    {ESTADO_CONFIG[e].label}
                  </span>
                </span>
              ))}
            </div>
          </EditModal>
        )
      })()}

      {/* La conversación abre encima de la ficha; al cerrarla se recarga el conteo de mensajes. */}
      {conversacion && (
        <TicketChatModal
          ticket={conversacion}
          companyId={companyId}
          autorNombre={autorNombre}
          autorUserId={autorUserId}
          canWrite={canWrite}
          onClose={() => { setConversacion(null); void cargarConteos() }}
        />
      )}
    </div>
  )
}
