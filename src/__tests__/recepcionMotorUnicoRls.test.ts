import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS del motor único de recepción (20260829000000).
//
// ALCANCE Y LÍMITE. Esto lee el SQL del repo; no ejecuta nada contra una base.
// Comprueba que las reglas siguen ESCRITAS como deben, que es la regresión
// realista aquí: el repo tiene un generador de policies RBAC por tabla
// (20260518000010) con un mapping `tabla → permiso`; si alguien vuelve a
// correrlo o copia ese patrón, las policies de paquetes_recibidos regresan a la
// forma tabla→paqueteria y la separación entre clases se pierde EN SILENCIO —
// sin error, sin test roto, solo correspondencia visible (o borrable) para quien
// no debe. La verificación CONDUCTUAL vive en src/test/rls/rlsHarness.test.ts y
// solo corre con credenciales de un preview/sandbox.

const MIGRATIONS_DIR = resolve('supabase/migrations')
const TABLA = 'paquetes_recibidos'
const PERM_PAQUETERIA = 'condominios.tab.paqueteria'
const PERM_CORRESPONDENCIA = 'condominios.tab.correspondencia'
const MIGRACION_UNIFICACION = '20260829000000_recepcion_motor_unico.sql'

interface Policy { nombre: string; cuerpo: string; archivo: string }

/** Última definición de cada policy sobre `tabla`, en orden de migración. */
function policiesVigentes(tabla: string): Map<string, Policy> {
  const archivos = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
  const vigentes = new Map<string, Policy>()
  for (const archivo of archivos) {
    const sql = readFileSync(join(MIGRATIONS_DIR, archivo), 'utf8')
    // CREATE POLICY <nombre> ON [public.]<tabla> … hasta el `;` que la cierra.
    const re = new RegExp(
      `CREATE\\s+POLICY\\s+(?:"([^"]+)"|(\\w+))\\s+ON\\s+(?:public\\.)?"?${tabla}"?([\\s\\S]*?);`,
      'gi',
    )
    for (const m of sql.matchAll(re)) {
      vigentes.set(m[1] ?? m[2], { nombre: m[1] ?? m[2], cuerpo: m[3], archivo })
    }
  }
  return vigentes
}

