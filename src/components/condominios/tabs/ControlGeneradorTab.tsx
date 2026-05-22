import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { ControlGenerador, TipoRegistroGenerador, EstadoGenerador } from '../../../types'

interface Props {
  registros: ControlGenerador[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoRegistroGenerador; label: string; icon: string; color: string }[] = [
  { value: 'lectura',              label: 'Lectura',             icon: '📊', color: 'var(--at-accent-2)' },
  { value: 'mantenimiento',        label: 'Mantenimiento',       icon: '🔧', color: 'var(--at-accent)' },
  { value: 'prueba',               label: 'Prueba',              icon: '⚡', color: 'var(--at-warning)' },
  { value: 'falla',                label: 'Falla',               icon: '⚠️', color: 'var(--at-danger)' },
  { value: 'arranque_emergencia',  label: 'Arranque emergencia', icon: '🚨', color: 'var(--at-danger)' },
]

const ESTADOS: { value: EstadoGenerador; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'standby',      label: 'Standby',      color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  { value: 'operando',     label: 'Operando',      color: 'var(--at-accent)', bg: 'var(--at-accent-tint)', icon: '⚡' },
  { value: 'mantenimiento',label: 'Mantenimiento', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '🔧' },
  { value: 'falla',        label: 'Falla',         color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '⚠️' },
  { value: 'apagado',      label: 'Apagado',       color: 'var(--at-ink-3)', bg: 'var(--at-chip)', icon: '⭕' },
]

function nivelCombColor(pct: number | null | undefined): string {
  if (pct == null) return 'var(--at-ink-3)'
  if (pct >= 50) return 'var(--at-success)'
  if (pct >= 25) return 'var(--at-warning)'
  return 'var(--at-danger)'
}

export default function ControlGeneradorTab({ registros, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [filtroGenerador, setFiltroGenerador] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<TipoRegistroGenerador | ''>('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    generador: 'Generador principal',
    fecha: new Date().toISOString().split('T')[0],
    tipo: 'lectura' as TipoRegistroGenerador,
    nivel_combustible_pct: '', horas_operacion: '', horas_acumuladas: '',
    estado: 'standby' as EstadoGenerador,
    voltaje: '', frecuencia: '',
    operador: '', empresa_servicio: '', costo: '',
    proximo_mantenimiento: '', observaciones: '',
  })

  const generadores = [...new Set(registros.map(r => r.generador))].sort()

  const lista = registros.filter(r =>
    (filtroGenerador === '' || r.generador === filtroGenerador) &&
    (filtroTipo === '' || r.tipo === filtroTipo)
  )

  const ultimo = generadores.reduce<Record<string, ControlGenerador>>((acc, g) => {
    const rec = registros.filter(r => r.generador === g).sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
    if (rec) acc[g] = rec
    return acc
  }, {})

  const totalHoras = registros.reduce((s, r) => s + (r.horas_operacion ?? 0), 0)
  const fallas = registros.filter(r => r.tipo === 'falla').length

  async function guardar() {
    if (!form.generador.trim()) {
      Swal.fire('Faltan datos', 'El nombre del generador es obligatorio', 'warning'); return
    }
    setSaving(true)
    const { error } = await supabase.from('control_generador').insert({
      company_id: companyId, project_id: proyectoId,
      generador: form.generador.trim(), fecha: form.fecha, tipo: form.tipo,
      nivel_combustible_pct: form.nivel_combustible_pct ? parseFloat(form.nivel_combustible_pct) : null,
      horas_operacion: form.horas_operacion ? parseFloat(form.horas_operacion) : null,
      horas_acumuladas: form.horas_acumuladas ? parseFloat(form.horas_acumuladas) : null,
      estado: form.estado,
      voltaje: form.voltaje ? parseFloat(form.voltaje) : null,
      frecuencia: form.frecuencia ? parseFloat(form.frecuencia) : null,
      operador: form.operador.trim() || null,
      empresa_servicio: form.empresa_servicio.trim() || null,
      costo: form.costo ? parseFloat(form.costo) : null,
      proximo_mantenimiento: form.proximo_mantenimiento || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm(p => ({ ...p, nivel_combustible_pct: '', horas_operacion: '', voltaje: '', frecuencia: '', costo: '', observaciones: '' }))
    setMostrarForm(false)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* Estado actual por generador */}
      {generadores.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12, marginBottom: 16 }}>
          {generadores.map(g => {
            const r = ultimo[g]
            const est = ESTADOS.find(e => e.value === r?.estado)
            return (
              <div key={g} style={{ background: est?.bg ?? 'var(--at-surface-2)', border: `1px solid ${est?.color ?? 'var(--at-line)'}`, borderRadius: 12, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>⚡ {g}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: est?.color }}>{est?.icon} {est?.label}</span>
                </div>
                {r ? (
                  <div>
                    {r.nivel_combustible_pct != null && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Combustible</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: nivelCombColor(r.nivel_combustible_pct) }}>{r.nivel_combustible_pct}%</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--at-line)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(r.nivel_combustible_pct, 100)}%`, background: nivelCombColor(r.nivel_combustible_pct) }} />
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, flexWrap: 'wrap' }}>
                      {r.horas_acumuladas != null && <span style={{ color: 'var(--at-ink-3)' }}>⏱ {r.horas_acumuladas}h acum.</span>}
                      {r.voltaje != null && <span style={{ color: 'var(--at-accent)' }}>{r.voltaje}V</span>}
                      {r.frecuencia != null && <span style={{ color: 'var(--at-accent)' }}>{r.frecuencia}Hz</span>}
                    </div>
                    {r.proximo_mantenimiento && (
                      <div style={{ fontSize: 10, color: 'var(--at-warning)', marginTop: 4 }}>🔧 Manto: {r.proximo_mantenimiento}</div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Sin registros</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ background: 'var(--at-accent-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-accent)' }}>{registros.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-accent)' }}>Registros totales</div>
        </div>
        <div style={{ background: 'var(--at-warning-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-warning)' }}>{totalHoras.toFixed(1)}h</div>
          <div style={{ fontSize: 11, color: 'var(--at-warning)' }}>Horas operación totales</div>
        </div>
        <div style={{ background: fallas > 0 ? 'var(--at-danger-tint)' : 'var(--at-chip)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: fallas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{fallas}</div>
          <div style={{ fontSize: 11, color: fallas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>Fallas registradas</div>
        </div>
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select style={{ ...inp, width: 'auto' }} value={filtroGenerador} onChange={e => setFiltroGenerador(e.target.value)}>
            <option value="">Todos los generadores</option>
            {generadores.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select style={{ ...inp, width: 'auto' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoRegistroGenerador | '')}>
            <option value="">Todos los tipos</option>
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nuevo registro'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nuevo registro de generador</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Generador</label>
              <input style={inp} placeholder="Generador principal…" value={form.generador} onChange={e => setForm(p => ({ ...p, generador: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha</label>
              <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Tipo registro</label>
              <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoRegistroGenerador }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Nivel combustible (%)</label>
              <input type="number" step="0.1" min="0" max="100" style={{ ...inp, borderColor: form.nivel_combustible_pct ? (parseFloat(form.nivel_combustible_pct) < 25 ? 'var(--at-danger)' : 'var(--at-line-strong)') : 'var(--at-line-strong)' }} value={form.nivel_combustible_pct} onChange={e => setForm(p => ({ ...p, nivel_combustible_pct: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Horas operación</label>
              <input type="number" step="0.1" style={inp} value={form.horas_operacion} onChange={e => setForm(p => ({ ...p, horas_operacion: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Horas acumuladas</label>
              <input type="number" step="0.1" style={inp} value={form.horas_acumuladas} onChange={e => setForm(p => ({ ...p, horas_acumuladas: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Estado</label>
              <select style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoGenerador }))}>
                {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Voltaje (V)</label>
              <input type="number" step="0.1" style={inp} value={form.voltaje} onChange={e => setForm(p => ({ ...p, voltaje: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Frecuencia (Hz)</label>
              <input type="number" step="0.1" style={inp} value={form.frecuencia} onChange={e => setForm(p => ({ ...p, frecuencia: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Operador</label>
              <input style={inp} value={form.operador} onChange={e => setForm(p => ({ ...p, operador: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Empresa servicio</label>
              <input style={inp} value={form.empresa_servicio} onChange={e => setForm(p => ({ ...p, empresa_servicio: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Costo ({moneda})</label>
              <input type="number" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Próximo mantenimiento</label>
              <input type="date" style={inp} value={form.proximo_mantenimiento} onChange={e => setForm(p => ({ ...p, proximo_mantenimiento: e.target.value }))} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
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
              <div key={r.id} style={{ background: 'var(--at-surface)', border: `1px solid ${r.tipo === 'falla' ? 'var(--at-danger-border)' : 'var(--at-line)'}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>⚡ {r.generador}</span>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: tipo?.color + '20', color: tipo?.color }}>{tipo?.icon} {tipo?.label}</span>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: est?.bg, color: est?.color }}>{est?.icon} {est?.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 3 }}>
                    {r.fecha}
                    {r.operador && <span> · {r.operador}</span>}
                    {r.observaciones && <span> · {r.observaciones}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  {r.nivel_combustible_pct != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>Combustible</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: nivelCombColor(r.nivel_combustible_pct) }}>{r.nivel_combustible_pct}%</div>
                    </div>
                  )}
                  {r.horas_operacion != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>Horas</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--at-ink-2)' }}>{r.horas_operacion}h</div>
                    </div>
                  )}
                  {r.voltaje != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>Voltaje</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-accent)' }}>{r.voltaje}V</div>
                    </div>
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
