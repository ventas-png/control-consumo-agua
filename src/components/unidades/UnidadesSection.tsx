import { useState } from 'react'
import Swal from 'sweetalert2'
import type { Unidad, TipoUnidad, UserRole, UserSession, Contador, MaxUnidadesPorTipo } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'

interface Props {
  unidades: Unidad[]
  contadores: Contador[]
  userRole: UserRole
  currentUser: UserSession
  maxUnidadesPorTipo?: MaxUnidadesPorTipo | null
  onUnidadAdded: (unidad: Unidad) => void
  onUnidadUpdated: (id: string, partial: Partial<Unidad>) => void
  onUnidadDeleted: (id: string) => void
}

const TIPOS_UNIDAD: { value: TipoUnidad; label: string; icon: string }[] = [
  { value: 'apartamento',    label: 'Apartamento',     icon: '🏢' },
  { value: 'casa',           label: 'Casa',            icon: '🏠' },
  { value: 'bodega',         label: 'Bodega',          icon: '🏭' },
  { value: 'local_comercial',label: 'Local Comercial', icon: '🏪' },
  { value: 'oficina',        label: 'Oficina',         icon: '🏛️' },
  { value: 'parqueadero',    label: 'Parqueadero',     icon: '🅿️' },
  { value: 'otro',           label: 'Otro',            icon: '📦' },
]

const TIPO_COLORES: Record<TipoUnidad, { bg: string; color: string }> = {
  apartamento:     { bg: '#e0f2fe', color: '#0369a1' },
  casa:            { bg: '#dcfce7', color: '#166534' },
  bodega:          { bg: '#fef9c3', color: '#854d0e' },
  local_comercial: { bg: '#ffedd5', color: '#c2410c' },
  oficina:         { bg: '#ede9fe', color: '#5b21b6' },
  parqueadero:     { bg: '#f1f5f9', color: '#475569' },
  otro:            { bg: '#fce7f3', color: '#9d174d' },
}

const EMPTY_FORM = {
  nombre: '',
  tipo: 'apartamento' as TipoUnidad,
  descripcion: '',
  piso: '',
  area_m2: '',
  propietario_nombre: '',
  propietario_telefono: '',
  propietario_email: '',
  activo: true,
}

type FormState = typeof EMPTY_FORM

