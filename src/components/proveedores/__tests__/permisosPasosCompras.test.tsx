// Decisión ÚNICA de qué pasos de compras y pagos se ofrecen (proveedores/permisos.ts).
//
// Las seis decisiones tienen cada una SU llave RBAC y todas piden además «Editar» de Contabilidad. Esta suite fija la
// tabla de verdad de `decidirPasosCompras` (la función pura que usan las pestañas de Compras, Cuentas por pagar y
// Órdenes compra) y que los dos hooks que la exponen (`usePermisosProveedor`, `usePermisosContabilidad`) dicen lo mismo.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LLAVES_ACCION_COMPRAS, type AccionCompras } from '../../../lib/platformPermissions'
import { PermissionsProvider } from '../../shared/PermissionsContext'
import { SessionProvider } from '../../shared/SessionContext'
import { sesionCon } from '../../../test/sesionPermisos'
import { usePermisosContabilidad } from '../../contabilidad/ui'
import { decidirPasosCompras, usePermisosProveedor, type PasosCompras } from '../permisos'

afterEach(cleanup)

const ACCIONES: Array<[AccionCompras, keyof PasosCompras]> = [
  ['aprobarOrdenCompra', 'puedeAprobarOrdenCompra'],
  ['registrarRecepcion', 'puedeRegistrarRecepcion'],
  ['aprobarFactura', 'puedeAprobarFactura'],
  ['aprobarOrdenPago', 'puedeAprobarOrdenPago'],
  ['ejecutarPago', 'puedeEjecutarPago'],
  ['anularPago', 'puedeAnularPago'],
]
const BANDERAS = ACCIONES.map(([, b]) => b)

const entrada = (permisos: string[], extra: Partial<Parameters<typeof decidirPasosCompras>[0]> = {}) => ({
  rol: 'operator', permisos: new Set(permisos), puedeEditar: true, puedeCambiarEstado: false, ...extra,
})
const verdaderas = (p: PasosCompras) => (Object.keys(p) as Array<keyof PasosCompras>).filter((k) => p[k])

describe('decidirPasosCompras · cada acción responde a SU llave y a nadie más', () => {
  it.each(ACCIONES)('%s: solo con su llave (+ Editar) se ofrece, y ninguna de las otras cinco', (accion, bandera) => {
    const p = decidirPasosCompras(entrada([LLAVES_ACCION_COMPRAS[accion]]))
    expect(p[bandera]).toBe(true)
    expect(verdaderas(p)).toEqual([bandera])
  })

  it.each(ACCIONES)('%s: con las otras cinco llaves y «Cambiar estado» pero SIN la suya, no se ofrece', (accion, bandera) => {
    const otras = Object.entries(LLAVES_ACCION_COMPRAS).filter(([a]) => a !== accion).map(([, k]) => k)
    const p = decidirPasosCompras(entrada(otras, { puedeCambiarEstado: true }))
    expect(p[bandera]).toBe(false)
    for (const [otra, b] of ACCIONES) if (otra !== accion) expect(p[b]).toBe(true)
  })

  it.each(ACCIONES)('%s: con su llave pero SIN «Editar» de Contabilidad no se ofrece', (accion, bandera) => {
    const p = decidirPasosCompras(entrada([LLAVES_ACCION_COMPRAS[accion]], { puedeEditar: false }))
    expect(p[bandera]).toBe(false)
  })

  it('los genéricos «Autorizar / Denegar» y «Cambiar estado» de Contabilidad no conceden ninguna de las seis', () => {
    const p = decidirPasosCompras(entrada(
      ['platform.contabilidad.view', 'platform.contabilidad.edit', 'platform.contabilidad.approve', 'platform.contabilidad.change_status'],
      { puedeCambiarEstado: true },
    ))
    for (const b of BANDERAS) expect(p[b]).toBe(false)
    // …pero sí conservan los pasos que no tienen llave propia (emitir, cancelar, anular recepción/factura/contraseña)
    expect(p.puedeCambiarEstadoPaso).toBe(true)
  })

  it('sin permisos (sesión sin lista de llaves) no se ofrece nada', () => {
    const p = decidirPasosCompras({ rol: 'operator', permisos: undefined, puedeEditar: false, puedeCambiarEstado: false })
    expect(verdaderas(p)).toEqual([])
  })
})

