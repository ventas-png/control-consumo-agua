// Lectura de las migraciones SQL del repositorio para las pruebas que contrastan la PANTALLA con lo que la base siembra o levanta:
// el catálogo de permisos que siembran los INSERT y los rechazos COMPRAS_* que levantan los RAISE EXCEPTION.
//
// No es un intérprete de SQL: lee solo las formas que las migraciones del repositorio usan y, cuando no entiende una, la prueba que
// lo usa FALLA en voz alta («llave sin sembrar», «ERRCODE desconocido») en vez de dar un verde vacío. Formas que entiende:
//  · INSERT INTO [public.]permissions [(columnas)] VALUES (…), (…)       — filas de literales; sin lista de columnas, el orden es
//    key, category, label, description
//  · INSERT INTO [public.]permissions [(columnas)] SELECT 'k','c','l','d' [UNION ALL SELECT …]  y  … FROM (VALUES (…)) v
//  · RAISE EXCEPTION 'COMPRAS_X: texto %', args USING ERRCODE = nombre_de_condicion | 'XXXXX'  (sin ERRCODE → P0001)
// Quedan fuera (y las pruebas lo dirían): filas construidas con funciones (`format`, `unnest`, `||`) o literales con `$$`.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Carpeta de las migraciones. `MIGRACIONES_DIR` la cambia: así una migración que aún no está integrada al repositorio se contrasta
 * desde una carpeta temporal (enlaces a las existentes + la nueva) sin tocar `supabase/migrations`.
 */
export function dirMigraciones(): string {
  return resolve(process.env.MIGRACIONES_DIR ?? 'supabase/migrations')
}

export interface Migracion { nombre: string; sql: string }

/** Las migraciones `.sql` de la carpeta, en orden de nombre (= orden de aplicación). */
export function leerMigraciones(dir: string = dirMigraciones()): Migracion[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => n.endsWith('.sql')).sort().map((nombre) => ({ nombre, sql: readFileSync(resolve(dir, nombre), 'utf8') }))
}

/** Quita los comentarios de línea (`--`) y de bloque sin tocar lo que está dentro de literales `'…'`. */
export function sinComentarios(sql: string): string {
  let salida = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") break
        else j++
      }
      salida += sql.slice(i, j + 1)
      i = j + 1
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
    } else if (c === '/' && sql[i + 1] === '*') {
      const fin = sql.indexOf('*/', i + 2)
      i = fin === -1 ? sql.length : fin + 2
      salida += ' '
    } else {
      salida += c
      i++
    }
  }
  return salida
}

/** Parte en sentencias por `;` que no esté dentro de un literal. Los cuerpos `$$…$$` se parten también: interesan sus sentencias. */
export function sentencias(sql: string): string[] {
  const limpio = sinComentarios(sql)
  const partes: string[] = []
  let desde = 0
  let i = 0
  while (i < limpio.length) {
    if (limpio[i] === "'") {
      i++
      while (i < limpio.length) {
        if (limpio[i] === "'" && limpio[i + 1] === "'") i += 2
        else if (limpio[i] === "'") break
        else i++
      }
      i++
    } else if (limpio[i] === ';') {
      partes.push(limpio.slice(desde, i))
      desde = ++i
    } else i++
  }
  if (limpio.slice(desde).trim()) partes.push(limpio.slice(desde))
  return partes
}

const LITERAL = String.raw`'(?:[^']|'')*'`
const desescapar = (literal: string) => literal.slice(1, -1).replace(/''/g, "'")

// ── Catálogo de permisos ────────────────────────────────────────────────────

export interface PermisoSembrado { key: string; category: string; label: string; description: string | null }

const COLUMNAS_POR_OMISION = ['key', 'category', 'label', 'description']

