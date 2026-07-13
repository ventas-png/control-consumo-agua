// Cobros pluggable — credenciales EFECTIVAS del payfac (herencia locación→empresa).
//
// La bóveda `payfac_secrets` guarda UNA fila por locación y UNA por empresa
// (project_id NULL). La config de pago EFECTIVA ya hereda (resolverConfigPago):
//     proveedor = locacion.proveedorPago ?? empresa.proveedorPago
// Las credenciales deben heredar con el MISMO criterio: si la fila de la
// locación no aporta credenciales del ambiente pedido, aplican las de la
// empresa. Sin esta herencia, un cobro de un proyecto cuya empresa conectó las
// credenciales UNA vez a nivel empresa (el caso típico) buscaba SOLO la fila
// exacta del proyecto, no encontraba nada y el payfac configurado respondía
// "Faltan credenciales…" — como si el tenant nunca lo hubiera conectado.
//
// PURO (sin BD ni crypto): el edge lee las filas, DESCIFRA los blobs
// (secretsCrypto.decryptJson) y los inyecta aquí. Testeable con vitest.

import type { AmbientePago } from './types.ts'

/**
 * Credenciales de UN ambiente desde el jsonb opaco de la bóveda
 * ({ sandbox: {…}, prod: {…} }). null si el blob no es objeto o no trae el
 * ambiente pedido.
 */
export function credsDeAmbiente(
  credenciales: unknown,
  ambiente: AmbientePago,
): Record<string, unknown> | null {
  if (typeof credenciales !== 'object' || credenciales === null) return null
  const v = (credenciales as Record<string, unknown>)[ambiente]
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Credenciales EFECTIVAS de un ambiente: las de la LOCACIÓN si su blob las trae;
 * si no, las de la EMPRESA. La herencia es POR AMBIENTE y no por fila: una fila
 * de locación creada solo para persistir el estatus de "probar conexión" (sin
 * credenciales, o solo con el otro ambiente) no bloquea la herencia.
 */
export function credencialesEfectivasDeAmbiente(
  blobLocacion: unknown,
  blobEmpresa: unknown,
  ambiente: AmbientePago,
): Record<string, unknown> | null {
  return credsDeAmbiente(blobLocacion, ambiente) ?? credsDeAmbiente(blobEmpresa, ambiente)
}
