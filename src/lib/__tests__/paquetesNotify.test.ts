// Contrato de "¿el aviso llegó de verdad?" y de cuándo se reintenta.
//
// Dos mentiras posibles y su prueba:
//   · La edge function responde 200 aunque no haya entregado nada (residente
//     sin correo ni teléfono, canales caídos). Tratar ese 200 como éxito era lo
//     que hacía que la UI dijera "Se avisó al residente" sin avisar a nadie.
//   · Un 4xx se reintentaba tres veces con backoff cuando el servidor mandaba
//     `error` en el body, porque la decisión miraba el TEXTO del mensaje.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// El módulo importa el cliente de Supabase al cargarse (lanza sin env vars).
vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } },
}))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { avisoEntregado, intentarAvisar, notificarPieza, ErrorAvisoHttp } from '../paquetesNotify'

describe('avisoEntregado', () => {
  it('respeta el veredicto del servidor cuando viene', () => {
    expect(avisoEntregado({ delivered: true })).toBe(true)
    expect(avisoEntregado({ delivered: false })).toBe(false)
  })

  it('el flag del servidor manda sobre los contadores', () => {
    // Si el servidor dice que no entregó, no lo contradecimos con aritmética.
    expect(avisoEntregado({ delivered: false, notified: 3 })).toBe(false)
  })

  it('sin flag (edge function anterior) lo deriva de los canales', () => {
    expect(avisoEntregado({ notified: 1 })).toBe(true)
    expect(avisoEntregado({ emailed: 1 })).toBe(true)
    expect(avisoEntregado({ whatsapp: 'sent' })).toBe(true)
  })

  it('cero canales entregados NO es entrega, aunque la llamada haya ido bien', () => {
    expect(avisoEntregado({ success: true, notified: 0, emailed: 0, whatsapp: 'not_configured' })).toBe(false)
    expect(avisoEntregado({ notified: 0, emailed: 0, whatsapp: 'error' })).toBe(false)
    expect(avisoEntregado({})).toBe(false)
  })

  it('un skip del servidor tampoco es entrega', () => {
    expect(avisoEntregado({ success: true, skipped: 'no_cliente' })).toBe(false)
    expect(avisoEntregado({ success: true, skipped: 'already_notified' })).toBe(false)
  })
})

// ── Reintentos ──────────────────────────────────────────────────────────────
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

/** Respuesta mínima con la forma que consume notificarPieza. */
function respuesta(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

// Sin espera real: los delays del backoff no aportan nada al test.
const SIN_ESPERA = { retryDelaysMs: [0, 0] }

beforeEach(() => { fetchMock.mockReset() })

describe('notificarPieza — política de reintentos', () => {
  it('200: devuelve el cuerpo y no reintenta', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { delivered: true, notified: 1 }))
    await expect(notificarPieza('p1', SIN_ESPERA)).resolves.toMatchObject({ delivered: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // El caso que estaba roto: con `error` en el body, el mensaje del Error era
  // el del servidor y la comprobación por texto no lo reconocía como 4xx.
  for (const [status, mensaje] of [[401, 'Unauthorized'], [403, 'Forbidden'], [404, 'Paquete no encontrado']] as const) {
    it(`${status} con json.error ("${mensaje}"): NO reintenta`, async () => {
      fetchMock.mockResolvedValue(respuesta(status, { error: mensaje }))
      await expect(notificarPieza('p1', SIN_ESPERA)).rejects.toThrow(mensaje)
      expect(fetchMock, `un ${status} no debe repetirse`).toHaveBeenCalledTimes(1)
    })

    it(`${status} con json.error expone el status para quien lo capture`, async () => {
      fetchMock.mockResolvedValue(respuesta(status, { error: mensaje }))
      const err = await notificarPieza('p1', SIN_ESPERA).catch(e => e)
      expect(err).toBeInstanceOf(ErrorAvisoHttp)
      expect((err as ErrorAvisoHttp).status).toBe(status)
      expect((err as ErrorAvisoHttp).reintentable).toBe(false)
    })
  }

  it('4xx SIN json.error tampoco reintenta (el caso que sí funcionaba antes)', async () => {
    fetchMock.mockResolvedValue(respuesta(400, {}))
    await expect(notificarPieza('p1', SIN_ESPERA)).rejects.toThrow(/400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('5xx sí reintenta hasta agotar los intentos', async () => {
    fetchMock.mockResolvedValue(respuesta(500, { error: 'boom' }))
    await expect(notificarPieza('p1', SIN_ESPERA)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('5xx que luego se recupera devuelve el resultado bueno', async () => {
    fetchMock
      .mockResolvedValueOnce(respuesta(503, { error: 'no disponible' }))
      .mockResolvedValueOnce(respuesta(200, { delivered: true, emailed: 1 }))
    await expect(notificarPieza('p1', SIN_ESPERA)).resolves.toMatchObject({ delivered: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('la red caída (rejection del fetch) se reintenta', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(notificarPieza('p1', SIN_ESPERA)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('un 4xx cuyo mensaje imita a un error de red sigue sin reintentarse', async () => {
    // La decisión es por status; el texto del servidor es irrelevante.
    fetchMock.mockResolvedValue(respuesta(403, { error: 'Failed to fetch' }))
    await expect(notificarPieza('p1', SIN_ESPERA)).rejects.toThrow('Failed to fetch')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// ── "Ya se le había avisado" no es "no tiene datos de contacto" ─────────────
// Con el claim del servidor (20260901000000) una segunda llamada responde
// `already_notified`. Tratarlo como `sin_canales` le decía al operador que el
// residente no tenía correo ni teléfono — cuando el correo ya había salido.
describe('intentarAvisar — el servidor dice que ya está hecho', () => {
  for (const skipped of ['already_notified', 'aviso_en_curso']) {
    it(`${skipped} se distingue de "sin canales"`, async () => {
      fetchMock.mockResolvedValue(respuesta(200, { success: true, skipped, delivered: false }))
      const r = await intentarAvisar('p1', SIN_ESPERA)
      expect(r.estado).toBe('ya_avisado')
    })
  }

  it('un 200 sin entrega y sin skip sigue siendo "sin canales"', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { success: true, notified: 0, emailed: 0 }))
    expect((await intentarAvisar('p1', SIN_ESPERA)).estado).toBe('sin_canales')
  })

  it('un skip por falta de residente NO es "ya avisado"', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { success: true, skipped: 'no_cliente', delivered: false }))
    expect((await intentarAvisar('p1', SIN_ESPERA)).estado).toBe('sin_canales')
  })

  it('si algo entregó, manda la entrega aunque venga un skip', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { delivered: true, emailed: 1, skipped: 'already_notified' }))
    expect((await intentarAvisar('p1', SIN_ESPERA)).estado).toBe('entregado')
  })
})
