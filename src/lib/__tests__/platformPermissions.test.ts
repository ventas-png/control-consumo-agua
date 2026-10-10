import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dirMigraciones, leerMigraciones, permisosSembrados } from '../../test/sqlMigraciones'
import { LLAVES_ACCION_COMPRAS, LLAVES_ACCION_COMPRAS_LISTA, PLATFORM_MODULE_GROUPS, gruposPlataformaDisponibles } from '../platformPermissions'
import { MODULE_ACTIONS } from '../moduleConfig'

// ════════════════════════════════════════════════════════════════════════════
// Las seis decisiones del circuito de compras y pagos en la matriz de permisos
//
// Cada decisión (aprobar una orden de compra, registrar una recepción, aprobar una factura, aprobar una orden de pago,
// ejecutar un pago, anular un pago) tiene SU llave RBAC. La matriz de permisos efectivos (RolPermisosModal) solo
// muestra las llaves de PLATFORM_MODULE_GROUPS, que son fijas: sin un grupo que las nombre, las cinco llaves nuevas
// existirían en el catálogo pero no se podrían conceder desde la matriz. Y una llave que el grupo muestre pero el
// catálogo no tenga es una casilla que al guardar falla (role_permissions → permissions, clave foránea).
// ════════════════════════════════════════════════════════════════════════════

const GRUPO = PLATFORM_MODULE_GROUPS.find((g) => g.key === 'platform_compras_pagos')
const NUEVAS = Object.values(LLAVES_ACCION_COMPRAS).filter((k) => k.startsWith('platform.contabilidad.compras.'))

describe('PLATFORM_MODULE_GROUPS · grupo «Compras y pagos»', () => {
  it('existe, con etiqueta de la sección Plataforma y una llave por decisión', () => {
    expect(GRUPO).toBeDefined()
    expect(GRUPO!.label).toBe('Plataforma: Compras y pagos')
    expect(GRUPO!.tabs).toEqual(LLAVES_ACCION_COMPRAS_LISTA)
    expect(GRUPO!.tabs).toHaveLength(6)
  })

  it('las seis llaves son exactamente las que el servidor exige (D1)', () => {
    expect(LLAVES_ACCION_COMPRAS).toEqual({
      aprobarOrdenCompra: 'condominios.tab.ordenes_compra.approve',
      registrarRecepcion: 'platform.contabilidad.compras.recepcion_registrar',
      aprobarFactura: 'platform.contabilidad.compras.factura_aprobar',
      aprobarOrdenPago: 'platform.contabilidad.compras.orden_pago_aprobar',
      ejecutarPago: 'platform.contabilidad.compras.pago_ejecutar',
      anularPago: 'platform.contabilidad.compras.pago_anular',
    })
  })

  it('ninguna llave se repite en la matriz de plataforma (una casilla, un permiso)', () => {
    const todas = PLATFORM_MODULE_GROUPS.flatMap((g) => g.tabs)
    expect(new Set(todas).size).toBe(todas.length)
    const keysDeGrupo = PLATFORM_MODULE_GROUPS.map((g) => g.key)
    expect(new Set(keysDeGrupo).size).toBe(keysDeGrupo.length)
  })

  it('las cinco llaves nuevas son platform.contabilidad.compras.<acción> y su acción NO es una de las seis genéricas', () => {
    expect(NUEVAS).toHaveLength(5)
    for (const k of NUEVAS) {
      expect(k).toMatch(/^platform\.contabilidad\.compras\.[a-z]+(_[a-z]+)+$/)
      const ultimo = k.split('.').pop()!
      // si terminara en view/create/edit/change_status/approve/delete, el editor de roles la fundiría en la fila de
      // «platform.contabilidad.compras» en vez de darle su propia fila
      expect((MODULE_ACTIONS as readonly string[]).includes(ultimo)).toBe(false)
    }
  })

  it('el grupo de Contabilidad sigue siendo el de las seis acciones genéricas y no incluye las nuevas', () => {
    const conta = PLATFORM_MODULE_GROUPS.find((g) => g.key === 'platform_contabilidad')!
    expect(conta.tabs).toEqual(MODULE_ACTIONS.map((a) => `platform.contabilidad.${a}`))
  })
})

