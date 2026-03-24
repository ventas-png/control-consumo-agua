import { useState } from 'react'
import Swal from 'sweetalert2'
import type { Contador, Tarifa, TipoAgua, UserRole, UserSession, Cliente } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'

interface Props {
  contadores: Contador[]
  clientes: Cliente[]
  tarifas: Tarifa[]
  userRole: UserRole
  currentUser: UserSession
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
}

type FormState = typeof EMPTY_FORM

export function ContadoresSection({
  contadores,
  clientes,
  tarifas,
  userRole,
  currentUser,
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
    if (c.cliente_id) {
      const confirm = await Swal.fire({
        title: '¿Eliminar contador?',
        html: `El contador <b>${c.numero_serie}</b> está asignado a un cliente.<br>¿Deseas eliminarlo de todas formas?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
      })
      if (!confirm.isConfirmed) return
    } else {
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
    }

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

  const clienteNombre = (id: string | null | undefined) =>
    id ? (clientes.find(c => c.id === id)?.nombre ?? 'Cliente desconocido') : null

  const tarifasParaTipo = (tipo: TipoAgua) =>
    tarifas.filter(t => t.tipo_agua === tipo && t.activa)

  const tarifaNombre = (id: string | null | undefined) =>
    id ? (tarifas.find(t => t.id === id)?.nombre ?? 'Tarifa desconocida') : null

  const filtered = contadores.filter(c => {
    const matchSearch =
      c.numero_serie.toLowerCase().includes(search.toLowerCase()) ||
      (c.marca ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (c.modelo ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (c.descripcion ?? '').toLowerCase().includes(search.toLowerCase())
    const matchTipo = filterTipo === '' || c.tipo_agua === filterTipo
    return matchSearch && matchTipo
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
    asignados: contadores.filter(c => c.tipo_agua === t.value && c.cliente_id).length,
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
                  {r.asignados} asignado{r.asignados !== 1 ? 's' : ''}
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
                    {t.nombre} — {t.precio_m3} €/m³{t.canon_fijo > 0 ? ` + ${t.canon_fijo} € canon` : ''}
                  </option>
                ))}
                {tarifasParaTipo(form.tipo_agua).length === 0 && (
                  <option disabled value="">No hay tarifas activas para este tipo</option>
                )}
              </select>
            </div>
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
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Lect. Inicial</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Cliente Asignado</th>
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
                  const clienteName = clienteNombre(c.cliente_id)
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
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                        {Number(c.lectura_inicial).toFixed(4)}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {clienteName ? (
                          <span style={{
                            padding: '3px 10px',
                            borderRadius: '12px',
                            background: '#f0fdf4',
                            color: '#15803d',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}>
                            {clienteName}
                          </span>
                        ) : (
                          <span style={{ color: '#cbd5e1', fontSize: '13px' }}>Sin asignar</span>
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
          {search || filterTipo ? 'encontrados' : 'registrados'} ·{' '}
          {contadores.filter(c => c.cliente_id).length} asignado{contadores.filter(c => c.cliente_id).length !== 1 ? 's' : ''} a clientes
        </div>
      </div>
    </div>
  )
}
