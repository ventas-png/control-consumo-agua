import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ReservaSTR, EstadoSTR, PlataformaSTR, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  reservasSTR: ReservaSTR[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoSTR, { label: string; color: string; bg: string }> = {
  confirmada: { label: 'Confirmada', color: '#0ea5e9', bg: '#e0f2fe' },
  en_curso:   { label: 'En curso',   color: '#8b5cf6', bg: '#ede9fe' },
  completada: { label: 'Completada', color: '#10b981', bg: '#d1fae5' },
  cancelada:  { label: 'Cancelada',  color: '#ef4444', bg: '#fee2e2' },
}

const PLATAFORMA_ICON: Record<PlataformaSTR, string> = {
  airbnb: '🏠', booking: '🌐', vrbo: '🏡', directo: '📱', otro: '📋',
}

const blank = (): Partial<ReservaSTR> => ({
  huesped_nombre: '', huesped_email: '', huesped_telefono: '',
  fecha_entrada: '', fecha_salida: '', num_adultos: 1, num_ninos: 0,
  plataforma: 'directo', monto_noche: undefined, monto_total: undefined,
  estado: 'confirmada', notas: '',
})

function calcNoches(entrada: string, salida: string) {
  if (!entrada || !salida) return 0
  const d1 = new Date(entrada), d2 = new Date(salida)
  return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86400000))
}

