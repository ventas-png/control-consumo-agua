import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards ESTÁTICOS de la captura autoritativa de lecturas (20260910000001 y
// 20260910000101).
//
// ALCANCE Y LÍMITE. Esto lee el SQL del repositorio; la verificación CONDUCTUAL
// —que el importe se recalcule, que la retroactiva se rechace, que el bloqueo
// serialice dos capturas simultáneas— corre contra un Postgres real en
// supabase/tests/registrar_lectura/. Lo de aquí es lo que aquello no puede ver
// desde un PR sin base de datos: que la regla siga ESCRITA como debe, y sobre
// todo que nadie le agregue a la RPC el parámetro que la vaciaría de sentido.
const RPC = resolve('supabase/migrations/20260910000001_registrar_lectura_autoritativa.sql')
const REPORTE = resolve('supabase/migrations/20260910000101_reporte_inconsistencias_lecturas.sql')

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
function soloCodigo(texto: string): string {
  return texto.replace(/--[^\n]*/g, '')
}
const codigo = soloCodigo(readFileSync(RPC, 'utf8'))
const codigoReporte = soloCodigo(readFileSync(REPORTE, 'utf8'))

describe('el navegador no puede decidir el cobro', () => {
  it('registrar_lectura no acepta ningún parámetro que decida el importe', () => {
    const firma = codigo.match(/CREATE OR REPLACE FUNCTION public\.registrar_lectura\(([\s\S]*?)\)\s*RETURNS/)?.[1]
    expect(firma).toBeTruthy()
    const params = firma!.split(/,(?![^(]*\))/).map(p => p.trim().split(/\s+/)[0])
    expect(params).toEqual([
      'p_contador_id', 'p_lectura_actual', 'p_fecha', 'p_idempotency_key',
      'p_notas', 'p_foto', 'p_gps', 'p_reset_medidor',
      'p_lectura_final_retirada', 'p_fecha_inicio_servicio',
    ])
    // Si algún día aparece un p_consumo/p_monto/p_tarifa/p_estado, el recibo
    // vuelve a valer lo que el navegador diga que vale.
    expect(firma).not.toMatch(/p_(consumo|monto|tarifa|canon|estado|project_id|cliente_id|lectura_anterior)/i)
  })

  it('el estado inicial es literal en el INSERT, no un parámetro', () => {
    const cuerpo = codigo.slice(codigo.indexOf('INSERT INTO public.registros'))
    expect(cuerpo).toMatch(/'pendiente'/)
  })

  it('la RPC es SECURITY INVOKER: la autorización sigue siendo la policy', () => {
    const decl = codigo.match(
      /CREATE OR REPLACE FUNCTION public\.registrar_lectura\([\s\S]*?AS \$\$/,
    )?.[0]
    expect(decl).toMatch(/SECURITY INVOKER/)
    expect(decl).not.toMatch(/SECURITY DEFINER/)
  })
})

describe('las tres reglas de negocio están escritas', () => {
  it('la retroactiva se rechaza comparando por DÍA en la zona del tenant', () => {
    expect(codigo).toMatch(/lectura retroactiva/)
    expect(codigo).toMatch(/p_fecha < \(ctx\.base_fecha AT TIME ZONE ctx\.zona_horaria\)::date/)
  })

  it('el reset compone el consumo con la lectura final del medidor retirado', () => {
    expect(codigo).toMatch(
      /v_consumo\s*:=\s*\(p_lectura_final_retirada - ctx\.base_lectura\) \+ p_lectura_actual/,
    )
    // Y exige motivo: sin nota no hay auditoría del único caso en que una
    // lectura puede bajar.
    expect(codigo).toMatch(/length\(COALESCE\(btrim\(p_notas\), ''\)\) < 10/)
  })

  it('varias lecturas el mismo día encadenan por secuencia, no por fecha', () => {
    expect(codigo).toMatch(/ORDER BY COALESCE\(r\.secuencia, 0\) DESC, r\.fecha DESC/)
    expect(codigo).toMatch(/ctx\.base_secuencia \+ 1/)
    expect(codigo).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_registros_secuencia_contador/)
  })
})

describe('la transacción es de verdad', () => {
  it('el bloqueo es por contador y de transacción (cubre la primera lectura)', () => {
    expect(codigo).toMatch(/pg_advisory_xact_lock\(\s*hashtext\('agua\.registrar_lectura'\)/)
  })

  it('la lectura vigente ignora las soft-deleted', () => {
    const contexto = codigo.slice(
      codigo.indexOf('FUNCTION public.agua_lectura_contexto'),
      codigo.indexOf('FUNCTION public.agua_costo_tarifa'),
    )
    expect(contexto).toMatch(/AND r\.deleted_at IS NULL/)
  })

  it('la tarifa se resuelve por el contador, desde la base, y tiene que estar vigente', () => {
    expect(codigo).toMatch(/LEFT JOIN public\.tarifas t ON t\.id = v_contador\.tarifa_id/)
    expect(codigo).toMatch(/la tarifa del contador no está vigente/)
  })

  it('el importe se calcula en NUMERIC y se redondea a 2 (el redondeo del contrato)', () => {
    const costo = codigo.slice(
      codigo.indexOf('FUNCTION public.agua_costo_tarifa'),
      codigo.indexOf('FUNCTION public.agua_lectura_resolver'),
    )
    expect(costo).toMatch(/RETURN QUERY SELECT round\(v_total, 2\)/)
    expect(costo).toMatch(/RETURN QUERY SELECT round\(v_consumo \* v_precio, 2\)/)
  })
})

describe('la idempotencia es por operación, no por clave natural', () => {
  it('la columna existe y su índice único NO es parcial por deleted_at', () => {
    const idx = codigo.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_registros_idempotencia[\s\S]*?;/,
    )?.[0]
    expect(idx).toBeTruthy()
    // Si fuese parcial, reintentar una lectura ya borrada la resucitaría.
    expect(idx).toMatch(/WHERE idempotency_key IS NOT NULL/)
    expect(idx).not.toMatch(/deleted_at/)
  })

  it('el reintento se busca acotado a quien lo hizo (no es un oráculo)', () => {
    expect(codigo).toMatch(/r\.creado_por = \(SELECT auth\.uid\(\)\)/)
  })
})

describe('la transición del INSERT directo', () => {
  it('el trigger existe y recalcula en vez de creerse los valores del cliente', () => {
    expect(codigo).toMatch(/CREATE TRIGGER trg_agua_lectura_autoritativa\s+BEFORE INSERT ON public\.registros/)
    const tg = codigo.slice(codigo.indexOf('FUNCTION public.agua_tg_lectura_autoritativa'))
    for (const campo of [
      'NEW.project_id', 'NEW.cliente_id', 'NEW.lectura_anterior', 'NEW.consumo',
      'NEW.tarifa_aplicada', 'NEW.canon_aplicado', 'NEW.monto_calculado',
      'NEW.tipo_cobro', 'NEW.estado', 'NEW.secuencia',
    ]) {
      expect(tg).toContain(campo)
    }
    expect(tg).toMatch(/agua_lectura_resolver/)
  })

  it('tiene fecha de cierre en el CÓDIGO, no en una promesa', () => {
    expect(codigo).toMatch(/now\(\) >= timestamptz '2026-12-01/)
    expect(codigo).toMatch(/el INSERT directo en registros está cerrado/)
  })
})

describe('la ACL', () => {
  it('ninguna función nueva queda ejecutable por PUBLIC/anon', () => {
    const creadas = [...codigo.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)]
      .map(m => m[1])
    expect(creadas).toContain('registrar_lectura')
    for (const fn of new Set(creadas)) {
      expect(
        new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(`).test(codigo),
        `${fn} no tiene REVOKE de PUBLIC/anon`,
      ).toBe(true)
    }
  })

  it('el cuerpo del trigger no se le concede a nadie', () => {
    expect(codigo).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.agua_tg_lectura_autoritativa\(\) FROM PUBLIC, anon, authenticated/,
    )
    expect(codigo).not.toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.agua_tg_lectura_autoritativa/)
  })
})

describe('el reporte de inconsistencias es de SÓLO lectura', () => {
  it('no contiene ninguna escritura', () => {
    expect(codigoReporte).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i)
  })

  it('las dos funciones son STABLE, que es lo que lo hace incapaz de escribir', () => {
    const fns = codigoReporte.match(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$\$/g) ?? []
    expect(fns).toHaveLength(2)
    for (const f of fns) expect(f).toMatch(/\bSTABLE\b/)
  })

  it('está acotado a la empresa y a los proyectos del caller', () => {
    expect(codigoReporte).toMatch(/public\.is_super_admin\(\) OR p\.company_id = public\.get_my_company_id\(\)/)
    expect(codigoReporte).toMatch(/public\.can_access_project\(p\.id\)/)
  })
})
