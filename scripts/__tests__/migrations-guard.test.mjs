// ════════════════════════════════════════════════════════════════════════════
// Pruebas de la regla (e) de migrations-guard: ACL de funciones SECURITY
// DEFINER modelada POR FIRMA, con overloads independientes y re-exposición por
// GRANT posteriores. Nacen de dos falsos negativos de la primera versión:
//   1. la ACL se indexaba por NOMBRE: un REVOKE sobre foo(uuid) "protegía"
//      también foo(text), y un DROP de un overload borraba el estado de todos;
//   2. no se procesaban GRANT: tras REVOKE ... FROM PUBLIC, un GRANT ... TO
//      PUBLIC o TO anon re-exponía la función sin que el guard lo viera.
//
// Se prueban los helpers exportados con SQL sintético — sin tocar las
// migraciones reales del repo ni disparar main() (gateado a módulo principal).
// vitest recoge este archivo por su patrón por defecto (**/*.test.mjs).
// ════════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest'
import {
  SECDEF_CUTOFF,
  applyAclEvents,
  evaluateSecdefRule,
  extractAclEvents,
  fnKey,
  normalizeArgs,
  stripComments,
} from '../migrations-guard.mjs'

// Replay de una o más "migraciones" sintéticas (en orden) y evaluación con el
// corte real. Cada entrada: [version, sql]. Devuelve las claves en violación.
function violaciones(migraciones, { allowSet } = {}) {
  const acl = new Map()
  for (const [version, sql] of migraciones) {
    applyAclEvents(acl, extractAclEvents(stripComments(sql)), {
      file: `${version}_test.sql`,
      version,
    })
  }
  return evaluateSecdefRule(acl, { cutoff: SECDEF_CUTOFF, allowSet }).map((v) => v.key)
}

const V = '20990101000000' // posterior al corte: sujeta a la regla

const SECDEF = (firma, cuerpo = 'SELECT true') =>
  `CREATE OR REPLACE FUNCTION public.${firma}
   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
   AS $$ ${cuerpo} $$;`

describe('normalizeArgs / fnKey — firma canónica', () => {
  it('iguala la grafía de CREATE (con nombres) y la de REVOKE (tipos pelados)', () => {
    expect(fnKey('f', 'p_movimiento_id uuid, p_referencia text, p_conciliado_por uuid')).toBe(
      fnKey('f', 'uuid, text, uuid'),
    )
  })
  it('normaliza alias de tipos que conviven en el repo (int/integer, varchar, bool)', () => {
    expect(normalizeArgs('p_n int')).toBe('integer')
    expect(normalizeArgs('varchar')).toBe('character varying')
    expect(normalizeArgs('p_ok bool')).toBe('boolean')
    expect(normalizeArgs('timestamptz')).toBe('timestamp with time zone')
  })
  it('tipos multi-palabra con y sin nombre de parámetro', () => {
    expect(normalizeArgs('p_x character varying')).toBe('character varying')
    expect(normalizeArgs('double precision')).toBe('double precision')
    expect(normalizeArgs('p_ts timestamp with time zone')).toBe('timestamp with time zone')
  })
  it('ignora typmods, DEFAULT, modo IN/VARIADIC y excluye OUT de la identidad', () => {
    expect(normalizeArgs('p_monto numeric(12,2)')).toBe('numeric')
    expect(normalizeArgs("p_a text DEFAULT 'x', p_b uuid")).toBe('text,uuid')
    expect(normalizeArgs('IN p_a uuid, OUT p_b text, VARIADIC p_c text[]')).toBe('uuid,text[]')
  })
  it('conserva arrays y distingue firmas distintas', () => {
    expect(normalizeArgs('p_ids uuid[]')).toBe('uuid[]')
    expect(fnKey('f', 'uuid')).not.toBe(fnKey('f', 'text'))
    expect(fnKey('f', 'uuid')).not.toBe(fnKey('f', 'uuid[]'))
  })
})

