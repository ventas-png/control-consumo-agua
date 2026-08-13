// Invariantes del registro declarativo de rutas (P1 #4). No renderiza DOM:
// inspecciona los elementos React que produce renderAppRoute y la tabla
// APP_ROUTES contra el mapping AppSection ↔ path de lib/routes.
import { describe, it, expect } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { APP_ROUTES, renderAppRoute, type AppRoutesCtx } from '../routes'
import { SECTION_TO_PATH } from '../../../lib/routes'
import { CONFIGURABLE_MODULES } from '../../../lib/moduleConfig'
import { ErrorBoundary } from '../../ErrorBoundary'
import { RoleGuard, AccessDenied } from '../../shared/AccessDenied'
import type { UserSession } from '../../../types'
import type { AguaData } from '../../../hooks/useAguaData'

function ctxStub(overrides: Partial<AppRoutesCtx> = {}): AppRoutesCtx {
  return {
    currentUser: { user_id: 'u1', role: 'admin', company_id: 'co1' } as UserSession,
    canViewModule: () => true,
    canCreate: () => true,
    canEdit: () => true,
    canChangeStatus: () => true,
    canApprove: () => true,
    canDelete: () => true,
    agua: {} as AguaData,
    condominiosSinProyecto: false,
    navigateSection: () => {},
    handleLogout: () => {},
    updateProfile: async () => null,
    rutaActivaParaLecturas: null,
    clearRutaActiva: () => {},
    onEjecutarRuta: () => {},
    ...overrides,
  }
}

/** Resuelve si un path concreto matchea un pattern del registro (estático o :param). */
function matchea(pattern: string, path: string): boolean {
  if (pattern === path) return true
  const pSeg = pattern.split('/')
  const seg = path.split('/')
  if (pSeg.length !== seg.length) return false
  return pSeg.every((p, i) => p.startsWith(':') || p === seg[i])
}

