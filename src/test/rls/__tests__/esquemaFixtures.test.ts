import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FIXTURES, MOTIVO_RPC_PRIVILEGIO, MOTIVO_RPC_ROL, RPCS_OBLIGATORIAS } from '../coverage'
import { concedidaA, definicionVigente, firmasDe, parsearFunciones } from '../sqlFunciones'

// ════════════════════════════════════════════════════════════════════════════
// Prueba CONTRACTUAL: los fixtures del seed/harness contra el esquema real.
// ════════════════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE
// El harness prueba que RLS RECHAZA una escritura cruzada. Si el payload viola
// un CHECK del esquema, Postgres lo aborta ANTES de evaluar la policy: el test
// «pasa» sin haber probado aislamiento — un falso positivo silencioso. Eso pasó
// con `regimen: 'general'`, que no está en `CHECK (regimen IN ('fel_gt',
// 'cfdi_mx'))`. Esta prueba lee la migración y falla si un fixture vuelve a
// salirse del dominio permitido.

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..', '..', '..')
const MIGRACIONES = join(RAIZ, 'supabase', 'migrations')

const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')

const MIGRACION_FISCAL = leer(
  'supabase/migrations/20260604220000_fiscal_documents_fel_cfdi.sql',
)
const SEED = leer('scripts/seed-rls-sandbox.mjs')
const HARNESS = leer('src/test/rls/rlsHarness.test.ts')

/**
 * Extrae los literales de un `CHECK (<columna> IN ('a', 'b'))` en el bloque
 * CREATE TABLE de `documentos_fiscales`.
 */
function valoresDelCheck(sql: string, columna: string): string[] {
  const patron = new RegExp(`CHECK\\s*\\(\\s*${columna}\\s+IN\\s*\\(([^)]*)\\)`, 'i')
  const m = sql.match(patron)
  expect(m, `no se encontró el CHECK de ${columna} en la migración fiscal`).toBeTruthy()
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

describe('contrato de esquema — documentos_fiscales', () => {
  it('el CHECK de regimen sigue siendo exactamente fel_gt | cfdi_mx', () => {
    expect(valoresDelCheck(MIGRACION_FISCAL, 'regimen')).toEqual(['fel_gt', 'cfdi_mx'])
  })

  it('FIXTURES.regimenDocumento pertenece al dominio del CHECK', () => {
    expect(valoresDelCheck(MIGRACION_FISCAL, 'regimen')).toContain(FIXTURES.regimenDocumento)
  })

  it("'general' sigue siendo un régimen inválido (no se relajó el CHECK)", () => {
    expect(valoresDelCheck(MIGRACION_FISCAL, 'regimen')).not.toContain('general')
  })

  it('FIXTURES.tipoDocumento pertenece al dominio del CHECK de tipo', () => {
    expect(valoresDelCheck(MIGRACION_FISCAL, 'tipo')).toContain(FIXTURES.tipoDocumento)
  })

  it('ni el seed ni el harness reintroducen un régimen fuera del CHECK', () => {
    const permitidos = valoresDelCheck(MIGRACION_FISCAL, 'regimen')
    for (const [archivo, fuente] of [
      ['seed-rls-sandbox.mjs', SEED],
      ['rlsHarness.test.ts', HARNESS],
    ] as const) {
      for (const m of fuente.matchAll(/regimen:\s*'([^']+)'/g)) {
        expect(permitidos, `${archivo} usa regimen '${m[1]}', fuera del CHECK`).toContain(m[1])
      }
    }
  })
})

