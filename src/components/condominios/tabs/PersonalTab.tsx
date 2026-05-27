import { useState, type CSSProperties } from 'react'
import { supabase } from '../../../lib/supabase'
import type {
  PersonalCondominio, CargoPersonal, EstadoPersonal, TurnoPersonal,
  ContactoEmergenciaPersonal, CodigoAccesoPersonal, EquipoAsignadoPersonal,
} from '../../../types'
import { ImageUploader } from '../../shared/ImageUploader'
import { SecureImage } from '../../shared/SecureImage'
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
  activo:      { label: 'Activo',      color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  inactivo:    { label: 'Inactivo',    color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
  vacaciones:  { label: 'Vacaciones',  color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  incapacidad: { label: 'Incapacidad', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
}

const TIPOS_SANGRE   = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-']
const GENEROS        = ['Masculino', 'Femenino', 'Otro']
const ESTADOS_CIVILES = ['Soltero(a)', 'Casado(a)', 'Unido(a)', 'Divorciado(a)', 'Viudo(a)']
const TIPOS_CONTRATO = ['Planilla (indefinido)', 'Plazo fijo', 'Por servicios', 'Temporal', 'Otro']
const TIPOS_CUENTA   = ['Monetaria', 'Ahorro']
const TIPOS_CODIGO   = ['Tarjeta', 'Llavero / TAG', 'PIN', 'Control remoto', 'App', 'Otro']

const blank = (): Partial<PersonalCondominio> => ({
  nombre: '', cargo: 'conserje', telefono: '', email: '',
  fecha_ingreso: '', fecha_nacimiento: '', turno: 'diurno', estado: 'activo',
  salario: undefined, dpi: '', notas: '', foto_url: null,
  contactos_emergencia: [], numero_igss: '', numero_irtra: '', nit: '',
  tags: [], codigos_acceso: [], equipo_asignado: [],
  tipo_sangre: '', alergias: '', tipo_contrato: '', fecha_fin_contrato: '', supervisor: '',
  direccion: '', genero: '', estado_civil: '', banco: '', numero_cuenta: '', tipo_cuenta: '',
})

export function PersonalTab({ personal, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroCargo, setFiltroCargo] = useState<CargoPersonal | 'todos'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<EstadoPersonal | 'todos'>('activo')
  const [form, setForm] = useState<Partial<PersonalCondominio>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filtered = personal.filter(p => {
    if (filtroCargo !== 'todos' && p.cargo !== filtroCargo) return false
    if (filtroEstado !== 'todos' && p.estado !== filtroEstado) return false
    return true
  })

  const planillaMensual = personal.filter(p => p.estado === 'activo').reduce((s, p) => s + (p.salario ?? 0), 0)

  // ── Editores de listas dinámicas ────────────────────────────────────────────
  const contactos = form.contactos_emergencia ?? []
  const setContactos = (v: ContactoEmergenciaPersonal[]) => setForm(f => ({ ...f, contactos_emergencia: v }))
  const addContacto = () => setContactos([...contactos, { nombre: '', parentesco: '', telefono: '' }])
  const updContacto = (i: number, patch: Partial<ContactoEmergenciaPersonal>) => setContactos(contactos.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  const rmContacto = (i: number) => setContactos(contactos.filter((_, idx) => idx !== i))

  const codigos = form.codigos_acceso ?? []
  const setCodigos = (v: CodigoAccesoPersonal[]) => setForm(f => ({ ...f, codigos_acceso: v }))
  const addCodigo = () => setCodigos([...codigos, { tipo: 'Tarjeta', codigo: '', descripcion: '' }])
  const updCodigo = (i: number, patch: Partial<CodigoAccesoPersonal>) => setCodigos(codigos.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  const rmCodigo = (i: number) => setCodigos(codigos.filter((_, idx) => idx !== i))

  const equipos = form.equipo_asignado ?? []
  const setEquipos = (v: EquipoAsignadoPersonal[]) => setForm(f => ({ ...f, equipo_asignado: v }))
  const addEquipo = () => setEquipos([...equipos, { item: '', cantidad: 1, fecha_entrega: '', notas: '' }])
  const updEquipo = (i: number, patch: Partial<EquipoAsignadoPersonal>) => setEquipos(equipos.map((e, idx) => idx === i ? { ...e, ...patch } : e))
  const rmEquipo = (i: number) => setEquipos(equipos.filter((_, idx) => idx !== i))

  const tags = form.tags ?? []
  const addTag = () => {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) setForm(f => ({ ...f, tags: [...tags, t] }))
    setTagInput('')
  }
  const rmTag = (t: string) => setForm(f => ({ ...f, tags: tags.filter(x => x !== t) }))

  function startEdit(p: PersonalCondominio) {
    setForm({
      nombre: p.nombre, cargo: p.cargo, telefono: p.telefono ?? '',
      email: p.email ?? '', fecha_ingreso: p.fecha_ingreso ?? '',
      fecha_nacimiento: p.fecha_nacimiento ?? '', turno: p.turno,
      estado: p.estado, salario: p.salario ?? undefined, dpi: p.dpi ?? '', notas: p.notas ?? '',
      foto_url: p.foto_url ?? null,
      contactos_emergencia: p.contactos_emergencia ?? [],
      numero_igss: p.numero_igss ?? '', numero_irtra: p.numero_irtra ?? '', nit: p.nit ?? '',
      tags: p.tags ?? [], codigos_acceso: p.codigos_acceso ?? [], equipo_asignado: p.equipo_asignado ?? [],
      tipo_sangre: p.tipo_sangre ?? '', alergias: p.alergias ?? '',
      tipo_contrato: p.tipo_contrato ?? '', fecha_fin_contrato: p.fecha_fin_contrato ?? '', supervisor: p.supervisor ?? '',
      direccion: p.direccion ?? '', genero: p.genero ?? '', estado_civil: p.estado_civil ?? '',
      banco: p.banco ?? '', numero_cuenta: p.numero_cuenta ?? '', tipo_cuenta: p.tipo_cuenta ?? '',
    })
    setEditId(p.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()); setTagInput('') }

  async function handleSave() {
    if (!form.nombre?.trim()) return Swal.fire('Campo requerido', 'Ingresa el nombre.', 'warning')
    setSaving(true)
    const cleanContactos = (form.contactos_emergencia ?? []).filter(c => c.nombre?.trim())
    const cleanCodigos = (form.codigos_acceso ?? []).filter(c => c.codigo?.trim())
    const cleanEquipos = (form.equipo_asignado ?? []).filter(e => e.item?.trim())
    const payload = {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre!.trim(), cargo: form.cargo ?? 'conserje',
      telefono: form.telefono || null, email: form.email || null,
      fecha_ingreso: form.fecha_ingreso || null,
      fecha_nacimiento: form.fecha_nacimiento || null,
      turno: form.turno ?? 'diurno',
      estado: form.estado ?? 'activo', salario: form.salario ?? null,
      dpi: form.dpi || null, notas: form.notas || null,
      foto_url: form.foto_url || null,
      contactos_emergencia: cleanContactos,
      numero_igss: form.numero_igss || null, numero_irtra: form.numero_irtra || null, nit: form.nit || null,
      tags: form.tags ?? [],
      codigos_acceso: cleanCodigos,
      equipo_asignado: cleanEquipos,
      tipo_sangre: form.tipo_sangre || null, alergias: form.alergias || null,
      tipo_contrato: form.tipo_contrato || null, fecha_fin_contrato: form.fecha_fin_contrato || null,
      supervisor: form.supervisor || null,
      direccion: form.direccion || null, genero: form.genero || null, estado_civil: form.estado_civil || null,
      banco: form.banco || null, numero_cuenta: form.numero_cuenta || null, tipo_cuenta: form.tipo_cuenta || null,
    }
    const { error } = editId
      ? await supabase.from('personal_condominio').update(payload).eq('id', editId)
      : await supabase.from('personal_condominio').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar personal?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: 'var(--at-danger)' })
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

  function toggleExpand(id: string) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const cargoInfo = (c: CargoPersonal) => CARGOS.find(x => x.value === c) ?? CARGOS[CARGOS.length - 1]
  const turnoLabel: Record<TurnoPersonal, string> = { diurno: '☀️ Diurno', nocturno: '🌙 Nocturno', rotativo: '🔄 Rotativo' }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }
  const sectionTitleStyle: CSSProperties = { gridColumn: '1 / -1', fontSize: '11px', fontWeight: 700, color: 'var(--at-primary)', margin: '10px 0 -4px', textTransform: 'uppercase', letterSpacing: '0.05em' }
  const fullCol: CSSProperties = { gridColumn: '1 / -1' }
  const miniInput: CSSProperties = { ...inputStyle, padding: '6px 8px', fontSize: '12px' }
  const addBtnStyle: CSSProperties = { padding: '6px 12px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: '1.5px dashed var(--at-line-strong)', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }
  const rmRowStyle: CSSProperties = { padding: '6px 9px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', flexShrink: 0 }

  return (
    <div style={{ padding: '20px 24px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Personal del Condominio</h2>
          {planillaMensual > 0 && (
            <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
              Planilla mensual activa: <strong style={{ color: 'var(--at-primary)' }}>{moneda} {planillaMensual.toFixed(2)}</strong>
            </span>
          )}
        </div>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Agregar Personal
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Empleado' : 'Nuevo Empleado'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>

            <div style={sectionTitleStyle}>Datos básicos</div>
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
              <label style={labelStyle}>🎂 Fecha de nacimiento</label>
              <input style={inputStyle} type="date" value={form.fecha_nacimiento ?? ''} onChange={e => setForm(f => ({ ...f, fecha_nacimiento: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Salario mensual ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.salario ?? ''} onChange={e => setForm(f => ({ ...f, salario: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>

            {/* Fotografía */}
            <div style={fullCol}>
              <div style={{ maxWidth: 180 }}>
                <ImageUploader value={form.foto_url ?? null} onChange={url => setForm(f => ({ ...f, foto_url: url }))} folder="personal" label="📷 Fotografía" capture />
              </div>
            </div>

            {/* Afiliaciones */}
            <div style={sectionTitleStyle}>Afiliaciones</div>
            <div>
              <label style={labelStyle}>No. IGSS</label>
              <input style={inputStyle} value={form.numero_igss ?? ''} onChange={e => setForm(f => ({ ...f, numero_igss: e.target.value }))} placeholder="Seguridad social" />
            </div>
            <div>
              <label style={labelStyle}>No. IRTRA</label>
              <input style={inputStyle} value={form.numero_irtra ?? ''} onChange={e => setForm(f => ({ ...f, numero_irtra: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>NIT</label>
              <input style={inputStyle} value={form.nit ?? ''} onChange={e => setForm(f => ({ ...f, nit: e.target.value }))} placeholder="Identificación tributaria" />
            </div>

            {/* Contactos de emergencia */}
            <div style={sectionTitleStyle}>🆘 Contactos de emergencia</div>
            <div style={{ ...fullCol, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {contactos.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input style={{ ...miniInput, flex: '2 1 160px' }} value={c.nombre} onChange={e => updContacto(i, { nombre: e.target.value })} placeholder="Nombre" />
                  <input style={{ ...miniInput, flex: '1 1 110px' }} value={c.parentesco ?? ''} onChange={e => updContacto(i, { parentesco: e.target.value })} placeholder="Parentesco" />
                  <input style={{ ...miniInput, flex: '1 1 130px' }} value={c.telefono ?? ''} onChange={e => updContacto(i, { telefono: e.target.value })} placeholder="Teléfono" />
                  <button onClick={() => rmContacto(i)} style={rmRowStyle}>✕</button>
                </div>
              ))}
              <button onClick={addContacto} style={{ ...addBtnStyle, alignSelf: 'flex-start' }}>+ Agregar contacto</button>
            </div>

            {/* Datos médicos */}
            <div style={sectionTitleStyle}>🩺 Datos médicos</div>
            <div>
              <label style={labelStyle}>Tipo de sangre</label>
              <select style={inputStyle} value={form.tipo_sangre ?? ''} onChange={e => setForm(f => ({ ...f, tipo_sangre: e.target.value }))}>
                <option value="">—</option>
                {TIPOS_SANGRE.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Alergias / condiciones médicas</label>
              <input style={inputStyle} value={form.alergias ?? ''} onChange={e => setForm(f => ({ ...f, alergias: e.target.value }))} placeholder="Penicilina, asma, diabetes…" />
            </div>

            {/* Datos de contrato */}
            <div style={sectionTitleStyle}>📄 Contrato</div>
            <div>
              <label style={labelStyle}>Tipo de contrato</label>
              <select style={inputStyle} value={form.tipo_contrato ?? ''} onChange={e => setForm(f => ({ ...f, tipo_contrato: e.target.value }))}>
                <option value="">—</option>
                {TIPOS_CONTRATO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fin de contrato</label>
              <input style={inputStyle} type="date" value={form.fecha_fin_contrato ?? ''} onChange={e => setForm(f => ({ ...f, fecha_fin_contrato: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Supervisor / jefe directo</label>
              <input style={inputStyle} value={form.supervisor ?? ''} onChange={e => setForm(f => ({ ...f, supervisor: e.target.value }))} />
            </div>

            {/* Datos personales */}
            <div style={sectionTitleStyle}>🏠 Datos personales</div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Dirección</label>
              <input style={inputStyle} value={form.direccion ?? ''} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Género</label>
              <select style={inputStyle} value={form.genero ?? ''} onChange={e => setForm(f => ({ ...f, genero: e.target.value }))}>
                <option value="">—</option>
                {GENEROS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Estado civil</label>
              <select style={inputStyle} value={form.estado_civil ?? ''} onChange={e => setForm(f => ({ ...f, estado_civil: e.target.value }))}>
                <option value="">—</option>
                {ESTADOS_CIVILES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Datos bancarios */}
            <div style={sectionTitleStyle}>🏦 Datos bancarios (planilla)</div>
            <div>
              <label style={labelStyle}>Banco</label>
              <input style={inputStyle} value={form.banco ?? ''} onChange={e => setForm(f => ({ ...f, banco: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>No. de cuenta</label>
              <input style={inputStyle} value={form.numero_cuenta ?? ''} onChange={e => setForm(f => ({ ...f, numero_cuenta: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Tipo de cuenta</label>
              <select style={inputStyle} value={form.tipo_cuenta ?? ''} onChange={e => setForm(f => ({ ...f, tipo_cuenta: e.target.value }))}>
                <option value="">—</option>
                {TIPOS_CUENTA.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Códigos de acceso */}
            <div style={sectionTitleStyle}>🔑 Códigos de acceso asignados</div>
            <div style={{ ...fullCol, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {codigos.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select style={{ ...miniInput, flex: '1 1 120px' }} value={c.tipo ?? ''} onChange={e => updCodigo(i, { tipo: e.target.value })}>
                    {TIPOS_CODIGO.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input style={{ ...miniInput, flex: '1 1 130px' }} value={c.codigo} onChange={e => updCodigo(i, { codigo: e.target.value })} placeholder="Código / No." />
                  <input style={{ ...miniInput, flex: '2 1 150px' }} value={c.descripcion ?? ''} onChange={e => updCodigo(i, { descripcion: e.target.value })} placeholder="Descripción (ej. portón principal)" />
                  <button onClick={() => rmCodigo(i)} style={rmRowStyle}>✕</button>
                </div>
              ))}
              <button onClick={addCodigo} style={{ ...addBtnStyle, alignSelf: 'flex-start' }}>+ Agregar código</button>
            </div>

            {/* Equipo asignado */}
            <div style={sectionTitleStyle}>🎒 Equipo personal asignado</div>
            <div style={{ ...fullCol, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {equipos.map((eq, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input style={{ ...miniInput, flex: '2 1 150px' }} value={eq.item} onChange={e => updEquipo(i, { item: e.target.value })} placeholder="Equipo (radio, uniforme, llaves…)" />
                  <input style={{ ...miniInput, flex: '0 1 80px' }} type="number" min="1" value={eq.cantidad ?? ''} onChange={e => updEquipo(i, { cantidad: e.target.value ? Number(e.target.value) : undefined })} placeholder="Cant." />
                  <input style={{ ...miniInput, flex: '1 1 130px' }} type="date" value={eq.fecha_entrega ?? ''} onChange={e => updEquipo(i, { fecha_entrega: e.target.value })} />
                  <input style={{ ...miniInput, flex: '2 1 130px' }} value={eq.notas ?? ''} onChange={e => updEquipo(i, { notas: e.target.value })} placeholder="Notas" />
                  <button onClick={() => rmEquipo(i)} style={rmRowStyle}>✕</button>
                </div>
              ))}
              <button onClick={addEquipo} style={{ ...addBtnStyle, alignSelf: 'flex-start' }}>+ Agregar equipo</button>
            </div>

            {/* Tags */}
            <div style={sectionTitleStyle}>🏷️ Tags</div>
            <div style={fullCol}>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: tags.length ? '8px' : 0 }}>
                {tags.map(t => (
                  <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary)', borderRadius: '20px', fontSize: '12px', fontWeight: 600 }}>
                    {t}
                    <button onClick={() => rmTag(t)} style={{ border: 'none', background: 'transparent', color: 'var(--at-primary)', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input style={{ ...inputStyle, flex: 1 }} value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                  placeholder="Escribe un tag y presiona Enter" />
                <button onClick={addTag} style={addBtnStyle}>+ Agregar</button>
              </div>
            </div>

            {/* Notas */}
            <div style={fullCol}>
              <label style={labelStyle}>Notas</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '50px' }} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
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
              borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === e ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'todos' ? `Todos (${personal.length})` : `${ESTADO_CONFIG[e as EstadoPersonal]?.label ?? e} (${personal.filter(p => p.estado === e).length})`}
          </button>
        ))}
        <div style={{ width: '1px', height: '24px', background: 'var(--at-line)', margin: '0 4px' }} />
        <select value={filtroCargo} onChange={e => setFiltroCargo(e.target.value as CargoPersonal | 'todos')}
          style={{ padding: '5px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '12px', background: 'var(--at-surface-2)' }}>
          <option value="todos">Todos los cargos</option>
          {CARGOS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
        </select>
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>👥</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay personal registrado</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
          {filtered.map(p => {
            const ci = cargoInfo(p.cargo)
            const est = ESTADO_CONFIG[p.estado]
            const isOpen = expanded.has(p.id)
            const nContactos = p.contactos_emergencia?.length ?? 0
            const nCodigos = p.codigos_acceso?.length ?? 0
            const nEquipos = p.equipo_asignado?.length ?? 0
            const hasDetail = Boolean(nContactos || nCodigos || nEquipos || p.email || p.dpi ||
              p.numero_igss || p.numero_irtra || p.nit || p.tipo_sangre || p.alergias ||
              p.tipo_contrato || p.fecha_fin_contrato || p.supervisor || p.direccion ||
              p.genero || p.estado_civil || p.banco || p.numero_cuenta || p.notas)
            return (
              <div key={p.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {p.foto_url ? (
                      <SecureImage src={p.foto_url} alt={p.nombre}
                        style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1.5px solid var(--at-line)' }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'var(--at-chip)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                        {ci.icon}
                      </div>
                    )}
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--at-ink)', fontSize: '14px' }}>{p.nombre}</div>
                      <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{ci.label}</div>
                    </div>
                  </div>
                  <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color, whiteSpace: 'nowrap' }}>
                    {est.label}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: 'var(--at-ink-3)' }}>
                  <div>{turnoLabel[p.turno]}</div>
                  {p.telefono && <div>📞 {p.telefono}</div>}
                  {p.fecha_ingreso && <div>📅 Desde: {p.fecha_ingreso}</div>}
                  {p.salario != null && <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{moneda} {p.salario.toFixed(2)}/mes</div>}
                </div>

                {/* Tags */}
                {(p.tags?.length ?? 0) > 0 && (
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                    {p.tags!.map(t => (
                      <span key={t} style={{ padding: '2px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary)', borderRadius: '20px', fontSize: '11px', fontWeight: 600 }}>{t}</span>
                    ))}
                  </div>
                )}

                {/* Badges resumen */}
                {(nContactos > 0 || nCodigos > 0 || nEquipos > 0) && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--at-ink-3)' }}>
                    {nContactos > 0 && <span style={{ background: 'var(--at-chip)', padding: '2px 7px', borderRadius: '6px' }}>🆘 {nContactos}</span>}
                    {nCodigos > 0 && <span style={{ background: 'var(--at-chip)', padding: '2px 7px', borderRadius: '6px' }}>🔑 {nCodigos}</span>}
                    {nEquipos > 0 && <span style={{ background: 'var(--at-chip)', padding: '2px 7px', borderRadius: '6px' }}>🎒 {nEquipos}</span>}
                  </div>
                )}

                {/* Detalle expandible */}
                {hasDetail && isOpen && (
                  <div style={{ borderTop: '1px solid var(--at-line)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', color: 'var(--at-ink-2)' }}>
                    {p.email && <DetailRow label="Email" value={p.email} />}
                    {p.dpi && <DetailRow label="DPI" value={p.dpi} />}
                    {(p.numero_igss || p.numero_irtra || p.nit) && (
                      <DetailRow label="Afiliaciones" value={[p.numero_igss && `IGSS ${p.numero_igss}`, p.numero_irtra && `IRTRA ${p.numero_irtra}`, p.nit && `NIT ${p.nit}`].filter(Boolean).join(' · ')} />
                    )}
                    {p.tipo_sangre && <DetailRow label="🩸 Sangre" value={p.tipo_sangre} />}
                    {p.alergias && <DetailRow label="⚠️ Alergias" value={p.alergias} />}
                    {p.tipo_contrato && <DetailRow label="Contrato" value={p.tipo_contrato} />}
                    {p.fecha_fin_contrato && <DetailRow label="Fin contrato" value={p.fecha_fin_contrato} />}
                    {p.supervisor && <DetailRow label="Supervisor" value={p.supervisor} />}
                    {p.direccion && <DetailRow label="Dirección" value={p.direccion} />}
                    {(p.genero || p.estado_civil) && <DetailRow label="Personal" value={[p.genero, p.estado_civil].filter(Boolean).join(' · ')} />}
                    {(p.banco || p.numero_cuenta) && <DetailRow label="🏦 Banco" value={[p.banco, p.numero_cuenta, p.tipo_cuenta].filter(Boolean).join(' · ')} />}

                    {nContactos > 0 && (
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--at-ink-3)', marginTop: '2px' }}>🆘 Contactos de emergencia</div>
                        {p.contactos_emergencia!.map((c, i) => (
                          <div key={i} style={{ paddingLeft: '8px' }}>• {c.nombre}{c.parentesco ? ` (${c.parentesco})` : ''}{c.telefono ? ` — ${c.telefono}` : ''}</div>
                        ))}
                      </div>
                    )}
                    {nCodigos > 0 && (
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--at-ink-3)', marginTop: '2px' }}>🔑 Códigos de acceso</div>
                        {p.codigos_acceso!.map((c, i) => (
                          <div key={i} style={{ paddingLeft: '8px' }}>• {c.tipo ? `${c.tipo}: ` : ''}{c.codigo}{c.descripcion ? ` — ${c.descripcion}` : ''}</div>
                        ))}
                      </div>
                    )}
                    {nEquipos > 0 && (
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--at-ink-3)', marginTop: '2px' }}>🎒 Equipo asignado</div>
                        {p.equipo_asignado!.map((eq, i) => (
                          <div key={i} style={{ paddingLeft: '8px' }}>• {eq.item}{eq.cantidad ? ` ×${eq.cantidad}` : ''}{eq.fecha_entrega ? ` (${eq.fecha_entrega})` : ''}{eq.notas ? ` — ${eq.notas}` : ''}</div>
                        ))}
                      </div>
                    )}
                    {p.notas && <DetailRow label="Notas" value={p.notas} />}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '6px', marginTop: '2px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {hasDetail && (
                    <button onClick={() => toggleExpand(p.id)} style={{ padding: '4px 8px', background: 'transparent', color: 'var(--at-primary)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      {isOpen ? '▲ Ver menos' : '▼ Ver más'}
                    </button>
                  )}
                  {canEdit && (
                    <>
                      {p.estado === 'activo' && (
                        <button onClick={() => handleEstado(p.id, 'vacaciones')} style={{ padding: '4px 8px', background: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                          Vacaciones
                        </button>
                      )}
                      {(p.estado === 'vacaciones' || p.estado === 'incapacidad') && (
                        <button onClick={() => handleEstado(p.id, 'activo')} style={{ padding: '4px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                          Reactivar
                        </button>
                      )}
                      <button onClick={() => startEdit(p)} style={{ padding: '4px 8px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(p.id)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🗑️</button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <span style={{ fontWeight: 600, color: 'var(--at-ink-3)', flexShrink: 0 }}>{label}:</span>
      <span style={{ wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}
