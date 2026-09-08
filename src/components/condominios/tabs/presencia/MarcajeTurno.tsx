import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { isNative } from '../../../../lib/platform'
import { obtenerUbicacion, type CoordsMarcaje } from '../../../../lib/nativeGeo'
import {
  fetchMiFichaPresencia, marcarPresencia, subirFotoMarcaje, type TipoMarcaje,
} from '../../../../domain/condominios/presenciaAutoservicio'
import { confirm, notify } from '../../../shared/Dialog'
import { fetchTiposPausa, marcarPausa, type AccionPausa } from '../../../../domain/condominios/pausasPresencia'
import { formatHoras, minutosDesdeMedianoche } from '../../../../domain/condominios/turnos'
import type { MiFichaPresencia, TipoPausa } from '../../../../types'

/**
 * Bajo este umbral, marcar la salida se pregunta antes. Cerrar la jornada sin
 * querer fue el error MÁS COMÚN del primer día: dos de las cuatro primeras
 * personas marcaron salida a los segundos de entrar, por volver a pulsar. Nadie
 * trabaja un turno de cinco minutos, así que preguntarlo no estorba a nadie.
 */
const MINUTOS_SALIDA_SOSPECHOSA = 5

/**
 * Icono por tipo de pausa. Es SOLO decoración de los códigos que trae el
 * catálogo de la casa: un tipo que la empresa invente sale con el genérico, sin
 * romper nada. Poner el emoji en la base habría sido meter presentación en el
 * dato para ganar cuatro caracteres.
 */