describe('contrato de cobertura — RPCs del portal', () => {
  const rpcsEnMigraciones = new Set<string>()
  for (const archivo of readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRACIONES, archivo), 'utf8')
    for (const m of sql.matchAll(/FUNCTION\s+public\.(portal_\w+)/g)) rpcsEnMigraciones.add(m[1])
  }

  it('la migración de baja de renta existe', () => {
    expect(readdirSync(MIGRACIONES)).toContain('20260827000000_portal_baja_renta.sql')
  })

  it('portal_baja_renta está DECLARADA en una colección del harness, no solo filtrada', () => {
    // El bug anterior: `portal_baja_renta` solo aparecía en un `.filter()` que
    // no encontraba nada, así que generaba CERO pruebas — cobertura aparente.
    expect(HARNESS).toMatch(/name:\s*'portal_baja_renta'/)
  })

  it('toda RPC portal_* del esquema está nombrada en el harness', () => {
    const ausentes = [...rpcsEnMigraciones].filter(
      (nombre) => !new RegExp(`name:\\s*'${nombre}'`).test(HARNESS),
    )
    expect(ausentes, `RPCs portal_* sin prueba en el harness: ${ausentes.join(', ')}`).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Contrato de HONESTIDAD: qué demuestra la prueba de cada RPC.
// ════════════════════════════════════════════════════════════════════════════
// Un rechazo puede venir de tres sitios distintos y sólo UNO prueba aislamiento
// entre tenants: el privilegio de ejecución, el rol del llamante, o la
// comparación de empresa. La clasificación se DERIVA del esquema y se contrasta
// con lo declarado — pero con dos cautelas que antes no estaban:
//
//   · La lectura del esquema se hace con `../sqlFunciones`, que acota el cuerpo
//     por firma exacta y por su propio dollar-quote. La versión anterior leía
//     118 KB de migraciones ajenas para `conta_cierre_anual(int)` y concluía
//     `tenant` por texto que no era suyo.
//   · Que el cuerpo mencione `get_my_company_id()` NO se acepta como prueba
//     suficiente: además se exige que el manifiesto declare la evidencia
//     dinámica correspondiente a esa garantía, porque una comparación de
//     empresa que ninguna prueba ejercita no demuestra nada.
const MIGRACIONES_PARSEADAS = parsearFunciones(
  readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ archivo: f, sql: readFileSync(join(MIGRACIONES, f), 'utf8') })),
)

const SQL_TODO = readdirSync(MIGRACIONES)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRACIONES, f), 'utf8'))
  .join('\n')

/** Definiciones vigentes de una RPC, una por firma. */
function definicionesDe(nombre: string) {
  return firmasDe(MIGRACIONES_PARSEADAS, nombre)
    .map((firma) => definicionVigente(MIGRACIONES_PARSEADAS, nombre, firma)!)
    .filter(Boolean)
}

describe('el parser de funciones acota por firma y por delimitador', () => {
  it('conta_cierre_anual tiene DOS sobrecargas y se distinguen', () => {
    expect(firmasDe(MIGRACIONES_PARSEADAS, 'conta_cierre_anual').sort()).toEqual(['int', 'int, uuid'])
  })

  it('el wrapper (int) termina donde debe y NO arrastra migraciones siguientes', () => {
    // El fallo medido: cierre real del `$$` en la posición 162, `$fn$;` elegido
    // en la 118150, "cuerpo" de 118150 caracteres con get_my_company_id() de
    // otra migración. El wrapper real son tres líneas.
    const wrapper = definicionVigente(MIGRACIONES_PARSEADAS, 'conta_cierre_anual', 'int')!
    expect(wrapper.delimitador).toBe('$$')
    expect(wrapper.cuerpo.length).toBeLessThan(200)
    expect(wrapper.cuerpo).toContain('SELECT public.conta_cierre_anual(p_anio, NULL)')
    expect(wrapper.cuerpo).not.toContain('get_my_company_id()')
    // Nada de otras migraciones: ni CREATE, ni POLICY, ni GRANT.
    expect(wrapper.cuerpo).not.toMatch(/CREATE\s+(OR REPLACE\s+)?FUNCTION/i)
    expect(wrapper.cuerpo).not.toMatch(/CREATE\s+POLICY/i)
  })

  it('la sobrecarga (int, uuid) sí trae su implementación completa', () => {
    const impl = definicionVigente(MIGRACIONES_PARSEADAS, 'conta_cierre_anual', 'int, uuid')!
    expect(impl.cuerpo).toContain('get_my_company_id()')
    expect(impl.cuerpo).toContain('INSERT INTO public.conta_asientos')
    expect(impl.cuerpo.length).toBeGreaterThan(1000)
  })

  it('un `$fn$;` posterior NO puede extender un cuerpo abierto con `$$`', () => {
    const sintetico = [
      'CREATE OR REPLACE FUNCTION public.f_corta(p_x int)',
      'RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;',
      '',
      'CREATE OR REPLACE FUNCTION public.f_larga(p_y uuid)',
      'RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN PERFORM get_my_company_id(); END $fn$;',
    ].join('\n')
    const defs = parsearFunciones([{ archivo: '0001_x.sql', sql: sintetico }])

    const corta = definicionVigente(defs, 'f_corta', 'int')!
    expect(corta.delimitador).toBe('$$')
    expect(corta.cuerpo.trim()).toBe('SELECT 1')
    expect(corta.cuerpo, 'no debe tragarse la función siguiente').not.toContain('get_my_company_id')
  })

  it('dos sobrecargas del mismo nombre con delimitadores distintos no se mezclan', () => {
    const sintetico = [
      'CREATE OR REPLACE FUNCTION public.dual(p_a int)',
      'RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;',
      'CREATE OR REPLACE FUNCTION public.dual(p_a int, p_b uuid)',
      'RETURNS int LANGUAGE plpgsql AS $body$ BEGIN RETURN 2; END $body$;',
    ].join('\n')
    const defs = parsearFunciones([{ archivo: '0001_x.sql', sql: sintetico }])

    expect(firmasDe(defs, 'dual')).toEqual(['int', 'int, uuid'])
    expect(definicionVigente(defs, 'dual', 'int')!.cuerpo.trim()).toBe('SELECT 1')
    expect(definicionVigente(defs, 'dual', 'int, uuid')!.delimitador).toBe('$body$')
    expect(definicionVigente(defs, 'dual', 'int, uuid')!.cuerpo).toContain('RETURN 2')
  })

  it('gana la definición CRONOLÓGICAMENTE última de esa firma exacta', () => {
    // Y el orden lo fija el nombre del archivo, no el del `readdir`.
    const defs = parsearFunciones([
      { archivo: '0002_despues.sql', sql: 'CREATE OR REPLACE FUNCTION public.v(p_a int) RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;' },
      { archivo: '0001_antes.sql', sql: 'CREATE OR REPLACE FUNCTION public.v(p_a int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;' },
    ])
    expect(definicionVigente(defs, 'v', 'int')!.cuerpo.trim()).toBe('SELECT 2')
    expect(definicionVigente(defs, 'v', 'int')!.archivo).toBe('0002_despues.sql')
  })

  it('los tipos con paréntesis no rompen la firma', () => {
    const defs = parsearFunciones([{
      archivo: '0001_x.sql',
      sql: 'CREATE FUNCTION public.p(p_monto numeric(14,2), p_txt varchar(50)) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;',
    }])
    expect(firmasDe(defs, 'p')).toEqual(['numeric(14,2), varchar(50)'])
  })

  it('los GRANT se comprueban por firma exacta, no por nombre', () => {
    const sql = [
      'GRANT EXECUTE ON FUNCTION public.g(int) TO authenticated;',
      'GRANT EXECUTE ON FUNCTION public.g(int, uuid) TO service_role;',
    ].join('\n')
    expect(concedidaA(sql, 'g', 'int', 'authenticated')).toBe(true)
    expect(concedidaA(sql, 'g', 'int, uuid', 'authenticated')).toBe(false)
    expect(concedidaA(sql, 'g', 'int, uuid', 'service_role')).toBe(true)
  })
})

