// confirm() (components/shared/Dialog) devuelve Promise<{ isConfirmed }>: un OBJETO, y un objeto siempre es «verdadero». Escribir
// `const ok = await confirm(…); if (!ok) return` no frena «Cancelar» nunca: el paso destructivo (guardar renglones, retirar un archivo,
// eliminar un documento, anular un gasto) ocurre aunque la persona cancele. TypeScript no lo detecta (un objeto es válido como condición).
//
// Esta prueba recorre TODO el código de la aplicación y exige que cada resultado de confirm() se lea por `isConfirmed`:
//   const { isConfirmed } = await confirm(…)     ·     const r = await confirm(…) … r.isConfirmed     ·     (await confirm(…)).isConfirmed
// o que el resultado no se use a propósito (`void confirm(…).then(() => …)`: avisos informativos cuyas dos salidas hacen lo mismo).
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

/** Los nombres locales con que el archivo importa `confirm` de shared/Dialog. */
function nombresDeConfirm(sf: ts.SourceFile): Set<string> {
  const nombres = new Set<string>()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    if (!/(^|\/)Dialog$/.test(st.moduleSpecifier.text)) continue
    const enlaces = st.importClause?.namedBindings
    if (!enlaces || !ts.isNamedImports(enlaces)) continue
    for (const e of enlaces.elements) if ((e.propertyName ?? e.name).text === 'confirm') nombres.add(e.name.text)
  }
  return nombres
}

const esIsConfirmed = (n: ts.Node | undefined): boolean =>
  !!n && ts.isPropertyAccessExpression(n) && n.name.text === 'isConfirmed'

/** El bloque donde vive la declaración (el alcance de una `const`): ahí, y solo después de ella, se busca cómo se usa el resultado. */
function bloqueDe(n: ts.Node): ts.Node {
  let p: ts.Node = n
  while (p.parent && !(ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p) || ts.isDefaultClause(p) || ts.isModuleBlock(p))) p = p.parent
  return p
}

interface Hallazgo { linea: number; motivo: string }

/** Los usos de confirm() de este código que NO leen `isConfirmed` (ni son un aviso que ignora el resultado a propósito). */
function defectosDeConfirm(texto: string, nombre = 'x.tsx'): { llamadas: number; defectos: Hallazgo[] } {
  const sf = ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, nombre.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const locales = nombresDeConfirm(sf)
  const defectos: Hallazgo[] = []
  let llamadas = 0
  if (locales.size === 0) return { llamadas, defectos }
  const linea = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
  const marcar = (n: ts.Node, motivo: string) => defectos.push({ linea: linea(n), motivo })

  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && locales.has(n.expression.text)) {
      llamadas++
      const espera = ts.isAwaitExpression(n.parent) ? n.parent : null
      const donde = espera ? espera.parent : n.parent
      if (espera) {
        if (ts.isParenthesizedExpression(donde) && esIsConfirmed(donde.parent)) return ts.forEachChild(n, visitar)
        if (ts.isVariableDeclaration(donde)) {
          if (ts.isObjectBindingPattern(donde.name)) {
            if (!donde.name.elements.some((e) => (e.propertyName ?? e.name).getText() === 'isConfirmed')) marcar(n, 'desestructura sin isConfirmed')
          } else if (ts.isIdentifier(donde.name)) {
            const nombreVar = donde.name
            const usos: ts.Identifier[] = []
            const buscar = (x: ts.Node): void => {
              if (ts.isIdentifier(x) && x.text === nombreVar.text && x !== nombreVar && x.getStart() > donde.getEnd()) usos.push(x)
              ts.forEachChild(x, buscar)
            }
            buscar(bloqueDe(donde))
            const malos = usos.filter((u) => !(esIsConfirmed(u.parent) && (u.parent as ts.PropertyAccessExpression).expression === u))
            if (usos.length === 0) marcar(n, `${nombreVar.text} nunca se lee`)
            else if (malos.length > 0) marcar(n, `${nombreVar.text} se usa sin .isConfirmed (línea ${linea(malos[0])}: «${malos[0].parent.getText().slice(0, 40)}»)`)
          } else marcar(n, 'enlace no reconocido')
        } else marcar(n, `el objeto se usa directo: «${donde.getText().slice(0, 50)}»`)
      } else if (ts.isPropertyAccessExpression(donde) && donde.name.text === 'then') {
        // `confirm(…).then(cb)`: sin parámetros (no le importa el resultado) o leyendo isConfirmed
        const cb = ts.isCallExpression(donde.parent) ? donde.parent.arguments[0] : undefined
        const params = cb && ts.isFunctionLike(cb) ? cb.parameters : undefined
        const leeIsConfirmed = !!params && params.length > 0 && cb!.getText().includes('isConfirmed')
        if (!params || (params.length > 0 && !leeIsConfirmed)) marcar(n, '.then que recibe el objeto sin leer isConfirmed')
      } else marcar(n, `sin await y sin .then: «${donde.getText().slice(0, 50)}»`)
    }
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  return { llamadas, defectos }
}

