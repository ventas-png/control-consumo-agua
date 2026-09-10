// Cola local de lecturas capturadas SIN conexión (P1 · captura offline).
//
// Problema: el lecturista en campo pierde el trabajo si guarda sin señal. Aquí
// encolamos la CAPTURA en localStorage cuando el guardado no puede salir, y la
// sincronizamos después de forma IDEMPOTENTE.
//
// QUÉ CAMBIÓ Y POR QUÉ (migración 20260910000001). La idempotencia era
// «check-then-insert» sobre la CLAVE NATURAL (contador · lectura · fecha):
// antes de sincronizar se preguntaba si esa lectura ya existía. Tenía dos
// agujeros, y los dos importan:
//
//   · Es una carrera. Entre el `existe()` y el `insert()` cabe otro
//     dispositivo. El índice único tapaba el caso, pero la lógica de la cola
//     seguía siendo «mirar y luego escribir».
//   · Y sobre todo: la clave natural NO distingue un reintento de una captura
//     real. Dos lecturas legítimas del mismo contador, el mismo día y con el
//     mismo número —el medidor no se movió, o el lecturista re-capturó— son
//     indistinguibles de un reenvío, y la cola descartaba una de verdad
//     creyendo que ya estaba.
//
// Ahora cada captura lleva su propia LLAVE DE IDEMPOTENCIA, generada una vez al
// guardar y conservada en la cola. Identifica la OPERACIÓN, no la lectura: el
// servidor devuelve la fila que ya creó con esa llave, y si no existe, la crea.
// No hay pre-consulta, no hay carrera, y dos capturas iguales de verdad son dos
// operaciones distintas con dos llaves distintas.
//
// El almacenamiento se abstrae (OutboxStorage) para testear la lógica sin
// browser. NO se guarda la foto (blob): offline conservamos el DATO crítico de
// la lectura; la foto se puede recapturar. El payload debe ser JSON-serializable.

import type { LecturaCaptura } from '../domain/agua/mutations'

export interface LecturaPendiente {
  /** Llave de idempotencia de la captura: la identidad de la OPERACIÓN. */
  clave: string
  /** Epoch ms de encolado (orden + UX). */
  encoladaEn: number
  /** Etiqueta legible (cliente · contador) para la lista de pendientes. */
  etiqueta: string
  /** Lo que el operador capturó. El cobro lo resuelve el servidor al sincronizar. */
  captura: LecturaCaptura
}

/** Almacenamiento mínimo (localStorage en browser; in-memory en tests). */
export interface OutboxStorage {
  leer(): string | null
  escribir(valor: string): void
}

const CLAVE_STORAGE = 'lecturas_outbox_v1'

/** Storage sobre localStorage. Degrada a no-op si no está disponible (SSR/privado). */
export function localStorageOutbox(): OutboxStorage {
  return {
    leer: () => { try { return localStorage.getItem(CLAVE_STORAGE) } catch { return null } },
    escribir: (v) => { try { localStorage.setItem(CLAVE_STORAGE, v) } catch { /* quota / modo privado */ } },
  }
}

/**
 * Llave de idempotencia nueva. `crypto.randomUUID` cuando está (todo navegador
 * con contexto seguro, que es donde corre la app), y si no, un identificador
 * suficientemente improbable: la llave sólo tiene que ser única entre las
 * capturas de ESTE dispositivo hasta que entren, no un secreto.
 */
