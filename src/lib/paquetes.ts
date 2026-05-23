// Helpers para paquetería de salida (retiro por tercero).

// Código de retiro de un solo uso, corto y legible (6 caracteres en mayúsculas).
// Usado cuando recepción registra una salida directamente; el camino del residente
// genera el código en el servidor (RPC paquete_autorizar_salida).
export function generarCodigoRetiro(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

// QR del código para que el tercero lo muestre en portería. Reutiliza el mismo
// servicio que ya usa Control de Accesos QR (sin dependencias nuevas).
export function codigoRetiroQrUrl(codigo: string): string {
  const data = encodeURIComponent(`PAQUETE:${codigo}`)
  return `https://api.qrserver.com/v1/create-qr-code/?data=${data}&size=200x200&margin=8`
}
