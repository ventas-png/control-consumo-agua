// Hilo de conversación en ventana emergente: el bloque original arriba, los
// mensajes como burbujas, y la caja de envío con fotos abajo. Se ve igual que
// los chats del Centro de Comunicación (ChatBits: avatar, separador de día):
// pantalla completa en el teléfono, propios a la derecha en el color de marca,
// y una caja de envío compacta con los adjuntos en una bandeja plegable.
//
// Es la mitad genérica de los dos chats del portal —tickets de mantenimiento y
// mensajes a la administración—, que difieren solo en QUÉ tabla leen/escriben y
// en los controles extra del staff. Todo lo que se ve (burbujas propias a la
// derecha, notas internas, adjuntos, scroll al final) vive acá una sola vez: si
// cada chat tuviera el suyo, se separarían a la primera corrección.
//
// El consumidor pasa `cargar`/`enviar`; este componente no sabe de Supabase.
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { EditModal } from './EditModal'
import { ImageGallery } from './ImageGallery'
import { MultiImageUploader } from './ImageUploader'
import { MultiFileUploader, ListaAdjuntos } from './FileUploader'
import { notify } from './Dialog'
import { Avatar, DaySeparator } from './ChatBits'
import { Skeleton } from './Skeleton'
import { dayKey, dayLabel } from '../../lib/chatFormat'

/** Fila del hilo, ya normalizada por el consumidor. */
export interface MensajeHilo {
  id: string
  autor_nombre: string
  contenido: string
  foto_urls: string[]
  /** Documentos adjuntos (PDF/Word/Excel). */
  archivo_urls: string[]
  es_interno: boolean
  /** auth.uid() sellado por la BD; identifica los mensajes propios. */
  creado_por?: string | null
  created_at: string
}

/** Lo que el consumidor tiene que persistir cuando el usuario envía. */
export interface EnvioHilo {
  contenido: string
  fotos: string[]
  archivos: string[]
  interno: boolean
}

/** Chip informativo al lado del autor (ej. un cambio de estado). */
export interface EtiquetaMensaje {
  texto: string
  bg: string
  color: string
}

// Genérico en la fila: el consumidor lee su tabla y `etiquetaMensaje` recibe la
// fila COMPLETA (con sus columnas propias) sin castear.
interface Props<T extends MensajeHilo> {
  titulo: string
  subtitulo?: ReactNode
  /** Bloque que encabeza el hilo: el reporte/mensaje que lo originó. */
  original: { etiqueta: string; texto: string; fotos: string[]; archivos: string[] }
  /** Baja el hilo. Se re-invoca después de cada envío. */
  cargar: () => Promise<T[]>
  /** Persiste el mensaje. Devuelve el error legible, o null si salió bien. */
  enviar: (envio: EnvioHilo) => Promise<string | null>
  /** Chip opcional por mensaje (ej. "→ Resuelto"). */
  etiquetaMensaje?: (m: T) => EtiquetaMensaje | null
  /** Controles extra del staff encima del botón de enviar. */
  controlesStaff?: ReactNode
  /** Mensajes con este `creado_por` se pintan como propios. */
  autorUserId?: string
  /** false → hilo de solo lectura (sin caja de mensaje). */
  canWrite?: boolean
  /** Staff: habilita el check de nota interna. */
  esStaff?: boolean
  placeholder?: string
  /** Texto del vacío cuando todavía no hay mensajes. */
  vacioTexto?: string
  /** Carpeta de `condominios-media` para los adjuntos (bajo el project_id). */
  folder: string
  maxFotos?: number
  onClose: () => void
}

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

