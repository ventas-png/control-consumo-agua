import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { TarifaCondominio } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  tarifas: TarifaCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_UNIDAD_LABEL: Record<string, string> = {
  todas: 'Todas', residencial: 'Residencial', comercial: 'Comercial', bodega: 'Bodega', parqueo: 'Parqueo',
}

const PERIODICIDAD_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  mensual:     { label: 'Mensual',     bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  trimestral:  { label: 'Trimestral', bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)' },
  semestral:   { label: 'Semestral',  bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  anual:       { label: 'Anual',      bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  unica_vez:   { label: 'Única vez',  bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

const BLANK = {
  concepto: '', descripcion: '', monto: '', tipo_unidad: 'todas',
  periodicidad: 'mensual', activo: 'true', vigente_desde: '', vigente_hasta: '', notas: '',
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)',
  borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box',
}

function fmt(n: number, m: string) {
  return `${m} ${n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function TarifasTab({ tarifas, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ ...BLANK })
  const [filterTipoU, setFilterTipoU] = useState('')
  const [filterPer, setFilterPer] = useState('')
  const [filterActivo, setFilterActivo] = useState<'activas' | 'inactivas' | ''>('')
  const [saving, setSaving] = useState(false)

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const openNew = () => { setForm({ ...BLANK }); setEditId(null); setShowForm(true) }
  const openEdit = (t: TarifaCondominio) => {
    setForm({
      concepto: t.concepto, descripcion: t.descripcion ?? '',
      monto: String(t.monto), tipo_unidad: t.tipo_unidad,
      periodicidad: t.periodicidad, activo: String(t.activo),
      vigente_desde: t.vigente_desde ?? '', vigente_hasta: t.vigente_hasta ?? '',
      notas: t.notas ?? '',
    })
    setEditId(t.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.concepto.trim() || !form.monto) return notify({ variant: 'warning', title: 'Campos requeridos', text: 'Concepto y monto son obligatorios.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      concepto: form.concepto.trim(), descripcion: form.descripcion || null,
      monto: parseFloat(form.monto), tipo_unidad: form.tipo_unidad,
      periodicidad: form.periodicidad, activo: form.activo === 'true',
      vigente_desde: form.vigente_desde || null, vigente_hasta: form.vigente_hasta || null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await updateCondominioRow('tarifas_condominio', editId, payload)
      : await createCondominioRow('tarifas_condominio', payload)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); onRefresh()
  }

  const toggleActivo = async (t: TarifaCondominio) => {
    await updateCondominioRow('tarifas_condominio', t.id, { activo: !t.activo })
    onRefresh()
  }

  const handleDelete = async (t: TarifaCondominio) => {
    const r = await confirm({ title: '¿Eliminar tarifa?', text: t.concepto, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('tarifas_condominio', t.id)
    onRefresh()
  }

  const filtered = tarifas.filter(t =>
    (!filterTipoU || t.tipo_unidad === filterTipoU) &&
    (!filterPer || t.periodicidad === filterPer) &&
    (filterActivo === '' || (filterActivo === 'activas' ? t.activo : !t.activo))
  )

  const activasCount = tarifas.filter(t => t.activo).length
  const totalMensual = tarifas.filter(t => t.activo && t.periodicidad === 'mensual').reduce((a, t) => a + t.monto, 0)
  const totalAnual = tarifas.filter(t => t.activo && t.periodicidad === 'anual').reduce((a, t) => a + t.monto, 0)

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px', marginBottom: '20px' }}>
        {[
          { label: 'Tarifas Activas', value: String(activasCount), icon: '✅', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
          { label: 'Total Mensual', value: fmt(totalMensual, moneda), icon: '📅', bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
          { label: 'Total Anual', value: fmt(totalAnual, moneda), icon: '📆', bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {canCreate && (
          <button onClick={openNew} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            + Nueva tarifa
          </button>
        )}
        <select value={filterTipoU} onChange={e => setFilterTipoU(e.target.value)} style={{ ...inputStyle, width: '150px' }}>
          <option value="">Todas las unidades</option>
          {Object.entries(TIPO_UNIDAD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterPer} onChange={e => setFilterPer(e.target.value)} style={{ ...inputStyle, width: '150px' }}>
          <option value="">Todas periodicidades</option>
          {Object.entries(PERIODICIDAD_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterActivo} onChange={e => setFilterActivo(e.target.value as '' | 'activas' | 'inactivas')} style={{ ...inputStyle, width: '130px' }}>
          <option value="">Todas</option>
          <option value="activas">Activas</option>
          <option value="inactivas">Inactivas</option>
        </select>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar tarifa' : 'Nueva tarifa'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Concepto *</label>
              <input style={inputStyle} value={form.concepto} onChange={e => setF('concepto', e.target.value)} placeholder="Ej. Cuota mantenimiento general" autoFocus />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Descripción</label>
              <input style={inputStyle} value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder="Detalle de qué incluye esta tarifa" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Monto ({moneda}) *</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto} onChange={e => setF('monto', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Aplica a</label>
              <select style={inputStyle} value={form.tipo_unidad} onChange={e => setF('tipo_unidad', e.target.value)}>
                {Object.entries(TIPO_UNIDAD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Periodicidad</label>
              <select style={inputStyle} value={form.periodicidad} onChange={e => setF('periodicidad', e.target.value)}>
                {Object.entries(PERIODICIDAD_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.activo} onChange={e => setF('activo', e.target.value)}>
                <option value="true">Activa</option>
                <option value="false">Inactiva</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Vigente desde</label>
              <input style={inputStyle} type="date" value={form.vigente_desde} onChange={e => setF('vigente_desde', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Vigente hasta</label>
              <input style={inputStyle} type="date" value={form.vigente_hasta} onChange={e => setF('vigente_hasta', e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Observaciones adicionales" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Cards */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>💰</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Sin tarifas registradas</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {filtered.map(t => {
            const per = PERIODICIDAD_LABEL[t.periodicidad]
            const hoy = new Date().toISOString().slice(0, 10)
            const vencida = t.vigente_hasta && t.vigente_hasta < hoy && t.activo
            return (
              <div key={t.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${t.activo ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: '12px', padding: '16px', opacity: t.activo ? 1 : 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{t.concepto}</div>
                    {t.descripcion && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{t.descripcion}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginLeft: '8px' }}>
                    {canEdit && <button onClick={() => openEdit(t)} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✏️</button>}
                    <button onClick={() => handleDelete(t)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-danger)' }}>🗑</button>
                  </div>
                </div>

                <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--at-primary)', marginBottom: '10px' }}>
                  {fmt(t.monto, moneda)}
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: per.bg, color: per.color }}>{per.label}</span>
                  <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 600, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>{TIPO_UNIDAD_LABEL[t.tipo_unidad]}</span>
                  {vencida && <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: 'var(--at-danger-tint)', color: 'var(--at-danger)' }}>Vencida</span>}
                </div>

                {(t.vigente_desde || t.vigente_hasta) && (
                  <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '10px' }}>
                    Vigencia: {t.vigente_desde ?? '—'} → {t.vigente_hasta ?? 'sin límite'}
                  </div>
                )}

                {canEdit && (
                  <button onClick={() => toggleActivo(t)} style={{ width: '100%', padding: '6px', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, background: t.activo ? 'var(--at-danger-tint)' : 'var(--at-success-tint)', color: t.activo ? 'var(--at-danger)' : 'var(--at-success)' }}>
                    {t.activo ? '⏸ Desactivar' : '▶ Activar'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
