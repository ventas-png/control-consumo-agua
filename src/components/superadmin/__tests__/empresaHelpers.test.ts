import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  moduleBadgeLabel,
  planCodeLabel,
  planCodePorModulos,
  purgeEligibleAt,
  isPurgeEligible,
  formatUsdCents,
} from '../empresaHelpers'

describe('moduleBadgeLabel', () => {
  it('deriva la etiqueta de los flags de servicio', () => {
    expect(moduleBadgeLabel(true, true)).toBe('Agua + Condominios')
    expect(moduleBadgeLabel(true, false)).toBe('Agua')
    expect(moduleBadgeLabel(false, true)).toBe('Condominios')
    expect(moduleBadgeLabel(false, false)).toBe('Sin módulos')
  })

  it('Rentas es el tercer módulo', () => {
    expect(moduleBadgeLabel(true, true, true)).toBe('Agua + Condominios + Rentas')
    expect(moduleBadgeLabel(true, false, true)).toBe('Agua + Rentas')
    expect(moduleBadgeLabel(false, false, true)).toBe('Rentas')
    expect(moduleBadgeLabel(false, false, false)).toBe('Sin módulos')
  })
})

describe('planCodePorModulos (espejo de la función SQL plan_code_por_modulos)', () => {
  it('las ocho combinaciones', () => {
    expect(planCodePorModulos(true, false, false)).toBe('agua_only')
    expect(planCodePorModulos(false, true, false)).toBe('condominios_only')
    expect(planCodePorModulos(false, false, true)).toBe('rentas_only')
    expect(planCodePorModulos(true, true, false)).toBe('bundle')
    expect(planCodePorModulos(true, false, true)).toBe('agua_rentas')
    expect(planCodePorModulos(false, true, true)).toBe('condominios_rentas')
    expect(planCodePorModulos(true, true, true)).toBe('suite')
    expect(planCodePorModulos(false, false, false)).toBeNull()
  })

  it('coincide, caso por caso, con el CASE de la migración', () => {
    const sql = readFileSync(resolve('supabase/migrations/20261126000000_rentas_tercer_modulo_del_plan.sql'), 'utf8')
    const cuerpo = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.plan_code_por_modulos('), sql.indexOf('COMMENT ON FUNCTION public.plan_code_por_modulos'))
    const casos = [...cuerpo.matchAll(/WHEN (.+?)\s+THEN '(\w+)'/g)].map(m => ({
      agua: m[1].includes('p_agua'), condominios: m[1].includes('p_condominios'), rentas: m[1].includes('p_rentas'), plan: m[2],
    }))
    expect(casos).toHaveLength(7)
    // El CASE evalúa en orden: la primera rama cuyos módulos están todos encendidos gana.
    const segunSql = (a: boolean, c: boolean, r: boolean) =>
      casos.find(k => (!k.agua || a) && (!k.condominios || c) && (!k.rentas || r))?.plan ?? null
    for (const a of [true, false]) for (const c of [true, false]) for (const r of [true, false]) {
      expect(planCodePorModulos(a, c, r), `${a} ${c} ${r}`).toBe(segunSql(a, c, r))
    }
  })

  it('todo plan que devuelve tiene etiqueta legible', () => {
    for (const a of [true, false]) for (const c of [true, false]) for (const r of [true, false]) {
      const code = planCodePorModulos(a, c, r)
      if (code) expect(planCodeLabel(code)).not.toBe(code)
    }
  })
})

describe('planCodeLabel', () => {
  it('traduce los códigos de billing plan', () => {
    expect(planCodeLabel('agua_only')).toBe('Solo Agua')
    expect(planCodeLabel('condominios_only')).toBe('Solo Condominios')
    expect(planCodeLabel('bundle')).toBe('Bundle Completo')
    expect(planCodeLabel(null)).toBe('Sin suscripción')
  })

  it('devuelve el código tal cual si es desconocido (forward-compat)', () => {
    expect(planCodeLabel('nuevo_plan')).toBe('nuevo_plan')
  })
})

describe('purga con período de gracia', () => {
  it('sin suspensión no hay elegibilidad', () => {
    expect(purgeEligibleAt(null)).toBeNull()
    expect(isPurgeEligible(null)).toBe(false)
  })

  it('fechas inválidas no habilitan la purga', () => {
    expect(purgeEligibleAt('no-es-fecha')).toBeNull()
    expect(isPurgeEligible('no-es-fecha')).toBe(false)
  })

  it('antes de cumplir la gracia no es elegible; después sí', () => {
    const now = new Date('2026-06-12T00:00:00Z')
    const reciente = '2026-06-01T00:00:00Z' // 11 días suspendida
    const antigua = '2026-01-01T00:00:00Z'  // > 90 días suspendida
    expect(isPurgeEligible(reciente, 90, now)).toBe(false)
    expect(isPurgeEligible(antigua, 90, now)).toBe(true)
  })

  it('la fecha de elegibilidad es suspensión + graceDays', () => {
    const eligible = purgeEligibleAt('2026-01-01T00:00:00Z', 90)
    expect(eligible?.toISOString().slice(0, 10)).toBe('2026-04-01')
  })
})

describe('formatUsdCents', () => {
  it('formatea cents como USD con separador de miles', () => {
    expect(formatUsdCents(0)).toBe('$0.00')
    expect(formatUsdCents(1080)).toBe('$10.80')
    expect(formatUsdCents(123456)).toBe('$1,234.56')
  })
})
