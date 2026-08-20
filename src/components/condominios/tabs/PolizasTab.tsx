import { hoyLocalISO, diasHastaFechaCalendario } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { PolizaSeguro, TipoPoliza, EstadoPoliza } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { FileUploader } from '../../shared/FileUploader'
import { SecureFileLink } from '../../shared/SecureFileLink'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  polizas: PolizaSeguro[]
  proyectoId: string
  companyId: string
  moneda: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoPoliza; label: string; icon: string }[] = [
  { value: 'incendio',             label: 'Incendio',              icon: '🔥' },
  { value: 'responsabilidad_civil',label: 'Resp. Civil',           icon: '⚖️' },
  { value: 'terremoto',            label: 'Terremoto',             icon: '🌍' },
  { value: 'inundacion',           label: 'Inundación',            icon: '🌊' },
  { value: 'robo',                 label: 'Robo',                  icon: '🔒' },
  { value: 'vida',                 label: 'Vida',                  icon: '❤️' },
  { value: 'otro',                 label: 'Otro',                  icon: '📋' },
]

const ESTADO_CONFIG: Record<EstadoPoliza, { label: string; color: string; bg: string }> = {
  vigente:   { label: 'Vigente',   color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  vencida:   { label: 'Vencida',   color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  cancelada: { label: 'Cancelada', color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
}

const blank = (): Partial<PolizaSeguro> => ({
  numero_poliza: '', aseguradora: '', tipo: 'incendio', descripcion: '',
  suma_asegurada: undefined, prima_anual: undefined,
  fecha_inicio: hoyLocalISO(),
  fecha_vencimiento: '', estado: 'vigente',
  agente_nombre: '', agente_telefono: '', agente_email: '', documento_url: '', notas: '',
})

export function PolizasTab({ polizas, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const hoy = hoyLocalISO()
  const [filtroEstado, setFiltroEstado] = useState<EstadoPoliza | 'todos'>('vigente')
  const [form, setForm] = useState<Partial<PolizaSeguro>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const porVencer = polizas.filter(p =>
    p.estado === 'vigente' && p.fecha_vencimiento >= hoy &&
    (diasHastaFechaCalendario(p.fecha_vencimiento) ?? Infinity) < 60
  )

  const filtered = polizas.filter(p => filtroEstado === 'todos' || p.estado === filtroEstado)
  const primaTotal = polizas.filter(p => p.estado === 'vigente').reduce((s, p) => s + (p.prima_anual ?? 0), 0)

  function startEdit(p: PolizaSeguro) {
    setForm({
      numero_poliza: p.numero_poliza, aseguradora: p.aseguradora, tipo: p.tipo,
      descripcion: p.descripcion ?? '', suma_asegurada: p.suma_asegurada ?? undefined,
      prima_anual: p.prima_anual ?? undefined, fecha_inicio: p.fecha_inicio,
      fecha_vencimiento: p.fecha_vencimiento, estado: p.estado,
      agente_nombre: p.agente_nombre ?? '', agente_telefono: p.agente_telefono ?? '',
      agente_email: p.agente_email ?? '', documento_url: p.documento_url ?? '', notas: p.notas ?? '',
    })
    setEditId(p.id)
    setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.numero_poliza?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el número de póliza.' })
    if (!form.aseguradora?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la aseguradora.' })
    if (!form.fecha_vencimiento) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la fecha de vencimiento.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      numero_poliza: form.numero_poliza!.trim(), aseguradora: form.aseguradora!.trim(),
      tipo: form.tipo ?? 'incendio', descripcion: form.descripcion || null,
      suma_asegurada: form.suma_asegurada ?? null, prima_anual: form.prima_anual ?? null,
      fecha_inicio: form.fecha_inicio!, fecha_vencimiento: form.fecha_vencimiento!,
      estado: form.estado ?? 'vigente',
      agente_nombre: form.agente_nombre || null, agente_telefono: form.agente_telefono || null,
      agente_email: form.agente_email || null, documento_url: form.documento_url || null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await updateCondominioRow('polizas_seguro', editId, payload)
      : await createCondominioRow('polizas_seguro', payload)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar póliza?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('polizas_seguro', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoPoliza) {
    const { error } = await updateCondominioRow('polizas_seguro', id, { estado })
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Pólizas de Seguro',
      proyectoNombre,
      headers: ['Póliza', 'Aseguradora', 'Tipo', 'Suma Asegurada', 'Prima Anual', 'Inicio', 'Vencimiento', 'Estado'],
      rows: filtered.map(p => {
        const dias = diasHastaFechaCalendario(p.fecha_vencimiento)
        return [p.numero_poliza, p.aseguradora, tipoInfo(p.tipo).label, p.suma_asegurada != null ? `${moneda} ${p.suma_asegurada.toLocaleString()}` : '—', p.prima_anual != null ? `${moneda} ${p.prima_anual.toFixed(2)}` : '—', p.fecha_inicio, p.fecha_vencimiento, `${ESTADO_CONFIG[p.estado].label}${dias !== null && p.estado === 'vigente' ? ` (${dias}d)` : ''}`]
      }),
      rightAlignCols: [3, 4],
      filename: `polizas-${hoyLocalISO()}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`polizas-${hoyLocalISO()}`, [{
      name: 'Pólizas',
      headers: ['Póliza', 'Aseguradora', 'Tipo', 'Suma Asegurada', 'Prima Anual', 'Inicio', 'Vencimiento', 'Estado', 'Agente', 'Teléfono Agente'],
      rows: polizas.map(p => [p.numero_poliza, p.aseguradora, tipoInfo(p.tipo).label, p.suma_asegurada ?? '', p.prima_anual ?? '', p.fecha_inicio, p.fecha_vencimiento, p.estado, p.agente_nombre ?? '', p.agente_telefono ?? '']),
    }])
  }

  const tipoInfo = (t: TipoPoliza) => TIPOS.find(x => x.value === t) ?? TIPOS[TIPOS.length - 1]

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {porVencer.length > 0 && (
        <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning)', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>⚠️</span>
          <span style={{ fontSize: '13px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>
            {porVencer.length} póliza{porVencer.length > 1 ? 's' : ''} vence{porVencer.length === 1 ? '' : 'n'} en los próximos 60 días
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Pólizas de Seguro</h2>
          {primaTotal > 0 && <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>Prima anual vigente: <strong style={{ color: 'var(--at-primary)' }}>{moneda} {primaTotal.toFixed(2)}</strong></span>}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={exportarPDF} disabled={polizas.length === 0} style={{ padding: '7px 12px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📄 PDF</button>
          <button onClick={exportarXlsx} disabled={polizas.length === 0} style={{ padding: '7px 12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1.5px solid var(--at-success-border)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📊 Excel</button>
          {canCreate && !showForm && (
            <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              + Nueva Póliza
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Póliza' : 'Nueva Póliza'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>No. de Póliza *</label>
              <input style={inputStyle} value={form.numero_poliza ?? ''} onChange={e => setForm(f => ({ ...f, numero_poliza: e.target.value }))} placeholder="POL-0001" />
            </div>
            <div>
              <label style={labelStyle}>Aseguradora *</label>
              <input style={inputStyle} value={form.aseguradora ?? ''} onChange={e => setForm(f => ({ ...f, aseguradora: e.target.value }))} placeholder="Nombre de la aseguradora" />
            </div>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={inputStyle} value={form.tipo ?? 'incendio'} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoPoliza }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'vigente'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoPoliza }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Suma asegurada ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.suma_asegurada ?? ''} onChange={e => setForm(f => ({ ...f, suma_asegurada: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Prima anual ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.prima_anual ?? ''} onChange={e => setForm(f => ({ ...f, prima_anual: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Fecha inicio</label>
              <input style={inputStyle} type="date" value={form.fecha_inicio ?? ''} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Fecha vencimiento *</label>
              <input style={inputStyle} type="date" value={form.fecha_vencimiento ?? ''} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Agente</label>
              <input style={inputStyle} value={form.agente_nombre ?? ''} onChange={e => setForm(f => ({ ...f, agente_nombre: e.target.value }))} placeholder="Nombre del agente" />
            </div>
            <div>
              <label style={labelStyle}>Tel. Agente</label>
              <input style={inputStyle} value={form.agente_telefono ?? ''} onChange={e => setForm(f => ({ ...f, agente_telefono: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Email Agente</label>
              <input style={inputStyle} type="email" value={form.agente_email ?? ''} onChange={e => setForm(f => ({ ...f, agente_email: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <FileUploader
                value={form.documento_url ?? null}
                onChange={url => setForm(f => ({ ...f, documento_url: url ?? '' }))}
                folder="polizas"
                label="Documento de póliza (PDF)"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción / Notas</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '56px' }} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Crear Póliza'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'vigente', 'vencida', 'cancelada'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === e ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'todos' ? `Todas (${polizas.length})` : `${ESTADO_CONFIG[e as EstadoPoliza]?.label} (${polizas.filter(p => p.estado === e).length})`}
          </button>
        ))}
      </div>

      {/* Tabla — F3.9: migrado a <DataTable> shared */}
      <DataTable<PolizaSeguro>
        data={filtered}
        rowKey="id"
        pageSize={50}
        emptyState={{ icon: '🛡️', title: 'No hay pólizas registradas' }}
        columns={[
          { key: 'numero_poliza', header: 'Póliza', sortable: true,
            render: (p) => (
              <div>
                <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{p.numero_poliza}</div>
                <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{p.aseguradora}</div>
                {p.agente_nombre && <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Agente: {p.agente_nombre}</div>}
              </div>
            ) },
          { key: 'tipo', header: 'Tipo', sortable: true, hideOnMobile: true,
            accessor: (p) => tipoInfo(p.tipo).label,
            render: (p) => {
              const ti = tipoInfo(p.tipo)
              return (
                <div>
                  <span style={{ fontSize: 18 }}>{ti.icon}</span>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{ti.label}</div>
                </div>
              )
            } },
          { key: 'suma_asegurada', header: 'Suma Asegurada', align: 'right', sortable: true, hideOnMobile: true,
            accessor: (p) => p.suma_asegurada ?? 0,
            render: (p) => <span style={{ fontWeight: 600 }}>{p.suma_asegurada != null ? `${moneda} ${p.suma_asegurada.toLocaleString()}` : '—'}</span> },
          { key: 'prima_anual', header: 'Prima Anual', align: 'right', sortable: true,
            accessor: (p) => p.prima_anual ?? 0,
            render: (p) => <span style={{ fontWeight: 600 }}>{p.prima_anual != null ? `${moneda} ${p.prima_anual.toFixed(2)}` : '—'}</span> },
          { key: 'fecha_vencimiento', header: 'Vigencia', sortable: true,
            render: (p) => {
              const diasRestantes = diasHastaFechaCalendario(p.fecha_vencimiento)
              return (
                <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>
                  <div>{p.fecha_inicio}</div>
                  <div>→ {p.fecha_vencimiento}</div>
                  {diasRestantes !== null && p.estado === 'vigente' && (
                    <div style={{ color: diasRestantes < 60 ? 'var(--at-warning)' : 'var(--at-success)', fontWeight: 600, fontSize: 11 }}>
                      {diasRestantes > 0 ? `${diasRestantes}d restantes` : 'Vencida'}
                    </div>
                  )}
                </div>
              )
            } },
          { key: 'estado', header: 'Estado', sortable: true,
            render: (p) => {
              const est = ESTADO_CONFIG[p.estado]
              return canEdit ? (
                <select value={p.estado} onChange={(e) => { e.stopPropagation(); handleEstado(p.id, e.target.value as EstadoPoliza) }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ padding: '4px 8px', border: '1.5px solid var(--at-line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: est.color, background: 'var(--at-surface)', cursor: 'pointer' }}
                  aria-label={`Estado de ${p.numero_poliza}`}>
                  {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              ) : (
                <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: est.bg, color: est.color }}>{est.label}</span>
              )
            } },
          { key: 'actions', header: '', align: 'right',
            render: (p) => (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {p.estado !== 'cancelada' && (
                  <button title="Notificar por WhatsApp" aria-label="Notificar por WhatsApp"
                    onClick={(e) => {
                      e.stopPropagation()
                      const dias = diasHastaFechaCalendario(p.fecha_vencimiento)
                      const msg = `🛡️ Póliza ${p.numero_poliza}\nAseguradora: ${p.aseguradora}\nTipo: ${tipoInfo(p.tipo).label}\nVencimiento: ${p.fecha_vencimiento}${dias !== null ? ` (${dias} días)` : ''}\nEstado: ${ESTADO_CONFIG[p.estado].label}${p.prima_anual ? `\nPrima anual: ${moneda} ${p.prima_anual.toFixed(2)}` : ''}`
                      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                    }}
                    style={{ padding: '4px 8px', background: 'var(--at-success-tint)', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: 'var(--at-success)' }}>💬</button>
                )}
                {p.documento_url && <SecureFileLink src={p.documento_url} style={{ padding: '4px 8px', background: 'var(--at-chip)', borderRadius: 6, fontSize: 12, textDecoration: 'none', color: 'var(--at-ink-2)' }}>📄</SecureFileLink>}
                {canEdit && <button onClick={(e) => { e.stopPropagation(); startEdit(p) }} aria-label={`Editar ${p.numero_poliza}`} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>✏️</button>}
                {canEdit && <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }} aria-label={`Eliminar ${p.numero_poliza}`} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>}
              </div>
            ) },
        ] satisfies DataTableColumn<PolizaSeguro>[]}
      />
    </div>
  )
}
