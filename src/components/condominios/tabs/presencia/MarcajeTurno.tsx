import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { isNative } from '../../../../lib/platform'
import { obtenerUbicacion, type CoordsMarcaje } from '../../../../lib/nativeGeo'
import {
  fetchMiFichaPresencia, marcarPresencia, subirFotoMarcaje, type TipoMarcaje,
} from '../../../../domain/condominios/presenciaAutoservicio'
import { notify } from '../../../shared/Dialog'
import type { MiFichaPresencia } from '../../../../types'

interface Props {
  proyectoId: string
  /**
   * Ficha ya resuelta por el tab (que la necesita para decidir si ofrece el
   * autoservicio). Se recibe para no repetir la misma consulta al entrar; tras
   * cada marcaje esta pantalla la vuelve a bajar por su cuenta.
   */
  fichaInicial?: MiFichaPresencia | null
  /** Vuelve a bajar la lista del día del tab: el marcaje acaba de cambiarla. */
  onRefresh: () => void
  /** «Solo vengo a consultar»: la salida hacia la vista de siempre. */
  onConsultar: () => void
}

/**
 * Marcaje de turno del propio empleado: foto, ubicación y hora del servidor.
 *
 * LO QUE NO SE PREGUNTA es el diseño entero. Nombre, cargo, fecha, turno y hora
 * los trae `presencia_mi_ficha` de la cuenta que entró; la hora del marcaje la
 * pone `presencia_marcar` en el servidor. Lo único que aporta la persona es lo
 * único que solo ella puede aportar: su cara y dónde está.
 *
 * LA CÁMARA SE ABRE SOLA al entrar, porque quien elige «voy a marcar mi turno»
 * ya dijo lo que quiere y está de pie en la puerta. Pero el intento puede fallar
 * —Safari bloquea la apertura programática de un selector de archivos cuando la
 * juzga lejos del gesto del usuario— así que el botón de tomar la foto sigue
 * visible siempre: la apertura automática es una comodidad, nunca el único
 * camino.
 */
