import { useState, useEffect, type CSSProperties } from 'react'
import { supabase } from '../../../lib/supabase'
import type { ReservaSTR, EstadoSTR, PlataformaSTR, PoliticaCancelacionSTR, Unidad, HuespedSTR } from '../../../types'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'
import { ImageUploader } from '../../shared/ImageUploader'
import { SecureImage } from '../../shared/SecureImage'
import { SecureFileLink } from '../../shared/SecureFileLink'

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
  confirmada: { label: 'Confirmada', color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  en_curso:   { label: 'En curso',   color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  completada: { label: 'Completada', color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  cancelada:  { label: 'Cancelada',  color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
}

const PLATAFORMA_ICON: Record<PlataformaSTR, string> = {
  airbnb: '🏠', booking: '🌐', vrbo: '🏡', directo: '📱', otro: '📋',
}

const POLITICA_LABEL: Record<PoliticaCancelacionSTR, string> = {
  flexible: 'Flexible', moderada: 'Moderada', estricta: 'Estricta',
  no_reembolsable: 'No reembolsable', na: 'N/A', otra: 'Otra',
}

const blank = (): Partial<ReservaSTR> => ({
  huesped_nombre: '', huesped_email: '', huesped_telefono: '',
  codigo_confirmacion: '', fecha_reservacion: '',
  fecha_entrada: '', fecha_salida: '',
  hora_llegada_estimada: '', hora_salida_estimada: '',
  num_adultos: 1, num_ninos: 0, num_bebes: 0,
  plataforma: 'directo', monto_noche: undefined, monto_total: undefined,
  estado: 'confirmada', politica_cancelacion: 'na', mascotas: false, notas: '',
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
    supabase.from('visitantes').select('reserva_str_id').in('reserva_str_id', ids).is('hora_salida', null).then(({ data }) => {
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
      codigo_confirmacion: r.codigo_confirmacion ?? '',
      fecha_reservacion: r.fecha_reservacion ?? '',
      fecha_entrada: r.fecha_entrada, fecha_salida: r.fecha_salida,
      hora_llegada_estimada: (r.hora_llegada_estimada ?? '').slice(0, 5),
      hora_salida_estimada: (r.hora_salida_estimada ?? '').slice(0, 5),
      num_adultos: r.num_adultos, num_ninos: r.num_ninos, num_bebes: r.num_bebes ?? 0,
      plataforma: r.plataforma, monto_noche: r.monto_noche ?? undefined,
      monto_total: r.monto_total ?? undefined, estado: r.estado,
      politica_cancelacion: r.politica_cancelacion ?? 'na', mascotas: r.mascotas ?? false,
      notas: r.notas ?? '',
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
      notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre de la persona.' })
      return
    }
    const maxAdicionales = (form.num_adultos ?? 1) + (form.num_ninos ?? 0) - 1
    if (huespedes.length >= maxAdicionales) {
      notify({ variant: 'warning', title: 'Capacidad', text: 'Ya se alcanzó el máximo de personas adicionales para esta reserva.' })
      return
    }
    setHuespedes(prev => [...prev, { ...huespedForm, nombre: huespedForm.nombre.trim() }])
    setHuespedForm(defaultHuesped())
    setShowHuespedForm(false)
  }

  function quitarHuesped(index: number) {
    if (huespedes[index]?.visitante_id) {
      notify({ variant: 'info', title: 'No permitido', text: 'Esta persona ya registró su ingreso y no puede eliminarse.' })
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
    if (!form.huesped_nombre?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el nombre del huésped.' })
    if (!form.fecha_entrada || !form.fecha_salida) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa las fechas.' })
    if (form.fecha_salida! <= form.fecha_entrada!) return notify({ variant: 'warning', title: 'Fechas inválidas', text: 'La salida debe ser posterior a la entrada.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      huesped_nombre: form.huesped_nombre!.trim(),
      huesped_email: form.huesped_email || null,
      huesped_telefono: form.huesped_telefono || null,
      codigo_confirmacion: form.codigo_confirmacion?.trim() || null,
      fecha_reservacion: form.fecha_reservacion || null,
      unidad_id: form.unidad_id || null,
      fecha_entrada: form.fecha_entrada!, fecha_salida: form.fecha_salida!,
      hora_llegada_estimada: form.hora_llegada_estimada || null,
      hora_salida_estimada: form.hora_salida_estimada || null,
      num_adultos: form.num_adultos ?? 1, num_ninos: form.num_ninos ?? 0,
      num_bebes: form.num_bebes ?? 0,
      plataforma: form.plataforma ?? 'directo',
      monto_noche: form.monto_noche ?? null,
      monto_total: form.monto_total ?? null,
      estado: form.estado ?? 'confirmada',
      politica_cancelacion: form.politica_cancelacion || null,
      mascotas: form.mascotas ?? false,
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
    const r = await Swal.fire({ title: '¿Eliminar reserva?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: 'var(--at-danger)' })
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

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  const maxAdicionales = (form.num_adultos ?? 1) + (form.num_ninos ?? 0) - 1

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total reservas',  value: String(reservasSTR.length),    icon: '🏨', color: 'var(--at-primary)' },
          { label: 'En curso',        value: String(enCurso),               icon: '🔑', color: 'var(--at-accent)' },
          { label: 'Próximas',        value: String(proximas),              icon: '📅', color: 'var(--at-warning)' },
          { label: 'Ingreso del mes', value: ingresoMes > 0 ? `${moneda} ${ingresoMes.toFixed(0)}` : '—', icon: '💰', color: 'var(--at-success)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Rentas de Corto Plazo (STR)</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nueva Reserva</button>
        )}
      </div>

      {showForm && (
        <div onClick={e => { if (e.target === e.currentTarget) cancelForm() }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '680px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{editId ? 'Editar Reserva' : 'Nueva Reserva STR'}</h3>
              <button onClick={cancelForm}
                style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--at-chip)', border: 'none', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--at-ink-3)', lineHeight: 1 }}>×</button>
            </div>
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
              <label style={labelStyle}>Código de confirmación</label>
              <input style={inputStyle} value={form.codigo_confirmacion ?? ''} onChange={e => setForm(f => ({ ...f, codigo_confirmacion: e.target.value }))} placeholder="Ej. HMABCD123" />
            </div>
            <div>
              <label style={labelStyle}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id ?? ''} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value || undefined }))}>
                <option value="">Sin asignar</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha de reservación</label>
              <input style={inputStyle} type="date" value={form.fecha_reservacion ?? ''} onChange={e => setForm(f => ({ ...f, fecha_reservacion: e.target.value }))} />
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
              <label style={labelStyle}>Hora estimada de llegada</label>
              <input style={inputStyle} type="time" value={form.hora_llegada_estimada ?? ''} onChange={e => setForm(f => ({ ...f, hora_llegada_estimada: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Hora estimada de salida</label>
              <input style={inputStyle} type="time" value={form.hora_salida_estimada ?? ''} onChange={e => setForm(f => ({ ...f, hora_salida_estimada: e.target.value }))} />
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
              <label style={labelStyle}>Bebés</label>
              <input style={inputStyle} type="number" min="0" value={form.num_bebes ?? 0} onChange={e => setForm(f => ({ ...f, num_bebes: Number(e.target.value) }))} />
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
            <div>
              <label style={labelStyle}>Política de cancelación</label>
              <select style={inputStyle} value={form.politica_cancelacion ?? 'na'} onChange={e => setForm(f => ({ ...f, politica_cancelacion: e.target.value as PoliticaCancelacionSTR }))}>
                {Object.entries(POLITICA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Mascotas</label>
              <select style={inputStyle} value={form.mascotas ? 'si' : 'no'} onChange={e => setForm(f => ({ ...f, mascotas: e.target.value === 'si' }))}>
                <option value="no">No</option>
                <option value="si">Sí</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas</label>
              <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>

            {/* Fotos del huésped principal */}
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '8px', paddingTop: '4px', borderTop: '1px solid var(--at-line)' }}>
                Fotografías del huésped principal <span style={{ fontWeight: 400, color: 'var(--at-ink-3)' }}>(opcional — se pueden completar al ingreso)</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', maxWidth: '400px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>Foto del huésped</div>
                  <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="str_guests" label="Foto del huésped" capture />
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>Foto del documento / DPI</div>
                  <ImageUploader value={fotoDocumentoUrl} onChange={setFotoDocumentoUrl} folder="str_guests" label="DPI / Documento" capture />
                </div>
              </div>
            </div>

            {/* Personas del grupo */}
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--at-line)', paddingTop: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)' }}>
                  Personas del grupo
                  <span style={{ fontWeight: 400, color: 'var(--at-ink-3)', marginLeft: 6 }}>
                    (principal + {huespedes.length}/{maxAdicionales} adicionales pre-registradas)
                  </span>
                </div>
                {!showHuespedForm && huespedes.length < maxAdicionales && (
                  <button onClick={() => setShowHuespedForm(true)}
                    style={{ padding: '4px 12px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1.5px solid var(--at-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    + Agregar persona
                  </button>
                )}
              </div>

              {/* Principal (always shown) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '8px', marginBottom: '6px' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--at-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'white', fontWeight: 700, flexShrink: 0 }}>1</div>
                <div style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--at-ink)' }}>{form.huesped_nombre || 'Huésped principal'}</div>
                <span style={{ fontSize: '10px', color: 'var(--at-primary-hover)', fontWeight: 600, padding: '2px 8px', background: 'var(--at-primary-soft)', borderRadius: '10px' }}>Principal</span>
              </div>

              {/* Additional guests */}
              {huespedes.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: h.visitante_id ? 'var(--at-success-tint)' : 'var(--at-surface-2)', border: `1px solid ${h.visitante_id ? 'var(--at-success-border)' : 'var(--at-line)'}`, borderRadius: '8px', marginBottom: '6px' }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--at-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'var(--at-ink-2)', fontWeight: 700, flexShrink: 0 }}>{i + 2}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink)' }}>
                      {h.es_menor ? '👶 ' : ''}{h.nombre}
                      {h.visitante_id && <span style={{ marginLeft: 6, fontSize: '10px', color: 'var(--at-success)', fontWeight: 600 }}>✓ Ingresado</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                      {h.es_menor
                        ? `Menor${h.fecha_nacimiento ? ` · Nac. ${h.fecha_nacimiento}` : ''}`
                        : h.identificacion ? `DPI: ${h.identificacion}` : 'Sin documento'}
                    </div>
                  </div>
                  {!h.visitante_id && (
                    <button onClick={() => quitarHuesped(i)}
                      style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--at-danger-tint)', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--at-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      ×
                    </button>
                  )}
                </div>
              ))}

              {/* Add guest form */}
              {showHuespedForm && (
                <div style={{ padding: '14px', background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)' }}>Nueva persona del grupo</div>
                  <div>
                    <label style={labelStyle}>Nombre *</label>
                    <input style={inputStyle} value={huespedForm.nombre} onChange={e => setHuespedForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre completo" />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--at-ink-2)', cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" checked={huespedForm.es_menor} onChange={e => setHuespedForm(f => ({ ...f, es_menor: e.target.checked, identificacion: '' }))} />
                    Es menor de edad
                    {huespedForm.es_menor && <span style={{ padding: '2px 7px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '20px', fontSize: '10px' }}>Menor</span>}
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
                      <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>Foto de la persona</div>
                      <ImageUploader value={huespedForm.foto_url} onChange={v => setHuespedForm(f => ({ ...f, foto_url: v }))} folder="str_guests" label="Foto" capture />
                    </div>
                    {!huespedForm.es_menor && (
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>Foto del documento</div>
                        <ImageUploader value={huespedForm.foto_documento_url} onChange={v => setHuespedForm(f => ({ ...f, foto_documento_url: v }))} folder="str_guests" label="Documento" capture />
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={agregarHuesped}
                      style={{ padding: '7px 16px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                      + Agregar
                    </button>
                    <button onClick={() => { setShowHuespedForm(false); setHuespedForm(defaultHuesped()) }}
                      style={{ padding: '7px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {form.fecha_entrada && form.fecha_salida && form.fecha_salida > form.fecha_entrada && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--at-ink-3)' }}>
              📅 {calcNoches(form.fecha_entrada, form.fecha_salida)} noches
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'confirmada', 'en_curso', 'completada', 'cancelada'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === e ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'todos' ? `Todas (${reservasSTR.length})` : `${ESTADO_CONFIG[e as EstadoSTR]?.label} (${reservasSTR.filter(r => r.estado === e).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
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
              <div key={r.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    {r.foto_url
                      ? <SecureImage src={r.foto_url} alt={r.huesped_nombre} style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--at-line)' }} />
                      : <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--at-primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>🏠</div>
                    }
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '15px', color: 'var(--at-ink)' }}>{PLATAFORMA_ICON[r.plataforma]} {r.huesped_nombre}</div>
                      {r.unidad_nombre && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>🏠 {r.unidad_nombre}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                    <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                    {r.foto_documento_url && (
                      <SecureFileLink src={r.foto_documento_url} style={{ fontSize: '10px', color: 'var(--at-primary-hover)', textDecoration: 'none', fontWeight: 600 }}>🪪 Ver doc.</SecureFileLink>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '10px' }}>
                  <div>📅 {r.fecha_entrada} → {r.fecha_salida} <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>({noches}n)</span></div>
                  {(r.hora_llegada_estimada || r.hora_salida_estimada) && (
                    <div>🕒 {r.hora_llegada_estimada ? `Llegada ${r.hora_llegada_estimada.slice(0, 5)}` : ''}{r.hora_llegada_estimada && r.hora_salida_estimada ? ' · ' : ''}{r.hora_salida_estimada ? `Salida ${r.hora_salida_estimada.slice(0, 5)}` : ''}</div>
                  )}
                  <div>👥 {r.num_adultos} adultos{r.num_ninos > 0 ? ` · ${r.num_ninos} niños` : ''}{r.num_bebes > 0 ? ` · ${r.num_bebes} bebés` : ''}{r.mascotas ? ' · 🐾 mascotas' : ''}</div>
                  {r.monto_total && <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>💰 {moneda} {r.monto_total.toFixed(2)}</div>}
                  {r.huesped_telefono && <div>📞 {r.huesped_telefono}</div>}
                  {r.codigo_confirmacion && <div>🔖 {r.codigo_confirmacion}</div>}
                  {r.politica_cancelacion && r.politica_cancelacion !== 'na' && <div>📋 {POLITICA_LABEL[r.politica_cancelacion]}</div>}
                </div>
                {/* Group progress */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: lleno ? 'var(--at-success-tint)' : 'var(--at-warning-tint)', color: lleno ? 'var(--at-success)' : 'var(--at-warning-strong)' }}>
                    {ingresados}/{capacidad} ingresados
                  </span>
                  {preregistrados > 0 && !lleno && (
                    <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'var(--at-primary-tint)', color: 'var(--at-primary)' }}>
                      {preregistrados} pre-reg.
                    </span>
                  )}
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {r.estado === 'confirmada' && (
                      <button onClick={() => handleEstado(r.id, 'en_curso')} style={{ flex: 1, padding: '4px 8px', background: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Check-in</button>
                    )}
                    {r.estado === 'en_curso' && (
                      <button onClick={() => handleEstado(r.id, 'completada')} style={{ flex: 1, padding: '4px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Check-out</button>
                    )}
                    <button onClick={() => startEdit(r)} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(r.id)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
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
