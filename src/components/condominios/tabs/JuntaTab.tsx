import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { MiembroJunta, CargoJunta, Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  junta: MiembroJunta[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CARGO_ORDER: CargoJunta[] = ['presidente','vicepresidente','tesorero','secretario','fiscal','vocal','otro']

const CARGO_LABELS: Record<CargoJunta, { label: string; icon: string; color: string }> = {
  presidente:     { label: 'Presidente',      icon: '👑', color: 'var(--at-accent)' },
  vicepresidente: { label: 'Vicepresidente',  icon: '🌟', color: 'var(--at-primary)' },
  tesorero:       { label: 'Tesorero',        icon: '💰', color: 'var(--at-success)' },
  secretario:     { label: 'Secretario',      icon: '📝', color: 'var(--at-warning)' },
  fiscal:         { label: 'Fiscal',          icon: '🔍', color: 'var(--at-danger)' },
  vocal:          { label: 'Vocal',           icon: '🗣️', color: 'var(--at-ink-3)' },
  otro:           { label: 'Otro',            icon: '👤', color: 'var(--at-ink-3)' },
}

const BLANK = {
  cargo: 'vocal' as CargoJunta, nombre: '', unidad_id: '',
  telefono: '', email: '', periodo_inicio: new Date().toISOString().slice(0,10),
  periodo_fin: '', notas: '', activo: true,
}

export function JuntaTab({ junta, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [showHistorico, setShowHistorico] = useState(false)

  const activos    = junta.filter(m => m.activo)
  const historicos = junta.filter(m => !m.activo)

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  function startEdit(m: MiembroJunta) {
    setEditId(m.id)
    setForm({
      cargo: m.cargo, nombre: m.nombre, unidad_id: m.unidad_id ?? '',
      telefono: m.telefono ?? '', email: m.email ?? '',
      periodo_inicio: m.periodo_inicio, periodo_fin: m.periodo_fin ?? '',
      notas: m.notas ?? '', activo: m.activo,
    })
    setShowForm(true)
  }

  function startNew() {
    setEditId(null); setForm({ ...BLANK }); setShowForm(true)
  }

  async function handleSave() {
    if (!form.nombre.trim() || !form.periodo_inicio) return notify({ variant: 'warning', title: 'Campos requeridos', text: 'Nombre y fecha de inicio son obligatorios.' })
    setSaving(true)
    const payload = {
      cargo: form.cargo, nombre: form.nombre.trim(),
      unidad_id: form.unidad_id || null, telefono: form.telefono || null,
      email: form.email || null, periodo_inicio: form.periodo_inicio,
      periodo_fin: form.periodo_fin || null, notas: form.notas || null, activo: form.activo,
    }
    let error
    if (editId) {
      ({ error } = await updateCondominioRow('junta_directiva', editId, payload))
    } else {
      ({ error } = await createCondominioRow('junta_directiva', { ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setEditId(null); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar miembro?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('junta_directiva', id)
    onRefresh()
  }

  async function toggleActivo(m: MiembroJunta) {
    await updateCondominioRow('junta_directiva', m.id, { activo: !m.activo, periodo_fin: m.activo ? new Date().toISOString().slice(0,10) : null })
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  const sortedActivos = [...activos].sort((a, b) => CARGO_ORDER.indexOf(a.cargo) - CARGO_ORDER.indexOf(b.cargo))

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Junta Directiva</h2>
        {canCreate && (
          <button onClick={startNew}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Agregar Miembro
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar miembro' : 'Nuevo miembro'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Cargo *</label>
              <select style={inputStyle} value={form.cargo} onChange={e => setF('cargo', e.target.value as CargoJunta)}>
                {CARGO_ORDER.map(c => <option key={c} value={c}>{CARGO_LABELS[c].label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Nombre *</label>
              <input style={inputStyle} value={form.nombre} onChange={e => setF('nombre', e.target.value)} placeholder="Nombre completo" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Sin unidad —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Teléfono</label>
              <input style={inputStyle} value={form.telefono} onChange={e => setF('telefono', e.target.value)} placeholder="+502 0000-0000" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Email</label>
              <input style={inputStyle} type="email" value={form.email} onChange={e => setF('email', e.target.value)} placeholder="correo@ejemplo.com" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Inicio período *</label>
              <input style={inputStyle} type="date" value={form.periodo_inicio} onChange={e => setF('periodo_inicio', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fin período</label>
              <input style={inputStyle} type="date" value={form.periodo_fin} onChange={e => setF('periodo_fin', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.activo ? 'activo' : 'inactivo'} onChange={e => setF('activo', e.target.value === 'activo')}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo / Histórico</option>
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Observaciones opcionales" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Active members */}
      {sortedActivos.length === 0 ? (
        <EmptyState icon="📋" title="No hay miembros activos registrados" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {sortedActivos.map(m => {
            const cl = CARGO_LABELS[m.cargo]
            return (
              <div key={m.id} style={{ background: 'var(--at-surface)', border: `2px solid ${cl.color}30`, borderTop: `4px solid ${cl.color}`, borderRadius: '10px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '20px', marginBottom: '4px' }}>{cl.icon}</div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: cl.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cl.label}</div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button onClick={() => startEdit(m)} style={{ padding: '3px 7px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(m.id)} style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                    </div>
                  )}
                </div>
                <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--at-ink)' }}>{m.nombre}</div>
                {m.unidad_nombre && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>🏠 {m.unidad_nombre}</div>}
                {m.telefono && <a href={`tel:${m.telefono}`} style={{ fontSize: '12px', color: 'var(--at-primary)', display: 'block', textDecoration: 'none', marginTop: '4px' }}>📞 {m.telefono}</a>}
                {m.email && <a href={`mailto:${m.email}`} style={{ fontSize: '11px', color: 'var(--at-ink-3)', display: 'block', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis' }}>✉️ {m.email}</a>}
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '6px' }}>Desde {m.periodo_inicio}{m.periodo_fin ? ` hasta ${m.periodo_fin}` : ''}</div>
                {canEdit && (
                  <button onClick={() => toggleActivo(m)} style={{ marginTop: '8px', padding: '3px 10px', background: 'var(--at-chip)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
                    → Marcar inactivo
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Historical */}
      {historicos.length > 0 && (
        <div>
          <button onClick={() => setShowHistorico(v => !v)}
            style={{ fontSize: '12px', color: 'var(--at-ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontWeight: 600 }}>
            {showHistorico ? '▾' : '▸'} Miembros anteriores ({historicos.length})
          </button>
          {showHistorico && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {historicos.map(m => (
                <div key={m.id} style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '8px', padding: '10px 12px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <span style={{ fontSize: '16px' }}>{CARGO_LABELS[m.cargo].icon}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--at-ink-3)' }}>{m.nombre}</span>
                    <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginLeft: '8px' }}>{CARGO_LABELS[m.cargo].label} — {m.periodo_inicio}{m.periodo_fin ? ` a ${m.periodo_fin}` : ''}</span>
                  </div>
                  {canEdit && (
                    <button onClick={() => handleDelete(m.id)} style={{ padding: '2px 6px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
