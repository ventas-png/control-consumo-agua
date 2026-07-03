// Invariantes del registro declarativo de rutas (P1 #4). No renderiza DOM:
// inspecciona los elementos React que produce renderAppRoute y la tabla
// APP_ROUTES contra el mapping AppSection ↔ path de lib/routes.
import { describe, it, expect } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { APP_ROUTES, renderAppRoute, type AppRoutesCtx } from '../routes'
import { SECTION_TO_PATH } from '../../../lib/routes'
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
    expect(byPath['/cobros'].allowedRoles).toEqual(['collector', 'admin', 'super_admin', 'company_owner'])
    expect(byPath['/superadmin'].allowedRoles).toEqual(['super_admin'])
    expect(byPath['/empresa'].allowedRoles).toEqual(['company_owner'])
    expect(byPath['/admin-dashboard'].allowedRoles).toEqual(['company_owner'])
    expect(byPath['/configuracion'].allowedRoles).toEqual(['admin', 'super_admin', 'company_owner'])
    expect(byPath['/contabilidad'].allowedRoles).toEqual(['admin', 'super_admin', 'company_owner'])
    expect(byPath['/contabilidad'].module).toBe('contabilidad')
    for (const mod of ['clientes', 'lecturas', 'dashboard', 'mapa', 'rutas', 'calidad', 'tarifas', 'unidades', 'contadores']) {
      expect(byPath[`/${mod}`].module, `/${mod} debe declarar guard de módulo`).toBe(mod)
    }
    expect(byPath['/historial'].module).toBe('tabla')
    // Sin guard (acceso de cualquier rol autenticado):
    expect(byPath['/perfil'].allowedRoles).toBeUndefined()
    expect(byPath['/perfil'].module).toBeUndefined()
    expect(byPath['/comunicacion'].allowedRoles).toBeUndefined()
  })
})

describe('renderAppRoute', () => {
  const clientesDef = APP_ROUTES.find(r => r.path === '/clientes')!
  const cobrosDef = APP_ROUTES.find(r => r.path === '/cobros')!

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

  it('roles declarados: envuelve en RoleGuard dentro del ErrorBoundary', () => {
    const el = renderAppRoute(cobrosDef, ctxStub()) as ReactElement
    expect(el.type).toBe(ErrorBoundary)
    const guard = (el.props as { children: ReactElement }).children
    expect(guard.type).toBe(RoleGuard)
    expect((guard.props as { allowedRoles: string[] }).allowedRoles).toContain('collector')
  })
})
