import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { PolizaSeguro, TipoPoliza, EstadoPoliza } from '../../../types'
import Swal from 'sweetalert2'
import { FileUploader } from '../FileUploader'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

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
  vigente:   { label: 'Vigente',   color: '#10b981', bg: '#d1fae5' },
  vencida:   { label: 'Vencida',   color: '#ef4444', bg: '#fee2e2' },
  cancelada: { label: 'Cancelada', color: '#64748b', bg: '#f1f5f9' },
}

const blank = (): Partial<PolizaSeguro> => ({
  numero_poliza: '', aseguradora: '', tipo: 'incendio', descripcion: '',
  suma_asegurada: undefined, prima_anual: undefined,
  fecha_inicio: new Date().toISOString().slice(0, 10),
  fecha_vencimiento: '', estado: 'vigente',
  agente_nombre: '', agente_telefono: '', agente_email: '', documento_url: '', notas: '',
})

export function PolizasTab({ polizas, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [filtroEstado, setFiltroEstado] = useState<EstadoPoliza | 'todos'>('vigente')
  const [form, setForm] = useState<Partial<PolizaSeguro>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const porVencer = polizas.filter(p =>
    p.estado === 'vigente' && p.fecha_vencimiento >= hoy &&
    new Date(p.fecha_vencimiento).getTime() - Date.now() < 60 * 24 * 3600 * 1000
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
    if (!form.numero_poliza?.trim()) return Swal.fire('Campo requerido', 'Ingresa el número de póliza.', 'warning')
    if (!form.aseguradora?.trim()) return Swal.fire('Campo requerido', 'Ingresa la aseguradora.', 'warning')
    if (!form.fecha_vencimiento) return Swal.fire('Campo requerido', 'Ingresa la fecha de vencimiento.', 'warning')
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
      ? await supabase.from('polizas_seguro').update(payload).eq('id', editId)
      : await supabase.from('polizas_seguro').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar póliza?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('polizas_seguro').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoPoliza) {
    const { error } = await supabase.from('polizas_seguro').update({ estado }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Pólizas de Seguro',
      proyectoNombre,
      headers: ['Póliza', 'Aseguradora', 'Tipo', 'Suma Asegurada', 'Prima Anual', 'Inicio', 'Vencimiento', 'Estado'],
      rows: filtered.map(p => {
        const dias = p.fecha_vencimiento ? Math.ceil((new Date(p.fecha_vencimiento).getTime() - Date.now()) / 86400000) : null
        return [p.numero_poliza, p.aseguradora, tipoInfo(p.tipo).label, p.suma_asegurada != null ? `${moneda} ${p.suma_asegurada.toLocaleString()}` : '—', p.prima_anual != null ? `${moneda} ${p.prima_anual.toFixed(2)}` : '—', p.fecha_inicio, p.fecha_vencimiento, `${ESTADO_CONFIG[p.estado].label}${dias !== null && p.estado === 'vigente' ? ` (${dias}d)` : ''}`]
      }),
      rightAlignCols: [3, 4],
      filename: `polizas-${new Date().toISOString().slice(0, 10)}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`polizas-${new Date().toISOString().slice(0, 10)}`, [{
      name: 'Pólizas',
      headers: ['Póliza', 'Aseguradora', 'Tipo', 'Suma Asegurada', 'Prima Anual', 'Inicio', 'Vencimiento', 'Estado', 'Agente', 'Teléfono Agente'],
      rows: polizas.map(p => [p.numero_poliza, p.aseguradora, tipoInfo(p.tipo).label, p.suma_asegurada ?? '', p.prima_anual ?? '', p.fecha_inicio, p.fecha_vencimiento, p.estado, p.agente_nombre ?? '', p.agente_telefono ?? '']),
    }])
  }

  const tipoInfo = (t: TipoPoliza) => TIPOS.find(x => x.value === t) ?? TIPOS[TIPOS.length - 1]

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {porVencer.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>⚠️</span>
          <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 600 }}>
            {porVencer.length} póliza{porVencer.length > 1 ? 's' : ''} vence{porVencer.length === 1 ? '' : 'n'} en los próximos 60 días
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Pólizas de Seguro</h2>
          {primaTotal > 0 && <span style={{ fontSize: '12px', color: '#64748b' }}>Prima anual vigente: <strong style={{ color: '#0ea5e9' }}>{moneda} {primaTotal.toFixed(2)}</strong></span>}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={exportarPDF} disabled={polizas.length === 0} style={{ padding: '7px 12px', background: '#eff6ff', color: '#2563eb', border: '1.5px solid #bfdbfe', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📄 PDF</button>
          <button onClick={exportarXlsx} disabled={polizas.length === 0} style={{ padding: '7px 12px', background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #86efac', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📊 Excel</button>
          {canCreate && !showForm && (
            <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              + Nueva Póliza
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
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
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
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
              borderColor: filtroEstado === e ? '#0ea5e9' : '#e2e8f0',
              background: filtroEstado === e ? '#e0f2fe' : 'white',
              color: filtroEstado === e ? '#0ea5e9' : '#64748b' }}>
            {e === 'todos' ? `Todas (${polizas.length})` : `${ESTADO_CONFIG[e as EstadoPoliza]?.label} (${polizas.filter(p => p.estado === e).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🛡️</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay pólizas registradas</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Póliza', 'Tipo', 'Suma Asegurada', 'Prima Anual', 'Vigencia', 'Estado', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: '12px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const ti = tipoInfo(p.tipo)
                const est = ESTADO_CONFIG[p.estado]
                const diasRestantes = p.fecha_vencimiento
                  ? Math.ceil((new Date(p.fecha_vencimiento).getTime() - Date.now()) / (24 * 3600 * 1000))
                  : null
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{p.numero_poliza}</div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>{p.aseguradora}</div>
                      {p.agente_nombre && <div style={{ fontSize: '11px', color: '#94a3b8' }}>Agente: {p.agente_nombre}</div>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: '18px' }}>{ti.icon}</span>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{ti.label}</div>
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                      {p.suma_asegurada != null ? `${moneda} ${p.suma_asegurada.toLocaleString()}` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                      {p.prima_anual != null ? `${moneda} ${p.prima_anual.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', color: '#64748b' }}>
                      <div>{p.fecha_inicio}</div>
                      <div>→ {p.fecha_vencimiento}</div>
                      {diasRestantes !== null && p.estado === 'vigente' && (
                        <div style={{ color: diasRestantes < 60 ? '#f59e0b' : '#10b981', fontWeight: 600, fontSize: '11px' }}>
                          {diasRestantes > 0 ? `${diasRestantes}d restantes` : 'Vencida'}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {canEdit ? (
                        <select value={p.estado} onChange={e => handleEstado(p.id, e.target.value as EstadoPoliza)}
                          style={{ padding: '4px 8px', border: '1.5px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: est.color, background: 'white', cursor: 'pointer' }}>
                          {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      ) : (
                        <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: est.bg, color: est.color }}>{est.label}</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {p.estado !== 'cancelada' && (
                          <button
                            title="Notificar por WhatsApp"
                            onClick={() => {
                              const dias = p.fecha_vencimiento ? Math.ceil((new Date(p.fecha_vencimiento).getTime() - Date.now()) / 86400000) : null
                              const msg = `🛡️ Póliza ${p.numero_poliza}\nAseguradora: ${p.aseguradora}\nTipo: ${tipoInfo(p.tipo).label}\nVencimiento: ${p.fecha_vencimiento}${dias !== null ? ` (${dias} días)` : ''}\nEstado: ${ESTADO_CONFIG[p.estado].label}${p.prima_anual ? `\nPrima anual: ${moneda} ${p.prima_anual.toFixed(2)}` : ''}`
                              window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                            }}
                            style={{ padding: '4px 8px', background: '#dcfce7', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#16a34a' }}
                          >💬</button>
                        )}
                        {p.documento_url && <a href={p.documento_url} target="_blank" rel="noreferrer" style={{ padding: '4px 8px', background: '#f1f5f9', borderRadius: '6px', fontSize: '12px', textDecoration: 'none', color: '#374151' }}>📄</a>}
                        {canEdit && <button onClick={() => startEdit(p)} style={{ padding: '4px 8px', background: '#f1f5f9', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>}
                        {canEdit && <button onClick={() => handleDelete(p.id)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>}
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
