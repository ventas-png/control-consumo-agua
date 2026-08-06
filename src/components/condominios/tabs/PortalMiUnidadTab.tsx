import { useCallback, useEffect, useState } from 'react'
import { notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { ImageGallery } from '../../shared/ImageGallery'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { MultiFileUploader, ListaAdjuntos } from '../../shared/FileUploader'
import { MensajePortalChatModal } from './MensajePortalChatModal'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { fetchConteoComentariosMensajePortal } from '../../../domain/condominios/tabQueries'
import type { Unidad, MensajePortal, TipoMensajePortal } from '../../../types'

interface Props {
  unidad: Unidad
  mensajes: MensajePortal[]
  proyectoId: string
  companyId: string
  isAdmin: boolean
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

function blankMsg() {
  return { asunto: '', cuerpo: '', tipo: 'consulta' as TipoMensajePortal }
}

export function PortalMiUnidadTab({ unidad, mensajes, proyectoId, companyId, isAdmin, autorNombre = '', autorUserId, onRefresh, onGenerarToken }: Props) {
  const [showMsgForm, setShowMsgForm] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [msgForm, setMsgForm]         = useState(blankMsg())
  const [fotos, setFotos]             = useState<string[]>([])
  const [archivos, setArchivos]       = useState<string[]>([])
  const [conversacion, setConversacion] = useState<MensajePortal | null>(null)
  const [conteoMensajes, setConteoMensajes] = useState<Record<string, number>>({})

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
            style={{ padding: '7px 14px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
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
              <button onClick={enviarMensaje} disabled={saving} style={{ padding: '9px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
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
            return (
              <div key={m.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px 16px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '18px', flexShrink: 0 }}>{tc.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '3px' }}>
                      <span style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--at-ink)' }}>{m.asunto}</span>
                      <span style={{ fontSize: '11.5px', fontWeight: 700, color: ec.color }}>{ec.label}</span>
                    </div>
                    <p style={{ margin: '0 0 5px', fontSize: '13px', color: 'var(--at-ink-2)' }}>{m.cuerpo}</p>
                    {m.foto_urls?.length > 0 && (
                      <div style={{ margin: '6px 0' }}>
                        <ImageGallery urls={m.foto_urls} maxVisible={4} />
                      </div>
                    )}
                    {m.archivo_urls?.length > 0 && (
                      <div style={{ margin: '6px 0' }}>
                        <ListaAdjuntos paths={m.archivo_urls} />
                      </div>
                    )}
                    {m.respuesta && (
                      <div style={{ background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '8px', padding: '8px 12px', marginTop: '6px' }}>
                        <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--at-success)', marginBottom: '2px' }}>Respuesta de administración:</div>
                        <div style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>{m.respuesta}</div>
                      </div>
                    )}
                    <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                      {new Date(m.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                    <button
                      onClick={() => setConversacion(m)}
                      style={{ marginTop: '9px', padding: '6px 13px', background: nHilo > 0 ? 'var(--at-primary-tint)' : 'var(--at-chip)', color: nHilo > 0 ? 'var(--at-primary)' : 'var(--at-ink-2)', border: 'none', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                      💬 {nHilo > 0 ? `Conversación (${nHilo})` : (isAdmin ? 'Responder' : 'Escribir a la administración')}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

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
