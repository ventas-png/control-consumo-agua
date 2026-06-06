import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { InspeccionNormativa, TipoInspeccion, ResultadoInspeccion } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { FileUploader } from '../../shared/FileUploader'
import { SecureFileLink } from '../../shared/SecureFileLink'

interface Props {
  inspecciones: InspeccionNormativa[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoInspeccion; label: string; icon: string }[] = [
  { value: 'bomberos',     label: 'Bomberos',     icon: '🚒' },
  { value: 'igss',         label: 'IGSS',         icon: '🏥' },
  { value: 'municipalidad',label: 'Municipalidad',icon: '🏛️' },
  { value: 'electrica',    label: 'Eléctrica',    icon: '⚡' },
  { value: 'sanitaria',    label: 'Sanitaria',    icon: '🧪' },
  { value: 'elevadores',   label: 'Elevadores',   icon: '🛗' },
  { value: 'otro',         label: 'Otro',         icon: '📋' },
]

const RESULTADO_CONFIG: Record<ResultadoInspeccion, { label: string; color: string; bg: string }> = {
  aprobado:                      { label: 'Aprobado',          color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  aprobado_con_observaciones:    { label: 'Con Observaciones', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  reprobado:                     { label: 'Reprobado',         color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  pendiente:                     { label: 'Pendiente',         color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
}

const blank = (): Partial<InspeccionNormativa> => ({
  tipo: 'bomberos', entidad_inspectora: '', fecha: new Date().toISOString().slice(0, 10),
  resultado: 'aprobado', hallazgos: '', acciones_correctivas: '',
  fecha_proxima: '', inspector_nombre: '', certificado_url: '', notas: '',
})

export function InspeccionesTab({ inspecciones, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [filtroTipo, setFiltroTipo] = useState<TipoInspeccion | 'todos'>('todos')
  const [filtroResultado, setFiltroResultado] = useState<ResultadoInspeccion | 'todos'>('todos')
  const [form, setForm] = useState<Partial<InspeccionNormativa>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const proximasVencer = inspecciones.filter(i =>
    i.fecha_proxima && i.fecha_proxima >= hoy &&
    new Date(i.fecha_proxima).getTime() - Date.now() < 30 * 24 * 3600 * 1000
  )
  const reprobadas = inspecciones.filter(i => i.resultado === 'reprobado')

  const filtered = inspecciones.filter(i => {
    if (filtroTipo !== 'todos' && i.tipo !== filtroTipo) return false
    if (filtroResultado !== 'todos' && i.resultado !== filtroResultado) return false
    return true
  }).sort((a, b) => b.fecha.localeCompare(a.fecha))

  function startEdit(i: InspeccionNormativa) {
    setForm({
      tipo: i.tipo, entidad_inspectora: i.entidad_inspectora ?? '',
      fecha: i.fecha, resultado: i.resultado, hallazgos: i.hallazgos ?? '',
      acciones_correctivas: i.acciones_correctivas ?? '', fecha_proxima: i.fecha_proxima ?? '',
      inspector_nombre: i.inspector_nombre ?? '', certificado_url: i.certificado_url ?? '', notas: i.notas ?? '',
    })
    setEditId(i.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.fecha) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la fecha de inspección.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      tipo: form.tipo ?? 'bomberos', entidad_inspectora: form.entidad_inspectora || null,
      fecha: form.fecha!, resultado: form.resultado ?? 'aprobado',
      hallazgos: form.hallazgos || null, acciones_correctivas: form.acciones_correctivas || null,
      fecha_proxima: form.fecha_proxima || null, inspector_nombre: form.inspector_nombre || null,
      certificado_url: form.certificado_url || null, notas: form.notas || null,
    }
    const { error } = editId
      ? await updateCondominioRow('inspecciones_normativas', editId, payload)
      : await createCondominioRow('inspecciones_normativas', payload)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar inspección?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('inspecciones_normativas', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  const tipoInfo = (t: TipoInspeccion) => TIPOS.find(x => x.value === t) ?? TIPOS[TIPOS.length - 1]

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {reprobadas.length > 0 && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger)', borderRadius: '10px', padding: '10px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🚨</span>
          <span style={{ fontSize: '13px', color: 'var(--at-danger-strong)', fontWeight: 600 }}>
            {reprobadas.length} inspección{reprobadas.length > 1 ? 'es' : ''} reprobada{reprobadas.length > 1 ? 's' : ''} requieren atención
          </span>
        </div>
      )}
      {proximasVencer.length > 0 && (
        <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning)', borderRadius: '10px', padding: '10px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>📅</span>
          <span style={{ fontSize: '13px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>
            {proximasVencer.length} inspección{proximasVencer.length > 1 ? 'es' : ''} programada{proximasVencer.length > 1 ? 's' : ''} en los próximos 30 días
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Inspecciones Normativas</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar Inspección
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Inspección' : 'Nueva Inspección'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={inputStyle} value={form.tipo ?? 'bomberos'} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoInspeccion }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Entidad Inspectora</label>
              <input style={inputStyle} value={form.entidad_inspectora ?? ''} onChange={e => setForm(f => ({ ...f, entidad_inspectora: e.target.value }))} placeholder="Nombre de la entidad" />
            </div>
            <div>
              <label style={labelStyle}>Fecha *</label>
              <input style={inputStyle} type="date" value={form.fecha ?? ''} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Resultado</label>
              <select style={inputStyle} value={form.resultado ?? 'aprobado'} onChange={e => setForm(f => ({ ...f, resultado: e.target.value as ResultadoInspeccion }))}>
                {Object.entries(RESULTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Inspector</label>
              <input style={inputStyle} value={form.inspector_nombre ?? ''} onChange={e => setForm(f => ({ ...f, inspector_nombre: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Próxima inspección</label>
              <input style={inputStyle} type="date" value={form.fecha_proxima ?? ''} onChange={e => setForm(f => ({ ...f, fecha_proxima: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <FileUploader
                value={form.certificado_url ?? null}
                onChange={url => setForm(f => ({ ...f, certificado_url: url ?? '' }))}
                folder="inspecciones"
                label="Certificado de inspección (PDF)"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Hallazgos</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '56px' }} value={form.hallazgos ?? ''} onChange={e => setForm(f => ({ ...f, hallazgos: e.target.value }))} placeholder="Observaciones encontradas…" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Acciones Correctivas</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '56px' }} value={form.acciones_correctivas ?? ''} onChange={e => setForm(f => ({ ...f, acciones_correctivas: e.target.value }))} placeholder="Medidas a tomar…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Registrar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoInspeccion | 'todos')}
          style={{ padding: '6px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '12px', background: 'var(--at-surface-2)' }}>
          <option value="todos">Todos los tipos</option>
          {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
        </select>
        <select value={filtroResultado} onChange={e => setFiltroResultado(e.target.value as ResultadoInspeccion | 'todos')}
          style={{ padding: '6px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '12px', background: 'var(--at-surface-2)' }}>
          <option value="todos">Todos los resultados</option>
          {Object.entries(RESULTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{filtered.length} registros</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏛️</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay inspecciones registradas</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(ins => {
            const ti = tipoInfo(ins.tipo)
            const res = RESULTADO_CONFIG[ins.resultado]
            const proximaAlerta = ins.fecha_proxima && ins.fecha_proxima >= hoy &&
              new Date(ins.fecha_proxima).getTime() - Date.now() < 30 * 24 * 3600 * 1000
            return (
              <div key={ins.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${ins.resultado === 'reprobado' ? 'var(--at-danger-border)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '24px' }}>{ti.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{ti.label}</div>
                      {ins.entidad_inspectora && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{ins.entidad_inspectora}</div>}
                      <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                        {ins.fecha}
                        {ins.inspector_nombre && ` · ${ins.inspector_nombre}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ padding: '4px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, background: res.bg, color: res.color }}>
                      {res.label}
                    </span>
                    {ins.certificado_url && (
                      <SecureFileLink src={ins.certificado_url} style={{ padding: '4px 8px', background: 'var(--at-chip)', borderRadius: '6px', fontSize: '12px', textDecoration: 'none', color: 'var(--at-ink-2)' }}>📄</SecureFileLink>
                    )}
                    {canEdit && <button onClick={() => startEdit(ins)} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>}
                    {canEdit && <button onClick={() => handleDelete(ins.id)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>}
                  </div>
                </div>
                {ins.hallazgos && (
                  <div style={{ marginTop: '10px', padding: '8px 12px', background: 'var(--at-surface-2)', borderRadius: '8px', fontSize: '12px', color: 'var(--at-ink-3)' }}>
                    <strong>Hallazgos:</strong> {ins.hallazgos}
                  </div>
                )}
                {ins.acciones_correctivas && (
                  <div style={{ marginTop: '6px', padding: '8px 12px', background: 'var(--at-success-tint)', borderRadius: '8px', fontSize: '12px', color: 'var(--at-success-strong)' }}>
                    <strong>Acciones:</strong> {ins.acciones_correctivas}
                  </div>
                )}
                {ins.fecha_proxima && (
                  <div style={{ marginTop: '6px', fontSize: '12px', color: proximaAlerta ? 'var(--at-warning-strong)' : 'var(--at-ink-3)', fontWeight: proximaAlerta ? 600 : 400 }}>
                    {proximaAlerta ? '⚠️' : '📅'} Próxima inspección: {ins.fecha_proxima}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
