import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { InputField } from '../InputField'
import { checkA11y } from '../../../test/a11y'

beforeEach(cleanup)

describe('InputField', () => {
  it('asocia label↔input via htmlFor + id auto-generado', () => {
    render(<InputField label="Correo" value="" onChange={() => {}} />)
    const input = screen.getByLabelText('Correo') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.tagName).toBe('INPUT')
  })

  it('llama onChange con el valor nuevo', () => {
    const onChange = vi.fn()
    render(<InputField label="Nombre" value="" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
    expect(onChange).toHaveBeenCalledWith('Ana')
  })

  it('required agrega aria-required + asterisco visual', () => {
    render(<InputField label="Email" value="" onChange={() => {}} required />)
    const input = screen.getByLabelText(/Email/) as HTMLInputElement
    expect(input.required).toBe(true)
    expect(input.getAttribute('aria-required')).toBe('true')
  })

  it('error asocia aria-invalid + aria-describedby al mensaje', () => {
    render(
      <InputField label="Edad" value="abc" onChange={() => {}} error="Debe ser un número" />
    )
    const input = screen.getByLabelText(/Edad/) as HTMLInputElement
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const errorMsg = document.getElementById(describedBy!)
    expect(errorMsg?.textContent).toBe('Debe ser un número')
    expect(errorMsg?.getAttribute('role')).toBe('alert')
  })

  it('helpText asocia aria-describedby cuando no hay error', () => {
    render(
      <InputField label="Usuario" value="" onChange={() => {}} helpText="Sin espacios" />
    )
    const input = screen.getByLabelText(/Usuario/) as HTMLInputElement
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('Sin espacios')
  })

  it('disabled aplica state visual + atributo input', () => {
    render(<InputField label="X" value="bloqueado" onChange={() => {}} disabled />)
    const input = screen.getByLabelText(/X/) as HTMLInputElement
    expect(input.disabled).toBe(true)
  })

  it('a11y baseline: estado normal pasa axe', async () => {
    const { container } = render(
      <InputField label="Nombre" value="Ana" onChange={() => {}} helpText="Tu nombre completo" />
    )
    await checkA11y(container)
  })

  it('a11y baseline: estado con error pasa axe', async () => {
    const { container } = render(
      <InputField label="Email" value="bad" onChange={() => {}} error="Formato inválido" required />
    )
    await checkA11y(container)
  })

  it('a11y baseline: con prefix + suffix pasa axe', async () => {
    const { container } = render(
      <InputField
        label="Buscar"
        value=""
        onChange={() => {}}
        prefix={<span>🔍</span>}
        suffix={<button type="button" aria-label="Limpiar">×</button>}
      />
    )
    await checkA11y(container)
  })
})
