#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Valida el input `migration_file` del workflow_dispatch de apply-migrations-prod.
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ
// El dispatch manual con `migration_file` era la única entrada de este workflow
// que NO pasaba por ningún filtro: el job comprobaba `[ -f "$MIG_DIR/$INPUT_FILE" ]`
// y nada más. Eso deja dos agujeros contra la base de PRODUCCIÓN:
//
//   1. RUTA. `-f` acepta cualquier cosa que resuelva a un archivo existente, así
//      que `../../scripts/backfill-schema-migrations.sql` o una ruta absoluta
//      salían de supabase/migrations y su contenido se mandaba tal cual al
//      endpoint /database/query. El archivo elegido no tenía por qué ser una
//      migración.
//   2. VERSIÓN YA APLICADA. El modo reconciliar consulta el historial remoto y
//      salta lo ya registrado; el modo archivo-explícito no lo miraba. Reaplicar
//      una migración histórica es exactamente lo que rompió producción el
//      2026-08-03: `20260320000000_fix_superadmin_app_users_uuid` empieza con
//      `DROP TABLE IF EXISTS public.app_users CASCADE` y se llevó por delante
//      todos los perfiles. El cortafuegos append-only sólo cubre `push`
//      (github.event_name == 'push'), así que el dispatch lo esquivaba entero.
//
// QUÉ IMPONE
//   · basename PURO dentro de supabase/migrations: sin `/`, sin `\`, sin `..`,
//     sin rutas absolutas. Se comprueba ADEMÁS que la ruta resuelta siga dentro
//     del directorio (defensa en profundidad: si el regex se relajara, la
//     contención sigue).
//   · Formato canónico `<14 dígitos>_<nombre>.sql`, el mismo `^(\d{14})_` que
//     usa migrations-guard.mjs. Un `.sql` suelto sin versión no es una migración
//     y no se puede registrar en schema_migrations.
//   · Versión NO registrada ya en el historial remoto. Una corrección se hace
//     con una migración NUEVA de timestamp posterior — nunca reaplicando una
//     histórica.
//
// La lógica es PURA y se exporta para poder probarla sin red ni Actions
// (scripts/__tests__/validar-migration-dispatch.test.mjs); `main()` es sólo el
// envoltorio que lee argv y traduce a códigos de salida + ::error:: de Actions.

import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Formato canónico de una migración: 14 dígitos, guion bajo, nombre, `.sql`. */
export const RE_MIGRACION = /^(\d{14})_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/

/**
 * ¿El input es un basename limpio (sin componentes de ruta)?
 * Se rechaza ANTES del formato para poder dar un mensaje específico: un
 * traversal y un nombre mal escrito son errores distintos.
 */
export function tieneComponentesDeRuta(input) {
  // `..` se rechaza en CUALQUIER posición, no sólo como componente suelto:
  // ninguna de las 449 migraciones del repo lo lleva en el nombre, así que no
  // hay nada legítimo que perder y sí un caso menos que razonar.
  return input.includes('/') || input.includes('\\') || input.includes('..')
}

/**
 * Valida el nombre recibido. Devuelve `{ ok: true, base, version }` o
 * `{ ok: false, code, mensaje }` con `code` en:
 * 'vacio' | 'ruta' | 'formato' | 'inexistente' | 'fuera_del_directorio'.
 *
 * `dir` es opcional: si se pasa, se comprueba existencia y contención real.
 */
export function validarBasename(input, dir = null, existe = existsSync) {
  const valor = String(input ?? '').trim()

  if (!valor) {
    return { ok: false, code: 'vacio', mensaje: 'migration_file vacío.' }
  }

  if (tieneComponentesDeRuta(valor)) {
    return {
      ok: false,
      code: 'ruta',
      mensaje:
        `migration_file debe ser el NOMBRE del archivo dentro de supabase/migrations, ` +
        `no una ruta: recibido "${valor}". Sin "/", sin "\\", sin ".." y sin rutas absolutas.`,
    }
  }

  const m = RE_MIGRACION.exec(valor)
  if (!m) {
    return {
      ok: false,
      code: 'formato',
      mensaje:
        `migration_file no tiene formato de migración: recibido "${valor}". ` +
        `Se espera <14 dígitos>_<nombre>.sql (p. ej. 20260907001200_rbac_seccion_recursos_humanos.sql).`,
    }
  }

  if (dir) {
    // Contención real: aunque el regex ya lo impide, si algún día se relaja, la
    // ruta resuelta tiene que seguir colgando del directorio de migraciones.
    const raiz = resolve(dir)
    const destino = resolve(raiz, valor)
    if (destino !== raiz && !destino.startsWith(raiz + sep)) {
      return {
        ok: false,
        code: 'fuera_del_directorio',
        mensaje: `migration_file resuelve fuera de ${dir}: "${valor}".`,
      }
    }
    if (!existe(destino)) {
      return { ok: false, code: 'inexistente', mensaje: `No existe ${dir}/${valor}` }
    }
  }

  return { ok: true, base: valor, version: m[1] }
}

/** ¿La versión ya está registrada en el historial remoto? Comparación exacta. */
export function versionYaAplicada(version, aplicadas) {
  return (aplicadas ?? []).some((v) => String(v).trim() === version)
}

/**
 * Validación completa del dispatch: nombre + versión no reaplicada.
 * `aplicadas` es la lista de versiones de supabase_migrations.schema_migrations.
 */
export function validarDispatch({ input, dir = null, aplicadas = [], existe = existsSync }) {
  const base = validarBasename(input, dir, existe)
  if (!base.ok) return base

  if (versionYaAplicada(base.version, aplicadas)) {
    return {
      ok: false,
      code: 'ya_aplicada',
      version: base.version,
      mensaje:
        `La versión ${base.version} (${base.base}) YA está registrada en ` +
        `supabase_migrations.schema_migrations: reaplicarla ejecutaría de nuevo su DDL ` +
        `contra producción. El 2026-08-03 esa clase de reaplicación corrió un ` +
        `DROP TABLE ... CASCADE sobre app_users. Una corrección se hace con una ` +
        `migración NUEVA de timestamp posterior (append-only), nunca reaplicando una histórica.`,
    }
  }

  return base
}

/** Lee las versiones aplicadas de un archivo (una por línea). Ausente → []. */
export function leerAplicadas(ruta, leer = readFileSync) {
  if (!ruta) return []
  try {
    return String(leer(ruta, 'utf8'))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function arg(argv, nombre) {
  const i = argv.indexOf(nombre)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}

export function main(argv = process.argv.slice(2), registrar = console.error) {
  const input = arg(argv, '--file')
  const dir = arg(argv, '--dir')
  const rutaAplicadas = arg(argv, '--aplicadas')

  const res = validarDispatch({
    input,
    dir,
    aplicadas: leerAplicadas(rutaAplicadas),
  })

  if (!res.ok) {
    registrar(`::error::${res.mensaje}`)
    return 1
  }
  console.log(`✅ migration_file válido: ${res.base} (versión ${res.version}, no aplicada).`)
  return 0
}

const esModuloPrincipal =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (esModuloPrincipal) process.exit(main())
