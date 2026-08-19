// ════════════════════════════════════════════════════════════════════════════
// Pruebas de las salvaguardas de destino del seed del sandbox RLS.
//
// El script usa la service_role (BYPASSRLS: lee y escribe CUALQUIER tenant) y
// crea empresas y usuarios. Apuntarlo al proyecto equivocado no es un fallo de
// CI, es contaminar datos de un cliente. La lista negra del ref de producción
// no basta por sí sola: protege contra UN proyecto conocido y deja pasar
// cualquier otro. De ahí la exigencia de declarar SEED_EXPECTED_REF.
//
// Importar el módulo NO siembra nada (main() está gateado a ejecución directa).
// ════════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest'
import { refDeUrl, validarUrlSandbox } from '../seed-rls-sandbox.mjs'

const COBERTURA = {
  dominiosSandboxPermitidos: ['supabase.co', 'supabase.in'],
  refProduccionProhibido: 'nnsqmeigtgewatameexo',
}

const SANDBOX = 'https://abcdefghijklmnop.supabase.co'
const REF_SANDBOX = 'abcdefghijklmnop'

describe('refDeUrl', () => {
  it('extrae ref y dominio', () => {
    expect(refDeUrl(SANDBOX)).toEqual({ ref: REF_SANDBOX, dominio: 'supabase.co' })
  })

  it('tolera la barra final', () => {
    expect(refDeUrl(`${SANDBOX}/`)?.ref).toBe(REF_SANDBOX)
  })

  it('rechaza lo que no tiene forma de URL de proyecto', () => {
    expect(refDeUrl('')).toBeNull()
    expect(refDeUrl('supabase.co')).toBeNull()
    expect(refDeUrl('http://abc.supabase.co')).toBeNull()   // sin https
    expect(refDeUrl('https://abc.supabase.co/rest/v1')).toBeNull()
  })
})

describe('validarUrlSandbox — camino feliz', () => {
  it('acepta un sandbox declarado que coincide con la URL', () => {
    const r = validarUrlSandbox(SANDBOX, REF_SANDBOX, COBERTURA)
    expect(r).toEqual({ ok: true, ref: REF_SANDBOX })
  })
})

describe('validarUrlSandbox — producción', () => {
  it('rechaza el ref de producción aunque se declare a propósito', () => {
    const prod = `https://${COBERTURA.refProduccionProhibido}.supabase.co`
    const r = validarUrlSandbox(prod, COBERTURA.refProduccionProhibido, COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('PRODUCCIÓN')
  })
})

describe('validarUrlSandbox — dominio no reconocido', () => {
  it('rechaza un host que no es Supabase', () => {
    const r = validarUrlSandbox('https://abcdefghijklmnop.evil.example', REF_SANDBOX, COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('no está reconocido como Supabase')
  })

  it('acepta subdominios de un dominio permitido', () => {
    const r = validarUrlSandbox('https://abc.db.supabase.co', 'abc', COBERTURA)
    expect(r.ok).toBe(true)
  })

  it('rechaza una URL malformada', () => {
    const r = validarUrlSandbox('no-es-una-url', REF_SANDBOX, COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('no tiene la forma')
  })
})

describe('validarUrlSandbox — declaración obligatoria del destino', () => {
  it('rechaza si no se declaró SEED_EXPECTED_REF', () => {
    const r = validarUrlSandbox(SANDBOX, '', COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('SEED_EXPECTED_REF')
    // El mensaje sugiere el ref correcto para que arreglarlo sea trivial.
    expect(r.motivo).toContain(REF_SANDBOX)
  })

  it('rechaza si el ref declarado NO coincide con la URL', () => {
    const r = validarUrlSandbox(SANDBOX, 'otro-sandbox-distinto', COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('NO coincide')
  })

  it('el descuido típico: URL de otro proyecto con el ref del sandbox declarado', () => {
    // Copiar-pegar la URL equivocada teniendo el ref correcto declarado es
    // exactamente el accidente que este cerrojo evita.
    const r = validarUrlSandbox('https://proyecto-de-un-cliente.supabase.co', REF_SANDBOX, COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('NO coincide')
  })
})

describe('validarUrlSandbox — contra el manifiesto REAL', () => {
  it('el coverage.json del repo prohíbe el ref de producción y lista dominios', async () => {
    const { cargarCobertura } = await import('../assert-rls-ejecutado.mjs')
    const real = cargarCobertura()
    expect(real.refProduccionProhibido).toBeTruthy()
    expect(real.dominiosSandboxPermitidos.length).toBeGreaterThan(0)

    const prod = `https://${real.refProduccionProhibido}.supabase.co`
    expect(validarUrlSandbox(prod, real.refProduccionProhibido, real).ok).toBe(false)
  })
})
