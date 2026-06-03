// T7 — Capa de datos. Cliente único de TanStack Query para toda la app.
//
// Defaults alineados con el patrón "SWR" que ya usaba useData (caché en
// localStorage + refetch en cada carga):
//   - staleTime 60 s: dentro de ese margen los datos se consideran frescos y no
//     se refetchea. Evita tormentas de red al navegar entre rutas del dominio.
//   - gcTime 24 h: espeja el TTL del caché de useData; mantiene los datos en
//     memoria para un first-paint instantáneo al volver a una vista.
//   - retry 1: las queries ya llevan timeout propio (runQuery → AbortSignal,
//     15 s). Un reintento cubre fallos transitorios sin martillar a Supabase.
//   - refetchOnWindowFocus: revalida al volver a la pestaña — reemplaza el
//     refetch-on-focus manual (agua:D1).
//
// La persistencia a localStorage (first-paint offline) se evaluará en un PR
// posterior con @tanstack/query-sync-storage-persister; el scaffold no la
// incluye para mantener el blast radius mínimo.
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})
