#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Reconstruye el esquema desde supabase/migrations en un Postgres desechable
// ════════════════════════════════════════════════════════════════════════════
//
// «Cómo se vería producción si el repositorio fuera la verdad.» Esa es la
// pregunta, y esto la contesta sin credenciales, sin red y sin tocar nada:
// `initdb` en un directorio temporal, el andamiaje de bootstrap.sql, y las
// migraciones en orden de versión, cada una en su propia transacción con
// ON_ERROR_STOP. Al terminar se saca la huella y el clúster se tira.
//
// POR QUÉ NO SE USA UNA RAMA PREVIEW DE SUPABASE. El DAG de despliegue de
// branching hace `Pull — retrieves database migrations from your main project`
// ANTES de `Migrate`: la rama hereda el historial de producción —incluidas las
// 307 versiones huérfanas— y por tanto reproduce producción, no el repositorio.
// Compararla contra producción daría verde sin haber probado nada. La Preview
// que sí construye sólo desde el repo es la de la integración Git, y exige
// abrir un PR. Un Postgres local no tiene ninguno de los dos problemas, no
// cuesta nada y no necesita permisos.
//
// SHIMS DE pg_net Y pg_cron. Fuera de Supabase esas extensiones no existen, y
// seis migraciones hacen `CREATE EXTENSION`. Se instala un control file vacío
// para que la sentencia tenga éxito; los objetos que las migraciones usan de
// verdad (net.http_post, cron.schedule, cron.job) los define bootstrap.sql.

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const AQUI = dirname(fileURLToPath(import.meta.url))
export const RAIZ = resolve(AQUI, '..', '..')
export const DIR_MIGRACIONES = join(RAIZ, 'supabase', 'migrations')

