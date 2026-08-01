// Hilo de conversación en ventana emergente: el bloque original arriba, los
// mensajes como burbujas, y la caja de envío con fotos abajo.
//
// Es la mitad genérica de los dos chats del portal —tickets de mantenimiento y
// mensajes a la administración—, que difieren solo en QUÉ tabla leen/escriben y
// en los controles extra del staff. Todo lo que se ve (burbujas propias a la
// derecha, notas internas, adjuntos, scroll al final) vive acá una sola vez: si
// cada chat tuviera el suyo, se separarían a la primera corrección.
//
// El consumidor pasa `cargar`/`enviar`; este componente no sabe de Supabase.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EditModal } from './EditModal'
import { ImageGallery } from './ImageGallery'
import { MultiImageUploader } from './ImageUploader'
import { MultiFileUploader, ListaAdjuntos } from './FileUploader'
import { notify } from './Dialog'

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
  return new Date(iso).toLocaleString('es', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
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
    setTexto(''); setFotos([]); setArchivos([]); setInterno(false)
    setRecarga(r => r + 1)
  }

  return (
    <EditModal
      title={titulo}
      subtitle={subtitulo}
      size="sm"
      onClose={onClose}
      footer={canWrite ? (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            placeholder={placeholder}
            rows={2}
            aria-label="Mensaje"
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)', resize: 'vertical', fontFamily: 'inherit' }}
          />
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
          {esStaff && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {controlesStaff}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={interno} onChange={e => setInterno(e.target.checked)} />
                Nota interna
              </label>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={onEnviar}
              disabled={enviando}
              style={{ padding: '10px 22px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: enviando ? 'wait' : 'pointer', fontSize: 13.5 }}>
              {enviando ? 'Enviando…' : '➤ Enviar mensaje'}
            </button>
          </div>
        </div>
      ) : undefined}
    >
      {/* Lo que originó el hilo, como primer "mensaje". */}
      <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {original.etiqueta}
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--at-ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
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
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--at-ink-3)', fontSize: 13 }}>Cargando conversación…</div>
      ) : mensajes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>💬</div>
          <p style={{ margin: 0, fontSize: 13 }}>
            {vacioTexto}{canWrite ? ' Escriba el primero abajo.' : ''}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mensajes.map(m => {
            const mio = !!autorUserId && m.creado_por === autorUserId
            const chip = etiquetaMensaje?.(m) ?? null
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mio ? 'flex-end' : 'flex-start' }}>
                <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-ink-2)' }}>{mio ? 'Yo' : m.autor_nombre}</span>
                  <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{horaCorta(m.created_at)}</span>
                  {m.es_interno && (
                    <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>
                      🔒 Interna
                    </span>
                  )}
                  {chip && (
                    <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: chip.bg, color: chip.color }}>
                      {chip.texto}
                    </span>
                  )}
                </div>
                <div style={{
                  maxWidth: '85%',
                  background: mio ? 'var(--at-primary-tint)' : 'var(--at-surface-2)',
                  border: `1px solid ${mio ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`,
                  borderRadius: 12,
                  padding: '9px 12px',
                }}>
                  {m.contenido && (
                    <div style={{ fontSize: 13.5, color: 'var(--at-ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.contenido}</div>
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
                </div>
              </div>
            )
          })}
          <div ref={finRef} />
        </div>
      )}
    </EditModal>
  )
}
