import { useState, type CSSProperties} from 'react'
import Swal from 'sweetalert2'
import type { Tarifa, UserRole, UserSession, Proyecto } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput, validateNumber } from '../../lib/validation'
import { EditModal } from '../shared/EditModal'
import { getEditedTagInfo } from '../../lib/timeUtils'

interface Props {
  tarifas: Tarifa[]
  proyectos: Proyecto[]
  userRole: UserRole
  currentUser: UserSession
  moneda?: string
  onTarifaAdded: (tarifa: Tarifa) => void
  onTarifaUpdated: (id: string, partial: Partial<Tarifa>) => void
  onTarifaDeleted: (id: string) => void
  canCreate?: boolean
  canEdit?: boolean
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
  precio_m3_exceso: '0.0000',
  canon_fijo: '0.00',
  consumo_minimo: '0.0000',
  descripcion: '',
  activa: true,
  fecha_revision: '',
  project_id: '',
}

type FormState = typeof EMPTY_FORM

export function TarifasSection({
  tarifas,
  proyectos,
  userRole,
  currentUser,
  moneda = 'Q',
  onTarifaAdded,
  onTarifaUpdated,
  onTarifaDeleted,
  canCreate: canCreateProp = true,
  canEdit: canEditProp = true,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const canCreate = canCreateProp && userRole !== 'viewer'
  const canEdit = canEditProp && userRole !== 'viewer'

  function startCreate() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setIsModalOpen(true)
  }

  function startEdit(t: Tarifa) {
    setForm({
      nombre: t.nombre,
      tipo_agua: t.tipo_agua,
      precio_m3: String(t.precio_m3),
      precio_m3_exceso: String(t.precio_m3_exceso ?? 0),
      canon_fijo: String(t.canon_fijo),
      consumo_minimo: String(t.consumo_minimo ?? 0),
      descripcion: t.descripcion ?? '',
      activa: t.activa,
      fecha_revision: t.fecha_revision ?? '',
      project_id: t.project_id ?? '',
    })
    setEditingId(t.id)
    setIsModalOpen(true)
  }

  function cancelForm() {
    setIsModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleGuardar() {
    const nombre = sanitizeInput(form.nombre)
    const precio_m3 = parseFloat(form.precio_m3)
    const precio_m3_exceso = parseFloat(form.precio_m3_exceso)
    const canon_fijo = parseFloat(form.canon_fijo)
    const consumo_minimo = parseFloat(form.consumo_minimo)

    const errors: string[] = []
    if (!nombre || nombre.length < 2) errors.push('Nombre debe tener al menos 2 caracteres')
    if (!validateNumber(precio_m3, 0, 99999)) errors.push('Precio por m³ debe ser un valor entre 0 y 99999')
    if (!validateNumber(precio_m3_exceso, 0, 99999)) errors.push('Precio por m³ exceso debe ser un valor entre 0 y 99999')
    if (!validateNumber(canon_fijo, 0, 99999)) errors.push('Canon fijo debe ser un valor entre 0 y 99999')
    if (!validateNumber(consumo_minimo, 0, 99999)) errors.push('Consumo mínimo debe ser un valor entre 0 y 99999')

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
          precio_m3_exceso,
          canon_fijo,
          consumo_minimo,
          descripcion: form.descripcion || null,
          activa: true,
          fecha_revision: form.fecha_revision || null,
          updated_at: new Date().toISOString(),
          updated_by: currentUser.user_id,
          updated_by_name: currentUser.name || currentUser.email,
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
      // Derive project_id from the explicitly selected project in the form.
      const selectedProyecto = proyectos.find(p => p.id === form.project_id)
      const projectId: string | null = selectedProyecto?.id ?? null
      const companyId: string | null = currentUser.company_id ?? null

      if (!projectId || !companyId) {
        Swal.fire('Error', 'Debes seleccionar un proyecto para la tarifa.', 'error')
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('tarifas')
        .insert({
          nombre,
          tipo_agua: form.tipo_agua,
          precio_m3,
          precio_m3_exceso,
          canon_fijo,
          consumo_minimo,
          descripcion: form.descripcion || null,
          activa: form.activa,
          fecha_revision: form.fecha_revision || null,
          project_id: projectId,
          company_id: companyId,
        })
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
      cancelButtonColor: 'var(--at-ink-3)',
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

  function getRevisionStatus(t: Tarifa): 'expired' | 'soon' | 'ok' | 'none' {
    if (!t.fecha_revision) return 'none'
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const rev = new Date(t.fecha_revision + 'T00:00:00')
    const diff = Math.ceil((rev.getTime() - today.getTime()) / 86400000)
    if (diff < 0) return 'expired'
    if (diff <= 30) return 'soon'
    return 'ok'
  }

  const inputStyle: CSSProperties = {
    padding: '10px 14px',
    border: '2px solid var(--at-line)',
    borderRadius: '8px',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
  }
  const labelStyle: CSSProperties = {
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
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--at-ink)' }}>Tarifas Vigentes</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--at-ink-3)' }}>
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
          {canCreate && (
            <button
              onClick={startCreate}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
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

      {/* Form Modal */}
      {isModalOpen && canEdit && (
        <EditModal title={editingId ? 'Editar Tarifa' : 'Nueva Tarifa'} onClose={cancelForm}>
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
            {!editingId && (
              <div>
                <label style={labelStyle}>Proyecto *</label>
                <select
                  style={inputStyle}
                  value={form.project_id}
                  onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
                >
                  <option value="">-- Seleccionar proyecto --</option>
                  {proyectos.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
            )}
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
              <label style={labelStyle}>Precio por m³ exceso</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.0001"
                value={form.precio_m3_exceso}
                onChange={e => setForm(f => ({ ...f, precio_m3_exceso: e.target.value }))}
                placeholder="0.0000"
              />
              <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px', display: 'block' }}>
                Precio diferenciado para consumo que exceda el mínimo
              </span>
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
            <div>
              <label style={labelStyle}>Consumo Mínimo (m³)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.0001"
                value={form.consumo_minimo}
                onChange={e => setForm(f => ({ ...f, consumo_minimo: e.target.value }))}
                placeholder="0.0000"
              />
              <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px', display: 'block' }}>
                Si consumo ≤ este valor, se cobra solo el canon fijo
              </span>
            </div>
            <div style={{ gridColumn: '1 / -1', background: 'var(--at-surface-2)', borderRadius: '8px', padding: '14px 16px', border: '1px solid var(--at-line)' }}>
              <label style={{ ...labelStyle, color: 'var(--at-ink)' }}>Fecha de Revisión</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <input
                  style={{ ...inputStyle, width: 'auto', minWidth: '180px', background: 'var(--at-surface)' }}
                  type="date"
                  value={form.fecha_revision}
                  onChange={e => setForm(f => ({ ...f, fecha_revision: e.target.value }))}
                />
                {form.fecha_revision && (
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, fecha_revision: '' }))}
                    style={{ fontSize: '12px', color: 'var(--at-ink-3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Quitar fecha
                  </button>
                )}
                <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                  Si la fecha pasa sin renovar, la tarifa se desactivará automáticamente
                </span>
              </div>
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
                background: loading ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
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
                background: 'var(--at-chip)',
                color: 'var(--at-ink-2)',
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
        </EditModal>
      )}

      {/* Table */}
      <div style={{ background: 'var(--at-surface)', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: 'var(--at-ink-3)' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>💰</div>
            <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '6px' }}>
              {search ? 'Sin resultados' : 'No hay tarifas registradas'}
            </div>
            <div style={{ fontSize: '14px' }}>
              {search ? 'Intenta con otro término de búsqueda' : canCreate ? 'Crea la primera tarifa con el botón "+  Nueva Tarifa"' : 'No hay tarifas configuradas aún'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--at-ink-2)' }}>Nombre</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--at-ink-2)' }}>Tipo de Agua</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--at-ink-2)' }}>Precio/m³</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--at-ink-2)' }}>Precio Exceso/m³</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--at-ink-2)' }}>Canon Fijo</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--at-ink-2)' }}>Cons. Mínimo</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--at-ink-2)' }}>Estado</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--at-ink-2)' }}>Revisión</th>
                  {canEdit && (
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--at-ink-2)' }}>Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, idx) => (
                  <tr
                    key={t.id}
                    style={{ borderBottom: '1px solid var(--at-chip)', background: idx % 2 === 0 ? 'var(--at-surface)' : 'var(--at-surface-2)' }}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--at-ink)' }}>
                      {t.nombre}
                      {t.descripcion && (
                        <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontWeight: 400, marginTop: '2px' }}>
                          {t.descripcion}
                        </div>
                      )}
                      {(() => {
                        const tag = getEditedTagInfo(t.updated_at, t.updated_by_name)
                        if (!tag) return null
                        return (
                          <span
                            title={tag.tooltip}
                            style={{
                              display: 'inline-block',
                              marginTop: '4px',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              fontSize: '11px',
                              fontWeight: 500,
                              color: tag.color,
                              background: tag.bg,
                              cursor: 'default',
                            }}
                          >
                            {tag.label}
                          </span>
                        )
                      })()}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '3px 10px',
                        borderRadius: '12px',
                        background: 'var(--at-primary-soft)',
                        color: 'var(--at-primary-hover)',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}>
                        {tipoLabel(t.tipo_agua)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--at-ink)' }}>
                      {moneda} {Number(t.precio_m3).toFixed(4)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--at-ink-2)' }}>
                      {Number(t.precio_m3_exceso ?? 0) > 0
                        ? `${moneda} ${Number(t.precio_m3_exceso).toFixed(4)}`
                        : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--at-ink-2)' }}>
                      {moneda} {Number(t.canon_fijo).toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--at-ink-2)' }}>
                      {Number(t.consumo_minimo ?? 0).toFixed(4)} m³
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
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      {(() => {
                        const status = getRevisionStatus(t)
                        if (status === 'none') return <span style={{ color: 'var(--at-ink-3)', fontSize: '12px' }}>—</span>
                        const cfg = {
                          expired: { bg: '#fee2e2', color: '#991b1b', prefix: 'Vencida: ' },
                          soon:    { bg: '#fef9c3', color: '#854d0e', prefix: 'Próxima: ' },
                          ok:      { bg: '#dcfce7', color: '#166534', prefix: '' },
                        }[status]
                        return (
                          <span style={{
                            padding: '3px 8px', borderRadius: '10px', fontSize: '11px',
                            fontWeight: 600, background: cfg.bg, color: cfg.color,
                            whiteSpace: 'nowrap',
                          }}>
                            {cfg.prefix}{t.fecha_revision}
                          </span>
                        )
                      })()}
                    </td>
                    {canEdit && (
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            onClick={() => startEdit(t)}
                            style={{
                              padding: '5px 12px',
                              background: 'var(--at-primary-tint)',
                              color: 'var(--at-primary-hover)',
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
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--at-chip)', color: 'var(--at-ink-3)', fontSize: '12px' }}>
          {filtered.length} tarifa{filtered.length !== 1 ? 's' : ''} {search ? 'encontradas' : 'registradas'}
        </div>
      </div>
    </div>
  )
}
