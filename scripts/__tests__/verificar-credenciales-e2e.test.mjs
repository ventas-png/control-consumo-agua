// ════════════════════════════════════════════════════════════════════════════
// Contrato del verificador de credenciales E2E.
// ════════════════════════════════════════════════════════════════════════════
// Existe porque el run 32753812314 tardó quince minutos en decir, con trece
// timeouts de Playwright, algo que Supabase contesta en dos segundos:
// "Invalid login credentials". Lo que se prueba aquí es que el veredicto sea
// ACCIONABLE (qué variable, qué hacer) y que ninguna contraseña se imprima.
import { describe, expect, it } from 'vitest'

import { PAREJAS, faltantes, interpretar, main, refDeUrl } from '../verificar-credenciales-e2e.mjs'

const CLAVE = 'contrasena-jamas-impresa-4d1f'
const COMPLETO = {
  VITE_SUPABASE_URL: 'https://sandboxref.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  E2E_LOGIN_EMAIL: 'principal@sandbox.invalid',
  E2E_LOGIN_PASSWORD: CLAVE,
  E2E_RESTRICTED_EMAIL: 'restringido@sandbox.invalid',
  E2E_RESTRICTED_PASSWORD: CLAVE,
}

const respuesta = (status, cuerpo) => ({ status, json: async () => cuerpo })
const OK = respuesta(200, { access_token: 'jwt' })
const INVALIDAS = respuesta(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' })

/** Recoge todo lo que el script escribió, por cualquiera de sus dos salidas. */
function corrida(env, fetchImpl) {
  const lineas = []
  const registrar = (...xs) => lineas.push(xs.join(' '))
  return { lineas, ejecutar: () => main(env, fetchImpl, registrar, registrar) }
}

describe('cubre exactamente las cuatro credenciales que el preflight exige', () => {
  it('las dos parejas son la principal y la restringida', () => {
    expect(PAREJAS.map((p) => [p.email, p.password])).toEqual([
      ['E2E_LOGIN_EMAIL', 'E2E_LOGIN_PASSWORD'],
      ['E2E_RESTRICTED_EMAIL', 'E2E_RESTRICTED_PASSWORD'],
    ])
  })

  it('sin una variable no intenta nada y la nombra', async () => {
    for (const variable of Object.keys(COMPLETO)) {
      const env = { ...COMPLETO }
      delete env[variable]
      expect(faltantes(env)).toContain(variable)
      const { lineas, ejecutar } = corrida(env, () => {
        throw new Error('no debía llamar a Supabase')
      })
      expect(await ejecutar()).toBe(1)
      expect(lineas.join('\n')).toContain(variable)
    }
  })
})

describe('el veredicto es accionable, no un volcado de HTTP', () => {
  it('200 con access_token es el único verde', () => {
    expect(interpretar(200, { access_token: 'jwt' }).ok).toBe(true)
    // Un 200 SIN token no puede colarse como éxito.
    expect(interpretar(200, {}).ok).toBe(false)
  })

  it('invalid_credentials explica la rotación del seed, que es la causa real', () => {
    const r = interpretar(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('seed-rls-sandbox.mjs')
    expect(r.motivo).toMatch(/rota/)
    expect(r.motivo).toContain('RLS_')
  })

  it('el mismo diagnóstico si Supabase sólo manda el texto, sin error_code', () => {
    expect(interpretar(400, { msg: 'Invalid login credentials' }).motivo).toContain('seed-rls-sandbox.mjs')
  })

  it('email sin confirmar se distingue de contraseña incorrecta', () => {
    const r = interpretar(400, { error_code: 'email_not_confirmed' })
    expect(r.motivo).toMatch(/SIN confirmar/)
    expect(r.motivo).not.toContain('seed-rls-sandbox.mjs')
  })

  it('401/403 CON error de Supabase apunta a la ANON key, no a las credenciales', () => {
    for (const status of [401, 403]) {
      const r = interpretar(status, { message: 'Invalid API key' })
      expect(r.ok).toBe(false)
      expect(r.motivo).toMatch(/ANON key/)
    }
  })

  it('401/403 SIN cuerpo de Supabase se atribuye a la red, no a la anon key', () => {
    // Un proxy que contesta 403 al CONNECT llega como un 403 pelado. Culpar a
    // la anon key ahí manda a cambiar lo que está bien.
    for (const status of [401, 403]) {
      const r = interpretar(status, null)
      expect(r.ok).toBe(false)
      expect(r.motivo).toMatch(/proxy, firewall o VPN/)
      expect(r.motivo).not.toMatch(/ANON key/)
      expect(r.motivo).toMatch(/auth\/v1\/health/)
    }
  })

  it('429 se nombra como límite de intentos, no como credencial mala', () => {
    expect(interpretar(429, {}).motivo).toMatch(/limitando/)
  })

  it('un status desconocido no se traga: sale con su código', () => {
    expect(interpretar(500, null).motivo).toContain('HTTP 500')
  })
})

describe('la contraseña no se imprime NUNCA', () => {
  it('ni cuando las dos fallan, ni cuando las dos sirven', async () => {
    for (const r of [INVALIDAS, OK]) {
      const { lineas, ejecutar } = corrida(COMPLETO, async () => r)
      await ejecutar()
      const texto = lineas.join('\n')
      expect(texto).not.toContain(CLAVE)
      // El NOMBRE de la variable sí, para poder corregirla.
      if (r === INVALIDAS) expect(texto).toContain('E2E_LOGIN_PASSWORD')
    }
  })

  it('el email sí se imprime: sin él no se sabe cuál de las dos cuentas falla', async () => {
    const { lineas, ejecutar } = corrida(COMPLETO, async () => INVALIDAS)
    await ejecutar()
    expect(lineas.join('\n')).toContain('restringido@sandbox.invalid')
  })
})

describe('salida y cobertura de las dos parejas', () => {
  it('las dos correctas → 0, y avisa de lo que NO comprueba', async () => {
    const { lineas, ejecutar } = corrida(COMPLETO, async () => OK)
    expect(await ejecutar()).toBe(0)
    expect(lineas.join('\n')).toMatch(/MISMA empresa/)
  })

  it('una sola mala ya devuelve 1, y prueba AMBAS (no corta en la primera)', async () => {
    const vistos = []
    const f = async (_u, init) => {
      const { email } = JSON.parse(init.body)
      vistos.push(email)
      return email === COMPLETO.E2E_LOGIN_EMAIL ? OK : INVALIDAS
    }
    const { lineas, ejecutar } = corrida(COMPLETO, f)
    expect(await ejecutar()).toBe(1)
    expect(vistos).toEqual([COMPLETO.E2E_LOGIN_EMAIL, COMPLETO.E2E_RESTRICTED_EMAIL])
    expect(lineas.join('\n')).toContain('1 de 2 pares NO sirven')
  })

  it('usa la ANON key como apikey y va al endpoint de password grant', async () => {
    let peticion = null
    await corrida(COMPLETO, async (u, init) => {
      peticion = { url: String(u), init }
      return OK
    }).ejecutar()
    expect(peticion.url).toBe('https://sandboxref.supabase.co/auth/v1/token?grant_type=password')
    expect(peticion.init.headers.apikey).toBe('anon-key')
    expect(peticion.init.method).toBe('POST')
  })

  it('un fallo de transporte no se confunde con credenciales malas', async () => {
    const roto = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    const { lineas, ejecutar } = corrida(COMPLETO, async () => {
      throw roto
    })
    expect(await ejecutar()).toBe(1)
    const texto = lineas.join('\n')
    expect(texto).toContain('ENOTFOUND')
    expect(texto).not.toContain('seed-rls-sandbox.mjs')
  })
})

describe('el ref declarado y la URL no pueden divergir en silencio', () => {
  it('refDeUrl saca el ref del hostname', () => {
    expect(refDeUrl('https://sandboxref.supabase.co')).toBe('sandboxref')
    expect(refDeUrl('https://ejemplo.com')).toBeNull()
    expect(refDeUrl('no-es-url')).toBeNull()
  })

  it('avisa cuando E2E_EXPECTED_SUPABASE_REF no coincide con la URL', async () => {
    const { lineas, ejecutar } = corrida({ ...COMPLETO, E2E_EXPECTED_SUPABASE_REF: 'otro' }, async () => OK)
    await ejecutar()
    const texto = lineas.join('\n')
    expect(texto).toContain('otro')
    expect(texto).toContain('sandboxref')
    expect(texto).toMatch(/preflight/)
  })

  it('coincidiendo, no molesta', async () => {
    const { lineas, ejecutar } = corrida({ ...COMPLETO, E2E_EXPECTED_SUPABASE_REF: 'sandboxref' }, async () => OK)
    await ejecutar()
    expect(lineas.join('\n')).not.toMatch(/⚠️/)
  })
})
