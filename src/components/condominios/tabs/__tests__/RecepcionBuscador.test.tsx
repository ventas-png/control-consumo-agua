// Bandeja unificada de recepción: una sola búsqueda sobre Paquetería +
// Correspondencia. Lo que se verifica aquí es lo que motivó la vista — que
// quien busca una guía la encuentre sin saber en qué módulo la registraron —
// y las dos reglas que no pueden relajarse: no mostrar filas de un módulo que
// el usuario no puede ver, y avisar del registro duplicado entre módulos.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { CorrespondenciaCondominio, PaqueteRecibido } from '../../../../types'
import { RecepcionBuscador } from '../RecepcionBuscador'

const PAQUETE: PaqueteRecibido = {
  id: 'p1', company_id: 'c', project_id: 'p', unidad_id: 'u1',
  descripcion: 'Caja Amazon', tipo: 'paquete', estado: 'pendiente',
  num_guia: 'AB-1234', empresa_mensajeria: 'DHL', unidad_nombre: 'Apto 2A',
  hora_recepcion: '2026-08-10T15:00:00Z', created_at: '2026-08-10T15:00:00Z',
}

const CORRESPONDENCIA: CorrespondenciaCondominio = {
  id: 'c1', company_id: 'c', project_id: 'p',
  tipo: 'entrada', categoria: 'notificacion_legal', asunto: 'Citación municipal',
  fecha: '2026-08-12', prioridad: 'urgente', estado: 'pendiente',
  created_at: '2026-08-12T09:00:00Z', remitente: 'Municipalidad',
}

function renderBandeja(props: Partial<React.ComponentProps<typeof RecepcionBuscador>> = {}) {
  return render(
    <RecepcionBuscador
      paquetes={[PAQUETE]}
      correspondencia={[CORRESPONDENCIA]}
      puedeVerPaqueteria
      puedeVerCorrespondencia
      origenActual="paqueteria"
      {...props}
    />,
  )
}

afterEach(cleanup)

describe('RecepcionBuscador', () => {
  it('lista las piezas de los dos módulos', () => {
    renderBandeja()
    expect(screen.getByText('Caja Amazon')).toBeTruthy()
    expect(screen.getByText('Citación municipal')).toBeTruthy()
  })

  it('encuentra un paquete por su guía aunque se teclee sin separadores', () => {
    renderBandeja()
    fireEvent.change(screen.getByPlaceholderText(/Buscar por guía/), { target: { value: 'ab1234' } })
    expect(screen.getByText('Caja Amazon')).toBeTruthy()
    expect(screen.queryByText('Citación municipal')).toBeNull()
  })

  it('no muestra correspondencia a quien no tiene permiso de verla', () => {
    renderBandeja({ puedeVerCorrespondencia: false })
    expect(screen.getByText('Caja Amazon')).toBeTruthy()
    expect(screen.queryByText('Citación municipal')).toBeNull()
  })

  it('avisa cuando la misma guía quedó registrada en los dos módulos', () => {
    renderBandeja({ correspondencia: [{ ...CORRESPONDENCIA, numero_guia: 'ab 1234' }] })
    expect(screen.getByText(/registrada en los dos módulos/)).toBeTruthy()
  })

  it('no ofrece saltar al módulo desde el que ya se está mirando', () => {
    renderBandeja({ origenActual: 'paqueteria', onIrATab: () => {} })
    expect(screen.queryByText(/Abrir Paquetería/)).toBeNull()
    expect(screen.getByText(/Abrir Correspondencia/)).toBeTruthy()
  })
})
