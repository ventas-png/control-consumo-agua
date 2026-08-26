#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿Existe en las migraciones cada columna que la app nombra en un .select()?
// ════════════════════════════════════════════════════════════════════════════
// EL AGUJERO QUE ESTO TAPA. `cuotas_condominio.fecha_pago`, `.metodo_pago` y
// `.referencia_pago` vivían SÓLO en producción: alguien las añadió a mano y
// nunca se capturaron en una migración. Producción funcionaba, así que nadie
// lo notó — hasta que el sandbox de los E2E, construido entero desde
// supabase/migrations, devolvió 400 en la proyección de cuotas. runQuery se
// come el error, la proyección queda vacía, y la pestaña de cobranza se
// degrada EN SILENCIO a leer el `estado` legacy que las transiciones ya no
// escriben: «📤 Emitir» seguía apareciendo en filas ya emitidas.
//
// Lo caro no fue el arreglo (una migración de siete ADD COLUMN) sino el
// diagnóstico: el síntoma visible era una prueba de Playwright contando
// botones. Esto lo convierte en un fallo de `npm test`, con el nombre de la
// columna y de la tabla.
//
// ALCANCE, DECLARADO. Sólo se analizan los `.select()` que se pueden entender
// SIN AMBIGÜEDAD: una lista de columnas literal (directa o a través de una
// constante del mismo archivo). Se descartan los que traen '*' o recursos
// embebidos de PostgREST — `*, unidades(nombre)` — porque ahí las columnas no
// son del `from` sino de la tabla embebida, y adivinar produciría falsos
// positivos. Tampoco se juzgan las tablas sin CREATE TABLE en las migraciones
// (vistas, tablas del esquema auth). `analizar()` DEVUELVE esos descartes y la
// prueba los imprime: un recorte silencioso se leería como "está todo
// cubierto" cuando no lo está.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Palabras que aparecen en una lista de columnas pero no son columnas. */
const NO_ES_COLUMNA = /^(count|\*)$/

/** Parte el cuerpo de un CREATE TABLE por sus comas de PRIMER nivel. */
export function partirEnComasDePrimerNivel(cuerpo) {
  const trozos = []
  let profundidad = 0
  let actual = ''
  for (const ch of cuerpo) {
    if (ch === '(') profundidad += 1
    else if (ch === ')') profundidad -= 1
    if (ch === ',' && profundidad === 0) {
      trozos.push(actual)
      actual = ''
      continue
    }
    actual += ch
  }
  if (actual.trim()) trozos.push(actual)
  return trozos
}

/**
 * Columnas que cada CREATE TABLE / ALTER TABLE … ADD COLUMN deja en cada tabla.
 * @returns {Map<string, Set<string>>} tabla → columnas
 */
