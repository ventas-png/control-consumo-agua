import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { RegistroResiduo, TipoResiduo, EstadoResiduo } from '../../../types'
import Swal from 'sweetalert2'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  residuos: RegistroResiduo[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoResiduo; label: string; icon: string; color: string }[] = [
  { value: 'general',     label: 'General',     icon: '🗑️', color: '#64748b' },
  { value: 'reciclable',  label: 'Reciclable',  icon: '♻️', color: '#10b981' },
  { value: 'organico',    label: 'Orgánico',    icon: '🥬', color: '#84cc16' },
  { value: 'electronico', label: 'Electrónico', icon: '💻', color: '#0ea5e9' },
  { value: 'peligroso',   label: 'Peligroso',   icon: '☢️', color: '#ef4444' },
  { value: 'escombros',   label: 'Escombros',   icon: '🧱', color: '#d97706' },
]

const ESTADO_CONFIG: Record<EstadoResiduo, { label: string; color: string; bg: string }> = {
  pendiente:   { label: 'Pendiente',   color: '#f59e0b', bg: '#fef3c7' },
  recolectado: { label: 'Recolectado', color: '#0ea5e9', bg: '#e0f2fe' },
  procesado:   { label: 'Procesado',   color: '#10b981', bg: '#d1fae5' },
}

const blank = (): Partial<RegistroResiduo> => ({
  fecha: new Date().toISOString().slice(0, 10), tipo_residuo: 'general',
  cantidad_kg: undefined, punto_acopio: '', empresa_recolectora: '',
  estado: 'pendiente', incidencia: false, descripcion_incidencia: '', notas: '',
})