export function UnidadesSection({
  unidades,
  contadores,
  userRole,
  currentUser,
  maxUnidadesPorTipo,
  onUnidadAdded,
  onUnidadUpdated,
  onUnidadDeleted,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<TipoUnidad | ''>('')

  const canEdit = userRole !== 'viewer' && userRole !== 'operator'

  function startCreate() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(true)
  }

  function startEdit(u: Unidad) {
    setForm({
      nombre: u.nombre,
      tipo: u.tipo,
      descripcion: u.descripcion ?? '',
      piso: u.piso != null ? String(u.piso) : '',
      area_m2: u.area_m2 != null ? String(u.area_m2) : '',
      propietario_nombre: u.propietario_nombre ?? '',
      propietario_telefono: u.propietario_telefono ?? '',
      propietario_email: u.propietario_email ?? '',
      activo: u.activo,
    })
    setEditingId(u.id)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleGuardar() {
    const nombre = sanitizeInput(form.nombre)
    const errors: string[] = []
    if (!nombre || nombre.length < 1)
      errors.push('El nombre de la unidad es obligatorio')
    if (form.area_m2 && isNaN(parseFloat(form.area_m2)))
      errors.push('El área debe ser un número válido')
    if (form.piso && isNaN(parseInt(form.piso)))
      errors.push('El piso debe ser un número entero')

    if (errors.length > 0) {
      Swal.fire('Error de validación', errors.join('<br>'), 'error')
      return
    }

    // Check per-type unit limit (only for new units, not edits)
    if (!editingId && maxUnidadesPorTipo) {
      const max = maxUnidadesPorTipo[form.tipo as TipoUnidad]
      if (max !== null && max !== undefined) {
        const currentCount = unidades.filter(u => u.tipo === form.tipo).length
        if (currentCount >= max) {
          const tipoLabel = TIPOS_UNIDAD.find(t => t.value === form.tipo)?.label ?? form.tipo
          Swal.fire({
            icon: 'warning',
            title: 'Límite alcanzado',
            text: `Este proyecto tiene un máximo de ${max} unidad${max !== 1 ? 'es' : ''} de tipo "${tipoLabel}". Ya se han registrado ${currentCount}.`,
            confirmButtonText: 'Entendido',
          })
          return
        }
      }
    }

    setLoading(true)

    const payload = {
      nombre,
      tipo: form.tipo,
      descripcion: form.descripcion || null,
      piso: form.piso ? parseInt(form.piso) : null,
      area_m2: form.area_m2 ? parseFloat(form.area_m2) : null,
      propietario_nombre: form.propietario_nombre || null,
      propietario_telefono: form.propietario_telefono || null,
      propietario_email: form.propietario_email || null,
      activo: form.activo,
      updated_at: new Date().toISOString(),
    }

    if (editingId) {
      const { data, error } = await supabase
        .from('unidades')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single()

      if (!error && data) {
        onUnidadUpdated(editingId, data as Unidad)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Unidad actualizada', timer: 1800, showConfirmButton: false })
      } else {
        Swal.fire('Error', error?.message ?? 'No se pudo actualizar la unidad.', 'error')
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

      // Verificar límite de unidades de la empresa
      const [{ data: empresaData }, { count: unidadesCount }] = await Promise.all([
        supabase.from('companies').select('max_units').eq('id', companyId).single(),
        supabase.from('unidades').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      ])
      const maxUnits = (empresaData as { max_units?: number } | null)?.max_units ?? 50
      const totalUnidades = unidadesCount ?? 0
      if (totalUnidades >= maxUnits) {
        Swal.fire({
          icon: 'warning',
          title: 'Límite de unidades alcanzado',
          html: `Tu empresa ha alcanzado el límite de <b>${maxUnits}</b> unidades.<br>Contacta al superadministrador para aumentar el cupo.`,
          confirmButtonText: 'Entendido',
        })
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('unidades')
        .insert({ ...payload, project_id: projectId, company_id: companyId })
        .select()
        .single()

      if (!error && data) {
        onUnidadAdded(data as Unidad)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Unidad creada', timer: 1800, showConfirmButton: false })
      } else {
        Swal.fire('Error', error?.message ?? 'No se pudo guardar la unidad.', 'error')
      }
    }

    setLoading(false)
  }

  async function handleToggleActivo(u: Unidad) {
    const { error } = await supabase
      .from('unidades')
      .update({ activo: !u.activo, updated_at: new Date().toISOString() })
      .eq('id', u.id)

    if (!error) {
      onUnidadUpdated(u.id, { activo: !u.activo })
    } else {
      Swal.fire('Error', 'No se pudo cambiar el estado.', 'error')
    }
  }

  async function handleEliminar(u: Unidad) {
    const contadoresAsignados = contadores.filter(c => c.unidad_id === u.id).length
    const html = contadoresAsignados > 0
      ? `La unidad <b>${u.nombre}</b> tiene <b>${contadoresAsignados}</b> contador${contadoresAsignados !== 1 ? 'es' : ''} asociado${contadoresAsignados !== 1 ? 's' : ''}.<br>Los contadores quedarán sin unidad asignada.`
      : `<b>${u.nombre}</b> será eliminada permanentemente.`

    const confirm = await Swal.fire({
      title: '¿Eliminar unidad?',
      html,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!confirm.isConfirmed) return

    const { error } = await supabase.from('unidades').delete().eq('id', u.id)
    if (!error) {
      onUnidadDeleted(u.id)
      Swal.fire({ icon: 'success', title: 'Unidad eliminada', timer: 1500, showConfirmButton: false })
    } else {
      Swal.fire('Error', error.message ?? 'No se pudo eliminar la unidad.', 'error')
    }
  }

  const tipoInfo = (value: TipoUnidad) =>
    TIPOS_UNIDAD.find(t => t.value === value) ?? { label: value, icon: '📦' }

  const contadoresDeUnidad = (id: string) =>
    contadores.filter(c => c.unidad_id === id).length

  const filtered = unidades.filter(u => {
    const matchSearch =
      u.nombre.toLowerCase().includes(search.toLowerCase()) ||
      (u.propietario_nombre ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (u.descripcion ?? '').toLowerCase().includes(search.toLowerCase())
    const matchTipo = filterTipo === '' || u.tipo === filterTipo
    return matchSearch && matchTipo
  })

  // Summary by tipo
  const resumen = TIPOS_UNIDAD.map(t => ({
    ...t,
    total: unidades.filter(u => u.tipo === t.value).length,
    max: maxUnidadesPorTipo?.[t.value as TipoUnidad] ?? null,
  })).filter(t => t.total > 0 || (t.max !== null))

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

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#1e293b' }}>Unidades del Proyecto</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748b' }}>
            Apartamentos, casas, bodegas, locales y más — luego se les asignan contadores
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={filterTipo}
            onChange={e => setFilterTipo(e.target.value as TipoUnidad | '')}
            style={{ ...inputStyle, width: '180px' }}
          >
            <option value="">Todos los tipos</option>
            {TIPOS_UNIDAD.map(t => (
              <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Buscar unidad o propietario..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: '220px' }}
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
              + Nueva Unidad
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {resumen.length > 0 && (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
          {resumen.map(r => {
            const col = TIPO_COLORES[r.value as TipoUnidad]
            const isSelected = filterTipo === r.value
            return (
              <div
                key={r.value}
                onClick={() => setFilterTipo(isSelected ? '' : r.value as TipoUnidad)}
                style={{
                  background: isSelected ? col.bg : 'white',
                  border: `2px solid ${isSelected ? col.color : '#e2e8f0'}`,
                  borderRadius: '12px',
                  padding: '12px 18px',
                  cursor: 'pointer',
                  minWidth: '120px',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '20px', marginBottom: '4px' }}>{r.icon}</div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: col.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {r.label}
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: r.max !== null && r.total >= r.max ? '#ef4444' : '#0f172a', margin: '2px 0' }}>
                  {r.total}{r.max !== null ? <span style={{ fontSize: '13px', fontWeight: 500, color: '#94a3b8' }}>/{r.max}</span> : null}
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
            {editingId ? 'Editar Unidad' : 'Nueva Unidad'}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Datos de la Unidad
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Nombre / Número *</label>
                <input
                  style={inputStyle}
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Apto 101, Casa 5, Local A..."
                  maxLength={100}
                />
              </div>
              <div>
                <label style={labelStyle}>Tipo de Unidad *</label>
                <select
                  style={inputStyle}
                  value={form.tipo}
                  onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoUnidad }))}
                >
                  {TIPOS_UNIDAD.map(t => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Piso</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={form.piso}
                  onChange={e => setForm(f => ({ ...f, piso: e.target.value }))}
                  placeholder="Ej: 1, 2, -1 (sótano)..."
                />
              </div>
              <div>
                <label style={labelStyle}>Área (m²)</label>
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.area_m2}
                  onChange={e => setForm(f => ({ ...f, area_m2: e.target.value }))}
                  placeholder="Ej: 85.50"
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Descripción</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '56px', resize: 'vertical' }}
                  value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Notas adicionales sobre la unidad..."
                  maxLength={500}
                />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Datos del Propietario / Ocupante
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Nombre</label>
                <input
                  style={inputStyle}
                  value={form.propietario_nombre}
                  onChange={e => setForm(f => ({ ...f, propietario_nombre: e.target.value }))}
                  placeholder="Nombre del propietario..."
                  maxLength={150}
                />
              </div>
              <div>
                <label style={labelStyle}>Teléfono</label>
                <input
                  style={inputStyle}
                  type="tel"
                  value={form.propietario_telefono}
                  onChange={e => setForm(f => ({ ...f, propietario_telefono: e.target.value }))}
                  placeholder="Teléfono de contacto..."
                  maxLength={20}
                />
              </div>
              <div>
                <label style={labelStyle}>Correo Electrónico</label>
                <input
                  style={inputStyle}
                  type="email"
                  value={form.propietario_email}
                  onChange={e => setForm(f => ({ ...f, propietario_email: e.target.value }))}
                  placeholder="email@ejemplo.com"
                  maxLength={150}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
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
              {form.activo ? 'Activa' : 'Inactiva'}
            </button>
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

      {/* Cards / Table */}
      {filtered.length === 0 ? (
        <div style={{ background: 'white', borderRadius: '16px', padding: '60px', textAlign: 'center', color: '#94a3b8', boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏗️</div>
          <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '6px' }}>
            {search || filterTipo ? 'Sin resultados' : 'No hay unidades registradas'}
          </div>
          <div style={{ fontSize: '14px' }}>
            {search || filterTipo
              ? 'Intenta con otro término o tipo'
              : canEdit
              ? 'Crea la primera unidad con el botón "+ Nueva Unidad"'
              : 'No hay unidades configuradas aún'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {filtered.map(u => {
            const tipo = tipoInfo(u.tipo)
            const col = TIPO_COLORES[u.tipo]
            const nContadores = contadoresDeUnidad(u.id)
            return (
              <div
                key={u.id}
                style={{
                  background: 'white',
                  borderRadius: '14px',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                  overflow: 'hidden',
                  border: u.activo ? '1px solid #e2e8f0' : '1px solid #fca5a5',
                  opacity: u.activo ? 1 : 0.75,
                }}
              >
                {/* Card top stripe */}
                <div style={{ height: '4px', background: col.color }} />

                <div style={{ padding: '18px' }}>
                  {/* Title row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '24px' }}>{tipo.icon}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>{u.nombre}</div>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 9px',
                          borderRadius: '10px',
                          background: col.bg,
                          color: col.color,
                          fontSize: '11px',
                          fontWeight: 600,
                          marginTop: '2px',
                        }}>
                          {tipo.label}
                        </span>
                      </div>
                    </div>
                    <span style={{
                      padding: '3px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 600,
                      background: u.activo ? '#dcfce7' : '#fee2e2',
                      color: u.activo ? '#166534' : '#991b1b',
                      flexShrink: 0,
                    }}>
                      {u.activo ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>

                  {/* Details */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px', fontSize: '13px', color: '#475569' }}>
                    {(u.piso != null || u.area_m2 != null) && (
                      <div style={{ display: 'flex', gap: '16px' }}>
                        {u.piso != null && (
                          <span>🏢 Piso {u.piso}</span>
                        )}
                        {u.area_m2 != null && (
                          <span>📐 {Number(u.area_m2).toFixed(2)} m²</span>
                        )}
                      </div>
                    )}
                    {u.propietario_nombre && (
                      <div>👤 {u.propietario_nombre}</div>
                    )}
                    {u.propietario_telefono && (
                      <div>📞 {u.propietario_telefono}</div>
                    )}
                    {u.propietario_email && (
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ✉️ {u.propietario_email}
                      </div>
                    )}
                    {u.descripcion && (
                      <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>{u.descripcion}</div>
                    )}
                  </div>

                  {/* Contadores badge */}
                  <div style={{ marginBottom: '14px' }}>
                    <span style={{
                      padding: '4px 12px',
                      borderRadius: '20px',
                      background: nContadores > 0 ? '#eff6ff' : '#f8fafc',
                      color: nContadores > 0 ? '#1d4ed8' : '#94a3b8',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: `1px solid ${nContadores > 0 ? '#bfdbfe' : '#e2e8f0'}`,
                    }}>
                      🔧 {nContadores} contador{nContadores !== 1 ? 'es' : ''} asignado{nContadores !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Actions */}
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => startEdit(u)}
                        style={{
                          flex: 1,
                          padding: '7px 0',
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          border: 'none',
                          borderRadius: '7px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '12px',
                        }}
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleToggleActivo(u)}
                        style={{
                          flex: 1,
                          padding: '7px 0',
                          background: u.activo ? '#fef9c3' : '#f0fdf4',
                          color: u.activo ? '#854d0e' : '#166534',
                          border: 'none',
                          borderRadius: '7px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '12px',
                        }}
                      >
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        onClick={() => handleEliminar(u)}
                        style={{
                          padding: '7px 12px',
                          background: '#fef2f2',
                          color: '#dc2626',
                          border: 'none',
                          borderRadius: '7px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '12px',
                        }}
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: '16px', color: '#94a3b8', fontSize: '12px' }}>
        {filtered.length} unidad{filtered.length !== 1 ? 'es' : ''}{' '}
        {search || filterTipo ? 'encontradas' : 'registradas'} ·{' '}
        {unidades.filter(u => u.activo).length} activa{unidades.filter(u => u.activo).length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
