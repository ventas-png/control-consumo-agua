import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guard del motor único de recepción (20260829000000).
//
// Al unificar `correspondencia_condominio` dentro de `paquetes_recibidos`, el
// permiso dejó de venir dado por la TABLA y pasó a resolverse POR FILA según
// `clase`. Eso es lo único que impide que un guardia con
// condominios.tab.paqueteria lea las notificaciones legales del condominio.
//
// El riesgo concreto: el repo tiene un generador de policies RBAC por tabla
// (20260518000010) con un mapping `tabla → permiso`. Si alguien vuelve a
// correrlo, o copia ese patrón para "arreglar" algo, las policies de
// paquetes_recibidos volverían a la forma tabla→paqueteria y la separación se
// perdería EN SILENCIO: sin error, sin test roto, solo correspondencia visible
// para quien no debe. Este test mira la ÚLTIMA definición de cada policy y
// exige que siga discriminando por clase.

const MIGRATIONS_DIR = resolve('supabase/migrations')
const TABLA = 'paquetes_recibidos'
const PERM_PAQUETERIA = 'condominios.tab.paqueteria'
const PERM_CORRESPONDENCIA = 'condominios.tab.correspondencia'

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

  // DELETE queda fuera: no se gobierna por permiso de tab sino por rol
  // (company_owner/admin), igual que antes de la unificación.
  for (const nombre of ['paquetes_recibidos_select', 'paquetes_recibidos_insert', 'paquetes_recibidos_update']) {
    it(`${nombre} resuelve el permiso por clase, no por tabla`, () => {
      const policy = vigentes.get(nombre)
      expect(policy, `falta ${nombre}`).toBeDefined()
      // Ambos permisos presentes = el CASE sobre `clase` sigue ahí. Si alguien
      // la reescribe con un solo permiso fijo, esto falla.
      expect(policy!.cuerpo).toContain(PERM_CORRESPONDENCIA)
      expect(policy!.cuerpo).toContain(PERM_PAQUETERIA)
      expect(policy!.cuerpo).toMatch(/clase/)
    })
  }

  it('el residente sigue viendo las piezas de su unidad', () => {
    // Rama que ya tenían las dos tablas por separado; perderla dejaría el
    // portal del residente sin sus paquetes.
    expect(vigentes.get('paquetes_recibidos_select')!.cuerpo).toContain('mis_unidades_ids')
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