export function ResiduosTab({ residuos, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [filtroTipo, setFiltroTipo] = useState<TipoResiduo | 'todos'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<EstadoResiduo | 'todos'>('todos')
  const [form, setForm] = useState<Partial<RegistroResiduo>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const incidencias = residuos.filter(r => r.incidencia)
  const pendientes = residuos.filter(r => r.estado === 'pendiente')

  const filtered = residuos.filter(r => {
    if (filtroTipo !== 'todos' && r.tipo_residuo !== filtroTipo) return false
    if (filtroEstado !== 'todos' && r.estado !== filtroEstado) return false
    return true
  })

  // Stats
  const totalKg = filtered.filter(r => r.cantidad_kg).reduce((s, r) => s + (r.cantidad_kg ?? 0), 0)
  const reciclableKg = residuos.filter(r => r.tipo_residuo === 'reciclable' && r.cantidad_kg).reduce((s, r) => s + (r.cantidad_kg ?? 0), 0)
  const totalKgAll = residuos.filter(r => r.cantidad_kg).reduce((s, r) => s + (r.cantidad_kg ?? 0), 0)
  const pctReciclaje = totalKgAll > 0 ? Math.round((reciclableKg / totalKgAll) * 100) : 0

  function startEdit(r: RegistroResiduo) {
    setForm({
      fecha: r.fecha, tipo_residuo: r.tipo_residuo, cantidad_kg: r.cantidad_kg ?? undefined,
      punto_acopio: r.punto_acopio ?? '', empresa_recolectora: r.empresa_recolectora ?? '',
      estado: r.estado, incidencia: r.incidencia, descripcion_incidencia: r.descripcion_incidencia ?? '', notas: r.notas ?? '',
    })
    setEditId(r.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.fecha) return Swal.fire('Campo requerido', 'Ingresa la fecha.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha!, tipo_residuo: form.tipo_residuo ?? 'general',
      cantidad_kg: form.cantidad_kg ?? null,
      punto_acopio: form.punto_acopio || null, empresa_recolectora: form.empresa_recolectora || null,
      estado: form.estado ?? 'pendiente', incidencia: form.incidencia ?? false,
      descripcion_incidencia: form.descripcion_incidencia || null,
      registrado_por: userId || null, notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('registros_residuos').update(payload).eq('id', editId)
      : await supabase.from('registros_residuos').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar registro?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('registros_residuos').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoResiduo) {
    const { error } = await supabase.from('registros_residuos').update({ estado }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const tipoInfo = (t: TipoResiduo) => TIPOS.find(x => x.value === t) ?? TIPOS[0]

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px', display: 'block' }

  const columns: DataTableColumn<RegistroResiduo>[] = [
    {
      key: 'fecha',
      header: 'Fecha',
      sortable: true,
      render: row => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.fecha}</div>
          {row.incidencia && <span style={{ fontSize: '10px', fontWeight: 700, color: '#ef4444' }}>⚠ Incidencia</span>}
        </div>
      ),
    },
    {
      key: 'tipo_residuo',
      header: 'Tipo',
      sortable: true,
      accessor: row => tipoInfo(row.tipo_residuo).label,
      render: row => {
        const ti = tipoInfo(row.tipo_residuo)
        return (
          <>
            <span style={{ fontSize: '16px' }}>{ti.icon}</span>
            <div style={{ fontSize: '11px', color: ti.color, fontWeight: 600 }}>{ti.label}</div>
          </>
        )
      },
    },
    {
      key: 'cantidad_kg',
      header: 'Cantidad',
      sortable: true,
      align: 'right',
      accessor: row => row.cantidad_kg ?? 0,
      render: row => <span style={{ fontWeight: 600 }}>{row.cantidad_kg != null ? `${row.cantidad_kg} kg` : '—'}</span>,
    },
    {
      key: 'punto_acopio',
      header: 'Punto Acopio',
      sortable: true,
      accessor: row => row.punto_acopio ?? '',
      render: row => <span style={{ color: '#64748b' }}>{row.punto_acopio ?? '—'}</span>,
    },
    {
      key: 'empresa_recolectora',
      header: 'Empresa',
      sortable: true,
      accessor: row => row.empresa_recolectora ?? '',
      render: row => <span style={{ color: '#64748b' }}>{row.empresa_recolectora ?? '—'}</span>,
    },
    {
      key: 'estado',
      header: 'Estado',
      sortable: true,
      render: row => {
        const est = ESTADO_CONFIG[row.estado]
        return canEdit ? (
          <select value={row.estado} onChange={e => handleEstado(row.id, e.target.value as EstadoResiduo)}
            onClick={e => e.stopPropagation()}
            style={{ padding: '4px 8px', border: '1.5px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: est.color, background: 'white', cursor: 'pointer' }}>
            {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        ) : (
          <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: est.bg, color: est.color }}>{est.label}</span>
        )
      },
    },
    {
      key: 'acciones',
      header: '',
      render: row => (
        <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
          {canEdit && <button onClick={() => startEdit(row)} style={{ padding: '4px 8px', background: '#f1f5f9', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>}
          {canEdit && <button onClick={() => handleDelete(row.id)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>}
        </div>
      ),
    },
  ]

  return (
    <div style={{ padding: '20px 24px' }}>

      {incidencias.length > 0 && (
        <div style={{ background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🚨</span>
          <span style={{ fontSize: '13px', color: '#991b1b', fontWeight: 600 }}>
            {incidencias.length} incidencia{incidencias.length > 1 ? 's' : ''} registrada{incidencias.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total registros', value: String(residuos.length), icon: '📊', color: '#0ea5e9' },
          { label: 'Pendientes', value: String(pendientes.length), icon: '⏳', color: '#f59e0b' },
          { label: 'Total Kg registrado', value: totalKgAll > 0 ? `${totalKgAll.toFixed(1)} kg` : '—', icon: '⚖️', color: '#10b981' },
          { label: '% Reciclaje', value: totalKgAll > 0 ? `${pctReciclaje}%` : '—', icon: '♻️', color: '#84cc16' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
          Registros
          {totalKg > 0 && filtroTipo !== 'todos' && <span style={{ fontWeight: 400, fontSize: '13px', color: '#64748b', marginLeft: '8px' }}>{totalKg.toFixed(1)} kg filtrados</span>}
        </h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Registro' : 'Nuevo Registro'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Fecha *</label>
              <input style={inputStyle} type="date" value={form.fecha ?? ''} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Tipo de residuo</label>
              <select style={inputStyle} value={form.tipo_residuo ?? 'general'} onChange={e => setForm(f => ({ ...f, tipo_residuo: e.target.value as TipoResiduo }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'pendiente'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoResiduo }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Cantidad (kg)</label>
              <input style={inputStyle} type="number" min="0" step="0.1" value={form.cantidad_kg ?? ''} onChange={e => setForm(f => ({ ...f, cantidad_kg: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.0" />
            </div>
            <div>
              <label style={labelStyle}>Punto de acopio</label>
              <input style={inputStyle} value={form.punto_acopio ?? ''} onChange={e => setForm(f => ({ ...f, punto_acopio: e.target.value }))} placeholder="ej. Área de reciclaje" />
            </div>
            <div>
              <label style={labelStyle}>Empresa recolectora</label>
              <input style={inputStyle} value={form.empresa_recolectora ?? ''} onChange={e => setForm(f => ({ ...f, empresa_recolectora: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.incidencia ?? false} onChange={e => setForm(f => ({ ...f, incidencia: e.target.checked }))} />
                Hay incidencia
              </label>
            </div>
            {form.incidencia && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Descripción de la incidencia</label>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '50px' }} value={form.descripcion_incidencia ?? ''} onChange={e => setForm(f => ({ ...f, descripcion_incidencia: e.target.value }))} />
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '46px' }} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Registrar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros pill por tipo (UX custom con contadores) */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {TIPOS.map(t => (
          <button key={t.value} onClick={() => setFiltroTipo(filtroTipo === t.value ? 'todos' : t.value)}
            style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroTipo === t.value ? t.color : '#e2e8f0',
              background: filtroTipo === t.value ? `${t.color}18` : 'white',
              color: filtroTipo === t.value ? t.color : '#64748b' }}>
            {t.icon} {t.label} ({residuos.filter(r => r.tipo_residuo === t.value).length})
          </button>
        ))}
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        rowKey="id"
        searchableKeys={[
          row => row.punto_acopio ?? '',
          row => row.empresa_recolectora ?? '',
          row => row.notas ?? '',
        ]}
        searchPlaceholder="Buscar por punto, empresa o notas…"
        filters={[
          {
            key: 'estado',
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as EstadoResiduo | 'todos'),
            options: [
              { value: 'todos', label: 'Todos los estados' },
              ...Object.entries(ESTADO_CONFIG).map(([k, v]) => ({ value: k, label: v.label })),
            ],
          },
        ]}
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        rowStyle={row => row.incidencia ? { background: '#fff7ed' } : {}}
        emptyState={{ icon: '♻️', title: 'No hay registros de residuos' }}
      />
    </div>
  )
}