export function ConversacionModal<T extends MensajeHilo>({
  titulo, subtitulo, original, cargar, enviar, etiquetaMensaje, controlesStaff,
  autorUserId, canWrite = true, esStaff = false,
  placeholder = 'Escriba un mensaje…', vacioTexto = 'Todavía no hay mensajes.',
  folder, maxFotos = 4, onClose,
}: Props<T>) {
  const [mensajes, setMensajes] = useState<T[]>([])
  const [cargando, setCargando] = useState(true)
  const [texto, setTexto]       = useState('')
  const [fotos, setFotos]       = useState<string[]>([])
  const [archivos, setArchivos] = useState<string[]>([])
  const [interno, setInterno]   = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [recarga, setRecarga]   = useState(0)
  // Bandeja de adjuntos plegada: con los dos cargadores siempre a la vista, la
  // caja de envío ocupaba media pantalla del teléfono.
  const [verAdjuntos, setVerAdjuntos] = useState(false)
  const finRef = useRef<HTMLDivElement>(null)

  // `cargar` suele ser una closure nueva en cada render del padre; por el ref, su
  // identidad no re-dispara la lectura. El hilo se baja al montar y cada vez que
  // `recarga` avanza (después de enviar).
  const cargarRef = useRef(cargar)
  cargarRef.current = cargar

  useEffect(() => {
    let cancelado = false
    void cargarRef.current().then(filas => {
      if (cancelado) return
      setMensajes(filas)
      setCargando(false)
    })
    return () => { cancelado = true }
  }, [recarga])

  // Chat: al abrir y tras enviar se mira el final del hilo, no el principio.
  // `?.()` porque jsdom no implementa scrollIntoView (y esto se testea).
  useEffect(() => {
    finRef.current?.scrollIntoView?.({ block: 'end' })
  }, [mensajes.length])

  const nAdjuntos = fotos.length + archivos.length
  const hayAlgo = !!texto.trim() || nAdjuntos > 0

  async function onEnviar() {
    const contenido = texto.trim()
    if (!contenido && fotos.length === 0 && archivos.length === 0) {
      notify({ variant: 'warning', title: 'Mensaje vacío', text: 'Escriba un mensaje o adjunte una foto o documento.' })
      return
    }
    setEnviando(true)
    const error = await enviar({ contenido, fotos, archivos, interno: esStaff && interno })
    setEnviando(false)
    if (error) { notify({ variant: 'error', title: 'No se pudo enviar', text: error }); return }
    setTexto(''); setFotos([]); setArchivos([]); setInterno(false); setVerAdjuntos(false)
    setRecarga(r => r + 1)
  }

  const footer = canWrite ? (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {esStaff && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Respuesta vs nota interna, como en el Centro de Comunicación: deja
              claro antes de escribir si el residente lo va a leer. */}
          <div role="radiogroup" aria-label="Tipo de mensaje" style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--at-chip)', borderRadius: 10 }}>
            {([[false, '💬 Responder'], [true, '🔒 Nota interna']] as const).map(([valor, label]) => {
              const activo = interno === valor
              return (
                <button key={label} type="button" role="radio" aria-checked={activo} onClick={() => setInterno(valor)}
                  style={{
                    padding: '6px 12px', border: 'none', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
                    fontSize: 12.5, fontWeight: activo ? 700 : 500,
                    background: activo ? (valor ? 'var(--at-warning-tint)' : 'var(--at-surface)') : 'transparent',
                    color: activo ? (valor ? 'var(--at-warning-strong)' : 'var(--at-ink)') : 'var(--at-ink-3)',
                    boxShadow: activo ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}>
                  {label}
                </button>
              )
            })}
          </div>
          {controlesStaff}
        </div>
      )}

      {verAdjuntos && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 12 }}>
          <MultiImageUploader
            values={fotos}
            onChange={setFotos}
            folder={folder}
            label="Adjuntar fotos"
            maxFiles={maxFotos}
          />
          <MultiFileUploader
            values={archivos}
            onChange={setArchivos}
            folder={folder}
            label="Adjuntar documentos"
            maxFiles={maxFotos}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !enviando) void onEnviar() }}
          placeholder={interno ? 'Escriba una nota para el equipo…' : placeholder}
          rows={2}
          aria-label="Mensaje"
          style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '10px 12px', borderRadius: 12,
            border: `1.5px solid ${interno ? 'var(--at-warning-border)' : 'var(--at-line)'}`,
            background: interno ? 'var(--at-warning-tint)' : 'var(--at-surface-2)', color: 'var(--at-ink)',
            fontSize: 14, lineHeight: 1.45, resize: 'none', maxHeight: 140, fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={() => setVerAdjuntos(v => !v)}
          aria-expanded={verAdjuntos}
          aria-label={nAdjuntos > 0 ? `Adjuntos (${nAdjuntos})` : 'Adjuntar fotos o documentos'}
          title="Adjuntar fotos o documentos"
          style={{
            position: 'relative', width: 44, height: 44, flexShrink: 0, borderRadius: 12, cursor: 'pointer',
            border: `1px solid ${verAdjuntos ? 'var(--at-primary)' : 'var(--at-line)'}`,
            background: verAdjuntos ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: 'var(--at-ink-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          {nAdjuntos > 0 && (
            <span aria-hidden="true" style={{
              position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 999,
              background: 'var(--at-primary)', color: 'var(--at-on-status)', fontSize: 10.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{nAdjuntos}</span>
          )}
        </button>
        <button
          type="button"
          onClick={onEnviar}
          disabled={enviando}
          aria-label={interno ? 'Guardar nota interna' : 'Enviar mensaje'}
          style={{
            height: 44, padding: '0 16px', flexShrink: 0, borderRadius: 12, border: 'none',
            display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13.5,
            background: !hayAlgo || enviando ? 'var(--at-chip)' : interno ? 'var(--at-warning)' : 'var(--at-primary)',
            color: !hayAlgo || enviando ? 'var(--at-ink-3)' : 'var(--at-on-status)',
            cursor: enviando ? 'wait' : 'pointer',
          }}
        >
          {enviando ? 'Enviando…' : (
            <>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              <span className="conv-send-label">{interno ? 'Guardar' : 'Enviar'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  ) : undefined

  return (
    <EditModal
      title={titulo}
      subtitle={subtitulo}
      maxWidth="680px"
      height="780px"
      fullScreenOnMobile
      noPadding
      onClose={onClose}
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%', boxSizing: 'border-box', padding: 16, background: 'var(--at-surface-2)' }}>
        {/* Lo que originó el hilo, fijo como primera tarjeta. */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderLeft: '4px solid var(--at-accent)', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {original.etiqueta}
          </div>
          <div style={{ fontSize: 14, color: 'var(--at-ink-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {original.texto}
          </div>
          {original.fotos.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <ImageGallery urls={original.fotos} maxVisible={4} />
            </div>
          )}
          {original.archivos.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <ListaAdjuntos paths={original.archivos} />
            </div>
          )}
        </div>

        {cargando ? (
          <div aria-busy="true" aria-label="Cargando conversación" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
            <Skeleton width="55%" height={44} radius={14} />
            <Skeleton width="45%" height={44} radius={14} style={{ alignSelf: 'flex-end' }} />
          </div>
        ) : mensajes.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', padding: '24px 12px', color: 'var(--at-ink-3)' }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>💬</div>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              {vacioTexto}{canWrite ? ' Escriba el primero abajo.' : ''}
            </p>
          </div>
        ) : (
          mensajes.map((m, i) => {
            const nuevoDia = i === 0 || dayKey(mensajes[i - 1].created_at) !== dayKey(m.created_at)
            return (
              <Fragment key={m.id}>
                {nuevoDia && <DaySeparator label={dayLabel(m.created_at)} />}
                <Burbuja
                  mensaje={m}
                  mio={!!autorUserId && m.creado_por === autorUserId}
                  chip={etiquetaMensaje?.(m) ?? null}
                />
              </Fragment>
            )
          })
        )}
        <div ref={finRef} />
      </div>
    </EditModal>
  )
}

function Burbuja({ mensaje: m, mio, chip }: { mensaje: MensajeHilo; mio: boolean; chip: EtiquetaMensaje | null }) {
  const skin: CSSProperties = m.es_interno
    ? { background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: '1px dashed var(--at-warning-border)' }
    : mio
      ? { background: 'var(--at-primary)', color: 'var(--at-on-status)', border: '1px solid transparent' }
      : { background: 'var(--at-surface)', color: 'var(--at-ink)', border: '1px solid var(--at-line)' }
  // Las propias no llevan nombre (son obviamente de quien mira); el resto sí,
  // y la nota interna siempre se anuncia como tal.
  const cabecera = !mio || m.es_interno || chip

  return (
    <div style={{ display: 'flex', justifyContent: mio ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8 }}>
      {!mio && <Avatar name={m.autor_nombre} />}
      <div style={{
        maxWidth: 'min(82%, 520px)', padding: '9px 13px 7px',
        borderRadius: mio ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        ...skin,
      }}>
        {cabecera && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3, fontSize: 11, fontWeight: 700 }}>
            {(!mio || m.es_interno) && (
              <span style={{ opacity: m.es_interno ? 1 : 0.75 }}>
                {m.es_interno ? '🔒 Interna · ' : ''}{mio ? 'Yo' : m.autor_nombre}
              </span>
            )}
            {chip && (
              <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: chip.bg, color: chip.color }}>
                {chip.texto}
              </span>
            )}
          </div>
        )}
        {m.contenido && (
          <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.contenido}</div>
        )}
        {m.foto_urls.length > 0 && (
          <div style={{ marginTop: m.contenido ? 8 : 0 }}>
            <ImageGallery urls={m.foto_urls} maxVisible={4} />
          </div>
        )}
        {m.archivo_urls.length > 0 && (
          <div style={{ marginTop: m.contenido || m.foto_urls.length > 0 ? 8 : 0 }}>
            <ListaAdjuntos paths={m.archivo_urls} />
          </div>
        )}
        <div style={{ fontSize: 10.5, opacity: 0.65, marginTop: 4, textAlign: 'right' }}>{horaCorta(m.created_at)}</div>
      </div>
    </div>
  )
}
