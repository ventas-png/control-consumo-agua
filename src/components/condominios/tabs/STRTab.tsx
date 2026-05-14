import { useState, useEffect, type CSSProperties } from 'react'
import { supabase } from '../../../lib/supabase'
import type { ReservaSTR, EstadoSTR, PlataformaSTR, Unidad, HuespedSTR } from '../../../types'
import Swal from 'sweetalert2'
import { ImageUploader } from '../ImageUploader'

interface HuespedSTRForm {
  id?: string
  nombre: string
  identificacion: string
  es_menor: boolean
  fecha_nacimiento: string
  foto_url: string | null
  foto_documento_url: string | null
  visitante_id?: string | null
}

const defaultHuesped = (): Omit<HuespedSTRForm, 'id' | 'visitante_id'> => ({
  nombre: '', identificacion: '', es_menor: false, fecha_nacimiento: '',
  foto_url: null, foto_documento_url: null,
})

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
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [fotoDocumentoUrl, setFotoDocumentoUrl] = useState<string | null>(null)

  // Guest pre-registration
  const [huespedes, setHuespedes] = useState<HuespedSTRForm[]>([])
  const [showHuespedForm, setShowHuespedForm] = useState(false)
  const [huespedForm, setHuespedForm] = useState<Omit<HuespedSTRForm, 'id' | 'visitante_id'>>(defaultHuesped())
  const [reservaHuespedes, setReservaHuespedes] = useState<Record<string, HuespedSTR[]>>({})
  const [entryCount, setEntryCount] = useState<Record<string, number>>({})

  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    if (reservasSTR.length === 0) return
    const ids = reservasSTR.map(r => r.id)
    supabase.from('huespedes_str').select('*').in('reserva_str_id', ids).then(({ data }) => {
      if (!data) return
      const grouped: Record<string, HuespedSTR[]> = {}
      data.forEach(h => {
        if (!grouped[h.reserva_str_id]) grouped[h.reserva_str_id] = []
        grouped[h.reserva_str_id].push(h as HuespedSTR)
      })
      setReservaHuespedes(grouped)
    })
    supabase.from('visitantes').select('reserva_str_id').in('reserva_str_id', ids).then(({ data }) => {
      if (!data) return
      const counts: Record<string, number> = {}
      data.forEach((v: { reserva_str_id?: string | null }) => {
        if (v.reserva_str_id) counts[v.reserva_str_id] = (counts[v.reserva_str_id] ?? 0) + 1
      })
      setEntryCount(counts)
    })
  }, [reservasSTR])

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
    setFotoUrl(r.foto_url ?? null)
    setFotoDocumentoUrl(r.foto_documento_url ?? null)
    setHuespedes((reservaHuespedes[r.id] ?? []).map(h => ({
      id: h.id,
      nombre: h.nombre,
      identificacion: h.identificacion ?? '',
      es_menor: h.es_menor,
      fecha_nacimiento: h.fecha_nacimiento ?? '',
      foto_url: h.foto_url ?? null,
      foto_documento_url: h.foto_documento_url ?? null,
      visitante_id: h.visitante_id,
    })))
    setShowHuespedForm(false)
    setHuespedForm(defaultHuesped())
    setEditId(r.id); setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false); setEditId(null); setForm(blank())
    setFotoUrl(null); setFotoDocumentoUrl(null)
    setHuespedes([]); setShowHuespedForm(false); setHuespedForm(defaultHuesped())
  }

  function recalcTotal(f: Partial<ReservaSTR>) {
    const noches = calcNoches(f.fecha_entrada ?? '', f.fecha_salida ?? '')
    if (f.monto_noche && noches > 0) return { ...f, monto_total: f.monto_noche * noches }
    return f
  }

  function agregarHuesped() {
    if (!huespedForm.nombre.trim()) {
      Swal.fire('Error', 'Ingrese el nombre de la persona.', 'error')
      return
    }
    const maxAdicionales = (form.num_adultos ?? 1) + (form.num_ninos ?? 0) - 1
    if (huespedes.length >= maxAdicionales) {
      Swal.fire('Capacidad', 'Ya se alcanzó el máximo de personas adicionales para esta reserva.', 'warning')
      return
    }
    setHuespedes(prev => [...prev, { ...huespedForm, nombre: huespedForm.nombre.trim() }])
    setHuespedForm(defaultHuesped())
    setShowHuespedForm(false)
  }

  function quitarHuesped(index: number) {
    if (huespedes[index]?.visitante_id) {
      Swal.fire('No permitido', 'Esta persona ya registró su ingreso y no puede eliminarse.', 'info')
      return
    }
    setHuespedes(prev => prev.filter((_, i) => i !== index))
  }

  async function saveGuests(reservaId: string) {
    const existing = reservaHuespedes[reservaId] ?? []
    const formIds = new Set(huespedes.filter(h => h.id).map(h => h.id!))

    const toDelete = existing.filter(h => !h.visitante_id && !formIds.has(h.id)).map(h => h.id)
    if (toDelete.length > 0) {
      await supabase.from('huespedes_str').delete().in('id', toDelete)
    }

    for (const h of huespedes.filter(g => g.id && !g.visitante_id)) {
      await supabase.from('huespedes_str').update({
        nombre: h.nombre.trim(),
        identificacion: h.identificacion.trim() || null,
        es_menor: h.es_menor,
        fecha_nacimiento: h.es_menor && h.fecha_nacimiento ? h.fecha_nacimiento : null,
        foto_url: h.foto_url,
        foto_documento_url: h.foto_documento_url,
      }).eq('id', h.id!)
    }

    const toInsert = huespedes.filter(h => !h.id && h.nombre.trim())
    if (toInsert.length > 0) {
      await supabase.from('huespedes_str').insert(toInsert.map(h => ({
        reserva_str_id: reservaId,
        nombre: h.nombre.trim(),
        identificacion: h.identificacion.trim() || null,
        es_menor: h.es_menor,
        fecha_nacimiento: h.es_menor && h.fecha_nacimiento ? h.fecha_nacimiento : null,
        foto_url: h.foto_url,
        foto_documento_url: h.foto_documento_url,
      })))
    }
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
      foto_url: fotoUrl,
      foto_documento_url: fotoDocumentoUrl,
    }

    let reservaId: string | null = editId
    if (editId) {
      const { error } = await supabase.from('reservas_str').update(payload).eq('id', editId)
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    } else {
      const { data, error } = await supabase.from('reservas_str').insert(payload).select('id').single()
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
      reservaId = data.id
    }

    if (reservaId) await saveGuests(reservaId)
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

  const maxAdicionales = (form.num_adultos ?? 1) + (form.num_ninos ?? 0) - 1

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

            {/* Fotos del huésped principal */}
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '8px', paddingTop: '4px', borderTop: '1px solid #e2e8f0' }}>
                Fotografías del huésped principal <span style={{ fontWeight: 400, color: '#94a3b8' }}>(opcional — se pueden completar al ingreso)</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', maxWidth: '400px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '4px' }}>Foto del huésped</div>
                  <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="str_guests" label="Foto del huésped" capture />
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '4px' }}>Foto del documento / DPI</div>
                  <ImageUploader value={fotoDocumentoUrl} onChange={setFotoDocumentoUrl} folder="str_guests" label="DPI / Documento" capture />
                </div>
              </div>
            </div>

            {/* Personas del grupo */}
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b' }}>
                  Personas del grupo
                  <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>
                    (principal + {huespedes.length}/{maxAdicionales} adicionales pre-registradas)
                  </span>
                </div>
                {!showHuespedForm && huespedes.length < maxAdicionales && (
                  <button onClick={() => setShowHuespedForm(true)}
                    style={{ padding: '4px 12px', background: '#f8fafc', color: '#374151', border: '1.5px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    + Agregar persona
                  </button>
                )}
              </div>

              {/* Principal (always shown) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', marginBottom: '6px' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'white', fontWeight: 700, flexShrink: 0 }}>1</div>
                <div style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{form.huesped_nombre || 'Huésped principal'}</div>
                <span style={{ fontSize: '10px', color: '#0369a1', fontWeight: 600, padding: '2px 8px', background: '#e0f2fe', borderRadius: '10px' }}>Principal</span>
              </div>

              {/* Additional guests */}
              {huespedes.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: h.visitante_id ? '#f0fdf4' : '#f8fafc', border: `1px solid ${h.visitante_id ? '#86efac' : '#e2e8f0'}`, borderRadius: '8px', marginBottom: '6px' }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#475569', fontWeight: 700, flexShrink: 0 }}>{i + 2}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                      {h.es_menor ? '👶 ' : ''}{h.nombre}
                      {h.visitante_id && <span style={{ marginLeft: 6, fontSize: '10px', color: '#16a34a', fontWeight: 600 }}>✓ Ingresado</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      {h.es_menor
                        ? `Menor${h.fecha_nacimiento ? ` · Nac. ${h.fecha_nacimiento}` : ''}`
                        : h.identificacion ? `DPI: ${h.identificacion}` : 'Sin documento'}
                    </div>
                  </div>
                  {!h.visitante_id && (
                    <button onClick={() => quitarHuesped(i)}
                      style={{ width: 22, height: 22, borderRadius: '50%', background: '#fee2e2', border: 'none', cursor: 'pointer', fontSize: '12px', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      ×
                    </button>
                  )}
                </div>
              ))}

              {/* Add guest form */}
              {showHuespedForm && (
                <div style={{ padding: '14px', background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#374151' }}>Nueva persona del grupo</div>
                  <div>
                    <label style={labelStyle}>Nombre *</label>
                    <input style={inputStyle} value={huespedForm.nombre} onChange={e => setHuespedForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre completo" />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" checked={huespedForm.es_menor} onChange={e => setHuespedForm(f => ({ ...f, es_menor: e.target.checked, identificacion: '' }))} />
                    Es menor de edad
                    {huespedForm.es_menor && <span style={{ padding: '2px 7px', background: '#fef9c3', color: '#854d0e', borderRadius: '20px', fontSize: '10px' }}>Menor</span>}
                  </label>
                  {huespedForm.es_menor ? (
                    <div>
                      <label style={labelStyle}>Fecha de nacimiento (opcional)</label>
                      <input type="date" style={inputStyle} value={huespedForm.fecha_nacimiento} onChange={e => setHuespedForm(f => ({ ...f, fecha_nacimiento: e.target.value }))} />
                    </div>
                  ) : (
                    <div>
                      <label style={labelStyle}>DPI / Identificación</label>
                      <input style={inputStyle} value={huespedForm.identificacion} onChange={e => setHuespedForm(f => ({ ...f, identificacion: e.target.value }))} placeholder="Número de documento" />
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: huespedForm.es_menor ? '1fr' : '1fr 1fr', gap: '10px' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '3px' }}>Foto de la persona</div>
                      <ImageUploader value={huespedForm.foto_url} onChange={v => setHuespedForm(f => ({ ...f, foto_url: v }))} folder="str_guests" label="Foto" capture />
                    </div>
                    {!huespedForm.es_menor && (
                      <div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '3px' }}>Foto del documento</div>
                        <ImageUploader value={huespedForm.foto_documento_url} onChange={v => setHuespedForm(f => ({ ...f, foto_documento_url: v }))} folder="str_guests" label="Documento" capture />
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={agregarHuesped}
                      style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                      + Agregar
                    </button>
                    <button onClick={() => { setShowHuespedForm(false); setHuespedForm(defaultHuesped()) }}
                      style={{ padding: '7px 14px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {filtered.map(r => {
            const est = ESTADO_CONFIG[r.estado]
            const noches = calcNoches(r.fecha_entrada, r.fecha_salida)
            const preregistrados = (reservaHuespedes[r.id] ?? []).length
            const ingresados = entryCount[r.id] ?? 0
            const capacidad = r.num_adultos + r.num_ninos
            const lleno = ingresados >= capacidad
            return (
              <div key={r.id} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    {r.foto_url
                      ? <img src={r.foto_url} alt={r.huesped_nombre} style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid #e2e8f0' }} />
                      : <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>🏠</div>
                    }
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>{PLATAFORMA_ICON[r.plataforma]} {r.huesped_nombre}</div>
                      {r.unidad_nombre && <div style={{ fontSize: '11px', color: '#94a3b8' }}>🏠 {r.unidad_nombre}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                    <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                    {r.foto_documento_url && (
                      <a href={r.foto_documento_url} target="_blank" rel="noreferrer" style={{ fontSize: '10px', color: '#0369a1', textDecoration: 'none', fontWeight: 600 }}>🪪 Ver doc.</a>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
                  <div>📅 {r.fecha_entrada} → {r.fecha_salida} <span style={{ fontWeight: 600, color: '#0f172a' }}>({noches}n)</span></div>
                  <div>👥 {r.num_adultos} adultos{r.num_ninos > 0 ? ` · ${r.num_ninos} niños` : ''}</div>
                  {r.monto_total && <div style={{ fontWeight: 700, color: '#0f172a' }}>💰 {moneda} {r.monto_total.toFixed(2)}</div>}
                  {r.huesped_telefono && <div>📞 {r.huesped_telefono}</div>}
                </div>
                {/* Group progress */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: lleno ? '#dcfce7' : '#fef3c7', color: lleno ? '#16a34a' : '#92400e' }}>
                    {ingresados}/{capacidad} ingresados
                  </span>
                  {preregistrados > 0 && !lleno && (
                    <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#eff6ff', color: '#2563eb' }}>
                      {preregistrados} pre-reg.
                    </span>
                  )}
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
