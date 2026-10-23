// Config. portal (Residentes): el propietario/administrador de la empresa
// prende y apaga las pestañas que ve el residente en el portal del condominio.
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  guardar: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('../../../../domain/condominios/portalPestanas', () => ({
  fetchPortalTabsOcultos: h.fetch,
  guardarPortalTabsOcultos: h.guardar,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: h.notify }))

import { PortalPestanasTab } from '../PortalPestanasTab'

afterEach(cleanup)
beforeEach(() => {
  h.fetch.mockReset().mockResolvedValue({ ocultos: ['rentas'], error: null })
  h.guardar.mockReset().mockResolvedValue({ error: null })
  h.notify.mockReset()
})

const interruptor = (nombre: string) => screen.getByRole('switch', { name: new RegExp(`^${nombre}:`) })

describe('PortalPestanasTab', () => {
  it('muestra el estado guardado: lo apagado, apagado; Mi Unidad, fija', async () => {
    render(<PortalPestanasTab proyectoId="p1" proyectoNombre="21B+" canEdit />)
    await waitFor(() => expect(interruptor('Rentas')).toBeTruthy())
    expect(h.fetch).toHaveBeenCalledWith('p1')
    expect(interruptor('Rentas').getAttribute('aria-checked')).toBe('false')
    expect(interruptor('Paquetería').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('switch', { name: /^Mi Unidad:/ })).toBeNull()
    expect(screen.getByText('Siempre visible')).toBeTruthy()
    expect(screen.getByText('21B+')).toBeTruthy()
  })

  it('apagar una pestaña y guardar manda la lista nueva del condominio', async () => {
    render(<PortalPestanasTab proyectoId="p1" canEdit />)
    await waitFor(() => expect(interruptor('Paquetería')).toBeTruthy())
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' }) as HTMLButtonElement
    expect(guardar.disabled).toBe(true)

    fireEvent.click(interruptor('Paquetería'))
    expect(interruptor('Paquetería').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Cambios sin guardar')).toBeTruthy()
    expect(guardar.disabled).toBe(false)

    fireEvent.click(guardar)
    await waitFor(() => expect(h.guardar).toHaveBeenCalledTimes(1))
    const [proyecto, ocultas] = h.guardar.mock.calls[0]
    expect(proyecto).toBe('p1')
    expect([...ocultas].sort()).toEqual(['paquetes', 'rentas'])
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' })))
    expect(screen.queryByText('Cambios sin guardar')).toBeNull()
  })

  it('volver a encender lo que estaba y descartar deja todo como en la base', async () => {
    render(<PortalPestanasTab proyectoId="p1" canEdit />)
    await waitFor(() => expect(interruptor('Rentas')).toBeTruthy())
    fireEvent.click(interruptor('Rentas'))
    fireEvent.click(interruptor('Rentas'))
    expect(screen.queryByText('Cambios sin guardar')).toBeNull()

    fireEvent.click(interruptor('Mascotas'))
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(interruptor('Mascotas').getAttribute('aria-checked')).toBe('true')
    expect(h.guardar).not.toHaveBeenCalled()
  })

  it('si el servidor rechaza, avisa y los cambios quedan pendientes', async () => {
    h.guardar.mockResolvedValue({ error: 'El servidor no aplicó el cambio' })
    render(<PortalPestanasTab proyectoId="p1" canEdit />)
    await waitFor(() => expect(interruptor('Vehículos')).toBeTruthy())
    fireEvent.click(interruptor('Vehículos'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })))
    expect(screen.getByText('Cambios sin guardar')).toBeTruthy()
  })

  it('la vista previa aplica la misma regla que el portal (por rol y por lo apagado)', async () => {
    render(<PortalPestanasTab proyectoId="p1" canEdit />)
    await waitFor(() => expect(interruptor('Rentas')).toBeTruthy())
    // 14 pestañas, Rentas apagada → 13 para el propietario; el inquilino no
    // tiene Rentas, Asambleas ni Transparencia → 11.
    expect(screen.getByText('Propietario · 13 pestañas')).toBeTruthy()
    expect(screen.getByText('Inquilino o familiar · 11 pestañas')).toBeTruthy()
    fireEvent.click(interruptor('Paquetería'))
    expect(screen.getByText('Propietario · 12 pestañas')).toBeTruthy()
    expect(screen.getByText('Inquilino o familiar · 10 pestañas')).toBeTruthy()
  })

  it('sin permiso de edición los interruptores no se mueven y no hay botón de guardar', async () => {
    render(<PortalPestanasTab proyectoId="p1" canEdit={false} />)
    await waitFor(() => expect(interruptor('Rentas')).toBeTruthy())
    expect((interruptor('Paquetería') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull()
    expect(screen.getByText(/Sólo el propietario o el administrador de la empresa/)).toBeTruthy()
  })

  it('si no pudo leer la configuración no ofrece guardar, y deja reintentar', async () => {
    h.fetch.mockResolvedValueOnce({ ocultos: [], error: 'sin red' })
    render(<PortalPestanasTab proyectoId="p1" canEdit />)
    await waitFor(() => expect(screen.getByText('No se pudo leer la configuración del portal')).toBeTruthy())
    expect(screen.queryByRole('switch')).toBeNull()
    expect((screen.getByRole('button', { name: 'Guardar cambios' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(interruptor('Rentas')).toBeTruthy())
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })

  it('agrupa: las de sólo propietarios van aparte', async () => {
    render(<PortalPestanasTab proyectoId="p1" canEdit />)
    await waitFor(() => expect(interruptor('Rentas')).toBeTruthy())
    const grupo = screen.getByText('Sólo propietarios').parentElement!.parentElement!
    expect(within(grupo).getAllByRole('switch').map(s => s.getAttribute('aria-label')?.split(':')[0]))
      .toEqual(['Asambleas', 'Transparencia', 'Rentas'])
  })
})
