// Tests de la decisión PURA de supresión por preferencia de canal (T2/com:N9 ·
// infra:I22). Corre bajo vitest tratando el módulo como TS normal (sin Deno/I/O).
// Cubre el contrato que usa el dispatcher para decidir SI consultar la preferencia
// y contra qué user_id.

import { describe, it, expect } from 'vitest'
import {
  isUuid,
  isSuppressibleChannel,
  resolvePreferenceUserId,
  SUPPRESSION_REASON_CHANNEL_DISABLED,
} from '../notificationPrefs.ts'

const UID = '11111111-2222-3333-4444-555555555555'

describe('notificationPrefs/isUuid', () => {
  it('acepta UUID canónico (mayúsculas o minúsculas)', () => {
    expect(isUuid(UID)).toBe(true)
    expect(isUuid(UID.toUpperCase())).toBe(true)
  })
  it('rechaza no-UUID', () => {
    expect(isUuid('no-soy-uuid')).toBe(false)
    expect(isUuid('user@example.com')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid(undefined)).toBe(false)
    expect(isUuid(123)).toBe(false)
  })
})

describe('notificationPrefs/isSuppressibleChannel', () => {
  it('email/whatsapp/push son suprimibles', () => {
    expect(isSuppressibleChannel('email')).toBe(true)
    expect(isSuppressibleChannel('whatsapp')).toBe(true)
    expect(isSuppressibleChannel('push')).toBe(true)
  })
  it('in_app NUNCA es suprimible (la campana siempre recibe)', () => {
    expect(isSuppressibleChannel('in_app')).toBe(false)
  })
  it('canal desconocido no es suprimible', () => {
    expect(isSuppressibleChannel('sms')).toBe(false)
  })
})

describe('notificationPrefs/resolvePreferenceUserId', () => {
  it('in_app → null (no se chequea preferencia; nunca se suprime)', () => {
    expect(resolvePreferenceUserId({ channel: 'in_app', payload: { user_id: UID } })).toBeNull()
  })

  it('email con payload.user_id válido → ese user_id', () => {
    expect(resolvePreferenceUserId({ channel: 'email', payload: { user_id: UID } })).toBe(UID)
  })

  it('whatsapp/push con user_id válido → ese user_id', () => {
    expect(resolvePreferenceUserId({ channel: 'whatsapp', payload: { user_id: UID } })).toBe(UID)
    expect(resolvePreferenceUserId({ channel: 'push', payload: { user_id: UID } })).toBe(UID)
  })

  it('email sin user_id (p.ej. difusión a clientes) → null (no suprime, opt-out)', () => {
    expect(resolvePreferenceUserId({ channel: 'email', payload: { cliente_id: 'abc' } })).toBeNull()
    expect(resolvePreferenceUserId({ channel: 'email', payload: {} })).toBeNull()
    expect(resolvePreferenceUserId({ channel: 'email', payload: null })).toBeNull()
  })

  it('email con user_id no-UUID → null (no confía en basura del payload)', () => {
    expect(resolvePreferenceUserId({ channel: 'email', payload: { user_id: 'no-uuid' } })).toBeNull()
  })

  it('canal desconocido → null', () => {
    expect(resolvePreferenceUserId({ channel: 'sms', payload: { user_id: UID } })).toBeNull()
  })
})

describe('notificationPrefs/constantes', () => {
  it('la razón canónica de supresión es channel_disabled', () => {
    expect(SUPPRESSION_REASON_CHANNEL_DISABLED).toBe('channel_disabled')
  })
})