describe('policies de paquetes_recibidos tras la unificación', () => {
  const vigentes = policiesVigentes(TABLA)

  it('existen las cuatro operaciones', () => {
    // Subconjunto, no igualdad: las policies legacy `paquetes_*` (fase 2/26) las
    // dropea en runtime el DO block de 20260518000010, cosa que un escaneo
    // estático del SQL no puede ver.
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect([...vigentes.keys()]).toContain(`${TABLA}_${op}`)
    }
  })

  // SELECT/INSERT/UPDATE se gobiernan por PERMISO de la clase.
  for (const nombre of [
    'paquetes_recibidos_select',
    'paquetes_recibidos_insert',
    'paquetes_recibidos_update',
  ]) {
    it(`${nombre} resuelve el permiso por clase, no por tabla`, () => {
      const policy = vigentes.get(nombre)
      expect(policy, `falta ${nombre}`).toBeDefined()
      // Ambos permisos presentes = el CASE sobre `clase` sigue ahí. Si alguien
      // la reescribe con un solo permiso fijo, esto falla.
      expect(policy!.cuerpo).toContain(PERM_CORRESPONDENCIA)
      expect(policy!.cuerpo).toContain(PERM_PAQUETERIA)
      expect(policy!.cuerpo).toMatch(/CASE\s+clase/i)
    })
  }

  // DELETE va por ROL, no por permiso: `user_has_permission` devuelve true a
  // cualquier clave para super_admin/company_owner/admin (20260518000008), así
  // que un gate de permiso colocado detrás de un filtro de rol no filtra nada.
  describe('DELETE se gobierna por rol, no por el helper de permisos', () => {
    const cuerpo = () => vigentes.get('paquetes_recibidos_delete')!.cuerpo

    it('NO usa user_has_permission (sería una condición siempre verdadera)', () => {
      expect(cuerpo()).not.toMatch(/user_has_permission/)
    })

    it('la correspondencia solo la borra company_owner: `admin` no aparece en su rama', () => {
      // La rama de correspondencia compara contra 'company_owner' a secas; el
      // ARRAY con 'admin' es la rama de paquetería.
      expect(cuerpo()).toMatch(/WHEN\s+'correspondencia'\s+THEN\s+public\.current_user_role\(\)\s*=\s*'company_owner'/)
    })

    it('paquetería conserva company_owner y admin', () => {
      expect(cuerpo()).toMatch(/ELSE\s+public\.current_user_role\(\)\s*=\s*ANY\(ARRAY\['company_owner','admin'\]\)/)
    })

    it('sigue acotado a la empresa y con la llave de soporte', () => {
      expect(cuerpo()).toMatch(/company_id = public\.get_my_company_id\(\)/)
      expect(cuerpo()).toMatch(/is_super_admin\(\)/)
    })
  })

  it('el residente sigue viendo las piezas de su unidad', () => {
    // Rama que ya tenían las dos tablas por separado; perderla dejaría el
    // portal del residente sin sus paquetes.
    expect(vigentes.get('paquetes_recibidos_select')!.cuerpo).toContain('mis_unidades_ids')
  })

  it('el residente NO gana permiso de borrado por vivir en la unidad', () => {
    expect(vigentes.get('paquetes_recibidos_delete')!.cuerpo).not.toContain('mis_unidades_ids')
  })
})

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
function soloCodigo(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

describe('migración de datos: fail-closed', () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, MIGRACION_UNIFICACION), 'utf8')
  const posInsert = sql.indexOf('INSERT INTO public.paquetes_recibidos')
  const posDrop = sql.indexOf('DROP TABLE public.correspondencia_condominio')

  it('el INSERT de migración no silencia colisiones de id', () => {
    // `ON CONFLICT (id) DO NOTHING` saltaría la fila en conflicto y el DROP de
    // después la borraría para siempre: pérdida silenciosa. Sin la cláusula, una
    // colisión revienta la transacción y no se aplica nada.
    expect(posInsert).toBeGreaterThan(-1)
    // Se mira el CÓDIGO, no los comentarios: esta misma migración explica en
    // prosa por qué no lleva la cláusula.
    expect(soloCodigo(sql.slice(posInsert, posDrop))).not.toMatch(/ON\s+CONFLICT/i)
  })

  it('verifica fila por fila ANTES de dropear la tabla original', () => {
    const previo = sql.slice(posInsert, posDrop)
    expect(posDrop).toBeGreaterThan(posInsert)
    // La comprobación tiene que ser por fila (NOT EXISTS sobre cada id), no un
    // simple conteo: dos errores compensados darían el mismo total.
    expect(previo).toMatch(/NOT EXISTS[\s\S]*p\.id = c\.id[\s\S]*p\.clase = 'correspondencia'/)
    expect(previo).toMatch(/RAISE EXCEPTION/)
  })

  it('no dropea si el respaldo no está completo', () => {
    const previo = sql.slice(posInsert, posDrop)
    expect(previo).toMatch(/correspondencia_condominio_respaldo/)
    expect(previo).toMatch(/v_respaldo <> v_origen/)
  })

  it('el respaldo se crea ANTES de tocar nada, y sin IF NOT EXISTS', () => {
    // Sin `IF NOT EXISTS`: una tabla de respaldo preexistente es el resto de un
    // intento anterior con contenido desconocido. Darla por buena sería seguir
    // sin respaldo fresco de ESTAS filas; que falle obliga a mirarla.
    const posRespaldo = sql.indexOf('CREATE TABLE public.correspondencia_condominio_respaldo')
    expect(posRespaldo).toBeGreaterThan(-1)
    expect(posRespaldo).toBeLessThan(posInsert)
    expect(soloCodigo(sql)).not.toMatch(/CREATE TABLE IF NOT EXISTS public\.correspondencia_condominio_respaldo/)
  })

  it('el respaldo se verifica por ids, no solo por total', () => {
    // Un respaldo con el mismo número de filas pero otras filas pasaría un
    // conteo y no serviría de nada.
    const previo = sql.slice(posInsert, posDrop)
    expect(previo).toMatch(/NOT EXISTS[\s\S]*correspondencia_condominio_respaldo r WHERE r\.id = c\.id/)
    expect(previo).toMatch(/v_sin_respaldo/)
  })
})

describe('correspondencia_condominio ya no se consulta desde la app', () => {
  it('ninguna query del frontend apunta a la vista de compatibilidad', () => {
    // Es una vista de SOLO LECTURA para consumidores externos. Una escritura
    // desde la app fallaría en runtime, y una lectura estaría duplicando lo que
    // ya trae el loader de `paquetes_recibidos`.
    const archivos: string[] = []
    const recorrer = (dir: string) => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, entrada.name)
        if (entrada.isDirectory()) recorrer(ruta)
        else if (/\.tsx?$/.test(entrada.name) && !ruta.includes('database.types')) archivos.push(ruta)
      }
    }
    recorrer(resolve('src'))

    const infractores = archivos.filter(f =>
      /\bfrom\(\s*['"]correspondencia_condominio['"]\s*\)/.test(readFileSync(f, 'utf8')),
    )
    expect(infractores).toEqual([])
  })
})
