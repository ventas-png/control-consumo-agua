// Contabilidad — qué cuentas del catálogo se pueden borrar (lógica pura).
//
// Borrar una cuenta es seguro solo si nada la referencia. La autoridad es la
// BD (FK con ON DELETE RESTRICT + el trigger que protege las del seed), pero el
// borrado por selección necesita saberlo ANTES: en un lote, una sola cuenta con
// movimientos aborta la transacción entera y no se borra ninguna.
//
// Este módulo cruza las cuentas elegidas con el resultado de la RPC
// `conta_cuentas_en_uso` y parte la selección en dos: las que se borran y las
// que no, cada una con su motivo en el idioma del usuario.
import type { CuentaEnUso } from './mutations'

/** Lo mínimo que se necesita de una cuenta para decidir y para el mensaje. */
export interface CuentaCandidata {
  id: string
  codigo: string
  nombre: string
  es_sistema: boolean
}

export interface CuentaBloqueada {
  cuenta: CuentaCandidata
  motivos: string[]
}

export interface PlanBorradoCuentas {
  borrables: CuentaCandidata[]
  bloqueadas: CuentaBloqueada[]
}

/**
 * Tabla que referencia → por qué le importa al usuario. Lo que no esté aquí se
 * describe con el nombre crudo: la RPC descubre las FK sola, así que una tabla
 * nueva aparece antes de que este mapa la conozca, y es preferible un mensaje
 * feo a uno que se calle.
 */
export const MOTIVO_POR_REFERENCIA: Record<string, string> = {
  conta_cuentas: 'tiene cuentas hijas',
  conta_asiento_lineas: 'tiene movimientos en pólizas',
  conta_mapeo_cuentas: 'está asignada a un evento en Configuración',
  presupuesto_partidas: 'está presupuestada',
  cuentas_bancarias: 'está ligada a una cuenta bancaria',
  orden_compra_lineas: 'se usa en órdenes de compra',
  factura_proveedor_lineas: 'se usa en facturas de proveedor',
}

/** Texto del motivo, con el conteo cuando aporta ("3 movimientos en pólizas"). */
export function describirUso(uso: CuentaEnUso): string {
  const base = MOTIVO_POR_REFERENCIA[uso.referencia]
  if (!base) return `la referencia ${uso.referencia} (${uso.usos})`
  return uso.usos > 1 ? `${base} (${uso.usos})` : base
}

/**
 * Parte la selección en borrables y bloqueadas.
 *
 * `enUso` son las filas de `conta_cuentas_en_uso` para esas mismas cuentas; si
 * viene vacío es que ninguna está referenciada (no que no se haya consultado —
 * eso lo decide el caller antes de llamar aquí).
 */
export function planificarBorradoCuentas(
  candidatas: CuentaCandidata[],
  enUso: CuentaEnUso[],
): PlanBorradoCuentas {
  const usosPorCuenta = new Map<string, CuentaEnUso[]>()
  for (const uso of enUso) {
    const previos = usosPorCuenta.get(uso.cuenta_id)
    if (previos) previos.push(uso)
    else usosPorCuenta.set(uso.cuenta_id, [uso])
  }

  const borrables: CuentaCandidata[] = []
  const bloqueadas: CuentaBloqueada[] = []

  for (const cuenta of candidatas) {
    const motivos: string[] = []
    if (cuenta.es_sistema) {
      motivos.push('viene del catálogo base: desactívala en vez de borrarla')
    }
    for (const uso of usosPorCuenta.get(cuenta.id) ?? []) {
      motivos.push(describirUso(uso))
    }
    if (motivos.length > 0) bloqueadas.push({ cuenta, motivos })
    else borrables.push(cuenta)
  }

  return { borrables, bloqueadas }
}

/** Resumen legible de las bloqueadas, para el diálogo y el aviso. */
export function resumirBloqueadas(bloqueadas: CuentaBloqueada[], maximo = 5): string {
  const muestra = bloqueadas
    .slice(0, maximo)
    .map((b) => `${b.cuenta.codigo} ${b.cuenta.nombre} — ${b.motivos.join(', ')}`)
    .join('\n')
  const resto = bloqueadas.length - maximo
  return resto > 0 ? `${muestra}\n…y ${resto} más` : muestra
}
