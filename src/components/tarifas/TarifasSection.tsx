import { useState } from 'react'
import Swal from 'sweetalert2'
import type { Tarifa, UserRole, UserSession } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput, validateNumber } from '../../lib/validation'

interface Props {
  tarifas: Tarifa[]
  userRole: UserRole
  currentUser: UserSession
  onTarifaAdded: (tarifa: Tarifa) => void
  onTarifaUpdated: (id: string, partial: Partial<Tarifa>) => void
  onTarifaDeleted: (id: string) => void
}

const TIPOS_AGUA = [
  { value: 'potable', label: 'Potable' },
  { value: 'rehuso', label: 'Rehúso' },
  { value: 'piscina', label: 'Piscina' },
  { value: 'desalinada', label: 'Desalinada' },
  { value: 'riego', label: 'Riego' },
  { value: 'jacuzzi', label: 'Jacuzzi' },
  { value: 'consumo_humano', label: 'Consumo Humano' },
  { value: 'desmineralizada', label: 'Desmineralizada' },
  { value: 'residuales_tratadas', label: 'Residuales Tratadas' },
  { value: 'otra', label: 'Otra' },
]

const EMPTY_FORM = {
  nombre: '',
  tipo_agua: 'potable',
  precio_m3: '0.00',
  canon_fijo: '0.00',
  descripcion: '',
  activa: true,
}

type FormState = typeof EMPTY_FORM

