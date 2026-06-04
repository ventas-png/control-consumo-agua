// T7 / plat:P12 — Query keys del dominio Empresa (administración del tenant).
//
// Convención idéntica a agua/keys.ts:
//   - `all`: raíz del dominio. Invalida todo de una:
//       queryClient.invalidateQueries({ queryKey: empresaKeys.all })
//   - cada entidad es una función que añade el scope (companyId) para aislar la
//     caché por tenant.
//   - companyId ausente se normaliza a `null` para que la key sea estable.
//
// `seccion` es la lectura compuesta que alimenta la pantalla de administración
// de empresa (datos de la company + proyectos + usuarios con sus roles). Se
// modela como una sola entrada porque la vista siempre los carga juntos y se
// invalidan en bloque tras cualquier mutación (espeja el `cargar()` original).
export const empresaKeys = {
  all: ['empresa'] as const,
  seccion: (companyId?: string) => [...empresaKeys.all, 'seccion', companyId ?? null] as const,
} as const
