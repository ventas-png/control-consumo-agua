import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ComunicadoCondominio, TipoComunicado, DestinatarioComunicado, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  comunicados: ComunicadoCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABELS: Record<TipoComunicado, { label: string; icon: string; color: string }> = {
  carta:        { label: 'Carta',        icon: '✉️',  color: 'var(--at-primary)' },
  circular:     { label: 'Circular',     icon: '📢',  color: 'var(--at-accent)' },
  aviso:        { label: 'Aviso',        icon: '📌',  color: '#f59e0b' },
  certificado:  { label: 'Certificado',  icon: '📜',  color: '#10b981' },
  acta:         { label: 'Acta',         icon: '📋',  color: 'var(--at-ink-3)' },
}

const DEST_LABELS: Record<DestinatarioComunicado, string> = {
  todos:          'Todos los residentes',
  propietarios:   'Propietarios',
  arrendatarios:  'Arrendatarios',
  junta:          'Junta Directiva',
  especifico:     'Unidad específica',
}

const BLANK = {
  titulo: '', contenido: '', tipo: 'circular' as TipoComunicado,
  destinatario: 'todos' as DestinatarioComunicado, unidad_id: '',
  enviado_por: '', fecha_envio: new Date().toISOString().slice(0,10), firmado: false,
}

const TEMPLATES: Record<TipoComunicado, string> = {
  circular: 'Por medio de la presente, nos permitimos informar a todos los residentes que...',
  carta:    'Estimado(a) residente:\n\nPor medio de la presente comunicación...',
  aviso:    'AVISO IMPORTANTE\n\nSe les comunica a todos los residentes que...',
  certificado: 'La Administración del condominio hace constar que la unidad _____, correspondiente al señor(a) _____, se encuentra al día en el pago de sus obligaciones al día de hoy.',
  acta:     'ACTA DE REUNIÓN\n\nSiendo las ___ horas del día ___ de ___ de ___, reunidos en ___, se llevó a cabo la reunión de ___...',
}

const TIPO_A_ANUNCIO: Record<TipoComunicado, string> = {
  circular: 'aviso', carta: 'aviso', aviso: 'aviso', certificado: 'aviso', acta: 'aviso',
}

