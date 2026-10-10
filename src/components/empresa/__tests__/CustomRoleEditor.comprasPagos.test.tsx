// Editor de roles: las cinco llaves nuevas de compras y pagos forman SU PROPIA fila, con etiqueta legible.
//
// El editor agrupa el catálogo por «clave sin sufijo de acción conocida»: una clave cuyo último segmento NO es
// view / create / edit / change_status / approve / delete forma su propia fila, con una casilla en la columna «Ver», y
// la etiqueta de la fila es la del permiso sin el prefijo «Compras y pagos — ». Si una llave nueva terminara en una
// acción conocida, el editor la fundiría con otra fila y no se podría conceder por separado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PermissionDef } from '../../../types'
import { LLAVES_ACCION_COMPRAS } from '../../../lib/platformPermissions'

const h = vi.hoisted(() => ({
  catalogo: [] as PermissionDef[],
  createRole: vi.fn(),
  setRolePermissions: vi.fn(),
  onSaved: vi.fn(),
}))

vi.mock('../../../domain/empresa/roles', () => ({
  fetchPermissionsCatalog: vi.fn(async () => ({ data: h.catalogo, error: null })),
  fetchRoleById: vi.fn(async () => ({ data: null, error: null })),
  fetchRolePermissionKeys: vi.fn(async () => ({ data: [], error: null })),
  updateRole: vi.fn(),
  createRole: h.createRole,
  setRolePermissions: h.setRolePermissions,
}))

import { CustomRoleEditor } from '../CustomRoleEditor'

const K = LLAVES_ACCION_COMPRAS
const CINCO = [
  [K.registrarRecepcion, 'Registrar una recepción'],
  [K.aprobarFactura, 'Aprobar una factura de proveedor'],
  [K.aprobarOrdenPago, 'Aprobar una orden de pago'],
  [K.ejecutarPago, 'Ejecutar un pago'],
  [K.anularPago, 'Anular un pago'],
] as const

const permiso = (key: string, label: string, category = 'platform_contabilidad'): PermissionDef => ({ key, category, label })

/** El catálogo como lo deja la base: las seis acciones de Contabilidad, las cinco llaves nuevas y la pestaña de órdenes. */
function catalogoReal(): PermissionDef[] {
  return [
    permiso('platform.contabilidad.view', 'Ver — Contabilidad'),
    permiso('platform.contabilidad.create', 'Crear — Contabilidad'),
    permiso('platform.contabilidad.edit', 'Editar — Contabilidad'),
    permiso('platform.contabilidad.change_status', 'Cambiar estado — Contabilidad'),
    permiso('platform.contabilidad.approve', 'Autorizar / Denegar — Contabilidad'),
    permiso('platform.contabilidad.delete', 'Eliminar — Contabilidad'),
    ...CINCO.map(([key, accion]) => permiso(key, `Compras y pagos — ${accion}`)),
    permiso('condominios.tab.ordenes_compra', 'Órdenes compra', 'operaciones'),
    permiso('condominios.tab.ordenes_compra.approve', 'Autorizar / Denegar — Órdenes compra', 'operaciones'),
  ]
}

/** Las seis celdas de acción (Ver … Eliminar) que siguen a la etiqueta de una fila. */
function celdasDeFila(etiqueta: string): HTMLElement[] {
  const boton = screen.getByRole('button', { name: etiqueta })
  const celdas: HTMLElement[] = []
  let el = boton.nextElementSibling
  while (el && celdas.length < 6) { celdas.push(el as HTMLElement); el = el.nextElementSibling }
  return celdas
}

