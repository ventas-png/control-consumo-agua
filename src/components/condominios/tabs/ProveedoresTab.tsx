import { hoyLocalISO, diasHastaFechaCalendario } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ContratoProveedor, ServicioProveedor, EstadoContrato } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { FileUploader } from '../../shared/FileUploader'
import { SecureFileLink } from '../../shared/SecureFileLink'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

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
  activo:    'var(--at-success)',
  vencido:   'var(--at-warning)',
  terminado: 'var(--at-ink-3)',
}

const blank = (): Partial<ContratoProveedor> => ({
  proveedor_nombre: '',
  proveedor_contacto: '',
  proveedor_telefono: '',
  proveedor_email: '',
  servicio: 'otro',
  descripcion: '',
  monto_mensual: undefined,
  fecha_inicio: hoyLocalISO(),
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

  const hoy = hoyLocalISO()

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
    (diasHastaFechaCalendario(c.fecha_fin) ?? Infinity) < 30
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
    if (!form.proveedor_nombre?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el nombre del proveedor.' })
    if (!form.fecha_inicio) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la fecha de inicio.' })
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
      const { error } = await updateCondominioRow('contratos_proveedores', editId, payload)
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    } else {
      const { error } = await createCondominioRow('contratos_proveedores', payload)
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    }
    setSaving(false)
    cancelForm()
    onRefresh()
  }

  async function handleDelete(id: string) {
    const result = await confirm({ title: '¿Eliminar contrato?', text: 'Esta acción no se puede deshacer.', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!result.isConfirmed) return
    const { error } = await deleteCondominioRow('contratos_proveedores', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function handleEstado(id: string, estado: string) {
    const { error } = await updateCondominioRow('contratos_proveedores', id, { estado })
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
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
      filename: `proveedores-${hoyLocalISO()}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`proveedores-${hoyLocalISO()}`, [{
      name: 'Proveedores',
      headers: ['Proveedor', 'Servicio', 'Contacto', 'Teléfono', 'Email', 'Monto Mensual', 'Inicio', 'Fin', 'Estado', 'Notas'],
      rows: contratos.map(c => [c.proveedor_nombre, servicioInfo(c.servicio).label, c.proveedor_contacto ?? '', c.proveedor_telefono ?? '', c.proveedor_email ?? '', c.monto_mensual ?? '', c.fecha_inicio, c.fecha_fin ?? '', c.estado, c.notas ?? '']),
    }])
  }

  const inputStyle: CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px',
    fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box',
  }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* Alert por vencer */}
      {porVencer.length > 0 && (
        <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning)', borderRadius: '10px', padding: '10px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>⚠️</span>
          <span style={{ fontSize: '13px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>
            {porVencer.length} contrato{porVencer.length > 1 ? 's' : ''} vence{porVencer.length === 1 ? '' : 'n'} en menos de 30 días
          </span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Contratos de Proveedores</h2>
          {totalMensual > 0 && (
            <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
              Total mensual activos: <strong style={{ color: 'var(--at-primary)' }}>{moneda} {totalMensual.toFixed(2)}</strong>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={exportarPDF} disabled={contratos.length === 0} style={{ padding: '7px 12px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📄 PDF</button>
          <button onClick={exportarXlsx} disabled={contratos.length === 0} style={{ padding: '7px 12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1.5px solid var(--at-success-border)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📊 Excel</button>
          {canCreate && !showForm && (
            <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              + Nuevo Contrato
            </button>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>
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
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
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
              borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === e ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'todos' ? 'Todos' : e.charAt(0).toUpperCase() + e.slice(1)}
            {e !== 'todos' && ` (${contratos.filter(c => c.estado === e).length})`}
          </button>
        ))}
        <div style={{ width: '1px', height: '24px', background: 'var(--at-line)', margin: '0 4px' }} />
        {/* Servicio */}
        <select value={filtroServicio} onChange={e => setFiltroServicio(e.target.value as ServicioProveedor | 'todos')}
          style={{ padding: '5px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '12px', background: 'var(--at-surface-2)' }}>
          <option value="todos">Todos los servicios</option>
          {SERVICIOS.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
        </select>
      </div>

      {/* Table — F3.9: migrado a <DataTable> shared */}
      <DataTable<ContratoProveedor>
        data={filtered}
        rowKey="id"
        pageSize={50}
        emptyState={{ icon: '📋', title: 'No hay contratos' }}
        rowStyle={(c) => isVencido(c) ? { background: 'var(--at-warning-tint)' } : {}}
        columns={[
          { key: 'proveedor_nombre', header: 'Proveedor', sortable: true,
            render: (c) => {
              const vencido = isVencido(c)
              return (
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{c.proveedor_nombre}</div>
                  {c.descripcion && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{c.descripcion.slice(0, 50)}{c.descripcion.length > 50 ? '…' : ''}</div>}
                  {vencido && <span style={{ fontSize: 11, background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>Expirado</span>}
                </div>
              )
            } },
          { key: 'servicio', header: 'Servicio', sortable: true,
            accessor: (c) => servicioInfo(c.servicio).label,
            render: (c) => {
              const si = servicioInfo(c.servicio)
              return (
                <div>
                  <span style={{ fontSize: 18 }}>{si.icon}</span>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{si.label}</div>
                </div>
              )
            } },
          { key: 'contacto', header: 'Contacto', hideOnMobile: true,
            accessor: (c) => c.proveedor_contacto ?? '',
            render: (c) => (
              <div>
                {c.proveedor_contacto && <div style={{ color: 'var(--at-ink-2)' }}>{c.proveedor_contacto}</div>}
                {c.proveedor_telefono && <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>📞 {c.proveedor_telefono}</div>}
                {c.proveedor_email && <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>✉️ {c.proveedor_email}</div>}
              </div>
            ) },
          { key: 'monto_mensual', header: 'Monto/mes', align: 'right', sortable: true,
            accessor: (c) => c.monto_mensual ?? 0,
            render: (c) => <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{c.monto_mensual != null ? `${moneda} ${c.monto_mensual.toFixed(2)}` : '—'}</span> },
          { key: 'fecha_inicio', header: 'Vigencia', sortable: true, hideOnMobile: true,
            render: (c) => (
              <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>
                <div>{c.fecha_inicio}</div>
                {c.fecha_fin && <div>→ {c.fecha_fin}</div>}
              </div>
            ) },
          { key: 'estado', header: 'Estado', sortable: true,
            render: (c) => canEdit ? (
              <select value={c.estado} onChange={e => { e.stopPropagation(); handleEstado(c.id, e.target.value as EstadoContrato) }}
                onClick={(e) => e.stopPropagation()}
                style={{ padding: '4px 8px', border: '1.5px solid var(--at-line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: ESTADO_COLORS[c.estado] ?? 'var(--at-ink-3)', background: 'var(--at-surface)', cursor: 'pointer' }}
                aria-label={`Estado de ${c.proveedor_nombre}`}>
                <option value="activo">Activo</option>
                <option value="vencido">Vencido</option>
                <option value="terminado">Terminado</option>
              </select>
            ) : (
              <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--at-chip)', color: ESTADO_COLORS[c.estado] ?? 'var(--at-ink-3)' }}>
                {c.estado}
              </span>
            ) },
          { key: 'actions', header: '', align: 'right',
            render: (c) => (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                {c.documento_url && (
                  <SecureFileLink src={c.documento_url}
                    style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', textDecoration: 'none', color: 'var(--at-ink-2)' }}>📄</SecureFileLink>
                )}
                {canEdit && (
                  <button onClick={(e) => { e.stopPropagation(); startEdit(c) }} aria-label={`Editar ${c.proveedor_nombre}`} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: 'var(--at-ink-2)' }}>✏️</button>
                )}
                {canEdit && (
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }} aria-label={`Eliminar ${c.proveedor_nombre}`} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                )}
              </div>
            ) },
        ] satisfies DataTableColumn<ContratoProveedor>[]}
      />
    </div>
  )
}
