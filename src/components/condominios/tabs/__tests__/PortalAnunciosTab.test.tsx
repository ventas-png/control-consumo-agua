import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { AnuncioComunidad, ComunicadoCondominio } from '../../../../types'
import { PortalAnunciosTab } from '../PortalAnunciosTab'

afterEach(cleanup)

const anuncio = (over: Partial<AnuncioComunidad> = {}) => ({
  id: 'a1', titulo: 'Fumigación del jueves', contenido: 'Se fumigarán las áreas comunes de 8 a 12.\nMantenga a sus mascotas adentro.',
  tipo: 'mantenimiento', activo: true, created_at: '2026-10-20T10:00:00Z', ...over,
}) as AnuncioComunidad

const comunicado = (over: Partial<ComunicadoCondominio> = {}) => ({
  id: 'c1', tipo: 'carta', titulo: 'Carta de bienvenida', contenido: 'Bienvenido al condominio.',
  fecha_envio: '2026-10-18', enviado_por: 'Administración', firmado: true, ...over,
}) as ComunicadoCondominio

describe('PortalAnunciosTab', () => {
  it('cada anuncio se abre completo en una ventana a pantalla completa en el teléfono', () => {
    render(<PortalAnunciosTab anuncios={[anuncio()]} />)
    fireEvent.click(screen.getByRole('button', { name: /Fumigación del jueves/ }))
    const dialog = screen.getByRole('dialog', { name: 'Fumigación del jueves' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText(/Mantenga a sus mascotas adentro/)).toBeDefined()
  })

  it('los comunicados propios van primero y también se abren', () => {
    render(<PortalAnunciosTab anuncios={[anuncio()]} comunicados={[comunicado()]} unidadNombre="Apto 2A" />)
    const botones = screen.getAllByRole('button')
    expect(botones[0].textContent).toContain('Carta de bienvenida')
    fireEvent.click(botones[0])
    const dialog = screen.getByRole('dialog', { name: 'Carta de bienvenida' })
    expect(within(dialog).getByText('✓ Firmado')).toBeDefined()
    expect(within(dialog).getByText('Emitido por: Administración')).toBeDefined()
  })

  it('no lista anuncios inactivos', () => {
    render(<PortalAnunciosTab anuncios={[anuncio({ activo: false })]} />)
    expect(screen.queryByRole('button', { name: /Fumigación/ })).toBeNull()
    expect(screen.getByText('Sin comunicados recientes')).toBeDefined()
  })
})
