import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { PromptDialogRoot, openPromptDialog, openTextPrompt } from '../PromptDialog'
import { checkA11y } from '../../../test/a11y'

beforeEach(cleanup)

describe('PromptDialog', () => {
  it('abre con titulo + descripcion + fields y resuelve los valores al submit', async () => {
    render(<PromptDialogRoot />)
    const promise = openPromptDialog({
      title: 'Nueva empresa',
      description: 'Datos básicos',
      fields: [
        { name: 'nombre', label: 'Nombre', required: true },
        { name: 'nit', label: 'NIT' },
      ],
      submitText: 'Crear',
    })

    await waitFor(() => expect(screen.getByText('Nueva empresa')).toBeTruthy())
    expect(screen.getByText('Datos básicos')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Nombre/), { target: { value: 'ACME SA' } })
    fireEvent.change(screen.getByLabelText(/NIT/), { target: { value: '12345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))

    const result = await promise
    expect(result).toEqual({ nombre: 'ACME SA', nit: '12345' })
  })

  it('cancel devuelve null', async () => {
    render(<PromptDialogRoot />)
    const promise = openPromptDialog({
      title: 'Test',
      fields: [{ name: 'x', label: 'X' }],
    })
    await waitFor(() => expect(screen.getByText('Test')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    const result = await promise
    expect(result).toBeNull()
  })

  it('validate bloquea submit y muestra alert role', async () => {
    render(<PromptDialogRoot />)
    void openPromptDialog({
      title: 'Test',
      fields: [{ name: 'nombre', label: 'Nombre' }],
      validate: (data) => data.nombre ? null : 'Requerido',
    })
    await waitFor(() => expect(screen.getByText('Test')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Requerido')
  })

  it('openTextPrompt helper devuelve un solo string', async () => {
    render(<PromptDialogRoot />)
    const promise = openTextPrompt({
      title: 'Renombrar',
      label: 'Nuevo nombre',
    })
    await waitFor(() => expect(screen.getByText('Renombrar')).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/Nuevo nombre/), { target: { value: 'Foo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }))
    const result = await promise
    expect(result).toBe('Foo')
  })

  it('a11y baseline: dialog abierto sin violaciones', async () => {
    const { container } = render(<PromptDialogRoot />)
    void openPromptDialog({
      title: 'Crear cliente',
      description: 'Datos del residente',
      fields: [
        { name: 'nombre', label: 'Nombre completo', required: true, autoComplete: 'name' },
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
      ],
    })
    await waitFor(() => expect(screen.getByText('Crear cliente')).toBeTruthy())
    await checkA11y(container)
  })
})