/** Binarios de Postgres: los del PATH o los de la instalación de Debian/Ubuntu. */
export function binarios() {
  try {
    const bin = execSync('pg_config --bindir', { encoding: 'utf8' }).trim()
    if (bin && existsSync(join(bin, 'initdb'))) return bin
  } catch { /* pg_config no está en el PATH */ }
  const candidatos = readdirSync('/usr/lib/postgresql', { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => join('/usr/lib/postgresql', d.name, 'bin'))
    .filter(p => existsSync(join(p, 'initdb')))
    .sort()
    .reverse()
  if (candidatos.length === 0) {
    throw new Error(
      'No se encontró Postgres. Instalá el servidor (no sólo el cliente): ' +
      'en Ubuntu, `sudo apt-get install -y postgresql`. `psql` solo no basta — ' +
      'hacen falta initdb y pg_ctl.',
    )
  }
  return candidatos[0]
}

/**
 * Postgres se niega a correr como root. En un runner de Actions el usuario ya
 * es normal y no hace falta nada; en un contenedor donde sí somos root se
 * delega en el usuario `postgres` del sistema.
 */
function comoServidor(bin, argv, opciones = {}) {
  const root = typeof process.getuid === 'function' && process.getuid() === 0
  return root
    ? execFileSync('runuser', ['-u', 'postgres', '--', join(bin, argv[0]), ...argv.slice(1)], opciones)
    : execFileSync(join(bin, argv[0]), argv.slice(1), opciones)
}

/** Instala los control files vacíos de pg_net/pg_cron si el servidor no los trae. */
function instalarShims(bin) {
  let dirExt
  try {
    dirExt = join(execSync(`${join(bin, 'pg_config')} --sharedir`, { encoding: 'utf8' }).trim(), 'extension')
  } catch { return [] }
  const puestos = []
  for (const ext of ['pg_net', 'pg_cron']) {
    const control = join(dirExt, `${ext}.control`)
    if (existsSync(control)) continue
    const controlTxt = "comment = 'shim vacío del auditor de drift de esquema'\ndefault_version = '1.0'\nrelocatable = true\n"
    const sqlTxt = '-- Sin objetos: los que las migraciones usan los define bootstrap.sql.\nSELECT 1;\n'
    try {
      writeFileSync(control, controlTxt)
      writeFileSync(join(dirExt, `${ext}--1.0.sql`), sqlTxt)
    } catch {
      // El directorio de extensiones es de root en una instalación de sistema.
      // En un runner de Actions el usuario tiene sudo sin contraseña; en un
      // contenedor donde ya somos root la rama de arriba habría funcionado.
      try {
        execFileSync('sudo', ['-n', 'tee', control], { input: controlTxt, stdio: ['pipe', 'ignore', 'ignore'] })
        execFileSync('sudo', ['-n', 'tee', join(dirExt, `${ext}--1.0.sql`)], { input: sqlTxt, stdio: ['pipe', 'ignore', 'ignore'] })
      } catch (err) {
        throw new Error(
          `No se pudo instalar el shim de ${ext} en ${dirExt}: ${err.message}\n` +
          `  Seis migraciones hacen CREATE EXTENSION ${ext}, que fuera de Supabase no existe.\n` +
          `  Solución: sudo tee ${control} <<'EOF'\n${controlTxt}EOF`,
        )
      }
    }
    puestos.push(ext)
  }
  return puestos
}

/** Las 449 migraciones, en el orden en que se aplican. */
export function listarMigraciones(dir = DIR_MIGRACIONES) {
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
}

/**
 * Levanta el clúster, aplica bootstrap + migraciones y devuelve un manejador
 * con `psql()` para consultarlo y `destruir()` para tirarlo.
 *
 * `dirMigraciones` permite reconstruir OTRO árbol de migraciones que el del
 * repositorio — así se obtiene M, la reconstrucción de la rama base, sin
 * cambiar de checkout. `bootstrap.sql` y `fingerprint.sql` salen siempre de
 * HEAD: si M y R se hashearan con serializaciones distintas, la comparación
 * mediría el cambio del auditor y no el del esquema.
 */
export function reconstruir({ log = () => {}, dirMigraciones = DIR_MIGRACIONES } = {}) {
  const bin = binarios()
  instalarShims(bin)

  const base = mkdtempSync(join(tmpdir(), 'drift-'))
  const datos = join(base, 'data')
  // El socket unix tiene un tope de 107 bytes: se usa un directorio corto.
  const socket = mkdtempSync(join(tmpdir(), 'ds-'))
  const root = typeof process.getuid === 'function' && process.getuid() === 0
  if (root) execSync(`chown -R postgres:postgres ${base} ${socket}`)

  const puerto = 5400 + (process.pid % 150)
  const entorno = { ...process.env, PGHOST: socket, PGPORT: String(puerto), PGUSER: 'postgres', PGDATABASE: 'postgres' }

  const psql = (args, opciones = {}) =>
    execFileSync(join(bin, 'psql'), args, { encoding: 'utf8', env: entorno, ...opciones })

  const destruir = () => {
    try { comoServidor(bin, ['pg_ctl', '-D', datos, 'stop', '-m', 'immediate'], { stdio: 'ignore' }) } catch { /* ya parado */ }
    for (const d of [base, socket]) { try { rmSync(d, { recursive: true, force: true }) } catch { /* nada que borrar */ } }
  }

  try {
    log('· initdb')
    comoServidor(bin, ['initdb', '-D', datos, '-U', 'postgres', '--encoding=UTF8', '--locale=C'], { stdio: 'ignore' })
    log('· arrancando')
    comoServidor(bin, ['pg_ctl', '-D', datos, '-o', `-k ${socket} -p ${puerto} -c listen_addresses=''`,
                       '-l', join(base, 'pg.log'), 'start'], { stdio: 'ignore' })

    // pg_ctl vuelve antes de aceptar conexiones; se espera al socket.
    let listo = false
    for (let i = 0; i < 60 && !listo; i++) {
      try { psql(['-tAc', 'select 1'], { stdio: 'pipe' }); listo = true } catch { execSync('sleep 1') }
    }
    if (!listo) throw new Error('El servidor no aceptó conexiones en 60 s. Revisá pg.log.')

    log('· bootstrap')
    psql(['-v', 'ON_ERROR_STOP=1', '-q', '-f', join(AQUI, 'bootstrap.sql')], { stdio: 'pipe' })

    const migraciones = listarMigraciones(dirMigraciones)
    log(`· aplicando ${migraciones.length} migraciones`)
    const fallos = []
    for (const m of migraciones) {
      try {
        psql(['-v', 'ON_ERROR_STOP=1', '-q', '-1', '-f', join(dirMigraciones, m)], { stdio: 'pipe' })
      } catch (err) {
        fallos.push({ migracion: m, error: String(err.stderr ?? err.message).trim().split('\n').slice(-3).join('\n') })
      }
    }
    return { psql, destruir, migraciones, fallos, entorno, dirMigraciones }
  } catch (err) {
    destruir()
    throw err
  }
}

/** Huella normalizada del esquema `public`: líneas `clave\thuella\tn`. */
export function huella(psql) {
  const salida = psql(['-tAq', '-f', join(AQUI, 'fingerprint.sql')], { stdio: 'pipe' })
  return salida.trim()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = reconstruir({ log: m => console.error(m) })
  try {
    if (db.fallos.length > 0) {
      console.error(`\n✗ ${db.fallos.length} migración(es) fallaron:`)
      for (const f of db.fallos) console.error(`  ${f.migracion}\n    ${f.error}`)
      process.exit(1)
    }
    console.error(`✓ ${db.migraciones.length}/${db.migraciones.length} migraciones aplicadas`)
    process.stdout.write(huella(db.psql) + '\n')
  } finally {
    db.destruir()
  }
}
