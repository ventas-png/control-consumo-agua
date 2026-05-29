import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import { notify } from '../../shared/Dialog'
import { RegistroAutoridad, TipoAutoridad, ResultadoAutoridad } from '../../../types'

interface Props {
  registros: RegistroAutoridad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoAutoridad; label: string; icon: string; color: string }[] = [
  { value: 'policia',        label: 'Policía',        icon: '👮', color: 'var(--at-primary-2)' },
  { value: 'bomberos',       label: 'Bomberos',       icon: '🚒', color: 'var(--at-danger)' },
  { value: 'salud',          label: 'Salud',          icon: '🏥', color: 'var(--at-success)' },
  { value: 'municipalidad',  label: 'Municipalidad',  icon: '🏛️', color: 'var(--at-accent)' },
  { value: 'electricidad',   label: 'Electricidad',   icon: '⚡', color: 'var(--at-warning)' },
  { value: 'agua',           label: 'Agua',           icon: '💧', color: 'var(--at-accent-2)' },
  { value: 'otro',           label: 'Otro',           icon: '🔍', color: 'var(--at-ink-3)' },
]

const RESULTADOS: { value: ResultadoAutoridad; label: string; color: string; bg: string }[] = [
  { value: 'sin_novedad',       label: 'Sin novedad',       color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  { value: 'acta_levantada',    label: 'Acta levantada',    color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  { value: 'sancion',           label: 'Sanción',           color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  { value: 'recomendacion',     label: 'Recomendación',     color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  { value: 'otro',              label: 'Otro',              color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
]

export default function RegistroAutoridadesTab({ registros, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<RegistroAutoridad | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<TipoAutoridad | ''>('')
  const [soloSeguimiento, setSoloSeguimiento] = useState(false)

  const [form, setForm] = useState({
    tipo_autoridad: 'policia' as TipoAutoridad,
    nombre_institucion: '', nombre_funcionario: '', motivo: '',
    fecha: new Date().toISOString().split('T')[0],
    hora_llegada: '', hora_salida: '',
    resultado: 'sin_novedad' as ResultadoAutoridad,
    documento_referencia: '',
    requiere_seguimiento: false,
    fecha_seguimiento: '', observaciones: '',
  })

  const lista = registros.filter(r =>
    (filtroTipo === '' || r.tipo_autoridad === filtroTipo) &&
    (!soloSeguimiento || r.requiere_seguimiento)
  ).sort((a, b) => b.fecha.localeCompare(a.fecha))

  const pendientesSeguimiento = registros.filter(r => r.requiere_seguimiento && !r.fecha_seguimiento).length
  const conSeguimiento = registros.filter(r => r.requiere_seguimiento).length

  async function guardar() {
    if (!form.motivo.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'El motivo es obligatorio' }); return
    }
    setSaving(true)
    const { error } = await supabase.from('registro_autoridades').insert({
      company_id: companyId, project_id: proyectoId,
      tipo_autoridad: form.tipo_autoridad,
      nombre_institucion: form.nombre_institucion.trim() || null,
      nombre_funcionario: form.nombre_funcionario.trim() || null,
      motivo: form.motivo.trim(),
      fecha: form.fecha,
      hora_llegada: form.hora_llegada || null,
      hora_salida: form.hora_salida || null,
      resultado: form.resultado || null,
      documento_referencia: form.documento_referencia.trim() || null,
      requiere_seguimiento: form.requiere_seguimiento,
      fecha_seguimiento: form.fecha_seguimiento || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm({ tipo_autoridad: 'policia', nombre_institucion: '', nombre_funcionario: '', motivo: '', fecha: new Date().toISOString().split('T')[0], hora_llegada: '', hora_salida: '', resultado: 'sin_novedad', documento_referencia: '', requiere_seguimiento: false, fecha_seguimiento: '', observaciones: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function marcarSeguimientoRealizado(r: RegistroAutoridad) {
    await supabase.from('registro_autoridades').update({ requiere_seguimiento: false }).eq('id', r.id)
    if (selected?.id === r.id) setSelected(prev => prev ? { ...prev, requiere_seguimiento: false } : null)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 300, borderRight: '1px solid var(--at-line)', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Autoridades ({lista.length})</span>
              {pendientesSeguimiento > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 10, background: 'var(--at-warning-tint)', color: 'var(--at-warning)', fontWeight: 700 }}>{pendientesSeguimiento} seg.</span>
              )}
            </div>
            {canCreate && (
              <button onClick={() => { setMostrarForm(true); setSelected(null) }}
                style={{ padding: '5px 10px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Nuevo
              </button>
            )}
          </div>
          <select style={{ ...inp, marginBottom: 6 }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoAutoridad | '')}>
            <option value="">Todos los tipos</option>
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={soloSeguimiento} onChange={e => setSoloSeguimiento(e.target.checked)} />
            Solo con seguimiento pendiente
          </label>
        </div>

        {lista.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin registros</div>}

        {lista.map(r => {
          const tipo = TIPOS.find(t => t.value === r.tipo_autoridad)
          const res = RESULTADOS.find(x => x.value === r.resultado)
          return (
            <div key={r.id} onClick={() => { setSelected(r); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === r.id ? 'var(--at-accent-tint)' : 'var(--at-surface)', borderLeft: `3px solid ${r.requiere_seguimiento ? 'var(--at-warning)' : tipo?.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{tipo?.icon} {tipo?.label}</span>
                {r.resultado && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: res?.bg, color: res?.color }}>{res?.label}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--at-ink-2)', marginTop: 2, lineHeight: 1.4 }}>{r.motivo.length > 60 ? r.motivo.slice(0, 60) + '…' : r.motivo}</div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
                {r.fecha}
                {r.nombre_institucion && <span> · {r.nombre_institucion}</span>}
              </div>
              {r.requiere_seguimiento && <div style={{ fontSize: 10, color: 'var(--at-warning)', marginTop: 2 }}>⚠ Requiere seguimiento{r.fecha_seguimiento ? ` · ${r.fecha_seguimiento}` : ''}</div>}
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nuevo registro de visita</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Tipo autoridad *</label>
                <select style={inp} value={form.tipo_autoridad} onChange={e => setForm(p => ({ ...p, tipo_autoridad: e.target.value as TipoAutoridad }))}>
                  {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Institución</label>
                <input style={inp} placeholder="Delegación Norte…" value={form.nombre_institucion} onChange={e => setForm(p => ({ ...p, nombre_institucion: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Funcionario</label>
                <input style={inp} placeholder="Nombre del agente" value={form.nombre_funcionario} onChange={e => setForm(p => ({ ...p, nombre_funcionario: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Motivo de visita *</label>
                <textarea style={{ ...inp, height: 70, resize: 'vertical' }} value={form.motivo} onChange={e => setForm(p => ({ ...p, motivo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha</label>
                <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Hora llegada</label>
                <input type="time" style={inp} value={form.hora_llegada} onChange={e => setForm(p => ({ ...p, hora_llegada: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Hora salida</label>
                <input type="time" style={inp} value={form.hora_salida} onChange={e => setForm(p => ({ ...p, hora_salida: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Resultado</label>
                <select style={inp} value={form.resultado} onChange={e => setForm(p => ({ ...p, resultado: e.target.value as ResultadoAutoridad }))}>
                  {RESULTADOS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Documento referencia</label>
                <input style={inp} placeholder="Acta #, expediente…" value={form.documento_referencia} onChange={e => setForm(p => ({ ...p, documento_referencia: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                <input type="checkbox" id="seg_check" checked={form.requiere_seguimiento} onChange={e => setForm(p => ({ ...p, requiere_seguimiento: e.target.checked }))} />
                <label htmlFor="seg_check" style={{ fontSize: 13, cursor: 'pointer' }}>Requiere seguimiento</label>
              </div>
              {form.requiere_seguimiento && (
                <div>
                  <label style={lbl}>Fecha seguimiento</label>
                  <input type="date" style={inp} value={form.fecha_seguimiento} onChange={e => setForm(p => ({ ...p, fecha_seguimiento: e.target.value }))} />
                </div>
              )}
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Observaciones</label>
                <textarea style={{ ...inp, height: 60, resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Registrar'}
              </button>
              <button onClick={() => setMostrarForm(false)}
                style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!mostrarForm && selected && (() => {
          const tipo = TIPOS.find(t => t.value === selected.tipo_autoridad)
          const res = RESULTADOS.find(x => x.value === selected.resultado)
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: tipo?.color, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase' }}>{tipo?.icon} {tipo?.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{selected.motivo}</div>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4 }}>{selected.fecha}{selected.hora_llegada && <span> · Llegada: {selected.hora_llegada.slice(0, 5)}</span>}{selected.hora_salida && <span> · Salida: {selected.hora_salida.slice(0, 5)}</span>}</div>
                </div>
                {selected.resultado && (
                  <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, background: res?.bg, color: res?.color, fontWeight: 600 }}>{res?.label}</span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {selected.nombre_institucion && (
                  <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Institución</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.nombre_institucion}</div>
                  </div>
                )}
                {selected.nombre_funcionario && (
                  <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Funcionario</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.nombre_funcionario}</div>
                  </div>
                )}
                {selected.documento_referencia && (
                  <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Documento</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.documento_referencia}</div>
                  </div>
                )}
              </div>

              {selected.requiere_seguimiento && (
                <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--at-warning-strong)' }}>⚠ Requiere seguimiento</div>
                    {selected.fecha_seguimiento && <div style={{ fontSize: 12, color: 'var(--at-warning-strong)', marginTop: 2 }}>Fecha: {selected.fecha_seguimiento}</div>}
                  </div>
                  {canEdit && (
                    <button onClick={() => marcarSeguimientoRealizado(selected)}
                      style={{ padding: '6px 12px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      ✓ Realizado
                    </button>
                  )}
                </div>
              )}

              {selected.observaciones && (
                <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: 'var(--at-ink-2)', lineHeight: 1.6 }}>
                  <strong style={{ fontSize: 11, color: 'var(--at-ink-3)', display: 'block', marginBottom: 4 }}>OBSERVACIONES</strong>
                  {selected.observaciones}
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div>
            {conSeguimiento > 0 && (
              <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--at-warning-strong)', marginBottom: 4 }}>Seguimientos activos: {conSeguimiento}</div>
                <div style={{ fontSize: 12, color: 'var(--at-warning-strong)' }}>Filtra por "solo con seguimiento" para ver los pendientes</div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: 'var(--at-ink-3)', fontSize: 14 }}>
              Selecciona un registro o crea uno nuevo
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
