// ClienteSelector: buscar sin acentos, elegir con ratón o teclado, «Cambiar»
// sin soltar al actual, «Quitar», y Escape que cierra la lista sin cerrar la
// ventana que lo contiene.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { Cliente } from '../../../types'
import { ClienteSelector, MAX_RESULTADOS } from '../ClienteSelector'
import { EditModal } from '../../shared/EditModal'

const clientes = [
  { id: 'c1', nombre: 'Byron Antonio López Rodríguez', codigo: 'CVI-001', telefono: '23105905', email: 'byron@x.com' },
  { id: 'c2', nombre: 'Arminda Beatriz Cifuentes', codigo: 'CVI-002' },
  { id: 'c3', nombre: 'Oscar Lopez', codigo: 'CLI-116' },
] as unknown as Cliente[]

function Anfitrion({ inicial = '', onChange = vi.fn(), lista = clientes }: { inicial?: string; onChange?: (id: string) => void; lista?: Cliente[] }) {
  const [valor, setValor] = useState(inicial)
  return (
    <ClienteSelector clientes={lista} value={valor} onChange={id => { setValor(id); onChange(id) }} label="Cliente asignado" />
  )
}

const buscador = () => screen.getByRole('combobox', { name: 'Cliente asignado' })
const opciones = () => within(screen.getByRole('listbox')).queryAllByRole('option')

afterEach(cleanup)

describe('ClienteSelector', () => {
  it('sin cliente muestra el buscador y la nota «Sin cliente asignado»', () => {
    render(<Anfitrion />)
    expect(buscador()).toBeTruthy()
    expect(screen.getByText('Sin cliente asignado')).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('busca sin acentos y elige con el ratón', () => {
    const onChange = vi.fn()
    render(<Anfitrion onChange={onChange} />)
    fireEvent.focus(buscador())
    expect(opciones()).toHaveLength(3)

    fireEvent.change(buscador(), { target: { value: 'lopez' } })
    expect(opciones().map(o => o.textContent)).toEqual([
      expect.stringContaining('Byron Antonio López Rodríguez'),
      expect.stringContaining('Oscar Lopez'),
    ])
    // El teléfono y el correo distinguen homónimos.
    expect(opciones()[0].textContent).toContain('23105905 · byron@x.com')

    fireEvent.mouseDown(opciones()[1])
    expect(onChange).toHaveBeenCalledWith('c3')
    const ficha = screen.getByTestId('cliente-seleccionado')
    expect(within(ficha).getByText('Oscar Lopez')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('se maneja con el teclado: flechas y Enter, sin enviar el formulario', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault())
    const onChange = vi.fn()
    render(<form onSubmit={onSubmit}><Anfitrion onChange={onChange} /></form>)
    fireEvent.focus(buscador())
    fireEvent.change(buscador(), { target: { value: 'cvi' } })
    fireEvent.keyDown(buscador(), { key: 'ArrowDown' })
    expect(buscador().getAttribute('aria-activedescendant')).toContain('c1')
    fireEvent.keyDown(buscador(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('c1')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('«Cambiar» conserva al actual hasta elegir otro; Cancelar lo deja igual', () => {
    const onChange = vi.fn()
    render(<Anfitrion inicial="c2" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }))
    expect(buscador()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(within(screen.getByTestId('cliente-seleccionado')).getByText('Arminda Beatriz Cifuentes')).toBeTruthy()
  })

  it('«Quitar» deja la unidad sin cliente', () => {
    const onChange = vi.fn()
    render(<Anfitrion inicial="c1" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }))
    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.getByText('Sin cliente asignado')).toBeTruthy()
  })

  it('avisa si el cliente asignado ya no está en la lista', () => {
    render(<Anfitrion inicial="otro" />)
    expect(screen.getByText(/ya no está en la lista de clientes/)).toBeTruthy()
  })

  it('sin coincidencias lo dice, y con muchas muestra un tope y pide acotar', () => {
    const muchos = Array.from({ length: MAX_RESULTADOS + 7 }, (_, i) => ({ id: `x${i}`, nombre: `Cliente ${i}`, codigo: `CLI-${i}` })) as unknown as Cliente[]
    render(<Anfitrion lista={muchos} />)
    fireEvent.focus(buscador())
    expect(opciones()).toHaveLength(MAX_RESULTADOS)
    expect(screen.getByText(`Mostrando ${MAX_RESULTADOS} de ${MAX_RESULTADOS + 7}. Escribe más para acotar.`)).toBeTruthy()
    fireEvent.change(buscador(), { target: { value: 'zzz' } })
    expect(screen.getByText(/Sin coincidencias/)).toBeTruthy()
  })

  it('dentro de una ventana, Escape cierra la lista pero no la ventana', () => {
    const onClose = vi.fn()
    render(<EditModal title="Editar Unidad" onClose={onClose}><Anfitrion /></EditModal>)
    fireEvent.focus(buscador())
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.keyDown(buscador(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    // Con la lista ya cerrada, Escape vuelve a cerrar la ventana como siempre.
    fireEvent.keyDown(buscador(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
