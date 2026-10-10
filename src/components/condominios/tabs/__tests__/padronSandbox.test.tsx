// El padrón de la prueba de pantalla del sandbox, el guion que lo recorre y la pantalla real tienen que decir lo MISMO.
//
// `supabase/tests/compras_bloque_b/pantalla_sandbox/` siembra cinco perfiles (administrador, «Autorizar + Editar», «Cambiar estado +
// Editar», «Autorizar sin Editar» y «solo genérico») y `pantalla_controles.mjs` declara, en `ESPERADO`, qué botones debe ofrecer la pantalla
// de Operaciones › Órdenes compra a cada uno sobre tres órdenes. Cuando aprobar y devolver pasaron a exigir la llave de la pestaña
// (`condominios.tab.ordenes_compra.approve`) y no el «Autorizar / Denegar» genérico, el padrón siguió sembrando solo el genérico: el guion
// habría fallado contra el sandbox sin que ninguna prueba del repositorio lo notara.
//
// Aquí se LEEN las filas de la plantilla del padrón y el `ESPERADO` del guion (no se copian), se monta la pantalla REAL con las llaves de
// cada perfil y se exige que ofrezca exactamente los botones esperados. No prueba el servidor ni una sesión real (eso lo hace el guion contra
// el sandbox); prueba que plantilla, guion y pantalla no divergen.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LLAVES_ACCION_COMPRAS } from '../../../../lib/platformPermissions'
import { montarConSesion } from '../../../../test/sesionPermisos'

