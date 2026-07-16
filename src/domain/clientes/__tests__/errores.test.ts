// Mapeo de errores de persistencia de clientes a mensajes accionables.
// Cubre el bug reportado: 23505 por codigo/cui_dui duplicado a nivel
// plataforma se mostraba como "Verifique conexión".
import { describe, it, expect, vi } from 'vitest'

// errores.ts importa isValidationError de lib/validatedInsert, que a su vez
// instancia el cliente supabase (requiere env vars). Mismo mock que clientes.test.ts.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

import { mensajeErrorGuardarCliente } from '../errores'

describe('mensajeErrorGuardarCliente', () => {
  it('sin error → fallback genérico según la acción', () => {
    expect(mensajeErrorGuardarCliente(null)).toBe('No se pudo guardar el cliente. Verifique conexión.')
    expect(mensajeErrorGuardarCliente(undefined, 'actualizar')).toBe('No se pudo actualizar el cliente. Verifique conexión.')
  })

  it('23505 sobre clientes_cui_dui_unique → mensaje de CUI duplicado con guía de vinculación', () => {
    const msg = mensajeErrorGuardarCliente({
      code: '23505',
      message: 'duplicate key value violates unique constraint "clientes_cui_dui_unique"',
      details: 'Key (cui_dui)=(1234567890) already exists.',
    })
    expect(msg).toContain('CUI/DUI')
    expect(msg).toContain('Solicitar Cliente')
  })

  it('23505 sobre clientes_codigo_key → mensaje de código en uso', () => {
    const msg = mensajeErrorGuardarCliente({
      code: '23505',
      message: 'duplicate key value violates unique constraint "clientes_codigo_key"',
      details: 'Key (codigo)=(CLI-999) already exists.',
    })
    expect(msg).toContain('código de cliente ya está en uso')
  })

  it('acepta el error aplanado a string (contrato de domain mutations)', () => {
    const msg = mensajeErrorGuardarCliente(
      'duplicate key value violates unique constraint "clientes_codigo_key"',
      'actualizar',
    )
    expect(msg).toContain('código de cliente ya está en uso')
  })

  it('23505 sin constraint reconocible → duplicado genérico', () => {
    const msg = mensajeErrorGuardarCliente({ code: '23505', message: 'duplicate key value' })
    expect(msg).toContain('registro duplicado')
  })

  it('VALIDATION_FAILED (pre-validación Zod) → pasa el mensaje del schema', () => {
    const msg = mensajeErrorGuardarCliente({
      code: 'VALIDATION_FAILED',
      message: 'email: Formato de email inválido',
      details: '{}',
    })
    expect(msg).toBe('email: Formato de email inválido')
  })

  it('42501 / RLS → mensaje de permisos', () => {
    expect(mensajeErrorGuardarCliente({ code: '42501', message: 'permission denied' }))
      .toContain('permisos')
    expect(mensajeErrorGuardarCliente({ message: 'new row violates row-level security policy for table "clientes"' }))
      .toContain('permisos')
  })

  it('otro error con mensaje → lo incluye en vez de ocultarlo', () => {
    expect(mensajeErrorGuardarCliente({ code: 'PGRST204', message: "Could not find the 'nit' column" }))
      .toBe("No se pudo guardar el cliente: Could not find the 'nit' column")
  })
})
