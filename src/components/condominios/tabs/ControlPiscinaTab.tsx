import { useState, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { ControlPiscina, EstadoPiscina, TurbiededadPiscina } from '../../../types'

interface Props {
  registros: ControlPiscina[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADOS: { value: EstadoPiscina; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'abierta',               label: 'Abierta',             color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  { value: 'cerrada_mantenimiento', label: 'Cerrada (manto.)',    color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '🔧' },
  { value: 'cerrada_quimica',       label: 'Cerrada (química)',   color: 'var(--at-accent)', bg: 'var(--at-accent-tint)', icon: '🧪' },
  { value: 'cerrada_incidente',     label: 'Cerrada (incidente)', color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '🚨' },
]

const TURBIEDAD: { value: TurbiededadPiscina; label: string; color: string }[] = [
  { value: 'cristalina',          label: 'Cristalina',           color: 'var(--at-accent-2)' },
  { value: 'ligeramente_turbia',  label: 'Liger. turbia',        color: 'var(--at-warning)' },
  { value: 'turbia',              label: 'Turbia',               color: 'var(--at-danger)' },
]

const PH_MIN = 7.2
const PH_MAX = 7.8
const CLORO_MIN = 0.5
const CLORO_MAX = 3.0

function phStatus(ph: number | null | undefined): 'ok' | 'warn' | 'bad' {
  if (ph == null) return 'ok'
  if (ph >= PH_MIN && ph <= PH_MAX) return 'ok'
  if (ph >= 7.0 && ph <= 8.0) return 'warn'
  return 'bad'
}

function cloroStatus(c: number | null | undefined): 'ok' | 'warn' | 'bad' {
  if (c == null) return 'ok'
  if (c >= CLORO_MIN && c <= CLORO_MAX) return 'ok'
  if (c >= 0.2 && c <= 4.0) return 'warn'
  return 'bad'
}

const STATUS_COLOR = { ok: 'var(--at-success)', warn: 'var(--at-warning)', bad: 'var(--at-danger)' }

export default function ControlPiscinaTab({ registros, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [filtroPiscina, setFiltroPiscina] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    piscina: 'Principal', fecha: new Date().toISOString().split('T')[0],
    hora: new Date().toTimeString().slice(0, 5),
    ph: '', cloro: '', temperatura: '',
    turbiedad: 'cristalina' as TurbiededadPiscina,
    estado: 'abierta' as EstadoPiscina,
    num_usuarios: '', registrado_por: '', observaciones: '',
  })

  const piscinas = [...new Set(registros.map(r => r.piscina))].sort()
  const lista = registros.filter(r => filtroPiscina === '' || r.piscina === filtroPiscina)

  const ultimo = piscinas.reduce<Record<string, ControlPiscina>>((acc, p) => {
    const rec = registros.filter(r => r.piscina === p).sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.hora ?? '').localeCompare(a.hora ?? ''))[0]
    if (rec) acc[p] = rec
    return acc
  }, {})

  async function guardar() {
    if (!form.piscina.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'El nombre de la piscina es obligatorio' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('control_piscina', {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, hora: form.hora || null,
      piscina: form.piscina.trim(),
      ph: form.ph ? parseFloat(form.ph) : null,
      cloro: form.cloro ? parseFloat(form.cloro) : null,
      temperatura: form.temperatura ? parseFloat(form.temperatura) : null,
      turbiedad: form.turbiedad, estado: form.estado,
      num_usuarios: form.num_usuarios ? parseInt(form.num_usuarios) : null,
      registrado_por: form.registrado_por.trim() || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(p => ({ ...p, ph: '', cloro: '', temperatura: '', num_usuarios: '', observaciones: '' }))
    setMostrarForm(false)
    onRefresh()
  }

  async function cambiarEstado(r: ControlPiscina, estado: EstadoPiscina) {
    await updateCondominioRow('control_piscina', r.id, { estado })
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  function GaugeBar({ value, min, max, status }: { value: number | null | undefined; min: number; max: number; status: 'ok' | 'warn' | 'bad' }) {
    if (value == null) return <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>—</span>
    const pct = Math.min(Math.max(((value - (min - 1)) / ((max + 1) - (min - 1))) * 100, 0), 100)
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: STATUS_COLOR[status] }}>{value}</div>
        <div style={{ height: 4, background: 'var(--at-line)', borderRadius: 2, overflow: 'hidden', marginTop: 2 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: STATUS_COLOR[status] }} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Estado actual por piscina */}
      {piscinas.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          {piscinas.map(p => {
            const r = ultimo[p]
            const est = ESTADOS.find(e => e.value === r?.estado)
            const turb = TURBIEDAD.find(t => t.value === r?.turbiedad)
            return (
              <div key={p} style={{ background: est?.bg ?? 'var(--at-surface-2)', border: `1px solid ${est?.color ?? 'var(--at-line)'}`, borderRadius: 12, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>🏊 {p}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: est?.color }}>{est?.icon} {est?.label}</span>
                </div>
                {r ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>pH</div>
                      <GaugeBar value={r.ph} min={PH_MIN} max={PH_MAX} status={phStatus(r.ph)} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>Cloro</div>
                      <GaugeBar value={r.cloro} min={CLORO_MIN} max={CLORO_MAX} status={cloroStatus(r.cloro)} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>°C</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink-2)' }}>{r.temperatura ?? '—'}</div>
                    </div>
                    <div style={{ gridColumn: 'span 3', fontSize: 11, color: turb?.color, marginTop: 2 }}>
                      💧 {turb?.label} · {r.fecha} {r.hora?.slice(0, 5)}
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

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select style={{ ...inp, width: 'auto' }} value={filtroPiscina} onChange={e => setFiltroPiscina(e.target.value)}>
            <option value="">Todas las piscinas</option>
            {piscinas.map(p => <option key={p} value={p}>{p}</option>)}
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
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nuevo registro de piscina</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Piscina</label>
              <input style={inp} placeholder="Principal, Sur, Infantil…" value={form.piscina} onChange={e => setForm(p => ({ ...p, piscina: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha</label>
              <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Hora</label>
              <input type="time" style={inp} value={form.hora} onChange={e => setForm(p => ({ ...p, hora: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>pH <span style={{ color: 'var(--at-ink-3)' }}>(ideal {PH_MIN}–{PH_MAX})</span></label>
              <input type="number" step="0.01" style={{ ...inp, borderColor: form.ph ? STATUS_COLOR[phStatus(parseFloat(form.ph))] : 'var(--at-line-strong)' }} value={form.ph} onChange={e => setForm(p => ({ ...p, ph: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Cloro ppm <span style={{ color: 'var(--at-ink-3)' }}>({CLORO_MIN}–{CLORO_MAX})</span></label>
              <input type="number" step="0.01" style={{ ...inp, borderColor: form.cloro ? STATUS_COLOR[cloroStatus(parseFloat(form.cloro))] : 'var(--at-line-strong)' }} value={form.cloro} onChange={e => setForm(p => ({ ...p, cloro: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Temperatura (°C)</label>
              <input type="number" step="0.1" style={inp} value={form.temperatura} onChange={e => setForm(p => ({ ...p, temperatura: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Turbiedad</label>
              <select style={inp} value={form.turbiedad} onChange={e => setForm(p => ({ ...p, turbiedad: e.target.value as TurbiededadPiscina }))}>
                {TURBIEDAD.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Estado</label>
              <select style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoPiscina }))}>
                {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>N° usuarios en piscina</label>
              <input type="number" style={inp} value={form.num_usuarios} onChange={e => setForm(p => ({ ...p, num_usuarios: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Registrado por</label>
              <input style={inp} value={form.registrado_por} onChange={e => setForm(p => ({ ...p, registrado_por: e.target.value }))} />
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
            const est = ESTADOS.find(e => e.value === r.estado)
            const turb = TURBIEDAD.find(t => t.value === r.turbiedad)
            return (
              <div key={r.id} style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>🏊 {r.piscina}</span>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: est?.bg, color: est?.color }}>{est?.icon} {est?.label}</span>
                    <span style={{ fontSize: 11, color: turb?.color }}>💧 {turb?.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 3 }}>
                    {r.fecha} {r.hora?.slice(0, 5)}
                    {r.registrado_por && <span> · {r.registrado_por}</span>}
                    {r.observaciones && <span> · {r.observaciones}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  {r.ph != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>pH</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: STATUS_COLOR[phStatus(r.ph)] }}>{r.ph}</div>
                    </div>
                  )}
                  {r.cloro != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>Cl</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: STATUS_COLOR[cloroStatus(r.cloro)] }}>{r.cloro}</div>
                    </div>
                  )}
                  {r.temperatura != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>°C</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--at-ink-2)' }}>{r.temperatura}</div>
                    </div>
                  )}
                  {canEdit && r.estado !== 'abierta' && (
                    <button onClick={() => cambiarEstado(r, 'abierta')}
                      style={{ padding: '4px 10px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                      Abrir
                    </button>
                  )}
                  {canEdit && r.estado === 'abierta' && (
                    <button onClick={() => cambiarEstado(r, 'cerrada_mantenimiento')}
                      style={{ padding: '4px 10px', background: 'var(--at-warning-tint)', color: 'var(--at-warning)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                      Cerrar
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
