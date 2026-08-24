// ════════════════════════════════════════════════════════════════════════════
// Contrato del seed del tenant E2E.
// ════════════════════════════════════════════════════════════════════════════
// Dos cosas que este script no puede equivocarse, porque escribe con
// service_role y porque de él depende que dos specs OBLIGATORIOS ejecuten:
//
//   1. No sembrar en el proyecto equivocado. La puerta es la misma declaración
//      que exige el preflight: E2E_EXPECTED_SUPABASE_REF tiene que coincidir
//      con el ref de la URL, ANTES de cualquier escritura.
//   2. REPONER los estados de partida, no sólo insertar si falta. La suite
//      consume lo sembrado (emite la factura, paga la cuota); un seed que sólo
//      inserta deja la SEGUNDA corrida sin nada que emitir y los specs se
//      vuelven a skipear.
import { describe, expect, it } from 'vitest'

import { MARCADORES, VARIABLES, main, planDeSiembra, refDeUrl, validarEntorno } from '../seed-e2e-tenant.mjs'

const SERVICE_ROLE = 'service-role-jamas-impresa-8b2e'
const COMPLETO = {
  SEED_SERVICE_ROLE_KEY: SERVICE_ROLE,
  VITE_SUPABASE_URL: 'https://sandboxref.supabase.co',
  E2E_EXPECTED_SUPABASE_REF: 'sandboxref',
  E2E_LOGIN_EMAIL: 'rls-owner@sandbox.invalid',
}

const CTX = {
  companyId: 'c0000000-0000-0000-0000-000000000001',
  projectId: 'p0000000-0000-0000-0000-000000000002',
  unidadId: 'u0000000-0000-0000-0000-000000000003',
  ahora: '2026-08-24T18:00:00.000Z',
}

describe('la puerta del proyecto se cierra ANTES de escribir', () => {
  it('sin cualquiera de las cuatro variables no arranca, y la nombra', async () => {
    for (const variable of VARIABLES) {
      const env = { ...COMPLETO }
      delete env[variable]
      expect(validarEntorno(env).ok).toBe(false)
      expect(validarEntorno(env).motivo).toContain(variable)
      // Y main ni siquiera construye el cliente.
      const code = await main(env, () => { throw new Error('no debía crear cliente') }, () => {}, () => {})
      expect(code).toBe(1)
    }
  })

  it('ref declarado ≠ ref de la URL → se niega, nombrando los dos', () => {
    const r = validarEntorno({ ...COMPLETO, E2E_EXPECTED_SUPABASE_REF: 'otro' })
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('sandboxref')
    expect(r.motivo).toContain('otro')
    expect(r.motivo).toMatch(/service_role/)
  })

  it('una URL que no es de Supabase se rechaza', () => {
    expect(validarEntorno({ ...COMPLETO, VITE_SUPABASE_URL: 'https://ejemplo.com' }).ok).toBe(false)
    expect(refDeUrl('https://sandboxref.supabase.co')).toBe('sandboxref')
    expect(refDeUrl('no-es-url')).toBeNull()
  })

  it('coincidiendo, pasa', () => {
    expect(validarEntorno(COMPLETO).ok).toBe(true)
  })

  it('la service_role no aparece en ningún mensaje de la puerta', async () => {
    const lineas = []
    const registrar = (...xs) => lineas.push(xs.join(' '))
    await main({ ...COMPLETO, E2E_EXPECTED_SUPABASE_REF: 'otro' }, () => {
      throw new Error('no debía crear cliente')
    }, registrar, registrar)
    expect(lineas.join('\n')).not.toContain(SERVICE_ROLE)
  })
})

