import { useState, useMemo } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import { AsambleaDigital, Unidad } from '../../../types'

interface Props {
  asambleas: AsambleaDigital[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

type EstadoA = AsambleaDigital['estado']
type Modalidad = AsambleaDigital['modalidad']

const ESTADO_CFG: Record<EstadoA, { label: string; color: string; bg: string }> = {
  programada: { label: 'Programada', color: '#1B3B36', bg: '#EEF2EC' },
  en_curso:   { label: 'En curso',   color: '#16a34a', bg: '#dcfce7' },
  finalizada: { label: 'Finalizada', color: '#7E9389', bg: '#EAE6D8' },
  cancelada:  { label: 'Cancelada',  color: '#ef4444', bg: '#fef2f2' },
}

const MODALIDAD_CFG: Record<Modalidad, { label: string; icon: string }> = {
  presencial: { label: 'Presencial', icon: '🏛️' },
  virtual:    { label: 'Virtual',    icon: '💻' },
  hibrida:    { label: 'Híbrida',    icon: '🔀' },
}

const BLANK = {
  titulo: '', descripcion: '', fecha_hora: '', modalidad: 'presencial' as Modalidad,
  link_reunion: '', quorum_requerido: '50',
}

export default function AsambleaDigitalTab({ asambleas, unidades, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoA | ''>('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [expandida, setExpandida] = useState<string | null>(null)
  const [subTab, setSubTab] = useState<'lista' | 'acta'>('lista')
  const [actaAsamblea, setActaAsamblea] = useState<AsambleaDigital | null>(null)
  const [actaTexto, setActaTexto] = useState('')
  const [savingActa, setSavingActa] = useState(false)

  const filtradas = filtroEstado ? asambleas.filter(a => a.estado === filtroEstado) : asambleas
  const conteos = useMemo(() => ({
    programada: asambleas.filter(a => a.estado === 'programada').length,
    en_curso:   asambleas.filter(a => a.estado === 'en_curso').length,
    finalizada: asambleas.filter(a => a.estado === 'finalizada').length,
    cancelada:  asambleas.filter(a => a.estado === 'cancelada').length,
  }), [asambleas])

  function resetForm() {
    setForm({ ...BLANK })
    setEditId(null)
    setShowForm(false)
  }

  function abrirEditar(a: AsambleaDigital) {
    setForm({
      titulo: a.titulo,
      descripcion: a.descripcion ?? '',
      fecha_hora: a.fecha_hora?.slice(0, 16) ?? '',
      modalidad: a.modalidad,
      link_reunion: a.link_reunion ?? '',
      quorum_requerido: String(a.quorum_requerido),
    })
    setEditId(a.id)
    setShowForm(true)
  }

  async function guardar() {
    if (!form.titulo.trim() || !form.fecha_hora) {
      return Swal.fire({ icon: 'warning', title: 'Faltan datos', text: 'Título y fecha son obligatorios.', confirmButtonColor: '#1B3B36' })
    }
    setSaving(true)
    const payload = {
      company_id: companyId,
      project_id: proyectoId,
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
      fecha_hora: new Date(form.fecha_hora).toISOString(),
      modalidad: form.modalidad,
      link_reunion: form.link_reunion.trim() || null,
      quorum_requerido: parseInt(form.quorum_requerido) || 50,
    }
    const { error } = editId
      ? await supabase.from('asambleas_digital').update(payload).eq('id', editId)
      : await supabase.from('asambleas_digital').insert({ ...payload, estado: 'programada', created_by: userId })
    setSaving(false)
    if (error) return Swal.fire({ icon: 'error', title: 'Error', text: error.message, confirmButtonColor: '#1B3B36' })
    resetForm()
    onRefresh()
  }

  async function cambiarEstado(a: AsambleaDigital, nuevoEstado: EstadoA) {
    const { error } = await supabase.from('asambleas_digital').update({ estado: nuevoEstado }).eq('id', a.id)
    if (error) return Swal.fire({ icon: 'error', title: 'Error', text: error.message, confirmButtonColor: '#1B3B36' })
    onRefresh()
  }

  async function eliminar(a: AsambleaDigital) {
    const res = await Swal.fire({ icon: 'warning', title: '¿Eliminar asamblea?', text: a.titulo, showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonText: 'Cancelar', confirmButtonText: 'Eliminar' })
    if (!res.isConfirmed) return
    await supabase.from('asambleas_digital').delete().eq('id', a.id)
    onRefresh()
  }

  function abrirActa(a: AsambleaDigital) {
    setActaAsamblea(a)
    setActaTexto(a.acta_url ?? '')
    setSubTab('acta')
  }

  async function guardarActa() {
    if (!actaAsamblea) return
    setSavingActa(true)
    const { error } = await supabase.from('asambleas_digital').update({ acta_url: actaTexto.trim() || null }).eq('id', actaAsamblea.id)
    setSavingActa(false)
    if (error) return Swal.fire({ icon: 'error', title: 'Error', text: error.message, confirmButtonColor: '#1B3B36' })
    Swal.fire({ icon: 'success', title: 'Acta guardada', timer: 1500, showConfirmButton: false })
    setSubTab('lista')
    onRefresh()
  }

  function imprimirActa(a: AsambleaDigital) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Acta — ${a.titulo}</title>
    <style>body{font-family:Arial,sans-serif;padding:40px;max-width:800px;margin:auto}
    h1{font-size:22px;color:var(--at-ink)}h2{font-size:14px;color:var(--at-ink-3);font-weight:normal}
    .meta{background:var(--at-surface-2);padding:12px;border-radius:8px;margin:16px 0;font-size:12px}
    pre{white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.6}
    .footer{margin-top:40px;border-top:1px solid var(--at-line);padding-top:12px;font-size:11px;color:var(--at-ink-3)}
    </style></head><body>
    <h1>ACTA DE ASAMBLEA</h1>
    <h2>${a.titulo}</h2>
    <div class="meta">
      <b>Fecha:</b> ${new Date(a.fecha_hora).toLocaleString('es')}<br>
      <b>Modalidad:</b> ${MODALIDAD_CFG[a.modalidad].label}<br>
      <b>Quórum requerido:</b> ${a.quorum_requerido}%<br>
      <b>Estado:</b> ${ESTADO_CFG[a.estado].label}
    </div>
    <pre>${a.acta_url ?? '(Sin acta registrada)'}</pre>
    <div class="footer">Documento generado el ${new Date().toLocaleString('es')}</div>
    </body></html>`
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  return (
    <div style={{ padding: 16 }}>
      {/* sub-tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['lista', 'acta'] as const).map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            style={{ padding: '5px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: subTab === t ? 700 : 400, background: subTab === t ? '#1B3B36' : '#EAE6D8', color: subTab === t ? '#fff' : '#3E5A4C', fontSize: 13 }}>
            {t === 'lista' ? 'Asambleas' : actaAsamblea ? `Acta — ${actaAsamblea.titulo.slice(0, 20)}…` : 'Acta'}
          </button>
        ))}
      </div>

      {subTab === 'acta' && actaAsamblea ? (
        <div>
          <button onClick={() => setSubTab('lista')} style={{ marginBottom: 12, padding: '4px 12px', border: '1px solid var(--at-line-strong)', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 12 }}>← Volver</button>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{actaAsamblea.titulo}</div>
          <div style={{ fontSize: 12, color: '#7E9389', marginBottom: 12 }}>{new Date(actaAsamblea.fecha_hora).toLocaleString('es')}</div>
          <textarea
            value={actaTexto}
            onChange={e => setActaTexto(e.target.value)}
            rows={16}
            placeholder="Escriba el acta completa de la asamblea: quórum, puntos tratados, acuerdos alcanzados, votaciones y cierre..."
            style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={guardarActa} disabled={savingActa}
              style={{ padding: '8px 20px', background: '#1B3B36', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
              {savingActa ? 'Guardando…' : '💾 Guardar acta'}
            </button>
            <button onClick={() => imprimirActa({ ...actaAsamblea, acta_url: actaTexto })}
              style={{ padding: '8px 16px', background: '#EAE6D8', color: '#3E5A4C', border: '1px solid var(--at-line-strong)', borderRadius: 8, cursor: 'pointer' }}>
              🖨️ Imprimir
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#15291F' }}>Asambleas Digitales</div>
            {canCreate && !showForm && (
              <button onClick={() => setShowForm(true)}
                style={{ padding: '7px 16px', background: '#1B3B36', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                + Nueva asamblea
              </button>
            )}
          </div>

          {/* KPI cards */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {(Object.entries(ESTADO_CFG) as [EstadoA, typeof ESTADO_CFG[EstadoA]][]).map(([est, cfg]) => (
              <div key={est} onClick={() => setFiltroEstado(filtroEstado === est ? '' : est)}
                style={{ padding: '8px 14px', background: filtroEstado === est ? cfg.bg : '#FAF7EF', border: `1px solid ${filtroEstado === est ? cfg.color : '#E1DDD0'}`, borderRadius: 10, cursor: 'pointer', minWidth: 90, textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: cfg.color }}>{conteos[est]}</div>
                <div style={{ fontSize: 10, color: '#7E9389' }}>{cfg.label}</div>
              </div>
            ))}
            <div style={{ padding: '8px 14px', background: '#FAF7EF', border: '1px solid var(--at-line)', borderRadius: 10, minWidth: 90, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#15291F' }}>{unidades.length}</div>
              <div style={{ fontSize: 10, color: '#7E9389' }}>Unidades</div>
            </div>
          </div>

          {/* Form */}
          {showForm && (
            <div style={{ background: '#FAF7EF', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#15291F' }}>{editId ? 'Editar asamblea' : 'Nueva asamblea'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, color: '#7E9389' }}>Título *</label>
                  <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                    placeholder="Ej: Asamblea Ordinaria Q1 2026"
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#7E9389' }}>Fecha y hora *</label>
                  <input type="datetime-local" value={form.fecha_hora} onChange={e => setForm(f => ({ ...f, fecha_hora: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#7E9389' }}>Modalidad</label>
                  <select value={form.modalidad} onChange={e => setForm(f => ({ ...f, modalidad: e.target.value as Modalidad }))}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3 }}>
                    <option value="presencial">🏛️ Presencial</option>
                    <option value="virtual">💻 Virtual</option>
                    <option value="hibrida">🔀 Híbrida</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#7E9389' }}>Quórum requerido (%)</label>
                  <input type="number" min="0" max="100" value={form.quorum_requerido} onChange={e => setForm(f => ({ ...f, quorum_requerido: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3 }} />
                </div>
                {(form.modalidad === 'virtual' || form.modalidad === 'hibrida') && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: 12, color: '#7E9389' }}>Link de reunión</label>
                    <input value={form.link_reunion} onChange={e => setForm(f => ({ ...f, link_reunion: e.target.value }))}
                      placeholder="https://meet.google.com/..."
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3 }} />
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, color: '#7E9389' }}>Descripción / Agenda</label>
                  <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                    rows={3} placeholder="Puntos a tratar en la asamblea..."
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3, resize: 'vertical' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={guardar} disabled={saving}
                  style={{ padding: '8px 20px', background: '#1B3B36', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                  {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Crear asamblea'}
                </button>
                <button onClick={resetForm} style={{ padding: '8px 16px', background: '#EAE6D8', color: '#3E5A4C', border: '1px solid var(--at-line-strong)', borderRadius: 8, cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}

          {/* List */}
          {filtradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#7E9389', fontSize: 13 }}>
              {filtroEstado ? `No hay asambleas con estado "${ESTADO_CFG[filtroEstado].label}".` : 'No hay asambleas registradas.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtradas.map(a => {
                const cfg = ESTADO_CFG[a.estado]
                const mod = MODALIDAD_CFG[a.modalidad]
                const exp = expandida === a.id
                return (
                  <div key={a.id} style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden' }}>
                    <div onClick={() => setExpandida(exp ? null : a.id)}
                      style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F' }}>{a.titulo}</div>
                        <div style={{ fontSize: 11, color: '#7E9389', marginTop: 2 }}>
                          {mod.icon} {mod.label} · {new Date(a.fecha_hora).toLocaleString('es')} · Quórum: {a.quorum_requerido}%
                        </div>
                      </div>
                      <span style={{ padding: '3px 10px', borderRadius: 20, background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 600 }}>{cfg.label}</span>
                      {a.acta_url && <span style={{ fontSize: 11, color: '#16a34a' }}>📝 Acta</span>}
                      <span style={{ fontSize: 11, color: '#7E9389' }}>{exp ? '▲' : '▼'}</span>
                    </div>

                    {exp && (
                      <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--at-chip)' }}>
                        {a.descripcion && (
                          <div style={{ fontSize: 12, color: '#3E5A4C', marginTop: 10, whiteSpace: 'pre-wrap' }}>{a.descripcion}</div>
                        )}
                        {a.link_reunion && (
                          <div style={{ marginTop: 8, fontSize: 12 }}>
                            🔗 <a href={a.link_reunion} target="_blank" rel="noreferrer" style={{ color: '#1B3B36' }}>{a.link_reunion}</a>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                          {canEdit && a.estado === 'programada' && (
                            <>
                              <button onClick={() => cambiarEstado(a, 'en_curso')}
                                style={{ padding: '6px 14px', background: '#dcfce7', color: '#16a34a', border: '1px solid #16a34a', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                                ▶ Iniciar
                              </button>
                              <button onClick={() => abrirEditar(a)}
                                style={{ padding: '6px 12px', background: '#EEF2EC', color: '#1B3B36', border: '1px solid var(--at-primary)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                                ✏️ Editar
                              </button>
                              <button onClick={() => cambiarEstado(a, 'cancelada')}
                                style={{ padding: '6px 12px', background: '#fef2f2', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                                Cancelar
                              </button>
                            </>
                          )}
                          {canEdit && a.estado === 'en_curso' && (
                            <button onClick={() => cambiarEstado(a, 'finalizada')}
                              style={{ padding: '6px 14px', background: '#EAE6D8', color: '#7E9389', border: '1px solid var(--at-ink-3)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                              ✅ Finalizar
                            </button>
                          )}
                          {(a.estado === 'en_curso' || a.estado === 'finalizada') && (
                            <button onClick={() => abrirActa(a)}
                              style={{ padding: '6px 14px', background: '#FAF1EA', color: '#9C5733', border: '1px solid var(--at-accent-hover)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                              📝 {a.acta_url ? 'Ver/editar acta' : 'Registrar acta'}
                            </button>
                          )}
                          {a.acta_url && (
                            <button onClick={() => imprimirActa(a)}
                              style={{ padding: '6px 12px', background: '#FAF7EF', color: '#3E5A4C', border: '1px solid var(--at-line-strong)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                              🖨️ Imprimir
                            </button>
                          )}
                          {canEdit && a.estado !== 'en_curso' && (
                            <button onClick={() => eliminar(a)}
                              style={{ padding: '6px 12px', background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                              🗑️ Eliminar
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
