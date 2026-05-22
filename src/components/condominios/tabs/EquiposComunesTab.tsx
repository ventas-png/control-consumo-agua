import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { EquipoComun, CategoriaEquipo, EstadoEquipo } from '../../../types'

interface Props {
  equipos: EquipoComun[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaEquipo; label: string; icon: string }[] = [
  { value: 'bomba', label: 'Bomba', icon: '💧' },
  { value: 'ascensor', label: 'Ascensor', icon: '🛗' },
  { value: 'generador', label: 'Generador', icon: '⚡' },
  { value: 'camara', label: 'Cámara', icon: '📷' },
  { value: 'extintor', label: 'Extintor', icon: '🧯' },
  { value: 'planta_electrica', label: 'Planta eléctrica', icon: '🔌' },
  { value: 'otro', label: 'Otro', icon: '🔧' },
]

const ESTADOS: { value: EstadoEquipo; label: string; color: string }[] = [
  { value: 'operativo', label: 'Operativo', color: 'var(--at-success)' },
  { value: 'mantenimiento', label: 'En mantenimiento', color: 'var(--at-warning)' },
  { value: 'fuera_servicio', label: 'Fuera de servicio', color: 'var(--at-danger)' },
  { value: 'baja', label: 'De baja', color: 'var(--at-ink-3)' },
]

function diasParaManto(fecha?: string | null): number | null {
  if (!fecha) return null
  const diff = (new Date(fecha).getTime() - Date.now()) / 86400000
  return Math.round(diff)
}

function alertaManto(equipo: EquipoComun): 'vencido' | 'proximo' | 'ok' | 'sin_fecha' {
  const dias = diasParaManto(equipo.proximo_mantenimiento)
  if (dias === null) return 'sin_fecha'
  if (dias < 0) return 'vencido'
  if (dias <= 30) return 'proximo'
  return 'ok'
}

export default function EquiposComunesTab({ equipos, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<EquipoComun | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaEquipo | ''>('')
  const [filtroEstado, setFiltroEstado] = useState<EstadoEquipo | ''>('')

  const [form, setForm] = useState({
    nombre: '',
    categoria: 'otro' as CategoriaEquipo,
    marca: '',
    modelo: '',
    serial: '',
    ubicacion: '',
    fecha_compra: '',
    valor_compra: '',
    vida_util_anios: '',
    estado: 'operativo' as EstadoEquipo,
    ultimo_mantenimiento: '',
    proximo_mantenimiento: '',
    notas: '',
  })

  const lista = equipos.filter(e =>
    (filtroCategoria === '' || e.categoria === filtroCategoria) &&
    (filtroEstado === '' || e.estado === filtroEstado)
  )

  const alertas = equipos.filter(e => ['vencido', 'proximo'].includes(alertaManto(e)))

  async function guardar() {
    if (!form.nombre.trim()) { Swal.fire('Faltan datos', 'Nombre del equipo obligatorio', 'warning'); return }
    setSaving(true)
    const payload: Record<string, unknown> = {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre.trim(), categoria: form.categoria,
      marca: form.marca.trim() || null, modelo: form.modelo.trim() || null,
      serial: form.serial.trim() || null, ubicacion: form.ubicacion.trim() || null,
      fecha_compra: form.fecha_compra || null,
      valor_compra: form.valor_compra ? parseFloat(form.valor_compra) : null,
      vida_util_anios: form.vida_util_anios ? parseInt(form.vida_util_anios) : null,
      estado: form.estado,
      ultimo_mantenimiento: form.ultimo_mantenimiento || null,
      proximo_mantenimiento: form.proximo_mantenimiento || null,
      notas: form.notas.trim() || null,
    }
    const { error } = await supabase.from('equipos_comunes').insert(payload)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    resetForm()
    setMostrarForm(false)
    onRefresh()
  }

  async function actualizarEstado(equipo: EquipoComun, estado: EstadoEquipo) {
    const { error } = await supabase.from('equipos_comunes').update({ estado }).eq('id', equipo.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    if (selected?.id === equipo.id) setSelected(prev => prev ? { ...prev, estado } : null)
    onRefresh()
  }

  async function registrarMantenimiento(equipo: EquipoComun) {
    const { value: proxima } = await Swal.fire({
      title: 'Registrar mantenimiento',
      html: `<label style="display:block;margin-bottom:6px;font-size:13px">Fecha próximo mantenimiento:</label><input type="date" id="proxima" class="swal2-input" style="margin-top:0">`,
      showCancelButton: true, confirmButtonText: 'Guardar',
      preConfirm: () => (document.getElementById('proxima') as HTMLInputElement)?.value || null,
    })
    const { error } = await supabase.from('equipos_comunes').update({
      ultimo_mantenimiento: new Date().toISOString().split('T')[0],
      proximo_mantenimiento: proxima || null,
      estado: 'operativo' as EstadoEquipo,
    }).eq('id', equipo.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    if (selected?.id === equipo.id) {
      setSelected(prev => prev ? { ...prev, ultimo_mantenimiento: new Date().toISOString().split('T')[0], proximo_mantenimiento: proxima || undefined, estado: 'operativo' } : null)
    }
    onRefresh()
  }

  function resetForm() {
    setForm({ nombre: '', categoria: 'otro', marca: '', modelo: '', serial: '', ubicacion: '', fecha_compra: '', valor_compra: '', vida_util_anios: '', estado: 'operativo', ultimo_mantenimiento: '', proximo_mantenimiento: '', notas: '' })
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 320, borderRight: '1px solid var(--at-line)', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Equipos ({lista.length})</span>
            {canCreate && (
              <button onClick={() => { setMostrarForm(true); setSelected(null) }}
                style={{ padding: '5px 10px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Nuevo
              </button>
            )}
          </div>
          <select style={{ ...inp, marginBottom: 6 }} value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaEquipo | '')}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <select style={inp} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoEquipo | '')}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {/* Alertas */}
        {alertas.length > 0 && (
          <div style={{ padding: '8px 12px', background: 'var(--at-warning-tint)', borderBottom: '1px solid var(--at-warning-border)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-warning-strong)' }}>⚠️ {alertas.length} equipos requieren atención</div>
          </div>
        )}

        {lista.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin equipos</div>}

        {lista.map(e => {
          const cat = CATEGORIAS.find(c => c.value === e.categoria)
          const est = ESTADOS.find(s => s.value === e.estado)
          const alerta = alertaManto(e)
          const dias = diasParaManto(e.proximo_mantenimiento)
          return (
            <div key={e.id} onClick={() => { setSelected(e); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === e.id ? 'var(--at-accent-tint)' : 'var(--at-surface)', borderLeft: alerta === 'vencido' ? '3px solid var(--at-danger)' : alerta === 'proximo' ? '3px solid var(--at-warning)' : '3px solid transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{cat?.icon} {e.nombre}</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: est?.color + '20', color: est?.color }}>{est?.label}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
                {e.marca && <span>{e.marca} {e.modelo} · </span>}
                {e.ubicacion && <span>{e.ubicacion}</span>}
              </div>
              {dias !== null && (
                <div style={{ fontSize: 11, color: alerta === 'vencido' ? 'var(--at-danger)' : alerta === 'proximo' ? 'var(--at-warning)' : 'var(--at-ink-3)', marginTop: 2 }}>
                  {alerta === 'vencido' ? `⚠️ Manto vencido hace ${Math.abs(dias)} días` : alerta === 'proximo' ? `⏳ Manto en ${dias} días` : `Próx. manto: ${e.proximo_mantenimiento}`}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nuevo equipo</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Nombre *</label>
                <input style={inp} placeholder="Bomba de agua principal" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Categoría</label>
                <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaEquipo }))}>
                  {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Marca</label>
                <input style={inp} value={form.marca} onChange={e => setForm(p => ({ ...p, marca: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Modelo</label>
                <input style={inp} value={form.modelo} onChange={e => setForm(p => ({ ...p, modelo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Serial</label>
                <input style={inp} value={form.serial} onChange={e => setForm(p => ({ ...p, serial: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Ubicación</label>
                <input style={inp} placeholder="Cuarto de máquinas, Piso 1…" value={form.ubicacion} onChange={e => setForm(p => ({ ...p, ubicacion: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha de compra</label>
                <input type="date" style={inp} value={form.fecha_compra} onChange={e => setForm(p => ({ ...p, fecha_compra: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Valor compra ({moneda})</label>
                <input type="number" style={inp} value={form.valor_compra} onChange={e => setForm(p => ({ ...p, valor_compra: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Vida útil (años)</label>
                <input type="number" style={inp} value={form.vida_util_anios} onChange={e => setForm(p => ({ ...p, vida_util_anios: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Estado</label>
                <select style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoEquipo }))}>
                  {ESTADOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Último mantenimiento</label>
                <input type="date" style={inp} value={form.ultimo_mantenimiento} onChange={e => setForm(p => ({ ...p, ultimo_mantenimiento: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Próximo mantenimiento</label>
                <input type="date" style={inp} value={form.proximo_mantenimiento} onChange={e => setForm(p => ({ ...p, proximo_mantenimiento: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Notas</label>
                <textarea style={{ ...inp, height: 60, resize: 'vertical' }} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Guardar equipo'}
              </button>
              <button onClick={() => { setMostrarForm(false); resetForm() }}
                style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!mostrarForm && selected && (() => {
          const cat = CATEGORIAS.find(c => c.value === selected.categoria)
          const est = ESTADOS.find(s => s.value === selected.estado)
          const alerta = alertaManto(selected)
          const dias = diasParaManto(selected.proximo_mantenimiento)
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 20 }}>{cat?.icon} {selected.nombre}</div>
                  <div style={{ fontSize: 13, color: 'var(--at-ink-3)', marginTop: 4 }}>
                    {selected.marca && <span>{selected.marca} {selected.modelo} · </span>}
                    {selected.ubicacion && <span>{selected.ubicacion}</span>}
                  </div>
                </div>
                <span style={{ padding: '4px 12px', borderRadius: 12, background: est?.color + '20', color: est?.color, fontWeight: 600, fontSize: 13 }}>{est?.label}</span>
              </div>

              {/* Alerta mantenimiento */}
              {alerta !== 'ok' && alerta !== 'sin_fecha' && (
                <div style={{ background: alerta === 'vencido' ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)', border: `1px solid ${alerta === 'vencido' ? 'var(--at-danger-border)' : 'var(--at-warning-border)'}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, color: alerta === 'vencido' ? 'var(--at-danger)' : 'var(--at-warning-strong)', fontSize: 13 }}>
                    {alerta === 'vencido' ? `⚠️ Mantenimiento vencido hace ${Math.abs(dias!)} días` : `⏳ Mantenimiento en ${dias} días (${selected.proximo_mantenimiento})`}
                  </div>
                </div>
              )}

              {/* Datos */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {[
                  { label: 'Categoría', value: `${cat?.icon} ${cat?.label}` },
                  { label: 'Serial', value: selected.serial || '—' },
                  { label: 'Fecha compra', value: selected.fecha_compra || '—' },
                  { label: `Valor compra (${moneda})`, value: selected.valor_compra != null ? selected.valor_compra.toLocaleString() : '—' },
                  { label: 'Vida útil', value: selected.vida_util_anios ? `${selected.vida_util_anios} años` : '—' },
                  { label: 'Último mantenimiento', value: selected.ultimo_mantenimiento || '—' },
                  { label: 'Próximo mantenimiento', value: selected.proximo_mantenimiento || '—' },
                ].map(d => (
                  <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 6, padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{d.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{d.value}</div>
                  </div>
                ))}
              </div>

              {selected.notas && (
                <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Notas</div>
                  {selected.notas}
                </div>
              )}

              {canEdit && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => registrarMantenimiento(selected)}
                    style={{ padding: '7px 14px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                    🔧 Registrar mantenimiento
                  </button>
                  {ESTADOS.filter(s => s.value !== selected.estado).map(s => (
                    <button key={s.value} onClick={() => actualizarEstado(selected, s.value)}
                      style={{ padding: '7px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      → {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--at-ink-3)', fontSize: 14 }}>
            Selecciona un equipo o registra uno nuevo
          </div>
        )}
      </div>
    </div>
  )
}
