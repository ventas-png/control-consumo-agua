// Matriz de permisos efectivos (RolPermisosModal › «Ajustes finos»): el grupo «Compras y pagos» muestra las seis
// decisiones, cada una con la etiqueta del catálogo, y cada casilla se concede o se bloquea por separado.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LLAVES_ACCION_COMPRAS, gruposPlataformaDisponibles } from '../../../lib/platformPermissions'
import { PermissionMatrixPanel } from '../PermissionMatrixPanel'

afterEach(cleanup)

const K = LLAVES_ACCION_COMPRAS
const ETIQUETAS = new Map<string, string>([
  [K.aprobarOrdenCompra, 'Autorizar / Denegar — Órdenes compra'],
  [K.registrarRecepcion, 'Compras y pagos — Registrar una recepción'],
  [K.aprobarFactura, 'Compras y pagos — Aprobar una factura de proveedor'],
  [K.aprobarOrdenPago, 'Compras y pagos — Aprobar una orden de pago'],
  [K.ejecutarPago, 'Compras y pagos — Ejecutar un pago'],
  [K.anularPago, 'Compras y pagos — Anular un pago'],
])

function montar(efectivas: string[] = [], alternar = vi.fn(), catalogo: Map<string, string> = ETIQUETAS) {
  render(
    <PermissionMatrixPanel
      sections={[{ label: 'Plataforma', groups: gruposPlataformaDisponibles(catalogo) }]}
      effective={new Set(efectivas)}
      grantedBy={new Map()}
      rolesById={new Map()}
      permLabels={catalogo}
      overrides={new Map()}
      redundantOverrides={new Set()}
      selectedCount={1}
      onTogglePermission={alternar}
      onResetOverrides={vi.fn()}
      onSaveAsRole={vi.fn()}
    />,
  )
  const grupo = screen.queryByRole('button', { name: /Plataforma: Compras y pagos/ })
  if (grupo) fireEvent.click(grupo)
  return alternar
}

describe('PermissionMatrixPanel · grupo «Compras y pagos»', () => {
  it('muestra el grupo y sus seis decisiones con la etiqueta del catálogo', () => {
    montar()
    const lineas = Array.from(document.querySelectorAll('[data-perm-key]')).map((el) => el.getAttribute('data-perm-key'))
    expect(lineas).toEqual(Object.values(K))
    for (const [llave, etiqueta] of ETIQUETAS) {
      const linea = document.querySelector(`[data-perm-key="${llave}"]`) as HTMLElement
      expect(within(linea).getByText(etiqueta)).toBeTruthy()
    }
  })

  it('el conteo del grupo refleja cuántas de las seis tiene la persona', () => {
    montar([K.ejecutarPago, K.anularPago])
    expect(screen.getByRole('button', { name: /Plataforma: Compras y pagos/ }).textContent).toMatch(/2/)
    const marcadas = Array.from(document.querySelectorAll('[data-perm-key]')).filter((el) => el.textContent?.includes('✓'))
    expect(marcadas.map((el) => el.getAttribute('data-perm-key'))).toEqual([K.ejecutarPago, K.anularPago])
  })

  it('un clic alterna SOLO esa llave', () => {
    const alternar = montar([K.aprobarFactura])
    fireEvent.click(document.querySelector(`[data-perm-key="${K.anularPago}"]`) as HTMLElement)
    expect(alternar).toHaveBeenCalledTimes(1)
    expect(alternar).toHaveBeenCalledWith(K.anularPago)
  })
})

// El frontend puede salir antes que la migración que siembra las cinco llaves (o en un entorno donde no se aplicó): el catálogo
// cargado no las trae. Sin el filtro, las cinco líneas aparecían con el nombre de respaldo «compras» y, al guardar, la clave
// foránea role_permissions → permissions las rechazaba.
describe('PermissionMatrixPanel · catálogo SIN las cinco llaves nuevas (ventana de despliegue)', () => {
  const sinLasCinco = new Map<string, string>([[K.aprobarOrdenCompra, 'Autorizar / Denegar — Órdenes compra']])

  it('no ofrece ninguna casilla de las cinco ni líneas llamadas «compras»', () => {
    montar([], vi.fn(), sinLasCinco)
    const lineas = Array.from(document.querySelectorAll('[data-perm-key]')).map((el) => el.getAttribute('data-perm-key'))
    expect(lineas).toEqual([K.aprobarOrdenCompra])
    expect(Array.from(document.querySelectorAll('[data-perm-key]')).some((el) => /^\W*compras\W*$/.test(el.textContent ?? ''))).toBe(false)
  })

  it('con el catálogo vacío el grupo «Compras y pagos» ni aparece', () => {
    montar([], vi.fn(), new Map())
    expect(screen.queryByRole('button', { name: /Plataforma: Compras y pagos/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Plataforma: Contabilidad/ })).toBeTruthy()
  })
})

