// Seguimiento de ubicación (GPS) unificado para web y nativo.
//
// En web usamos navigator.geolocation.watchPosition (comportamiento actual, sin
// cambios). En nativo (Capacitor) usamos @capacitor/geolocation porque:
//   - En iOS WKWebView navigator.geolocation NO está disponible.
//   - El plugin dispara el prompt de permiso del SO y da alta precisión fiable.
//
// La API imita al callback previo y devuelve una función de limpieza SÍNCRONA,
// para poder usarla tal cual en el `return` de un useEffect.
import { isNative } from './platform'

export interface Coords {
  lat: number
  lng: number
}

const WATCH_OPTS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }

function watchNative(onSuccess: (c: Coords) => void, onError: (message: string) => void): () => void {
  let watchId: string | null = null
  let cancelled = false
  void (async () => {
    try {
      const { Geolocation } = await import('@capacitor/geolocation')
      const perm = await Geolocation.requestPermissions()
      if (perm.location === 'denied' && perm.coarseLocation === 'denied') {
        onError('Permiso de ubicación denegado')
        return
      }
      const id = await Geolocation.watchPosition(WATCH_OPTS, (pos, err) => {
        if (err) {
          onError(err.message || 'Error de ubicación')
          return
        }
        if (pos) onSuccess({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      })
      // Si ya nos limpiaron mientras resolvía el watch, lo cancelamos de inmediato.
      if (cancelled) void Geolocation.clearWatch({ id })
      else watchId = id
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Geolocalización no disponible')
    }
  })()
  return () => {
    cancelled = true
    if (watchId) {
      const id = watchId
      void import('@capacitor/geolocation').then(({ Geolocation }) => Geolocation.clearWatch({ id }))
    }
  }
}

function watchWeb(onSuccess: (c: Coords) => void, onError: (message: string) => void): () => void {
  if (!navigator.geolocation) {
    onError('Geolocalización no disponible en este dispositivo')
    return () => undefined
  }
  const watchId = navigator.geolocation.watchPosition(
    (pos) => onSuccess({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    (err) => onError(err.message),
    WATCH_OPTS,
  )
  return () => navigator.geolocation.clearWatch(watchId)
}

/**
 * Empieza a observar la ubicación. Llama onSuccess con cada posición y onError
 * con un mensaje legible. Devuelve una función para detener el seguimiento.
 */
export function watchLocation(
  onSuccess: (c: Coords) => void,
  onError: (message: string) => void,
): () => void {
  return isNative() ? watchNative(onSuccess, onError) : watchWeb(onSuccess, onError)
}

// ── Ubicación PUNTUAL ───────────────────────────────────────────────────────
// `watchLocation` observa; un fichaje no observa: pregunta una vez, con un
// límite de espera, y sigue adelante con o sin respuesta. Un marcaje que se
// quedara colgado esperando al GPS sería peor que uno sin coordenadas — la
// persona está parada en la puerta con el turno empezando.

/** Coordenada de un marcaje, con la exactitud que reporta el dispositivo. */
export interface CoordsMarcaje extends Coords {
  /** Radio de error en metros, tal como lo da el dispositivo. null si no lo da. */
  exactitud_m: number | null
}

const UNA_VEZ_OPTS = { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }

async function ubicacionNativa(): Promise<CoordsMarcaje> {
  const { Geolocation } = await import('@capacitor/geolocation')
  const perm = await Geolocation.requestPermissions()
  if (perm.location === 'denied' && perm.coarseLocation === 'denied') {
    throw new Error('Permiso de ubicación denegado')
  }
  const pos = await Geolocation.getCurrentPosition(UNA_VEZ_OPTS)
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    exactitud_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
  }
}

function ubicacionWeb(): Promise<CoordsMarcaje> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalización no disponible en este dispositivo'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        exactitud_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
      }),
      err => reject(new Error(err.message || 'No se pudo obtener la ubicación')),
      UNA_VEZ_OPTS,
    )
  })
}

/**
 * Pide la ubicación UNA vez. Nunca lanza: devuelve `{ coords }` o `{ error }`
 * con un mensaje legible, porque quien la llama tiene que poder mostrar «sin
 * ubicación» y dejar continuar en vez de romperse.
 */
export async function obtenerUbicacion(): Promise<{ coords: CoordsMarcaje | null; error: string | null }> {
  try {
    const coords = isNative() ? await ubicacionNativa() : await ubicacionWeb()
    return { coords, error: null }
  } catch (e) {
    return { coords: null, error: e instanceof Error ? e.message : 'No se pudo obtener la ubicación' }
  }
}