describe('regla (e) — overloads con ACL independiente', () => {
  it('1. dos overloads y REVOKE solo de uno: el otro viola', () => {
    const sql = `
      ${SECDEF('foo(p_id uuid)')}
      ${SECDEF('foo(p_nombre text)')}
      REVOKE EXECUTE ON FUNCTION public.foo(uuid) FROM PUBLIC, anon;`
    expect(violaciones([[V, sql]])).toEqual(['foo(text)'])
  })

  it('2. dos overloads correctamente revocados: pasa (grafías distintas de firma)', () => {
    const sql = `
      ${SECDEF('foo(p_id uuid)')}
      ${SECDEF('foo(p_nombre text)')}
      REVOKE EXECUTE ON FUNCTION public.foo(uuid) FROM PUBLIC, anon;
      REVOKE EXECUTE ON FUNCTION public.foo(p_nombre text) FROM PUBLIC, anon;`
    expect(violaciones([[V, sql]])).toEqual([])
  })

  it('8. DROP de un overload no elimina el estado del otro', () => {
    const sql = `
      ${SECDEF('foo(p_id uuid)')}
      ${SECDEF('foo(p_nombre text)')}
      REVOKE EXECUTE ON FUNCTION public.foo(text) FROM PUBLIC, anon;
      DROP FUNCTION public.foo(uuid);`
    // foo(uuid) dropeada (no viola por inexistente); foo(text) sigue revocada.
    expect(violaciones([[V, sql]])).toEqual([])
    // Y al revés: si la que queda viva era la abierta, sigue violando.
    const sql2 = `
      ${SECDEF('bar(p_id uuid)')}
      ${SECDEF('bar(p_nombre text)')}
      REVOKE EXECUTE ON FUNCTION public.bar(text) FROM PUBLIC, anon;
      DROP FUNCTION public.bar(text);`
    expect(violaciones([[V, sql2]])).toEqual(['bar(uuid)'])
  })
})

describe('regla (e) — GRANT posteriores re-exponen', () => {
  const base = `${SECDEF('g(p_id uuid)')}
    REVOKE EXECUTE ON FUNCTION public.g(uuid) FROM PUBLIC, anon;`

  it('3. REVOKE FROM PUBLIC + GRANT TO PUBLIC: viola', () => {
    const sql = `${base}
      GRANT EXECUTE ON FUNCTION public.g(uuid) TO PUBLIC;`
    expect(violaciones([[V, sql]])).toEqual(['g(uuid)'])
  })

  it('4. REVOKE FROM PUBLIC + GRANT TO anon: viola (grant directo, sin PUBLIC)', () => {
    const sql = `${base}
      GRANT EXECUTE ON FUNCTION public.g(uuid) TO anon;`
    expect(violaciones([[V, sql]])).toEqual(['g(uuid)'])
  })

  it('REVOKE ALL + GRANT ALL equivalente a PUBLIC: viola', () => {
    const sql = `${SECDEF('h(p_id uuid)')}
      REVOKE ALL ON FUNCTION public.h(uuid) FROM PUBLIC, anon, authenticated;
      GRANT ALL ON FUNCTION public.h(uuid) TO PUBLIC;`
    expect(violaciones([[V, sql]])).toEqual(['h(uuid)'])
  })

  it('5. REVOKE FROM PUBLIC + GRANT TO authenticated/service_role: pasa', () => {
    const sql = `${base}
      GRANT EXECUTE ON FUNCTION public.g(uuid) TO authenticated;
      GRANT EXECUTE ON FUNCTION public.g(uuid) TO service_role;`
    expect(violaciones([[V, sql]])).toEqual([])
  })

  it('el GRANT re-expone incluso en una migración POSTERIOR al REVOKE', () => {
    expect(
      violaciones([
        [V, base],
        ['20990102000000', 'GRANT EXECUTE ON FUNCTION public.g(uuid) TO anon;'],
      ]),
    ).toEqual(['g(uuid)'])
  })
})

