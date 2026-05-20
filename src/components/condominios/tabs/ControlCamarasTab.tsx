import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { ControlCamaraSeguridad, TipoCamara, EstadoCamara } from '../../../types'

interface Props {
  camaras: ControlCamaraSeguridad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoCamara; label: string; icon: string }[] = [
  { value: 'domo',    label: 'Domo',    icon: '🔵' },
  { value: 'bullet',  label: 'Bullet',  icon: '🔷' },
  { value: 'ptz',     label: 'PTZ',     icon: '🔄' },
  { value: 'fisheye', label: 'Fisheye', icon: '👁️' },
  { value: 'otro',    label: 'Otro',    icon: '📷' },
]

const ESTADOS: { value: EstadoCamara; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'activa',        label: 'Activa',         color: '#10b981', bg: '#d1fae5', icon: '✅' },
  { value: 'falla',         label: 'Falla',          color: '#ef4444', bg: '#fef2f2', icon: '⚠️' },
  { value: 'mantenimiento', label: 'Mantenimiento',  color: '#f59e0b', bg: '#fef3c7', icon: '🔧' },
  { value: 'sin_señal',     label: 'Sin señal',      color: '#B96A3F', bg: '#F4EBE3', icon: '📵' },
  { value: 'inactiva',      label: 'Inactiva',       color: '#7E9389', bg: '#EAE6D8', icon: '⭕' },
]

