// «Instala AdministraTodo»: cuándo aparece el aviso, qué ofrece en cada
// navegador y cuándo se queda callado. La detección del navegador se prueba
// aparte (lib/__tests__/pwaInstall.test.ts); aquí se le da ya resuelta.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { EstadoInstalacion, ResultadoInstalacion } from '../../../lib/pwaInstall'

// Estado de instalación controlado por el test. `avisoDescartado` y
// `descartarAviso` son los reales: guardan en localStorage.
const instalacion = vi.hoisted(() => {
  let estado: EstadoInstalacion = { via: null, instalada: false, esTablet: false }
  const oyentes = new Set<() => void>()
  return {
    poner(via: EstadoInstalacion['via']) {
      estado = { ...estado, via }
      oyentes.forEach((avisar) => avisar())
    },
    leerInstalacion: () => estado,
    suscribirInstalacion: (avisar: () => void) => {
      oyentes.add(avisar)
      return () => {
        oyentes.delete(avisar)
      }
    },
    pedirInstalacion: vi.fn<() => Promise<ResultadoInstalacion>>(),
  }
})
vi.mock('../../../lib/pwaInstall', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/pwaInstall')>()
  return {
    ...real,
    leerInstalacion: instalacion.leerInstalacion,
    suscribirInstalacion: instalacion.suscribirInstalacion,
    pedirInstalacion: instalacion.pedirInstalacion,
  }
})

import { InstalarAppAviso, InstalarAppEnlace, InstalarAppOpcion } from '../InstalarApp'
import { avisoDescartado, descartarAviso } from '../../../lib/pwaInstall'
import { saveConsent } from '../../../lib/cookieConsent'

