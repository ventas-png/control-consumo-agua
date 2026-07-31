import { useCallback, useEffect, useState } from 'react'
import { notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { ImageGallery } from '../../shared/ImageGallery'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { TicketChatModal } from './TicketChatModal'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { fetchConteoComentariosTickets } from '../../../domain/condominios/tabQueries'
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

function blankForm() {
  return { titulo: '', descripcion: '', prioridad: 'media' as PrioridadTicket }
}

export function PortalMisTicketsTab({
  tickets, unidadId, proyectoId, companyId, autorNombre = '', autorUserId, onRefresh,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [form, setForm]         = useState(blankForm())
  const [fotos, setFotos]       = useState<string[]>([])
  const [filtro, setFiltro]     = useState<EstadoTicket | 'todos'>('todos')
  const [conversacion, setConversacion] = useState<TicketMantenimiento | null>(null)
  const [conteoMensajes, setConteoMensajes] = useState<Record<string, number>>({})

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
          style={{ padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
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
              <button onClick={enviarSolicitud} disabled={saving} style={{ padding: '10px 22px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
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
          </div>
        </EditModal>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {(['todos', 'abierto', 'en_proceso', 'resuelto', 'cerrado'] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: 'none',
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
            return (
              <div key={t.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${t.estado === 'resuelto' || t.estado === 'cerrado' ? 'var(--at-line)' : 'var(--at-primary-soft-2)'}`, borderRadius: '12px', padding: '14px 16px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '20px', flexShrink: 0 }}>{ec.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', marginBottom: '3px' }}>{t.titulo}</div>
                    {t.descripcion && <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginBottom: '5px' }}>{t.descripcion}</div>}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                      <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: pc.bg, color: pc.color }}>{pc.label}</span>
                      <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{new Date(t.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    </div>
                    {t.foto_urls?.length > 0 && (
                      <div style={{ marginTop: '8px' }}>
                        <ImageGallery urls={t.foto_urls} maxVisible={4} />
                      </div>
                    )}
                    {t.fecha_cierre && <div style={{ fontSize: '12px', color: 'var(--at-success)', marginTop: '4px' }}>✅ Resuelto el {new Date(t.fecha_cierre).toLocaleDateString('es', { day: '2-digit', month: 'short' })}</div>}
                    <button
                      onClick={() => setConversacion(t)}
                      style={{ marginTop: '9px', padding: '6px 13px', background: nMensajes > 0 ? 'var(--at-primary-tint)' : 'var(--at-chip)', color: nMensajes > 0 ? 'var(--at-primary)' : 'var(--at-ink-2)', border: 'none', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                      💬 {nMensajes > 0 ? `Conversación (${nMensajes})` : 'Escribir al equipo'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {conversacion && (
        <TicketChatModal
          ticket={conversacion}
          companyId={companyId}
          autorNombre={autorNombre}
          autorUserId={autorUserId}
          onClose={() => { setConversacion(null); void cargarConteos() }}
        />
      )}
    </div>
  )
}
