import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { MantenimientoJardineria, TipoJardineria, EstadoJardineria } from '../../../types'

interface Props {
  registros: MantenimientoJardineria[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoJardineria; label: string; icon: string; color: string }[] = [
  { value: 'mantenimiento_general', label: 'Mant. general', icon: '🌿', color: '#10b981' },
  { value: 'poda',                  label: 'Poda',          icon: '✂️', color: 'var(--at-accent)' },
  { value: 'fumigacion',            label: 'Fumigación',    icon: '🧪', color: '#f59e0b' },
  { value: 'siembra',               label: 'Siembra',       icon: '🌱', color: '#22c55e' },
  { value: 'riego',                 label: 'Riego',         icon: '💧', color: 'var(--at-accent-2)' },
  { value: 'limpieza',              label: 'Limpieza',      icon: '🧹', color: 'var(--at-accent)' },
  { value: 'otro',                  label: 'Otro',          icon: '📋', color: 'var(--at-ink-3)' },
]

const ESTADOS: { value: EstadoJardineria; label: string; color: string; bg: string }[] = [
  { value: 'programado',  label: 'Programado', color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  { value: 'en_proceso',  label: 'En proceso', color: '#f59e0b', bg: '#fef3c7' },
  { value: 'completado',  label: 'Completado', color: '#10b981', bg: '#d1fae5' },
  { value: 'cancelado',   label: 'Cancelado',  color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
]

const AREAS_COMUNES = ['Jardín principal', 'Jardín lateral', 'Área de piscina', 'Acceso vehicular', 'Acceso peatonal', 'Área de juegos', 'Área BBQ', 'Estacionamiento', 'Perímetro', 'Terraza']

export default function MantenimientoJardineriaTab({ registros, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<MantenimientoJardineria | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<TipoJardineria | ''>('')
  const [filtroEstado, setFiltroEstado] = useState<EstadoJardineria | ''>('')
  const [areaCustom, setAreaCustom] = useState('')

  const [form, setForm] = useState({
    fecha: new Date().toISOString().split('T')[0],
    tipo: 'mantenimiento_general' as TipoJardineria,
    areas: [] as string[],
    proveedor: '', trabajadores: '', horas_trabajo: '',
    insumos: '', costo: '', estado: 'completado' as EstadoJardineria,
    proxima_visita: '', observaciones: '',
  })

  const lista = registros.filter(r =>
    (filtroTipo === '' || r.tipo === filtroTipo) &&
    (filtroEstado === '' || r.estado === filtroEstado)
  )

  const totalCosto = registros.filter(r => r.estado === 'completado' && r.costo).reduce((s, r) => s + (r.costo ?? 0), 0)
  const proximos = registros.filter(r => r.proxima_visita && new Date(r.proxima_visita) >= new Date()).sort((a, b) => a.proxima_visita!.localeCompare(b.proxima_visita!))

  function toggleArea(area: string) {
    setForm(p => ({
      ...p,
      areas: p.areas.includes(area) ? p.areas.filter(a => a !== area) : [...p.areas, area],
    }))
  }

  function agregarAreaCustom() {
    const a = areaCustom.trim()
    if (!a || form.areas.includes(a)) return
    setForm(p => ({ ...p, areas: [...p.areas, a] }))
    setAreaCustom('')
  }

  async function guardar() {
    if (!form.fecha || form.areas.length === 0) {
      Swal.fire('Faltan datos', 'Fecha y al menos un área son obligatorios', 'warning'); return
    }
    setSaving(true)
    const { error } = await supabase.from('mantenimiento_jardineria').insert({
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, tipo: form.tipo, areas: form.areas,
      proveedor: form.proveedor.trim() || null,
      trabajadores: form.trabajadores ? parseInt(form.trabajadores) : null,
      horas_trabajo: form.horas_trabajo ? parseFloat(form.horas_trabajo) : null,
      insumos: form.insumos.trim() || null,
      costo: form.costo ? parseFloat(form.costo) : null,
      estado: form.estado,
      proxima_visita: form.proxima_visita || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm({ fecha: new Date().toISOString().split('T')[0], tipo: 'mantenimiento_general', areas: [], proveedor: '', trabajadores: '', horas_trabajo: '', insumos: '', costo: '', estado: 'completado', proxima_visita: '', observaciones: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function cambiarEstado(r: MantenimientoJardineria, estado: EstadoJardineria) {
    await supabase.from('mantenimiento_jardineria').update({ estado }).eq('id', r.id)
    if (selected?.id === r.id) setSelected(prev => prev ? { ...prev, estado } : null)
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
            <span style={{ fontWeight: 600, fontSize: 14 }}>Jardinería ({lista.length})</span>
            {canCreate && (
              <button onClick={() => { setMostrarForm(true); setSelected(null) }}
                style={{ padding: '5px 10px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Nuevo
              </button>
            )}
          </div>
          <select style={{ ...inp, marginBottom: 6 }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoJardineria | '')}>
            <option value="">Todos los tipos</option>
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          <select style={inp} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoJardineria | '')}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>

        {proximos.length > 0 && (
          <div style={{ padding: '8px 12px', background: '#f0fdf4', borderBottom: '1px solid var(--at-line)' }}>
            <div style={{ fontSize: 10, color: '#16a34a', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase' }}>📅 Próximas visitas</div>
            {proximos.slice(0, 3).map(r => {
              const tipo = TIPOS.find(t => t.value === r.tipo)
              return (
                <div key={r.id} style={{ fontSize: 11, color: 'var(--at-ink-2)', marginBottom: 2 }}>
                  {tipo?.icon} {r.proxima_visita} · {tipo?.label}
                  {r.proveedor && <span style={{ color: 'var(--at-ink-3)' }}> · {r.proveedor}</span>}
                </div>
              )
            })}
          </div>
        )}

        {lista.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin registros</div>}

        {lista.map(r => {
          const tipo = TIPOS.find(t => t.value === r.tipo)
          const est = ESTADOS.find(e => e.value === r.estado)
          return (
            <div key={r.id} onClick={() => { setSelected(r); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === r.id ? '#f0fdf4' : '#fff', borderLeft: `3px solid ${tipo?.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{tipo?.icon} {tipo?.label}</span>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: est?.bg, color: est?.color }}>{est?.label}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{r.fecha}{r.proveedor ? ` · ${r.proveedor}` : ''}</div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{r.areas.slice(0, 2).join(', ')}{r.areas.length > 2 ? ` +${r.areas.length - 2}` : ''}</div>
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {!mostrarForm && !selected && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ fontSize: 11, color: '#16a34a' }}>Costo total (completados)</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>{moneda} {totalCosto.toLocaleString()}</div>
              </div>
              <div style={{ background: 'var(--at-accent-tint)', borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ fontSize: 11, color: 'var(--at-accent)' }}>Total registros</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-accent)' }}>{registros.length}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'var(--at-ink-3)', fontSize: 14 }}>
              Selecciona un registro o crea uno nuevo
            </div>
          </div>
        )}

        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nuevo servicio de jardinería</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Fecha *</label>
                <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Tipo</label>
                <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoJardineria }))}>
                  {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Estado</label>
                <select style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoJardineria }))}>
                  {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Proveedor</label>
                <input style={inp} placeholder="Empresa o persona" value={form.proveedor} onChange={e => setForm(p => ({ ...p, proveedor: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Trabajadores</label>
                <input type="number" style={inp} value={form.trabajadores} onChange={e => setForm(p => ({ ...p, trabajadores: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Horas trabajo</label>
                <input type="number" step="0.5" style={inp} value={form.horas_trabajo} onChange={e => setForm(p => ({ ...p, horas_trabajo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Costo ({moneda})</label>
                <input type="number" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Próxima visita</label>
                <input type="date" style={inp} value={form.proxima_visita} onChange={e => setForm(p => ({ ...p, proxima_visita: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Insumos usados</label>
                <input style={inp} placeholder="Fertilizante, herbicida…" value={form.insumos} onChange={e => setForm(p => ({ ...p, insumos: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Áreas tratadas *</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {AREAS_COMUNES.map(a => (
                    <button key={a} type="button" onClick={() => toggleArea(a)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid', fontSize: 11, cursor: 'pointer', background: form.areas.includes(a) ? '#22c55e' : '#fff', color: form.areas.includes(a) ? '#fff' : 'var(--at-ink-2)', borderColor: form.areas.includes(a) ? '#22c55e' : 'var(--at-line-strong)' }}>
                      {a}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...inp, flex: 1 }} placeholder="Agregar área personalizada" value={areaCustom} onChange={e => setAreaCustom(e.target.value)} onKeyDown={e => e.key === 'Enter' && agregarAreaCustom()} />
                  <button type="button" onClick={agregarAreaCustom} style={{ padding: '7px 12px', background: 'var(--at-chip)', border: '1px solid var(--at-line-strong)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>+</button>
                </div>
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Observaciones</label>
                <input style={inp} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
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
          const tipo = TIPOS.find(t => t.value === selected.tipo)
          const est = ESTADOS.find(e => e.value === selected.estado)
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: tipo?.color, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase' }}>{tipo?.icon} {tipo?.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{selected.fecha}</div>
                  {selected.proveedor && <div style={{ fontSize: 13, color: 'var(--at-ink-3)', marginTop: 4 }}>🤝 {selected.proveedor}</div>}
                </div>
                <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, background: est?.bg, color: est?.color, fontWeight: 600 }}>{est?.label}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                {selected.trabajadores != null && (
                  <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Trabajadores</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{selected.trabajadores}</div>
                  </div>
                )}
                {selected.horas_trabajo != null && (
                  <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Horas</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{selected.horas_trabajo}h</div>
                  </div>
                )}
                {selected.costo != null && (
                  <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#16a34a' }}>Costo</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#16a34a' }}>{moneda} {selected.costo.toLocaleString()}</div>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 6 }}>ÁREAS TRATADAS</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selected.areas.map(a => (
                    <span key={a} style={{ padding: '3px 10px', background: '#f0fdf4', color: '#16a34a', borderRadius: 6, fontSize: 12, border: '1px solid #bbf7d0' }}>{a}</span>
                  ))}
                </div>
              </div>

              {selected.insumos && (
                <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
                  <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Insumos: </span>{selected.insumos}
                </div>
              )}

              {selected.proxima_visita && (
                <div style={{ background: 'var(--at-accent-tint)', border: '1px solid var(--at-accent-soft)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--at-accent)' }}>
                  📅 Próxima visita: <strong>{selected.proxima_visita}</strong>
                </div>
              )}

              {selected.observaciones && (
                <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--at-ink-2)', marginBottom: 12 }}>
                  {selected.observaciones}
                </div>
              )}

              {canEdit && selected.estado !== 'completado' && (
                <button onClick={() => cambiarEstado(selected, 'completado')}
                  style={{ padding: '6px 14px', background: '#d1fae5', color: '#10b981', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                  ✓ Marcar completado
                </button>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
