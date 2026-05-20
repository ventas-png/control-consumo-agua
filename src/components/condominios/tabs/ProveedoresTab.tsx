import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ContratoProveedor, ServicioProveedor, EstadoContrato } from '../../../types'
import Swal from 'sweetalert2'
import { FileUploader } from '../FileUploader'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

interface Props {
  contratos: ContratoProveedor[]
  proyectoId: string
  companyId: string
  moneda: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const SERVICIOS: { value: ServicioProveedor; label: string; icon: string }[] = [
  { value: 'limpieza',       label: 'Limpieza',       icon: '🧹' },
  { value: 'jardineria',     label: 'Jardinería',     icon: '🌿' },
  { value: 'seguridad',      label: 'Seguridad',      icon: '🛡️' },
  { value: 'mantenimiento',  label: 'Mantenimiento',  icon: '🔧' },
  { value: 'elevadores',     label: 'Elevadores',     icon: '🛗' },
  { value: 'piscina',        label: 'Piscina',        icon: '🏊' },
  { value: 'otro',           label: 'Otro',           icon: '📋' },
]

const ESTADO_COLORS: Record<string, string> = {
  activo:    '#10b981',
  vencido:   '#f59e0b',
  terminado: '#7E9389',
}

const blank = (): Partial<ContratoProveedor> => ({
  proveedor_nombre: '',
  proveedor_contacto: '',
  proveedor_telefono: '',
  proveedor_email: '',
  servicio: 'otro',
  descripcion: '',
  monto_mensual: undefined,
  fecha_inicio: new Date().toISOString().slice(0, 10),
  fecha_fin: '',
  estado: 'activo',
  documento_url: '',
  notas: '',
})

export function ProveedoresTab({ contratos, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const [filtroServicio, setFiltroServicio] = useState<ServicioProveedor | 'todos'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<string>('activo')
  const [form, setForm] = useState<Partial<ContratoProveedor>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const hoy = new Date().toISOString().slice(0, 10)

  const filtered = contratos.filter(c => {
    if (filtroEstado !== 'todos' && c.estado !== filtroEstado) return false
    if (filtroServicio !== 'todos' && c.servicio !== filtroServicio) return false
    return true
  })

  const isVencido = (c: ContratoProveedor) =>
    c.estado === 'activo' && c.fecha_fin && c.fecha_fin < hoy

  const porVencer = contratos.filter(c =>
    c.estado === 'activo' && c.fecha_fin &&
    c.fecha_fin >= hoy &&
    new Date(c.fecha_fin).getTime() - Date.now() < 30 * 24 * 3600 * 1000
  )

  function startEdit(c: ContratoProveedor) {
    setForm({
      proveedor_nombre: c.proveedor_nombre,
      proveedor_contacto: c.proveedor_contacto ?? '',
      proveedor_telefono: c.proveedor_telefono ?? '',
      proveedor_email: c.proveedor_email ?? '',
      servicio: c.servicio,
      descripcion: c.descripcion ?? '',
      monto_mensual: c.monto_mensual,
      fecha_inicio: c.fecha_inicio,
      fecha_fin: c.fecha_fin ?? '',
      estado: c.estado,
      documento_url: c.documento_url ?? '',
      notas: c.notas ?? '',
    })
    setEditId(c.id)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditId(null)
    setForm(blank())
  }

  async function handleSave() {
    if (!form.proveedor_nombre?.trim()) return Swal.fire('Campo requerido', 'Ingresa el nombre del proveedor.', 'warning')
    if (!form.fecha_inicio) return Swal.fire('Campo requerido', 'Ingresa la fecha de inicio.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId,
      project_id: proyectoId,
      proveedor_nombre: form.proveedor_nombre!.trim(),
      proveedor_contacto: form.proveedor_contacto || null,
      proveedor_telefono: form.proveedor_telefono || null,
      proveedor_email: form.proveedor_email || null,
      servicio: form.servicio ?? 'otro',
      descripcion: form.descripcion || null,
      monto_mensual: form.monto_mensual ?? null,
      fecha_inicio: form.fecha_inicio!,
      fecha_fin: form.fecha_fin || null,
      estado: form.estado ?? 'activo',
      documento_url: form.documento_url || null,
      notas: form.notas || null,
    }
    if (editId) {
      const { error } = await supabase.from('contratos_proveedores').update(payload).eq('id', editId)
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    } else {
      const { error } = await supabase.from('contratos_proveedores').insert(payload)
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    }
    setSaving(false)
    cancelForm()
    onRefresh()
  }

  async function handleDelete(id: string) {
    const result = await Swal.fire({
      title: '¿Eliminar contrato?', text: 'Esta acción no se puede deshacer.',
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444',
    })
    if (!result.isConfirmed) return
    const { error } = await supabase.from('contratos_proveedores').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: string) {
    const { error } = await supabase.from('contratos_proveedores').update({ estado }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const servicioInfo = (s: ServicioProveedor) => SERVICIOS.find(x => x.value === s) ?? SERVICIOS[SERVICIOS.length - 1]
  const totalMensual = filtered.filter(c => c.estado === 'activo').reduce((s, c) => s + (c.monto_mensual ?? 0), 0)

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Contratos de Proveedores',
      proyectoNombre,
      headers: ['Proveedor', 'Servicio', 'Contacto', 'Teléfono', 'Monto/mes', 'Inicio', 'Fin', 'Estado'],
      rows: filtered.map(c => [c.proveedor_nombre, servicioInfo(c.servicio).label, c.proveedor_contacto ?? '—', c.proveedor_telefono ?? '—', c.monto_mensual != null ? `${moneda} ${c.monto_mensual.toFixed(2)}` : '—', c.fecha_inicio, c.fecha_fin ?? '—', c.estado]),
      totalesRow: ['TOTAL ACTIVOS', '', '', '', `${moneda} ${totalMensual.toFixed(2)}`, '', '', ''],
      rightAlignCols: [4],
      filename: `proveedores-${new Date().toISOString().slice(0, 10)}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`proveedores-${new Date().toISOString().slice(0, 10)}`, [{
      name: 'Proveedores',
      headers: ['Proveedor', 'Servicio', 'Contacto', 'Teléfono', 'Email', 'Monto Mensual', 'Inicio', 'Fin', 'Estado', 'Notas'],
      rows: contratos.map(c => [c.proveedor_nombre, servicioInfo(c.servicio).label, c.proveedor_contacto ?? '', c.proveedor_telefono ?? '', c.proveedor_email ?? '', c.monto_mensual ?? '', c.fecha_inicio, c.fecha_fin ?? '', c.estado, c.notas ?? '']),
    }])
  }

  const inputStyle: CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px',
    fontSize: '13px', color: '#15291F', background: '#FAF7EF', boxSizing: 'border-box',
  }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#7E9389', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* Alert por vencer */}
      {porVencer.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '10px', padding: '10px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>⚠️</span>
          <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 600 }}>
            {porVencer.length} contrato{porVencer.length > 1 ? 's' : ''} vence{porVencer.length === 1 ? '' : 'n'} en menos de 30 días
          </span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Contratos de Proveedores</h2>
          {totalMensual > 0 && (
            <span style={{ fontSize: '12px', color: '#7E9389' }}>
              Total mensual activos: <strong style={{ color: '#1B3B36' }}>{moneda} {totalMensual.toFixed(2)}</strong>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={exportarPDF} disabled={contratos.length === 0} style={{ padding: '7px 12px', background: '#EEF2EC', color: '#1B3B36', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📄 PDF</button>
          <button onClick={exportarXlsx} disabled={contratos.length === 0} style={{ padding: '7px 12px', background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #86efac', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📊 Excel</button>
          {canCreate && !showForm && (
            <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              + Nuevo Contrato
            </button>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#FAF7EF', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: '#15291F' }}>
            {editId ? 'Editar Contrato' : 'Nuevo Contrato'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Proveedor *</label>
              <input style={inputStyle} value={form.proveedor_nombre ?? ''} onChange={e => setForm(f => ({ ...f, proveedor_nombre: e.target.value }))} placeholder="Nombre del proveedor" />
            </div>
            <div>
              <label style={labelStyle}>Servicio *</label>
              <select style={inputStyle} value={form.servicio ?? 'otro'} onChange={e => setForm(f => ({ ...f, servicio: e.target.value as ServicioProveedor }))}>
                {SERVICIOS.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Contacto</label>
              <input style={inputStyle} value={form.proveedor_contacto ?? ''} onChange={e => setForm(f => ({ ...f, proveedor_contacto: e.target.value }))} placeholder="Nombre del contacto" />
            </div>
            <div>
              <label style={labelStyle}>Teléfono</label>
              <input style={inputStyle} value={form.proveedor_telefono ?? ''} onChange={e => setForm(f => ({ ...f, proveedor_telefono: e.target.value }))} placeholder="+502 0000-0000" />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} type="email" value={form.proveedor_email ?? ''} onChange={e => setForm(f => ({ ...f, proveedor_email: e.target.value }))} placeholder="correo@proveedor.com" />
            </div>
            <div>
              <label style={labelStyle}>Monto Mensual ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto_mensual ?? ''} onChange={e => setForm(f => ({ ...f, monto_mensual: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Fecha Inicio *</label>
              <input style={inputStyle} type="date" value={form.fecha_inicio ?? ''} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Fecha Fin</label>
              <input style={inputStyle} type="date" value={form.fecha_fin ?? ''} onChange={e => setForm(f => ({ ...f, fecha_fin: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'activo'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoContrato }))}>
                <option value="activo">Activo</option>
                <option value="vencido">Vencido</option>
                <option value="terminado">Terminado</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <FileUploader
                value={form.documento_url ?? null}
                onChange={url => setForm(f => ({ ...f, documento_url: url ?? '' }))}
                folder="contratos"
                label="Contrato / Documento (PDF)"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción del servicio contratado..." />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas internas</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Notas adicionales..." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#7E9389' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Crear Contrato'}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Estado */}
        {(['todos', 'activo', 'vencido', 'terminado'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? '#1B3B36' : '#E1DDD0',
              background: filtroEstado === e ? '#D9E2DC' : 'white',
              color: filtroEstado === e ? '#1B3B36' : '#7E9389' }}>
            {e === 'todos' ? 'Todos' : e.charAt(0).toUpperCase() + e.slice(1)}
            {e !== 'todos' && ` (${contratos.filter(c => c.estado === e).length})`}
          </button>
        ))}
        <div style={{ width: '1px', height: '24px', background: '#E1DDD0', margin: '0 4px' }} />
        {/* Servicio */}
        <select value={filtroServicio} onChange={e => setFiltroServicio(e.target.value as ServicioProveedor | 'todos')}
          style={{ padding: '5px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '12px', background: '#FAF7EF' }}>
          <option value="todos">Todos los servicios</option>
          {SERVICIOS.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#7E9389' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay contratos</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#FAF7EF', borderBottom: '2px solid var(--at-line)' }}>
                {['Proveedor', 'Servicio', 'Contacto', 'Monto/mes', 'Vigencia', 'Estado', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#7E9389', fontSize: '12px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const si = servicioInfo(c.servicio)
                const vencido = isVencido(c)
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--at-chip)', background: vencido ? '#fff7ed' : 'white' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600, color: '#15291F' }}>{c.proveedor_nombre}</div>
                      {c.descripcion && <div style={{ fontSize: '11px', color: '#7E9389', marginTop: '2px' }}>{c.descripcion.slice(0, 50)}{c.descripcion.length > 50 ? '…' : ''}</div>}
                      {vencido && <span style={{ fontSize: '11px', background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>Expirado</span>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: '18px' }}>{si.icon}</span>
                      <div style={{ fontSize: '11px', color: '#7E9389', marginTop: '2px' }}>{si.label}</div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {c.proveedor_contacto && <div style={{ color: '#3E5A4C' }}>{c.proveedor_contacto}</div>}
                      {c.proveedor_telefono && <div style={{ fontSize: '11px', color: '#7E9389' }}>📞 {c.proveedor_telefono}</div>}
                      {c.proveedor_email && <div style={{ fontSize: '11px', color: '#7E9389' }}>✉️ {c.proveedor_email}</div>}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: '#15291F' }}>
                      {c.monto_mensual != null ? `${moneda} ${c.monto_mensual.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', color: '#7E9389' }}>
                      <div>{c.fecha_inicio}</div>
                      {c.fecha_fin && <div>→ {c.fecha_fin}</div>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {canEdit ? (
                        <select value={c.estado} onChange={e => handleEstado(c.id, e.target.value)}
                          style={{ padding: '4px 8px', border: '1.5px solid var(--at-line)', borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: ESTADO_COLORS[c.estado] ?? '#7E9389', background: 'white', cursor: 'pointer' }}>
                          <option value="activo">Activo</option>
                          <option value="vencido">Vencido</option>
                          <option value="terminado">Terminado</option>
                        </select>
                      ) : (
                        <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: '#EAE6D8', color: ESTADO_COLORS[c.estado] ?? '#7E9389' }}>
                          {c.estado}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {c.documento_url && (
                          <a href={c.documento_url} target="_blank" rel="noreferrer"
                            style={{ padding: '4px 8px', background: '#EAE6D8', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', textDecoration: 'none', color: '#3E5A4C' }}>
                            📄
                          </a>
                        )}
                        {canEdit && (
                          <button onClick={() => startEdit(c)} style={{ padding: '4px 8px', background: '#EAE6D8', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#3E5A4C' }}>✏️</button>
                        )}
                        {canEdit && (
                          <button onClick={() => handleDelete(c.id)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