describe('decidirPasosCompras · los pasos sin llave propia siguen con «Cambiar estado» + «Editar»', () => {
  it('«Cambiar estado» y «Editar» → sí', () => {
    expect(decidirPasosCompras(entrada([], { puedeCambiarEstado: true })).puedeCambiarEstadoPaso).toBe(true)
  })
  it('«Cambiar estado» sin «Editar» → no', () => {
    expect(decidirPasosCompras(entrada([], { puedeCambiarEstado: true, puedeEditar: false })).puedeCambiarEstadoPaso).toBe(false)
  })
  it('«Editar» sin «Cambiar estado» → no (aunque tenga las seis llaves)', () => {
    const p = decidirPasosCompras(entrada(Object.values(LLAVES_ACCION_COMPRAS)))
    expect(p.puedeCambiarEstadoPaso).toBe(false)
  })
})

describe('decidirPasosCompras · roles exentos', () => {
  it.each(['super_admin', 'superadmin', 'company_owner', 'admin'])('%s ve todo, igual que el servidor lo deja pasar', (rol) => {
    const p = decidirPasosCompras({ rol, permisos: new Set(), puedeEditar: false, puedeCambiarEstado: false })
    expect(verdaderas(p).sort()).toEqual([...BANDERAS, 'puedeCambiarEstadoPaso'].sort())
  })

  // `cliente` SÍ está en EXEMPT_ROLES de moduleConfig (el portal del residente no pasa por el sidebar de módulos), pero el servidor
  // (`user_has_permission`) solo exime a super_admin, superadmin, company_owner y admin: con `cliente` se ofrecería un botón que el
  // servidor rechaza. Por eso las seis NO se derivan de EXEMPT_ROLES.
  it('cliente NO es exento: con todas las banderas de la sesión pero sin llaves, no ve ninguna de las seis', () => {
    const p = decidirPasosCompras({ rol: 'cliente', permisos: new Set(), puedeEditar: true, puedeCambiarEstado: true })
    for (const b of BANDERAS) expect(p[b], b).toBe(false)
    expect(p.puedeCambiarEstadoPaso).toBe(true) // este sí sale de las banderas de la sesión, no del rol
  })

  it.each(['operator', 'viewer', 'collector', undefined, null])('%s NO es exento: sin llaves no ve nada', (rol) => {
    const p = decidirPasosCompras({ rol, permisos: new Set(), puedeEditar: true, puedeCambiarEstado: true })
    for (const b of BANDERAS) expect(p[b]).toBe(false)
  })
})

describe('los hooks exponen la MISMA decisión', () => {
  const envoltura = (permisos: string[], role = 'operator') =>
    function Envoltura({ children }: { children: ReactNode }) {
      return (
        <SessionProvider value={sesionCon(permisos, role)}>
          <PermissionsProvider>{children}</PermissionsProvider>
        </SessionProvider>
      )
    }
  const llaves = ['platform.contabilidad.view', 'platform.contabilidad.edit', 'platform.contabilidad.change_status', LLAVES_ACCION_COMPRAS.ejecutarPago, LLAVES_ACCION_COMPRAS.aprobarOrdenCompra]

  it('usePermisosContabilidad y usePermisosProveedor coinciden con decidirPasosCompras', () => {
    const wrapper = envoltura(llaves)
    const conta = renderHook(() => usePermisosContabilidad(), { wrapper }).result.current
    const prov = renderHook(() => usePermisosProveedor(), { wrapper }).result.current
    const esperado = decidirPasosCompras({ rol: 'operator', permisos: new Set(llaves), puedeEditar: true, puedeCambiarEstado: true })
    for (const k of Object.keys(esperado) as Array<keyof PasosCompras>) {
      expect(conta[k], `contabilidad.${k}`).toBe(esperado[k])
      expect(prov[k], `proveedor.${k}`).toBe(esperado[k])
    }
    expect(verdaderas(esperado).sort()).toEqual(['puedeAprobarOrdenCompra', 'puedeCambiarEstadoPaso', 'puedeEjecutarPago'])
  })

  it('un administrador ve las seis por los dos hooks', () => {
    const wrapper = envoltura([], 'admin')
    const conta = renderHook(() => usePermisosContabilidad(), { wrapper }).result.current
    const prov = renderHook(() => usePermisosProveedor(), { wrapper }).result.current
    for (const b of BANDERAS) {
      expect(conta[b]).toBe(true)
      expect(prov[b]).toBe(true)
    }
  })

  it('el genérico «Autorizar / Denegar» sigue expuesto (autorizar proveedores) pero ya no decide ningún paso', () => {
    const wrapper = envoltura(['platform.contabilidad.view', 'platform.contabilidad.edit', 'platform.contabilidad.approve'])
    const conta = renderHook(() => usePermisosContabilidad(), { wrapper }).result.current
    expect(conta.puedeAutorizar).toBe(true)
    for (const b of BANDERAS) expect(conta[b]).toBe(false)
  })
})
