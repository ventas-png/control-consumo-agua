// La vista de novedades dejó de saber de tablas.
//
// Antes recibía `programaciones` + `ejecuciones` y escribía ella misma sobre
// `ejecuciones_limpieza`. Eso la ataba a una sola fuente, y por eso un hallazgo
// de un turno de personal —que vive en `tareas_bloque`— no tenía dónde
// aparecer aunque se pudiera capturar.
//
// Lo que se cubre aquí es lo que la prueba de dominio no puede ver: que el
// listado rinda una novedad de turno IGUAL que una de limpieza, que el botón
// «Marcar atendida» delegue en el padre en vez de escribir, y que aparezca sólo
// donde tiene sentido.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { NovedadOperativa } from '../../../../../domain/condominios/novedades'

vi.mock('../../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))

const { VistaNovedades } = await import('../VistaNovedades')

function nov(over: Partial<NovedadOperativa> = {}): NovedadOperativa {
  return {
    clave: 'limpieza:eje1', id: 'eje1', fuente: 'limpieza',
    titulo: 'Piscina', icono: '🧹', texto: 'La llave gotea',
    prioridad: 'media', requiere_mantenimiento: false,
    fecha: '2026-08-20', persona: 'Ana', foto_urls: [],
    ...over,
  }
}

afterEach(cleanup)

describe('VistaNovedades · las dos fuentes se rinden igual', () => {
  it('una novedad de turno se ve como una de limpieza', () => {
    // El componente ya no distingue: recibe el título, el icono y el texto ya
    // resueltos. Si algún día vuelve a preguntar de dónde viene una fila, esto
    // deja de pasar.
    render(<VistaNovedades
      novedades={[
        nov(),
        nov({ clave: 'tarea:tar1', id: 'tar1', fuente: 'tarea', titulo: 'Revisar bombas', icono: '🧰', texto: 'Falta empaque' }),
      ]}
      canEdit
      onAtender={() => {}}
    />)
    expect(screen.getByText(/Piscina/)).toBeTruthy()
    expect(screen.getByText(/Revisar bombas/)).toBeTruthy()
    expect(screen.getByText('La llave gotea')).toBeTruthy()
    expect(screen.getByText('Falta empaque')).toBeTruthy()
  })

  it('respeta el orden que le llega y no reordena por su cuenta', () => {
    // El orden lo fija el adaptador, para que las dos fuentes coincidan. Si la
    // vista reordenara, mezclarlas volvería a dar un listado arbitrario.
    render(<VistaNovedades
      novedades={[nov({ clave: 'a', texto: 'primera', prioridad: 'baja' }), nov({ clave: 'b', texto: 'segunda', prioridad: 'alta' })]}
      canEdit
      onAtender={() => {}}
    />)
    const textos = screen.getAllByText(/^(primera|segunda)$/).map(e => e.textContent)
    expect(textos).toEqual(['primera', 'segunda'])
  })

  it('muestra quién y cuándo con el nombre ya resuelto', () => {
    render(<VistaNovedades novedades={[nov({ persona: 'Empleado dado de baja' })]} canEdit onAtender={() => {}} />)
    expect(screen.getByText(/2026-08-20 · 👤 Empleado dado de baja/)).toBeTruthy()
  })
})

describe('VistaNovedades · atender lo decide el padre', () => {
  it('el botón entrega la novedad completa, no un id suelto', () => {
    // El padre necesita la `fuente` para saber a qué tabla escribir. Pasarle
    // sólo el id obligaría a la vista a decidirlo, que es lo que se quitó.
    const onAtender = vi.fn()
    const n = nov({ requiere_mantenimiento: true })
    render(<VistaNovedades novedades={[n]} canEdit onAtender={onAtender} />)
    fireEvent.click(screen.getByText('✓ Marcar atendida'))
    expect(onAtender).toHaveBeenCalledWith(n)
  })

  it('sin permiso de edición no hay botón', () => {
    render(<VistaNovedades novedades={[nov({ requiere_mantenimiento: true })]} canEdit={false} onAtender={() => {}} />)
    expect(screen.queryByText('✓ Marcar atendida')).toBeNull()
  })

  it('sin mantenimiento pendiente tampoco: no hay nada que atender', () => {
    render(<VistaNovedades novedades={[nov({ requiere_mantenimiento: false })]} canEdit onAtender={() => {}} />)
    expect(screen.queryByText('✓ Marcar atendida')).toBeNull()
  })
})

describe('VistaNovedades · filtros', () => {
  it('el contador de mantenimiento cuenta sobre todo, no sobre lo filtrado', () => {
    render(<VistaNovedades
      novedades={[
        nov({ clave: 'a', requiere_mantenimiento: true, prioridad: 'alta' }),
        nov({ clave: 'b', requiere_mantenimiento: true, prioridad: 'baja' }),
        nov({ clave: 'c', requiere_mantenimiento: false }),
      ]}
      canEdit
      onAtender={() => {}}
    />)
    const boton = screen.getByText(/Solo mantenimiento pendiente/)
    expect(boton.textContent).toMatch(/\(2\)/)

    // Filtrar por prioridad no debe mover el contador: es el total pendiente,
    // no «lo que estoy viendo ahora».
    fireEvent.change(screen.getByLabelText('Prioridad'), { target: { value: 'alta' } })
    expect(screen.getByText(/Solo mantenimiento pendiente/).textContent).toMatch(/\(2\)/)
  })

  it('«solo mantenimiento» esconde lo que ya se atendió', () => {
    render(<VistaNovedades
      novedades={[
        nov({ clave: 'a', texto: 'pendiente', requiere_mantenimiento: true }),
        nov({ clave: 'b', texto: 'atendida', requiere_mantenimiento: false }),
      ]}
      canEdit
      onAtender={() => {}}
    />)
    fireEvent.click(screen.getByText(/Solo mantenimiento pendiente/))
    expect(screen.getByText('pendiente')).toBeTruthy()
    expect(screen.queryByText('atendida')).toBeNull()
  })

  it('el listado vacío lo dice en vez de quedar en blanco', () => {
    render(<VistaNovedades novedades={[]} canEdit onAtender={() => {}} />)
    expect(screen.getByText('Sin novedades reportadas')).toBeTruthy()
  })
})
