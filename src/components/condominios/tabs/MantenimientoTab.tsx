import { hoyLocalISO } from '../../../lib/format'
import { useState } from 'react'
import { notify, confirm } from '../../shared/Dialog'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { softDelete } from '../../../lib/softDelete'
import type { TicketMantenimiento, Unidad } from '../../../types'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { ImageGallery } from '../../shared/ImageGallery'
import { MultiFileUploader, ListaAdjuntos } from '../../shared/FileUploader'
import { TicketChatModal } from './TicketChatModal'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

interface Props {
  tickets: TicketMantenimiento[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  /** Firma las respuestas del equipo en la conversación del ticket. */
  autorNombre?: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const PRIORIDAD_COLORS: Record<string, { bg: string; color: string }> = {
  baja:    { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  media:   { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  alta:    { bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
  urgente: { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

const ESTADO_COLORS: Record<string, { bg: string; color: string }> = {
  abierto:    { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  en_proceso: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
  resuelto:   { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  cerrado:    { bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
}

export function MantenimientoTab({ tickets, unidades, proyectoId, companyId, userId, autorNombre = '', proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroPrioridad, setFiltroPrioridad] = useState<string>('todos')
  const [filtroEstado, setFiltroEstado] = useState<string>('activos')
  const [busqueda, setBusqueda] = useState('')
  const [fotoUrls, setFotoUrls] = useState<string[]>([])
  const [archivoUrls, setArchivoUrls] = useState<string[]>([])
  const [conversacion, setConversacion] = useState<TicketMantenimiento | null>(null)
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

  // KPI calculations
  const activos = tickets.filter(t => t.estado !== 'cerrado')
  const resueltos = tickets.filter(t => t.estado === 'resuelto' || t.estado === 'cerrado')
  const costoEstimadoTotal = tickets.reduce((s, t) => s + (t.costo_estimado ?? 0), 0)
  const costoRealTotal = tickets.reduce((s, t) => s + (t.costo_real ?? 0), 0)
  const pctResueltos = tickets.length > 0 ? Math.round((resueltos.length / tickets.length) * 100) : 0
  const urgentesActivos = activos.filter(t => t.prioridad === 'urgente').length

  const conteos = {
    abierto: tickets.filter(t => t.estado === 'abierto').length,
    en_proceso: tickets.filter(t => t.estado === 'en_proceso').length,
    resuelto: tickets.filter(t => t.estado === 'resuelto').length,
    urgentes: urgentesActivos,
  }

  function resetForm() {
    setForm({ tipo: 'correctivo', titulo: '', descripcion: '', prioridad: 'media', unidad_id: '', fecha_limite: '', costo_estimado: '' })
    setFotoUrls([])
    setArchivoUrls([])
    setShowForm(false)
  }

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Tickets de Mantenimiento',
      subtitulo: `${filtrados.length} ticket${filtrados.length !== 1 ? 's' : ''} · Filtro: ${filtroEstado}`,
      proyectoNombre,
      headers: ['Título', 'Tipo', 'Prioridad', 'Unidad', 'Estado', 'Fecha límite', 'Costo est.', 'Costo real'],
      rows: filtrados.map(t => [
        t.titulo,
        t.tipo,
        t.prioridad,
        t.unidad_nombre ?? 'Área común',
        t.estado.replace('_', ' '),
        t.fecha_limite ?? '—',
        t.costo_estimado != null ? t.costo_estimado.toFixed(2) : '—',
        t.costo_real != null ? t.costo_real.toFixed(2) : '—',
      ]),
      rightAlignCols: [6, 7],
      filename: `tickets-mantenimiento-${hoyLocalISO()}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`tickets-mantenimiento-${hoyLocalISO()}`, [{
      name: 'Tickets',
      headers: ['Título', 'Descripción', 'Tipo', 'Prioridad', 'Unidad', 'Estado', 'Fecha límite', 'Costo estimado', 'Costo real', 'Fecha creación', 'Fecha cierre'],
      rows: filtrados.map(t => [
        t.titulo, t.descripcion ?? '', t.tipo, t.prioridad,
        t.unidad_nombre ?? 'Área común', t.estado,
        t.fecha_limite ?? '', t.costo_estimado ?? '', t.costo_real ?? '',
        new Date(t.created_at).toLocaleDateString('es'),
        t.fecha_cierre ? new Date(t.fecha_cierre).toLocaleDateString('es') : '',
      ]),
    }])
  }

  async function handleGuardar() {
    if (!form.titulo.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el título del ticket.' }); return }
    setSaving(true)
    const { error } = await createCondominioRow('tickets_mantenimiento', {
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
      archivo_urls: archivoUrls,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: 'Ticket creado', duration: 1500 })
    resetForm()
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: string) {
    if (!canEdit) return
    const updates: Record<string, unknown> = { estado }
    if (estado === 'cerrado') updates.fecha_cierre = new Date().toISOString()
    const { error } = await updateCondominioRow('tickets_mantenimiento', id, updates)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function eliminar(id: string) {
    const result = await confirm({ title: '¿Eliminar ticket?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!result.isConfirmed) return
    await softDelete('tickets_mantenimiento', { id })
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Mantenimiento</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {conteos.abierto} abiertos · {conteos.en_proceso} en proceso · <span style={{ color: 'var(--at-danger)', fontWeight: 600 }}>{conteos.urgentes} urgentes</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportarPDF} disabled={filtrados.length === 0}
            style={{ padding: '9px 14px', background: filtrados.length === 0 ? 'var(--at-chip)' : 'var(--at-primary-tint)', color: filtrados.length === 0 ? 'var(--at-ink-3)' : 'var(--at-primary)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '9px', fontSize: '12px', fontWeight: 600, cursor: filtrados.length === 0 ? 'not-allowed' : 'pointer' }}>
            📄 PDF
          </button>
          <button onClick={exportarXlsx} disabled={filtrados.length === 0}
            style={{ padding: '9px 14px', background: filtrados.length === 0 ? 'var(--at-chip)' : 'var(--at-success-tint)', color: filtrados.length === 0 ? 'var(--at-ink-3)' : 'var(--at-success)', border: '1.5px solid var(--at-success-border)', borderRadius: '9px', fontSize: '12px', fontWeight: 600, cursor: filtrados.length === 0 ? 'not-allowed' : 'pointer' }}>
            📊 Excel
          </button>
          {canCreate && (
            <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              + Nuevo ticket
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total tickets', val: tickets.length, color: 'var(--at-primary)', bg: 'var(--at-primary-tint)', icon: '🔧' },
          { label: 'Urgentes activos', val: urgentesActivos, color: urgentesActivos > 0 ? 'var(--at-danger)' : 'var(--at-success)', bg: urgentesActivos > 0 ? 'var(--at-danger-tint)' : 'var(--at-success-tint)', icon: '🚨' },
          { label: 'Costo estimado', val: costoEstimadoTotal > 0 ? costoEstimadoTotal.toFixed(2) : '—', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '💰' },
          { label: `% Resueltos`, val: `${pctResueltos}%`, color: pctResueltos >= 70 ? 'var(--at-success)' : 'var(--at-warning)', bg: pctResueltos >= 70 ? 'var(--at-success-tint)' : 'var(--at-warning-tint)', icon: '✅' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: '10px', padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', marginBottom: '3px' }}>{k.icon}</div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {costoRealTotal > 0 && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '8px', padding: '8px 14px', marginBottom: '14px', fontSize: '12px', color: 'var(--at-ink-3)' }}>
          Costo real acumulado: <strong style={{ color: 'var(--at-ink)' }}>{costoRealTotal.toFixed(2)}</strong>
          {costoEstimadoTotal > 0 && (
            <span style={{ marginLeft: 10, color: costoRealTotal > costoEstimadoTotal ? 'var(--at-danger)' : 'var(--at-success)', fontWeight: 600 }}>
              ({costoRealTotal > costoEstimadoTotal ? '+' : ''}{((costoRealTotal - costoEstimadoTotal) / costoEstimadoTotal * 100).toFixed(1)}% vs estimado)
            </span>
          )}
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar ticket..."
          style={{ flex: 1, minWidth: '180px', padding: '8px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-surface-2)' }} />
        {(['todos', 'activos', 'abierto', 'en_proceso', 'resuelto', 'cerrado'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)', background: filtroEstado === e ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'en_proceso' ? 'En proceso' : e.charAt(0).toUpperCase() + e.slice(1)}
          </button>
        ))}
      </div>

      {/* Filtro prioridad */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'urgente', 'alta', 'media', 'baja'] as const).map(p => (
          <button key={p} onClick={() => setFiltroPrioridad(p)}
            style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: 'none',
              background: filtroPrioridad === p ? (p === 'todos' ? 'var(--at-line)' : PRIORIDAD_COLORS[p]?.bg ?? 'var(--at-line)') : 'transparent',
              color: filtroPrioridad === p ? (p === 'todos' ? 'var(--at-ink-2)' : PRIORIDAD_COLORS[p]?.color ?? 'var(--at-ink-2)') : 'var(--at-ink-3)' }}>
            {p === 'todos' ? 'Todas' : p}
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nuevo ticket de mantenimiento</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Título *</label>
              <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Descripción breve del problema"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="correctivo">Correctivo</option>
                <option value="preventivo">Preventivo</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Prioridad</label>
              <select value={form.prioridad} onChange={e => setForm(f => ({ ...f, prioridad: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad (opcional)</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="">Área común</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha límite</label>
              <input type="date" value={form.fecha_limite} onChange={e => setForm(f => ({ ...f, fecha_limite: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Costo estimado</label>
              <input type="number" value={form.costo_estimado} onChange={e => setForm(f => ({ ...f, costo_estimado: e.target.value }))}
                placeholder="0.00" min="0" step="0.01"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Descripción</label>
              <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Detalle el problema o trabajo requerido..." rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', resize: 'vertical' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <MultiImageUploader values={fotoUrls} onChange={setFotoUrls} folder="tickets" label="Fotos del problema" maxFiles={6} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <MultiFileUploader values={archivoUrls} onChange={setArchivoUrls} folder="tickets" label="Documentos (cotización, garantía…)" maxFiles={6} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Crear ticket'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔧</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay tickets de mantenimiento</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtrados.map(t => {
            const pColor = PRIORIDAD_COLORS[t.prioridad] ?? { bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' }
            const eColor = ESTADO_COLORS[t.estado] ?? { bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' }
            const vencido = t.fecha_limite && t.fecha_limite < hoyLocalISO() && t.estado !== 'cerrado'
            return (
              <div key={t.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${t.prioridad === 'urgente' && t.estado !== 'cerrado' ? 'var(--at-danger-border)' : 'var(--at-line)'}`, borderRadius: '14px', padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                      <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: pColor.bg, color: pColor.color }}>{t.prioridad}</span>
                      <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>{t.tipo}</span>
                      {vencido && <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'var(--at-danger-tint)', color: 'var(--at-danger)' }}>Vencido</span>}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--at-ink)', marginBottom: '4px' }}>{t.titulo}</div>
                    {t.descripcion && <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', marginBottom: '6px' }}>{t.descripcion}</div>}
                    <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: 'var(--at-ink-3)', flexWrap: 'wrap' }}>
                      {t.unidad_nombre && <span>📍 {t.unidad_nombre}</span>}
                      {t.fecha_limite && <span style={{ color: vencido ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>📅 {t.fecha_limite}</span>}
                      {t.costo_estimado && <span>💰 Est. {t.costo_estimado.toFixed(2)}</span>}
                      {t.costo_real && <span>✅ Real {t.costo_real.toFixed(2)}</span>}
                      <span>🕐 {new Date(t.created_at).toLocaleDateString('es')}</span>
                    </div>
                    {t.foto_urls?.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <ImageGallery urls={t.foto_urls} maxVisible={4} />
                      </div>
                    )}
                    {t.archivo_urls?.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <ListaAdjuntos paths={t.archivo_urls} />
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
                    {/* Mismo hilo que ve el residente en su portal (las notas
                        internas quedan solo de este lado). */}
                    <button onClick={() => setConversacion(t)} title="Conversación con el residente"
                      style={{ padding: '4px 11px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: 'none', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                      💬 Conversación
                    </button>
                    <button onClick={() => eliminar(t.id)} title="Eliminar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '15px', padding: '2px 4px' }}>🗑</button>
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
          autorUserId={userId}
          canWrite={canEdit}
          esStaff
          onClose={() => setConversacion(null)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}
