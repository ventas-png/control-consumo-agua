import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
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
  { value: 'lectura',    label: 'Lectura',    icon: '📊', color: '#577B69' },
  { value: 'limpieza',   label: 'Limpieza',   icon: '🧹', color: '#10b981' },
  { value: 'cloracion',  label: 'Cloración',  icon: '🧪', color: '#B96A3F' },
  { value: 'inspeccion', label: 'Inspección', icon: '🔍', color: '#B96A3F' },
  { value: 'reparacion', label: 'Reparación', icon: '🔧', color: '#f59e0b' },
]

const ESTADOS: { value: EstadoCisterna; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'normal',        label: 'Normal',        color: '#10b981', bg: '#d1fae5', icon: '✅' },
  { value: 'bajo_nivel',    label: 'Bajo nivel',    color: '#f59e0b', bg: '#fef3c7', icon: '⚠️' },
  { value: 'mantenimiento', label: 'Mantenimiento', color: '#B96A3F', bg: '#F4EBE3', icon: '🔧' },
  { value: 'fuera_servicio',label: 'Fuera servicio',color: '#ef4444', bg: '#fef2f2', icon: '🚫' },
]

const CLORO_MIN = 0.2
const CLORO_MAX = 1.0
const PH_MIN = 6.5
const PH_MAX = 8.5

function nivelColor(pct: number | null | undefined): string {
  if (pct == null) return '#7E9389'
  if (pct >= 60) return '#10b981'
  if (pct >= 30) return '#f59e0b'
  return '#ef4444'
}

export default function MantenimientoCisternaTab({ registros, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtrocisterna, setFiltroCisterna] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    cisterna: 'Cisterna principal',
    fecha: new Date().toISOString().split('T')[0],
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

  const proximas = registros.filter(r => r.proxima_revision && new Date(r.proxima_revision) >= new Date()).sort((a, b) => a.proxima_revision!.localeCompare(b.proxima_revision!)).slice(0, 3)

  async function guardar() {
    if (!form.cisterna.trim()) {
      Swal.fire('Faltan datos', 'El nombre de la cisterna es obligatorio', 'warning'); return
    }
    setSaving(true)
    const { error } = await supabase.from('mantenimiento_cisterna').insert({
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
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm(p => ({ ...p, nivel_agua_pct: '', cloro_residual: '', ph: '', costo: '', observaciones: '' }))
    setMostrarForm(false)
    onRefresh()
  }

  async function cambiarEstado(r: MantenimientoCisterna, estado: EstadoCisterna) {
    await supabase.from('mantenimiento_cisterna').update({ estado }).eq('id', r.id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid #C7C2B0', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#7E9389', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* Estado actual por cisterna */}
      {cisternas.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          {cisternas.map(c => {
            const r = ultimo[c]
            const est = ESTADOS.find(e => e.value === r?.estado)
            return (
              <div key={c} style={{ background: est?.bg ?? '#FAF7EF', border: `1px solid ${est?.color ?? '#E1DDD0'}`, borderRadius: 12, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>🏗️ {c}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: est?.color }}>{est?.icon} {est?.label}</span>
                </div>
                {r ? (
                  <div>
                    {r.nivel_agua_pct != null && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: '#7E9389' }}>Nivel</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: nivelColor(r.nivel_agua_pct) }}>{r.nivel_agua_pct}%</span>
                        </div>
                        <div style={{ height: 6, background: '#E1DDD0', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(r.nivel_agua_pct, 100)}%`, background: nivelColor(r.nivel_agua_pct) }} />
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                      {r.cloro_residual != null && <span style={{ color: r.cloro_residual >= CLORO_MIN && r.cloro_residual <= CLORO_MAX ? '#10b981' : '#ef4444' }}>Cl: {r.cloro_residual}</span>}
                      {r.ph != null && <span style={{ color: r.ph >= PH_MIN && r.ph <= PH_MAX ? '#10b981' : '#ef4444' }}>pH: {r.ph}</span>}
                      <span style={{ color: '#7E9389' }}>{r.fecha}</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#7E9389' }}>Sin registros</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {proximas.length > 0 && (
        <div style={{ background: '#F4EBE3', border: '1px solid #E6CDBB', borderRadius: 10, padding: '10px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#B96A3F', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>🔍 Próximas revisiones</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {proximas.map(r => (
              <span key={r.id} style={{ fontSize: 12, color: '#3E5A4C' }}>
                {r.cisterna} · <strong style={{ color: '#B96A3F' }}>{r.proxima_revision}</strong>
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
          <span style={{ fontSize: 13, color: '#7E9389', alignSelf: 'center' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: '#577B69', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nuevo registro'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: '#FAF7EF', border: '1px solid #E1DDD0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
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
              <input type="number" step="0.1" min="0" max="100" style={{ ...inp, borderColor: form.nivel_agua_pct ? (parseFloat(form.nivel_agua_pct) < 30 ? '#ef4444' : '#C7C2B0') : '#C7C2B0' }} value={form.nivel_agua_pct} onChange={e => setForm(p => ({ ...p, nivel_agua_pct: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Cloro residual <span style={{ color: '#7E9389' }}>({CLORO_MIN}–{CLORO_MAX})</span></label>
              <input type="number" step="0.01" style={inp} value={form.cloro_residual} onChange={e => setForm(p => ({ ...p, cloro_residual: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>pH <span style={{ color: '#7E9389' }}>({PH_MIN}–{PH_MAX})</span></label>
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
            style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Registrar'}
          </button>
        </div>
      )}

      {/* Historial */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#7E9389', padding: '40px 0', fontSize: 13 }}>Sin registros</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {lista.map(r => {
            const tipo = TIPOS.find(t => t.value === r.tipo)
            const est = ESTADOS.find(e => e.value === r.estado)
            return (
              <div key={r.id} style={{ background: '#fff', border: '1px solid #E1DDD0', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>🏗️ {r.cisterna}</span>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: tipo?.color + '20', color: tipo?.color }}>{tipo?.icon} {tipo?.label}</span>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: est?.bg, color: est?.color }}>{est?.icon} {est?.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#7E9389', marginTop: 3 }}>
                    {r.fecha}
                    {r.empresa_servicio && <span> · {r.empresa_servicio}</span>}
                    {r.observaciones && <span> · {r.observaciones}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  {r.nivel_agua_pct != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#7E9389' }}>Nivel</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: nivelColor(r.nivel_agua_pct) }}>{r.nivel_agua_pct}%</div>
                    </div>
                  )}
                  {r.cloro_residual != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#7E9389' }}>Cl</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: r.cloro_residual >= CLORO_MIN && r.cloro_residual <= CLORO_MAX ? '#10b981' : '#ef4444' }}>{r.cloro_residual}</div>
                    </div>
                  )}
                  {r.ph != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#7E9389' }}>pH</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: r.ph >= PH_MIN && r.ph <= PH_MAX ? '#10b981' : '#ef4444' }}>{r.ph}</div>
                    </div>
                  )}
                  {canEdit && r.estado === 'bajo_nivel' && (
                    <button onClick={() => cambiarEstado(r, 'normal')}
                      style={{ padding: '4px 10px', background: '#d1fae5', color: '#10b981', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
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