/** jsdom no trae matchMedia. `tactil`: el puntero principal es el dedo. */
function simularPuntero(tactil: boolean) {
  window.matchMedia = vi.fn((q: string) => ({
    matches: tactil && q === '(pointer: coarse)', media: q, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const matchMediaOriginal = window.matchMedia

/** Monta el aviso y deja pasar la espera inicial. */
function montarAviso() {
  render(<InstalarAppAviso />)
  act(() => {
    vi.advanceTimersByTime(3000)
  })
}

const aviso = () => screen.queryByRole('region', { name: 'Instalar la app' })

beforeEach(() => {
  cleanup()
  vi.useFakeTimers()
  localStorage.clear()
  // El usuario ya eligió sus cookies (si no, el aviso espera al banner).
  localStorage.setItem('at-cookie-consent-v1', JSON.stringify({ analytics: false, functional: false }))
  window.history.replaceState({}, '', '/')
  simularPuntero(true)
  instalacion.poner(null)
  instalacion.pedirInstalacion.mockReset()
  instalacion.pedirInstalacion.mockResolvedValue('aceptada')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.matchMedia = matchMediaOriginal
})

describe('InstalarAppAviso', () => {
  describe('con diálogo de instalación del navegador (Android)', () => {
    beforeEach(() => instalacion.poner('boton'))

    it('aparece tras la espera inicial, no antes', () => {
      render(<InstalarAppAviso />)
      expect(aviso()).toBeNull()
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(aviso()).not.toBeNull()
      expect(screen.getByText('Instala AdministraTodo')).toBeTruthy()
    })

    it('«Instalar» abre el diálogo del navegador', async () => {
      montarAviso()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Instalar' }))
      })
      expect(instalacion.pedirInstalacion).toHaveBeenCalledTimes(1)
      // Aceptó: no se marca como descartado (la vía pasa a null por su cuenta).
      expect(avisoDescartado()).toBe(false)
    })

    it('si el usuario dice que no en el diálogo, no se le insiste', async () => {
      instalacion.pedirInstalacion.mockResolvedValue('rechazada')
      montarAviso()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Instalar' }))
      })
      expect(aviso()).toBeNull()
      expect(avisoDescartado()).toBe(true)
    })

    it('desaparece solo cuando la app queda instalada', () => {
      montarAviso()
      act(() => instalacion.poner(null))
      expect(aviso()).toBeNull()
    })

    it.each(['Ahora no', 'Cerrar el aviso de instalación'])('«%s» lo cierra y lo recuerda', (boton) => {
      montarAviso()
      fireEvent.click(screen.getByRole('button', { name: boton }))
      expect(aviso()).toBeNull()
      expect(avisoDescartado()).toBe(true)
      expect(instalacion.pedirInstalacion).not.toHaveBeenCalled()
    })

    it('no vuelve a salir si se cerró hace poco', () => {
      descartarAviso()
      montarAviso()
      expect(aviso()).toBeNull()
    })

    it('no sale solo en escritorio: ahí el navegador ya muestra su propio ícono', () => {
      simularPuntero(false)
      montarAviso()
      expect(aviso()).toBeNull()
    })

    it('espera a que el usuario decida sobre las cookies (ocupan el mismo sitio)', () => {
      localStorage.removeItem('at-cookie-consent-v1')
      montarAviso()
      expect(aviso()).toBeNull()
      act(() => saveConsent({ analytics: false, functional: false }))
      expect(aviso()).not.toBeNull()
    })

    it('sale en inglés sobre la landing en inglés', () => {
      window.history.replaceState({}, '', '/?lang=en')
      montarAviso()
      expect(screen.getByText('Install AdministraTodo')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
    })
  })

  describe('en iPhone y iPad (sin diálogo: solo se puede explicar)', () => {
    it('Safari: «Ver cómo» despliega los tres pasos', () => {
      instalacion.poner('ios-safari')
      montarAviso()
      expect(screen.queryByRole('button', { name: 'Instalar' })).toBeNull()
      expect(screen.queryByRole('list')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Ver cómo' }))

      const pasos = screen.getAllByRole('listitem')
      expect(pasos).toHaveLength(3)
      expect(pasos[0].textContent).toContain('Compartir')
      expect(pasos[1].textContent).toContain('Agregar a inicio')
      expect(pasos[2].textContent).toContain('Agregar')
      // Con los pasos a la vista ya no hay nada más que ofrecer.
      expect(screen.queryByRole('button', { name: 'Ver cómo' })).toBeNull()
      expect(instalacion.pedirInstalacion).not.toHaveBeenCalled()
    })

    it('con los pasos a la vista, «Entendido» lo cierra y lo recuerda', () => {
      instalacion.poner('ios-safari')
      montarAviso()
      fireEvent.click(screen.getByRole('button', { name: 'Ver cómo' }))
      fireEvent.click(screen.getByRole('button', { name: 'Entendido' }))
      expect(aviso()).toBeNull()
      expect(avisoDescartado()).toBe(true)
    })

    it('otro navegador: avisa de que la opción puede no estar y manda a Safari', () => {
      instalacion.poner('ios-otro')
      montarAviso()
      fireEvent.click(screen.getByRole('button', { name: 'Ver cómo' }))
      expect(screen.getByText('Si no ves esa opción, abre esta página en Safari.')).toBeTruthy()
    })
  })

  it('no sale solo en Android sin diálogo: es lo que reporta Chrome con la app ya instalada', () => {
    instalacion.poner('manual')
    montarAviso()
    expect(aviso()).toBeNull()
  })

  it('no sale cuando no hay cómo instalar (ya instalada, app nativa, navegador sin soporte)', () => {
    instalacion.poner(null)
    montarAviso()
    expect(aviso()).toBeNull()
  })
})

describe('InstalarAppOpcion (Perfil)', () => {
  it('con diálogo del navegador: un botón «Instalar», también en escritorio', async () => {
    simularPuntero(false)
    instalacion.poner('boton')
    render(<InstalarAppOpcion />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Instalar' }))
    })
    expect(instalacion.pedirInstalacion).toHaveBeenCalledTimes(1)
  })

  it('en iPhone y iPad muestra los pasos directamente', () => {
    instalacion.poner('ios-safari')
    render(<InstalarAppOpcion />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Instalar' })).toBeNull()
  })

  it('en Android sin diálogo explica el camino por el menú', () => {
    instalacion.poner('manual')
    render(<InstalarAppOpcion />)
    const pasos = screen.getAllByRole('listitem')
    expect(pasos).toHaveLength(2)
    expect(pasos[1].textContent).toContain('Instalar app')
  })

  it('no dibuja nada cuando no hay cómo instalar', () => {
    instalacion.poner(null)
    const { container } = render(<InstalarAppOpcion />)
    expect(container.innerHTML).toBe('')
  })

  it('sigue disponible aunque el aviso automático se haya cerrado', () => {
    descartarAviso()
    instalacion.poner('boton')
    render(<InstalarAppOpcion />)
    expect(screen.getByRole('button', { name: 'Instalar' })).toBeTruthy()
  })
})

describe('InstalarAppEnlace (pie del portal de condominios)', () => {
  it('vuelve a abrir el aviso aunque el usuario lo hubiera cerrado, con los pasos ya a la vista', () => {
    descartarAviso()
    instalacion.poner('ios-safari')
    render(<><InstalarAppEnlace /><InstalarAppAviso /></>)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(aviso()).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Instalar la app' }))

    expect(aviso()).not.toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('pedido a mano sale también en escritorio y con la vía manual, que solas no salen', () => {
    simularPuntero(false)
    instalacion.poner('manual')
    render(<><InstalarAppEnlace /><InstalarAppAviso /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Instalar la app' }))
    expect(aviso()).not.toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('con diálogo del navegador ofrece el botón «Instalar»', () => {
    simularPuntero(false)
    instalacion.poner('boton')
    render(<><InstalarAppEnlace /><InstalarAppAviso /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Instalar la app' }))
    expect(screen.getByRole('button', { name: 'Instalar' })).toBeTruthy()
  })

  it('cerrarlo lo quita de nuevo', () => {
    instalacion.poner('ios-safari')
    render(<><InstalarAppEnlace /><InstalarAppAviso /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Instalar la app' }))
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }))
    expect(aviso()).toBeNull()
  })

  it('no dibuja nada, ni su separador, cuando no hay cómo instalar', () => {
    instalacion.poner(null)
    const { container } = render(<InstalarAppEnlace separador={<span>·</span>} />)
    expect(container.innerHTML).toBe('')
  })

  it('dibuja el separador delante cuando sí hay enlace', () => {
    instalacion.poner('boton')
    const { container } = render(<InstalarAppEnlace separador={<span>·</span>} />)
    expect(container.textContent).toBe('·Instalar la app')
  })
})