export function ComunicadosTab({ comunicados, unidades, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<TipoComunicado | 'all'>('all')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  function applyTemplate(tipo: TipoComunicado) {
    setF('tipo', tipo)
    if (!form.contenido.trim()) setF('contenido', TEMPLATES[tipo])
  }

  const filtered = comunicados.filter(c => filtroTipo === 'all' || c.tipo === filtroTipo)
  const selected = selectedId ? comunicados.find(c => c.id === selectedId) : null

  async function handleSave() {
    if (!form.titulo.trim() || !form.contenido.trim()) return Swal.fire('Campos requeridos', 'Título y contenido son obligatorios.', 'warning')
    if (form.destinatario === 'especifico' && !form.unidad_id) return Swal.fire('Requerido', 'Selecciona la unidad destinataria.', 'warning')
    setSaving(true)
    const { error } = await supabase.from('comunicados_condominio').insert({
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo.trim(), contenido: form.contenido.trim(),
      tipo: form.tipo, destinatario: form.destinatario,
      unidad_id: form.destinatario === 'especifico' ? form.unidad_id : null,
      enviado_por: form.enviado_por || null,
      fecha_envio: form.fecha_envio, firmado: form.firmado,
    })
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function publicarEnPortal(c: ComunicadoCondominio) {
    const r = await Swal.fire({
      title: '¿Publicar en el portal del residente?',
      html: `El comunicado <b>${c.titulo}</b> aparecerá como anuncio visible para todos los residentes en su portal.`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Publicar', cancelButtonText: 'Cancelar', confirmButtonColor: 'var(--at-primary)',
    })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('anuncios_comunidad').insert({
      company_id: companyId, project_id: proyectoId,
      titulo: c.titulo, contenido: c.contenido,
      tipo: TIPO_A_ANUNCIO[c.tipo] ?? 'aviso',
      publicado_por: userId, activo: true,
    })
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: '¡Publicado en el portal!', text: 'Los residentes ya pueden verlo.', timer: 1800, showConfirmButton: false })
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar comunicado?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('comunicados_condominio').delete().eq('id', id)
    if (selectedId === id) setSelectedId(null)
    onRefresh()
  }

  function handlePrint(c: ComunicadoCondominio) {
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`
      <html><head><title>${c.titulo}</title>
      <style>body{font-family:serif;max-width:700px;margin:40px auto;padding:20px;font-size:14px;line-height:1.7}h1{font-size:18px;text-align:center;margin-bottom:30px}.meta{color:#666;font-size:12px;margin-bottom:30px;border-bottom:1px solid #ccc;padding-bottom:10px}.content{white-space:pre-wrap}.footer{margin-top:60px;border-top:1px solid #ccc;padding-top:20px;text-align:center;color:#666;font-size:12px}</style>
      </head><body>
      <div class="meta">${TIPO_LABELS[c.tipo].label} — ${DEST_LABELS[c.destinatario]}${c.unidad_nombre ? ` — ${c.unidad_nombre}` : ''} — Fecha: ${c.fecha_envio}</div>
      <h1>${c.titulo}</h1>
      <div class="content">${c.contenido}</div>
      <div class="footer">${c.firmado ? '✓ Documento firmado' : ''} ${c.enviado_por ? `Emitido por: ${c.enviado_por}` : ''}</div>
      </body></html>`)
    win.document.close()
    win.print()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Comunicados Formales</h2>
        {canCreate && (
          <button onClick={() => { setShowForm(v => !v); setSelectedId(null) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Comunicado
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 700 }}>Nuevo comunicado</h3>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
            {(Object.keys(TIPO_LABELS) as TipoComunicado[]).map(t => (
              <button key={t} onClick={() => applyTemplate(t)}
                style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '20px', border: '1.5px solid', cursor: 'pointer',
                  background: form.tipo === t ? 'var(--at-ink)' : 'var(--at-surface)',
                  color: form.tipo === t ? 'white' : 'var(--at-ink-3)',
                  borderColor: form.tipo === t ? 'var(--at-ink)' : 'var(--at-line)' }}>
                {TIPO_LABELS[t].icon} {TIPO_LABELS[t].label}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '10px', marginBottom: '10px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Título *</label>
              <input style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder="Asunto del comunicado" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Destinatario</label>
              <select style={inputStyle} value={form.destinatario} onChange={e => setF('destinatario', e.target.value as DestinatarioComunicado)}>
                {(Object.keys(DEST_LABELS) as DestinatarioComunicado[]).map(d => (
                  <option key={d} value={d}>{DEST_LABELS[d]}</option>
                ))}
              </select>
            </div>
            {form.destinatario === 'especifico' && (
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Unidad *</label>
                <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                  <option value="">— Seleccionar —</option>
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha emisión</label>
              <input style={inputStyle} type="date" value={form.fecha_envio} onChange={e => setF('fecha_envio', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Emitido por</label>
              <input style={inputStyle} value={form.enviado_por} onChange={e => setF('enviado_por', e.target.value)} placeholder="Administración / nombre" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
              <input type="checkbox" checked={form.firmado} onChange={e => setF('firmado', e.target.checked)} id="firmado_chk" />
              <label htmlFor="firmado_chk" style={{ fontSize: '12px', color: 'var(--at-ink-3)', cursor: 'pointer' }}>Documento firmado</label>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Contenido *</label>
              <textarea style={{ ...inputStyle, minHeight: '140px', resize: 'vertical', fontFamily: 'Georgia, serif', lineHeight: '1.6' }}
                value={form.contenido} onChange={e => setF('contenido', e.target.value)}
                placeholder="Redacte el contenido del comunicado…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filter + list + preview */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {(['all',...Object.keys(TIPO_LABELS)] as const).map(t => (
          <button key={t} onClick={() => setFiltroTipo(t as TipoComunicado | 'all')}
            style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '20px', border: '1.5px solid', cursor: 'pointer',
              background: filtroTipo === t ? 'var(--at-ink)' : 'var(--at-surface)',
              color: filtroTipo === t ? 'white' : 'var(--at-ink-3)',
              borderColor: filtroTipo === t ? 'var(--at-ink)' : 'var(--at-line)' }}>
            {t === 'all' ? 'Todos' : TIPO_LABELS[t as TipoComunicado].label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 420px' : '1fr', gap: '16px' }}>
        {/* List */}
        <div>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)', fontSize: '13px' }}>No hay comunicados.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filtered.map(c => {
                const tl = TIPO_LABELS[c.tipo]
                return (
                  <div key={c.id} onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}
                    style={{ background: selectedId === c.id ? 'var(--at-primary-tint)' : 'var(--at-surface)', border: `1.5px solid ${selectedId === c.id ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`, borderLeft: `4px solid ${tl.color}`, borderRadius: '8px', padding: '12px 14px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)' }}>{tl.icon} {c.titulo}</div>
                        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                          {tl.label} — {DEST_LABELS[c.destinatario]}{c.unidad_nombre ? ` (${c.unidad_nombre})` : ''} — {c.fecha_envio}
                          {c.firmado && <span style={{ marginLeft: '6px', color: '#10b981', fontWeight: 700 }}>✓ Firmado</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginLeft: '8px' }}>
                        {canCreate && (
                          <button onClick={e => { e.stopPropagation(); publicarEnPortal(c) }}
                            title="Publicar en portal del residente"
                            style={{ padding: '3px 7px', background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-primary)', fontWeight: 600 }}>📢 Portal</button>
                        )}
                        {canEdit && (
                          <button onClick={e => { e.stopPropagation(); handleDelete(c.id) }}
                            style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Preview panel */}
        {selected && (
          <div style={{ border: '1.5px solid var(--at-line)', borderRadius: '12px', overflow: 'hidden', alignSelf: 'start' }}>
            <div style={{ padding: '10px 14px', background: 'var(--at-surface-2)', borderBottom: '1px solid var(--at-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)' }}>Vista previa</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                {canCreate && (
                  <button onClick={() => publicarEnPortal(selected)}
                    style={{ padding: '4px 10px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                    📢 Publicar en portal
                  </button>
                )}
                <button onClick={() => handlePrint(selected)}
                  style={{ padding: '4px 10px', background: 'var(--at-ink)', color: 'white', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                  🖨️ Imprimir
                </button>
                <button onClick={() => setSelectedId(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: '16px' }}>×</button>
              </div>
            </div>
            <div style={{ padding: '16px', fontFamily: 'Georgia, serif', lineHeight: '1.7', fontSize: '13px', maxHeight: '500px', overflowY: 'auto' }}>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '12px' }}>
                {TIPO_LABELS[selected.tipo].label} — {DEST_LABELS[selected.destinatario]}{selected.unidad_nombre ? ` — ${selected.unidad_nombre}` : ''}<br />
                Fecha: {selected.fecha_envio}{selected.enviado_por ? ` — Emitido por: ${selected.enviado_por}` : ''}
              </div>
              <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 800, textAlign: 'center', color: 'var(--at-ink)' }}>{selected.titulo}</h3>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--at-ink)' }}>{selected.contenido}</div>
              {selected.firmado && (
                <div style={{ marginTop: '30px', borderTop: '1px solid var(--at-line)', paddingTop: '12px', textAlign: 'center', fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                  ✓ Documento firmado
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
