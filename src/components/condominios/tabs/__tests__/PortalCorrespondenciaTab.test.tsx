// "Mi correspondencia" del portal del residente.
//
// Antes de esta pantalla la RLS ya le concedía estas filas al residente, pero
// nadie las mostraba: se enteraba de una notificación con plazo solo si alguien
// se lo decía. Lo que se protege aquí es que la pantalla le diga las dos cosas
// que le exigen algo —que tiene una pieza por retirar y hasta cuándo— y que no
// le prometa un acuse que la base de datos le va a rechazar.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { PiezaRecepcion } from '../../../../types'

vi.mock('../../../shared/SecureImage', () => ({ SecureImage: () => null }))

import { PortalCorrespondenciaTab } from '../PortalCorrespondenciaTab'

function pieza(over: Partial<PiezaRecepcion> = {}): PiezaRecepcion {
  return {
    id: 'c1', company_id: 'c', project_id: 'p', unidad_id: 'u1',
    clase: 'correspondencia', destinatario_tipo: 'unidad', prioridad: 'normal',
    descripcion: 'Citación municipal', tipo: 'notificacion_legal', estado: 'pendiente',
    direccion: 'entrante', fecha_pieza: '2026-08-12',
    hora_recepcion: '2026-08-12T09:00:00Z', created_at: '2026-08-12T09:00:00Z',
    ...over,
  }
}

afterEach(cleanup)

describe('PortalCorrespondenciaTab', () => {
  it('lista las piezas y cuenta las que faltan por retirar', () => {
    render(<PortalCorrespondenciaTab correspondencia={[pieza(), pieza({ id: 'c2', estado: 'atendido' })]} />)
    expect(screen.getAllByText('Citación municipal')).toHaveLength(2)
    expect(screen.getByText(/1 por retirar en administración/)).toBeTruthy()
  })

  it('avisa cuando el plazo ya venció', () => {
    render(<PortalCorrespondenciaTab correspondencia={[pieza({ fecha_limite: '2020-01-01' })]} />)
    expect(screen.getByText(/Plazo vencido/)).toBeTruthy()
  })

  it('no muestra plazo en una pieza ya entregada', () => {
    // El plazo es lo único que le exige algo al residente; una vez retirada la
    // pieza, repetirlo solo alarma.
    render(<PortalCorrespondenciaTab correspondencia={[pieza({ estado: 'atendido', fecha_limite: '2020-01-01' })]} />)
    expect(screen.queryByText(/Plazo vencido/)).toBeNull()
    // La etiqueta de estado y la línea del acuse dicen ambas "Entregada".
    expect(screen.getAllByText(/Entregada/).length).toBeGreaterThan(0)
  })

  it('traduce el estado al lenguaje del residente', () => {
    render(<PortalCorrespondenciaTab correspondencia={[pieza()]} />)
    // 'pendiente' es el estado del operador; el residente lee qué le toca hacer.
    expect(screen.getByText('Pendiente de retiro')).toBeTruthy()
  })

  it('es de solo lectura: no ofrece firmar el acuse desde el portal', () => {
    // `paquete_firmar_recepcion` está acotada a clase='paquete' (20260829000000).
    render(<PortalCorrespondenciaTab correspondencia={[pieza()]} />)
    expect(screen.queryByText(/[Ff]irmar/)).toBeNull()
  })

  it('sin correspondencia explica para qué sirve la pestaña', () => {
    render(<PortalCorrespondenciaTab correspondencia={[]} />)
    expect(screen.getByText('Sin correspondencia')).toBeTruthy()
  })
})
