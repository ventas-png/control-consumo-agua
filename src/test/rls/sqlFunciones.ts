// ════════════════════════════════════════════════════════════════════════════
// Lectura de definiciones de funciones SQL desde las migraciones.
// ════════════════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE ESTE MÓDULO
// La versión anterior vivía inline en una prueba y era incorrecta de cuatro
// formas a la vez:
//
//   1. Concatenaba los archivos sin ordenarlos explícitamente.
//   2. Buscaba sólo por NOMBRE, así que dos sobrecargas eran la misma cosa.
//   3. Cerraba el cuerpo con «el primer `$fn$;` que aparezca», aunque el cuerpo
//      se hubiera abierto con `$$` y su cierre real estuviera mucho antes.
//   4. Tomaba `partes[partes.length - 1]`, que con sobrecargas no es "la última
//      definición de ESTA firma" sino "lo que quede tras el último nombre".
//
// Medido sobre `conta_cierre_anual(int)`:
//
//     cierre real `$$;`     posición 162
//     `$fn$;` elegido       posición 118150
//     longitud del "cuerpo" 118150
//     incluye get_my_company_id()  → true   ← de OTRA migración
//
// Es decir: clasificaba la RPC leyendo SQL ajeno. El wrapper `(int)` es, en
// realidad, tres líneas que delegan en `(int, uuid)` y no comprueban nada.
//
// Aquí el cuerpo se delimita leyendo el dollar-quote que lo ABRE y buscando el
// cierre de ESE MISMO tag, la firma se compara por tipos normalizados, y entre
// varias definiciones de la misma firma gana la de la migración más reciente
// por orden lexicográfico (que en este repo es el orden cronológico).

/** Una definición concreta de función, ya acotada. */
export interface DefinicionFuncion {
  nombre: string
  /** Tipos de los parámetros, normalizados: `int`, `int, uuid`, … */
  firma: string
  /** Cuerpo entre los dollar-quotes, sin incluirlos. */
  cuerpo: string
  /** Tag del dollar-quote que delimita el cuerpo: `$$`, `$fn$`, … */
  delimitador: string
  /** Archivo de migración del que sale (para diagnosticar). */
  archivo: string
}

/** Un archivo de migración: su nombre y su SQL. */
export interface ArchivoMigracion {
  archivo: string
  sql: string
}

/**
 * Palabras con las que EMPIEZA un tipo SQL. Sirven para distinguir la forma
 * `p_anio int` (nombre + tipo) de la forma `int` (sólo tipo, como en los
 * GRANT/REVOKE), sin confundir `timestamp with time zone` con un nombre.
 */
const INICIOS_DE_TIPO = new Set([
  'int', 'int2', 'int4', 'int8', 'integer', 'bigint', 'smallint',
  'numeric', 'decimal', 'real', 'double', 'float',
  'text', 'varchar', 'character', 'char', 'citext', 'name',
  'bool', 'boolean', 'uuid', 'json', 'jsonb', 'bytea', 'oid',
  'date', 'time', 'timestamp', 'timestamptz', 'timetz', 'interval',
  'void', 'record', 'anyelement', 'anyarray', 'trigger', 'inet', 'cidr',
])

