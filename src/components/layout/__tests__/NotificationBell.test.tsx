// La campana enseñaba una lista plana con un número: "4" no dice si lo nuevo
// son mensajes, comunicados o solicitudes. Estos tests fijan lo que ahora sí
// indica —el resumen por categoría y los filtros— y el bug de navegación que
// arrastraba: `seccion` es texto libre en la BD y se pasaba sin mirar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { UserNotification } from '../../../types'

const mocks = vi.hoisted(() => ({
  items: [] as UserNotification[],
  marcarLeida: vi.fn(async () => {}),
  marcarTodas: vi.fn(async () => {}),
}))

// El hook entra a Supabase (y a Realtime) al montarse; aquí sólo se prueba la UI.
vi.mock('../../../hooks/useNotifications', () => ({
  useNotifications: () => ({
    items: mocks.items,
    unread: mocks.items.reduce((n, x) => n + (x.leido ? 0 : 1), 0),
    load: vi.fn(),
    marcarLeida: mocks.marcarLeida,
    marcarTodas: mocks.marcarTodas,
  }),
}))

const { NotificationBell } = await import('../NotificationBell')

function notif(over: Partial<UserNotification> = {}): UserNotification {
  return {
    id: `n${Math.random()}`, user_id: 'u1', tipo: 'mensaje',
    titulo: 'Mensaje nuevo de Cliente Uno', cuerpo: 'Fuga en el medidor',
    seccion: 'comunicacion', leido: false, created_at: new Date().toISOString(),
    ...over,
  }
}

// El panel se posiciona con getBoundingClientRect, que en jsdom devuelve ceros:
// sin unas medidas creíbles `calcularPosicion` da maxHeight 0 y no se ve nada.
beforeEach(() => {
  mocks.items = []
  mocks.marcarLeida.mockClear()
  mocks.marcarTodas.mockClear()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    right: 900, bottom: 60, left: 866, top: 26, width: 34, height: 34, x: 866, y: 26,
    toJSON: () => ({}),
  } as DOMRect)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function abrir(onNavigate = vi.fn()) {
  render(<NotificationBell userId="u1" onNavigate={onNavigate} />)
  fireEvent.click(screen.getByRole('button', { name: /Notificaciones/ }))
  return onNavigate
}

describe('resumen de lo nuevo', () => {
  it('dice qué hay sin leer, por categoría, en el botón y en el panel', () => {
    mocks.items = [
      notif({ tipo: 'mensaje' }), notif({ tipo: 'mensaje' }),
      notif({ tipo: 'difusion', titulo: 'Comunicado: corte de agua' }),
      notif({ tipo: 'solicitud', titulo: 'Solicitud nueva: mudanza' }),
    ]
    abrir()
    // El botón lo lleva en su etiqueta accesible: con la campana cerrada el
    // número solo dice "hay 4 cosas".
    expect(screen.getByRole('button', { name: 'Notificaciones: 2 mensajes · 1 difusión · 1 solicitud' })).toBeTruthy()
    expect(screen.getByText('2 mensajes · 1 difusión · 1 solicitud')).toBeTruthy()
  })

  it('no cuenta lo ya leído', () => {
    mocks.items = [notif({ tipo: 'mensaje' }), notif({ tipo: 'difusion', leido: true })]
    abrir()
    expect(screen.getByText('1 mensaje')).toBeTruthy()
  })

  it('sin nada sin leer no pinta resumen', () => {
    mocks.items = [notif({ leido: true })]
    abrir()
    expect(screen.queryByText(/mensaje/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Notificaciones' })).toBeTruthy()
  })
})

describe('filtros por categoría', () => {
  it('acota la lista al grupo elegido', () => {
    mocks.items = [
      notif({ tipo: 'mensaje', titulo: 'Mensaje de Ana' }),
      notif({ tipo: 'solicitud', titulo: 'Solicitud nueva: renta' }),
    ]
    abrir()
    expect(screen.getByText('Solicitud nueva: renta')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /💬 mensajes/ }))
    expect(screen.getByText('Mensaje de Ana')).toBeTruthy()
    expect(screen.queryByText('Solicitud nueva: renta')).toBeNull()
  })

  // Con una sola categoría el filtro no separa nada: sería una fila de ruido.
  it('no aparecen si todo es de la misma categoría', () => {
    mocks.items = [notif({ tipo: 'mensaje' }), notif({ tipo: 'mensaje' })]
    abrir()
    expect(screen.queryByRole('button', { name: 'Todo' })).toBeNull()
  })
})

describe('navegación', () => {
  it('navega con la sección de la notificación y la marca leída', () => {
    mocks.items = [notif({ titulo: 'Mensaje nuevo', seccion: 'comunicacion' })]
    const onNavigate = abrir()
    fireEvent.click(screen.getByText('Mensaje nuevo'))
    expect(onNavigate).toHaveBeenCalledWith('comunicacion')
    expect(mocks.marcarLeida).toHaveBeenCalled()
  })

  // Sin sección no hay a dónde ir, pero sí hay que marcarla leída: si no, el
  // contador nunca baja.
  it('sin sección marca leída sin navegar', () => {
    mocks.items = [notif({ titulo: 'Aviso suelto', seccion: null })]
    const onNavigate = abrir()
    fireEvent.click(screen.getByText('Aviso suelto'))
    expect(onNavigate).not.toHaveBeenCalled()
    expect(mocks.marcarLeida).toHaveBeenCalled()
  })

  it('no vuelve a marcar leída una que ya lo está', () => {
    mocks.items = [notif({ titulo: 'Ya vista', leido: true })]
    abrir()
    fireEvent.click(screen.getByText('Ya vista'))
    expect(mocks.marcarLeida).not.toHaveBeenCalled()
  })
})

describe('estado vacío', () => {
  it('distingue "no tienes nada" de "no tienes nada de esta categoría"', () => {
    mocks.items = [notif({ tipo: 'mensaje' }), notif({ tipo: 'solicitud' })]
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /💬 mensajes/ }))
    fireEvent.click(screen.getByText('Mensaje nuevo de Cliente Uno'))  // cierra el panel

    cleanup()
    mocks.items = []
    abrir()
    expect(screen.getByText('No tienes notificaciones')).toBeTruthy()
  })
})
