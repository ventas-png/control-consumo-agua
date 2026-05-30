import { useState } from 'react'
import Swal from 'sweetalert2'
import { notify, confirm } from '../../shared/Dialog'
import { supabase } from '../../../lib/supabase'
import type { ParqueoCondominio, Unidad, TipoParqueo } from '../../../types'

interface Props {
  parqueos: ParqueoCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABELS: Record<TipoParqueo, string> = {
  asignado:      'Asignado',
  visita:        'Visita',
  discapacitado: 'Discapacitado',
}

const TIPO_COLORS: Record<TipoParqueo, { bg: string; color: string }> = {
  asignado:      { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  visita:        { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  discapacitado: { bg: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)' },
}

export function ParqueosTab({ parqueos, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<TipoParqueo | 'todos'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    numero: '', tipo: 'asignado' as TipoParqueo,
    unidad_id: '', placa_vehiculo: '', marca_vehiculo: '', color_vehiculo: '', notas: '',
  })

  const filtrados = parqueos.filter(p => {
    const matchTipo = filtroTipo === 'todos' || p.tipo === filtroTipo
    const matchBusqueda = !busqueda ||
      p.numero.toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.placa_vehiculo || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.unidad_nombre || '').toLowerCase().includes(busqueda.toLowerCase())
    return matchTipo && matchBusqueda
  })

  function resetForm() {
    setForm({ numero: '', tipo: 'asignado', unidad_id: '', placa_vehiculo: '', marca_vehiculo: '', color_vehiculo: '', notas: '' })
    setShowForm(false)
    setEditingId(null)
  }

  function startEdit(p: ParqueoCondominio) {
    setForm({
      numero: p.numero, tipo: p.tipo, unidad_id: p.unidad_id ?? '',
      placa_vehiculo: p.placa_vehiculo ?? '', marca_vehiculo: p.marca_vehiculo ?? '',
      color_vehiculo: p.color_vehiculo ?? '', notas: p.notas ?? '',
    })
    setEditingId(p.id)
    setShowForm(true)
  }

  async function handleGuardar() {
    if (!form.numero.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el número de parqueo.' }); return }
    setSaving(true)
    const data = {
      company_id: companyId, project_id: proyectoId,
      numero: form.numero.trim(), tipo: form.tipo,
      unidad_id: form.unidad_id || null,
      placa_vehiculo: form.placa_vehiculo.trim() || null,
      marca_vehiculo: form.marca_vehiculo.trim() || null,
      color_vehiculo: form.color_vehiculo.trim() || null,
      notas: form.notas.trim() || null,
    }
    const { error } = editingId
      ? await supabase.from('parqueos_condominio').update(data).eq('id', editingId)
      : await supabase.from('parqueos_condominio').insert(data)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    Swal.fire({ icon: 'success', title: editingId ? 'Parqueo actualizado' : 'Parqueo registrado', timer: 1400, showConfirmButton: false })
    resetForm(); onRefresh()
  }

  async function toggleActivo(p: ParqueoCondominio) {
    await supabase.from('parqueos_condominio').update({ activo: !p.activo }).eq('id', p.id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const r = await confirm({ title: '¿Eliminar parqueo?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('parqueos_condominio').delete().eq('id', id)
    onRefresh()
  }

  const ocupados = parqueos.filter(p => p.unidad_id && p.activo).length
  const libres = parqueos.filter(p => !p.unidad_id && p.activo).length

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Parqueos</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {parqueos.length} espacios · <span style={{ color: 'var(--at-success)', fontWeight: 600 }}>{libres} libres</span> · {ocupados} asignados
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Agregar parqueo
          </button>
        )}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por número, placa, unidad..."
          style={{ flex: 1, minWidth: '200px', padding: '8px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-surface-2)' }} />
        {(['todos', 'asignado', 'visita', 'discapacitado'] as const).map(t => (
          <button key={t} onClick={() => setFiltroTipo(t)}
            style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroTipo === t ? 'var(--at-primary)' : 'var(--at-line)', background: filtroTipo === t ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: filtroTipo === t ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {t === 'todos' ? 'Todos' : TIPO_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editingId ? 'Editar parqueo' : 'Nuevo parqueo'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            {[
              { label: 'Número *', key: 'numero', placeholder: 'Ej. P-01' },
              { label: 'Placa vehículo', key: 'placa_vehiculo', placeholder: 'ABC-123' },
              { label: 'Marca', key: 'marca_vehiculo', placeholder: 'Toyota, Hyundai...' },
              { label: 'Color', key: 'color_vehiculo', placeholder: 'Blanco, Negro...' },
            ].map(({ label, key, placeholder }) => (
              <div key={key}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>{label}</label>
                <input value={form[key as keyof typeof form]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoParqueo }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                {(Object.entries(TIPO_LABELS) as [TipoParqueo, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad asignada</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="">Sin asignar</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Opcional"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Grid */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🅿️</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay parqueos registrados</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
          {filtrados.map(p => {
            const tc = TIPO_COLORS[p.tipo]
            const tieneUnidad = !!p.unidad_id
            return (
              <div key={p.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${tieneUnidad ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`, borderRadius: '14px', padding: '16px', opacity: p.activo ? 1 : 0.55 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--at-ink)' }}>{p.numero}</div>
                  <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: tc.bg, color: tc.color }}>{TIPO_LABELS[p.tipo]}</span>
                </div>
                {p.unidad_nombre && <div style={{ fontSize: '12.5px', color: 'var(--at-primary)', fontWeight: 600, marginBottom: '4px' }}>📍 {p.unidad_nombre}</div>}
                {p.placa_vehiculo && <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)', marginBottom: '2px' }}>🚗 {p.placa_vehiculo}{p.marca_vehiculo ? ` · ${p.marca_vehiculo}` : ''}{p.color_vehiculo ? ` · ${p.color_vehiculo}` : ''}</div>}
                {!tieneUnidad && <div style={{ fontSize: '12px', color: 'var(--at-success)', fontWeight: 600 }}>Disponible</div>}
                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                    <button onClick={() => startEdit(p)} style={{ flex: 1, padding: '6px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)' }}>✏️ Editar</button>
                    <button onClick={() => toggleActivo(p)} style={{ padding: '6px 10px', background: p.activo ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: '1px solid var(--at-line)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px' }}>{p.activo ? '⏸' : '▶'}</button>
                    <button onClick={() => eliminar(p.id)} style={{ padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '14px' }}>🗑</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