describe('contrato de garantías — qué demuestra cada RPC', () => {
  it('todas las RPC obligatorias existen en las migraciones', () => {
    const sinDefinir = RPCS_OBLIGATORIAS
      .filter((r) => definicionesDe(r.nombre).length === 0)
      .map((r) => r.nombre)
    expect(sinDefinir, `RPC declaradas que no existen: ${sinDefinir.join(', ')}`).toEqual([])
  })

  it('las tres garantías con aislamiento o guard están representadas', () => {
    const cuenta = (g: string) => RPCS_OBLIGATORIAS.filter((r) => r.garantia === g).length
    expect(cuenta('tenant')).toBeGreaterThan(0)
    expect(cuenta('rol')).toBeGreaterThan(0)
    expect(cuenta('privilegio')).toBeGreaterThan(0)
  })

  it('las RPC de notificaciones NO se declaran aislamiento (sólo service_role)', () => {
    for (const nombre of ['enqueue_notification', 'claim_notifications_batch', 'mark_notification_result']) {
      const r = RPCS_OBLIGATORIAS.find((x) => x.nombre === nombre)
      expect(r?.garantia, `${nombre} no puede declararse garantía de tenant`).toBe('privilegio')
      for (const d of definicionesDe(nombre)) {
        expect(concedidaA(SQL_TODO, nombre, d.firma, 'authenticated')).toBe(false)
      }
    }
  })

  it('las portal_* de escritura del propietario son garantía de ROL', () => {
    for (const nombre of [
      'portal_registrar_inquilino', 'portal_quitar_inquilino',
      'portal_registrar_familiar', 'portal_quitar_familiar', 'portal_baja_renta',
    ]) {
      expect(RPCS_OBLIGATORIAS.find((x) => x.nombre === nombre)?.garantia).toBe('rol')
      const cuerpos = definicionesDe(nombre).map((d) => d.cuerpo).join('\n')
      expect(cuerpos).toMatch(/current_user_role\(\)\s*<>\s*'cliente'/)
    }
  })

  it('las reservas del portal sí llegan a TENANT: tienen rama de staff', () => {
    for (const nombre of ['portal_reservar_amenidad', 'portal_cancelar_reserva']) {
      expect(RPCS_OBLIGATORIAS.find((x) => x.nombre === nombre)?.garantia).toBe('tenant')
      const cuerpos = definicionesDe(nombre).map((d) => d.cuerpo).join('\n')
      expect(cuerpos).toContain('get_my_company_id()')
    }
  })

  it('conta_cierre_anual NO se declara tenant: el esquema no lo sostiene', () => {
    // (int) es un wrapper que no comprueba nada; (int, uuid) deriva la empresa
    // de get_my_company_id() pero acepta p_project_id SIN validar que sea del
    // tenant del llamante, y además es destructiva.
    const r = RPCS_OBLIGATORIAS.find((x) => x.nombre === 'conta_cierre_anual')!
    expect(r.garantia).toBe('estructural')
    expect(r.evidencias).toEqual(['anon'])

    const wrapper = definicionVigente(MIGRACIONES_PARSEADAS, 'conta_cierre_anual', 'int')!
    expect(wrapper.cuerpo).not.toContain('get_my_company_id()')

    const impl = definicionVigente(MIGRACIONES_PARSEADAS, 'conta_cierre_anual', 'int, uuid')!
    expect(impl.cuerpo).toContain('get_my_company_id()')
    // La prueba de que NO valida el proyecto contra la empresa: p_project_id se
    // usa tal cual, nunca comparado con company_id.
    expect(impl.cuerpo).not.toMatch(/p_project_id[^\n]*company_id\s*=/)
    expect(impl.cuerpo).toContain('INSERT INTO public.conta_asientos')
  })

  it('mencionar get_my_company_id() NO basta: hace falta la evidencia dinámica', () => {
    // El corazón de la corrección. Un cuerpo puede comparar empresas y aun así
    // no demostrar nada si ninguna prueba lo ejercita. Por eso toda RPC que
    // declare `tenant` tiene que exigir además la evidencia cross-tenant.
    for (const r of RPCS_OBLIGATORIAS.filter((x) => x.garantia === 'tenant')) {
      const cuerpos = definicionesDe(r.nombre).map((d) => d.cuerpo).join('\n')
      expect(cuerpos, `${r.nombre} declara tenant sin comparar empresas`).toContain('get_my_company_id()')
      expect(r.evidencias, `${r.nombre} declara tenant sin evidencia cross-tenant`)
        .toContain('authenticated-cross-tenant')
    }
  })

  it('conta_cierre_anual compara empresas y aun así NO es tenant', () => {
    // El caso que demuestra que la implicación no vale al revés: su cuerpo sí
    // menciona get_my_company_id(), pero el harness no ejecuta ninguna prueba
    // autenticada, así que no se declara aislamiento.
    const impl = definicionVigente(MIGRACIONES_PARSEADAS, 'conta_cierre_anual', 'int, uuid')!
    expect(impl.cuerpo).toContain('get_my_company_id()')
    expect(RPCS_OBLIGATORIAS.find((x) => x.nombre === 'conta_cierre_anual')!.garantia).not.toBe('tenant')
  })

  it('los motivos están escritos y dicen qué faltaría para subir de garantía', () => {
    expect(MOTIVO_RPC_ROL).toContain('cliente')
    expect(MOTIVO_RPC_ROL).toContain('unidad_residentes')
    expect(MOTIVO_RPC_PRIVILEGIO).toContain('service_role')
  })

  it('el harness declara la garantía en el nombre de cada describe de RPC', () => {
    const esperado: Array<[string, string]> = [
      ['self-service de inquilinos', 'garantía de ROL'],
      ['accesos familiares', 'garantía de ROL'],
      ['baja de renta', 'garantía de ROL'],
      ['reservas del portal', 'garantía de TENANT'],
      ['ERP financiero', 'garantía de TENANT'],
      ['estatus de bóvedas', 'garantía de TENANT'],
      ['notificaciones', 'garantía de PRIVILEGIO'],
    ]
    for (const [bloque, marca] of esperado) {
      const linea = HARNESS.split('\n').find((l) => l.includes("describe('guard RPCs") && l.includes(bloque))
      expect(linea, `no se encontró el describe de ${bloque}`).toBeTruthy()
      expect(linea, `${bloque} debe declarar su garantía en el nombre`).toContain(marca)
    }
  })
})
