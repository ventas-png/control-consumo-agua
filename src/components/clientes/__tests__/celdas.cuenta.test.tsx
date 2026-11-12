// Columna «Cuenta» de Clientes: «Sin cuenta» sólo cuando el cliente no tiene
// cuenta del portal; con cuenta se distingue activa de inactiva. (La lectura
// va por la RPC clientes_con_cuenta_portal: leer app_users devolvía vacío al
// staff y la columna decía «Sin cuenta» para todos.)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Cliente } from '../../../types'
import { CuentaCell } from '../celdas'

const cliente = { id: 'c1', nombre: 'Abner Girón', codigo: 'CLI-015', puede_crear_cuenta: true } as Cliente

afterEach(cleanup)

describe('CuentaCell', () => {
  it('sin cuenta del portal → «Sin cuenta»', () => {
    render(<CuentaCell cliente={cliente} cuenta={undefined} activoEntry={undefined} canEdit onToggleActivo={vi.fn()} />)
    expect(screen.getByText('Habilitado')).toBeTruthy()
    expect(screen.getByText('Sin cuenta')).toBeTruthy()
    expect(screen.queryByText(/Cuenta activa|Cuenta inactiva/)).toBeNull()
  })

  it('con cuenta activa → «Cuenta activa» y el control de visibilidad de datos', () => {
    render(<CuentaCell cliente={cliente} cuenta={{ activo: true }} activoEntry={{ ccId: 'cc1', activo: true }} canEdit onToggleActivo={vi.fn()} />)
    expect(screen.getByText('Cuenta activa')).toBeTruthy()
    expect(screen.queryByText('Sin cuenta')).toBeNull()
    expect(screen.getByRole('button', { name: '● Datos visibles' })).toBeTruthy()
  })

  it('con cuenta desactivada → «Cuenta inactiva»; deshabilitado para el portal se muestra aparte', () => {
    render(<CuentaCell cliente={{ ...cliente, puede_crear_cuenta: false }} cuenta={{ activo: false }} activoEntry={undefined} canEdit={false} onToggleActivo={vi.fn()} />)
    expect(screen.getByText('Deshabilitado')).toBeTruthy()
    expect(screen.getByText('Cuenta inactiva')).toBeTruthy()
    expect(screen.queryByText('Sin cuenta')).toBeNull()
  })
})
