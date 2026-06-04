// serv:S11 — SandboxProvider: timbrado SIMULADO y DETERMINISTA para dev/test.
//
// NO llama a ningún PAC real ni hace HTTP. Genera un UUID/sello/serie/número
// derivados determinísticamente del contenido del DTE (mismo DTE → mismo UUID),
// para que dev/test sea reproducible. Es el provider por defecto que devuelve
// getFiscalProvider() mientras no haya un certificador real configurado.

import type { FiscalProvider } from './provider.ts'
import type { DteCanonico, ResultadoTimbrado } from './types.ts'

/**
 * Hash determinista FNV-1a (32-bit) de un string. Puro, sin deps. Suficiente
 * para derivar identificadores reproducibles en el sandbox (NO criptográfico).
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // multiplicación FNV en aritmética de 32 bits sin desbordar.
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Hex de longitud fija (rellena con ceros a la izquierda). */
function hex(n: number, len: number): string {
  return (n >>> 0).toString(16).padStart(len, '0').slice(0, len)
}

/**
 * Construye un UUID v4-like determinista a partir del DTE. Variante y versión
 * fijadas en las posiciones canónicas para que "parezca" un UUID real.
 */
function uuidDeterminista(dte: DteCanonico): string {
  const base = JSON.stringify({
    r: dte.regimen,
    t: dte.tipo,
    m: dte.moneda,
    f: dte.fechaEmision,
    e: dte.emisor,
    rc: dte.receptor,
    tot: dte.total,
    reg: dte.registroId,
  })
  // Cuatro hashes con sal distinta para llenar los 128 bits.
  const a = fnv1a('a:' + base)
  const b = fnv1a('b:' + base)
  const c = fnv1a('c:' + base)
  const d = fnv1a('d:' + base)
  const p1 = hex(a, 8)
  const p2 = hex(b >>> 16, 4)
  const p3 = '4' + hex(b, 3) // versión 4
  const variant = (8 + (c & 0x3)).toString(16) // 8,9,a,b
  const p4 = variant + hex(c, 3)
  const p5 = hex(c, 4) + hex(d, 8)
  return `${p1}-${p2}-${p3}-${p4}-${p5}`.toUpperCase()
}

export class SandboxProvider implements FiscalProvider {
  readonly nombre = 'sandbox'

  // deno-lint-ignore require-await
  async timbrar(dte: DteCanonico): Promise<ResultadoTimbrado> {
    const uuid = uuidDeterminista(dte)
    // Serie/número simulados, también deterministas y legibles.
    const serie = dte.regimen === 'fel_gt' ? 'FEL-SANDBOX' : 'CFDI-SANDBOX'
    const numero = String((fnv1a('num:' + uuid) % 900000) + 100000) // 6 dígitos
    return {
      ok: true,
      uuidFiscal: uuid,
      serie,
      numero,
      // En GT el nº de autorización es el UUID; aquí lo replicamos.
      numeroAutorizacion: uuid,
      fechaCertificacion: dte.fechaEmision,
      raw: {
        sandbox: true,
        nota: 'Timbrado SIMULADO — sin valor fiscal. Reemplazar por un PAC real (follow-up).',
        regimen: dte.regimen,
        sello: hex(fnv1a('sello:' + uuid), 8),
      },
    }
  }

  // deno-lint-ignore require-await
  async cancelar(uuidFiscal: string, motivo?: string): Promise<ResultadoTimbrado> {
    return {
      ok: true,
      uuidFiscal,
      raw: { sandbox: true, cancelado: true, motivo: motivo ?? null },
    }
  }

  // deno-lint-ignore require-await
  async consultarEstado(uuidFiscal: string): Promise<ResultadoTimbrado> {
    return {
      ok: true,
      uuidFiscal,
      raw: { sandbox: true, estado: 'vigente' },
    }
  }
}
