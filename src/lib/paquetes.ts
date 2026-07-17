// Helpers para paquetería de salida (retiro por tercero).
import { generarToken } from './tokens'

// Código de retiro de un solo uso, corto y legible. B5 (auditoría 2026-07-16,
// S3): CRIPTOGRÁFICO (antes Math.random — predecible) y con el alfabeto sin
// ambiguos de lib/tokens; 8 chars ≈ 40 bits. Usado cuando recepción registra
// una salida directamente; el camino del residente genera el código en el
// servidor (RPC paquete_autorizar_salida, también endurecido en B5).
export function generarCodigoRetiro(): string {
  return generarToken(8)
}

// El QR del código se renderiza LOCAL con <QRCodeSVG value={qrPayloadRetiro(c)}>
// (qrcode.react, igual que Control de Accesos QR). El servicio externo
// api.qrserver.com se eliminó en B5: la CSP lo bloqueaba (QR roto en prod) y
// además filtraba el código de retiro a un tercero.
export function qrPayloadRetiro(codigo: string): string {
  return `PAQUETE:${codigo}`
}