describe('regla (e) — ciclo de vida de la encarnación', () => {
  it('6. CREATE OR REPLACE conserva la ACL (el REVOKE previo sobrevive)', () => {
    expect(
      violaciones([
        [
          V,
          `${SECDEF('f(p_id uuid)')}
           REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM PUBLIC, anon;`,
        ],
        ['20990102000000', SECDEF('f(p_id uuid)', 'SELECT false')],
      ]),
    ).toEqual([])
  })

  it('7. DROP + CREATE reinicia la ACL al grant implícito de PUBLIC', () => {
    expect(
      violaciones([
        [
          V,
          `${SECDEF('f(p_id uuid)')}
           REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM PUBLIC, anon;`,
        ],
        [
          '20990102000000',
          `DROP FUNCTION public.f(uuid);
           ${SECDEF('f(p_id uuid)')}`,
        ],
      ]),
    ).toEqual(['f(uuid)'])
  })

  it('el corte de retroactividad exime a las encarnaciones anteriores', () => {
    expect(violaciones([['20260101000000', SECDEF('legado(p_id uuid)')]])).toEqual([])
  })

  it('REVOKE FROM anon sin PUBLIC no cierra nada (la causa raíz del P1)', () => {
    const sql = `${SECDEF('mal(p_a text)')}
      GRANT EXECUTE ON FUNCTION public.mal(text) TO authenticated;
      REVOKE EXECUTE ON FUNCTION public.mal(text) FROM anon;`
    expect(violaciones([[V, sql]])).toEqual(['mal(text)'])
  })

  it('REVOKE sin paréntesis aplica a todos los overloads del nombre', () => {
    const sql = `
      ${SECDEF('multi(p_id uuid)')}
      ${SECDEF('multi(p_nombre text)')}
      REVOKE EXECUTE ON FUNCTION public.multi FROM PUBLIC, anon;`
    expect(violaciones([[V, sql]])).toEqual([])
  })
})

describe('regla (e) — barridos dinámicos DO/FOREACH', () => {
  it('9. barrido con firmas completas (con y sin prefijo public.): pasa', () => {
    const sql = `
      ${SECDEF('tg_a()')}
      ${SECDEF('rpc_b(p_id uuid)')}
      DO $$
      DECLARE fn text;
      BEGIN
        FOREACH fn IN ARRAY ARRAY['tg_a()', 'public.rpc_b(uuid)'] LOOP
          EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
        END LOOP;
      END $$;`
    expect(violaciones([[V, sql]])).toEqual([])
  })

  it('el barrido revoca solo las firmas listadas: el overload ausente viola', () => {
    const sql = `
      ${SECDEF('dup(p_id uuid)')}
      ${SECDEF('dup(p_nombre text)')}
      DO $$
      DECLARE fn text;
      BEGIN
        FOREACH fn IN ARRAY ARRAY['dup(uuid)'] LOOP
          EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', fn);
        END LOOP;
      END $$;`
    expect(violaciones([[V, sql]])).toEqual(['dup(text)'])
  })

  it('un barrido dinámico de GRANT a anon re-expone la firma', () => {
    const sql = `
      ${SECDEF('din(p_id uuid)')}
      REVOKE EXECUTE ON FUNCTION public.din(uuid) FROM PUBLIC, anon;
      DO $$
      DECLARE fn text;
      BEGIN
        FOREACH fn IN ARRAY ARRAY['din(uuid)'] LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon', fn);
        END LOOP;
      END $$;`
    expect(violaciones([[V, sql]])).toEqual(['din(uuid)'])
  })
})

describe('regla (e) — allowlist', () => {
  const sql = SECDEF('sso_nueva(p_dominio text)')

  it('10. una anon-callable intencional viola sin excepción…', () => {
    expect(violaciones([[V, sql]])).toEqual(['sso_nueva(text)'])
  })

  it('…y pasa con la firma completa en el allowlist (recomendado)', () => {
    expect(violaciones([[V, sql]], { allowSet: new Set(['sso_nueva(text)']) })).toEqual([])
  })

  it('…o con el nombre pelado (compatibilidad con el formato original)', () => {
    expect(violaciones([[V, sql]], { allowSet: new Set(['sso_nueva']) })).toEqual([])
  })
})
