import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'
import { confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import type { InfraccionCondominio, Unidad, TipoInfraccion, EstadoInfraccion } from '../../../types'

interface Props {
  infracciones: InfraccionCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_CONFIG: Record<TipoInfraccion, { label: string; icon: string }> = {
  ruido:            { label: 'Ruido',            icon: '🔊' },
  basura:           { label: 'Basura',           icon: '🗑️' },
  estacionamiento:  { label: 'Estacionamiento',  icon: '🚗' },
  mascota:          { label: 'Mascota',          icon: '🐾' },
  'daños':          { label: 'Daños',            icon: '🔨' },
  otro:             { label: 'Otro',             icon: '⚠️' },
}

const ESTADO_CONFIG: Record<EstadoInfraccion, { label: string; bg: string; color: string }> = {
  emitida:      { label: 'Emitida',      bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  notificada:   { label: 'Notificada',   bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
  en_descargo:  { label: 'En descargo',  bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
  resuelta:     { label: 'Resuelta',     bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  anulada:      { label: 'Anulada',      bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
}

export function InfraccionesTab({ infracciones, unidades, proyectoId, companyId, userId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoInfraccion | 'todos'>('todos')
  const [form, setForm] = useState({
    unidad_id: '', tipo: 'ruido' as TipoInfraccion, descripcion: '',
    monto_multa: '', fecha_infraccion: new Date().toISOString().slice(0, 10),
    fecha_limite_descargo: '',
  })

  const filtradas = filtroEstado === 'todos' ? infracciones : infracciones.filter(i => i.estado === filtroEstado)

  const totales = {
    activas: infracciones.filter(i => !['resuelta','anulada'].includes(i.estado)).length,
    monto: infracciones.filter(i => i.estado !== 'anulada').reduce((s, i) => s + (i.monto_multa ?? 0), 0),
  }

  function resetForm() {
    setForm({ unidad_id: '', tipo: 'ruido', descripcion: '', monto_multa: '', fecha_infraccion: new Date().toISOString().slice(0, 10), fecha_limite_descargo: '' })
    setShowForm(false)
  }

  async function handleGuardar() {
    if (!form.descripcion.trim()) { toast.error('Ingrese la descripción de la infracción.'); return }
    if (!form.unidad_id) { toast.error('Seleccione la unidad infractora.'); return }
    setSaving(true)
    const { error } = await supabase.from('infracciones_condominio').insert({
      company_id: companyId, project_id: proyectoId, unidad_id: form.unidad_id,
      tipo: form.tipo, descripcion: form.descripcion.trim(),
      monto_multa: form.monto_multa ? Number(form.monto_multa) : null,
      estado: 'emitida', reportado_por: userId,
      fecha_infraccion: form.fecha_infraccion,
      fecha_limite_descargo: form.fecha_limite_descargo || null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Infracción registrada')
    resetForm(); onRefresh()
  }

  async function cambiarEstado(id: string, estado: EstadoInfraccion) {
    await supabase.from('infracciones_condominio').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const r = await confirm({ title: '¿Eliminar infracción?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('infracciones_condominio').delete().eq('id', id)
    onRefresh()
  }

  function notificarWA(i: InfraccionCondominio) {
    const msg = `⚠️ Infracción registrada\nUnidad: ${i.unidad_nombre ?? ''}\nTipo: ${TIPO_CONFIG[i.tipo].label}\nDescripción: ${i.descripcion}${i.monto_multa ? `\nMulta: ${moneda} ${i.monto_multa.toFixed(2)}` : ''}${i.fecha_limite_descargo ? `\nFecha límite descargo: ${i.fecha_limite_descargo}` : ''}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Infracciones</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {totales.activas} activas · <span style={{ fontWeight: 600, color: 'var(--at-danger)' }}>{moneda} {totales.monto.toFixed(2)} en multas</span>
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar infracción
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nueva infracción</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad infractora *</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="">Seleccionar...</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoInfraccion }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                {(Object.entries(TIPO_CONFIG) as [TipoInfraccion, typeof TIPO_CONFIG[TipoInfraccion]][]).map(([v, c]) => (
                  <option key={v} value={v}>{c.icon} {c.label}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Descripción *</label>
              <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Describe la infracción cometida..." rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Monto multa ({moneda})</label>
              <input type="number" value={form.monto_multa} onChange={e => setForm(f => ({ ...f, monto_multa: e.target.value }))} placeholder="0.00" min="0" step="0.01"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha infracción</label>
              <input type="date" value={form.fecha_infraccion} onChange={e => setForm(f => ({ ...f, fecha_infraccion: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha límite descargo</label>
              <input type="date" value={form.fecha_limite_descargo} onChange={e => setForm(f => ({ ...f, fecha_limite_descargo: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Registrar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista — cond:B2: migrado a <DataTable> shared */}
      <DataTable<InfraccionCondominio>
        data={filtradas}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'fecha_infraccion', direction: 'desc' }}
        searchPlaceholder="Buscar descripción, unidad…"
        searchableKeys={['descripcion', i => i.unidad_nombre ?? '']}
        filters={[{
          key: 'estado',
          label: 'Estado',
          value: filtroEstado,
          onChange: v => setFiltroEstado(v as EstadoInfraccion | 'todos'),
          options: [
            { value: 'todos', label: `Todas (${infracciones.length})` },
            ...(Object.entries(ESTADO_CONFIG) as [EstadoInfraccion, typeof ESTADO_CONFIG[EstadoInfraccion]][])
              .map(([e, cfg]) => ({ value: e, label: `${cfg.label} (${infracciones.filter(i => i.estado === e).length})` })),
          ],
        }]}
        emptyState={{ icon: '⚖️', title: 'No hay infracciones registradas' }}
        columns={[
          {
            key: 'tipo', header: 'Tipo', sortable: true,
            accessor: i => TIPO_CONFIG[i.tipo].label,
            render: i => (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--at-ink-2)' }}>
                <span style={{ fontSize: '20px' }}>{TIPO_CONFIG[i.tipo].icon}</span>
                {TIPO_CONFIG[i.tipo].label}
              </span>
            ),
          },
          {
            key: 'unidad', header: 'Unidad', sortable: true,
            accessor: i => i.unidad_nombre ?? '',
            render: i => i.unidad_nombre
              ? <span style={{ color: 'var(--at-primary)', fontWeight: 600 }}>📍 {i.unidad_nombre}</span>
              : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'descripcion', header: 'Descripción', sortable: true, hideOnMobile: true,
            render: i => <span style={{ color: 'var(--at-ink-2)' }}>{i.descripcion}</span>,
          },
          {
            key: 'monto_multa', header: 'Multa', sortable: true, align: 'right',
            accessor: i => i.monto_multa ?? 0,
            render: i => i.monto_multa
              ? <span style={{ color: 'var(--at-danger)', fontWeight: 700 }}>{moneda} {i.monto_multa.toFixed(2)}</span>
              : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'fecha_infraccion', header: 'Fecha', sortable: true, hideOnMobile: true,
            render: i => {
              const hoy = new Date().toISOString().slice(0, 10)
              const vencida = i.fecha_limite_descargo && i.fecha_limite_descargo < hoy && i.estado === 'en_descargo'
              return (
                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                  <div>📅 {i.fecha_infraccion}</div>
                  {i.fecha_limite_descargo && <div>Límite descargo: {i.fecha_limite_descargo}</div>}
                  {vencida && <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', fontWeight: 700 }}>Descargo vencido</span>}
                </div>
              )
            },
          },
          {
            key: 'estado', header: 'Estado', sortable: true,
            render: i => {
              const estado = ESTADO_CONFIG[i.estado]
              return canEdit ? (
                <select value={i.estado} onChange={e => cambiarEstado(i.id, e.target.value as EstadoInfraccion)}
                  aria-label={`Estado de infracción ${i.unidad_nombre ?? ''}`}
                  style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer', background: estado.bg, color: estado.color }}>
                  {(Object.entries(ESTADO_CONFIG) as [EstadoInfraccion, typeof ESTADO_CONFIG[EstadoInfraccion]][]).map(([v, c]) => (
                    <option key={v} value={v}>{c.label}</option>
                  ))}
                </select>
              ) : (
                <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: estado.bg, color: estado.color }}>{estado.label}</span>
              )
            },
          },
          {
            key: 'actions', header: '', align: 'right',
            render: i => (
              <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                {!['resuelta', 'anulada'].includes(i.estado) && (
                  <button onClick={() => notificarWA(i)} title="Notificar por WhatsApp" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-success)', fontSize: '15px', padding: '2px 4px' }}>💬</button>
                )}
                <button onClick={() => eliminar(i.id)} aria-label="Eliminar infracción" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '15px', padding: '2px 4px' }}>🗑</button>
              </div>
            ),
          },
        ] satisfies DataTableColumn<InfraccionCondominio>[]}
      />
    </div>
  )
}
