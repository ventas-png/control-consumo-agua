import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { TicketMantenimiento, Unidad } from '../../../types'
import { MultiImageUploader } from '../ImageUploader'
import { ImageGallery } from '../ImageGallery'

interface Props {
  tickets: TicketMantenimiento[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const PRIORIDAD_COLORS: Record<string, { bg: string; color: string }> = {
  baja:    { bg: '#f0fdf4', color: '#16a34a' },
  media:   { bg: '#eff6ff', color: '#2563eb' },
  alta:    { bg: '#fff7ed', color: '#ea580c' },
  urgente: { bg: '#fef2f2', color: '#dc2626' },
}

const ESTADO_COLORS: Record<string, { bg: string; color: string }> = {
  abierto:    { bg: '#eff6ff', color: '#2563eb' },
  en_proceso: { bg: '#fff7ed', color: '#ea580c' },
  resuelto:   { bg: '#f0fdf4', color: '#16a34a' },
  cerrado:    { bg: '#f8fafc', color: '#64748b' },
}

export function MantenimientoTab({ tickets, unidades, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroPrioridad, setFiltroPrioridad] = useState<string>('todos')
  const [filtroEstado, setFiltroEstado] = useState<string>('activos')
  const [busqueda, setBusqueda] = useState('')
  const [fotoUrls, setFotoUrls] = useState<string[]>([])
  const [form, setForm] = useState({
    tipo: 'correctivo',
    titulo: '',
    descripcion: '',
    prioridad: 'media',
    unidad_id: '',
    fecha_limite: '',
    costo_estimado: '',
  })

  const filtrados = tickets.filter(t => {
    const matchBusqueda = !busqueda || t.titulo.toLowerCase().includes(busqueda.toLowerCase()) || (t.descripcion || '').toLowerCase().includes(busqueda.toLowerCase())
    const matchPrioridad = filtroPrioridad === 'todos' || t.prioridad === filtroPrioridad
    const matchEstado = filtroEstado === 'todos'
      ? true
      : filtroEstado === 'activos'
      ? t.estado !== 'cerrado'
      : t.estado === filtroEstado
    return matchBusqueda && matchPrioridad && matchEstado
  })

  const conteos = {
    abierto: tickets.filter(t => t.estado === 'abierto').length,
    en_proceso: tickets.filter(t => t.estado === 'en_proceso').length,
    resuelto: tickets.filter(t => t.estado === 'resuelto').length,
    urgentes: tickets.filter(t => t.prioridad === 'urgente' && t.estado !== 'cerrado').length,
  }

  function resetForm() {
    setForm({ tipo: 'correctivo', titulo: '', descripcion: '', prioridad: 'media', unidad_id: '', fecha_limite: '', costo_estimado: '' })
    setFotoUrls([])
    setShowForm(false)
  }

  async function handleGuardar() {
    if (!form.titulo.trim()) { Swal.fire('Error', 'Ingrese el título del ticket.', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('tickets_mantenimiento').insert({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      tipo: form.tipo,
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
      prioridad: form.prioridad,
      estado: 'abierto',
      reportado_por: userId,
      fecha_limite: form.fecha_limite || null,
      costo_estimado: form.costo_estimado ? Number(form.costo_estimado) : null,
      foto_urls: fotoUrls,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: 'Ticket creado', timer: 1500, showConfirmButton: false })
    resetForm()
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: string) {
    if (!canEdit) return
    const updates: Record<string, unknown> = { estado }
    if (estado === 'cerrado') updates.fecha_cierre = new Date().toISOString()
    const { error } = await supabase.from('tickets_mantenimiento').update(updates).eq('id', id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  async function eliminar(id: string) {
    const result = await Swal.fire({ title: '¿Eliminar ticket?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#ef4444' })
    if (!result.isConfirmed) return
    await supabase.from('tickets_mantenimiento').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Mantenimiento</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>
            {conteos.abierto} abiertos · {conteos.en_proceso} en proceso · <span style={{ color: '#dc2626', fontWeight: 600 }}>{conteos.urgentes} urgentes</span>
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo ticket
          </button>
        )}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar ticket..."
          style={{ flex: 1, minWidth: '180px', padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13.5px', background: '#f8fafc' }} />
        {(['todos', 'activos', 'abierto', 'en_proceso', 'resuelto', 'cerrado'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? '#0ea5e9' : '#e2e8f0', background: filtroEstado === e ? '#eff6ff' : 'white', color: filtroEstado === e ? '#0ea5e9' : '#64748b' }}>
            {e === 'en_proceso' ? 'En proceso' : e.charAt(0).toUpperCase() + e.slice(1)}
          </button>
        ))}
      </div>

      {/* Filtro prioridad */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'urgente', 'alta', 'media', 'baja'] as const).map(p => (
          <button key={p} onClick={() => setFiltroPrioridad(p)}
            style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: 'none',
              background: filtroPrioridad === p ? (p === 'todos' ? '#e2e8f0' : PRIORIDAD_COLORS[p]?.bg ?? '#e2e8f0') : 'transparent',
              color: filtroPrioridad === p ? (p === 'todos' ? '#374151' : PRIORIDAD_COLORS[p]?.color ?? '#374151') : '#94a3b8' }}>
            {p === 'todos' ? 'Todas' : p}
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nuevo ticket de mantenimiento</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Título *</label>
              <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Descripción breve del problema"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="correctivo">Correctivo</option>
                <option value="preventivo">Preventivo</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Prioridad</label>
              <select value={form.prioridad} onChange={e => setForm(f => ({ ...f, prioridad: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Unidad (opcional)</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="">Área común</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fecha límite</label>
              <input type="date" value={form.fecha_limite} onChange={e => setForm(f => ({ ...f, fecha_limite: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Costo estimado</label>
              <input type="number" value={form.costo_estimado} onChange={e => setForm(f => ({ ...f, costo_estimado: e.target.value }))}
                placeholder="0.00" min="0" step="0.01"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Descripción</label>
              <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Detalle el problema o trabajo requerido..." rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc', resize: 'vertical' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <MultiImageUploader values={fotoUrls} onChange={setFotoUrls} folder="tickets" label="Fotos del problema" maxFiles={6} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Crear ticket'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔧</div>
          <p style={{ fontWeight: 600, color: '#64748b' }}>No hay tickets de mantenimiento</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtrados.map(t => {
            const pColor = PRIORIDAD_COLORS[t.prioridad] ?? { bg: '#f8fafc', color: '#64748b' }
            const eColor = ESTADO_COLORS[t.estado] ?? { bg: '#f8fafc', color: '#64748b' }
            const vencido = t.fecha_limite && t.fecha_limite < new Date().toISOString().slice(0, 10) && t.estado !== 'cerrado'
            return (
              <div key={t.id} style={{ background: 'white', border: `1.5px solid ${t.prioridad === 'urgente' && t.estado !== 'cerrado' ? '#fecaca' : '#e2e8f0'}`, borderRadius: '14px', padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                      <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: pColor.bg, color: pColor.color }}>{t.prioridad}</span>
                      <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: '#f1f5f9', color: '#64748b' }}>{t.tipo}</span>
                      {vencido && <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#fef2f2', color: '#dc2626' }}>Vencido</span>}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '14.5px', color: '#0f172a', marginBottom: '4px' }}>{t.titulo}</div>
                    {t.descripcion && <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '6px' }}>{t.descripcion}</div>}
                    <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: '#94a3b8', flexWrap: 'wrap' }}>
                      {t.unidad_nombre && <span>📍 {t.unidad_nombre}</span>}
                      {t.fecha_limite && <span style={{ color: vencido ? '#dc2626' : '#94a3b8' }}>📅 {t.fecha_limite}</span>}
                      {t.costo_estimado && <span>💰 Est. {t.costo_estimado.toFixed(2)}</span>}
                      {t.costo_real && <span>✅ Real {t.costo_real.toFixed(2)}</span>}
                      <span>🕐 {new Date(t.created_at).toLocaleDateString('es')}</span>
                    </div>
                    {t.foto_urls?.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <ImageGallery urls={t.foto_urls} maxVisible={4} />
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
                    {canEdit ? (
                      <select value={t.estado} onChange={e => cambiarEstado(t.id, e.target.value)}
                        style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer', background: eColor.bg, color: eColor.color }}>
                        <option value="abierto">Abierto</option>
                        <option value="en_proceso">En proceso</option>
                        <option value="resuelto">Resuelto</option>
                        <option value="cerrado">Cerrado</option>
                      </select>
                    ) : (
                      <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: eColor.bg, color: eColor.color }}>
                        {t.estado.replace('_', ' ')}
                      </span>
                    )}
                    <button onClick={() => eliminar(t.id)} title="Eliminar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '15px', padding: '2px 4px' }}>🗑</button>
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
