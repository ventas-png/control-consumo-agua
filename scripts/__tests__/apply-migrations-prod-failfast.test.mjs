// ════════════════════════════════════════════════════════════════════════════
// apply-migrations-prod: al fallar una migración, NO se intentan las siguientes
// ════════════════════════════════════════════════════════════════════════════
// EL INCIDENTE QUE ESTO IMPIDE. El 2026-08-27 (run 33095288091) el bucle de
// aplicación tenía `continue` en la rama de fallo. 20260904000100 respondió 400
// —le faltaba una columna en el esquema real de producción— y el workflow
// siguió: aplicó 000200 y 000300 encima, y las registró. Producción quedó con
// dos migraciones de la serie puestas, una revertida y otra que ni podía
// correr; el frontend del mismo push contaba con las cuatro.
//
// Una serie de migraciones es una secuencia: la N+1 da por hecho lo que hizo la
// N. Seguir tras un fallo no adelanta trabajo, produce un estado híbrido.
//
// CÓMO SE PRUEBA. No leyendo el YAML en busca de la palabra `break` —eso pasa
// en verde con cualquier refactor que rompa el comportamiento—, sino EJECUTANDO
// el script del paso con un `curl` falso en el PATH que devuelve 400 en la
// primera migración y 201 en las demás. Después se cuenta cuántas se
// intentaron: tienen que ser exactamente una.
// ════════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WORKFLOW = join(RAIZ, '.github/workflows/apply-migrations-prod.yml')

/**
 * Cuerpo del `run:` de un paso, sin la indentación del bloque YAML.
 * No se usa un parser de YAML porque el repositorio no tiene ninguno; a cambio,
 * si el paso deja de existir o cambia de forma, esto FALLA en vez de devolver
 * vacío y dar un verde hueco.
 */
function cuerpoDelPaso(nombre) {
  const lineas = readFileSync(WORKFLOW, 'utf8').split('\n')
  const iPaso = lineas.findIndex(l => l.trim() === `- name: ${nombre}`)
  if (iPaso === -1) throw new Error(`No existe el paso "${nombre}" en ${WORKFLOW}`)
  const iRun = lineas.findIndex((l, i) => i > iPaso && /^\s+run: \|\s*$/.test(l))
  if (iRun === -1) throw new Error(`El paso "${nombre}" no tiene un bloque \`run: |\``)

  const sangria = lineas[iRun + 1].match(/^\s*/)[0].length
  const cuerpo = []
  for (let i = iRun + 1; i < lineas.length; i += 1) {
    const l = lineas[i]
    if (l.trim() === '') { cuerpo.push(''); continue }
    if (l.match(/^\s*/)[0].length < sangria) break
    cuerpo.push(l.slice(sangria))
  }
  return cuerpo.join('\n')
}

/**
 * Ejecuta el paso de aplicación con un `curl` falso.
 * @param {number[]} codigos código HTTP del APPLY de cada migración, en orden.
 * @param {{histCodigos?:number[], histCuerpos?:string[]}} [op] respuesta del
 *   REGISTRO en schema_migrations por migración: código HTTP y cuerpo crudo.
 *   Por defecto 201 con `[]` (lo que devuelve la Management API en un DDL ok).
 * @returns {{estado:number, intentadas:string[], registradas:string[], resumen:string, salida:string}}
 */
