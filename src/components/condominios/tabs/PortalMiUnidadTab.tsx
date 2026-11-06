import { useCallback, useEffect, useState } from 'react'
import { notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { ImageGallery } from '../../shared/ImageGallery'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { MultiFileUploader, ListaAdjuntos } from '../../shared/FileUploader'
import { MensajePortalChatModal } from './MensajePortalChatModal'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { fetchConteoComentariosMensajePortal } from '../../../domain/condominios/tabQueries'
import { AccesosUnidadSection } from './AccesosUnidadSection'
import { tint } from '../../shared/statusTone'
import type { Unidad, MensajePortal, TipoMensajePortal } from '../../../types'

interface Props {
  unidad: Unidad
  mensajes: MensajePortal[]
  proyectoId: string
  companyId: string
  isAdmin: boolean
  /** true cuando el residente logueado es PROPIETARIO de esta unidad: habilita
   *  la sección "Accesos de mi unidad" (familia / núcleo del inquilino). Los
   *  RPCs que usa son de propietario, así que la vista previa staff no la pinta. */
  esPropietario?: boolean
  /** Firma los mensajes del hilo (residente o miembro del equipo). */
  autorNombre?: string
  autorUserId?: string
  onRefresh: () => void
  onGenerarToken: () => void
}

const TIPO_MSG: Record<TipoMensajePortal, { label: string; icon: string }> = {
  consulta:    { label: 'Consulta',    icon: '💬' },
  queja:       { label: 'Queja',       icon: '😤' },
  sugerencia:  { label: 'Sugerencia',  icon: '💡' },
  emergencia:  { label: 'Emergencia',  icon: '🚨' },
}

const ESTADO_MSG: Record<string, { label: string; color: string }> = {
  nuevo:       { label: 'Nuevo',       color: 'var(--at-primary)' },
  leido:       { label: 'Leído',       color: 'var(--at-ink-3)' },
  respondido:  { label: 'Respondido',  color: 'var(--at-success)' },
  cerrado:     { label: 'Cerrado',     color: 'var(--at-ink-3)' },
}

/** "2026-07-20T10:00:00Z" → "20 jul" (tarjeta) y "20 de julio de 2026, 10:00" (ficha), en hora local. */
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short' })
const fechaHoraLarga = (iso: string) => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function blankMsg() {
  return { asunto: '', cuerpo: '', tipo: 'consulta' as TipoMensajePortal }
}

export function PortalMiUnidadTab({ unidad, mensajes, proyectoId, companyId, isAdmin, esPropietario = false, autorNombre = '', autorUserId, onRefresh, onGenerarToken }: Props) {
  const [showMsgForm, setShowMsgForm] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [msgForm, setMsgForm]         = useState(blankMsg())
  const [fotos, setFotos]             = useState<string[]>([])
  const [archivos, setArchivos]       = useState<string[]>([])
  const [conversacion, setConversacion] = useState<MensajePortal | null>(null)
  const [conteoMensajes, setConteoMensajes] = useState<Record<string, number>>({})
  // Mensaje abierto en la ficha, por id: así la ficha sigue a la fila cuando el padre recarga.
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const detalle = detalleId ? mensajes.find(m => m.id === detalleId) ?? null : null
  const etiquetaHilo = (n: number) => `💬 ${n > 0 ? `Conversación (${n})` : (isAdmin ? 'Responder' : 'Escribir a la administración')}`

  // Badge "N" por tarjeta: un solo conteo para toda la lista; los hilos se bajan
  // al abrir la conversación.
  const ids = mensajes.map(m => m.id).join(',')
  const cargarConteos = useCallback(async () => {
    setConteoMensajes(await fetchConteoComentariosMensajePortal(ids ? ids.split(',') : []))
  }, [ids])
  useEffect(() => { void cargarConteos() }, [cargarConteos])

  function cerrarForm() {
    setShowMsgForm(false)
    setMsgForm(blankMsg())
    setFotos([])
    setArchivos([])
  }

  async function enviarMensaje() {
    if (!msgForm.asunto.trim() || !msgForm.cuerpo.trim()) {
      notify({ variant: 'error', title: 'Error', text: 'Complete asunto y mensaje.' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('mensajes_portal', {
      company_id: companyId, project_id: proyectoId, unidad_id: unidad.id,
      asunto: msgForm.asunto.trim(), cuerpo: msgForm.cuerpo.trim(), tipo: msgForm.tipo,
      foto_urls: fotos,
      archivo_urls: archivos,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: '¡Mensaje enviado!', text: 'La administración lo revisará pronto.', duration: 1800 })
    cerrarForm(); onRefresh()
  }

  const portalUrl = unidad.token_portal
    ? `${window.location.origin}/portal/${unidad.token_portal}`
    : null

  return (
    <div>
      {/* Info de la unidad */}
      <div style={{ background: 'linear-gradient(135deg,var(--at-ink-deep),var(--at-primary-hover))', borderRadius: '16px', padding: '20px', marginBottom: '22px', color: 'white' }}>
        <div style={{ fontSize: '28px', marginBottom: '8px' }}>🏠</div>
        <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '4px' }}>{unidad.nombre}</div>
        <div style={{ fontSize: '13.5px', opacity: 0.85, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {unidad.tipo && <span>{unidad.tipo.replace('_', ' ')}</span>}
          {unidad.piso != null && <span>Piso {unidad.piso}</span>}
          {unidad.area_m2 && <span>{unidad.area_m2} m²</span>}
          {unidad.estado_ocupacional && <span>{unidad.estado_ocupacional}</span>}
        </div>
        {unidad.propietario_nombre && (
          <div style={{ marginTop: '10px', fontSize: '13px', opacity: 0.75 }}>
            Propietario: {unidad.propietario_nombre}
            {unidad.propietario_telefono && ` · ${unidad.propietario_telefono}`}
          </div>
        )}
      </div>

      {/* Accesos familiares / del núcleo del inquilino (solo el propietario) */}
      {esPropietario && <AccesosUnidadSection unidadId={unidad.id} />}

      {/* Link del portal (solo admin) */}
      {isAdmin && (
        <div style={{ background: 'var(--at-accent-tint-2)', border: '1.5px solid var(--at-accent-soft-2)', borderRadius: '14px', padding: '16px', marginBottom: '22px' }}>
          <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--at-accent-dark)', marginBottom: '8px' }}>🔗 Enlace del portal del residente</div>
          {portalUrl ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ flex: 1, background: 'var(--at-surface)', border: '1px solid var(--at-accent-soft-2)', borderRadius: '7px', padding: '7px 10px', fontSize: '12px', color: '#4c1d95', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {portalUrl}
              </code>
              <button onClick={() => { navigator.clipboard.writeText(portalUrl); notify({ variant: 'success', title: '¡Copiado!', duration: 1000 }) }}
                style={{ padding: '7px 14px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                📋 Copiar
              </button>
              <button onClick={onGenerarToken}
                style={{ padding: '7px 14px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: '1px solid var(--at-warning-border)', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                🔄 Regenerar
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>Sin enlace activo.</span>
              <button onClick={onGenerarToken}
                style={{ padding: '7px 16px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                Generar enlace
              </button>
            </div>
          )}
          <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: 'var(--at-accent-hover)', opacity: 0.75 }}>
            Comparte este enlace con el propietario para que acceda a su portal personal.
          </p>
        </div>
      )}

      {/* Mensajes al administrador */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>Mensajes a la administración</h4>
        {!isAdmin && (
          <button onClick={() => setShowMsgForm(true)}
            style={{ padding: '7px 14px', background: 'linear-gradient(135deg,var(--at-cta),var(--at-cta-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            + Enviar mensaje
          </button>
        )}
      </div>

      {/* Ventana emergente: el formulario no empuja la lista de mensajes hacia
          abajo, y en móvil ocupa la pantalla. */}
      {showMsgForm && (
        <EditModal
          title="Enviar mensaje a la administración"
          subtitle="Cuéntenos qué necesita y adjunte fotos si ayudan a entenderlo."
          size="sm"
          onClose={cerrarForm}
          footer={
            <>
              <button onClick={cerrarForm} style={{ padding: '9px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={enviarMensaje} disabled={saving} style={{ padding: '9px 20px', background: 'linear-gradient(135deg,var(--at-cta),var(--at-cta-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Enviando...' : '📤 Enviar'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
              {(Object.entries(TIPO_MSG) as [TipoMensajePortal, typeof TIPO_MSG[TipoMensajePortal]][]).map(([k, v]) => (
                <button key={k} onClick={() => setMsgForm(f => ({ ...f, tipo: k }))}
                  aria-pressed={msgForm.tipo === k}
                  style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', border: '1.5px solid', borderColor: msgForm.tipo === k ? 'var(--at-primary)' : 'var(--at-line)', background: msgForm.tipo === k ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: msgForm.tipo === k ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor="msg-asunto" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Asunto *</label>
              <input id="msg-asunto" autoFocus value={msgForm.asunto} onChange={e => setMsgForm(f => ({ ...f, asunto: e.target.value }))} placeholder="Ej. Ruido en el pasillo, Consulta de cuota..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label htmlFor="msg-cuerpo" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Mensaje *</label>
              <textarea id="msg-cuerpo" value={msgForm.cuerpo} onChange={e => setMsgForm(f => ({ ...f, cuerpo: e.target.value }))} placeholder="Escriba su mensaje..." rows={4}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', resize: 'vertical' }} />
            </div>
            <MultiImageUploader
              values={fotos}
              onChange={setFotos}
              folder="mensajes-portal"
              label="Fotos"
              maxFiles={4}
            />
            <MultiFileUploader
              values={archivos}
              onChange={setArchivos}
              folder="mensajes-portal"
              label="Documentos"
              maxFiles={4}
            />
          </div>
        </EditModal>
      )}

      {mensajes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--at-ink-3)' }}>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)', fontSize: '13px' }}>Sin mensajes registrados</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {mensajes.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(m => {
            const tc = TIPO_MSG[m.tipo]
            const ec = ESTADO_MSG[m.estado] ?? ESTADO_MSG.nuevo
            const nHilo = conteoMensajes[m.id] ?? 0
            const fotos = m.foto_urls?.length ?? 0
            const archivos = m.archivo_urls?.length ?? 0
            const abrir = () => setDetalleId(m.id)
            return (
              /* La tarjeta sólo resume; la ficha completa (mensaje, fotos,
                 documentos, respuesta y el hilo) abre en ventana al tocarla. */
              <div key={m.id} role="button" tabIndex={0} aria-label={m.asunto}
                onClick={abrir}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir() } }}
                style={{ background: 'var(--at-surface)', border: `1.5px solid ${m.tipo === 'emergencia' ? 'var(--at-danger-border)' : 'var(--at-line)'}`, borderRadius: '14px', padding: '12px 16px', display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer' }}>
                <span aria-hidden="true" style={{ width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '19px', background: 'var(--at-primary-tint)' }}>{tc.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: '14.5px', color: 'var(--at-ink)' }}>{m.asunto}</span>
                    <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', flexShrink: 0 }}>{fechaCorta(m.created_at)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', margin: '5px 0' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 9px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, background: tint(ec.color), color: ec.color }}>
                      <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />{ec.label}
                    </span>
                    <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{tc.label}</span>
                  </div>
                  {/* Dos líneas bastan en la lista: el mensaje completo va en la ficha. */}
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.cuerpo}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center', marginTop: '6px', fontSize: '12px', color: 'var(--at-ink-3)' }}>
                    {m.respuesta && <span style={{ fontWeight: 700, color: 'var(--at-success)' }}>↩ Respondido</span>}
                    {nHilo > 0 && <span style={{ fontWeight: 700, color: 'var(--at-primary)' }}>💬 {nHilo}</span>}
                    {fotos > 0 && <span>📷 {fotos} foto{fotos === 1 ? '' : 's'}</span>}
                    {archivos > 0 && <span>📎 {archivos} archivo{archivos === 1 ? '' : 's'}</span>}
                    <span aria-hidden style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--at-primary)' }}>Ver ficha ›</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Ficha del mensaje en ventana emergente (pantalla completa en el
          teléfono): el mensaje completo, fotos, documentos, la respuesta de la
          administración y, en el pie, el hilo. Antes cada tarjeta traía
          desplegados la galería, los documentos, la respuesta y la barra del hilo. */}
      {detalle && (() => {
        const m = detalle
        const tc = TIPO_MSG[m.tipo]
        const ec = ESTADO_MSG[m.estado] ?? ESTADO_MSG.nuevo
        const nHilo = conteoMensajes[m.id] ?? 0
        const datos: { label: string; value: string; color?: string }[] = [
          { label: 'Estado', value: ec.label, color: ec.color },
          { label: 'Tipo', value: tc.label, color: m.tipo === 'emergencia' ? 'var(--at-danger)' : undefined },
          { label: 'Enviado', value: fechaHoraLarga(m.created_at) },
        ]
        if (m.respondido_en) datos.push({ label: 'Respondido el', value: fechaHoraLarga(m.respondido_en), color: 'var(--at-success)' })
        const seccion = { background: 'var(--at-surface-2)', borderRadius: 8, padding: 10, border: '1px solid var(--at-line)', marginBottom: 12 } as const
        return (
          <EditModal
            title={m.asunto}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 800, background: tint(ec.color), color: ec.color }}>{ec.label}</span>
                <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 800, background: m.tipo === 'emergencia' ? 'var(--at-danger-tint)' : 'var(--at-surface-2)', color: m.tipo === 'emergencia' ? 'var(--at-danger)' : 'var(--at-ink-2)' }}>{tc.icon} {tc.label}</span>
                <span>📅 Enviado el {fechaCorta(m.created_at)}</span>
              </span>
            }
            size="lg"
            fullScreenOnMobile
            onClose={() => setDetalleId(null)}
            footer={
              <div className="at-ficha-acciones" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
                <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
                <Button variant="primary" onClick={() => setConversacion(m)}>{etiquetaHilo(nHilo)}</Button>
              </div>
            }
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
              {datos.map(d => (
                <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 7, padding: 8, border: '1px solid var(--at-line)', minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{d.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: d.color ?? 'var(--at-ink-2)', overflowWrap: 'anywhere' }}>{d.value}</div>
                </div>
              ))}
            </div>

            <div style={seccion}>
              <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 4 }}>Mensaje</div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--at-ink-2)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{m.cuerpo}</p>
            </div>

            {m.respuesta && (
              <div style={{ ...seccion, background: 'var(--at-success-tint)', borderColor: 'var(--at-success-border)' }}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 4 }}>Respuesta de administración</div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--at-ink-2)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{m.respuesta}</p>
              </div>
            )}

            {m.foto_urls?.length > 0 && (
              <div style={seccion}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 6 }}>Fotos</div>
                <ImageGallery urls={m.foto_urls} maxVisible={8} />
              </div>
            )}

            {m.archivo_urls?.length > 0 && (
              <div style={{ ...seccion, marginBottom: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 6 }}>Documentos</div>
                <ListaAdjuntos paths={m.archivo_urls} />
              </div>
            )}
          </EditModal>
        )
      })()}

      {/* El hilo abre encima de la ficha; al cerrarlo se recarga el conteo. */}
      {conversacion && (
        <MensajePortalChatModal
          mensaje={conversacion}
          autorNombre={autorNombre}
          autorUserId={autorUserId}
          esStaff={isAdmin}
          onClose={() => { setConversacion(null); void cargarConteos() }}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}
