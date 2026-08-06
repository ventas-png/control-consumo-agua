import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { EditModal } from '../EditModal'
import { checkA11y } from '../../../test/a11y'

beforeEach(cleanup)

describe('EditModal — render básico', () => {
  it('renderiza título y children', () => {
    render(
      <EditModal title="Editar usuario" onClose={() => {}}>
        <p>Contenido del formulario</p>
      </EditModal>,
    )
    expect(screen.getByRole('heading', { name: 'Editar usuario' })).toBeDefined()
    expect(screen.getByText('Contenido del formulario')).toBeDefined()
  })

  it('marca role=dialog con aria-modal y aria-label', () => {
    const { container } = render(
      <EditModal title="Mi modal" onClose={() => {}}>
        <p>x</p>
      </EditModal>,
    )
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-label')).toBe('Mi modal')
  })

  it('botón cerrar con aria-label invoca onClose', () => {
    const onClose = vi.fn()
    render(
      <EditModal title="x" onClose={onClose}>
        <p>x</p>
      </EditModal>,
    )
    fireEvent.click(screen.getByLabelText('Cerrar modal'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('EditModal — subtitle', () => {
  it('renderiza subtitle debajo del título cuando se pasa', () => {
    render(
      <EditModal title="Asignar Acceso" subtitle="Juan Pérez · Operador" onClose={() => {}}>
        <p>x</p>
      </EditModal>,
    )
    expect(screen.getByText('Juan Pérez · Operador')).toBeDefined()
  })

  it('no renderiza subtitle si no se pasa', () => {
    const { container } = render(
      <EditModal title="x" onClose={() => {}}>
        <p>x</p>
      </EditModal>,
    )
    // Solo h2 dentro del header (sin subtitle)
    const headerDiv = container.querySelector('h2')?.parentElement
    expect(headerDiv?.children).toHaveLength(1)
  })
})

describe('EditModal — headerActions', () => {
  it('renderiza acciones del header entre título y botón cerrar', () => {
    render(
      <EditModal
        title="Log"
        headerActions={<button>Refresh</button>}
        onClose={() => {}}
      >
        <p>x</p>
      </EditModal>,
    )
    expect(screen.getByText('Refresh')).toBeDefined()
  })
})

describe('EditModal — footer', () => {
  it('renderiza footer cuando se pasa', () => {
    render(
      <EditModal
        title="Editar"
        footer={
          <>
            <button>Cancelar</button>
            <button>Guardar</button>
          </>
        }
        onClose={() => {}}
      >
        <p>contenido</p>
      </EditModal>,
    )
    expect(screen.getByText('Cancelar')).toBeDefined()
    expect(screen.getByText('Guardar')).toBeDefined()
  })

  it('no renderiza footer si no se pasa', () => {
    const { container } = render(
      <EditModal title="x" onClose={() => {}}>
        <p>x</p>
      </EditModal>,
    )
    // Sin footer, el contenedor del modal tiene 2 hijos (header + body)
    const modalCard = container.querySelector('[role="dialog"]')?.firstChild as HTMLElement
    expect(modalCard.children).toHaveLength(2)
  })
})

describe('EditModal — size variants', () => {
  it('aplica width "md" (760px) por default para retro-compat', () => {
    const { container } = render(
      <EditModal title="x" onClose={() => {}}>
        <p>x</p>
      </EditModal>,
    )
    const card = container.querySelector('[role="dialog"]')?.firstChild as HTMLElement
    expect(card.style.maxWidth).toContain('760px')
  })

  it('aplica width "sm" cuando size="sm"', () => {
    const { container } = render(
      <EditModal title="x" size="sm" onClose={() => {}}>
        <p>x</p>
      </EditModal>,
    )
    const card = container.querySelector('[role="dialog"]')?.firstChild as HTMLElement
    expect(card.style.maxWidth).toContain('480px')
  })

  it('aplica width "xl" cuando size="xl"', () => {
    const { container } = render(
      <EditModal title="x" size="xl" onClose={() => {}}>
        <p>x</p>
      </EditModal>,
    )
    const card = container.querySelector('[role="dialog"]')?.firstChild as HTMLElement
    expect(card.style.maxWidth).toContain('1100px')
  })

  it('maxWidth manual tiene prioridad sobre size', () => {
    const { container } = render(
      <EditModal title="x" size="sm" maxWidth="900px" onClose={() => {}}>
        <p>x</p>
      </EditModal>,
    )
    const card = container.querySelector('[role="dialog"]')?.firstChild as HTMLElement
    expect(card.style.maxWidth).toContain('900px')
  })
})

describe('EditModal — noPadding', () => {
  it('body sin padding cuando noPadding=true', () => {
    const { container } = render(
      <EditModal title="x" noPadding onClose={() => {}}>
        <p>x</p>
      </EditModal>,
    )
    // El body es el segundo hijo del card
    const card = container.querySelector('[role="dialog"]')?.firstChild as HTMLElement
    const body = card.children[1] as HTMLElement
    expect(body.style.padding).toBe('0px')
  })

  it('body con padding default cuando noPadding no se pasa', () => {
    const { container } = render(
      <EditModal title="x" onClose={() => {}}>
        <p>x</p>
      </EditModal>,
    )
    const card = container.querySelector('[role="dialog"]')?.firstChild as HTMLElement
    const body = card.children[1] as HTMLElement
    expect(body.style.padding).toBe('20px')
  })
})

describe('EditModal — comportamiento controlable', () => {
  it('cierra al click en backdrop por default', () => {
    const onClose = vi.fn()
    const { container } = render(
      <EditModal title="x" onClose={onClose}>
        <p>x</p>
      </EditModal>,
    )
    const backdrop = container.querySelector('[role="dialog"]') as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('NO cierra al click en backdrop cuando closeOnBackdropClick=false', () => {
    const onClose = vi.fn()
    const { container } = render(
      <EditModal title="x" closeOnBackdropClick={false} onClose={onClose}>
        <p>x</p>
      </EditModal>,
    )
    const backdrop = container.querySelector('[role="dialog"]') as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cierra con Escape por default', () => {
    const onClose = vi.fn()
    render(
      <EditModal title="x" onClose={onClose}>
        <p>x</p>
      </EditModal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('NO cierra con Escape cuando closeOnEscape=false', () => {
    const onClose = vi.fn()
    render(
      <EditModal title="x" closeOnEscape={false} onClose={onClose}>
        <p>x</p>
      </EditModal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('EditModal — foco de entrada y salida', () => {
  it('al abrir mueve el foco al diálogo (sin esto el focus trap nunca corre)', () => {
    render(
      <EditModal title="Con foco" onClose={() => {}}>
        <input aria-label="campo" />
      </EditModal>,
    )
    expect(screen.getByRole('dialog')).toBe(document.activeElement)
  })

  it('respeta el foco que el consumidor ya movió adentro (autoFocus)', () => {
    render(
      <EditModal title="Con autoFocus" onClose={() => {}}>
        <input aria-label="campo" autoFocus />
      </EditModal>,
    )
    expect(screen.getByLabelText('campo')).toBe(document.activeElement)
  })

  it('al cerrar devuelve el foco al elemento que lo abrió', () => {
    const disparador = document.createElement('button')
    document.body.appendChild(disparador)
    disparador.focus()
    expect(disparador).toBe(document.activeElement)

    const { unmount } = render(<EditModal title="Vuelve" onClose={() => {}}><p>x</p></EditModal>)
    expect(disparador).not.toBe(document.activeElement)

    unmount()
    expect(disparador).toBe(document.activeElement)
    disparador.remove()
  })

  it('no explota si el disparador ya no está en el DOM al cerrar', () => {
    const disparador = document.createElement('button')
    document.body.appendChild(disparador)
    disparador.focus()
    const { unmount } = render(<EditModal title="Huérfano" onClose={() => {}}><p>x</p></EditModal>)
    disparador.remove()
    expect(() => unmount()).not.toThrow()
  })
})

describe('EditModal — scroll lock del body', () => {
  it('bloquea el scroll del fondo mientras está abierto y lo restaura al cerrar', () => {
    expect(document.body.style.overflow).not.toBe('hidden')
    const { unmount } = render(<EditModal title="Lock" onClose={() => {}}><p>x</p></EditModal>)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('con modales anidados solo desbloquea cuando se cierra el último', () => {
    const externo = render(<EditModal title="Externo" onClose={() => {}}><p>a</p></EditModal>)
    const interno = render(<EditModal title="Interno" onClose={() => {}}><p>b</p></EditModal>)
    expect(document.body.style.overflow).toBe('hidden')

    interno.unmount()
    // El externo sigue abierto: el fondo NO debe volver a scrollear.
    expect(document.body.style.overflow).toBe('hidden')

    externo.unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})

describe('EditModal — a11y baseline', () => {
  it('renderiza sin violaciones de accesibilidad', async () => {
    const { container } = render(
      <EditModal
        title="Editar usuario"
        subtitle="Juan Pérez"
        footer={
          <>
            <button>Cancelar</button>
            <button>Guardar</button>
          </>
        }
        onClose={() => {}}
      >
        <form>
          <label htmlFor="name">Nombre</label>
          <input id="name" type="text" />
        </form>
      </EditModal>,
    )
    await checkA11y(container)
  })
})