describe('APP_ROUTES', () => {
  it('no tiene paths duplicados', () => {
    const paths = APP_ROUTES.map(r => r.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('cubre todos los paths navegables de SECTION_TO_PATH', () => {
    // '/paquetes' nunca tuvo ruta propia: cae al wildcard (Navigate a clientes).
    const sinRutaPropia = new Set(['/paquetes'])
    for (const path of Object.values(SECTION_TO_PATH)) {
      if (sinRutaPropia.has(path)) continue
      const cubierto = APP_ROUTES.some(r => matchea(r.path, path))
      expect(cubierto, `falta ruta para ${path}`).toBe(true)
    }
  })

  it('declara los guards críticos de rol y módulo', () => {
    const byPath = Object.fromEntries(APP_ROUTES.map(r => [r.path, r]))
    // Guard duro por rol: solo secciones NO configurables por RBAC.
    expect(byPath['/superadmin'].allowedRoles).toEqual(['super_admin'])
    expect(byPath['/empresa'].allowedRoles).toEqual(['company_owner'])
    expect(byPath['/admin-dashboard'].allowedRoles).toEqual(['company_owner'])
    // Módulos configurables: gating por permiso RBAC, nunca por rol base.
    expect(byPath['/contabilidad'].module).toBe('contabilidad')
    expect(byPath['/configuracion'].module).toBe('configuracion')
    expect(byPath['/cobros'].module).toBe('cobros')
    expect(byPath['/cobros'].moduleRoleBypass).toEqual(['collector'])
    for (const mod of ['clientes', 'lecturas', 'dashboard', 'mapa', 'rutas', 'calidad', 'tarifas', 'unidades', 'contadores']) {
      expect(byPath[`/${mod}`].module, `/${mod} debe declarar guard de módulo`).toBe(mod)
    }
    expect(byPath['/historial'].module).toBe('tabla')
    // Sin guard (acceso de cualquier rol autenticado):
    expect(byPath['/perfil'].allowedRoles).toBeUndefined()
    expect(byPath['/perfil'].module).toBeUndefined()
    expect(byPath['/comunicacion'].allowedRoles).toBeUndefined()
    expect(byPath['/comunicacion'].module).toBe('comunicacion')
  })

  // Regresión: el sidebar muestra los módulos configurables por permiso
  // (Sidebar.isTabVisible → canViewModule). Si además llevaran RoleGuard, un
  // rol RBAC con el permiso otorgado vería el tab y al entrar recibiría
  // "Acceso Denegado" — que es exactamente lo que pasaba en /contabilidad.
  it('ningún módulo configurable se gatea por rol base', () => {
    const configurables = new Set(CONFIGURABLE_MODULES.map(m => m.key))
    for (const def of APP_ROUTES) {
      if (def.module && configurables.has(def.module)) {
        expect(def.allowedRoles, `${def.path} no debe declarar allowedRoles`).toBeUndefined()
      }
    }
    // Cerrojo por el otro lado: una ruta podría gatear un módulo configurable
    // por rol SIN declarar `module` (así estaban /cobros y /configuracion), y
    // el chequeo de arriba no la vería. La lista de rutas con guard de rol es
    // cerrada: si aparece una nueva, hay que decidir a conciencia si es
    // NON_CONFIGURABLE o si le toca gating por permiso.
    const conRoleGuard = APP_ROUTES.filter(r => r.allowedRoles).map(r => r.path).sort()
    expect(conRoleGuard).toEqual(['/admin-dashboard', '/empresa', '/superadmin'])
  })
})

describe('renderAppRoute', () => {
  const clientesDef = APP_ROUTES.find(r => r.path === '/clientes')!
  const cobrosDef = APP_ROUTES.find(r => r.path === '/cobros')!
  const contabilidadDef = APP_ROUTES.find(r => r.path === '/contabilidad')!
  const superadminDef = APP_ROUTES.find(r => r.path === '/superadmin')!

  /** Baja hasta el nodo renderizado, saltando ErrorBoundary y RoleGuard. */
  function contenido(el: ReactElement): ReactElement {
    let node = el
    while (node.type === ErrorBoundary || node.type === RoleGuard) {
      node = (node.props as { children: ReactElement }).children
    }
    return node
  }

  it('módulo denegado: envuelve AccessDenied en el ErrorBoundary de la sección', () => {
    const el = renderAppRoute(clientesDef, ctxStub({ canViewModule: () => false })) as ReactElement
    expect(isValidElement(el)).toBe(true)
    expect(el.type).toBe(ErrorBoundary)
    expect((el.props as { sectionName: string }).sectionName).toBe('clientes')
    const child = (el.props as { children: ReactElement }).children
    expect(child.type).toBe(AccessDenied)
  })

  it('módulo permitido: renderiza la sección (no AccessDenied)', () => {
    const el = renderAppRoute(clientesDef, ctxStub()) as ReactElement
    const child = (el.props as { children: ReactElement }).children
    expect(child.type).not.toBe(AccessDenied)
  })

  it('contabilidad: un rol no exento CON el permiso entra', () => {
    const el = renderAppRoute(contabilidadDef, ctxStub({
      currentUser: { user_id: 'u1', role: 'operator', company_id: 'co1' } as UserSession,
      canViewModule: mod => mod === 'contabilidad',
    })) as ReactElement
    expect(contenido(el).type).not.toBe(AccessDenied)
  })

  it('contabilidad: un rol no exento SIN el permiso recibe AccessDenied', () => {
    const el = renderAppRoute(contabilidadDef, ctxStub({
      currentUser: { user_id: 'u1', role: 'operator', company_id: 'co1' } as UserSession,
      canViewModule: () => false,
    })) as ReactElement
    expect(contenido(el).type).toBe(AccessDenied)
  })

  it('cobros: collector entra sin permiso RBAC (bypass legacy)', () => {
    const el = renderAppRoute(cobrosDef, ctxStub({
      currentUser: { user_id: 'u1', role: 'collector', company_id: 'co1' } as UserSession,
      canViewModule: () => false,
    })) as ReactElement
    expect(contenido(el).type).not.toBe(AccessDenied)
  })

  it('cobros: un rol sin permiso ni bypass recibe AccessDenied', () => {
    const el = renderAppRoute(cobrosDef, ctxStub({
      currentUser: { user_id: 'u1', role: 'viewer', company_id: 'co1' } as UserSession,
      canViewModule: () => false,
    })) as ReactElement
    expect(contenido(el).type).toBe(AccessDenied)
  })

  it('configuración: gateada por permiso, no por rol base', () => {
    const configuracionDef = APP_ROUTES.find(r => r.path === '/configuracion')!
    const conPermiso = renderAppRoute(configuracionDef, ctxStub({
      currentUser: { user_id: 'u1', role: 'operator', company_id: 'co1' } as UserSession,
      canViewModule: mod => mod === 'configuracion',
    })) as ReactElement
    expect(contenido(conPermiso).type).not.toBe(AccessDenied)

    const sinPermiso = renderAppRoute(configuracionDef, ctxStub({
      currentUser: { user_id: 'u1', role: 'operator', company_id: 'co1' } as UserSession,
      canViewModule: () => false,
    })) as ReactElement
    expect(contenido(sinPermiso).type).toBe(AccessDenied)
  })

  it('cobros: un rol no exento CON agua.cobros.view entra sin ser collector', () => {
    const el = renderAppRoute(cobrosDef, ctxStub({
      currentUser: { user_id: 'u1', role: 'viewer', company_id: 'co1' } as UserSession,
      canViewModule: mod => mod === 'cobros',
    })) as ReactElement
    expect(contenido(el).type).not.toBe(AccessDenied)
  })

  it('roles declarados: envuelve en RoleGuard dentro del ErrorBoundary', () => {
    const el = renderAppRoute(superadminDef, ctxStub()) as ReactElement
    expect(el.type).toBe(ErrorBoundary)
    const guard = (el.props as { children: ReactElement }).children
    expect(guard.type).toBe(RoleGuard)
    expect((guard.props as { allowedRoles: string[] }).allowedRoles).toEqual(['super_admin'])
  })
})
