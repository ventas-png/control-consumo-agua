import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { SugerenciaCondominio, CategoriaSugerencia, EstadoSugerencia, Unidad } from '../../../types'

interface Props {
  sugerencias: SugerenciaCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  autorNombre: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIA_CFG: Record<CategoriaSugerencia, { label: string; icon: string; color: string }> = {
  instalaciones: { label: 'Instalaciones', icon: '🔧', color: '#d97706' },
  seguridad:     { label: 'Seguridad',     icon: '🛡️', color: '#9C5733' },
  servicios:     { label: 'Servicios',     icon: '🧹', color: '#102622' },
  convivencia:   { label: 'Convivencia',   icon: '🤝', color: '#16a34a' },
  otro:          { label: 'Otro',          icon: '💬', color: '#7E9389' },
}
const ESTADO_CFG: Record<EstadoSugerencia, { label: string; bg: string; color: string; next?: EstadoSugerencia }> = {
  pendiente:   { label: 'Pendiente',   bg: '#fef3c7', color: '#d97706', next: 'en_revision' },
  en_revision: { label: 'En revisión', bg: '#D9E2DC', color: '#1B3B36', next: 'respondida' },
  respondida:  { label: 'Respondida',  bg: '#dcfce7', color: '#16a34a', next: 'archivada' },
  archivada:   { label: 'Archivada',   bg: '#EAE6D8', color: '#7E9389' },
}

const BLANK = {
  unidad_id: '', categoria: 'otro' as CategoriaSugerencia,
  titulo: '', descripcion: '', anonima: false,
}

export default function BuzonSugerenciasTab({ sugerencias, unidades, proyectoId, companyId, autorNombre, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<SugerenciaCondominio | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<EstadoSugerencia | ''>('')
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaSugerencia | ''>('')
  const [form, setForm] = useState(BLANK)

  const lista = sugerencias.filter(s =>
    (!filtroEstado || s.estado === filtroEstado) &&
    (!filtroCategoria || s.categoria === filtroCategoria)
  )

  const pendientes = sugerencias.filter(s => s.estado === 'pendiente').length
  const enRevision = sugerencias.filter(s => s.estado === 'en_revision').length

  async function guardar() {
    if (!form.titulo.trim() || !form.descripcion.trim()) {
      Swal.fire('Error', 'Título y descripción son obligatorios', 'warning'); return
    }
    setSaving(true)
    const { error } = await supabase.from('sugerencias_condominio').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.anonima ? null : (form.unidad_id || null),
      categoria: form.categoria, titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim(), anonima: form.anonima,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setMostrarForm(false); setForm(BLANK); onRefresh()
  }

  async function responder(s: SugerenciaCondominio) {
    const { value: respuesta } = await Swal.fire({
      title: 'Responder sugerencia',
      html: `<p style="font-size:13px;font-weight:600;margin-bottom:6px">${s.titulo}</p>
             <textarea id="resp-sug" class="swal2-textarea" placeholder="Escribe la respuesta…" style="font-size:13px"></textarea>`,
      showCancelButton: true, confirmButtonText: 'Responder', cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const v = (document.getElementById('resp-sug') as HTMLTextAreaElement)?.value?.trim()
        if (!v) { Swal.showValidationMessage('La respuesta no puede estar vacía') }
        return v
      },
    })
    if (!respuesta) return
    await supabase.from('sugerencias_condominio').update({
      estado: 'respondida', respuesta, respondido_por: autorNombre,
      fecha_respuesta: new Date().toISOString(),
    }).eq('id', s.id)
    onRefresh()
  }

  async function cambiarEstado(s: SugerenciaCondominio, estado: EstadoSugerencia) {
    await supabase.from('sugerencias_condominio').update({ estado }).eq('id', s.id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #C7C2B0', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#7E9389', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Pendientes', val: pendientes, bg: '#fef3c7', color: '#d97706' },
          { label: 'En revisión', val: enRevision, bg: '#D9E2DC', color: '#1B3B36' },
          { label: 'Respondidas', val: sugerencias.filter(s => s.estado === 'respondida').length, bg: '#dcfce7', color: '#16a34a' },
          { label: 'Total', val: sugerencias.length, bg: '#FAF7EF', color: '#3E5A4C' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoSugerencia | '')}
            style={{ padding: '7px 10px', border: '1px solid #C7C2B0', borderRadius: 7, fontSize: 13 }}>
            <option value="">Todos los estados</option>
            {(Object.keys(ESTADO_CFG) as EstadoSugerencia[]).map(e => <option key={e} value={e}>{ESTADO_CFG[e].label}</option>)}
          </select>
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaSugerencia | '')}
            style={{ padding: '7px 10px', border: '1px solid #C7C2B0', borderRadius: 7, fontSize: 13 }}>
            <option value="">Todas las categorías</option>
            {(Object.keys(CATEGORIA_CFG) as CategoriaSugerencia[]).map(c => <option key={c} value={c}>{CATEGORIA_CFG[c].icon} {CATEGORIA_CFG[c].label}</option>)}
          </select>
          <span style={{ fontSize: 12, color: '#7E9389', alignSelf: 'center' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: '#B96A3F', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nueva sugerencia'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: '#FAF1EA', border: '1px solid #E6CDBB', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nueva sugerencia / queja</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Categoría</label>
              <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaSugerencia }))}>
                {(Object.keys(CATEGORIA_CFG) as CategoriaSugerencia[]).map(c => <option key={c} value={c}>{CATEGORIA_CFG[c].icon} {CATEGORIA_CFG[c].label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Unidad (opcional si anónima)</label>
              <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value }))} disabled={form.anonima}>
                <option value="">— Sin unidad —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Título *</label>
              <input style={inp} value={form.titulo} onChange={e => setForm(p => ({ ...p, titulo: e.target.value }))} placeholder="Resumen breve de la sugerencia" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Descripción *</label>
              <textarea style={{ ...inp, height: 80, resize: 'vertical' }} value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="Detalla la sugerencia o queja…" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="anonima" checked={form.anonima} onChange={e => setForm(p => ({ ...p, anonima: e.target.checked, unidad_id: e.target.checked ? '' : p.unidad_id }))} />
              <label htmlFor="anonima" style={{ fontSize: 13, color: '#3E5A4C', cursor: 'pointer' }}>Enviar de forma anónima</label>
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: '#B96A3F', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Enviar sugerencia'}
          </button>
        </div>
      )}

      {/* Lista + Detalle */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#7E9389', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
          Sin sugerencias registradas
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lista.map(s => {
              const cat = CATEGORIA_CFG[s.categoria]
              const est = ESTADO_CFG[s.estado]
              const unidad = unidades.find(u => u.id === s.unidad_id)
              return (
                <div key={s.id} onClick={() => setSelected(s === selected ? null : s)}
                  style={{ background: selected?.id === s.id ? '#FAF1EA' : '#fff', border: `1.5px solid ${selected?.id === s.id ? '#CE8A63' : '#E1DDD0'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15 }}>{cat.icon}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, color: '#15291F' }}>{s.titulo}</span>
                        <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                        {s.anonima && <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, background: '#EAE6D8', color: '#7E9389' }}>Anónima</span>}
                      </div>
                      <div style={{ fontSize: 12, color: '#7E9389' }}>
                        {cat.label}
                        {!s.anonima && unidad && ` · ${unidad.nombre}`}
                        {` · ${new Date(s.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                      </div>
                      <div style={{ fontSize: 12, color: '#3E5A4C', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 500 }}>
                        {s.descripcion}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {selected && (
            <div style={{ width: 280, flexShrink: 0, background: '#fff', border: '1px solid #E1DDD0', borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>{CATEGORIA_CFG[selected.categoria].icon}</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{selected.titulo}</span>
              </div>
              <div style={{ fontSize: 12, color: '#3E5A4C', background: '#FAF7EF', borderRadius: 8, padding: '10px 12px', marginBottom: 10, lineHeight: 1.5 }}>
                {selected.descripcion}
              </div>
              {[
                ['Categoría', CATEGORIA_CFG[selected.categoria].label],
                ['Estado', ESTADO_CFG[selected.estado].label],
                ['Unidad', selected.anonima ? 'Anónima' : (unidades.find(u => u.id === selected.unidad_id)?.nombre ?? '—')],
                ['Fecha', new Date(selected.created_at).toLocaleDateString('es')],
                ['Respondido por', selected.respondido_por ?? '—'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid #EAE6D8' }}>
                  <span style={{ color: '#7E9389' }}>{k}</span>
                  <span style={{ fontWeight: 600, color: '#3E5A4C' }}>{v}</span>
                </div>
              ))}
              {selected.respuesta && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: '#f0fdf4', borderRadius: 8, fontSize: 12, color: '#166534', lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>💬 Respuesta:</div>
                  {selected.respuesta}
                </div>
              )}
              {canEdit && selected.estado !== 'archivada' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                  {selected.estado === 'pendiente' && (
                    <button onClick={() => cambiarEstado(selected, 'en_revision')}
                      style={{ padding: '7px 0', background: '#D9E2DC', color: '#1B3B36', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                      🔍 Marcar en revisión
                    </button>
                  )}
                  {(selected.estado === 'pendiente' || selected.estado === 'en_revision') && (
                    <button onClick={() => responder(selected)}
                      style={{ padding: '7px 0', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                      💬 Responder
                    </button>
                  )}
                  <button onClick={() => cambiarEstado(selected, 'archivada')}
                    style={{ padding: '7px 0', background: '#EAE6D8', color: '#7E9389', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    📁 Archivar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