export function TarifasSection({
  tarifas,
  userRole,
  currentUser,
  onTarifaAdded,
  onTarifaUpdated,
  onTarifaDeleted,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const canEdit = userRole !== 'viewer' && userRole !== 'operator'

  function startCreate() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(true)
  }

  function startEdit(t: Tarifa) {
    setForm({
      nombre: t.nombre,
      tipo_agua: t.tipo_agua,
      precio_m3: String(t.precio_m3),
      canon_fijo: String(t.canon_fijo),
      descripcion: t.descripcion ?? '',
      activa: t.activa,
    })
    setEditingId(t.id)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleGuardar() {
    const nombre = sanitizeInput(form.nombre)
    const precio_m3 = parseFloat(form.precio_m3)
    const canon_fijo = parseFloat(form.canon_fijo)

    const errors: string[] = []
    if (!nombre || nombre.length < 2) errors.push('Nombre debe tener al menos 2 caracteres')
    if (!validateNumber(precio_m3, 0, 99999)) errors.push('Precio por m³ debe ser un valor entre 0 y 99999')
    if (!validateNumber(canon_fijo, 0, 99999)) errors.push('Canon fijo debe ser un valor entre 0 y 99999')

    if (errors.length > 0) {
      Swal.fire('Error de validación', errors.join('<br>'), 'error')
      return
    }

    setLoading(true)

    if (editingId) {
      const { data, error } = await supabase
        .from('tarifas')
        .update({
          nombre,
          tipo_agua: form.tipo_agua,
          precio_m3,
          canon_fijo,
          descripcion: form.descripcion || null,
          activa: form.activa,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingId)
        .select()
        .single()

      if (!error && data) {
        onTarifaUpdated(editingId, data as Tarifa)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Tarifa actualizada', timer: 1800, showConfirmButton: false })
      } else {
        Swal.fire('Error', error?.message ?? 'No se pudo actualizar la tarifa.', 'error')
      }
    } else {
      const payload: Record<string, unknown> = {
        nombre,
        tipo_agua: form.tipo_agua,
        precio_m3,
        canon_fijo,
        descripcion: form.descripcion || null,
        activa: form.activa,
      }
      if (currentUser.company_id) payload.company_id = currentUser.company_id

      // project_id: admins have it in their profile; company_owner may not
      const { data: userData } = await supabase
        .from('app_users')
        .select('project_id, company_id')
        .eq('id', currentUser.user_id)
        .single()

      if (userData?.project_id) payload.project_id = userData.project_id
      if (userData?.company_id) payload.company_id = userData.company_id

      if (!payload.project_id) {
        // For company_owner: use first project of the company
        const { data: proj } = await supabase
          .from('projects')
          .select('id')
          .eq('company_id', payload.company_id)
          .limit(1)
          .single()
        if (proj) payload.project_id = proj.id
      }

      if (!payload.project_id || !payload.company_id) {
        Swal.fire('Error', 'No se pudo determinar el proyecto o empresa. Contacte al administrador.', 'error')
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('tarifas')
        .insert(payload)
        .select()
        .single()

      if (!error && data) {
        onTarifaAdded(data as Tarifa)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Tarifa creada', timer: 1800, showConfirmButton: false })
      } else {
        Swal.fire('Error', error?.message ?? 'No se pudo guardar la tarifa.', 'error')
      }
    }

    setLoading(false)
  }

  async function handleToggleActiva(t: Tarifa) {
    const { error } = await supabase
      .from('tarifas')
      .update({ activa: !t.activa, updated_at: new Date().toISOString() })
      .eq('id', t.id)

    if (!error) {
      onTarifaUpdated(t.id, { activa: !t.activa })
    } else {
      Swal.fire('Error', 'No se pudo cambiar el estado.', 'error')
    }
  }

  async function handleEliminar(t: Tarifa) {
    const result = await Swal.fire({
      title: '¿Eliminar tarifa?',
      html: `<b>${t.nombre}</b> será eliminada permanentemente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
    })

    if (!result.isConfirmed) return

    const { error } = await supabase.from('tarifas').delete().eq('id', t.id)
    if (!error) {
      onTarifaDeleted(t.id)
      Swal.fire({ icon: 'success', title: 'Tarifa eliminada', timer: 1500, showConfirmButton: false })
    } else {
      Swal.fire('Error', error.message ?? 'No se pudo eliminar la tarifa.', 'error')
    }
  }

  const filtered = tarifas.filter(t =>
    t.nombre.toLowerCase().includes(search.toLowerCase()) ||
    t.tipo_agua.toLowerCase().includes(search.toLowerCase())
  )

  const tipoLabel = (value: string) =>
    TIPOS_AGUA.find(t => t.value === value)?.label ?? value

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
      {/* Header + search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#1e293b' }}>Tarifas Vigentes</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748b' }}>
            Gestiona las tarifas de consumo por tipo de agua
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Buscar tarifa..."
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
              + Nueva Tarifa
            </button>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && canEdit && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '28px', marginBottom: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '17px', fontWeight: 700, marginBottom: '20px', color: '#1e293b' }}>
            {editingId ? 'Editar Tarifa' : 'Nueva Tarifa'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label style={labelStyle}>Nombre *</label>
              <input
                style={inputStyle}
                value={form.nombre}
                onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Tarifa Residencial"
                maxLength={100}
              />
            </div>
            <div>
              <label style={labelStyle}>Tipo de Agua *</label>
              <select
                style={inputStyle}
                value={form.tipo_agua}
                onChange={e => setForm(f => ({ ...f, tipo_agua: e.target.value }))}
              >
                {TIPOS_AGUA.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Precio por m³ *</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.0001"
                value={form.precio_m3}
                onChange={e => setForm(f => ({ ...f, precio_m3: e.target.value }))}
                placeholder="0.0000"
              />
            </div>
            <div>
              <label style={labelStyle}>Canon Fijo (mensual)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.01"
                value={form.canon_fijo}
                onChange={e => setForm(f => ({ ...f, canon_fijo: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <textarea
                style={{ ...inputStyle, minHeight: '70px', resize: 'vertical' }}
                value={form.descripcion}
                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Descripción opcional de la tarifa..."
                maxLength={500}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Estado:</label>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, activa: !f.activa }))}
                style={{
                  padding: '6px 16px',
                  borderRadius: '20px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '13px',
                  background: form.activa ? '#dcfce7' : '#fee2e2',
                  color: form.activa ? '#166534' : '#991b1b',
                }}
              >
                {form.activa ? 'Activa' : 'Inactiva'}
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
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>💰</div>
            <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '6px' }}>
              {search ? 'Sin resultados' : 'No hay tarifas registradas'}
            </div>
            <div style={{ fontSize: '14px' }}>
              {search ? 'Intenta con otro término de búsqueda' : canEdit ? 'Crea la primera tarifa con el botón "+ Nueva Tarifa"' : 'No hay tarifas configuradas aún'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Nombre</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Tipo de Agua</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Precio/m³</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Canon Fijo</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>Estado</th>
                  {canEdit && (
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, idx) => (
                  <tr
                    key={t.id}
                    style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? 'white' : '#fafbfc' }}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1e293b' }}>
                      {t.nombre}
                      {t.descripcion && (
                        <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 400, marginTop: '2px' }}>
                          {t.descripcion}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '3px 10px',
                        borderRadius: '12px',
                        background: '#e0f2fe',
                        color: '#0369a1',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}>
                        {tipoLabel(t.tipo_agua)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                      Q {Number(t.precio_m3).toFixed(4)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: '#475569' }}>
                      Q {Number(t.canon_fijo).toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      {canEdit ? (
                        <button
                          onClick={() => handleToggleActiva(t)}
                          title="Clic para cambiar estado"
                          style={{
                            padding: '4px 14px',
                            borderRadius: '20px',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '12px',
                            background: t.activa ? '#dcfce7' : '#fee2e2',
                            color: t.activa ? '#166534' : '#991b1b',
                          }}
                        >
                          {t.activa ? 'Activa' : 'Inactiva'}
                        </button>
                      ) : (
                        <span style={{
                          padding: '4px 14px',
                          borderRadius: '20px',
                          fontWeight: 600,
                          fontSize: '12px',
                          background: t.activa ? '#dcfce7' : '#fee2e2',
                          color: t.activa ? '#166534' : '#991b1b',
                        }}>
                          {t.activa ? 'Activa' : 'Inactiva'}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            onClick={() => startEdit(t)}
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
                            onClick={() => handleEliminar(t)}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', color: '#94a3b8', fontSize: '12px' }}>
          {filtered.length} tarifa{filtered.length !== 1 ? 's' : ''} {search ? 'encontradas' : 'registradas'}
        </div>
      </div>
    </div>
  )
}