export function columnasDeLasMigraciones(sqls) {
  const porTabla = new Map()
  const agregar = (tabla, columna) => {
    if (!porTabla.has(tabla)) porTabla.set(tabla, new Set())
    porTabla.get(tabla).add(columna)
  }

  for (const sql of sqls) {
    const limpio = sql.replace(/--[^\n]*/g, '')

    // CREATE TABLE [IF NOT EXISTS] [public.]t ( … ) — el cuerpo se corta por
    // las comas de PRIMER nivel (las de numeric(12,2) o de un CHECK van
    // anidadas) y de cada trozo se toma el primer identificador.
    const crea = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi
    for (const m of limpio.matchAll(crea)) {
      const [, tabla, cuerpo] = m
      for (const trozo of partirEnComasDePrimerNivel(cuerpo)) {
        const nombre = trozo.trim().replace(/^"|"$/g, '').split(/[\s(]/)[0]
        // CONSTRAINT/PRIMARY KEY/UNIQUE/CHECK/… definen la tabla, no columnas.
        if (!/^\w+$/.test(nombre)) continue
        if (/^(constraint|primary|unique|check|foreign|exclude|like)$/i.test(nombre)) continue
        agregar(tabla, nombre)
      }
    }

    // ALTER TABLE [public.]t … ADD COLUMN [IF NOT EXISTS] c … (una o varias).
    const altera = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?([\s\S]*?);/gi
    for (const m of limpio.matchAll(altera)) {
      const [, tabla, resto] = m
      const add = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi
      for (const a of resto.matchAll(add)) agregar(tabla, a[1])
    }
  }
  return porTabla
}

/** Constantes `const X = '…'` o `const X = \`…\`` del propio archivo. */
export function constantesDe(codigo) {
  const consts = new Map()
  const re = /const\s+(\w+)\s*=\s*(`[^`]*`|'[^']*')/g
  for (const m of codigo.matchAll(re)) consts.set(m[1], m[2].slice(1, -1))
  return consts
}

/**
 * Extrae los pares (tabla, columnas) de un archivo fuente.
 * @returns {{ usos: {tabla:string, columnas:string[]}[], descartados: string[] }}
 */
export function selectsDe(codigo, archivo = '?') {
  const consts = constantesDe(codigo)
  const usos = []
  const descartados = []

  // .from('t') … .select(<argumento>) — el .select puede venir varias líneas
  // después (encadenado con filtros), así que se busca el PRIMERO tras el from.
  //
  // El tramo intermedio se escribe con lookahead negativo —(?!\.from\()— en
  // vez de filtrar después: si se deja que el tramo trague otro .from() y se
  // descarta el match a posteriori, matchAll ya avanzó el índice por encima de
  // ese segundo .from(), que entonces NO se analiza nunca. Con el lookahead el
  // match falla en la posición y el motor reintenta desde el .from() siguiente.
  const re = /\.from\(\s*'(\w+)'\s*\)((?:(?!\.from\()[\s\S]){0,600}?)\.select\(\s*(`[^`]*`|'[^']*'|\w+)/g
  for (const m of codigo.matchAll(re)) {
    const [, tabla, , arg] = m

    const crudo = /^[`']/.test(arg) ? arg.slice(1, -1) : consts.get(arg)
    if (crudo == null) {
      descartados.push(`${archivo}: ${tabla} — .select(${arg}) no es literal ni constante local`)
      continue
    }
    if (crudo.includes('*') || crudo.includes('(')) {
      descartados.push(`${archivo}: ${tabla} — .select() con '*' o recurso embebido`)
      continue
    }
    const columnas = crudo
      .split(',')
      .map((c) => c.trim().split(':').pop().trim())
      .filter((c) => c && !NO_ES_COLUMNA.test(c))
    if (columnas.length === 0) continue
    if (columnas.some((c) => !/^\w+$/.test(c))) {
      descartados.push(`${archivo}: ${tabla} — .select() con sintaxis que no sé leer`)
      continue
    }
    usos.push({ tabla, columnas })
  }
  return { usos, descartados }
}

/** Todos los .sql de un directorio, en orden. */
export function leerMigraciones(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
}

/** Todos los .ts/.tsx bajo un directorio, recursivo. */
export function fuentesDe(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...fuentesDe(p))
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * @returns {{ faltantes: string[], descartados: string[], sinCreateTable: string[], comprobadas: number }}
 */
export function analizar({ dirMigraciones, archivos, leer = (p) => readFileSync(p, 'utf8') }) {
  const porTabla = columnasDeLasMigraciones(leerMigraciones(dirMigraciones))
  const faltantes = []
  const descartados = []
  const sinCreateTable = new Set()
  let comprobadas = 0

  for (const archivo of archivos) {
    const { usos, descartados: d } = selectsDe(leer(archivo), archivo)
    descartados.push(...d)
    for (const { tabla, columnas } of usos) {
      const conocidas = porTabla.get(tabla)
      if (!conocidas) {
        sinCreateTable.add(`${tabla} (visto en ${archivo})`)
        continue
      }
      for (const columna of columnas) {
        comprobadas += 1
        if (!conocidas.has(columna)) faltantes.push(`${tabla}.${columna} — ${archivo}`)
      }
    }
  }
  return { faltantes, descartados, sinCreateTable: [...sinCreateTable], comprobadas }
}
