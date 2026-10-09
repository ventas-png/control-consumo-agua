// Texto de error de las acciones de compras y pagos: la pantalla muestra el texto del SERVIDOR.
import { describe, expect, it } from 'vitest'
import { QueryError, SinFilasAfectadasError } from '../../queryFetch'
import { mensajeAccionCompras } from '../errores'

const PERMISO = 'COMPRAS_PERMISO_ACCION: para aprobar (contabilizar) una factura de proveedor tu perfil necesita el permiso «Compras y pagos — Aprobar una factura de proveedor».'

describe('mensajeAccionCompras · permiso, alcance y separación: el texto del servidor sin el código', () => {
  it('COMPRAS_PERMISO_ACCION: dice qué acción y qué permiso falta', () => {
    expect(mensajeAccionCompras(new Error(PERMISO))).toBe(
      'Para aprobar (contabilizar) una factura de proveedor tu perfil necesita el permiso «Compras y pagos — Aprobar una factura de proveedor».',
    )
  })

  it('COMPRAS_ALCANCE_PROYECTO: dice que hace falta estar asignado al proyecto del documento', () => {
    expect(mensajeAccionCompras(new Error('COMPRAS_ALCANCE_PROYECTO: para anular una orden de pago tu perfil necesita estar asignado al proyecto del documento.')))
      .toBe('Para anular una orden de pago tu perfil necesita estar asignado al proyecto del documento.')
  })

  it('COMPRAS_ALCANCE_EMPRESA: dice que el documento tiene que ser de la empresa de la sesión', () => {
    expect(mensajeAccionCompras(new Error('COMPRAS_ALCANCE_EMPRESA: para registrar una recepción el documento tiene que ser de la empresa de tu sesión.')))
      .toBe('Para registrar una recepción el documento tiene que ser de la empresa de tu sesión.')
  })

  it.each([
    'COMPRAS_CONFIG_SEPARACION_VIA_RPC',
    'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN',
    'COMPRAS_CONFIG_SEPARACION_TRUNCATE',
  ])('%s: el texto del servidor', (codigo) => {
    expect(mensajeAccionCompras(new Error(`${codigo}: el interruptor se cambia solo desde compras_separacion_configurar.`)))
      .toBe('El interruptor se cambia solo desde compras_separacion_configurar.')
  })

  it('acepta el error tal como llega de PostgREST (QueryError), de un objeto con message y de un texto', () => {
    expect(mensajeAccionCompras(new QueryError(PERMISO, null))).toMatch(/^Para aprobar \(contabilizar\)/)
    expect(mensajeAccionCompras({ message: PERMISO, code: '42501' })).toMatch(/^Para aprobar \(contabilizar\)/)
    expect(mensajeAccionCompras(PERMISO)).toMatch(/^Para aprobar \(contabilizar\)/)
  })

  it('un mensaje de varias líneas conserva todo el texto', () => {
    expect(mensajeAccionCompras(new Error('COMPRAS_PERMISO_ACCION: primera línea.\nSegunda línea.'))).toBe('Primera línea.\nSegunda línea.')
  })
})

describe('mensajeAccionCompras · lo demás no cambia', () => {
  it('«sin filas afectadas» conserva su propio texto: no se disfraza ni se reescribe', () => {
    const e = new SinFilasAfectadasError()
    expect(mensajeAccionCompras(e)).toBe(e.message)
    expect(mensajeAccionCompras(e)).toMatch(/El servidor no aplicó el cambio/)
  })

  it('otros rechazos del servidor se muestran como llegaron (con su código, como hasta ahora)', () => {
    const t = 'COMPRAS_CONTRATO_NO_VIGENTE: no se puede aprobar la orden al amparo de su contrato'
    expect(mensajeAccionCompras(new Error(t))).toBe(t)
    const u = 'COMPRAS_PAGO_EXCEDE_SALDO: la factura tiene un saldo de 100'
    expect(mensajeAccionCompras(new Error(u))).toBe(u)
  })

  it('un código parecido pero de otra familia (COMPRAS_PERMISO_OTRO, COMPRAS_ALCANCE_X) no se toca', () => {
    expect(mensajeAccionCompras(new Error('COMPRAS_PERMISO_OTRO: algo'))).toBe('COMPRAS_PERMISO_OTRO: algo')
    expect(mensajeAccionCompras(new Error('COMPRAS_ALCANCE_LINEA: algo'))).toBe('COMPRAS_ALCANCE_LINEA: algo')
  })

  it('un error con el código pero sin texto no deja el aviso vacío', () => {
    expect(mensajeAccionCompras(new Error('COMPRAS_PERMISO_ACCION:'))).toBe('COMPRAS_PERMISO_ACCION:')
  })

  it('sin mensaje usa el respaldo (el que pasa quien llama, o uno por omisión)', () => {
    expect(mensajeAccionCompras(undefined)).toBe('No se pudo completar la acción.')
    expect(mensajeAccionCompras(null, 'Error inesperado.')).toBe('Error inesperado.')
    expect(mensajeAccionCompras(new Error(''), 'Error inesperado.')).toBe('Error inesperado.')
  })
})
