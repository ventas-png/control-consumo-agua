import { useState } from 'react'
import Swal from 'sweetalert2'
import type { Contador, Tarifa, TipoAgua, UserRole, UserSession, Unidad } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'

interface Props {
  contadores: Contador[]
  tarifas: Tarifa[]
  unidades: Unidad[]
  userRole: UserRole
  currentUser: UserSession
  moneda?: string
  onContadorAdded: (contador: Contador) => void
  onContadorUpdated: (id: string, partial: Partial<Contador>) => void
  onContadorDeleted: (id: string) => void
}

const TIPOS_AGUA: { value: TipoAgua; label: string }[] = [
  { value: 'potable', label: 'Potable' },
  { value: 'rehuso', label: 'Rehúso' },
  { value: 'piscina', label: 'Piscina' },
  { value: 'desalinada', label: 'Desalinada' },
  { value: 'riego', label: 'Riego' },
  { value: 'jacuzzi', label: 'Jacuzzi' },
  { value: 'consumo_humano', label: 'Consumo Humano' },
  { value: 'desmineralizada', label: 'Desmineralizada' },
  { value: 'residuales_tratadas', label: 'Residuales Tratadas' },
]

const TIPO_COLORES: Record<TipoAgua, { bg: string; color: string }> = {
  potable:             { bg: '#e0f2fe', color: '#0369a1' },
  rehuso:              { bg: '#dcfce7', color: '#166534' },
  piscina:             { bg: '#dbeafe', color: '#1d4ed8' },
  desalinada:          { bg: '#fef9c3', color: '#854d0e' },
  riego:               { bg: '#d1fae5', color: '#065f46' },
  jacuzzi:             { bg: '#ede9fe', color: '#5b21b6' },
  consumo_humano:      { bg: '#ffedd5', color: '#c2410c' },
  desmineralizada:     { bg: '#fce7f3', color: '#9d174d' },
  residuales_tratadas: { bg: '#f1f5f9', color: '#475569' },
}

const MEDIDAS_CONTADOR = [
  '1/2"  (½") — 15 mm',
  '3/4"  (¾") — 20 mm',
  '1"    — 25 mm',
  '1 1/4" — 32 mm',
  '1 1/2" — 40 mm',
  '2"    — 50 mm',
  '2 1/2" — 63 mm',
  '3"    — 75 mm',
  '4"    — 110 mm',
  '5"    — 140 mm',
  '6"    — 160 mm',
]
const MATERIALES_CONTADOR = [
  'Bronce',
  'Latón',
  'Hierro fundido',
  'Hierro galvanizado',
  'Acero inoxidable',
  'Cobre',
  'Plástico (PVC)',
  'Plástico (polipropileno)',
  'Plástico (nylon reforzado)',
  'Composite (plástico/metal)',
]
const TIPOS_CONTADOR = ['Analógico velocimétrico', 'Analógico volumétrico', 'Digital', 'Ultrasónico', 'Electromagnético', 'Otro']
const OPCIONES_SIN = ['Sí', 'No', 'N/A']
const OPCIONES_SI_NO = ['Sí', 'No']
const TIPOS_LLAVE = ['Compuerta', 'Bola', 'Mariposa', 'Globo', 'Aguja', 'Otra']

const EMPTY_FORM = {
  numero_serie: '',
  tipo_agua: 'potable' as TipoAgua,
  descripcion: '',
  marca: '',
  modelo: '',
  fecha_instalacion: '',
  lectura_inicial: '0',
  activo: true,
  tarifa_id: '' as string,
  unidad_id: '' as string,
  medida: '',
  material: '',
  tipo_contador: '',
  valvula_cheque: '',
  tipo_llave: '',
  llave_antifraude: '',
  valvula_aire: '',
  fecha_reemplazo_sugerida: '',
  numero_derecho_servicio: '',
  cantidad_derecho_servicio_m3: '',
}

type FormState = typeof EMPTY_FORM

