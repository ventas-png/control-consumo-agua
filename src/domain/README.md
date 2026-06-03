# `src/domain` — Capa de datos por dominio (Track T7)

Esta carpeta es la **capa de datos** de la app: encapsula el acceso a Supabase
detrás de hooks tipados de **TanStack Query**, por dominio. **Reemplazó por
completo** al monolito `src/hooks/useData.ts` (652 L, 16 colecciones en un solo
objeto), eliminado al migrar su última colección — `proyectos` — y al
`fetch + useState/useEffect` disperso en componentes.

> Hallazgos que cierra: `agua:A4` (✅ `useData.ts` eliminado), `cond:A3`, `cond:A4`, `plat:P25`, `serv:S4`.

## Estructura

```
src/domain/
  queryClient.ts        # QueryClient único + defaults (staleTime, gcTime, retry…)
  queryFetch.ts         # runQuery(): timeout por query + unwrap de { data, error }
  <dominio>/
    schemas.ts          # Zod (ya existía — agua:C6 / cond:C2)
    keys.ts             # factory de query keys del dominio
    queries.ts          # hooks de lectura  (useXQuery)
    mutations.ts        # hooks de escritura (useXMutation) — a medida que se necesiten
    __tests__/
```

El `QueryClientProvider` se monta una sola vez en `src/main.tsx` con el
`queryClient` de `queryClient.ts`.

## Convenciones

**Query keys** (`<dominio>/keys.ts`): un objeto con `all` (raíz para invalidar
todo el dominio) y una función por entidad que añade el scope (`companyId`,
`unidadId`, …). El scope ausente se normaliza a `null` para que la key sea
estable. Ver `agua/keys.ts` como referencia.

**Hooks de query** (`<dominio>/queries.ts`): un `useXQuery(scope?)` por entidad.
La `queryFn` usa `runQuery()` para heredar timeout + manejo de error. Ejemplo
canónico en `agua/queries.ts` (`useClientesQuery`, `useRegistrosQuery`,
`useRutasQuery`).

```ts
export function useClientesQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.clientes(companyId),
    queryFn: async () =>
      (await runQuery<Cliente[]>((signal) =>
        supabase.from('clientes').select('*').abortSignal(signal))) ?? [],
  })
}
```

**Mutaciones**: `useMutation` que tras `onSuccess` invalida la(s) key(s)
afectada(s) — `queryClient.invalidateQueries({ queryKey: aguaKeys.clientes(cid) })`.

**Scoping por tenant**: RLS es la defensa primaria. Replicar el filtro
`.eq('company_id', cid)` donde la columna exista (defense-in-depth), igual que
`useData`. `clientes` y `registros` se scopean solo por RLS (no tienen/­usan
`company_id` directo).

## Orden de adopción (importante para trabajo en paralelo)

1. **Este PR (scaffold):** `queryClient`, `queryFetch`, provider en `main.tsx`,
   y el ejemplo `agua/*`. **No se cablea a componentes todavía** (blast radius
   mínimo; `useData` sigue intacto).
2. **Migración por componente:** un componente que hoy hace su propio fetch (o
   recibe props desde `useData`) pasa a `useXQuery`. Regla de oro: **no migrar la
   misma entidad en dos sitios a la vez** mientras `useData` siga viva (evita
   doble fetch / estados divergentes).
3. **Vaciar `useData`:** cuando todas las entidades de un dominio tengan su hook
   y sus consumidores migrados, se retira esa porción de `useData`. ✅ **Completado
   para agua:** `proyectos` fue la última colección; `useData.ts` se eliminó. El
   filtrado por asignación de proyecto y la derivación de moneda/maxUnidades viven
   ahora en `src/lib/proyectosAccess.ts` (puro, testeado) y se aplican en `App`
   sobre `useProyectosQuery` + `useProyectoAssignmentsQuery`, igual que rutas usa
   `filterRutasByProjectAccess`.

Cada track de dominio (T1 Servicios, T2 Comunicación, T4 Facturación…) crea su
propia carpeta `src/domain/<dominio>/` siguiendo esta convención, sin tocar las
de otros dominios → trabajo en paralelo sin colisiones.
