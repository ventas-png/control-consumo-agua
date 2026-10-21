import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../lib/storageUrls', () => ({
  useSignedUrl: (src: string | null) => (src ? `https://firmado.test/${src}` : null),
}))

import { ConversacionModal, type MensajeHilo } from '../ConversacionModal'

afterEach(cleanup)

const msg = (over: Partial<MensajeHilo>): MensajeHilo => ({
  id: Math.random().toString(36).slice(2), autor_nombre: 'Administración', contenido: 'hola',
  foto_urls: [], archivo_urls: [], es_interno: false, creado_por: 'staff-1', created_at: '2026-10-20T10:00:00', ...over,
})

function renderModal(mensajes: MensajeHilo[], over: Partial<Parameters<typeof ConversacionModal>[0]> = {}) {
  return render(
    <ConversacionModal
      titulo="Fuga en el baño"
      original={{ etiqueta: 'Reporte original', texto: 'Gotea la regadera', fotos: [], archivos: [] }}
      cargar={async () => mensajes}
      enviar={async () => null}
      autorUserId="vecino-1"
      folder="tickets"
      onClose={() => {}}
      {...over}
    />,
  )
}

describe('ConversacionModal', () => {
  it('es una ventana a pantalla completa en el teléfono, con el reporte original arriba', async () => {
    renderModal([])
    const dialog = screen.getByRole('dialog', { name: 'Fuga en el baño' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(screen.getByText('Reporte original')).toBeDefined()
    expect(await screen.findByText(/Escriba el primero abajo/)).toBeDefined()
  })

  it('las propias van sin nombre; las del equipo con nombre; separadas por día', async () => {
    renderModal([
      msg({ contenido: 'Vamos hoy en la tarde', created_at: '2026-10-19T09:00:00' }),
      msg({ contenido: 'Gracias', autor_nombre: 'Marco Santos', creado_por: 'vecino-1', created_at: '2026-10-20T09:00:00' }),
    ])
    expect(await screen.findByText('Vamos hoy en la tarde')).toBeDefined()
    expect(screen.getByText('Administración')).toBeDefined()
    expect(screen.queryByText('Marco Santos')).toBeNull()
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  it('los adjuntos se piden con el clip y el botón cuenta los elegidos', async () => {
    renderModal([])
    await screen.findByLabelText('Mensaje')
    expect(screen.queryByText(/Adjuntar documentos/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar fotos o documentos' }))
    expect(screen.getByText(/Adjuntar fotos/)).toBeDefined()
    expect(screen.getByText(/Adjuntar documentos/)).toBeDefined()
  })

  it('el staff elige "Nota interna" y se envía como interna', async () => {
    const enviar = vi.fn(async () => null)
    renderModal([], { esStaff: true, enviar })
    await screen.findByLabelText('Mensaje')
    fireEvent.click(screen.getByRole('radio', { name: /Nota interna/ }))
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Revisar con el guardia' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota interna' }))
    await waitFor(() => expect(enviar).toHaveBeenCalledWith({ contenido: 'Revisar con el guardia', fotos: [], archivos: [], interno: true }))
  })

  it('sin permiso de escritura no hay caja de mensaje', () => {
    renderModal([], { canWrite: false })
    expect(screen.queryByLabelText('Mensaje')).toBeNull()
  })
})
