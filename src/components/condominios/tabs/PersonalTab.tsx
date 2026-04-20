import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { PersonalCondominio, CargoPersonal, EstadoPersonal, TurnoPersonal } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  personal: PersonalCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CARGOS: { value: CargoPersonal; label: string; icon: string }[] = [
  { value: 'conserje',       label: 'Conserje',       icon: '🧹' },
  { value: 'guardia',        label: 'Guardia',        icon: '💂' },
  { value: 'jardinero',      label: 'Jardinero',      icon: '🌿' },
  { value: 'mantenimiento',  label: 'Mantenimiento',  icon: '🔧' },
  { value: 'administrador',  label: 'Administrador',  icon: '👔' },
  { value: 'otro',           label: 'Otro',           icon: '👤' },
]

const ESTADO_CONFIG: Record<EstadoPersonal, { label: string; color: string; bg: string }> = {
  activo:      { label: 'Activo',      color: '#10b981', bg: '#d1fae5' },
  inactivo:    { label: 'Inactivo',    color: '#64748b', bg: '#f1f5f9' },
  vacaciones:  { label: 'Vacaciones',  color: '#8b5cf6', bg: '#ede9fe' },
  incapacidad: { label: 'Incapacidad', color: '#f59e0b', bg: '#fef3c7' },
}

const blank = (): Partial<PersonalCondominio> => ({
  nombre: '', cargo: 'conserje', telefono: '', email: '',
  fecha_ingreso: '', turno: 'diurno', estado: 'activo',
  salario: undefined, dpi: '', notas: '',
})

export function PersonalTab({ personal, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroCargo, setFiltroCargo] = useState<CargoPersonal | 'todos'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<EstadoPersonal | 'todos'>('activo')
  const [form, setForm] = useState<Partial<PersonalCondominio>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = personal.filter(p => {
    if (filtroCargo !== 'todos' && p.cargo !== filtroCargo) return false
    if (filtroEstado !== 'todos' && p.estado !== filtroEstado) return false
    return true
  })

  const planillaMensual = personal.filter(p => p.estado === 'activo').reduce((s, p) => s + (p.salario ?? 0), 0)

  function startEdit(p: PersonalCondominio) {
    setForm({
      nombre: p.nombre, cargo: p.cargo, telefono: p.telefono ?? '',
      email: p.email ?? '', fecha_ingreso: p.fecha_ingreso ?? '', turno: p.turno,
      estado: p.estado, salario: p.salario ?? undefined, dpi: p.dpi ?? '', notas: p.notas ?? '',
    })
    setEditId(p.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.nombre?.trim()) return Swal.fire('Campo requerido', 'Ingresa el nombre.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre!.trim(), cargo: form.cargo ?? 'conserje',
      telefono: form.telefono || null, email: form.email || null,
      fecha_ingreso: form.fecha_ingreso || null, turno: form.turno ?? 'diurno',
      estado: form.estado ?? 'activo', salario: form.salario ?? null,
      dpi: form.dpi || null, notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('personal_condominio').update(payload).eq('id', editId)
      : await supabase.from('personal_condominio').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar personal?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('personal_condominio').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoPersonal) {
    const { error } = await supabase.from('personal_condominio').update({ estado }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const cargoInfo = (c: CargoPersonal) => CARGOS.find(x => x.value === c) ?? CARGOS[CARGOS.length - 1]
  const turnoLabel: Record<TurnoPersonal, string> = { diurno: '☀️ Diurno', nocturno: '🌙 Nocturno', rotativo: '🔄 Rotativo' }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Personal del Condominio</h2>
          {planillaMensual > 0 && (
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Planilla mensual activa: <strong style={{ color: '#0ea5e9' }}>{moneda} {planillaMensual.toFixed(2)}</strong>
            </span>
          )}
        </div>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Agregar Personal
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Empleado' : 'Nuevo Empleado'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Nombre *</label>
              <input style={inputStyle} value={form.nombre ?? ''} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre completo" />
            </div>
            <div>
              <label style={labelStyle}>Cargo</label>
              <select style={inputStyle} value={form.cargo ?? 'conserje'} onChange={e => setForm(f => ({ ...f, cargo: e.target.value as CargoPersonal }))}>
                {CARGOS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Turno</label>
              <select style={inputStyle} value={form.turno ?? 'diurno'} onChange={e => setForm(f => ({ ...f, turno: e.target.value as TurnoPersonal }))}>
                <option value="diurno">☀️ Diurno</option>
                <option value="nocturno">🌙 Nocturno</option>
                <option value="rotativo">🔄 Rotativo</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'activo'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoPersonal }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Teléfono</label>
              <input style={inputStyle} value={form.telefono ?? ''} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} placeholder="+502 0000-0000" />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} type="email" value={form.email ?? ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>DPI / Identificación</label>
              <input style={inputStyle} value={form.dpi ?? ''} onChange={e => setForm(f => ({ ...f, dpi: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Fecha de ingreso</label>
              <input style={inputStyle} type="date" value={form.fecha_ingreso ?? ''} onChange={e => setForm(f => ({ ...f, fecha_ingreso: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Salario mensual ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.salario ?? ''} onChange={e => setForm(f => ({ ...f, salario: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '50px' }} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {(['todos', 'activo', 'inactivo', 'vacaciones', 'incapacidad'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? '#0ea5e9' : '#e2e8f0',
              background: filtroEstado === e ? '#e0f2fe' : 'white',
              color: filtroEstado === e ? '#0ea5e9' : '#64748b' }}>
            {e === 'todos' ? `Todos (${personal.length})` : `${ESTADO_CONFIG[e as EstadoPersonal]?.label ?? e} (${personal.filter(p => p.estado === e).length})`}
          </button>
        ))}
        <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 4px' }} />
        <select value={filtroCargo} onChange={e => setFiltroCargo(e.target.value as CargoPersonal | 'todos')}
          style={{ padding: '5px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', background: '#f8fafc' }}>
          <option value="todos">Todos los cargos</option>
          {CARGOS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
        </select>
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>👥</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay personal registrado</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
          {filtered.map(p => {
            const ci = cargoInfo(p.cargo)
            const est = ESTADO_CONFIG[p.estado]
            return (
              <div key={p.id} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                      {ci.icon}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>{p.nombre}</div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>{ci.label}</div>
                    </div>
                  </div>
                  <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color, whiteSpace: 'nowrap' }}>
                    {est.label}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: '#64748b' }}>
                  <div>{turnoLabel[p.turno]}</div>
                  {p.telefono && <div>📞 {p.telefono}</div>}
                  {p.fecha_ingreso && <div>📅 Desde: {p.fecha_ingreso}</div>}
                  {p.salario != null && <div style={{ fontWeight: 600, color: '#0f172a' }}>{moneda} {p.salario.toFixed(2)}/mes</div>}
                </div>

                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                    {p.estado === 'activo' && (
                      <button onClick={() => handleEstado(p.id, 'vacaciones')} style={{ padding: '4px 8px', background: '#ede9fe', color: '#7c3aed', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                        Vacaciones
                      </button>
                    )}
                    {(p.estado === 'vacaciones' || p.estado === 'incapacidad') && (
                      <button onClick={() => handleEstado(p.id, 'activo')} style={{ padding: '4px 8px', background: '#d1fae5', color: '#059669', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                        Reactivar
                      </button>
                    )}
                    <button onClick={() => startEdit(p)} style={{ padding: '4px 8px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(p.id)} style={{ padding: '4px 8px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🗑️</button>
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
