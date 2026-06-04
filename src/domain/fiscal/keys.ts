// serv:S11 · Núcleo fiscal FEL/CFDI — Query keys del dominio.
//
// Convención (igual que src/domain/agua/keys.ts y facturacion/keys.ts):
//   - `all`: raíz del dominio para invalidar todo de una vez.
//   - cada entidad es una función que añade el scope (companyId/registroId) para
//     que cada tenant tenga su propia entrada en caché (sin cross-leak).
//   - un scope ausente se normaliza a `null` para que la key sea estable entre
//     renders.
//
// NOTA: este dominio (`fiscal`) es DISTINTO de `facturacion`. `facturacion` lee
// la Factura-como-`registros` (agua:C4); `fiscal` lee los comprobantes
// electrónicos `documentos_fiscales` (FEL/CFDI). Separados a propósito.
export const fiscalKeys = {
  all: ['fiscal'] as const,
  // Documentos fiscales del tenant (scope company).
  documentos: (companyId?: string) =>
    [...fiscalKeys.all, 'documentos', companyId ?? null] as const,
  // Documentos fiscales de una Factura concreta (scope registro).
  documentosPorRegistro: (registroId?: string) =>
    [...fiscalKeys.all, 'documentos', 'por-registro', registroId ?? null] as const,
  // Un documento fiscal por id.
  documento: (id?: string) =>
    [...fiscalKeys.all, 'documento', id ?? null] as const,
} as const