export default function ControlCamarasTab({ camaras, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<ControlCamaraSeguridad | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoCamara | ''>('')
  const [soloActivas, setSoloActivas] = useState(true)

  const [form, setForm] = useState({
    codigo: '', nombre: '', ubicacion: '',
    tipo: 'domo' as TipoCamara,
    resolucion: '1080p', ip_address: '',
    grabacion: true, dias_retencion: '30',
    estado: 'activa' as EstadoCamara,
    ultimo_mantenimiento: '', proximo_mantenimiento: '',
    observaciones: '',
  })

  const lista = camaras.filter(c =>
    (!soloActivas || c.activo) &&
    (filtroEstado === '' || c.estado === filtroEstado)
  )

  const porEstado = ESTADOS.map(e => ({ ...e, count: camaras.filter(c => c.estado === e.value && c.activo).length }))
  const totalActivas = camaras.filter(c => c.estado === 'activa').length
  const totalFallas = camaras.filter(c => c.estado === 'falla' || c.estado === 'sin_señal').length

  function resetForm() {
    setForm({ codigo: '', nombre: '', ubicacion: '', tipo: 'domo', resolucion: '1080p', ip_address: '', grabacion: true, dias_retencion: '30', estado: 'activa', ultimo_mantenimiento: '', proximo_mantenimiento: '', observaciones: '' })
  }

  function iniciarEdicion(c: ControlCamaraSeguridad) {
    setForm({
      codigo: c.codigo, nombre: c.nombre, ubicacion: c.ubicacion,
      tipo: c.tipo, resolucion: c.resolucion ?? '', ip_address: c.ip_address ?? '',
      grabacion: c.grabacion, dias_retencion: c.dias_retencion?.toString() ?? '',
      estado: c.estado,
      ultimo_mantenimiento: c.ultimo_mantenimiento ?? '',
      proximo_mantenimiento: c.proximo_mantenimiento ?? '',
      observaciones: c.observaciones ?? '',
    })
    setEditando(true)
    setMostrarForm(true)
  }

  async function guardar() {
    if (!form.codigo.trim() || !form.nombre.trim() || !form.ubicacion.trim()) {
      Swal.fire('Faltan datos', 'Código, nombre y ubicación son obligatorios', 'warning'); return
    }
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      codigo: form.codigo.trim(), nombre: form.nombre.trim(), ubicacion: form.ubicacion.trim(),
      tipo: form.tipo, resolucion: form.resolucion.trim() || null,
      ip_address: form.ip_address.trim() || null, grabacion: form.grabacion,
      dias_retencion: form.dias_retencion ? parseInt(form.dias_retencion) : null,
      estado: form.estado,
      ultimo_mantenimiento: form.ultimo_mantenimiento || null,
      proximo_mantenimiento: form.proximo_mantenimiento || null,
      observaciones: form.observaciones.trim() || null,
    }
    let error
    if (editando && selected) {
      const res = await supabase.from('control_camaras_seguridad').update(payload).eq('id', selected.id)
      error = res.error
    } else {
      const res = await supabase.from('control_camaras_seguridad').insert(payload)
      error = res.error
    }
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    resetForm(); setMostrarForm(false); setEditando(false)
    onRefresh()
  }

  async function cambiarEstado(c: ControlCamaraSeguridad, estado: EstadoCamara) {
    await supabase.from('control_camaras_seguridad').update({ estado }).eq('id', c.id)
    if (selected?.id === c.id) setSelected(prev => prev ? { ...prev, estado } : null)
    onRefresh()
  }

  async function toggleActivo(c: ControlCamaraSeguridad) {
    await supabase.from('control_camaras_seguridad').update({ activo: !c.activo }).eq('id', c.id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#7E9389', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 300, borderRight: '1px solid var(--at-line)', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Cámaras ({lista.length})</span>
              {totalFallas > 0 && <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 10, background: '#fef2f2', color: '#ef4444', fontWeight: 700 }}>{totalFallas} falla{totalFallas > 1 ? 's' : ''}</span>}
            </div>
            {canCreate && (
              <button onClick={() => { resetForm(); setEditando(false); setMostrarForm(true); setSelected(null) }}
                style={{ padding: '5px 10px', background: '#B96A3F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Nueva
              </button>
            )}
          </div>
          {/* KPI mini */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {porEstado.filter(e => e.count > 0).map(e => (
              <span key={e.value} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: e.bg, color: e.color, fontWeight: 600 }}>
                {e.icon} {e.count}
              </span>
            ))}
          </div>
          <select style={{ ...inp, marginBottom: 6 }} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoCamara | '')}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={soloActivas} onChange={e => setSoloActivas(e.target.checked)} />
            Solo activas
          </label>
        </div>

        {lista.length === 0 && <div style={{ textAlign: 'center', color: '#7E9389', padding: '32px 16px', fontSize: 13 }}>Sin cámaras</div>}

        {lista.map(c => {
          const tipo = TIPOS.find(t => t.value === c.tipo)
          const est = ESTADOS.find(e => e.value === c.estado)
          return (
            <div key={c.id} onClick={() => { setSelected(c); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === c.id ? '#F4EBE3' : '#fff', borderLeft: `3px solid ${est?.color}`, opacity: c.activo ? 1 : 0.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{tipo?.icon} {c.codigo} — {c.nombre}</span>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: est?.bg, color: est?.color }}>{est?.icon}</span>
              </div>
              <div style={{ fontSize: 11, color: '#7E9389', marginTop: 2 }}>📍 {c.ubicacion}</div>
              <div style={{ fontSize: 11, color: '#7E9389', marginTop: 1 }}>
                {c.resolucion && <span>{c.resolucion} · </span>}
                {c.grabacion ? '🔴 Grab.' : '⭕ Sin grab.'}
                {c.dias_retencion && <span> · {c.dias_retencion}d</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>{editando ? 'Editar cámara' : 'Nueva cámara'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Código *</label>
                <input style={inp} placeholder="CAM-001" value={form.codigo} onChange={e => setForm(p => ({ ...p, codigo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Nombre *</label>
                <input style={inp} placeholder="Entrada principal" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Tipo</label>
                <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoCamara }))}>
                  {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Ubicación *</label>
                <input style={inp} placeholder="Lobby, Estacionamiento nivel 1…" value={form.ubicacion} onChange={e => setForm(p => ({ ...p, ubicacion: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Estado</label>
                <select style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoCamara }))}>
                  {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Resolución</label>
                <input style={inp} placeholder="1080p, 4K…" value={form.resolucion} onChange={e => setForm(p => ({ ...p, resolucion: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>IP address</label>
                <input style={inp} placeholder="192.168.1.10" value={form.ip_address} onChange={e => setForm(p => ({ ...p, ip_address: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Retención (días)</label>
                <input type="number" style={inp} value={form.dias_retencion} onChange={e => setForm(p => ({ ...p, dias_retencion: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Último mantenimiento</label>
                <input type="date" style={inp} value={form.ultimo_mantenimiento} onChange={e => setForm(p => ({ ...p, ultimo_mantenimiento: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Próximo mantenimiento</label>
                <input type="date" style={inp} value={form.proximo_mantenimiento} onChange={e => setForm(p => ({ ...p, proximo_mantenimiento: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                <input type="checkbox" id="grab_check" checked={form.grabacion} onChange={e => setForm(p => ({ ...p, grabacion: e.target.checked }))} />
                <label htmlFor="grab_check" style={{ fontSize: 13, cursor: 'pointer' }}>🔴 Grabación activa</label>
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Observaciones</label>
                <input style={inp} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : `✅ ${editando ? 'Actualizar' : 'Registrar'}`}
              </button>
              <button onClick={() => { setMostrarForm(false); setEditando(false); resetForm() }}
                style={{ padding: '8px 16px', background: '#EAE6D8', color: '#3E5A4C', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
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
                  <div style={{ fontSize: 12, color: '#7E9389', fontWeight: 600, marginBottom: 4 }}>{tipo?.icon} {tipo?.label} · {selected.codigo}</div>
                  <div style={{ fontWeight: 700, fontSize: 20 }}>📷 {selected.nombre}</div>
                  <div style={{ fontSize: 13, color: '#7E9389', marginTop: 4 }}>📍 {selected.ubicacion}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, background: est?.bg, color: est?.color, fontWeight: 600 }}>{est?.icon} {est?.label}</span>
                  {!selected.activo && <span style={{ fontSize: 11, color: '#7E9389' }}>Inactiva</span>}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                <div style={{ background: '#FAF7EF', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 11, color: '#7E9389' }}>Resolución</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{selected.resolucion ?? '—'}</div>
                </div>
                <div style={{ background: selected.grabacion ? '#fef2f2' : '#EAE6D8', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 11, color: '#7E9389' }}>Grabación</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: selected.grabacion ? '#ef4444' : '#7E9389' }}>{selected.grabacion ? '🔴 Activa' : '⭕ Inactiva'}</div>
                </div>
                <div style={{ background: '#FAF7EF', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 11, color: '#7E9389' }}>Retención</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{selected.dias_retencion ? `${selected.dias_retencion} días` : '—'}</div>
                </div>
                {selected.ip_address && (
                  <div style={{ background: '#FAF7EF', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#7E9389' }}>IP</div>
                    <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>{selected.ip_address}</div>
                  </div>
                )}
                {selected.ultimo_mantenimiento && (
                  <div style={{ background: '#FAF7EF', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#7E9389' }}>Último manto.</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.ultimo_mantenimiento}</div>
                  </div>
                )}
                {selected.proximo_mantenimiento && (
                  <div style={{ background: '#F4EBE3', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#B96A3F' }}>Próximo manto.</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#B96A3F' }}>{selected.proximo_mantenimiento}</div>
                  </div>
                )}
              </div>

              {selected.observaciones && (
                <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
                  {selected.observaciones}
                </div>
              )}

              {canEdit && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => iniciarEdicion(selected)}
                    style={{ padding: '6px 12px', background: '#EAE6D8', color: '#3E5A4C', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    ✏️ Editar
                  </button>
                  {selected.estado !== 'activa' && (
                    <button onClick={() => cambiarEstado(selected, 'activa')}
                      style={{ padding: '6px 12px', background: '#d1fae5', color: '#10b981', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      ✅ Marcar activa
                    </button>
                  )}
                  {selected.estado === 'activa' && (
                    <button onClick={() => cambiarEstado(selected, 'falla')}
                      style={{ padding: '6px 12px', background: '#fef2f2', color: '#ef4444', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      ⚠️ Reportar falla
                    </button>
                  )}
                  <button onClick={() => toggleActivo(selected)}
                    style={{ padding: '6px 12px', background: '#EAE6D8', color: '#7E9389', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    {selected.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
              <div style={{ background: '#d1fae5', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981' }}>{totalActivas}</div>
                <div style={{ fontSize: 11, color: '#10b981' }}>Activas</div>
              </div>
              <div style={{ background: totalFallas > 0 ? '#fef2f2' : '#EAE6D8', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: totalFallas > 0 ? '#ef4444' : '#7E9389' }}>{totalFallas}</div>
                <div style={{ fontSize: 11, color: totalFallas > 0 ? '#ef4444' : '#7E9389' }}>Con fallas</div>
              </div>
              <div style={{ background: '#F4EBE3', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#B96A3F' }}>{camaras.length}</div>
                <div style={{ fontSize: 11, color: '#B96A3F' }}>Total registradas</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: '#7E9389', fontSize: 14 }}>
              Selecciona una cámara o registra una nueva
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