vi.mock('../../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/proveedores/queries', () => ({ useAsignacionesQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/compras/queries', () => ({ useInsumosAlmacenQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/compras/mutations', () => ({ crearOrdenTransaccional: vi.fn() }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(), updateCondominioRowAfectando: vi.fn(), deleteCondominioRowAfectando: vi.fn(),
}))
vi.mock('../../../compras/SeguimientoOrdenModal', () => ({ SeguimientoOrdenModal: () => null }))
vi.mock('../../../proveedores/ContratoSeguimientoModal', () => ({ ContratoSeguimientoModal: () => null }))
vi.mock('../../../proveedores/ContratoSelector', () => ({ ContratoSelector: () => null }))
vi.mock('../../../../domain/proveedores/contratosCompras', async (orig) => ({
  ...(await orig<typeof import('../../../../domain/proveedores/contratosCompras')>()),
  useExcepcionContratoMutation: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: vi.fn() }))

import OrdenesCompraTab from '../OrdenesCompraTab'

const DIR = resolve('supabase/tests/compras_bloque_b/pantalla_sandbox')
const LLAVE_OC = LLAVES_ACCION_COMPRAS.aprobarOrdenCompra

// ── Lectura de la plantilla del padrón ──────────────────────────────────────

interface PerfilPadron { etiqueta: string; rol: string; permisos: Set<string> }

/**
 * Perfiles que siembra la plantilla: etiqueta (`'admin'`, `'autoriza'`…) → rol de `app_users` y llaves RBAC del rol que se le asigna.
 * Lee exactamente la sintaxis de la plantilla (VALUES de usuarios, `app_users`, `user_roles`, el FOREACH de llaves comunes y los INSERT
 * explícitos de `role_permissions`); si alguien la reescribe con otra forma, las comprobaciones de sanidad de abajo fallan en voz alta
 * en vez de dar un verde vacío.
 */
function leerPadron(plantilla: string): Map<string, PerfilPadron> {
  const sql = plantilla.replace(/--[^\n]*/g, '')
  const etiquetaDe = new Map<string, string>()
  const tags = /FROM\s*\(VALUES((?:\s*\(\s*\w+\s*,\s*'\w+'\s*\)\s*,?)+)\)\s*v\(id,\s*tag\)/.exec(sql)
  for (const m of (tags?.[1] ?? '').matchAll(/\(\s*(\w+)\s*,\s*'(\w+)'\s*\)/g)) etiquetaDe.set(m[1], m[2])

  const rolDeUsuario = new Map<string, string>()
  const appUsers = /INSERT INTO public\.app_users[^;]*?VALUES([^;]+);/.exec(sql)
  for (const m of (appUsers?.[1] ?? '').matchAll(/\(\s*(\w+)\s*,\s*c\s*,\s*'[^']*'\s*,\s*'(\w+)'\s*\)/g)) rolDeUsuario.set(m[1], m[2])

  const roleVarDeUsuario = new Map<string, string>()
  const userRoles = /INSERT INTO public\.user_roles[^;]*?VALUES([^;]+);/.exec(sql)
  for (const m of (userRoles?.[1] ?? '').matchAll(/\(\s*(\w+)\s*,\s*(\w+)\s*\)/g)) roleVarDeUsuario.set(m[1], m[2])

  const llavesDeRol = new Map<string, Set<string>>()
  const dar = (rol: string, llave: string) => {
    if (!llavesDeRol.has(rol)) llavesDeRol.set(rol, new Set())
    llavesDeRol.get(rol)!.add(llave)
  }
  for (const m of sql.matchAll(/FOREACH\s+k\s+IN\s+ARRAY\s+ARRAY\[([^\]]+)\]\s+LOOP\s+INSERT INTO public\.role_permissions[^;]*?VALUES([^;]+);\s*END LOOP;/g)) {
    const llaves = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    for (const r of m[2].matchAll(/\(\s*(\w+)\s*,\s*k\s*,\s*'allow'\s*\)/g)) for (const llave of llaves) dar(r[1], llave)
  }
  for (const m of sql.matchAll(/INSERT INTO public\.role_permissions\s*\(role_id, permission_key, effect\)\s*VALUES((?:\s*\(\s*\w+\s*,\s*'[^']+'\s*,\s*'(?:allow|deny)'\s*\)\s*,?)+)\s*;/g)) {
    for (const t of m[1].matchAll(/\(\s*(\w+)\s*,\s*'([^']+)'\s*,\s*'(allow|deny)'\s*\)/g)) {
      if (t[3] !== 'allow') throw new Error(`El padrón siembra un «${t[3]}» (${t[2]}): este contraste solo entiende «allow».`)
      dar(t[1], t[2])
    }
  }

  const perfiles = new Map<string, PerfilPadron>()
  for (const [usuario, etiqueta] of etiquetaDe) {
    const rolVar = roleVarDeUsuario.get(usuario)
    perfiles.set(etiqueta, {
      etiqueta,
      rol: rolDeUsuario.get(usuario) ?? '',
      permisos: rolVar ? new Set(llavesDeRol.get(rolVar) ?? []) : new Set(),
    })
  }
  return perfiles
}

// ── Lectura del guion ───────────────────────────────────────────────────────

interface Guion {
  PERFILES: Record<string, { email: string; nombre: string }>
  ORDENES: Record<string, string>
  ESPERADO: Record<string, Record<string, string[]>>
  ETIQUETA: (texto: string) => string | undefined
}

/** Evalúa las declaraciones de `PERFILES` a `ETIQUETA` del guion tal cual están escritas (el resto del guion necesita navegador y sandbox). */
function leerGuion(mjs: string): Guion {
  const desde = mjs.indexOf('const PERFILES = {')
  const hasta = mjs.indexOf('const resultados = []')
  expect(desde, 'el guion ya no declara PERFILES').toBeGreaterThan(-1)
  expect(hasta, 'el guion ya no termina las declaraciones en «const resultados»').toBeGreaterThan(desde)
  return new Function(`${mjs.slice(desde, hasta)}\nreturn { PERFILES, ORDENES, ESPERADO, ETIQUETA }`)() as Guion
}

const padron = leerPadron(readFileSync(resolve(DIR, 'padron_ui_controles.sql.tpl'), 'utf8'))
const guion = leerGuion(readFileSync(resolve(DIR, 'pantalla_controles.mjs'), 'utf8'))

// ── La pantalla real ────────────────────────────────────────────────────────

/** Las tres órdenes del padrón: borrador nuevo (sin número), borrador devuelto (numerado, revisión 1) y aprobada. */
const ORDEN_DE: Record<string, Record<string, unknown>> = {
  nuevo: { estado: 'borrador', numero: null, revision: 0 },
  devuelto: { estado: 'borrador', numero: 'OC-000002', revision: 1, motivo_devolucion: 'ZZ UI corregir precio' },
  aprobada: { estado: 'aprobada', numero: 'OC-000003', revision: 0 },
}

/** Los botones de paso que la pantalla ofrece en la tarjeta de la orden, con las mismas etiquetas que el guion. */
function botonesQueOfrece(perfil: PerfilPadron, clave: string): string[] {
  const exento = ['admin', 'company_owner', 'super_admin', 'superadmin'].includes(perfil.rol)
  const orden = {
    id: `o-${clave}`, company_id: 'c1', project_id: 'p1', correlativo: 1, proveedor_id: null, proveedor_nombre: 'ZZ UI Proveedor',
    concepto: guion.ORDENES[clave], monto_estimado: null, contrato_id: null, created_at: '2026-10-02T00:00:00Z', ...ORDEN_DE[clave],
  }
  montarConSesion(
    <OrdenesCompraTab
      ordenes={[orden] as never} proyectoId="p1" companyId="c1" moneda="GTQ" onRefresh={vi.fn()} proveedores={[]}
      canCreate={exento || perfil.permisos.has('condominios.tab.ordenes_compra.create')}
      canEdit={exento || perfil.permisos.has('condominios.tab.ordenes_compra.edit')}
    />,
    { permisos: [...perfil.permisos], role: perfil.rol },
  )
  fireEvent.click(screen.getByText(guion.ORDENES[clave]))
  let tarjeta: HTMLElement | null = screen.getByText(guion.ORDENES[clave])
  while (tarjeta && ![...tarjeta.querySelectorAll('button')].some((b) => /Seguimiento/.test(b.textContent ?? ''))) tarjeta = tarjeta.parentElement
  expect(tarjeta, 'no se encontró la tarjeta de la orden expandida').not.toBeNull()
  const textos = [...tarjeta!.querySelectorAll('button')].map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim())
  return [...new Set(textos.map((t) => guion.ETIQUETA(t)).filter((e): e is string => !!e))].sort()
}

afterEach(cleanup)

describe('el contraste lee de verdad el padrón y el guion (sanidad: sin esto un verde podría ser vacío)', () => {
  it('la plantilla siembra los cinco perfiles del guion, con su rol de aplicación', () => {
    expect([...padron.keys()].sort()).toEqual(['admin', 'autoriza', 'estado', 'sinEditar', 'soloGenerico'])
    expect(padron.get('admin')!.rol).toBe('admin')
    for (const e of ['autoriza', 'estado', 'sinEditar', 'soloGenerico']) expect(padron.get(e)!.rol, e).toBe('operator')
  })

  it('el guion declara los mismos perfiles que el padrón siembra, con el correo que la plantilla arma (el inicio de sesión no distingue mayúsculas)', () => {
    expect(Object.keys(guion.PERFILES).sort()).toEqual([...padron.keys()].sort())
    expect(Object.keys(guion.ESPERADO).sort()).toEqual([...padron.keys()].sort())
    for (const [etiqueta, p] of Object.entries(guion.PERFILES)) expect(p.email, etiqueta).toBe(`zz-ui-${etiqueta}@example.com`.toLowerCase())
    for (const e of Object.keys(guion.ESPERADO)) expect(Object.keys(guion.ESPERADO[e]).sort(), e).toEqual(Object.keys(guion.ORDENES).sort())
  })

  it('cada perfil trae llaves (la lectura de las filas del padrón no quedó vacía)', () => {
    for (const e of ['autoriza', 'estado', 'sinEditar', 'soloGenerico']) {
      expect(padron.get(e)!.permisos.size, e).toBeGreaterThanOrEqual(6)
      expect(padron.get(e)!.permisos.has('platform.contabilidad.view'), e).toBe(true)
    }
  })
})

describe('el padrón concede lo que el servidor exige (D1)', () => {
  it('«Autorizar + Editar» y «Autorizar sin Editar» tienen la llave de la pestaña de órdenes; «solo genérico» y «Cambiar estado» NO', () => {
    expect(padron.get('autoriza')!.permisos.has(LLAVE_OC)).toBe(true)
    expect(padron.get('sinEditar')!.permisos.has(LLAVE_OC)).toBe(true)
    expect(padron.get('soloGenerico')!.permisos.has(LLAVE_OC)).toBe(false)
    expect(padron.get('estado')!.permisos.has(LLAVE_OC)).toBe(false)
  })

  it('«solo genérico» tiene el «Autorizar» genérico y «Editar» de Contabilidad (por eso el genérico es lo único que le falta de la llave de la orden)', () => {
    const p = padron.get('soloGenerico')!.permisos
    expect(p.has('platform.contabilidad.approve')).toBe(true)
    expect(p.has('platform.contabilidad.edit')).toBe(true)
  })
})

describe('la pantalla real ofrece a cada perfil del padrón exactamente lo que el guion espera', () => {
  const casos = ['admin', 'autoriza', 'estado', 'sinEditar', 'soloGenerico'].flatMap((perfil) =>
    ['nuevo', 'devuelto', 'aprobada'].map((orden) => ({ perfil, orden })),
  )
  it.each(casos)('$perfil · orden $orden', ({ perfil, orden }) => {
    expect(botonesQueOfrece(padron.get(perfil)!, orden)).toEqual([...guion.ESPERADO[perfil][orden]].sort())
  })
})