// ── La matriz solo ofrece lo que el catálogo cargado tiene ───────────────────

describe('gruposPlataformaDisponibles · el grupo «Compras y pagos» según el catálogo cargado', () => {
  const GENERICAS = PLATFORM_MODULE_GROUPS.filter((g) => g.key !== 'platform_compras_pagos')
  const catalogo = (llaves: readonly string[]) => new Map(llaves.map((k) => [k, `etiqueta de ${k}`]))
  const grupo = (grupos: ReturnType<typeof gruposPlataformaDisponibles>) => grupos.find((g) => g.key === 'platform_compras_pagos')

  it('con las seis llaves en el catálogo, el grupo queda como está declarado (mismo orden)', () => {
    const g = grupo(gruposPlataformaDisponibles(catalogo(LLAVES_ACCION_COMPRAS_LISTA)))
    expect(g?.tabs).toEqual(LLAVES_ACCION_COMPRAS_LISTA)
    expect(g?.label).toBe('Plataforma: Compras y pagos')
  })

  it('con el catálogo SIN las cinco llaves nuevas (la migración aún no está), el grupo solo trae la de la orden de compra, que sí existe', () => {
    const g = grupo(gruposPlataformaDisponibles(catalogo([LLAVES_ACCION_COMPRAS.aprobarOrdenCompra])))
    expect(g?.tabs).toEqual([LLAVES_ACCION_COMPRAS.aprobarOrdenCompra])
  })

  it('con el catálogo sin ninguna de las seis (o vacío, p. ej. si no cargó) el grupo se OCULTA', () => {
    expect(grupo(gruposPlataformaDisponibles(catalogo([])))).toBeUndefined()
    expect(grupo(gruposPlataformaDisponibles(catalogo(['platform.contabilidad.view'])))).toBeUndefined()
  })

  it('un catálogo parcial solo deja las llaves que tiene, sin reordenar', () => {
    const k = LLAVES_ACCION_COMPRAS
    const g = grupo(gruposPlataformaDisponibles(catalogo([k.anularPago, k.registrarRecepcion])))
    expect(g?.tabs).toEqual([k.registrarRecepcion, k.anularPago])
  })

  it('los demás grupos de plataforma no cambian con el catálogo (ni con uno vacío)', () => {
    for (const c of [catalogo([]), catalogo(LLAVES_ACCION_COMPRAS_LISTA)]) {
      expect(gruposPlataformaDisponibles(c).filter((g) => g.key !== 'platform_compras_pagos')).toEqual(GENERICAS)
    }
  })

  it('no modifica el grupo estático: una llamada con catálogo pobre no deja a la siguiente sin llaves', () => {
    gruposPlataformaDisponibles(catalogo([]))
    gruposPlataformaDisponibles(catalogo([LLAVES_ACCION_COMPRAS.anularPago]))
    expect(PLATFORM_MODULE_GROUPS.find((g) => g.key === 'platform_compras_pagos')?.tabs).toEqual(LLAVES_ACCION_COMPRAS_LISTA)
    expect(grupo(gruposPlataformaDisponibles(catalogo(LLAVES_ACCION_COMPRAS_LISTA)))?.tabs).toHaveLength(6)
  })
})

// ── El catálogo que siembran las migraciones ────────────────────────────────

interface FilaCatalogo { category: string; label: string }