export function nuevaClaveIdempotencia(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Forma en que la cola guardaba las lecturas ANTES de 20260910000001. */
interface PendienteLegado {
  clave?: unknown
  encoladaEn?: unknown
  etiqueta?: unknown
  registro?: Record<string, unknown>
}

/**
 * Sube una pendiente del formato viejo (el payload crudo de `registros`) al
 * nuevo. Existe porque la cola vive en el localStorage del dispositivo: cuando
 * la app se actualiza, el lecturista puede tener lecturas encoladas con la
 * forma anterior y son lecturas de campo que nadie puede volver a tomar.
 *
 * Del payload viejo sólo se rescata lo que el operador capturó; todo lo que
 * decidía el cobro se DESCARTA a propósito — lo va a calcular el servidor.
 *
 * La llave que se le inventa es DETERMINISTA (deriva de la clave natural que
 * esa cola ya usaba como identidad): leer la cola dos veces produce la misma
 * llave, así que dos intentos de sincronizar la misma pendiente legada siguen
 * siendo la misma operación.
 */
function migrarPendiente(item: PendienteLegado): LecturaPendiente | null {
  const r = item.registro
  if (!r || typeof r !== 'object') return null
  const contadorId = typeof r.contador_id === 'string' ? r.contador_id : null
  const lectura = typeof r.lectura_actual === 'number' ? r.lectura_actual : Number(r.lectura_actual)
  if (!contadorId || !Number.isFinite(lectura)) return null
  const fechaCruda = typeof r.fecha === 'string' ? r.fecha : ''
  const fecha = fechaLocalDeISO(fechaCruda)
  if (!fecha) return null
  return {
    clave: `legado-${contadorId}-${lectura}-${fecha}`,
    encoladaEn: typeof item.encoladaEn === 'number' ? item.encoladaEn : Date.now(),
    etiqueta: typeof item.etiqueta === 'string' ? item.etiqueta : 'Lectura pendiente',
    captura: {
      contadorId,
      lecturaActual: lectura,
      fecha,
      idempotencyKey: `legado-${contadorId}-${lectura}-${fecha}`,
      notas: typeof r.notas === 'string' && r.notas ? r.notas : null,
      gps: (r.gps && typeof r.gps === 'object' ? r.gps : null) as LecturaCaptura['gps'],
    },
  }
}

/**
 * `YYYY-MM-DD` LOCAL de una fecha ISO. La cola vieja guardaba la fecha como
 * timestamp (mediodía local convertido a UTC); la RPC quiere el día. Se recorta
 * en local, no con `toISOString()`, que daría el día UTC — el mismo error E4/D5
 * que hacía caer las lecturas de la noche en el ciclo siguiente.
 */
function fechaLocalDeISO(iso: string): string | null {
  if (!iso) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Lee la cola actual (tolerante a JSON corrupto → []), migrando lo que venga en el formato viejo. */
export function leerPendientes(storage: OutboxStorage): LecturaPendiente[] {
  try {
    const raw = storage.leer()
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return (arr as (LecturaPendiente | PendienteLegado)[])
      .map((x) => {
        const nuevo = x as LecturaPendiente
        if (nuevo && typeof nuevo === 'object' && nuevo.captura?.idempotencyKey) return nuevo
        return migrarPendiente(x as PendienteLegado)
      })
      .filter((x): x is LecturaPendiente => x !== null)
  } catch {
    return []
  }
}

/** Encola una captura (dedupe por llave de idempotencia). Devuelve la cola resultante. */
export function encolarLectura(
  storage: OutboxStorage,
  captura: LecturaCaptura,
  etiqueta: string,
  ahora: number,
): LecturaPendiente[] {
  const cola = leerPendientes(storage)
  if (cola.some((x) => x.clave === captura.idempotencyKey)) return cola // ya encolada
  const next = [...cola, { clave: captura.idempotencyKey, encoladaEn: ahora, etiqueta, captura }]
  storage.escribir(JSON.stringify(next))
  return next
}

/** Quita una pendiente por llave. Devuelve la cola resultante. */
export function quitarPendiente(storage: OutboxStorage, clave: string): LecturaPendiente[] {
  const next = leerPendientes(storage).filter((x) => x.clave !== clave)
  storage.escribir(JSON.stringify(next))
  return next
}

export interface FlushDeps {
  /**
   * Registra la captura. Devuelve el mensaje de error, `null` en éxito, o
   * 'duplicado' cuando la BD la rechazó por la llave natural (23505): esa
   * lectura ya está, por otra operación, y reintentar no la va a meter nunca.
   *
   * Ya NO hay un `existe()` previo. La RPC es idempotente por sí misma: con la
   * misma llave devuelve la fila que ya creó. Preguntar antes sólo añadía una
   * carrera y un viaje de red.
   */
  registrar: (captura: LecturaCaptura) => Promise<string | null | 'duplicado'>
}

export interface FlushResultado {
  /** Registradas con éxito (incluye los reintentos que el servidor resolvió como ya hechos). */
  ok: number
  /** Descartadas porque esa lectura ya estaba en la BD por OTRA operación. */
  yaExistian: number
  /** Fallaron y quedan en la cola para reintentar. */
  fallidas: number
}

/**
 * Sincroniza la cola. Por cada pendiente llama a la RPC con SU llave de
 * idempotencia: si esa operación ya entró, el servidor devuelve la misma fila y
 * no duplica nada. Sólo se quedan en la cola las que fallan (para reintentar).
 */
export async function sincronizarPendientes(storage: OutboxStorage, deps: FlushDeps): Promise<FlushResultado> {
  const cola = leerPendientes(storage)
  let ok = 0
  let yaExistian = 0
  let fallidas = 0
  const restantes: LecturaPendiente[] = []
  for (const item of cola) {
    try {
      const err = await deps.registrar(item.captura)
      if (err === 'duplicado') {
        // La llave natural la rechazó: esa lectura ya está por otra operación.
        // Reintentar no la va a meter nunca → se descarta de la cola.
        yaExistian++
      } else if (err) {
        fallidas++
        restantes.push(item)
      } else {
        ok++
      }
    } catch {
      fallidas++
      restantes.push(item)
    }
  }
  storage.escribir(JSON.stringify(restantes))
  return { ok, yaExistian, fallidas }
}