/** Quita comentarios de línea y colapsa espacios. */
function normalizar(texto: string): string {
  return texto.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Normaliza UN parámetro a su tipo.
 *
 *   `p_anio int`                   → `int`
 *   `int`                          → `int`
 *   `p_num_invitados int DEFAULT 0`→ `int`
 *   `p_x timestamp with time zone` → `timestamp with time zone`
 */
function tipoDeParametro(parametro: string): string {
  let t = normalizar(parametro)
  t = t.replace(/\s+DEFAULT\s+.*$/i, '')
  t = t.replace(/^(IN|OUT|INOUT|VARIADIC)\s+/i, '')
  const tokens = t.split(' ').filter(Boolean)
  if (tokens.length === 0) return ''
  // Si ya empieza por un tipo, no hay nombre que descartar.
  if (INICIOS_DE_TIPO.has(tokens[0].toLowerCase()) || tokens[0].includes('.')) {
    return tokens.join(' ').toLowerCase()
  }
  return tokens.slice(1).join(' ').toLowerCase()
}

/**
 * Parte una lista de argumentos por comas de NIVEL SUPERIOR. Hace falta porque
 * los tipos llevan paréntesis propios: `numeric(14,2)` tiene una coma que NO
 * separa parámetros.
 */
function partirArgumentos(args: string): string[] {
  const partes: string[] = []
  let profundidad = 0
  let actual = ''
  for (const ch of args) {
    if (ch === '(') profundidad++
    if (ch === ')') profundidad--
    if (ch === ',' && profundidad === 0) {
      partes.push(actual)
      actual = ''
      continue
    }
    actual += ch
  }
  if (actual.trim()) partes.push(actual)
  return partes
}

/** Firma normalizada a partir del texto entre paréntesis. */
export function firmaDeArgumentos(args: string): string {
  return partirArgumentos(args).map(tipoDeParametro).filter(Boolean).join(', ')
}

/**
 * Lee la lista de argumentos que empieza en `inicio` (el `(` de apertura),
 * respetando paréntesis anidados.
 * @returns el texto interior y el índice del `)` que cierra, o null.
 */
function leerArgumentos(sql: string, inicio: number): { args: string; fin: number } | null {
  if (sql[inicio] !== '(') return null
  let profundidad = 0
  for (let i = inicio; i < sql.length; i++) {
    if (sql[i] === '(') profundidad++
    else if (sql[i] === ')') {
      profundidad--
      if (profundidad === 0) return { args: sql.slice(inicio + 1, i), fin: i }
    }
  }
  return null
}

/**
 * Localiza el dollar-quote que abre el cuerpo y devuelve el cuerpo delimitado
 * por SU MISMO tag.
 *
 * Es el punto exacto del fallo anterior: un cuerpo abierto con `$$` se cerraba
 * con un `$fn$;` de cientos de líneas más abajo, arrastrando migraciones
 * enteras. Un `$fn$` que aparezca dentro de un cuerpo `$$` es texto, no cierre.
 */
function leerCuerpo(sql: string, desde: number): { cuerpo: string; delimitador: string } | null {
  const apertura = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g
  apertura.lastIndex = desde
  const abre = apertura.exec(sql)
  if (!abre) return null

  const tag = abre[0]
  const iCuerpo = abre.index + tag.length
  const cierre = sql.indexOf(tag, iCuerpo)
  if (cierre === -1) return null

  return { cuerpo: sql.slice(iCuerpo, cierre), delimitador: tag }
}

/**
 * Extrae TODAS las definiciones de funciones `public.*` de las migraciones, en
 * el orden en que se aplican.
 *
 * Los archivos se ordenan por nombre antes de interpretarlos: en este repo el
 * prefijo es la marca temporal, así que el orden lexicográfico ES el
 * cronológico, y de ahí sale cuál es la definición vigente.
 */
export function parsearFunciones(archivos: readonly ArchivoMigracion[]): DefinicionFuncion[] {
  const ordenados = [...archivos].sort((a, b) => a.archivo.localeCompare(b.archivo))
  const definiciones: DefinicionFuncion[] = []

  for (const { archivo, sql } of ordenados) {
    const patron = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi
    let m: RegExpExecArray | null
    while ((m = patron.exec(sql)) !== null) {
      const args = leerArgumentos(sql, m.index + m[0].length - 1)
      if (!args) continue
      const cuerpo = leerCuerpo(sql, args.fin)
      if (!cuerpo) continue

      definiciones.push({
        nombre: m[1],
        firma: firmaDeArgumentos(args.args),
        cuerpo: cuerpo.cuerpo,
        delimitador: cuerpo.delimitador,
        archivo,
      })
    }
  }

  return definiciones
}

/**
 * La definición VIGENTE de una firma exacta: la última cronológicamente.
 *
 * Pedir `conta_cierre_anual` sin firma es ambiguo —hay `(int)` y `(int, uuid)`,
 * con cuerpos y garantías distintas—, así que la firma es obligatoria.
 */
export function definicionVigente(
  definiciones: readonly DefinicionFuncion[],
  nombre: string,
  firma: string,
): DefinicionFuncion | null {
  const candidatas = definiciones.filter((d) => d.nombre === nombre && d.firma === firma)
  return candidatas.length > 0 ? candidatas[candidatas.length - 1] : null
}

/** Todas las firmas declaradas para un nombre, en orden de aplicación. */
export function firmasDe(definiciones: readonly DefinicionFuncion[], nombre: string): string[] {
  return [...new Set(definiciones.filter((d) => d.nombre === nombre).map((d) => d.firma))]
}

/**
 * ¿Se concedió EXECUTE a `rol` sobre ESTA firma exacta?
 *
 * También por firma: `GRANT ... conta_cierre_anual(int)` y
 * `conta_cierre_anual(int, uuid)` son concesiones distintas, y el GRANT puede
 * partir la línea antes del `TO`.
 */
export function concedidaA(
  sqlCompleto: string,
  nombre: string,
  firma: string,
  rol: string,
): boolean {
  const patron = new RegExp(
    `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+(?:public\\.)?${nombre}\\s*\\(([^)]*)\\)\\s*TO\\s+([^;]*);`,
    'gi',
  )
  let m: RegExpExecArray | null
  while ((m = patron.exec(sqlCompleto)) !== null) {
    if (firmaDeArgumentos(m[1]) !== firma) continue
    if (m[2].split(',').some((r) => r.trim().toLowerCase() === rol.toLowerCase())) return true
  }
  return false
}
