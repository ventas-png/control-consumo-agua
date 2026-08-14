// Tests del clasificador de fallos de login que NO son de credenciales.
// El caso que motivó el módulo: en iOS/Safari el usuario veía en la pantalla de
// login "Error: Load failed (<ref>.supabase.co)" —el texto crudo de WebKit—
// porque supabase-js DEVUELVE el fallo de red en `{ error }` en vez de lanzarlo,
// y el mensaje amable solo existía en el `catch`.
import { describe, it, expect } from 'vitest'
import {
  connectivityLoginMessage,
  NETWORK_LOGIN_MESSAGE,
  SERVER_LOGIN_MESSAGE,
} from '../loginErrors'

describe('connectivityLoginMessage', () => {
  it('Safari/WebKit: "Load failed" con el host → mensaje de red', () => {
    expect(connectivityLoginMessage({
      name: 'AuthRetryableFetchError',
      message: 'Load failed (nnsqmeigtgewatameexo.supabase.co)',
      status: 0,
    })).toBe(NETWORK_LOGIN_MESSAGE)
  })

  it('Chrome/Edge: "Failed to fetch" → mensaje de red', () => {
    expect(connectivityLoginMessage({
      name: 'AuthRetryableFetchError',
      message: 'Failed to fetch',
      status: 0,
    })).toBe(NETWORK_LOGIN_MESSAGE)
  })

  it('Firefox: "NetworkError when attempting to fetch resource." → mensaje de red', () => {
    expect(connectivityLoginMessage({
      name: 'AuthRetryableFetchError',
      message: 'NetworkError when attempting to fetch resource.',
      status: 0,
    })).toBe(NETWORK_LOGIN_MESSAGE)
  })

  it('retryable sin status (TypeError suelto del catch) → mensaje de red', () => {
    expect(connectivityLoginMessage({ name: 'AuthRetryableFetchError', message: '' }))
      .toBe(NETWORK_LOGIN_MESSAGE)
  })

  it('5xx del servidor/edge → mensaje de servidor, NO de internet', () => {
    // auth-js envuelve 500-530 en el MISMO AuthRetryableFetchError que un fallo
    // de red; el status es lo único que los separa. Mandar a revisar la red a
    // quien tiene el backend caído es mandarlo a diagnosticar donde no es.
    expect(connectivityLoginMessage({ name: 'AuthRetryableFetchError', message: '{}', status: 503 }))
      .toBe(SERVER_LOGIN_MESSAGE)
    expect(connectivityLoginMessage({ name: 'AuthRetryableFetchError', message: '{}', status: 522 }))
      .toBe(SERVER_LOGIN_MESSAGE)
  })

  it('credenciales inválidas → null (lo clasifica el llamador y sí cuenta para el lockout)', () => {
    expect(connectivityLoginMessage({
      name: 'AuthApiError',
      message: 'Invalid login credentials',
      status: 400,
    })).toBeNull()
  })

  it('email no confirmado y rate limit del servidor → null', () => {
    expect(connectivityLoginMessage({ name: 'AuthApiError', message: 'Email not confirmed', status: 400 })).toBeNull()
    expect(connectivityLoginMessage({ name: 'AuthApiError', message: 'Request rate limit reached', status: 429 })).toBeNull()
  })

  it('sin error → null', () => {
    expect(connectivityLoginMessage(null)).toBeNull()
    expect(connectivityLoginMessage(undefined)).toBeNull()
  })
})