const ICONO_PAUSA: Record<string, string> = {
  refaccion: '☕', almuerzo: '🍽️', cena: '🌙', descanso: '⏸️',
}

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
  const [tipos, setTipos] = useState<TipoPausa[]>([])
  const [pausando, setPausando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const yaAbrio = useRef(false)
  /** Reloj del dispositivo al bajar la ficha, para medir intervalos (no fechas). */
  const cargadaEn = useRef(Date.now())

  const recargarFicha = useCallback(async () => {
    const { ficha: f, error } = await fetchMiFichaPresencia(proyectoId)
    cargadaEn.current = Date.now()
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

  // El catálogo de pausas de la empresa. Si falla, la sección de pausas
  // simplemente no aparece: no puede impedir que alguien marque su entrada.
  useEffect(() => {
    let vivo = true
    void fetchTiposPausa().then(({ tipos: t }) => { if (vivo) setTipos(t) })
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

  function usarArchivo(file: File) {
    setErrorFoto(null)
    setFoto({ file, url: URL.createObjectURL(file) })
  }

  // Un objectURL retiene el blob hasta que se revoca. El efecto libera el
  // anterior en cuanto se sustituye la foto, y el último al desmontar: repetir
  // la foto cinco veces no deja cinco imágenes en memoria.
  useEffect(() => () => { if (foto) URL.revokeObjectURL(foto.url) }, [foto])

  // Una jornada ANULADA no cuenta, así que para quien la vive el día vuelve a
  // empezar: lo que le toca es marcar entrada, no cerrar una salida que ya no
  // existe. (`presencia_mi_ficha` solo devuelve la anulada cuando no hay otra.)
  const anulada = Boolean(ficha?.anulado_en)
  const pendiente: TipoMarcaje | null =
    !ficha ? null
    : anulada ? 'entrada'
    : !ficha.hora_entrada ? 'entrada'
    : !ficha.hora_salida ? 'salida'
    : null

  // Apertura automática, una sola vez y SOLO para la entrada.
  //
  // Antes se abría también con la jornada abierta, dando por hecho que quien
  // entra a esta pantalla viene a cerrarla. Desde que hay pausas eso es falso la
  // mayoría de las veces: se entra tres o cuatro veces al día a marcar refacción
  // y almuerzo, y una cámara que salta encima de los botones de pausa estorba en
  // todas esas. La salida sigue abriéndola con UN toque —el botón grande de
  // abajo—, que es lo que se pidió: que no haya que dar con un icono.
  useEffect(() => {
    if (cargando || yaAbrio.current || !ficha) return
    if (pendiente !== 'entrada') return
    yaAbrio.current = true
    void tomarFoto(true)
  }, [cargando, ficha, pendiente, tomarFoto])

  /**
   * Minutos transcurridos desde la entrada, en el reloj del TENANT.
   * `hora_servidor` es de cuando se bajó la ficha; se le suma lo corrido desde
   * entonces. El reloj del dispositivo se usa solo para medir un intervalo,
   * nunca para fechar el marcaje: esa hora la sigue poniendo Postgres.
   */
  function minutosDesdeEntrada(): number | null {
    if (!ficha?.hora_entrada || !ficha.hora_servidor) return null
    const ent = minutosDesdeMedianoche(ficha.hora_entrada)
    const srv = minutosDesdeMedianoche(ficha.hora_servidor)
    if (ent === null || srv === null) return null
    // Un `srv < ent` solo puede significar que la jornada cruzó la medianoche:
    // el guardia entró a las 22:00 y son las 00:30. Sin esto la cuenta sale
    // negativa —‑1290 min— y la pantalla mostraría un disparate. Es la misma
    // lectura que aplica `turnos_horas_jornada` a un `fin <= inicio`.
    const corridos = srv - ent + (srv < ent ? 1440 : 0)
    return corridos + (Date.now() - cargadaEn.current) / 60000
  }

  /** Lo que lleva EN EL PUESTO, en horas. Es estadía, no jornada: lo pausado
   *  se muestra al lado, sin restarlo aquí. */
  const horasEnPuesto = (() => {
    const min = minutosDesdeEntrada()
    return min === null ? null : Math.max(0, min) / 60
  })()

  /**
   * Minutos que lleva abierta la pausa, con el mismo criterio que
   * `minutosDesdeEntrada`: el reloj del dispositivo mide el INTERVALO desde que
   * se bajó la ficha, nunca fecha nada. `pausa_abierta_desde` es un instante de
   * servidor y así se queda.
   */
  function minutosEnPausa(): number | null {
    if (!ficha?.pausa_abierta_desde) return null
    const desde = Date.parse(ficha.pausa_abierta_desde)
    if (!Number.isFinite(desde)) return null
    // El delta se calcula contra el reloj del dispositivo EN EL MOMENTO de bajar
    // la ficha, para que un desfase del teléfono no infle ni encoja la cuenta.
    return (Date.now() - desde) / 60000
  }

  async function pausar(accion: AccionPausa, tipo?: string) {
    if (!ficha || pausando) return
    setPausando(true)
    try {
      const { data, error } = await marcarPausa({ projectId: proyectoId, accion, tipo, coords })
      if (error) { notify({ variant: 'error', title: 'No se registró la pausa', text: error }); return }
      notify({
        variant: 'success',
        title: accion === 'iniciar' ? `${data?.etiqueta ?? 'Pausa'} iniciada` : `Regresaste de ${data?.etiqueta ?? 'la pausa'}`,
        text: accion === 'terminar' && data?.minutos != null
          ? `${Math.round(data.minutos)} min${data.descuenta ? ' · se descuentan de tu jornada' : ' · cuentan como jornada'}`
          : undefined,
      })
      await recargarFicha()
      onRefresh()
    } finally {
      setPausando(false)
    }
  }

  async function marcar(conFoto: boolean) {
    if (!ficha || !pendiente || guardando) return

    if (pendiente === 'salida') {
      const min = minutosDesdeEntrada()
      if (min !== null && min >= 0 && min < MINUTOS_SALIDA_SOSPECHOSA) {
        const r = await confirm({
          title: '¿Marcar tu salida?',
          text: `Entraste a las ${ficha.hora_entrada?.slice(0, 5)}, hace ${Math.max(1, Math.round(min))} min. `
            + 'Si todavía estás en tu turno, cancelá: la salida solo se marca una vez.',
          icon: 'warning',
          variant: 'danger',
          confirmText: 'Sí, marcar salida',
          cancelText: 'Cancelar',
        })
        if (!r.isConfirmed) return
      }
    }

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
          {/* La jornada abierta puede ser la de AYER: el turno de noche entra el
              5 y sale el 6. Decirlo evita que alguien crea que está cerrando
              una jornada que no es la suya. */}
          {ficha.registro_fecha && ficha.registro_fecha !== ficha.fecha_operativa && (
            <div style={{ ...dato, color: 'var(--at-warning)' }}>
              Jornada abierta del {ficha.registro_fecha}
            </div>
          )}
        </div>
        <button onClick={onConsultar} style={{ ...btnSecundario, padding: '5px 10px', fontSize: 11 }}>
          Solo consultar
        </button>
      </div>

      {/* Estado del día. Si la jornada está anulada, sus horas ya no son las
          suyas: mostrarlas como si contaran sería mentir. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Marca titulo="Entrada" hora={anulada ? null : ficha.hora_entrada} />
        <Marca titulo="Salida" hora={anulada ? null : ficha.hora_salida} />
      </div>

      {/* Que se lo digan A ELLA, no el recibo de pago a fin de mes. */}
      {ficha.corregido_en && (
        <div style={{
          border: `1px solid ${anulada ? 'var(--at-danger)' : 'var(--at-warning)'}`,
          background: anulada ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)',
          borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontSize: 12.5, lineHeight: 1.45,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>
            {anulada ? 'Tu marcaje de hoy fue anulado' : 'Tu jornada de hoy fue corregida'}
          </div>
          <div>
            Por {ficha.corregido_por_nombre ?? 'un administrador'}
            {ficha.motivo_correccion ? `: ${ficha.motivo_correccion}` : '.'}
          </div>
          {anulada && <div style={{ marginTop: 4 }}>Podés volver a marcar tu entrada.</div>}
        </div>
      )}

      {/* ── Las pausas de la jornada ───────────────────────────────────────
          Solo con la jornada ABIERTA: antes de entrar no hay de qué pausar, y
          después de salir la jornada está cerrada. Va ARRIBA de la foto porque
          quien viene a marcar su almuerzo entra tres veces al día y no tiene por
          qué pasar cada vez por delante de la cámara. */}
      {pendiente === 'salida' && !anulada && (
        <div style={{
          border: '1px solid var(--at-line)', borderRadius: 10, padding: 12, marginBottom: 14,
          background: 'var(--at-surface-2)',
        }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <Numero titulo="En el puesto" valor={formatHoras(horasEnPuesto)} />
            <Numero titulo="Descanso" valor={formatHoras((ficha.minutos_pausa ?? 0) / 60)} />
          </div>

          {ficha.pausa_abierta_id ? (
            <>
              <div style={{
                background: 'var(--at-warning-tint)', color: 'var(--at-warning)',
                borderRadius: 8, padding: '8px 10px', fontSize: 12.5, fontWeight: 600, marginBottom: 8,
              }}>
                {ICONO_PAUSA[ficha.pausa_abierta_tipo ?? ''] ?? '⏸️'} En {ficha.pausa_abierta_etiqueta ?? 'pausa'}
                {minutosEnPausa() !== null && ` · ${Math.max(0, Math.round(minutosEnPausa()!))} min`}
              </div>
              <button
                onClick={() => void pausar('terminar')}
                disabled={pausando}
                style={{
                  width: '100%', padding: '13px 16px', border: 'none', borderRadius: 10,
                  background: 'var(--at-primary)', color: 'var(--at-on-status)',
                  fontSize: 15, fontWeight: 700, cursor: pausando ? 'not-allowed' : 'pointer',
                  opacity: pausando ? 0.55 : 1,
                }}
              >
                {pausando ? 'Registrando…' : `▶️ Regresé de ${ficha.pausa_abierta_etiqueta ?? 'la pausa'}`}
              </button>
              {/* Que lo sepa ANTES de irse, no cuando lea el recibo: la salida
                  cierra la pausa sola, y esa es la única forma de que no quede
                  abierta para siempre. */}
              <div style={{ ...dato, textAlign: 'center', marginTop: 8 }}>
                Si marcás tu salida sin volver, la pausa se cierra en ese momento.
              </div>
            </>
          ) : tipos.length > 0 ? (
            <>
              <div style={{ ...dato, marginBottom: 6 }}>¿Salís a una pausa?</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6 }}>
                {tipos.map(t => (
                  <button
                    key={t.codigo}
                    onClick={() => void pausar('iniciar', t.codigo)}
                    disabled={pausando}
                    style={{
                      padding: '11px 8px', borderRadius: 9, cursor: pausando ? 'not-allowed' : 'pointer',
                      border: '1px solid var(--at-line-strong)', background: 'var(--at-surface)',
                      color: 'var(--at-ink-2)', fontSize: 13, fontWeight: 600, opacity: pausando ? 0.55 : 1,
                    }}
                  >
                    <div>{ICONO_PAUSA[t.codigo] ?? '⏸️'} {t.etiqueta}</div>
                    {/* Se dice si descuenta ANTES de pulsar. Enterarse después
                        de que el almuerzo no se paga es enterarse tarde. */}
                    <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--at-ink-3)', marginTop: 2 }}>
                      {t.descuenta ? 'se descuenta' : 'cuenta como jornada'}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}

      {pendiente === null ? (
        <div style={{ textAlign: 'center', padding: '14px 0' }}>
          <div style={{ fontSize: 26 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>Tu jornada de hoy ya está completa</div>
          <div style={dato}>Entrada {ficha.hora_entrada?.slice(0, 5)} · Salida {ficha.hora_salida?.slice(0, 5)}</div>
        </div>
      ) : (
        <>
          {/* La foto es VISTA PREVIA, no un botón. Antes el único camino para
              empezar era pulsar un recuadro punteado que se lee como adorno, y
              el botón de abajo salía deshabilitado hasta entonces: quien no
              daba con el recuadro veía la acción apagada y no sabía por qué.
              Ahora la acción vive SIEMPRE en el botón principal, que en su
              primera pulsación abre la cámara. */}
          <div style={{ marginBottom: 12 }}>
            {foto && (
              <div style={{ position: 'relative' }}>
                <img src={foto.url} alt="Foto del marcaje"
                  style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--at-line)', display: 'block' }} />
                <button onClick={() => void tomarFoto()} style={{ ...btnSecundario, marginTop: 8, width: '100%' }}>
                  📷 Repetir foto
                </button>
              </div>
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

          {/* UN botón, dos fases: sin foto abre la cámara; con foto confirma.
              Nunca sale deshabilitado — un botón apagado no explica qué falta. */}
          <button
            onClick={() => { if (!foto) void tomarFoto(); else void marcar(true) }}
            disabled={guardando}
            style={{
              width: '100%', padding: '13px 16px', border: 'none', borderRadius: 10,
              background: pendiente === 'entrada' ? 'var(--at-success)' : 'var(--at-danger)',
              color: 'var(--at-on-status)', fontSize: 15, fontWeight: 700,
              cursor: guardando ? 'not-allowed' : 'pointer',
              opacity: guardando ? 0.55 : 1,
            }}
          >
            {guardando
              ? 'Registrando…'
              : !foto
                ? (pendiente === 'entrada' ? '📷 Marcar mi entrada' : '📷 Marcar mi salida')
                : (pendiente === 'entrada' ? '🟢 Confirmar entrada' : '🔴 Confirmar salida')}
          </button>
          <div style={{ ...dato, textAlign: 'center', marginTop: 8 }}>
            {!foto
              ? 'Se abre la cámara; la foto se confirma después.'
              : 'La hora la pone el sistema al registrar, no se escribe a mano.'}
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

/** Una cifra del desglose de la jornada, en la pantalla del propio empleado. */
function Numero({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '6px 6px', borderRadius: 8, background: 'var(--at-chip)' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--at-ink-2)' }}>{valor}</div>
      <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)' }}>{titulo}</div>
    </div>
  )
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
