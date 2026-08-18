import cobertura from './coverage.json'

// ════════════════════════════════════════════════════════════════════════════
// Cobertura del harness RLS — tipado sobre `./coverage.json`.
// ════════════════════════════════════════════════════════════════════════════
// El JSON es la fuente única: lo lee también `scripts/seed-rls-sandbox.mjs`
// (Node puro, sin build), así que seed y harness no pueden desincronizarse.
//
// POR QUÉ EXISTE LA SEPARACIÓN
// La aserción de aislamiento es, en esencia:
//
//     for (const co of companyIdsDeB) expect(companyIdsDeA.has(co)).toBe(false)
//
// Con ambos conjuntos vacíos el bucle no itera y el test pasa SIN COMPARAR
// NADA. Declarar una tabla en `noTriviales` afirma «hay filas de las dos
// empresas y el aislamiento quedó demostrado». Declararla en `estructurales`
// afirma algo mucho más débil y honesto: «la policy responde y no hay fuga
// observable, pero la tabla puede estar vacía, así que su disjunción NO prueba
// aislamiento».

/**
 * Tablas tenant-scoped con cobertura REAL: el seed garantiza ≥1 fila de A y ≥1
 * de B, así que la disjunción compara conjuntos no vacíos.
 */
export const TENANT_SCOPED_NO_TRIVIALES: readonly string[] = cobertura.noTriviales

/**
 * Tablas tenant-scoped con cobertura ESTRUCTURAL: se consultan y se comprueba
 * que no hay fuga, pero pueden estar vacías. Su disjunción NO demuestra
 * aislamiento y no debe declararse como tal en ningún informe.
 */
export const TENANT_SCOPED_ESTRUCTURALES: readonly string[] = cobertura.estructurales

/** Todas las tablas tenant-scoped que el harness inspecciona. */
export const TENANT_SCOPED_TABLES: readonly string[] = [
  ...TENANT_SCOPED_NO_TRIVIALES,
  ...TENANT_SCOPED_ESTRUCTURALES,
]