/** Las filas de literales que los `INSERT INTO [public.]permissions` de este SQL siembran (ver el encabezado del archivo). */
export function permisosSembrados(sql: string): PermisoSembrado[] {
  if (!/INSERT\s+INTO\s+(?:public\s*\.\s*)?"?permissions"?\b/i.test(sql)) return []
  const filas: PermisoSembrado[] = []
  for (const sentencia of sentencias(sql)) {
    const inicio = /INSERT\s+INTO\s+(?:public\s*\.\s*)?"?permissions"?\s*(\(([^)]*)\))?/i.exec(sentencia)
    if (!inicio) continue
    const columnas = inicio[2] ? inicio[2].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase()) : COLUMNAS_POR_OMISION
    const resto = sentencia.slice(inicio.index + inicio[0].length)
    const campos = `(${LITERAL}|NULL)`
    const separador = String.raw`\s*,\s*`
    const hasta = columnas.length
    const fila = (apertura: string, cierre: string) =>
      new RegExp(`${apertura}\\s*${Array.from({ length: hasta }, () => campos).join(separador)}\\s*${cierre}`, 'gi')
    const crudas: string[][] = []
    for (const m of resto.matchAll(fila(String.raw`\(`, String.raw`\)`))) crudas.push(m.slice(1))
    for (const m of resto.matchAll(fila(String.raw`\bSELECT\b`, String.raw`(?=\s*(?:UNION\b|FROM\b|ON\b|;|$))`))) crudas.push(m.slice(1))
    for (const valores of crudas) {
      const registro: Record<string, string | null> = {}
      columnas.forEach((c, k) => { registro[c] = /^null$/i.test(valores[k]) ? null : desescapar(valores[k]) })
      if (registro.key) {
        filas.push({ key: registro.key, category: registro.category ?? '', label: registro.label ?? '', description: registro.description ?? null })
      }
    }
  }
  return filas
}

// ── Rechazos que levanta la base ────────────────────────────────────────────

export interface RechazoSql {
  /** Código del prefijo del mensaje (COMPRAS_PERMISO_ACCION…). */
  codigo: string
  /** El mensaje completo tal como está escrito (con sus `%` sin sustituir). */
  texto: string
  /** SQLSTATE de cinco caracteres. */
  sqlstate: string
}

/** Condiciones con nombre de PL/pgSQL → SQLSTATE (las que usan las migraciones; una distinta hace fallar la lectura a propósito). */
const SQLSTATE_POR_CONDICION: Record<string, string> = {
  insufficient_privilege: '42501',
  check_violation: '23514',
  invalid_parameter_value: '22023',
  no_data_found: 'P0002',
  serialization_failure: '40001',
  internal_error: 'XX000',
  raise_exception: 'P0001',
  unique_violation: '23505',
  foreign_key_violation: '23503',
  not_null_violation: '23502',
  invalid_text_representation: '22P02',
  data_exception: '22000',
  lock_not_available: '55P03',
  too_many_rows: 'P0003',
}

function sqlstateDe(resto: string): string {
  // `ERRCODE = insufficient_privilege`, `ERRCODE = 'check_violation'` (nombre de condición, con o sin comillas) o `ERRCODE = '42501'`
  const e = /ERRCODE\s*=\s*'?([A-Za-z0-9_]+)'?/i.exec(resto)
  if (!e) return 'P0001'
  if (/^[0-9A-Z]{5}$/.test(e[1])) return e[1]
  const sqlstate = SQLSTATE_POR_CONDICION[e[1].toLowerCase()]
  if (!sqlstate) throw new Error(`ERRCODE desconocido «${e[1]}»: añádelo a SQLSTATE_POR_CONDICION de src/test/sqlMigraciones.ts`)
  return sqlstate
}

/** Los `RAISE EXCEPTION 'COMPRAS_…: …'` de este SQL, con su SQLSTATE. */
export function rechazosCompras(sql: string): RechazoSql[] {
  const salida: RechazoSql[] = []
  for (const sentencia of sentencias(sql)) {
    for (const m of sentencia.matchAll(new RegExp(String.raw`RAISE\s+EXCEPTION\s+(${LITERAL})([\s\S]*)$`, 'gi'))) {
      const texto = desescapar(m[1])
      const codigo = /^(COMPRAS_[A-Z0-9_]+):/.exec(texto)?.[1]
      if (codigo) salida.push({ codigo, texto, sqlstate: sqlstateDe(m[2]) })
    }
  }
  return salida
}