async function abrir() {
  render(<CustomRoleEditor companyId="c1" roleId={null} onClose={vi.fn()} onSaved={h.onSaved} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ejecutar un pago' })).toBeTruthy())
}

beforeEach(() => {
  h.catalogo = catalogoReal()
  h.createRole.mockResolvedValue({ data: { id: 'rol-nuevo' }, error: null })
  h.setRolePermissions.mockResolvedValue({ error: null })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('CustomRoleEditor · compras y pagos', () => {
  it.each(CINCO)('%s forma su PROPIA fila, etiquetada «%s» (sin el prefijo)', async (_key, accion) => {
    await abrir()
    const celdas = celdasDeFila(accion)
    expect(celdas).toHaveLength(6)
    // una sola casilla, en la columna «Ver»; las otras cinco acciones no existen para esta fila
    const casillas = celdas.map((c) => within(c).queryAllByRole('checkbox'))
    expect(casillas.map((c) => c.length)).toEqual([1, 0, 0, 0, 0, 0])
    expect(casillas[0][0].getAttribute('aria-label')).toBe(`Compras y pagos — ${accion}`)
    expect(celdas.slice(1).every((c) => c.textContent === '—')).toBe(true)
  })

  it('ninguna etiqueta de fila conserva el prefijo «Compras y pagos —» (solo la casilla lo lleva, para el lector de pantalla)', async () => {
    await abrir()
    expect(screen.queryAllByRole('button', { name: /Compras y pagos/ })).toEqual([])
    for (const [, accion] of CINCO) expect(screen.getAllByRole('button', { name: accion })).toHaveLength(1)
  })

  it('no se funden con la fila genérica de Contabilidad, que conserva sus seis acciones', async () => {
    await abrir()
    const celdas = celdasDeFila('Contabilidad')
    expect(celdas.map((c) => within(c).queryAllByRole('checkbox').length)).toEqual([1, 1, 1, 1, 1, 1])
    const etiquetas = celdas.map((c) => within(c).getByRole('checkbox').getAttribute('aria-label'))
    expect(etiquetas.every((e) => e?.endsWith('— Contabilidad'))).toBe(true)
    // cinco filas nuevas + la genérica: seis filas distintas en la categoría
    expect(screen.getAllByRole('button', { name: /^(Contabilidad|Registrar una recepción|Aprobar una factura de proveedor|Aprobar una orden de pago|Ejecutar un pago|Anular un pago)$/ })).toHaveLength(6)
  })

  it('la categoría se rotula «Plataforma — Contabilidad» y reúne las seis filas', async () => {
    await abrir()
    expect(screen.getByText('Plataforma — Contabilidad')).toBeTruthy()
  })

  it('marcar una casilla concede SOLO esa llave, y se guarda tal cual en el rol', async () => {
    await abrir()
    const [verEjecutar] = celdasDeFila('Ejecutar un pago')
    fireEvent.click(within(verEjecutar).getByRole('checkbox'))
    expect(screen.getByText(/1 permisos seleccionados/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('ej. Guardia nocturno'), { target: { value: 'Tesorería' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar rol' }))
    await waitFor(() => expect(h.setRolePermissions).toHaveBeenCalledTimes(1))
    expect(h.setRolePermissions).toHaveBeenCalledWith('rol-nuevo', [K.ejecutarPago])
    expect(h.onSaved).toHaveBeenCalledWith('rol-nuevo')
  })

  it('cada decisión se concede por separado: marcar «Aprobar una orden de pago» no marca «Ejecutar un pago» ni «Anular un pago»', async () => {
    await abrir()
    fireEvent.click(within(celdasDeFila('Aprobar una orden de pago')[0]).getByRole('checkbox'))
    const marcado = (accion: string) => (within(celdasDeFila(accion)[0]).getByRole('checkbox') as HTMLInputElement).checked
    expect(marcado('Aprobar una orden de pago')).toBe(true)
    expect(marcado('Ejecutar un pago')).toBe(false)
    expect(marcado('Anular un pago')).toBe(false)
    expect(marcado('Aprobar una factura de proveedor')).toBe(false)
    expect(marcado('Registrar una recepción')).toBe(false)
  })

  it('la etiqueta de la fila alterna la fila entera (una sola llave) y se puede quitar', async () => {
    await abrir()
    const casilla = () => within(celdasDeFila('Anular un pago')[0]).getByRole('checkbox') as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: 'Anular un pago' }))
    expect(casilla().checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Anular un pago' }))
    expect(casilla().checked).toBe(false)
  })

  it('el buscador encuentra las decisiones por su nombre', async () => {
    await abrir()
    fireEvent.change(screen.getByPlaceholderText('Buscar permiso…'), { target: { value: 'factura' } })
    expect(screen.getByRole('button', { name: 'Aprobar una factura de proveedor' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ejecutar un pago' })).toBeNull()
  })

  it('la llave de la orden de compra se concede desde la columna «Autorizar» de su pestaña «Órdenes compra»', async () => {
    await abrir()
    const celdas = celdasDeFila('Órdenes compra')
    const autorizar = within(celdas[4]).getByRole('checkbox')          // Ver, Crear, Editar, Estado, Autorizar, Eliminar
    expect(autorizar.getAttribute('aria-label')).toBe('Autorizar / Denegar — Órdenes compra')
    fireEvent.click(autorizar)
    // conceder una acción marca también «Ver» de la pestaña (prerrequisito en runtime)
    expect((within(celdas[0]).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('ej. Guardia nocturno'), { target: { value: 'Compras' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar rol' }))
    await waitFor(() => expect(h.setRolePermissions).toHaveBeenCalledTimes(1))
    expect(new Set(h.setRolePermissions.mock.calls[0][1])).toEqual(new Set(['condominios.tab.ordenes_compra', K.aprobarOrdenCompra]))
  })
})
