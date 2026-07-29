import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { ControlPlagas, TipoControlPlagas, ResultadoControlPlagas } from '../../../types'

interface Props {
  registros: ControlPlagas[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit?: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoControlPlagas; label: string; icon: string }[] = [
  { value: 'fumigacion',  label: 'Fumigación',   icon: '💨' },
  { value: 'inspeccion',  label: 'Inspección',   icon: '🔍' },
  { value: 'tratamiento', label: 'Tratamiento',  icon: '🧪' },
  { value: 'preventivo',  label: 'Preventivo',   icon: '🛡️' },
]

const RESULTADOS: { value: ResultadoControlPlagas; label: string; color: string }[] = [
  { value: 'satisfactorio',        label: 'Satisfactorio',        color: 'var(--at-success)' },
  { value: 'con_observaciones',    label: 'Con observaciones',    color: 'var(--at-warning)' },
  { value: 'requiere_seguimiento', label: 'Requiere seguimiento', color: 'var(--at-danger)' },
  { value: 'no_realizado',         label: 'No realizado',         color: 'var(--at-ink-3)' },
]

const AREAS_COMUNES = ['Lobby', 'Piscina', 'Gimnasio', 'Parqueo', 'Jardines', 'Azotea', 'Cuarto de basura', 'Cuarto de máquinas', 'Pasillos', 'Escaleras', 'Sótano']

function diasParaProxima(fecha?: string | null): number | null {
  if (!fecha) return null
  return Math.round((new Date(fecha).getTime() - Date.now()) / 86400000)
}

export default function ControlPlagasTab({ registros, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [selected, setSelected] = useState<ControlPlagas | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [areasSeleccionadas, setAreasSeleccionadas] = useState<string[]>([])
  const [areaCustom, setAreaCustom] = useState('')

  const [form, setForm] = useState({
    tipo: 'fumigacion' as TipoControlPlagas,
    empresa: '', tecnico: '', productos: '',
    fecha: hoyLocalISO(),
    hora_inicio: '', hora_fin: '',
    resultado: 'satisfactorio' as ResultadoControlPlagas,
    proxima_visita: '', costo: '', observaciones: '',
  })

  const proximas = registros.filter(r => {
    const d = diasParaProxima(r.proxima_visita)
    return d !== null && d <= 30 && d >= 0
  })

  function toggleArea(area: string) {
    setAreasSeleccionadas(prev => prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area])
  }

  function addAreaCustom() {
    const a = areaCustom.trim()
    if (!a) return
    if (!areasSeleccionadas.includes(a)) setAreasSeleccionadas(prev => [...prev, a])
    setAreaCustom('')
  }

  async function guardar() {
    if (areasSeleccionadas.length === 0) { notify({ variant: 'warning', title: 'Faltan datos', text: 'Selecciona al menos un área' }); return }
    setSaving(true)
    const { error } = await createCondominioRow('control_plagas', {
      company_id: companyId, project_id: proyectoId,
      tipo: form.tipo, empresa: form.empresa.trim() || null,
      tecnico: form.tecnico.trim() || null, areas: areasSeleccionadas,
      productos: form.productos.trim() || null, fecha: form.fecha,
      hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null,
      resultado: form.resultado,
      proxima_visita: form.proxima_visita || null,
      costo: form.costo ? parseFloat(form.costo) : null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm({ tipo: 'fumigacion', empresa: '', tecnico: '', productos: '', fecha: hoyLocalISO(), hora_inicio: '', hora_fin: '', resultado: 'satisfactorio', proxima_visita: '', costo: '', observaciones: '' })
    setAreasSeleccionadas([])
    setMostrarForm(false)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      <div style={{ width: 300, borderRight: '1px solid var(--at-line)', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--at-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Registros ({registros.length})</span>
          {canCreate && (
            <button onClick={() => { setMostrarForm(true); setSelected(null) }}
              style={{ padding: '5px 10px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
              + Nuevo
            </button>
          )}
        </div>

        {proximas.length > 0 && (
          <div style={{ padding: '8px 12px', background: 'var(--at-warning-tint)', borderBottom: '1px solid var(--at-warning-border)', fontSize: 12, color: 'var(--at-warning-strong)' }}>
            ⏰ {proximas.length} visita(s) próxima(s) en los próximos 30 días
          </div>
        )}

        {registros.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin registros</div>}

        {registros.map(r => {
          const tipo = TIPOS.find(t => t.value === r.tipo)
          const res = RESULTADOS.find(re => re.value === r.resultado)
          const diasProx = diasParaProxima(r.proxima_visita)
          return (
            <div key={r.id} onClick={() => { setSelected(r); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === r.id ? 'var(--at-accent-tint)' : 'var(--at-surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{tipo?.icon} {tipo?.label}</span>
                <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, background: res?.color + '20', color: res?.color }}>{res?.label}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
                {r.fecha}
                {r.empresa && <span> · {r.empresa}</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{r.areas.slice(0, 3).join(', ')}{r.areas.length > 3 ? ` +${r.areas.length - 3}` : ''}</div>
              {diasProx !== null && diasProx <= 30 && (
                <div style={{ fontSize: 11, color: diasProx <= 7 ? 'var(--at-danger)' : 'var(--at-warning)', marginTop: 2 }}>
                  ⏰ Próx. visita en {diasProx} días
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nuevo registro de control de plagas</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Tipo</label>
                <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoControlPlagas }))}>
                  {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Empresa</label>
                <input style={inp} placeholder="Nombre de la empresa" value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Técnico</label>
                <input style={inp} value={form.tecnico} onChange={e => setForm(p => ({ ...p, tecnico: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha</label>
                <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Hora inicio</label>
                <input type="time" style={inp} value={form.hora_inicio} onChange={e => setForm(p => ({ ...p, hora_inicio: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Hora fin</label>
                <input type="time" style={inp} value={form.hora_fin} onChange={e => setForm(p => ({ ...p, hora_fin: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Productos utilizados</label>
                <input style={inp} placeholder="Nombre y concentración de productos" value={form.productos} onChange={e => setForm(p => ({ ...p, productos: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Resultado</label>
                <select style={inp} value={form.resultado} onChange={e => setForm(p => ({ ...p, resultado: e.target.value as ResultadoControlPlagas }))}>
                  {RESULTADOS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Próxima visita</label>
                <input type="date" style={inp} value={form.proxima_visita} onChange={e => setForm(p => ({ ...p, proxima_visita: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Costo ({moneda})</label>
                <input type="number" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
              </div>
            </div>

            {/* Áreas */}
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Áreas tratadas *</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {AREAS_COMUNES.map(a => (
                  <button key={a} type="button" onClick={() => toggleArea(a)}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid', fontSize: 12, cursor: 'pointer', background: areasSeleccionadas.includes(a) ? 'var(--at-accent)' : 'var(--at-surface)', color: areasSeleccionadas.includes(a) ? 'white' : 'var(--at-ink-2)', borderColor: areasSeleccionadas.includes(a) ? 'var(--at-accent)' : 'var(--at-line-strong)' }}>
                    {a}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...inp, flex: 1 }} placeholder="Otra área…" value={areaCustom} onChange={e => setAreaCustom(e.target.value)} onKeyDown={e => e.key === 'Enter' && addAreaCustom()} />
                <button onClick={addAreaCustom} style={{ padding: '7px 12px', background: 'var(--at-chip)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>+ Agregar</button>
              </div>
              {areasSeleccionadas.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--at-accent)' }}>
                  Seleccionadas: {areasSeleccionadas.join(', ')}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Observaciones</label>
              <textarea style={{ ...inp, height: 70, resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Guardar'}
              </button>
              <button onClick={() => { setMostrarForm(false); setAreasSeleccionadas([]) }}
                style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!mostrarForm && selected && (() => {
          const tipo = TIPOS.find(t => t.value === selected.tipo)
          const res = RESULTADOS.find(r => r.value === selected.resultado)
          const diasProx = diasParaProxima(selected.proxima_visita)
          return (
            <div>
              <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 4 }}>{tipo?.icon} {tipo?.label}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                <span style={{ padding: '4px 12px', borderRadius: 10, background: res?.color + '20', color: res?.color, fontWeight: 600, fontSize: 13 }}>{res?.label}</span>
                <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{selected.fecha}</span>
                {selected.hora_inicio && <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{selected.hora_inicio} – {selected.hora_fin || '?'}</span>}
              </div>

              {diasProx !== null && diasProx <= 30 && (
                <div style={{ background: diasProx <= 7 ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)', border: `1px solid ${diasProx <= 7 ? 'var(--at-danger-border)' : 'var(--at-warning-border)'}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: diasProx <= 7 ? 'var(--at-danger)' : 'var(--at-warning-strong)' }}>
                  ⏰ Próxima visita: {selected.proxima_visita} ({diasProx} días)
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Empresa', value: selected.empresa || '—' },
                  { label: 'Técnico', value: selected.tecnico || '—' },
                  { label: 'Productos', value: selected.productos || '—' },
                  { label: `Costo (${moneda})`, value: selected.costo?.toLocaleString() ?? '—' },
                  { label: 'Próxima visita', value: selected.proxima_visita || '—' },
                ].map(d => (
                  <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 6, padding: '7px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{d.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{d.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Áreas tratadas</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                {selected.areas.map(a => (
                  <span key={a} style={{ padding: '4px 10px', background: 'var(--at-accent-tint)', color: 'var(--at-accent)', borderRadius: 8, fontSize: 12 }}>{a}</span>
                ))}
              </div>

              {selected.observaciones && (
                <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                  <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 3 }}>Observaciones</div>
                  {selected.observaciones}
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--at-ink-3)', fontSize: 14 }}>
            Selecciona un registro o crea uno nuevo
          </div>
        )}
      </div>
    </div>
  )
}
