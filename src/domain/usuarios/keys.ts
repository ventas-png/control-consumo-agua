// Query keys del dominio Usuarios (directorio de app_users del tenant).
//
// Convención idéntica a agua/keys.ts y empresa/keys.ts:
//   - `all`: raíz del dominio para invalidar todo de una vez.
//   - cada entidad añade su scope (companyId), normalizando ausente a `null`
//     para que la key sea estable entre renders.
//
// `directorio` es el mapa id → usuario que consume <UsuarioChip> para resolver
// las columnas de trazabilidad (creado_por, completado_por…). Se invalida
// cuando se da de alta/baja un usuario de la empresa.
export const usuariosKeys = {
  all: ['usuarios'] as const,
  directorio: (companyId?: string) =>
    [...usuariosKeys.all, 'directorio', companyId ?? null] as const,
} as const
