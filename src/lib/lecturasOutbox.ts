// Cola local de lecturas capturadas SIN conexión (P1 · captura offline).
//
// Problema: el lecturista en campo pierde el trabajo si guarda sin señal (escritura
// directa a la BD, sin cola). Aquí encolamos la lectura en localStorage cuando el
// guardado falla por falta de red, y la sincronizamos DESPUÉS —manual, controlada
// por el operador— de forma IDEMPOTENTE: antes de insertar verificamos que la
// lectura no exista ya en la BD por su CLAVE NATURAL (contador · lectura · fecha),
// así un reintento nunca duplica (no requiere columna de idempotencia ni migración).
//
// El almacenamiento se abstrae (OutboxStorage) para testear la lógica sin browser.
// NO se guarda la foto (blob): offline conservamos el DATO crítico de la lectura; la
// foto se puede recapturar. El payload debe ser JSON-serializable.

export interface LecturaPendiente {
  /** Clave natural (contador|lectura|fecha): identidad para dedupe e idempotencia. */
  clave: string
  /** Epoch ms de encolado (orden + UX). */
  encoladaEn: number
  /** Etiqueta legible (cliente · contador) para la lista de pendientes. */
  etiqueta: string
  /** Payload listo para createRegistro. */
  registro: Record<string, unknown>
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

/** Clave natural de una lectura: identifica unívocamente el registro en la BD. */
export function claveNatural(registro: Record<string, unknown>): string {
  return `${registro.contador_id ?? ''}|${registro.lectura_actual ?? ''}|${registro.fecha ?? ''}`
}

/** Lee la cola actual (tolerante a JSON corrupto → []). */
export function leerPendientes(storage: OutboxStorage): LecturaPendiente[] {
  try {
    const raw = storage.leer()
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as LecturaPendiente[]) : []
  } catch {
    return []
  }
}

/** Encola una lectura (dedupe por clave natural). Devuelve la cola resultante. */
export function encolarLectura(
  storage: OutboxStorage,
  registro: Record<string, unknown>,
  etiqueta: string,
  ahora: number,
): LecturaPendiente[] {
  const cola = leerPendientes(storage)
  const clave = claveNatural(registro)
  if (cola.some((x) => x.clave === clave)) return cola // ya encolada
  const next = [...cola, { clave, encoladaEn: ahora, etiqueta, registro }]
  storage.escribir(JSON.stringify(next))
  return next
}

/** Quita una pendiente por clave. Devuelve la cola resultante. */
export function quitarPendiente(storage: OutboxStorage, clave: string): LecturaPendiente[] {
  const next = leerPendientes(storage).filter((x) => x.clave !== clave)
  storage.escribir(JSON.stringify(next))
  return next
}

export interface FlushDeps {
  /** ¿La lectura ya existe en la BD? (idempotencia; evita duplicar en reintentos). */
  existe: (registro: Record<string, unknown>) => Promise<boolean>
  /**
   * Inserta la lectura. Devuelve el mensaje de error, o null en éxito.
   * E1: 'duplicado' cuando la BD la rechazó por la llave natural UNIQUE (23505)
   * — otro dispositivo la insertó entre existe() y este insert (TOCTOU). Se
   * cuenta como yaExistía y se DESCARTA de la cola (antes quedaba atascada
   * reintentando para siempre).
   */
  insertar: (registro: Record<string, unknown>) => Promise<string | null | 'duplicado'>
}

export interface FlushResultado {
  /** Insertadas con éxito. */
  ok: number
  /** Descartadas porque ya estaban en la BD (idempotencia). */
  yaExistian: number
  /** Fallaron y quedan en la cola para reintentar. */
  fallidas: number
}

/**
 * Sincroniza la cola de forma IDEMPOTENTE: por cada pendiente, si ya existe en la BD
 * la descarta; si no, la inserta. Solo deja en la cola las que fallan (para reintentar).
 * Nunca duplica, aún si el guardado previo se cortó a mitad (retorno + reintento).
 */
export async function sincronizarPendientes(storage: OutboxStorage, deps: FlushDeps): Promise<FlushResultado> {
  const cola = leerPendientes(storage)
  let ok = 0
  let yaExistian = 0
  let fallidas = 0
  const restantes: LecturaPendiente[] = []
  for (const item of cola) {
    try {
      if (await deps.existe(item.registro)) {
        yaExistian++
        continue
      }
      const err = await deps.insertar(item.registro)
      if (err === 'duplicado') {
        // La llave natural (E1) la rechazó: otro dispositivo ganó la carrera.
        // Ya está en la BD → descartar de la cola, no reintentar.
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
