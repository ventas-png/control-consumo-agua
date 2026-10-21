import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, deleteCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ComunicadoCondominio, TipoComunicado, DestinatarioComunicado, Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { printHtml } from '../../../lib/printHtml'

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
  aviso:        { label: 'Aviso',        icon: '📌',  color: 'var(--at-warning)' },
  certificado:  { label: 'Certificado',  icon: '📜',  color: 'var(--at-success)' },
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
  enviado_por: '', fecha_envio: hoyLocalISO(), firmado: false,
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
    if (!form.titulo.trim() || !form.contenido.trim()) return notify({ variant: 'warning', title: 'Campos requeridos', text: 'Título y contenido son obligatorios.' })
    if (form.destinatario === 'especifico' && !form.unidad_id) return notify({ variant: 'warning', title: 'Requerido', text: 'Selecciona la unidad destinataria.' })
    setSaving(true)
    const { error } = await createCondominioRow('comunicados_condominio', {
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo.trim(), contenido: form.contenido.trim(),
      tipo: form.tipo, destinatario: form.destinatario,
      unidad_id: form.destinatario === 'especifico' ? form.unidad_id : null,
      enviado_por: form.enviado_por || null,
      fecha_envio: form.fecha_envio, firmado: form.firmado,
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function publicarEnPortal(c: ComunicadoCondominio) {
    const r = await confirm({
      title: '¿Publicar en el portal del residente?',
      text: `El comunicado ${c.titulo} aparecerá como anuncio visible para todos los residentes en su portal.`,
      icon: 'question',
      confirmText: 'Publicar',
    })
    if (!r.isConfirmed) return
    const { error } = await createCondominioRow('anuncios_comunidad', {
      company_id: companyId, project_id: proyectoId,
      titulo: c.titulo, contenido: c.contenido,
      tipo: TIPO_A_ANUNCIO[c.tipo] ?? 'aviso',
      publicado_por: userId, activo: true,
    })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: '¡Publicado en el portal!', text: 'Los residentes ya pueden verlo.', duration: 1800 })
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar comunicado?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('comunicados_condominio', id)
    if (selectedId === id) setSelectedId(null)
    onRefresh()
  }

  function handlePrint(c: ComunicadoCondominio) {
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(printHtml`
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

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }

  function cerrarForm() {
    if (saving) return
    setShowForm(false)
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Comunicados Formales</h2>
        {canCreate && (
          <button onClick={() => { setShowForm(true); setSelectedId(null) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Comunicado
          </button>
        )}
      </div>

      {/* Form — en ventana: antes se desplegaba arriba de la lista y en el
          teléfono empujaba todo hacia abajo. */}
      {showForm && (
        <EditModal
          title="Nuevo comunicado"
          maxWidth="640px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} loadingText="Guardando…">Guardar</Button>
          </>}
        >
          <div role="group" aria-label="Tipo de comunicado" style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {(Object.keys(TIPO_LABELS) as TipoComunicado[]).map(t => (
              <button key={t} type="button" onClick={() => applyTemplate(t)} aria-pressed={form.tipo === t}
                style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '20px', border: '1.5px solid', cursor: 'pointer',
                  background: form.tipo === t ? 'var(--at-ink)' : 'var(--at-surface)',
                  color: form.tipo === t ? 'white' : 'var(--at-ink-3)',
                  borderColor: form.tipo === t ? 'var(--at-ink)' : 'var(--at-line)' }}>
                {TIPO_LABELS[t].icon} {TIPO_LABELS[t].label}
              </button>
            ))}
          </div>
          {/* `1 / -1` y no `span 2`: con una sola columna (teléfono) el span
              creaba una columna implícita y el campo se salía de la ventana. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="com-titulo" style={labelStyle}>Título *</label>
              <input id="com-titulo" style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder="Asunto del comunicado" autoFocus />
            </div>
            <div>
              <label htmlFor="com-destinatario" style={labelStyle}>Destinatario</label>
              <select id="com-destinatario" style={inputStyle} value={form.destinatario} onChange={e => setF('destinatario', e.target.value as DestinatarioComunicado)}>
                {(Object.keys(DEST_LABELS) as DestinatarioComunicado[]).map(d => (
                  <option key={d} value={d}>{DEST_LABELS[d]}</option>
                ))}
              </select>
            </div>
            {form.destinatario === 'especifico' && (
              <div>
                <label htmlFor="com-unidad" style={labelStyle}>Unidad *</label>
                <select id="com-unidad" style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                  <option value="">— Seleccionar —</option>
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="com-fecha" style={labelStyle}>Fecha emisión</label>
              <input id="com-fecha" style={inputStyle} type="date" value={form.fecha_envio} onChange={e => setF('fecha_envio', e.target.value)} />
            </div>
            <div>
              <label htmlFor="com-emisor" style={labelStyle}>Emitido por</label>
              <input id="com-emisor" style={inputStyle} value={form.enviado_por} onChange={e => setF('enviado_por', e.target.value)} placeholder="Administración / nombre" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '38px', alignSelf: 'end' }}>
              <input type="checkbox" checked={form.firmado} onChange={e => setF('firmado', e.target.checked)} id="firmado_chk" />
              <label htmlFor="firmado_chk" style={{ fontSize: '13px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>Documento firmado</label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="com-contenido" style={labelStyle}>Contenido *</label>
              <textarea id="com-contenido" style={{ ...inputStyle, minHeight: '180px', resize: 'vertical', fontFamily: 'Georgia, serif', lineHeight: '1.6' }}
                value={form.contenido} onChange={e => setF('contenido', e.target.value)}
                placeholder="Redacte el contenido del comunicado…" />
            </div>
          </div>
        </EditModal>
      )}

      {/* Filtro */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {(['all',...Object.keys(TIPO_LABELS)] as const).map(t => (
          <button key={t} onClick={() => setFiltroTipo(t as TipoComunicado | 'all')} aria-pressed={filtroTipo === t}
            style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '20px', border: '1.5px solid', cursor: 'pointer',
              background: filtroTipo === t ? 'var(--at-ink)' : 'var(--at-surface)',
              color: filtroTipo === t ? 'white' : 'var(--at-ink-3)',
              borderColor: filtroTipo === t ? 'var(--at-ink)' : 'var(--at-line)' }}>
            {t === 'all' ? 'Todos' : TIPO_LABELS[t as TipoComunicado].label}
          </button>
        ))}
      </div>

      {/* Lista — cada comunicado se abre en ventana (antes la vista previa iba
          en una columna fija de 420px que en el teléfono dejaba la lista en
          una franja y el texto fuera de la pantalla). */}
      {filtered.length === 0 ? (
        <EmptyState icon="📋" title="No hay comunicados" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(c => {
            const tl = TIPO_LABELS[c.tipo]
            return (
              <div key={c.id}
                style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderLeft: `4px solid ${tl.color}`, borderRadius: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', paddingRight: '10px' }}>
                <button type="button" className="cond-row-main" onClick={() => setSelectedId(c.id)}
                  style={{ flex: '1 1 240px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '12px 4px 12px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{tl.icon} {c.titulo}</div>
                  <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                    {tl.label} · {DEST_LABELS[c.destinatario]}{c.unidad_nombre ? ` (${c.unidad_nombre})` : ''} · {c.fecha_envio}
                    {c.firmado && <span style={{ marginLeft: '6px', color: 'var(--at-success)', fontWeight: 700 }}>✓ Firmado</span>}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)', marginTop: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {c.contenido}
                  </div>
                </button>
                {(canCreate || canEdit) && (
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0, marginLeft: 'auto', padding: '8px 0' }}>
                    {canCreate && (
                      <button onClick={() => publicarEnPortal(c)}
                        title="Publicar en portal del residente"
                        style={{ padding: '6px 10px', background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-primary)', fontWeight: 600 }}>📢 Portal</button>
                    )}
                    {canEdit && (
                      <button onClick={() => handleDelete(c.id)} aria-label={`Eliminar ${c.titulo}`}
                        style={{ padding: '6px 10px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Vista previa en ventana: a pantalla completa en el teléfono. */}
      {selected && (
        <EditModal
          title={selected.titulo}
          subtitle={`${TIPO_LABELS[selected.tipo].icon} ${TIPO_LABELS[selected.tipo].label} · ${DEST_LABELS[selected.destinatario]}${selected.unidad_nombre ? ` · ${selected.unidad_nombre}` : ''}`}
          maxWidth="680px"
          fullScreenOnMobile
          onClose={() => setSelectedId(null)}
          footer={<>
            <Button variant="secondary" onClick={() => handlePrint(selected)}>🖨️ Imprimir</Button>
            {canCreate && <Button onClick={() => publicarEnPortal(selected)}>📢 Publicar en portal</Button>}
          </>}
        >
          <article style={{ fontFamily: 'Georgia, serif', lineHeight: '1.7', fontSize: '14.5px', color: 'var(--at-ink)' }}>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '14px', fontFamily: 'inherit' }}>
              Fecha: {selected.fecha_envio}{selected.enviado_por ? ` · Emitido por: ${selected.enviado_por}` : ''}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{selected.contenido}</div>
            {selected.firmado && (
              <div style={{ marginTop: '30px', borderTop: '1px solid var(--at-line)', paddingTop: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--at-success)', fontWeight: 600 }}>
                ✓ Documento firmado
              </div>
            )}
          </article>
        </EditModal>
      )}
    </div>
  )
}
