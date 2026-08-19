// "Mi correspondencia" del portal: qué le decimos al residente de cada pieza.
//
// El hallazgo: una pieza `direccion='saliente'` —algo que el residente MANDÓ—
// se le presentaba como "Pendiente de retiro", se contaba entre las que tenía
// que ir a recoger a administración y hasta le mostraba un "plazo de
// respuesta". Es pedirle que vaya a buscar su propio envío.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PortalCorrespondenciaTab } from '../tabs/PortalCorrespondenciaTab'
import type { PiezaRecepcion } from '../../../types'

// SecureImage firma URLs contra Supabase; aquí no aporta nada.
vi.mock('../../shared/SecureImage', () => ({
  SecureImage: ({ src }: { src: string }) => <span data-testid="foto">{src}</span>,
}))

afterEach(cleanup)

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

describe('PortalCorrespondenciaTab — entrada', () => {
  it('una entrada pendiente sí está pendiente de retiro y cuenta como tal', () => {
    render(<PortalCorrespondenciaTab correspondencia={[pieza({ remitente: 'Municipalidad' })]} />)
    expect(screen.getByText('Pendiente de retiro')).toBeTruthy()
    expect(screen.getByText(/1 por retirar en administración/)).toBeTruthy()
    expect(screen.getByText(/Recibida el/)).toBeTruthy()
    expect(screen.getByText(/De: Municipalidad/)).toBeTruthy()
  })

  it('una entrada con plazo se lo recuerda', () => {
    render(<PortalCorrespondenciaTab correspondencia={[
      pieza({ fecha_limite: '2099-01-01' }),
    ]} />)
    expect(screen.getByText(/Plazo de respuesta/)).toBeTruthy()
  })

  it('una entrada entregada muestra el acuse: a quién y con firma', () => {
    render(<PortalCorrespondenciaTab correspondencia={[pieza({
      estado: 'atendido', hora_entrega: '2026-08-14T10:00:00Z',
      entregado_a_nombre: 'Marta Solís', firma_path: 'p/c1/firma.png',
    })]} />)
    expect(screen.getByText('Entregada')).toBeTruthy()
    expect(screen.getByText(/a Marta Solís/)).toBeTruthy()
    expect(screen.getByText(/con firma de acuse/)).toBeTruthy()
  })
})

describe('PortalCorrespondenciaTab — salida', () => {
  const salida = pieza({ id: 'c2', direccion: 'saliente', destinatario: 'Registro Mercantil' })

  it('NO la llama "pendiente de retiro"', () => {
    render(<PortalCorrespondenciaTab correspondencia={[salida]} />)
    expect(screen.getByText('En trámite de envío')).toBeTruthy()
    expect(screen.queryByText('Pendiente de retiro')).toBeNull()
  })

  it('NO la cuenta entre las que hay que ir a recoger', () => {
    render(<PortalCorrespondenciaTab correspondencia={[salida]} />)
    expect(screen.queryByText(/por retirar en administración/)).toBeNull()
  })

  it('NO le pone plazo de respuesta aunque la pieza lo tenga', () => {
    // El plazo es del que RECIBE una notificación; para lo que él manda no
    // significa nada, y en rojo parece una deuda suya.
    render(<PortalCorrespondenciaTab correspondencia={[{ ...salida, fecha_limite: '2020-01-01' }]} />)
    expect(screen.queryByText(/Plazo/)).toBeNull()
    expect(screen.queryByText(/Plazo vencido/)).toBeNull()
  })

  it('habla de envío: "Registrada para envío" y "Para: …"', () => {
    render(<PortalCorrespondenciaTab correspondencia={[salida]} />)
    expect(screen.getByText(/Registrada para envío el/)).toBeTruthy()
    expect(screen.getByText(/Para: Registro Mercantil/)).toBeTruthy()
    expect(screen.queryByText(/Recibida el/)).toBeNull()
  })

  it('cerrada dice "Enviada", no "Entregada a …"', () => {
    render(<PortalCorrespondenciaTab correspondencia={[{
      ...salida, estado: 'atendido', hora_entrega: '2026-08-14T10:00:00Z',
      entregado_a_nombre: 'Mensajería DHL',
    }]} />)
    expect(screen.getByText('Enviada')).toBeTruthy()
    expect(screen.queryByText(/a Mensajería DHL/)).toBeNull()
  })

  it('mezcladas, cada una con su vocabulario y el contador solo cuenta entradas', () => {
    render(<PortalCorrespondenciaTab correspondencia={[pieza(), salida]} />)
    expect(screen.getByText('Pendiente de retiro')).toBeTruthy()
    expect(screen.getByText('En trámite de envío')).toBeTruthy()
    expect(screen.getByText(/1 por retirar en administración/)).toBeTruthy()
  })
})
