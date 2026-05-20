import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import { PlantillaMensajeCond, CanalPlantilla } from '../../../types'

interface Props {
  plantillas: PlantillaMensajeCond[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CANAL_CFG: Record<CanalPlantilla, { label: string; color: string; bg: string; icon: string }> = {
  whatsapp: { label: 'WhatsApp', color: '#16a34a', bg: '#dcfce7', icon: '💬' },
  email:    { label: 'Email',    color: '#1B3B36', bg: '#EEF2EC', icon: '📧' },
  sms:      { label: 'SMS',      color: '#9C5733', bg: '#FAF1EA', icon: '📱' },
}

const VARIABLES_SUGERIDAS = ['{{nombre_residente}}', '{{unidad}}', '{{monto}}', '{{fecha_vencimiento}}', '{{periodo}}', '{{dias_mora}}', '{{proyecto}}']

const BLANK: Omit<PlantillaMensajeCond, 'id' | 'company_id' | 'project_id' | 'created_at'> = {
  nombre: '', canal: 'whatsapp', asunto: '', cuerpo: '', variables: [], activa: true,
}

function extraerVariables(texto: string): string[] {
  const matches = texto.match(/\{\{[^}]+\}\}/g) ?? []
  return [...new Set(matches)]
}

export default function PlantillasMensajeTab({ plantillas, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [form, setForm] = useState({ ...BLANK })
  const [editId, setEditId] = useState<string | null>(null)
  const [preview, setPreview] = useState<PlantillaMensajeCond | null>(null)
  const [saving, setSaving] = useState(false)
  const [filtroCanal, setFiltroCanal] = useState<CanalPlantilla | ''>('')

  const filtradas = filtroCanal ? plantillas.filter(p => p.canal === filtroCanal) : plantillas

  function abrirNueva() {
    setEditId(null)
    setForm({ ...BLANK })
  }

  function abrirEditar(p: PlantillaMensajeCond) {
    setEditId(p.id)
    setForm({ nombre: p.nombre, canal: p.canal, asunto: p.asunto ?? '', cuerpo: p.cuerpo, variables: p.variables, activa: p.activa })
  }

  function insertarVariable(v: string) {
    setForm(f => ({ ...f, cuerpo: f.cuerpo + v }))
  }

  async function guardar() {
    if (!form.nombre.trim() || !form.cuerpo.trim()) {
      Swal.fire('Campos requeridos', 'Nombre y cuerpo son obligatorios.', 'warning'); return
    }
    setSaving(true)
    const variables = extraerVariables(form.cuerpo)
    const payload = {
      company_id: companyId,
      project_id: proyectoId,
      nombre: form.nombre.trim(),
      canal: form.canal,
      asunto: form.asunto?.trim() || null,
      cuerpo: form.cuerpo.trim(),
      variables,
      activa: form.activa,
    }
    const { error } = editId
      ? await supabase.from('plantillas_mensaje_cond').update(payload).eq('id', editId)
      : await supabase.from('plantillas_mensaje_cond').insert(payload)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setEditId(null)
    setForm({ ...BLANK })
    onRefresh()
  }

  async function toggleActiva(p: PlantillaMensajeCond) {
    await supabase.from('plantillas_mensaje_cond').update({ activa: !p.activa }).eq('id', p.id)
    onRefresh()
  }

  async function eliminar(p: PlantillaMensajeCond) {
    const r = await Swal.fire({ title: '¿Eliminar plantilla?', text: p.nombre, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('plantillas_mensaje_cond').delete().eq('id', p.id)
    onRefresh()
  }

  const cfg = CANAL_CFG[form.canal]

  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
      {/* Panel izquierdo — lista */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Plantillas ({filtradas.length})</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={filtroCanal} onChange={e => setFiltroCanal(e.target.value as CanalPlantilla | '')}
              style={{ padding: '4px 8px', border: '1px solid #E1DDD0', borderRadius: 6, fontSize: 11 }}>
              <option value="">Todos los canales</option>
              {(Object.keys(CANAL_CFG) as CanalPlantilla[]).map(c => <option key={c} value={c}>{CANAL_CFG[c].label}</option>)}
            </select>
            {canCreate && (
              <button onClick={abrirNueva}
                style={{ padding: '5px 12px', background: '#1B3B36', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                + Nueva
              </button>
            )}
          </div>
        </div>

        {filtradas.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#7E9389', padding: '40px 0', fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📨</div>
            No hay plantillas{filtroCanal ? ` de ${CANAL_CFG[filtroCanal].label}` : ''}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtradas.map(p => {
              const c = CANAL_CFG[p.canal]
              return (
                <div key={p.id} style={{ background: '#fff', border: `1px solid ${p.activa ? c.color + '33' : '#E1DDD0'}`, borderRadius: 10, padding: '10px 14px', opacity: p.activa ? 1 : 0.6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', background: c.bg, color: c.color, borderRadius: 6 }}>{c.icon} {c.label}</span>
                        {!p.activa && <span style={{ fontSize: 10, color: '#7E9389' }}>Inactiva</span>}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#15291F', marginBottom: 2 }}>{p.nombre}</div>
                      <div style={{ fontSize: 11, color: '#7E9389', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.cuerpo.slice(0, 80)}{p.cuerpo.length > 80 ? '…' : ''}</div>
                      {p.variables.length > 0 && (
                        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {p.variables.map(v => (
                            <span key={v} style={{ fontSize: 9, background: '#EAE6D8', color: '#7E9389', padding: '1px 5px', borderRadius: 4 }}>{v}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                      <button onClick={() => setPreview(p)} style={{ fontSize: 11, padding: '3px 8px', border: '1px solid #E1DDD0', borderRadius: 5, cursor: 'pointer', background: '#FAF7EF' }}>👁</button>
                      {canEdit && <button onClick={() => abrirEditar(p)} style={{ fontSize: 11, padding: '3px 8px', border: '1px solid #E1DDD0', borderRadius: 5, cursor: 'pointer', background: '#FAF7EF' }}>✏️</button>}
                      {canEdit && <button onClick={() => toggleActiva(p)} style={{ fontSize: 11, padding: '3px 8px', border: '1px solid #E1DDD0', borderRadius: 5, cursor: 'pointer', background: '#FAF7EF' }}>{p.activa ? '⏸' : '▶'}</button>}
                      {canEdit && <button onClick={() => eliminar(p)} style={{ fontSize: 11, padding: '3px 8px', border: '1px solid #fecaca', borderRadius: 5, cursor: 'pointer', background: '#fef2f2', color: '#ef4444' }}>🗑</button>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Panel derecho — editor / preview */}
      <div>
        {preview ? (
          <div style={{ background: '#fff', border: '1px solid #E1DDD0', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Vista previa</div>
              <button onClick={() => setPreview(null)} style={{ fontSize: 12, padding: '3px 10px', border: '1px solid #E1DDD0', borderRadius: 6, cursor: 'pointer', background: '#FAF7EF' }}>✕ Cerrar</button>
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', background: CANAL_CFG[preview.canal].bg, color: CANAL_CFG[preview.canal].color, borderRadius: 6 }}>
                {CANAL_CFG[preview.canal].icon} {CANAL_CFG[preview.canal].label}
              </span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{preview.nombre}</div>
            {preview.asunto && <div style={{ fontSize: 12, color: '#7E9389', marginBottom: 8 }}>Asunto: {preview.asunto}</div>}
            <div style={{ background: '#FAF7EF', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#15291F', whiteSpace: 'pre-wrap', lineHeight: 1.6, border: '1px solid #E1DDD0' }}>
              {preview.cuerpo}
            </div>
            {preview.variables.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#7E9389', marginBottom: 4 }}>Variables detectadas:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {preview.variables.map(v => (
                    <span key={v} style={{ fontSize: 10, background: '#EAE6D8', color: '#3E5A4C', padding: '2px 8px', borderRadius: 6, border: '1px solid #E1DDD0' }}>{v}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (canCreate || (canEdit && editId)) ? (
          <div style={{ background: '#fff', border: '1px solid #E1DDD0', borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>{editId ? 'Editar plantilla' : 'Nueva plantilla'}</div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: 4 }}>Nombre *</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Recordatorio de pago mensual"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #C7C2B0', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: 4 }}>Canal</label>
                <select value={form.canal} onChange={e => setForm(f => ({ ...f, canal: e.target.value as CanalPlantilla }))}
                  style={{ width: '100%', padding: '7px 10px', border: `1px solid ${cfg.color}66`, borderRadius: 7, fontSize: 13 }}>
                  {(Object.keys(CANAL_CFG) as CanalPlantilla[]).map(c => <option key={c} value={c}>{CANAL_CFG[c].icon} {CANAL_CFG[c].label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: 4 }}>Estado</label>
                <select value={form.activa ? '1' : '0'} onChange={e => setForm(f => ({ ...f, activa: e.target.value === '1' }))}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #C7C2B0', borderRadius: 7, fontSize: 13 }}>
                  <option value="1">Activa</option>
                  <option value="0">Inactiva</option>
                </select>
              </div>
            </div>

            {form.canal === 'email' && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: 4 }}>Asunto</label>
                <input value={form.asunto ?? ''} onChange={e => setForm(f => ({ ...f, asunto: e.target.value }))}
                  placeholder="Asunto del correo"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #C7C2B0', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            )}

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: 4 }}>Cuerpo del mensaje *</label>
              <textarea value={form.cuerpo} onChange={e => setForm(f => ({ ...f, cuerpo: e.target.value }))}
                rows={6} placeholder="Hola {{nombre_residente}}, le recordamos que su cuota de {{periodo}} vence el {{fecha_vencimiento}}..."
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #C7C2B0', borderRadius: 7, fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#3E5A4C', marginBottom: 6 }}>Variables sugeridas</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {VARIABLES_SUGERIDAS.map(v => (
                  <button key={v} onClick={() => insertarVariable(v)}
                    style={{ fontSize: 10, padding: '3px 8px', background: '#EAE6D8', border: '1px solid #E1DDD0', borderRadius: 5, cursor: 'pointer', color: '#3E5A4C' }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {extraerVariables(form.cuerpo).length > 0 && (
              <div style={{ marginBottom: 14, padding: '8px 12px', background: '#EEF2EC', borderRadius: 8, fontSize: 11, color: '#102622' }}>
                Variables detectadas: {extraerVariables(form.cuerpo).join(', ')}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 18px', background: '#1B3B36', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Guardando…' : editId ? 'Guardar cambios' : 'Crear plantilla'}
              </button>
              {editId && (
                <button onClick={() => { setEditId(null); setForm({ ...BLANK }) }}
                  style={{ padding: '8px 14px', background: '#FAF7EF', border: '1px solid #E1DDD0', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>
                  Cancelar
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#7E9389', padding: '60px 0', fontSize: 13 }}>
            Selecciona una plantilla para ver o editar
          </div>
        )}
      </div>
    </div>
  )
}