/**
 * Lee el catálogo tal como lo dejan las migraciones: las filas de los `INSERT INTO [public.]permissions` (key, category, label,
 * description) —con `VALUES` o `SELECT`, con o sin `public.` y con o sin lista de columnas; ver `src/test/sqlMigraciones.ts`— y las
 * acciones por pestaña que la 20260703000000 DERIVA de cada clave base `condominios.tab.<id>` (create / edit / change_status /
 * approve / delete, con la etiqueta «<Acción> — <base>»). `MIGRACIONES_DIR` apunta a otra carpeta de migraciones (p. ej. una con
 * la 20261027000900 aún sin integrar).
 */
function catalogoSembrado(): Map<string, FilaCatalogo & { migracion: string }> {
  const filas = new Map<string, FilaCatalogo & { migracion: string }>()
  for (const { nombre, sql } of leerMigraciones()) {
    for (const p of permisosSembrados(sql)) {
      if (!filas.has(p.key)) filas.set(p.key, { category: p.category, label: p.label, migracion: nombre })
    }
  }
  for (const [key, fila] of [...filas]) {
    if (/^condominios\.tab\.[a-z0-9_]+$/.test(key)) {
      for (const [accion, etiqueta] of [['create', 'Crear'], ['edit', 'Editar'], ['change_status', 'Cambiar estado'], ['approve', 'Autorizar / Denegar'], ['delete', 'Eliminar']]) {
        filas.set(`${key}.${accion}`, { category: fila.category, label: `${etiqueta} — ${fila.label}`, migracion: '20260703000000_rbac_action_granularity_y_contabilidad.sql' })
      }
    }
  }
  return filas
}

describe('PLATFORM_MODULE_GROUPS · grupo «Compras y pagos» · catálogo sembrado por las migraciones', () => {
  const catalogo = catalogoSembrado()

  it('la derivación de las acciones por pestaña (create / edit / change_status / approve / delete) sigue declarada en 20260703000000', () => {
    // La llave de la orden de compra (…ordenes_compra.approve) no está escrita en ninguna migración: la deriva esta.
    const derivacion = readFileSync(resolve(dirMigraciones(), '20260703000000_rbac_action_granularity_y_contabilidad.sql'), 'utf8')
    expect(derivacion).toMatch(/p\.key \|\| '\.' \|\| a\.akey/)
    expect(derivacion).toMatch(/\('approve',\s*'Autorizar \/ Denegar'\)/)
  })

  it('cada llave del grupo existe en el catálogo que siembran las migraciones (si no, la casilla falla al guardar)', () => {
    const faltan = GRUPO!.tabs.filter((k) => !catalogo.has(k))
    expect(faltan, `llaves del grupo sin sembrar en ninguna migración (las cinco nuevas las siembra 20261027000900): ${faltan.join(', ')}`).toEqual([])
  })

  it('las cinco llaves nuevas se siembran en la categoría platform_contabilidad', () => {
    for (const k of NUEVAS) expect(catalogo.get(k)?.category, k).toBe('platform_contabilidad')
  })

  it('cada etiqueta es «Compras y pagos — <acción>» con UN solo « — » (el editor de roles quita el prefijo y muestra la acción)', () => {
    for (const k of NUEVAS) {
      const etiqueta = catalogo.get(k)?.label ?? ''
      expect(etiqueta, k).toMatch(/^Compras y pagos — [^—]+$/)
      expect(etiqueta.replace(/^[^—]+ — /, '').trim().length, k).toBeGreaterThan(8)
    }
  })

  it('las etiquetas de las cinco son distintas entre sí', () => {
    const etiquetas = NUEVAS.map((k) => catalogo.get(k)?.label)
    expect(new Set(etiquetas).size).toBe(NUEVAS.length)
  })

  it('la llave de la orden de compra es la que ya existía («Autorizar / Denegar — Órdenes compra»): no se creó otra', () => {
    const oc = catalogo.get(LLAVES_ACCION_COMPRAS.aprobarOrdenCompra)
    expect(oc?.label).toBe('Autorizar / Denegar — Órdenes compra')
    expect(oc?.migracion).toBe('20260703000000_rbac_action_granularity_y_contabilidad.sql')
  })
})
