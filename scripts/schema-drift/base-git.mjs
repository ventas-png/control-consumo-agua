#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Traer la rama base al disco para poder reconstruirla
// ════════════════════════════════════════════════════════════════════════════
//
// M —la reconstrucción de la rama base— necesita los archivos de migración tal
// como están en esa ref, no en el árbol de trabajo. Todo esto es plumbing de
// git con `git` inyectable, para que las pruebas no necesiten un repositorio.
//
// NADA SE RESUELVE «POR LAS DUDAS». Igual que en `baselineDeLaBase`, cada
// error de git se distingue y se propaga: una ref que no existe, un árbol que
// no está y un directorio ausente son tres problemas distintos, y confundirlos
// con «no hay nada que comparar» apagaría la comparación de tres vías en
// silencio, que es peor que no tenerla.

import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DIR_EN_GIT = 'supabase/migrations'

export const gitReal = (args, opciones = {}) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opciones })

/**
 * Comprueba que la ref existe Y que sus objetos están presentes. Un clon
 * superficial deja resolver la ref sin tener el árbol, y ahí `git show` falla
 * con un mensaje que se parece demasiado a «el archivo no está».
 */
export function exigirRefCompleta(ref, git = gitReal) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  } catch {
    throw new Error(
      `La referencia base «${ref}» no existe en este repositorio. Sin ella no hay comparación ` +
      'de tres vías: se aborta en vez de degradar a la de dos. En CI suele ser un checkout ' +
      'sin la rama base — usá `fetch-depth: 0`.',
    )
  }
  try {
    git(['cat-file', '-e', `${ref}^{tree}`])
  } catch {
    throw new Error(
      `La referencia «${ref}» resuelve pero su árbol no está presente: el checkout es superficial ` +
      'o parcial. No se puede reconstruir la rama base. Usá `fetch-depth: 0`.',
    )
  }
}

/**
 * Migraciones en una ref: Map nombre → hash del blob.
 *
 * EL HASH, NO SÓLO EL NOMBRE. Comparar nombres detecta migraciones agregadas y
 * borradas, pero no una histórica reescrita en su sitio — que es la forma más
 * limpia de cambiar lo que el repositorio dice que pasó sin que se note.
 */
export function migracionesEnRef(ref, git = gitReal) {
  exigirRefCompleta(ref, git)
  let salida
  try {
    salida = git(['ls-tree', '-r', '-z', `${ref}`, '--', `${DIR_EN_GIT}/`])
  } catch (err) {
    throw new Error(`No se pudo listar ${DIR_EN_GIT} en «${ref}»: ${String(err.stderr ?? err.message).trim()}`)
  }
  const mapa = new Map()
  for (const registro of salida.split('\0')) {
    if (!registro.trim()) continue
    // «<modo> <tipo> <objeto>\t<ruta>»
    const [meta, ruta] = registro.split('\t')
    if (!ruta) continue
    const [, tipo, objeto] = meta.trim().split(/\s+/)
    if (tipo !== 'blob' || !ruta.endsWith('.sql')) continue
    mapa.set(ruta.slice(DIR_EN_GIT.length + 1), objeto)
  }
  if (mapa.size === 0) {
    throw new Error(
      `«${ref}» no tiene ninguna migración en ${DIR_EN_GIT}. Un directorio vacío haría que todo ` +
      'el esquema pareciera un cambio planificado de este PR. Se aborta.',
    )
  }
  return mapa
}

/**
 * Migraciones del árbol de trabajo: Map nombre → hash del blob.
 *
 * Se hashea el archivo EN DISCO, no el de HEAD, porque eso es exactamente lo
 * que se va a reconstruir. Una migración modificada y sin commitear tiene que
 * verse igual que una commiteada.
 */
export function migracionesEnDisco(dir, git = gitReal) {
  const nombres = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  if (nombres.length === 0) throw new Error(`No hay migraciones en ${dir}.`)
  // Un solo `hash-object` para todas: 450 procesos serían 450 fork().
  // `input` exige stdin en «pipe»: el `gitReal` por defecto lo ignora.
  const salida = git(['hash-object', '--stdin-paths'], {
    input: nombres.map(n => join(dir, n)).join('\n') + '\n',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const hashes = salida.trim().split('\n')
  if (hashes.length !== nombres.length) {
    throw new Error(`git hash-object devolvió ${hashes.length} hashes para ${nombres.length} archivos.`)
  }
  return new Map(nombres.map((n, i) => [n, hashes[i]]))
}

/** Escribe en `destino` las migraciones de `ref`, para reconstruir la base. */
export function materializarMigraciones(ref, destino, git = gitReal) {
  const mapa = migracionesEnRef(ref, git)
  for (const nombre of mapa.keys()) {
    writeFileSync(join(destino, nombre), git(['show', `${ref}:${DIR_EN_GIT}/${nombre}`]))
  }
  return [...mapa.keys()].sort()
}

/**
 * Qué ref usar como M.
 *
 *   pull_request  el merge-base con la rama base. No `base.sha` a secas: si la
 *                 base avanzó desde que se abrió el PR, comparar contra su
 *                 punta atribuiría al PR cambios que no hizo.
 *   push a main   `github.event.before`, y si no resuelve —push forzado, rama
 *                 nueva, el commit vacío de creación— el primer padre.
 *
 * Nunca devuelve algo que no exista: si ninguna alternativa resuelve, lanza.
 */
export function resolverRefBase({ evento, baseRef, antes, cabeza = 'HEAD' }, git = gitReal) {
  const existe = (ref) => {
    if (!ref || /^0{7,40}$/.test(ref)) return false
    try { git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); return true } catch { return false }
  }

  if (evento === 'pull_request') {
    if (!existe(baseRef)) {
      throw new Error(`La rama base «${baseRef}» no está en el checkout. Usá \`fetch-depth: 0\`.`)
    }
    const mb = git(['merge-base', baseRef, cabeza]).trim()
    if (!mb) throw new Error(`No hay merge-base entre «${baseRef}» y ${cabeza}.`)
    return { ref: mb, origen: `merge-base(${baseRef}, ${cabeza})` }
  }

  if (existe(antes)) return { ref: antes, origen: 'github.event.before' }
  if (existe(`${cabeza}^`)) return { ref: `${cabeza}^`, origen: 'primer padre' }
  throw new Error(
    'No se pudo resolver la rama base: `github.event.before` no existe en el checkout y ' +
    `${cabeza} no tiene padre. Sin M no hay comparación de tres vías y no se degrada a dos.`,
  )
}

// ── CLI: resolver M para el workflow ────────────────────────────────────────
//
// El workflow no reimplementa esta lógica en bash: llama acá, para que lo que
// corre en CI sea exactamente lo que prueban `__tests__/base-git.test.mjs`.
// Imprime la ref en stdout; cualquier problema sale por stderr con código 1.
if (process.argv[1] && process.argv[1].endsWith('base-git.mjs')) {
  const valor = (n) => { const i = process.argv.indexOf(n); return i === -1 ? '' : (process.argv[i + 1] ?? '') }
  try {
    const { ref, origen } = resolverRefBase({
      evento: valor('--evento'),
      baseRef: valor('--rama-base'),
      antes: valor('--antes'),
    })
    console.error(`· M = ${ref}  (${origen})`)
    process.stdout.write(ref + '\n')
  } catch (err) {
    console.error(`✗ ${err.message}`)
    process.exit(1)
  }
}