export function ContadoresSection({
  contadores,
  tarifas,
  unidades,
  userRole,
  currentUser,
  moneda = 'Q',
  onContadorAdded,
  onContadorUpdated,
  onContadorDeleted,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<TipoAgua | ''>('')
  const [filterUnidad, setFilterUnidad] = useState<string>('')

  const canEdit = userRole !== 'viewer' && userRole !== 'operator'

  function startCreate() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(true)
  }

  function startEdit(c: Contador) {
    setForm({
      numero_serie: c.numero_serie,
      tipo_agua: c.tipo_agua,
      descripcion: c.descripcion ?? '',
      marca: c.marca ?? '',
      modelo: c.modelo ?? '',
      fecha_instalacion: c.fecha_instalacion ?? '',
      lectura_inicial: String(c.lectura_inicial),
      activo: c.activo,
      tarifa_id: c.tarifa_id ?? '',
      unidad_id: c.unidad_id ?? '',
      medida: c.medida ?? '',
      material: c.material ?? '',
      tipo_contador: c.tipo_contador ?? '',
      valvula_cheque: c.valvula_cheque ?? '',
      tipo_llave: c.tipo_llave ?? '',
      llave_antifraude: c.llave_antifraude ?? '',
      valvula_aire: c.valvula_aire ?? '',
      fecha_reemplazo_sugerida: c.fecha_reemplazo_sugerida ?? '',
      numero_derecho_servicio: c.numero_derecho_servicio ?? '',
      cantidad_derecho_servicio_m3: c.cantidad_derecho_servicio_m3 != null ? String(c.cantidad_derecho_servicio_m3) : '',
    })
    setEditingId(c.id)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleGuardar() {
    const numero_serie = sanitizeInput(form.numero_serie)
    const lectura_inicial = parseFloat(form.lectura_inicial)

    const errors: string[] = []
    if (!numero_serie || numero_serie.length < 2)
      errors.push('Número de serie debe tener al menos 2 caracteres')
    if (isNaN(lectura_inicial) || lectura_inicial < 0)
      errors.push('Lectura inicial debe ser un número mayor o igual a 0')

    if (errors.length > 0) {
      Swal.fire('Error de validación', errors.join('<br>'), 'error')
      return
    }

    setLoading(true)

    if (editingId) {
      const { data, error } = await supabase
        .from('contadores')
        .update({
          numero_serie,
          tipo_agua: form.tipo_agua,
          descripcion: form.descripcion || null,
          marca: form.marca || null,
          modelo: form.modelo || null,
          fecha_instalacion: form.fecha_instalacion || null,
          lectura_inicial,
          activo: form.activo,
          tarifa_id: form.tarifa_id || null,
          unidad_id: form.unidad_id || null,
          medida: form.medida || null,
          material: form.material || null,
          tipo_contador: form.tipo_contador || null,
          valvula_cheque: form.valvula_cheque || null,
          tipo_llave: form.tipo_llave || null,
          llave_antifraude: form.llave_antifraude || null,
          valvula_aire: form.valvula_aire || null,
          fecha_reemplazo_sugerida: form.fecha_reemplazo_sugerida || null,
          numero_derecho_servicio: form.numero_derecho_servicio || null,
          cantidad_derecho_servicio_m3: form.cantidad_derecho_servicio_m3 ? parseFloat(form.cantidad_derecho_servicio_m3) : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingId)
        .select()
        .single()

      if (!error && data) {
        onContadorUpdated(editingId, data as Contador)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Contador actualizado', timer: 1800, showConfirmButton: false })
      } else {
        Swal.fire('Error', error?.message ?? 'No se pudo actualizar el contador.', 'error')
      }
    } else {
      // Resolve project_id and company_id
      const { data: userData } = await supabase
        .from('app_users')
        .select('project_id, company_id')
        .eq('id', currentUser.user_id)
        .single()

      let projectId: string | null =
        (userData as { project_id?: string } | null)?.project_id ?? null
      let companyId: string | null =
        (userData as { company_id?: string } | null)?.company_id ??
        currentUser.company_id ??
        null

      if (!projectId) {
        const { data: assignment } = await supabase
          .from('user_project_assignments')
          .select('project_id')
          .eq('user_id', currentUser.user_id)
          .limit(1)
          .single()
        if (assignment) projectId = (assignment as { project_id: string }).project_id
      }

      if (!projectId && companyId) {
        const { data: proj } = await supabase
          .from('projects')
          .select('id')
          .eq('company_id', companyId)
          .limit(1)
          .single()
        if (proj) projectId = (proj as { id: string }).id
      }

      if (!projectId || !companyId) {
        Swal.fire('Error', 'No se pudo determinar el proyecto o empresa. Contacte al administrador.', 'error')
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('contadores')
        .insert({
          numero_serie,
          tipo_agua: form.tipo_agua,
          descripcion: form.descripcion || null,
          marca: form.marca || null,
          modelo: form.modelo || null,
          fecha_instalacion: form.fecha_instalacion || null,
          lectura_inicial,
          activo: form.activo,
          tarifa_id: form.tarifa_id || null,
          unidad_id: form.unidad_id || null,
          medida: form.medida || null,
          material: form.material || null,
          tipo_contador: form.tipo_contador || null,
          valvula_cheque: form.valvula_cheque || null,
          tipo_llave: form.tipo_llave || null,
          llave_antifraude: form.llave_antifraude || null,
          valvula_aire: form.valvula_aire || null,
          fecha_reemplazo_sugerida: form.fecha_reemplazo_sugerida || null,
          numero_derecho_servicio: form.numero_derecho_servicio || null,
          cantidad_derecho_servicio_m3: form.cantidad_derecho_servicio_m3 ? parseFloat(form.cantidad_derecho_servicio_m3) : null,
          project_id: projectId,
          company_id: companyId,
        })
        .select()
        .single()

      if (!error && data) {
        onContadorAdded(data as Contador)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Contador creado', timer: 1800, showConfirmButton: false })
      } else {
        Swal.fire('Error', error?.message ?? 'No se pudo guardar el contador.', 'error')
      }
    }

    setLoading(false)
  }

  async function handleToggleActivo(c: Contador) {
    const { error } = await supabase
      .from('contadores')
      .update({ activo: !c.activo, updated_at: new Date().toISOString() })
      .eq('id', c.id)

    if (!error) {
      onContadorUpdated(c.id, { activo: !c.activo })
    } else {
      Swal.fire('Error', 'No se pudo cambiar el estado.', 'error')
    }
  }

  async function handleEliminar(c: Contador) {
    const confirm = await Swal.fire({
      title: '¿Eliminar contador?',
      html: `<b>${c.numero_serie}</b> será eliminado permanentemente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!confirm.isConfirmed) return

    const { error } = await supabase.from('contadores').delete().eq('id', c.id)
    if (!error) {
      onContadorDeleted(c.id)
      Swal.fire({ icon: 'success', title: 'Contador eliminado', timer: 1500, showConfirmButton: false })
    } else {
      Swal.fire('Error', error.message ?? 'No se pudo eliminar el contador.', 'error')
    }
  }

  const tipoLabel = (value: TipoAgua) =>
    TIPOS_AGUA.find(t => t.value === value)?.label ?? value

  const tarifasParaTipo = (tipo: TipoAgua) =>
    tarifas.filter(t => t.tipo_agua === tipo && t.activa)

  const tarifaNombre = (id: string | null | undefined) =>
    id ? (tarifas.find(t => t.id === id)?.nombre ?? 'Tarifa desconocida') : null

  const unidadNombre = (id: string | null | undefined) =>
    id ? (unidades.find(u => u.id === id)?.nombre ?? 'Unidad desconocida') : null

  const filtered = contadores.filter(c => {
    const matchSearch =
      c.numero_serie.toLowerCase().includes(search.toLowerCase()) ||
      (c.marca ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (c.modelo ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (c.descripcion ?? '').toLowerCase().includes(search.toLowerCase())
    const matchTipo = filterTipo === '' || c.tipo_agua === filterTipo
    const matchUnidad = filterUnidad === '' || c.unidad_id === filterUnidad
    return matchSearch && matchTipo && matchUnidad
  })

  const inputStyle: React.CSSProperties = {
    padding: '10px 14px',
    border: '2px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: '#4a5568',
    marginBottom: '5px',
    display: 'block',
  }

  // Summary by tipo_agua
  const resumen = TIPOS_AGUA.map(t => ({
    ...t,
    total: contadores.filter(c => c.tipo_agua === t.value).length,
    conTarifa: contadores.filter(c => c.tipo_agua === t.value && c.tarifa_id).length,
  })).filter(t => t.total > 0)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#1e293b' }}>Contadores</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748b' }}>
            Gestiona los contadores de agua por tipología
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {unidades.length > 0 && (
            <select
              value={filterUnidad}
              onChange={e => setFilterUnidad(e.target.value)}
              style={{ ...inputStyle, width: '180px' }}
            >
              <option value="">Todas las unidades</option>
              {unidades.map(u => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          )}
          <select
            value={filterTipo}
            onChange={e => setFilterTipo(e.target.value as TipoAgua | '')}
            style={{ ...inputStyle, width: '180px' }}
          >
            <option value="">Todas las tipologías</option>
            {TIPOS_AGUA.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Buscar contador..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: '200px' }}
          />
          {canEdit && (
            <button
              onClick={startCreate}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              + Nuevo Contador
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {resumen.length > 0 && (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
          {resumen.map(r => {
            const col = TIPO_COLORES[r.value as TipoAgua]
            return (
              <div
                key={r.value}
                onClick={() => setFilterTipo(filterTipo === r.value ? '' : r.value as TipoAgua)}
                style={{
                  background: filterTipo === r.value ? col.bg : 'white',
                  border: `2px solid ${filterTipo === r.value ? col.color : '#e2e8f0'}`,
                  borderRadius: '12px',
                  padding: '12px 18px',
                  cursor: 'pointer',
                  minWidth: '130px',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 600, color: col.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {r.label}
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', margin: '4px 0 2px' }}>
                  {r.total}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {r.conTarifa} con tarifa
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Form */}
      {showForm && canEdit && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '28px', marginBottom: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '17px', fontWeight: 700, marginBottom: '20px', color: '#1e293b' }}>
            {editingId ? 'Editar Contador' : 'Nuevo Contador'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label style={labelStyle}>Número de Serie *</label>
              <input
                style={inputStyle}
                value={form.numero_serie}
                onChange={e => setForm(f => ({ ...f, numero_serie: e.target.value }))}
                placeholder="Ej: CTR-2024-001"
                maxLength={100}
              />
            </div>
            <div>
              <label style={labelStyle}>Tipología / Tipo de Agua *</label>
              <select
                style={inputStyle}
                value={form.tipo_agua}
                onChange={e => setForm(f => ({ ...f, tipo_agua: e.target.value as TipoAgua, tarifa_id: '' }))}
              >
                {TIPOS_AGUA.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tarifa aplicable</label>
              <select
                style={inputStyle}
                value={form.tarifa_id}
                onChange={e => setForm(f => ({ ...f, tarifa_id: e.target.value }))}
              >
                <option value="">— Sin tarifa asignada —</option>
                {tarifasParaTipo(form.tipo_agua).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} — {t.precio_m3} {moneda}/m³{t.canon_fijo > 0 ? ` + ${t.canon_fijo} ${moneda} canon` : ''}
                  </option>
                ))}
                {tarifasParaTipo(form.tipo_agua).length === 0 && (
                  <option disabled value="">No hay tarifas activas para este tipo</option>
                )}
              </select>
            </div>
            {unidades.length > 0 && (
              <div>
                <label style={labelStyle}>Unidad asignada</label>
                <select
                  style={inputStyle}
                  value={form.unidad_id}
                  onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                >
                  <option value="">— Sin unidad asignada —</option>
                  {unidades.filter(u => u.activo).map(u => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>Marca</label>
              <input
                style={inputStyle}
                value={form.marca}
                onChange={e => setForm(f => ({ ...f, marca: e.target.value }))}
                placeholder="Ej: Sensus, Elster, Itron..."
                maxLength={100}
              />
            </div>
            <div>
              <label style={labelStyle}>Modelo</label>
              <input
                style={inputStyle}
                value={form.modelo}
                onChange={e => setForm(f => ({ ...f, modelo: e.target.value }))}
                placeholder="Ej: 620M, V200, HR-E..."
                maxLength={100}
              />
            </div>
            <div>
              <label style={labelStyle}>Fecha de Instalación</label>
              <input
                style={inputStyle}
                type="date"
                value={form.fecha_instalacion}
                onChange={e => setForm(f => ({ ...f, fecha_instalacion: e.target.value }))}
              />
            </div>
            <div>
              <label style={labelStyle}>Lectura Inicial (m³)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.0001"
                value={form.lectura_inicial}
                onChange={e => setForm(f => ({ ...f, lectura_inicial: e.target.value }))}
                placeholder="0.0000"
              />
            </div>
            {/* Technical fields — separator */}
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #e2e8f0', paddingTop: '16px', marginTop: '4px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#0ea5e9', marginBottom: '14px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Características Técnicas e Instalación
              </div>
            </div>
            <div>
              <label style={labelStyle}>Medida del Contador</label>
              <select
                style={inputStyle}
                value={form.medida}
                onChange={e => setForm(f => ({ ...f, medida: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {MEDIDAS_CONTADOR.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Material del Contador</label>
              <select
                style={inputStyle}
                value={form.material}
                onChange={e => setForm(f => ({ ...f, material: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {MATERIALES_CONTADOR.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tipo de Contador</label>
              <select
                style={inputStyle}
                value={form.tipo_contador}
                onChange={e => setForm(f => ({ ...f, tipo_contador: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {TIPOS_CONTADOR.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Válvula de Cheque instalada</label>
              <select
                style={inputStyle}
                value={form.valvula_cheque}
                onChange={e => setForm(f => ({ ...f, valvula_cheque: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {OPCIONES_SIN.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tipo de Llave instalada</label>
              <select
                style={inputStyle}
                value={form.tipo_llave}
                onChange={e => setForm(f => ({ ...f, tipo_llave: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {TIPOS_LLAVE.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Llave Antifraude instalada</label>
              <select
                style={inputStyle}
                value={form.llave_antifraude}
                onChange={e => setForm(f => ({ ...f, llave_antifraude: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {OPCIONES_SI_NO.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Válvula Liberadora de Aire</label>
              <select
                style={inputStyle}
                value={form.valvula_aire}
                onChange={e => setForm(f => ({ ...f, valvula_aire: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {OPCIONES_SIN.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha Sugerida de Reemplazo</label>
              <input
                style={inputStyle}
                type="date"
                value={form.fecha_reemplazo_sugerida}
                onChange={e => setForm(f => ({ ...f, fecha_reemplazo_sugerida: e.target.value }))}
              />
            </div>
            <div>
              <label style={labelStyle}>N° Derecho de Servicio (Título de Agua)</label>
              <input
                style={inputStyle}
                value={form.numero_derecho_servicio}
                onChange={e => setForm(f => ({ ...f, numero_derecho_servicio: e.target.value }))}
                placeholder="Ej: DS-2024-00123"
                maxLength={100}
              />
            </div>
            <div>
              <label style={labelStyle}>Cantidad Derecho de Servicio (m³)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.01"
                value={form.cantidad_derecho_servicio_m3}
                onChange={e => setForm(f => ({ ...f, cantidad_derecho_servicio_m3: e.target.value }))}
                placeholder="Ej: 15.00"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <textarea
                style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                value={form.descripcion}
                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Descripción opcional del contador..."
                maxLength={500}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Estado:</label>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, activo: !f.activo }))}
                style={{
                  padding: '6px 16px',
                  borderRadius: '20px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '13px',
                  background: form.activo ? '#dcfce7' : '#fee2e2',
                  color: form.activo ? '#166534' : '#991b1b',
                }}
              >
                {form.activo ? 'Activo' : 'Inactivo'}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleGuardar}
              disabled={loading}
              style={{
                padding: '10px 24px',
                background: loading ? '#94a3b8' : 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
              }}
            >
              {loading ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar'}
            </button>
            <button
              onClick={cancelForm}
              style={{
                padding: '10px 24px',
                background: '#f1f5f9',
                color: '#475569',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔧</div>
            <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '6px' }}>
              {search || filterTipo ? 'Sin resultados' : 'No hay contadores registrados'}
            </div>
            <div style={{ fontSize: '14px' }}>
              {search || filterTipo
                ? 'Intenta con otro término o tipología'
                : canEdit
                ? 'Crea el primer contador con el botón "+ Nuevo Contador"'
                : 'No hay contadores configurados aún'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>N° Serie</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Tipología</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Marca / Modelo</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Características</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Lect. Inicial</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Unidad</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Tarifa</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>Estado</th>
                  {canEdit && (
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => {
                  const col = TIPO_COLORES[c.tipo_agua]
                  return (
                    <tr
                      key={c.id}
                      style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? 'white' : '#fafbfc' }}
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1e293b' }}>
                        {c.numero_serie}
                        {c.descripcion && (
                          <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 400, marginTop: '2px' }}>
                            {c.descripcion}
                          </div>
                        )}
                        {c.fecha_instalacion && (
                          <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '1px' }}>
                            Inst: {new Date(c.fecha_instalacion + 'T12:00:00').toLocaleDateString('es-GT')}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: '12px',
                          background: col.bg,
                          color: col.color,
                          fontSize: '12px',
                          fontWeight: 600,
                        }}>
                          {tipoLabel(c.tipo_agua)}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#475569' }}>
                        {c.marca && <span style={{ fontWeight: 500 }}>{c.marca}</span>}
                        {c.marca && c.modelo && ' / '}
                        {c.modelo && <span style={{ color: '#94a3b8' }}>{c.modelo}</span>}
                        {!c.marca && !c.modelo && <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '12px', color: '#475569' }}>
                        {c.medida && <div><span style={{ color: '#94a3b8' }}>Medida:</span> {c.medida}</div>}
                        {c.tipo_contador && <div><span style={{ color: '#94a3b8' }}>Tipo:</span> {c.tipo_contador}</div>}
                        {c.material && <div><span style={{ color: '#94a3b8' }}>Material:</span> {c.material}</div>}
                        {c.valvula_cheque && <div><span style={{ color: '#94a3b8' }}>V. Cheque:</span> {c.valvula_cheque}</div>}
                        {c.tipo_llave && <div><span style={{ color: '#94a3b8' }}>Llave:</span> {c.tipo_llave}</div>}
                        {c.llave_antifraude && <div><span style={{ color: '#94a3b8' }}>Antifraude:</span> {c.llave_antifraude}</div>}
                        {c.valvula_aire && <div><span style={{ color: '#94a3b8' }}>V. Aire:</span> {c.valvula_aire}</div>}
                        {c.fecha_reemplazo_sugerida && (
                          <div style={{ color: new Date(c.fecha_reemplazo_sugerida + 'T12:00:00') <= new Date() ? '#dc2626' : '#0369a1', fontWeight: 600 }}>
                            Reemplazo: {new Date(c.fecha_reemplazo_sugerida + 'T12:00:00').toLocaleDateString('es-GT')}
                          </div>
                        )}
                        {c.numero_derecho_servicio && (
                          <div><span style={{ color: '#94a3b8' }}>Derecho:</span> {c.numero_derecho_servicio}</div>
                        )}
                        {c.cantidad_derecho_servicio_m3 != null && (
                          <div><span style={{ color: '#94a3b8' }}>Caudal:</span> {Number(c.cantidad_derecho_servicio_m3).toFixed(2)} m³</div>
                        )}
                        {!c.medida && !c.tipo_contador && !c.material && !c.valvula_cheque && !c.tipo_llave && !c.llave_antifraude && !c.valvula_aire && !c.fecha_reemplazo_sugerida && !c.numero_derecho_servicio && c.cantidad_derecho_servicio_m3 == null && (
                          <span style={{ color: '#cbd5e1' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                        {Number(c.lectura_inicial).toFixed(4)}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {unidadNombre(c.unidad_id) ? (
                          <span style={{
                            padding: '3px 10px',
                            borderRadius: '12px',
                            background: '#f0fdf4',
                            color: '#065f46',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}>
                            🏠 {unidadNombre(c.unidad_id)}
                          </span>
                        ) : (
                          <span style={{ color: '#cbd5e1', fontSize: '13px' }}>Sin unidad</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {tarifaNombre(c.tarifa_id) ? (
                          <span style={{
                            padding: '3px 10px',
                            borderRadius: '12px',
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}>
                            {tarifaNombre(c.tarifa_id)}
                          </span>
                        ) : (
                          <span style={{ color: '#cbd5e1', fontSize: '13px' }}>Sin tarifa</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        {canEdit ? (
                          <button
                            onClick={() => handleToggleActivo(c)}
                            title="Clic para cambiar estado"
                            style={{
                              padding: '4px 14px',
                              borderRadius: '20px',
                              border: 'none',
                              cursor: 'pointer',
                              fontWeight: 600,
                              fontSize: '12px',
                              background: c.activo ? '#dcfce7' : '#fee2e2',
                              color: c.activo ? '#166534' : '#991b1b',
                            }}
                          >
                            {c.activo ? 'Activo' : 'Inactivo'}
                          </button>
                        ) : (
                          <span style={{
                            padding: '4px 14px',
                            borderRadius: '20px',
                            fontWeight: 600,
                            fontSize: '12px',
                            background: c.activo ? '#dcfce7' : '#fee2e2',
                            color: c.activo ? '#166534' : '#991b1b',
                          }}>
                            {c.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        )}
                      </td>
                      {canEdit && (
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button
                              onClick={() => startEdit(c)}
                              style={{
                                padding: '5px 12px',
                                background: '#eff6ff',
                                color: '#1d4ed8',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '12px',
                              }}
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => handleEliminar(c)}
                              style={{
                                padding: '5px 12px',
                                background: '#fef2f2',
                                color: '#dc2626',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '12px',
                              }}
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', color: '#94a3b8', fontSize: '12px' }}>
          {filtered.length} contador{filtered.length !== 1 ? 'es' : ''}{' '}
          {search || filterTipo || filterUnidad ? 'encontrados' : 'registrados'} ·{' '}
          {contadores.filter(c => c.unidad_id).length} con unidad ·{' '}
          {contadores.filter(c => c.tarifa_id).length} con tarifa asignada
        </div>
      </div>
    </div>
  )
}
