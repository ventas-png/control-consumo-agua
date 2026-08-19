// El aviso al residente tiene que contar la verdad.
//
// El patrón anterior mentía dos veces: `try { notificarPieza() } catch {}` se
// tragaba el fallo, y el toast decía "Se avisó al residente" incluso cuando la
// respuesta traía notified=0/emailed=0 (residente sin correo, sin teléfono y
// sin usuario del portal). Quien registraba la pieza se iba convencido de que
// el vecino ya sabía. Estas pruebas fijan que el resultado REAL mande.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ResultadoAviso } from '../../../lib/paquetesNotify'

interface ToastSpy { variant?: string; title?: string; text?: string }
interface ConfirmSpy { title: string; text?: string; confirmText?: string; cancelText?: string }

const notify = vi.fn<(o: ToastSpy) => void>()
const confirm = vi.fn<(o: ConfirmSpy) => Promise<{ isConfirmed: boolean }>>()
vi.mock('../../shared/Dialog', () => ({
  notify: (o: ToastSpy) => notify(o),
  confirm: (o: ConfirmSpy) => confirm(o),
}))

const intentarAvisar = vi.fn<(id: string) => Promise<ResultadoAviso>>()
vi.mock('../../../lib/paquetesNotify', () => ({
  intentarAvisar: (id: string) => intentarAvisar(id),
}))

import { avisarConReintento } from '../avisoRecepcion'

const ENTREGADO: ResultadoAviso = {
  estado: 'entregado', detalle: { delivered: true, notified: 1, emailed: 1, whatsapp: 'not_configured' },
}
const SIN_CANALES: ResultadoAviso = {
  estado: 'sin_canales', detalle: { delivered: false, notified: 0, emailed: 0, whatsapp: 'not_configured' },
}
const FALLO: ResultadoAviso = { estado: 'fallo', error: new Error('notify-package falló con 500') }

/** Última llamada a notify(), que es lo que el operador termina viendo. */
function ultimoToast(): ToastSpy {
  const llamadas = notify.mock.calls
  return llamadas.length > 0 ? llamadas[llamadas.length - 1][0] : {}
}

/** Primer confirm() mostrado (el diálogo de reintento). */
function primerConfirm(): ConfirmSpy {
  expect(confirm.mock.calls.length, 'se esperaba un diálogo de reintento').toBeGreaterThan(0)
  return confirm.mock.calls[0][0]
}

beforeEach(() => {
  notify.mockClear(); confirm.mockClear(); intentarAvisar.mockReset()
  confirm.mockResolvedValue({ isConfirmed: false })
})

describe('avisarConReintento', () => {
  it('entregado: dice éxito y por qué canales salió', async () => {
    intentarAvisar.mockResolvedValue(ENTREGADO)
    await avisarConReintento('p1')
    expect(ultimoToast().variant).toBe('success')
    expect(ultimoToast().text).toContain('app, correo')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('sin canales: NO dice que se avisó — advierte y ofrece reintentar', async () => {
    intentarAvisar.mockResolvedValue(SIN_CANALES)
    await avisarConReintento('p1')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(primerConfirm()).toMatchObject({ confirmText: 'Reintentar aviso' })
    expect(ultimoToast().variant).toBe('warning')
    expect(ultimoToast().text).toMatch(/NO fue notificado/)
  })

  it('fallo de red/servidor: tampoco se traga el error', async () => {
    intentarAvisar.mockResolvedValue(FALLO)
    await avisarConReintento('p1')
    // El motivo del fallo llega al operador, no al vacío.
    expect(primerConfirm().text).toContain('notify-package falló con 500')
    expect(ultimoToast().variant).toBe('warning')
  })

  it('reintentar vuelve a llamar y, si esta vez entrega, cierra en éxito', async () => {
    intentarAvisar.mockResolvedValueOnce(SIN_CANALES).mockResolvedValueOnce(ENTREGADO)
    confirm.mockResolvedValueOnce({ isConfirmed: true })
    await avisarConReintento('p1')
    expect(intentarAvisar).toHaveBeenCalledTimes(2)
    expect(ultimoToast().variant).toBe('success')
  })

  it('explica el caso más común: la unidad sin residente registrado', async () => {
    intentarAvisar.mockResolvedValue({
      estado: 'sin_canales', detalle: { delivered: false, skipped: 'no_cliente' },
    })
    await avisarConReintento('p1')
    expect(primerConfirm().text).toContain('no tiene un residente registrado')
  })

  it('nunca reporta éxito sin entrega, pase lo que pase', async () => {
    for (const resultado of [SIN_CANALES, FALLO]) {
      notify.mockClear(); intentarAvisar.mockResolvedValue(resultado)
      await avisarConReintento('p1')
      const exitos = notify.mock.calls.filter(c => (c[0] as { variant?: string }).variant === 'success')
      expect(exitos, `${resultado.estado} no puede producir un toast de éxito`).toHaveLength(0)
    }
  })
})
