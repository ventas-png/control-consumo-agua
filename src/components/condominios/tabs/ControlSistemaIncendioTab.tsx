import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { ControlSistemaIncendio, TipoSistemaIncendio, TipoInspeccionIncendio, ResultadoInspeccionIncendio } from '../../../types'

interface Props {
  registros: ControlSistemaIncendio[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS_SISTEMA: { value: TipoSistemaIncendio; label: string; icon: string; color: string }[] = [
  { value: 'extintor',      label: 'Extintor',        icon: '🧯', color: 'var(--at-danger)' },
  { value: 'rociador',      label: 'Rociador',        icon: '🚿', color: 'var(--at-accent-2)' },
  { value: 'alarma',        label: 'Alarma',          icon: '🔔', color: 'var(--at-warning)' },
  { value: 'hidrant',       label: 'Hidrante',        icon: '🚒', color: 'var(--at-danger)' },
  { value: 'detector_humo', label: 'Detector humo',   icon: '💨', color: 'var(--at-accent)' },
  { value: 'gabinete',      label: 'Gabinete',        icon: '🗄️', color: 'var(--at-accent)' },
  { value: 'otro',          label: 'Otro',            icon: '📋', color: 'var(--at-ink-3)' },
]

const TIPOS_INSPECCION: { value: TipoInspeccionIncendio; label: string }[] = [
  { value: 'revision_visual',  label: 'Revisión visual' },
  { value: 'prueba_funcional', label: 'Prueba funcional' },
  { value: 'recarga',          label: 'Recarga' },
  { value: 'reemplazo',        label: 'Reemplazo' },
  { value: 'inspeccion_legal', label: 'Inspección legal' },
]

const RESULTADOS: { value: ResultadoInspeccionIncendio; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'aprobado',              label: 'Aprobado',             color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  { value: 'observacion',           label: 'Observación',          color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '⚠️' },
  { value: 'requiere_mantenimiento',label: 'Req. mantenimiento',   color: 'var(--at-accent)', bg: 'var(--at-accent-tint)', icon: '🔧' },
  { value: 'fuera_servicio',        label: 'Fuera de servicio',    color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '🚫' },
]

export default function ControlSistemaIncendioTab({ registros, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [selected, setSelected] = useState<ControlSistemaIncendio | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<TipoSistemaIncendio | ''>('')
  const [filtroResultado, setFiltroResultado] = useState<ResultadoInspeccionIncendio | ''>('')

  const [form, setForm] = useState({
    fecha: hoyLocalISO(),
    tipo_sistema: 'extintor' as TipoSistemaIncendio,
    identificador: '', ubicacion: '',
    tipo_inspeccion: 'revision_visual' as TipoInspeccionIncendio,
    resultado: 'aprobado' as ResultadoInspeccionIncendio,
    fecha_vencimiento: '', empresa_servicio: '', tecnico: '',
    costo: '', proxima_inspeccion: '', observaciones: '',
  })

  const lista = registros.filter(r =>
    (filtroTipo === '' || r.tipo_sistema === filtroTipo) &&
    (filtroResultado === '' || r.resultado === filtroResultado)
  )

  const vencidosHoy = registros.filter(r => r.fecha_vencimiento && new Date(r.fecha_vencimiento) < new Date())
  const proximosVencer = registros.filter(r => {
    if (!r.fecha_vencimiento) return false
    const diff = (new Date(r.fecha_vencimiento).getTime() - new Date().setHours(0,0,0,0)) / 86400000
    return diff >= 0 && diff <= 30
  })

  const resumenPorTipo = TIPOS_SISTEMA.map(t => ({
    ...t,
    total: registros.filter(r => r.tipo_sistema === t.value).length,
    problemas: registros.filter(r => r.tipo_sistema === t.value && (r.resultado === 'fuera_servicio' || r.resultado === 'requiere_mantenimiento')).length,
  })).filter(t => t.total > 0)

  async function guardar() {
    if (!form.identificador.trim() || !form.ubicacion.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Identificador y ubicación son obligatorios' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('control_sistema_incendio', {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, tipo_sistema: form.tipo_sistema,
      identificador: form.identificador.trim(), ubicacion: form.ubicacion.trim(),
      tipo_inspeccion: form.tipo_inspeccion, resultado: form.resultado,
      fecha_vencimiento: form.fecha_vencimiento || null,
      empresa_servicio: form.empresa_servicio.trim() || null,
      tecnico: form.tecnico.trim() || null,
      costo: form.costo ? parseFloat(form.costo) : null,
      proxima_inspeccion: form.proxima_inspeccion || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(p => ({ ...p, identificador: '', ubicacion: '', fecha_vencimiento: '', costo: '', proxima_inspeccion: '', observaciones: '' }))
    setMostrarForm(false)
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
              <span style={{ fontWeight: 600, fontSize: 14 }}>Incendio ({lista.length})</span>
              {vencidosHoy.length > 0 && <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 10, background: 'var(--at-danger-tint)', color: 'var(--at-danger)', fontWeight: 700 }}>{vencidosHoy.length} venc.</span>}
            </div>
            {canCreate && (
              <button onClick={() => { setMostrarForm(true); setSelected(null) }}
                style={{ padding: '5px 10px', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Nuevo
              </button>
            )}
          </div>
          <select style={{ ...inp, marginBottom: 6 }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoSistemaIncendio | '')}>
            <option value="">Todos los sistemas</option>
            {TIPOS_SISTEMA.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          <select style={inp} value={filtroResultado} onChange={e => setFiltroResultado(e.target.value as ResultadoInspeccionIncendio | '')}>
            <option value="">Todos los resultados</option>
            {RESULTADOS.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
          </select>
        </div>

        {/* Resumen */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--at-line)' }}>
          {resumenPorTipo.map(t => (
            <div key={t.value} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
              <span>{t.icon} {t.label}</span>
              <span style={{ color: t.problemas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>
                {t.total}{t.problemas > 0 ? ` (${t.problemas} ⚠)` : ''}
              </span>
            </div>
          ))}
        </div>

        {lista.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin registros</div>}

        {lista.map(r => {
          const tipo = TIPOS_SISTEMA.find(t => t.value === r.tipo_sistema)
          const res = RESULTADOS.find(x => x.value === r.resultado)
          const vencido = r.fecha_vencimiento && new Date(r.fecha_vencimiento) < new Date()
          return (
            <div key={r.id} onClick={() => { setSelected(r); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === r.id ? 'var(--at-danger-tint)' : 'var(--at-surface)', borderLeft: `3px solid ${vencido ? 'var(--at-danger)' : tipo?.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{tipo?.icon} {r.identificador}</span>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: res?.bg, color: res?.color }}>{res?.icon} {res?.label}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{r.ubicacion}</div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
                {r.fecha}
                {r.fecha_vencimiento && <span style={{ color: vencido ? 'var(--at-danger)' : 'var(--at-ink-3)' }}> · Vence: {r.fecha_vencimiento}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nueva inspección sistema contra incendios</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Tipo sistema</label>
                <select style={inp} value={form.tipo_sistema} onChange={e => setForm(p => ({ ...p, tipo_sistema: e.target.value as TipoSistemaIncendio }))}>
                  {TIPOS_SISTEMA.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Identificador *</label>
                <input style={inp} placeholder="EXT-001, ALM-05…" value={form.identificador} onChange={e => setForm(p => ({ ...p, identificador: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Ubicación *</label>
                <input style={inp} placeholder="Lobby, Piso 3…" value={form.ubicacion} onChange={e => setForm(p => ({ ...p, ubicacion: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha inspección</label>
                <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Tipo inspección</label>
                <select style={inp} value={form.tipo_inspeccion} onChange={e => setForm(p => ({ ...p, tipo_inspeccion: e.target.value as TipoInspeccionIncendio }))}>
                  {TIPOS_INSPECCION.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Resultado</label>
                <select style={inp} value={form.resultado} onChange={e => setForm(p => ({ ...p, resultado: e.target.value as ResultadoInspeccionIncendio }))}>
                  {RESULTADOS.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Fecha vencimiento</label>
                <input type="date" style={inp} value={form.fecha_vencimiento} onChange={e => setForm(p => ({ ...p, fecha_vencimiento: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Próxima inspección</label>
                <input type="date" style={inp} value={form.proxima_inspeccion} onChange={e => setForm(p => ({ ...p, proxima_inspeccion: e.target.value }))} />
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
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Observaciones</label>
                <input style={inp} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
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
          const tipo = TIPOS_SISTEMA.find(t => t.value === selected.tipo_sistema)
          const res = RESULTADOS.find(x => x.value === selected.resultado)
          const tipoInsp = TIPOS_INSPECCION.find(t => t.value === selected.tipo_inspeccion)
          const vencido = selected.fecha_vencimiento && new Date(selected.fecha_vencimiento) < new Date()
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: tipo?.color, fontWeight: 700, marginBottom: 4 }}>{tipo?.icon} {tipo?.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 20 }}>{selected.identificador}</div>
                  <div style={{ fontSize: 13, color: 'var(--at-ink-3)', marginTop: 4 }}>📍 {selected.ubicacion}</div>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>{selected.fecha} · {tipoInsp?.label}</div>
                </div>
                <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, background: res?.bg, color: res?.color, fontWeight: 600 }}>{res?.icon} {res?.label}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                {selected.fecha_vencimiento && (
                  <div style={{ background: vencido ? 'var(--at-danger-tint)' : 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px', border: vencido ? '1px solid var(--at-danger-border)' : 'none' }}>
                    <div style={{ fontSize: 11, color: vencido ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>Fecha vencimiento</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: vencido ? 'var(--at-danger)' : 'var(--at-ink-2)' }}>{selected.fecha_vencimiento}{vencido ? ' ⚠ VENCIDO' : ''}</div>
                  </div>
                )}
                {selected.proxima_inspeccion && (
                  <div style={{ background: 'var(--at-accent-tint)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-accent)' }}>Próxima inspección</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--at-accent)' }}>{selected.proxima_inspeccion}</div>
                  </div>
                )}
                {selected.empresa_servicio && (
                  <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Empresa</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.empresa_servicio}</div>
                  </div>
                )}
                {selected.tecnico && (
                  <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Técnico</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.tecnico}</div>
                  </div>
                )}
                {selected.costo != null && (
                  <div style={{ background: 'var(--at-success-tint)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-success)' }}>Costo</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--at-success)' }}>{moneda} {selected.costo.toLocaleString()}</div>
                  </div>
                )}
              </div>

              {selected.observaciones && (
                <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--at-warning-strong)' }}>
                  {selected.observaciones}
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div>
            {(vencidosHoy.length > 0 || proximosVencer.length > 0) && (
              <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--at-danger)', marginBottom: 6 }}>🚨 Atención requerida</div>
                {vencidosHoy.map(r => <div key={r.id} style={{ fontSize: 12, color: 'var(--at-ink-2)', marginBottom: 2 }}>⚠ {r.identificador} — vencido ({r.fecha_vencimiento})</div>)}
                {proximosVencer.filter(r => !vencidosHoy.find(v => v.id === r.id)).map(r => <div key={r.id} style={{ fontSize: 12, color: 'var(--at-ink-2)', marginBottom: 2 }}>⏰ {r.identificador} — vence pronto ({r.fecha_vencimiento})</div>)}
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