export function STRTab({ reservasSTR, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoSTR | 'todos'>('todos')
  const [form, setForm] = useState<Partial<ReservaSTR>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  const filtered = reservasSTR.filter(r => filtroEstado === 'todos' || r.estado === filtroEstado)

  const enCurso   = reservasSTR.filter(r => r.estado === 'en_curso').length
  const proximas  = reservasSTR.filter(r => r.estado === 'confirmada' && r.fecha_entrada >= today).length
  const ingresoMes = reservasSTR
    .filter(r => r.estado !== 'cancelada' && r.fecha_entrada?.slice(0, 7) === today.slice(0, 7))
    .reduce((s, r) => s + (r.monto_total ?? 0), 0)

  function startEdit(r: ReservaSTR) {
    setForm({
      huesped_nombre: r.huesped_nombre, huesped_email: r.huesped_email ?? '',
      huesped_telefono: r.huesped_telefono ?? '', unidad_id: r.unidad_id ?? undefined,
      fecha_entrada: r.fecha_entrada, fecha_salida: r.fecha_salida,
      num_adultos: r.num_adultos, num_ninos: r.num_ninos,
      plataforma: r.plataforma, monto_noche: r.monto_noche ?? undefined,
      monto_total: r.monto_total ?? undefined, estado: r.estado, notas: r.notas ?? '',
    })
    setEditId(r.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  function recalcTotal(f: Partial<ReservaSTR>) {
    const noches = calcNoches(f.fecha_entrada ?? '', f.fecha_salida ?? '')
    if (f.monto_noche && noches > 0) return { ...f, monto_total: f.monto_noche * noches }
    return f
  }

  async function handleSave() {
    if (!form.huesped_nombre?.trim()) return Swal.fire('Campo requerido', 'Ingresa el nombre del huésped.', 'warning')
    if (!form.fecha_entrada || !form.fecha_salida) return Swal.fire('Campo requerido', 'Ingresa las fechas.', 'warning')
    if (form.fecha_salida! <= form.fecha_entrada!) return Swal.fire('Fechas inválidas', 'La salida debe ser posterior a la entrada.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      huesped_nombre: form.huesped_nombre!.trim(),
      huesped_email: form.huesped_email || null,
      huesped_telefono: form.huesped_telefono || null,
      unidad_id: form.unidad_id || null,
      fecha_entrada: form.fecha_entrada!, fecha_salida: form.fecha_salida!,
      num_adultos: form.num_adultos ?? 1, num_ninos: form.num_ninos ?? 0,
      plataforma: form.plataforma ?? 'directo',
      monto_noche: form.monto_noche ?? null,
      monto_total: form.monto_total ?? null,
      estado: form.estado ?? 'confirmada',
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('reservas_str').update(payload).eq('id', editId)
      : await supabase.from('reservas_str').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar reserva?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('reservas_str').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoSTR) {
    const { error } = await supabase.from('reservas_str').update({ estado }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total reservas',  value: String(reservasSTR.length),    icon: '🏨', color: '#0ea5e9' },
          { label: 'En curso',        value: String(enCurso),               icon: '🔑', color: '#8b5cf6' },
          { label: 'Próximas',        value: String(proximas),              icon: '📅', color: '#f59e0b' },
          { label: 'Ingreso del mes', value: ingresoMes > 0 ? `${moneda} ${ingresoMes.toFixed(0)}` : '—', icon: '💰', color: '#10b981' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Rentas de Corto Plazo (STR)</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nueva Reserva</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Reserva' : 'Nueva Reserva STR'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Huésped *</label>
              <input style={inputStyle} value={form.huesped_nombre ?? ''} onChange={e => setForm(f => ({ ...f, huesped_nombre: e.target.value }))} placeholder="Nombre completo" />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} type="email" value={form.huesped_email ?? ''} onChange={e => setForm(f => ({ ...f, huesped_email: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Teléfono</label>
              <input style={inputStyle} value={form.huesped_telefono ?? ''} onChange={e => setForm(f => ({ ...f, huesped_telefono: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id ?? ''} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value || undefined }))}>
                <option value="">Sin asignar</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Entrada *</label>
              <input style={inputStyle} type="date" value={form.fecha_entrada ?? ''} onChange={e => setForm(f => recalcTotal({ ...f, fecha_entrada: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Salida *</label>
              <input style={inputStyle} type="date" value={form.fecha_salida ?? ''} onChange={e => setForm(f => recalcTotal({ ...f, fecha_salida: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Adultos</label>
              <input style={inputStyle} type="number" min="1" value={form.num_adultos ?? 1} onChange={e => setForm(f => ({ ...f, num_adultos: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>Niños</label>
              <input style={inputStyle} type="number" min="0" value={form.num_ninos ?? 0} onChange={e => setForm(f => ({ ...f, num_ninos: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>Plataforma</label>
              <select style={inputStyle} value={form.plataforma ?? 'directo'} onChange={e => setForm(f => ({ ...f, plataforma: e.target.value as PlataformaSTR }))}>
                <option value="airbnb">Airbnb</option>
                <option value="booking">Booking.com</option>
                <option value="vrbo">VRBO</option>
                <option value="directo">Directo</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tarifa/noche ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto_noche ?? ''} onChange={e => setForm(f => recalcTotal({ ...f, monto_noche: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Total ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto_total ?? ''} onChange={e => setForm(f => ({ ...f, monto_total: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'confirmada'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoSTR }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas</label>
              <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          {form.fecha_entrada && form.fecha_salida && form.fecha_salida > form.fecha_entrada && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: '#64748b' }}>
              📅 {calcNoches(form.fecha_entrada, form.fecha_salida)} noches
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'confirmada', 'en_curso', 'completada', 'cancelada'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? '#0ea5e9' : '#e2e8f0',
              background: filtroEstado === e ? '#e0f2fe' : 'white',
              color: filtroEstado === e ? '#0ea5e9' : '#64748b' }}>
            {e === 'todos' ? `Todas (${reservasSTR.length})` : `${ESTADO_CONFIG[e as EstadoSTR]?.label} (${reservasSTR.filter(r => r.estado === e).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏨</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay reservas registradas</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
          {filtered.map(r => {
            const est = ESTADO_CONFIG[r.estado]
            const noches = calcNoches(r.fecha_entrada, r.fecha_salida)
            return (
              <div key={r.id} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>{PLATAFORMA_ICON[r.plataforma]} {r.huesped_nombre}</div>
                    {r.unidad_nombre && <div style={{ fontSize: '11px', color: '#94a3b8' }}>🏠 {r.unidad_nombre}</div>}
                  </div>
                  <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
                  <div>📅 {r.fecha_entrada} → {r.fecha_salida} <span style={{ fontWeight: 600, color: '#0f172a' }}>({noches}n)</span></div>
                  <div>👥 {r.num_adultos} adultos{r.num_ninos > 0 ? ` · ${r.num_ninos} niños` : ''}</div>
                  {r.monto_total && <div style={{ fontWeight: 700, color: '#0f172a' }}>💰 {moneda} {r.monto_total.toFixed(2)}</div>}
                  {r.huesped_telefono && <div>📞 {r.huesped_telefono}</div>}
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {r.estado === 'confirmada' && (
                      <button onClick={() => handleEstado(r.id, 'en_curso')} style={{ flex: 1, padding: '4px 8px', background: '#ede9fe', color: '#7c3aed', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Check-in</button>
                    )}
                    {r.estado === 'en_curso' && (
                      <button onClick={() => handleEstado(r.id, 'completada')} style={{ flex: 1, padding: '4px 8px', background: '#d1fae5', color: '#059669', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Check-out</button>
                    )}
                    <button onClick={() => startEdit(r)} style={{ padding: '4px 8px', background: '#f1f5f9', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(r.id)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
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