describe('el plan repone los estados que la suite consume', () => {
  const plan = planDeSiembra(CTX)

  it('el cargo de /cobros vuelve a "pendiente" aunque la corrida anterior lo emitiera', () => {
    expect(plan.registro.reposicion.factura_estado).toBe('pendiente')
    // Los sellos de la transición anterior se limpian: si no, la fila quedaría
    // "pendiente" con emitida_at puesto y el historial mentiría.
    for (const sello of ['emitida_at', 'pagada_at', 'vencida_at', 'anulada_at']) {
      expect(plan.registro.reposicion[sello]).toBeNull()
    }
    // Y un soft-delete previo no la deja fuera de la consulta de facturación.
    expect(plan.registro.reposicion.deleted_at).toBeNull()
  })

  it('hay UNA cuota pendiente (habilita Emitir) y UNA emitida (habilita Pagar)', () => {
    const estados = plan.cuotas.map((c) => c.reposicion.cuota_estado)
    expect(estados).toEqual(['pendiente', 'emitida'])
  })

  it('la cuota emitida lleva emitida_at y la pendiente no', () => {
    const [pendiente, emitida] = plan.cuotas
    expect(pendiente.reposicion.emitida_at).toBeNull()
    expect(emitida.reposicion.emitida_at).toBe(CTX.ahora)
    // Ninguna de las dos llega ya pagada: eso es justo lo que el spec hace.
    expect(pendiente.reposicion.pagada_at).toBeNull()
    expect(emitida.reposicion.pagada_at).toBeNull()
  })

  it('cada fila se reconoce por un MARCADOR estable, no por id: correrlo dos veces no duplica', () => {
    expect(plan.tarifa.busqueda.nombre).toBe(MARCADORES.tarifa)
    expect(plan.contador.busqueda.numero_serie).toBe(MARCADORES.contador)
    expect(plan.registro.busqueda.cliente_nombre).toBe(MARCADORES.cliente)
    expect(plan.cuotas.map((c) => c.busqueda.periodo)).toEqual([
      MARCADORES.cuotaPendiente,
      MARCADORES.cuotaEmitida,
    ])
    // Los marcadores son distintos entre sí: si dos coincidieran, la segunda
    // fila "reutilizaría" la primera y faltaría un estado de partida.
    const todos = Object.values(MARCADORES)
    expect(new Set(todos).size).toBe(todos.length)
  })

  it('todo cuelga del tenant resuelto, nada de ids sueltos', () => {
    expect(plan.tarifa.fila.company_id).toBe(CTX.companyId)
    expect(plan.contador.fila.company_id).toBe(CTX.companyId)
    expect(plan.contador.fila.unidad_id).toBe(CTX.unidadId)
    expect(plan.registro.fila.project_id).toBe(CTX.projectId)
    for (const c of plan.cuotas) {
      expect(c.fila.company_id).toBe(CTX.companyId)
      expect(c.fila.project_id).toBe(CTX.projectId)
    }
  })

  it('el contador queda ACTIVO y con consumo facturable: un contador inactivo no aparece en el selector', () => {
    expect(plan.contador.fila.activo).toBe(true)
    expect(plan.tarifa.fila.activa).toBe(true)
    expect(plan.tarifa.fila.precio_m3).toBeGreaterThan(0)
    expect(plan.registro.fila.consumo).toBeGreaterThan(0)
    expect(plan.registro.fila.total_a_pagar).toBeGreaterThan(0)
  })

  it('la fecha de vencimiento sale del "ahora" inyectado: el plan es determinista', () => {
    for (const c of plan.cuotas) expect(c.fila.fecha_vencimiento).toBe('2026-08-24')
  })
})

describe('cubre exactamente los specs que hoy se skipean', () => {
  it('siembra contador (agua-lectura-cobro), cargo (cobros) y cuotas (condominios)', () => {
    const plan = planDeSiembra(CTX)
    // Un contador para «la unidad no tiene contador sembrado».
    expect(plan.contador).toBeTruthy()
    // Un cargo para «sin cargos pendientes para emitir».
    expect(plan.registro.reposicion.factura_estado).toBe('pendiente')
    // Dos cuotas para «sin cuotas pendientes» y «sin cuotas cobrables».
    expect(plan.cuotas).toHaveLength(2)
  })
})