function archivosDeCodigo(dir: string): string[] {
  const salida: string[] = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) {
      if (nombre === '__tests__' || nombre === 'node_modules') continue
      salida.push(...archivosDeCodigo(ruta))
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.(test|spec)\.|\.d\.ts$/.test(nombre)) salida.push(ruta)
  }
  return salida
}

const IMPORT = "import { confirm } from '../shared/Dialog'\n"

describe('defectosDeConfirm · el detector reconoce el defecto y deja pasar lo correcto', () => {
  it.each([
    ['const ok = await confirm({ title: "x" })\nif (!ok) return', 'ok se usa sin .isConfirmed'],
    ['const ok = await confirm({ title: "x" })\nif (ok) await borrar()', 'ok se usa sin .isConfirmed'],
    ['if (!(await confirm({ title: "x" }))) return', 'el objeto se usa directo'],
    ['const { texto } = await confirm({ title: "x" })', 'desestructura sin isConfirmed'],
    ['const r = await confirm({ title: "x" })\nlog(r)', 'r se usa sin .isConfirmed'],
    ['confirm({ title: "x" }).then((r) => { if (r) borrar() })', '.then que recibe el objeto sin leer isConfirmed'],
    ['const ok = await confirm({ title: "x" })', 'ok nunca se lee'],
  ])('defecto: %s', (cuerpo, motivo) => {
    const { defectos } = defectosDeConfirm(`${IMPORT}async function f() {\n${cuerpo}\n}`)
    expect(defectos).toHaveLength(1)
    expect(defectos[0].motivo).toContain(motivo)
  })

  it.each([
    'const { isConfirmed } = await confirm({ title: "x" })\nif (!isConfirmed) return',
    'const { isConfirmed: descargar } = await confirm({ title: "x" })\nif (descargar) f()',
    'const r = await confirm({ title: "x" })\nif (!r.isConfirmed) return',
    'if (!(await confirm({ title: "x" })).isConfirmed) return',
    'void confirm({ title: "x" }).then(() => { f() })',
    'confirm({ title: "x" }).then((r) => { if (r.isConfirmed) f() })',
  ])('correcto: %s', (cuerpo) => {
    const { llamadas, defectos } = defectosDeConfirm(`${IMPORT}async function f() {\n${cuerpo}\n}`)
    expect(llamadas).toBe(1)
    expect(defectos).toEqual([])
  })

  it('no confunde la variable con otra del mismo nombre: un parámetro anterior, o un `const` homónimo en otro bloque', () => {
    const cuerpo = `async function f() {
      const dup = lista.filter((ok) => ok.activo)
      if (a) {
        const ok = await confirm({ title: 'a' })
        if (!ok.isConfirmed) return
      }
      if (b) {
        const ok = await confirm({ title: 'b' })
        if (!ok.isConfirmed) return
      }
      const r = await otraCosa()
      return r
    }`
    expect(defectosDeConfirm(`${IMPORT}${cuerpo}`)).toEqual({ llamadas: 2, defectos: [] })
  })

  it('un confirm() que no viene de shared/Dialog (p. ej. window.confirm, que sí devuelve booleano) no se examina', () => {
    expect(defectosDeConfirm('async function f() {\n  if (!window.confirm("¿seguro?")) return\n}')).toEqual({ llamadas: 0, defectos: [] })
    expect(defectosDeConfirm("import { confirm } from './otroModulo'\nfunction f() { if (!confirm('x')) return }")).toEqual({ llamadas: 0, defectos: [] })
  })
})

describe('todo el código de la aplicación lee isConfirmed de confirm()', () => {
  const raiz = resolve('src')
  const porArchivo = archivosDeCodigo(raiz).map((ruta) => ({ ruta: relative(resolve('.'), ruta), ...defectosDeConfirm(readFileSync(ruta, 'utf8'), ruta) }))

  it('recorre un número razonable de llamadas (si no, el recorrido dejó de ver el código)', () => {
    expect(porArchivo.reduce((n, f) => n + f.llamadas, 0)).toBeGreaterThan(150)
  })

  it('ningún uso de confirm() ignora «Cancelar»', () => {
    const defectos = porArchivo.flatMap((f) => f.defectos.map((d) => `${f.ruta}:${d.linea} ${d.motivo}`))
    expect(defectos, 'confirm() devuelve { isConfirmed }: lee const { isConfirmed } = await confirm(…)').toEqual([])
  })
})
