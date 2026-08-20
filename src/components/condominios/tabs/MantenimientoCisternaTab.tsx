import { hoyLocalISO, esFechaCalendarioVencida } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { MantenimientoCisterna, TipoMantenimientoCisterna, EstadoCisterna } from '../../../types'

interface Props {
  registros: MantenimientoCisterna[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoMantenimientoCisterna; label: string; icon: string; color: string }[] = [
  { value: 'lectura',    label: 'Lectura',    icon: '📊', color: 'var(--at-accent-2)' },
  { value: 'limpieza',   label: 'Limpieza',   icon: '🧹', color: 'var(--at-success)' },
  { value: 'cloracion',  label: 'Cloración',  icon: '🧪', color: 'var(--at-accent)' },
  { value: 'inspeccion', label: 'Inspección', icon: '🔍', color: 'var(--at-accent)' },
  { value: 'reparacion', label: 'Reparación', icon: '🔧', color: 'var(--at-warning)' },
]

const ESTADOS: { value: EstadoCisterna; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'normal',        label: 'Normal',        color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  { value: 'bajo_nivel',    label: 'Bajo nivel',    color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '⚠️' },
  { value: 'mantenimiento', label: 'Mantenimiento', color: 'var(--at-accent)', bg: 'var(--at-accent-tint)', icon: '🔧' },
  { value: 'fuera_servicio',label: 'Fuera servicio',color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '🚫' },
]

const CLORO_MIN = 0.2
const CLORO_MAX = 1.0
const PH_MIN = 6.5
const PH_MAX = 8.5

function nivelColor(pct: number | null | undefined): string {
  if (pct == null) return 'var(--at-ink-3)'
  if (pct >= 60) return 'var(--at-success)'
  if (pct >= 30) return 'var(--at-warning)'
  return 'var(--at-danger)'
}

export default function MantenimientoCisternaTab({ registros, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtrocisterna, setFiltroCisterna] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    cisterna: 'Cisterna principal',
    fecha: hoyLocalISO(),
    tipo: 'lectura' as TipoMantenimientoCisterna,
    nivel_agua_pct: '', cloro_residual: '', ph: '',
    estado: 'normal' as EstadoCisterna,
    empresa_servicio: '', tecnico: '',
    costo: '', proxima_revision: '', observaciones: '',
  })

  const cisternas = [...new Set(registros.map(r => r.cisterna))].sort()
  const lista = registros.filter(r => filtrocisterna === '' || r.cisterna === filtrocisterna)

  const ultimo = cisternas.reduce<Record<string, MantenimientoCisterna>>((acc, c) => {
    const rec = registros.filter(r => r.cisterna === c).sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
    if (rec) acc[c] = rec
    return acc
  }, {})

  const proximas = registros.filter(r => r.proxima_revision && !esFechaCalendarioVencida(r.proxima_revision)).sort((a, b) => a.proxima_revision!.localeCompare(b.proxima_revision!)).slice(0, 3)

  async function guardar() {
    if (!form.cisterna.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'El nombre de la cisterna es obligatorio' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('mantenimiento_cisterna', {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, cisterna: form.cisterna.trim(),
      tipo: form.tipo,
      nivel_agua_pct: form.nivel_agua_pct ? parseFloat(form.nivel_agua_pct) : null,
      cloro_residual: form.cloro_residual ? parseFloat(form.cloro_residual) : null,
      ph: form.ph ? parseFloat(form.ph) : null,
      estado: form.estado,
      empresa_servicio: form.empresa_servicio.trim() || null,
      tecnico: form.tecnico.trim() || null,
      costo: form.costo ? parseFloat(form.costo) : null,
      proxima_revision: form.proxima_revision || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(p => ({ ...p, nivel_agua_pct: '', cloro_residual: '', ph: '', costo: '', observaciones: '' }))
    setMostrarForm(false)
    onRefresh()
  }

  async function cambiarEstado(r: MantenimientoCisterna, estado: EstadoCisterna) {
    await updateCondominioRow('mantenimiento_cisterna', r.id, { estado })
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* Estado actual por cisterna */}
      {cisternas.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          {cisternas.map(c => {
            const r = ultimo[c]
            const est = ESTADOS.find(e => e.value === r?.estado)
            return (
              <div key={c} style={{ background: est?.bg ?? 'var(--at-surface-2)', border: `1px solid ${est?.color ?? 'var(--at-line)'}`, borderRadius: 12, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>🏗️ {c}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: est?.color }}>{est?.icon} {est?.label}</span>
                </div>
                {r ? (
                  <div>
                    {r.nivel_agua_pct != null && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Nivel</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: nivelColor(r.nivel_agua_pct) }}>{r.nivel_agua_pct}%</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--at-line)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(r.nivel_agua_pct, 100)}%`, background: nivelColor(r.nivel_agua_pct) }} />
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                      {r.cloro_residual != null && <span style={{ color: r.cloro_residual >= CLORO_MIN && r.cloro_residual <= CLORO_MAX ? 'var(--at-success)' : 'var(--at-danger)' }}>Cl: {r.cloro_residual}</span>}
                      {r.ph != null && <span style={{ color: r.ph >= PH_MIN && r.ph <= PH_MAX ? 'var(--at-success)' : 'var(--at-danger)' }}>pH: {r.ph}</span>}
                      <span style={{ color: 'var(--at-ink-3)' }}>{r.fecha}</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Sin registros</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {proximas.length > 0 && (
        <div style={{ background: 'var(--at-accent-tint)', border: '1px solid var(--at-accent-soft)', borderRadius: 10, padding: '10px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--at-accent)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>🔍 Próximas revisiones</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {proximas.map(r => (
              <span key={r.id} style={{ fontSize: 12, color: 'var(--at-ink-2)' }}>
                {r.cisterna} · <strong style={{ color: 'var(--at-accent)' }}>{r.proxima_revision}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={{ ...inp, width: 'auto' }} value={filtrocisterna} onChange={e => setFiltroCisterna(e.target.value)}>
            <option value="">Todas las cisternas</option>
            {cisternas.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)', alignSelf: 'center' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-accent-2)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nuevo registro'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nuevo registro de cisterna</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Cisterna</label>
              <input style={inp} placeholder="Cisterna principal, Ala B…" value={form.cisterna} onChange={e => setForm(p => ({ ...p, cisterna: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha</label>
              <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Tipo</label>
              <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoMantenimientoCisterna }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Nivel agua (%)</label>
              <input type="number" step="0.1" min="0" max="100" style={{ ...inp, borderColor: form.nivel_agua_pct ? (parseFloat(form.nivel_agua_pct) < 30 ? 'var(--at-danger)' : 'var(--at-line-strong)') : 'var(--at-line-strong)' }} value={form.nivel_agua_pct} onChange={e => setForm(p => ({ ...p, nivel_agua_pct: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Cloro residual <span style={{ color: 'var(--at-ink-3)' }}>({CLORO_MIN}–{CLORO_MAX})</span></label>
              <input type="number" step="0.01" style={inp} value={form.cloro_residual} onChange={e => setForm(p => ({ ...p, cloro_residual: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>pH <span style={{ color: 'var(--at-ink-3)' }}>({PH_MIN}–{PH_MAX})</span></label>
              <input type="number" step="0.01" style={inp} value={form.ph} onChange={e => setForm(p => ({ ...p, ph: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Estado</label>
              <select style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoCisterna }))}>
                {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Empresa servicio</label>
              <input style={inp} value={form.empresa_servicio} onChange={e => setForm(p => ({ ...p, empresa_servicio: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Técnico</label>
              <input style={inp} value={form.tecnico} onChange={e => setForm(p => ({ ...p, tecnico: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Costo ({moneda})</label>
              <input type="number" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Próxima revisión</label>
              <input type="date" style={inp} value={form.proxima_revision} onChange={e => setForm(p => ({ ...p, proxima_revision: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Observaciones</label>
              <input style={inp} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Registrar'}
          </button>
        </div>
      )}

      {/* Historial */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>Sin registros</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {lista.map(r => {
            const tipo = TIPOS.find(t => t.value === r.tipo)
            const est = ESTADOS.find(e => e.value === r.estado)
            return (
              <div key={r.id} style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>🏗️ {r.cisterna}</span>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: tipo?.color + '20', color: tipo?.color }}>{tipo?.icon} {tipo?.label}</span>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: est?.bg, color: est?.color }}>{est?.icon} {est?.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 3 }}>
                    {r.fecha}
                    {r.empresa_servicio && <span> · {r.empresa_servicio}</span>}
                    {r.observaciones && <span> · {r.observaciones}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  {r.nivel_agua_pct != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>Nivel</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: nivelColor(r.nivel_agua_pct) }}>{r.nivel_agua_pct}%</div>
                    </div>
                  )}
                  {r.cloro_residual != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>Cl</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: r.cloro_residual >= CLORO_MIN && r.cloro_residual <= CLORO_MAX ? 'var(--at-success)' : 'var(--at-danger)' }}>{r.cloro_residual}</div>
                    </div>
                  )}
                  {r.ph != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>pH</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: r.ph >= PH_MIN && r.ph <= PH_MAX ? 'var(--at-success)' : 'var(--at-danger)' }}>{r.ph}</div>
                    </div>
                  )}
                  {canEdit && r.estado === 'bajo_nivel' && (
                    <button onClick={() => cambiarEstado(r, 'normal')}
                      style={{ padding: '4px 10px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                      Normalizar
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
