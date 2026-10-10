// RolPermisosModal › matriz de permisos efectivos: el grupo «Compras y pagos» sale del CATÁLOGO que el modal cargó.
//
// Las cinco llaves nuevas las siembra una migración. Si la pantalla se despliega antes (o en un entorno sin esa migración), el
// catálogo cargado no las trae: la matriz no puede ofrecer casillas que, al guardar, la clave foránea role_permissions →
// permissions rechazaría. Aquí se monta el modal REAL (solo el acceso a datos está simulado) con y sin las llaves en el catálogo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LLAVES_ACCION_COMPRAS } from '../../../lib/platformPermissions'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const h = vi.hoisted(() => ({ catalogo: [] as Array<{ key: string; category: string; label: string; description: string | null }> }))

vi.mock('../../../domain/empresa/roles', () => {
  const ok = <T,>(data: T) => Promise.resolve({ data, error: null })
  return {
    fetchCompanyRoles: () => ok([{ id: 'r1', company_id: 'c1', name: 'Finanzas / Contador', description: null, is_system: false, color: '#1b3b36' }]),
    fetchAllRolePermissions: () => ok([]),
    fetchPermissionsCatalog: () => ok(h.catalogo),
    fetchUserRoleAssignments: () => ok([{ role_id: 'r1', expires_at: null }]),
    fetchUserRoleIds: () => ok([]),
    fetchUserOverrideRole: () => ok(null),
    fetchRolePermissionsWithEffect: () => ok([]),
    ensureCompanyRoleFromTemplate: vi.fn(),
    createOverrideRole: vi.fn(),
    deleteUserRoles: vi.fn(),
    insertUserRoles: vi.fn(),
    updateUserRoleExpiration: vi.fn(),
    deleteRole: vi.fn(),
    deleteRolePermissions: vi.fn(),
    insertRolePermissions: vi.fn(),
  }
})

import { RolPermisosModal } from '../RolPermisosModal'

const K = LLAVES_ACCION_COMPRAS
const fila = (key: string, label: string) => ({ key, category: 'platform_contabilidad', label, description: null })
const OC = fila(K.aprobarOrdenCompra, 'Autorizar / Denegar — Órdenes compra')
const CINCO = [
  fila(K.registrarRecepcion, 'Compras y pagos — Registrar una recepción'),
  fila(K.aprobarFactura, 'Compras y pagos — Aprobar una factura de proveedor'),
  fila(K.aprobarOrdenPago, 'Compras y pagos — Aprobar una orden de pago'),
  fila(K.ejecutarPago, 'Compras y pagos — Ejecutar un pago'),
  fila(K.anularPago, 'Compras y pagos — Anular un pago'),
]

async function abrirMatriz() {
  render(
    <RolPermisosModal
      usuarioId="u1" usuarioNombre="Ana" companyId="c1" servicioAgua={false} servicioCondominios={false}
      onClose={vi.fn()} onSaved={vi.fn()} onOpenCustomEditor={vi.fn()}
    />,
  )
  // la matriz se pinta cuando termina de cargar roles y catálogo
  await screen.findByText('Permisos efectivos')
  await screen.findByRole('button', { name: /Plataforma: Contabilidad/ })
}
const LAS_SEIS: readonly string[] = Object.values(K)
const lineasDeCompras = () =>
  Array.from(document.querySelectorAll('[data-perm-key]')).map((el) => el.getAttribute('data-perm-key')).filter((k): k is string => !!k && LAS_SEIS.includes(k))

beforeEach(() => { h.catalogo = [] })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('RolPermisosModal › grupo «Compras y pagos» según el catálogo cargado', () => {
  it('con las seis llaves en el catálogo, la matriz ofrece el grupo con las seis, con la etiqueta del catálogo', async () => {
    h.catalogo = [OC, ...CINCO]
    await abrirMatriz()
    fireEvent.click(screen.getByRole('button', { name: /Plataforma: Compras y pagos/ }))
    expect(lineasDeCompras()).toEqual(Object.values(K))
    expect(screen.getByText('Compras y pagos — Ejecutar un pago')).toBeTruthy()
  })

  it('SIN las cinco llaves nuevas en el catálogo (migración aún no aplicada), no hay casillas «compras» que fallarían al guardar', async () => {
    h.catalogo = [OC]
    await abrirMatriz()
    fireEvent.click(screen.getByRole('button', { name: /Plataforma: Compras y pagos/ }))
    expect(lineasDeCompras()).toEqual([K.aprobarOrdenCompra])
    for (const k of CINCO.map((c) => c.key)) expect(document.querySelector(`[data-perm-key="${k}"]`)).toBeNull()
  })

  it('con un catálogo que no trae ninguna de las seis, el grupo no aparece; los demás módulos de plataforma sí', async () => {
    h.catalogo = [fila('platform.contabilidad.view', 'Ver — Contabilidad')]
    await abrirMatriz()
    await waitFor(() => expect(screen.queryByRole('button', { name: /Plataforma: Compras y pagos/ })).toBeNull())
    expect(screen.getByRole('button', { name: /Plataforma: Clientes/ })).toBeTruthy()
  })
})