function aplicar(codigos, op = {}) {
  const histCodigos = op.histCodigos ?? codigos.map(() => 201)
  const histCuerpos = op.histCuerpos ?? codigos.map(() => '[]')
  const dir = mkdtempSync(join(tmpdir(), 'applyprod-'))
  try {
    const migDir = join(dir, 'supabase/migrations')
    mkdirSync(migDir, { recursive: true })
    const archivos = codigos.map((_, i) => {
      const nombre = `2099010100000${i}_paso${i}.sql`
      writeFileSync(join(migDir, nombre), `-- MARCA:paso${i}\nselect 1;\n`)
      return `supabase/migrations/${nombre}`
    })

    // `curl` falso: distingue la aplicación (payload = el .sql, con su MARCA)
    // del registro en el historial (payload = insert into schema_migrations),
    // y respeta el contrato real — cuerpo al archivo de `-o`, código por stdout.
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
salida=""
payload=""
prev=""
for a in "$@"; do
  [ "$prev" = "-o" ] && salida="$a"
  [ "$prev" = "-d" ] && payload="$a"
  prev="$a"
done
if grep -q 'insert into supabase_migrations' <<<"$payload"; then
  echo "$payload" | grep -o "values ('[0-9]*'" >> "${dir}/registradas.log"
  ver=$(grep -o "values ('[0-9]*'" <<<"$payload" | grep -o '[0-9]*')
  n=\${ver: -1}
  hcodigo=$(sed -n "$((n + 1))p" "${dir}/hist-codigos.txt")
  hcuerpo=$(sed -n "$((n + 1))p" "${dir}/hist-cuerpos.txt")
  [ -n "$salida" ] && printf '%s' "$hcuerpo" > "$salida"
  echo "$hcodigo"
  exit 0
fi
marca=$(grep -o 'MARCA:paso[0-9]*' <<<"$payload" | head -1)
echo "$marca" >> "${dir}/intentadas.log"
n=\${marca##*paso}
codigo=$(sed -n "$((n + 1))p" "${dir}/codigos.txt")
if [ "$codigo" = "201" ]; then
  [ -n "$salida" ] && echo '[]' > "$salida"
else
  [ -n "$salida" ] && echo '{"message":"Failed to run sql query: ERROR: 42703"}' > "$salida"
fi
echo "$codigo"
`)
    chmodSync(join(bin, 'curl'), 0o755)
    writeFileSync(join(dir, 'codigos.txt'), codigos.join('\n') + '\n')
    writeFileSync(join(dir, 'hist-codigos.txt'), histCodigos.join('\n') + '\n')
    writeFileSync(join(dir, 'hist-cuerpos.txt'), histCuerpos.join('\n') + '\n')
    writeFileSync(join(dir, 'intentadas.log'), '')
    writeFileSync(join(dir, 'registradas.log'), '')

    const guion = join(dir, 'paso.sh')
    writeFileSync(guion, cuerpoDelPaso('Apply migrations via Management API'))

    const resumen = join(dir, 'summary.md')
    writeFileSync(resumen, '')

    let estado = 0
    let salida = ''
    try {
      salida = execFileSync('bash', [guion], {
        cwd: dir,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FILES: archivos.join(' '),
          API_URL: 'https://ejemplo.invalido/query',
          ACCESS_TOKEN: 'token-de-prueba',
          GITHUB_STEP_SUMMARY: resumen,
        },
        stdio: 'pipe',
      })
    } catch (e) {
      estado = e.status ?? 1
      salida = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    salida = String(salida)

    const leer = f => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean)
    return {
      estado,
      intentadas: leer('intentadas.log'),
      registradas: leer('registradas.log'),
      resumen: readFileSync(resumen, 'utf8'),
      salida,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('apply-migrations-prod · aplicación a producción', () => {
  it('se detiene en la primera migración fallida y NO intenta las siguientes', () => {
    const r = aplicar([400, 201, 201])

    expect(r.intentadas).toEqual(['MARCA:paso0'])
    expect(r.estado).toBe(1)
  })

  it('no registra en el historial nada que no se haya aplicado', () => {
    // Registrar de más es peor que no registrar: el modo reconciliar da por
    // aplicada una migración que nunca corrió y no la vuelve a seleccionar.
    const r = aplicar([400, 201, 201])
    expect(r.registradas).toEqual([])
  })

  it('declara en el resumen las que quedaron sin intentar', () => {
    // Un resumen que sólo muestre la fallida se lee como si el resto hubiera
    // pasado. El operador tiene que ver qué falta por aplicar.
    const r = aplicar([400, 201, 201])

    expect(r.resumen).toContain('❌ `20990101000000_paso0`')
    expect(r.resumen).toContain('⏭️ `20990101000001_paso1` — no intentada')
    expect(r.resumen).toContain('⏭️ `20990101000002_paso2` — no intentada')
  })

  it('aplica y registra la serie entera cuando todas responden 201', () => {
    const r = aplicar([201, 201, 201])

    expect(r.intentadas).toEqual(['MARCA:paso0', 'MARCA:paso1', 'MARCA:paso2'])
    expect(r.registradas).toHaveLength(3)
    expect(r.estado).toBe(0)
    expect(r.resumen).not.toContain('no intentada')
  })

  it('corta también cuando el fallo es en medio de la serie', () => {
    const r = aplicar([201, 400, 201])

    expect(r.intentadas).toEqual(['MARCA:paso0', 'MARCA:paso1'])
    expect(r.registradas).toHaveLength(1)
    expect(r.resumen).toContain('⏭️ `20990101000002_paso2` — no intentada')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// El REGISTRO en schema_migrations es fail-closed
// ════════════════════════════════════════════════════════════════════════════
// Era best-effort: `::warning::` + `continue`, con el cuerpo a /dev/null y
// mirando sólo el código HTTP. Con el registro fallando, el DDL quedaba puesto
// en la base pero la versión SIN registrar, el bucle seguía con la siguiente y
// el job terminaba en VERDE diciendo "Todas las migraciones se aplicaron
// correctamente".
//
// Ese verde es peligroso, no sólo impreciso: una versión aplicada y no
// registrada es exactamente lo que el modo reconciliar vuelve a dar por
// pendiente, y reaplicarla es la mecánica del incidente 2026-08-03 (un
// DROP TABLE ... CASCADE sobre app_users).
describe('apply-migrations-prod · registro en schema_migrations (fail-closed)', () => {
  const VERDE = 'Todas las migraciones se aplicaron correctamente'

  it.each([
    [400, '4xx'],
    [401, '401 (token muerto)'],
    [403, '4xx sin permiso'],
    [500, '5xx'],
    [502, '5xx de gateway'],
  ])('un %s al registrar (%s) deja el run NO-VERDE', (codigo) => {
    const r = aplicar([201, 201], { histCodigos: [codigo, 201] })
    expect(r.estado).not.toBe(0)
  })

  it('tras fallar el registro NO se intenta la migración siguiente', () => {
    // El DDL de la primera ya corrió; encadenar la segunda encima produce el
    // estado híbrido que nadie sabe describir.
    const r = aplicar([201, 201, 201], { histCodigos: [500, 201, 201] })
    expect(r.intentadas).toEqual(['MARCA:paso0'])
  })

  it('NUNCA dice "todas se aplicaron correctamente" si una quedó sin registrar', () => {
    const r = aplicar([201, 201], { histCodigos: [500, 201] })
    expect(r.salida).not.toContain(VERDE)
    expect(r.resumen).not.toContain(VERDE)
  })

  it('un 2xx con cuerpo INESPERADO también aborta (no basta el código HTTP)', () => {
    // El 2026-08-03 el apply dio verde con `{"message":"Unauthorized"}`: mirar
    // sólo el código, o sólo la clave `.error`, deja pasar el fallo peor.
    for (const cuerpo of ['{"message":"Unauthorized"}', '{"error":"boom"}', '<html>ok</html>', '']) {
      const r = aplicar([201, 201], { histCodigos: [200, 201], histCuerpos: [cuerpo, '[]'] })
      expect(r.estado, `cuerpo ${JSON.stringify(cuerpo)} debería abortar`).not.toBe(0)
      expect(r.intentadas).toEqual(['MARCA:paso0'])
    }
  })

  it('un 2xx con un array de filas SÍ es un registro válido', () => {
    // La forma positiva: la Management API devuelve [] en un DDL correcto.
    const r = aplicar([201, 201], { histCodigos: [200, 200], histCuerpos: ['[]', '[]'] })
    expect(r.estado).toBe(0)
    expect(r.intentadas).toEqual(['MARCA:paso0', 'MARCA:paso1'])
    expect(r.salida).toContain(VERDE)
  })

  it('el mensaje avisa de que el DDL puede estar aplicado y manda reparar el historial', () => {
    const r = aplicar([201, 201], { histCodigos: [500, 201] })
    const todo = r.salida + r.resumen
    expect(todo).toMatch(/SE APLICÓ pero NO se pudo registrar|DDL aplicado pero SIN registrar/)
    expect(todo).toMatch(/reparar|verificar/i)
    expect(todo).toMatch(/ANTES de reintentar/i)
    expect(todo).toMatch(/2026-08-03/)
  })

  it('el resumen marca la fallida y declara las no intentadas', () => {
    const r = aplicar([201, 201, 201], { histCodigos: [500, 201, 201] })
    expect(r.resumen).toContain('⛔ `20990101000000_paso0`')
    expect(r.resumen).toContain('⏭️ `20990101000001_paso1` — no intentada')
    expect(r.resumen).toContain('⏭️ `20990101000002_paso2` — no intentada')
  })

  it('el fallo de registro en MEDIO de la serie corta ahí, no al final', () => {
    const r = aplicar([201, 201, 201], { histCodigos: [201, 500, 201] })
    expect(r.intentadas).toEqual(['MARCA:paso0', 'MARCA:paso1'])
    expect(r.estado).not.toBe(0)
    expect(r.resumen).toContain('⏭️ `20990101000002_paso2` — no intentada')
  })
})
