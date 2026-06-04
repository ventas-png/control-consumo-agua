// Cobros pluggable — SandboxPaymentProvider: cobro SIMULADO y DETERMINISTA.
//
// NO llama a ningún payfac real ni hace HTTP. Genera una referencia/autorización
// derivadas determinísticamente del contenido del cobro (mismo cobro → misma
// referencia), para que dev/test sea reproducible. Es el provider por defecto que
// devuelve getPaymentProvider() mientras no haya un payfac real configurado.
// Espeja SandboxProvider de fiscal.

import type { PaymentProvider } from './provider.ts'
import type { CobroCanonico, ResultadoCobro } from './types.ts'

/** Hash determinista FNV-1a (32-bit). Puro, sin deps. NO criptográfico. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Hex de longitud fija (rellena con ceros a la izquierda). */
function hex(n: number, len: number): string {
  return (n >>> 0).toString(16).padStart(len, '0').slice(0, len)
}

/** Referencia determinista a partir del cobro. */
function referenciaDeterminista(cobro: CobroCanonico): string {
  const base = JSON.stringify({
    m: cobro.monto,
    c: cobro.moneda,
    r: cobro.referenciaInterna ?? '',
    d: cobro.descripcion,
  })
  return 'SBX-' + hex(fnv1a('ref:' + base), 8).toUpperCase() + hex(fnv1a('ref2:' + base), 8).toUpperCase()
}

export class SandboxPaymentProvider implements PaymentProvider {
  readonly nombre = 'sandbox'

  // deno-lint-ignore require-await
  async crearCobro(cobro: CobroCanonico): Promise<ResultadoCobro> {
    const referencia = referenciaDeterminista(cobro)
    return {
      ok: true,
      // El sandbox aprueba siempre (cobro simulado, sin valor real).
      estado: 'aprobado',
      referencia,
      autorizacion: hex(fnv1a('auth:' + referencia), 6).toUpperCase(),
      raw: {
        sandbox: true,
        nota: 'Cobro SIMULADO — sin valor real. Reemplazar por un payfac real (elegir y conectar).',
        monto: cobro.monto,
        moneda: cobro.moneda,
      },
    }
  }

  // deno-lint-ignore require-await
  async consultarEstado(referencia: string): Promise<ResultadoCobro> {
    // `ping:` → prueba de conexión (siempre ok en sandbox).
    if (referencia.startsWith('ping:')) {
      return { ok: true, estado: 'aprobado', raw: { sandbox: true, ping: true } }
    }
    return { ok: true, estado: 'aprobado', referencia, raw: { sandbox: true, estado: 'aprobado' } }
  }

  // deno-lint-ignore require-await
  async reembolsar(referencia: string, monto?: number, motivo?: string): Promise<ResultadoCobro> {
    return {
      ok: true,
      estado: 'aprobado',
      referencia,
      raw: { sandbox: true, reembolsado: true, monto: monto ?? null, motivo: motivo ?? null },
    }
  }
}