export default function MarcajeTurno({ proyectoId, fichaInicial = null, onRefresh, onConsultar }: Props) {
  const [ficha, setFicha] = useState<MiFichaPresencia | null>(fichaInicial)
  const [cargando, setCargando] = useState(fichaInicial === null)
  const [errorFicha, setErrorFicha] = useState<string | null>(null)
  const [foto, setFoto] = useState<{ file: File; url: string } | null>(null)
  const [errorFoto, setErrorFoto] = useState<string | null>(null)
  // Intentos MANUALES de capturar. La salida sin foto solo aparece después de
  // que la persona lo intentó ella misma: si contara la apertura automática
  // —que puede fallar por política del navegador— sería el camino más cómodo.
  const [intentos, setIntentos] = useState(0)
  const [coords, setCoords] = useState<CoordsMarcaje | null>(null)
  const [errorGps, setErrorGps] = useState<string | null>(null)
  const [gpsCargando, setGpsCargando] = useState(true)
  const [observaciones, setObservaciones] = useState('')
  const [guardando, setGuardando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const yaAbrio = useRef(false)

  const recargarFicha = useCallback(async () => {
    const { ficha: f, error } = await fetchMiFichaPresencia(proyectoId)
    setFicha(f)
    setErrorFicha(error)
    setCargando(false)
  }, [proyectoId])

  useEffect(() => { if (fichaInicial === null) void recargarFicha() }, [fichaInicial, recargarFicha])

  // La ubicación se pide en paralelo a todo lo demás: si tarda o la niegan, el
  // marcaje sigue estando disponible sin ella (y la fila lo dirá).
  useEffect(() => {
    let vivo = true
    void obtenerUbicacion().then(({ coords: c, error }) => {
      if (!vivo) return
      setCoords(c)
      setErrorGps(error)
      setGpsCargando(false)
    })
    return () => { vivo = false }
  }, [])

  const tomarFoto = useCallback(async (auto = false) => {
    setErrorFoto(null)
    if (!auto) setIntentos(n => n + 1)
    if (!isNative()) { inputRef.current?.click(); return }
    const { takeNativePhoto } = await import('../../../../lib/nativeCamera')
    const file = await takeNativePhoto(true)
    // `takeNativePhoto` devuelve null tanto si se canceló como si se denegó el
    // permiso, y desde aquí no se distinguen: se dice lo que la persona puede
    // hacer al respecto en vez de adivinar cuál de los dos fue.
    if (file) usarArchivo(file)
    else setErrorFoto('No se tomó la foto. Revisá el permiso de cámara e intentá de nuevo.')
  }, [])

  // Apertura automática, una sola vez y solo cuando hay algo que marcar.
  useEffect(() => {
    if (cargando || yaAbrio.current || !ficha) return
    if (ficha.hora_entrada && ficha.hora_salida) return  // jornada cerrada
    yaAbrio.current = true
    void tomarFoto(true)
  }, [cargando, ficha, tomarFoto])

  function usarArchivo(file: File) {
    setErrorFoto(null)
    setFoto({ file, url: URL.createObjectURL(file) })
  }

  // Un objectURL retiene el blob hasta que se revoca. El efecto libera el
  // anterior en cuanto se sustituye la foto, y el último al desmontar: repetir
  // la foto cinco veces no deja cinco imágenes en memoria.
  useEffect(() => () => { if (foto) URL.revokeObjectURL(foto.url) }, [foto])

  const pendiente: TipoMarcaje | null =
    !ficha ? null
    : !ficha.hora_entrada ? 'entrada'
    : !ficha.hora_salida ? 'salida'
    : null

  async function marcar(conFoto: boolean) {
    if (!ficha || !pendiente || guardando) return
    setGuardando(true)
    try {
      let path: string | null = null
      if (conFoto && foto) {
        const subida = await subirFotoMarcaje(proyectoId, ficha.personal_id, foto.file)
        if (subida.error) {
          notify({ variant: 'error', title: 'No se pudo subir la foto', text: subida.error })
          return
        }
        path = subida.path
      }
      const { data, error } = await marcarPresencia({
        projectId: proyectoId,
        tipo: pendiente,
        foto: path,
        coords,
        observaciones: observaciones.trim() || null,
      })
      if (error) { notify({ variant: 'error', title: 'No se registró el marcaje', text: error }); return }
      notify({
        variant: 'success',
        title: pendiente === 'entrada' ? 'Entrada registrada' : 'Salida registrada',
        text: data
          ? `${data.hora.slice(0, 5)} · ${data.estado === 'tardanza' ? 'Tardanza' : 'Presente'}`
          : undefined,
      })
      setFoto(null)
      setObservaciones('')
      yaAbrio.current = true
      await recargarFicha()
      onRefresh()
    } finally {
      setGuardando(false)
    }
  }

  const card: CSSProperties = {
    background: 'var(--at-surface)', border: '1px solid var(--at-line)',
    borderRadius: 12, padding: 18, maxWidth: 560, margin: '0 auto',
  }
  const dato: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)' }

  if (cargando) {
    return <div style={{ ...card, textAlign: 'center', color: 'var(--at-ink-3)', fontSize: 13 }}>Cargando tu ficha…</div>
  }

  // Sin expediente vinculado no hay a quién atribuir el marcaje. Se dice qué
  // falta y quién lo arregla, en vez de un botón que fallaría al pulsarlo.
  if (!ficha) {
    return (
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🪪</div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Tu cuenta no está vinculada a un expediente</div>
        <div style={{ ...dato, lineHeight: 1.5, marginBottom: 14 }}>
          {errorFicha
            ? errorFicha
            : 'Para marcar tu turno, el administrador tiene que vincular tu cuenta con tu ficha de personal (tab Personal → Usuario de ingreso).'}
        </div>
        <button onClick={onConsultar} style={btnSecundario}>Ver asistencia del día</button>
      </div>
    )
  }

  return (
    <div style={card}>
      {/* Quién es y qué le toca: todo esto lo trajo el sistema, nada se teclea */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{ficha.nombre}</div>
          <div style={dato}>
            {ficha.cargo ? `${ficha.cargo} · ` : ''}{ficha.fecha_operativa}
          </div>
          <div style={dato}>
            {ficha.turno_inicio && ficha.turno_fin
              ? `Turno de hoy: ${ficha.turno_inicio.slice(0, 5)}–${ficha.turno_fin.slice(0, 5)}`
              : 'Sin turno asignado hoy'}
          </div>
        </div>
        <button onClick={onConsultar} style={{ ...btnSecundario, padding: '5px 10px', fontSize: 11 }}>
          Solo consultar
        </button>
      </div>

      {/* Estado del día */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Marca titulo="Entrada" hora={ficha.hora_entrada} />
        <Marca titulo="Salida" hora={ficha.hora_salida} />
      </div>

      {pendiente === null ? (
        <div style={{ textAlign: 'center', padding: '14px 0' }}>
          <div style={{ fontSize: 26 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>Tu jornada de hoy ya está completa</div>
          <div style={dato}>Entrada {ficha.hora_entrada?.slice(0, 5)} · Salida {ficha.hora_salida?.slice(0, 5)}</div>
        </div>
      ) : (
        <>
          {/* Foto */}
          <div style={{ marginBottom: 12 }}>
            {foto ? (
              <div style={{ position: 'relative' }}>
                <img src={foto.url} alt="Foto del marcaje"
                  style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--at-line)', display: 'block' }} />
                <button onClick={() => void tomarFoto()} style={{ ...btnSecundario, marginTop: 8, width: '100%' }}>
                  📷 Repetir foto
                </button>
              </div>
            ) : (
              <button onClick={() => void tomarFoto()}
                style={{ width: '100%', padding: '22px 12px', border: '2px dashed var(--at-line-strong)', borderRadius: 10, background: 'var(--at-surface-2)', cursor: 'pointer', fontSize: 13, color: 'var(--at-ink-2)' }}>
                <div style={{ fontSize: 26, marginBottom: 4 }}>📷</div>
                Tomar foto para marcar {pendiente}
              </button>
            )}
            {errorFoto && <div style={{ ...dato, color: 'var(--at-danger)', marginTop: 6 }}>{errorFoto}</div>}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="user"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) usarArchivo(f); e.target.value = '' }}
            />
          </div>

          {/* Ubicación: informativa, nunca bloqueante */}
          <div style={{ ...dato, marginBottom: 12 }}>
            {gpsCargando
              ? '📍 Obteniendo ubicación…'
              : coords
                ? `📍 Ubicación capturada${coords.exactitud_m ? ` (±${Math.round(coords.exactitud_m)} m)` : ''}`
                : `📍 Sin ubicación${errorGps ? ` — ${errorGps}` : ''}`}
          </div>

          <input
            value={observaciones}
            onChange={e => setObservaciones(e.target.value)}
            placeholder="Observación (opcional)"
            style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, marginBottom: 12 }}
          />

          <button
            onClick={() => void marcar(true)}
            disabled={guardando || !foto}
            style={{
              width: '100%', padding: '13px 16px', border: 'none', borderRadius: 10,
              background: pendiente === 'entrada' ? 'var(--at-success)' : 'var(--at-warning)',
              color: 'var(--at-on-status)', fontSize: 15, fontWeight: 700,
              cursor: guardando || !foto ? 'not-allowed' : 'pointer',
              opacity: guardando || !foto ? 0.55 : 1,
            }}
          >
            {guardando
              ? 'Registrando…'
              : pendiente === 'entrada' ? '🟢 Marcar mi entrada' : '🔴 Marcar mi salida'}
          </button>
          <div style={{ ...dato, textAlign: 'center', marginTop: 8 }}>
            La hora la pone el sistema al registrar, no se escribe a mano.
          </div>

          {/* Salida de emergencia: solo aparece cuando la cámara ya falló, para
              que no sea el camino cómodo. El marcaje queda sin evidencia y la
              observación lo deja dicho en la fila. */}
          {intentos > 0 && !foto && (
            <button
              onClick={() => { setObservaciones(o => o || 'Marcaje sin foto: cámara no disponible'); void marcar(false) }}
              disabled={guardando}
              style={{ ...btnSecundario, width: '100%', marginTop: 8 }}
            >
              Marcar sin foto (cámara no disponible)
            </button>
          )}
        </>
      )}
    </div>
  )
}

const btnSecundario: CSSProperties = {
  padding: '8px 14px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)',
  border: '1px solid var(--at-line-strong)', borderRadius: 8, cursor: 'pointer', fontSize: 12,
}

function Marca({ titulo, hora }: { titulo: string; hora: string | null }) {
  return (
    <div style={{
      flex: 1, textAlign: 'center', padding: '8px 6px', borderRadius: 8,
      background: hora ? 'var(--at-success-tint)' : 'var(--at-chip)',
    }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: hora ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
        {hora ? hora.slice(0, 5) : '—'}
      </div>
      <div style={{ fontSize: 11, color: hora ? 'var(--at-success)' : 'var(--at-ink-3)' }}>{titulo}</div>
    </div>
  )
}
