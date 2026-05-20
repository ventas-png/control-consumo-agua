import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { TicketMantenimiento } from '../../../types'

interface Props {
  tickets: TicketMantenimiento[]
  unidadId: string
  proyectoId: string
  companyId: string
  onRefresh: () => void
}

type EstadoTicket = 'abierto' | 'en_proceso' | 'resuelto' | 'cerrado'
type PrioridadTicket = 'baja' | 'media' | 'alta' | 'urgente'

const ESTADO_CONFIG: Record<EstadoTicket, { label: string; icon: string; bg: string; color: string }> = {
  abierto:    { label: 'Abierto',     icon: '🟡', bg: '#fff7ed', color: '#c2410c' },
  en_proceso: { label: 'En proceso',  icon: '🔵', bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  resuelto:   { label: 'Resuelto',    icon: '🟢', bg: '#f0fdf4', color: '#16a34a' },
  cerrado:    { label: 'Cerrado',     icon: '⚪', bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
}

const PRIORIDAD_CONFIG: Record<PrioridadTicket, { label: string; bg: string; color: string }> = {
  baja:    { label: 'Baja',    bg: '#f0fdf4', color: '#16a34a' },
  media:   { label: 'Media',   bg: '#fff7ed', color: '#c2410c' },
  alta:    { label: 'Alta',    bg: '#fef2f2', color: '#dc2626' },
  urgente: { label: 'Urgente', bg: '#fdf2f8', color: 'var(--at-accent-hover)' },
}

function blankForm() {
  return { titulo: '', descripcion: '', prioridad: 'media' as PrioridadTicket }
}

export function PortalMisTicketsTab({ tickets, unidadId, proyectoId, companyId, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [form, setForm]         = useState(blankForm())
  const [filtro, setFiltro]     = useState<EstadoTicket | 'todos'>('todos')

  const filtered = filtro === 'todos' ? tickets : tickets.filter(t => t.estado === filtro)
  const abiertos = tickets.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso').length

  async function enviarSolicitud() {
    if (!form.titulo.trim()) { Swal.fire('Error', 'Ingrese el título de la solicitud.', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('tickets_mantenimiento').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: unidadId, tipo: 'correctivo',
      titulo: form.titulo.trim(), descripcion: form.descripcion.trim() || null,
      prioridad: form.prioridad, estado: 'abierto',
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: '¡Solicitud enviada!', text: 'El equipo de mantenimiento la atenderá pronto.', timer: 2000, showConfirmButton: false })
    setForm(blankForm()); setShowForm(false); onRefresh()
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

      {/* Formulario */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '14px', padding: '18px', marginBottom: '18px' }}>
          <h4 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700 }}>Reportar problema</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>¿Qué necesita atención? *</label>
              <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej. Fuga de agua en baño, Luz quemada en pasillo..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Descripción detallada</label>
              <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Cuéntenos más detalles del problema..." rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '6px' }}>Urgencia</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(['baja', 'media', 'alta', 'urgente'] as PrioridadTicket[]).map(p => {
                  const pc = PRIORIDAD_CONFIG[p]
                  return (
                    <button key={p} onClick={() => setForm(f => ({ ...f, prioridad: p }))}
                      style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', border: '1.5px solid', borderColor: form.prioridad === p ? pc.color : 'var(--at-line)', background: form.prioridad === p ? pc.bg : 'var(--at-surface)', color: form.prioridad === p ? pc.color : 'var(--at-ink-3)' }}>
                      {pc.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
            <button onClick={enviarSolicitud} disabled={saving} style={{ padding: '10px 22px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Enviando...' : '📤 Enviar solicitud'}
            </button>
            <button onClick={() => { setShowForm(false); setForm(blankForm()) }} style={{ padding: '10px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
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
          {filtered.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(t => {
            const ec = ESTADO_CONFIG[t.estado as EstadoTicket] ?? ESTADO_CONFIG.abierto
            const pc = PRIORIDAD_CONFIG[t.prioridad as PrioridadTicket] ?? PRIORIDAD_CONFIG.media
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
                    {t.fecha_cierre && <div style={{ fontSize: '12px', color: '#16a34a', marginTop: '4px' }}>✅ Resuelto el {new Date(t.fecha_cierre).toLocaleDateString('es', { day: '2-digit', month: 'short' })}</div>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
