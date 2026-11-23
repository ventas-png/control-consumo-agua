import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { PaisSelect } from '../PaisSelect'

function Caja({ inicial = '', alCambiar = () => {} }: { inicial?: string; alCambiar?: (c: string) => void }) {
  const [v, setV] = useState(inicial)
  return (
    <>
      <label htmlFor="p">País</label>
      <PaisSelect id="p" value={v} onChange={c => { setV(c); alCambiar(c) }} />
    </>
  )
}
const campo = () => screen.getByLabelText('País') as HTMLInputElement

describe('PaisSelect', () => {
  it('cerrado muestra el país elegido; al enfocar abre la lista completa', () => {
    render(<Caja inicial="GT" />)
    expect(campo().value).toBe('🇬🇹 Guatemala')
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.focus(campo())
    expect(screen.getAllByRole('option')).toHaveLength(249)
    expect(screen.getByRole('option', { name: /Guatemala/ }).getAttribute('aria-selected')).toBe('true')
  })
  it('escribir filtra y elegir con el ratón entrega el código', () => {
    const alCambiar = vi.fn()
    render(<Caja alCambiar={alCambiar} />)
    fireEvent.focus(campo())
    fireEvent.change(campo(), { target: { value: 'estados' } })
    expect(screen.getAllByRole('option').length).toBeLessThan(10)
    fireEvent.mouseDown(screen.getByRole('option', { name: /Estados Unidos$/ }))
    expect(alCambiar).toHaveBeenCalledWith('US')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(campo().value).toBe('🇺🇸 Estados Unidos')
  })
  it('con teclado: flechas y Enter eligen; Esc cierra sin cambiar', () => {
    const alCambiar = vi.fn()
    render(<Caja alCambiar={alCambiar} />)
    fireEvent.focus(campo())
    fireEvent.change(campo(), { target: { value: 'guat' } })
    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(alCambiar).toHaveBeenLastCalledWith('GT')
    fireEvent.focus(campo())
    fireEvent.change(campo(), { target: { value: 'fran' } })
    fireEvent.keyDown(campo(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(alCambiar).toHaveBeenCalledTimes(1)
    expect(campo().value).toBe('🇬🇹 Guatemala')
  })
  it('texto que no coincide no se guarda: avisa y al salir vuelve a lo elegido', () => {
    const alCambiar = vi.fn()
    render(<Caja inicial="GT" alCambiar={alCambiar} />)
    fireEvent.focus(campo())
    fireEvent.change(campo(), { target: { value: 'xyzq' } })
    expect(screen.getByText('Ningún país coincide')).toBeTruthy()
    fireEvent.keyDown(campo(), { key: 'Enter' })
    fireEvent.blur(campo())
    expect(alCambiar).not.toHaveBeenCalled()
    expect(campo().value).toBe('🇬🇹 Guatemala')
  })
  it('con el foco puesto y la lista cerrada, escribir empieza una búsqueda nueva', () => {
    const alCambiar = vi.fn()
    render(<Caja inicial="US" alCambiar={alCambiar} />)
    fireEvent.focus(campo())
    fireEvent.keyDown(campo(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(campo(), { key: 'g' })
    expect(campo().value).toBe('')
    fireEvent.change(campo(), { target: { value: 'gua' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: /Guatemala/ }))
    expect(alCambiar).toHaveBeenLastCalledWith('GT')
    // Y si el navegador entrega el nombre mostrado con lo tecleado pegado, se descarta el nombre.
    fireEvent.keyDown(campo(), { key: 'Escape' })
    fireEvent.change(campo(), { target: { value: '🇬🇹 Guatemalafra' } })
    expect(screen.getByRole('option', { name: /Francia/ })).toBeTruthy()
  })
  it('«Quitar país» lo deja vacío', () => {
    const alCambiar = vi.fn()
    render(<Caja inicial="GT" alCambiar={alCambiar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar país' }))
    expect(alCambiar).toHaveBeenCalledWith('')
    expect(campo().value).toBe('')
    expect(screen.queryByRole('button', { name: 'Quitar país' })).toBeNull()
  })
})
