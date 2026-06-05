# T7 · PR3 — Roadmap de migración a `domain/` (próximas 5 tajadas)

> **Objetivo de PR3 (track T7):** que **ningún componente importe `supabase` directo**;
> todo el acceso a datos vive en `src/domain/<módulo>/`. Se hace **incremental, un
> módulo por PR**. Ya hechas: `mapa` (#440) y `tarifas` (#441). Esto deja la ruta de
> las siguientes 5 con prompt listo para pegar (una sesión por tajada).

## Recetario (el patrón ya probado en #440/#441)

1. `git fetch origin main` y trabajá desde ahí.
2. Por cada tabla/RPC que toca el componente, creá/extendé `src/domain/<módulo>/`:
   - **lecturas** → `queries.ts`: función async `fetch…()` que hace el `select` y
     pasa el resultado por un **parse defensivo** (`schemas.ts`, zod → `null` si la
     fila falta/está malformada).
   - **escrituras** → `mutations.ts`: `create/update/delete…()` que devuelven
     `{ data?, error: string | null }` (mensaje legible). El **armado del payload**
     (form + `currentUser`) **se queda en la UI**; solo baja el acceso a datos.
3. En el componente: importá esas funciones y **borrá `import { supabase }`**.
   Ojo: ajustá `error?.message` → `error` (ahora el error ya viene como string).
4. **Tests**: cubrí cualquier parte **pura** (parse de filas, mapeo de error). Si la
   función es un wrapper fino sin lógica, un test del contrato `{ error }` basta.
5. **Verificá**: el componente **sin `supabase`** (`grep`), `npx tsc --noEmit` limpio,
   `npm run build` OK, los tests del módulo verdes. (La suite completa local da ruido
   de entorno — la señal autoritativa es el CI del PR.)
6. **PR atómico** por módulo; mergear con CI verde. **Sin migraciones** (solo front).

**Convenciones útiles:**
- `lib/supabase` **no** está tipado con `Database` → los payloads de escritura pueden
  ir como `Record<string, unknown>` sin fricción de tipos.
- Si la tabla ya tiene dominio (p. ej. `registros`→`agua`, `companies`→`empresa`),
  **extendé ese dominio** en vez de crear uno nuevo.
- No toques otros módulos en el mismo PR (atomicidad).
- El conteo de calls es **multilínea-aware**: muchos `supabase\n.from(...)` no los
  caza un `grep` de una línea — confirmá con `grep -rzoE`.

---

## Las próximas 5 tajadas (orden recomendado: chicas → grandes; `condominios/tabs` (144) al final)

| # | Módulo | Archivos | Tablas/RPCs | Dominio |
|---|---|---|---|---|
| 3 | **rutas** | `RutasSection.tsx` (1185 L) | `rutas` ×3, `app_users` ×1 | crear `domain/rutas/` |
| 4 | **lecturas** | `LecturasSection.tsx` (690 L) | `registros` ×1, `ruta_ocurrencias` ×3, `rutas` ×1 | extender `domain/agua/` (+ usar `domain/rutas/`) |
| 5 | **calidad** | `CalidadSection.tsx` (687 L) | `fuentes_agua` ×4, `registros_calidad` ×2 | crear `domain/calidad/` |
| 6 | **contadores** | `ContadoresSection.tsx` (1077 L) + `ImportContadoresModal.tsx` (242 L) | `contadores` ×3, `unidades`, `projects`, `app_users`, `user_project_assignments` | crear `domain/contadores/` |
| 7 | **unidades** | `UnidadesSection.tsx` (1278 L) + `ImportUnidadesModal.tsx` (247 L) | `unidades` ×6, `contadores` ×2, `projects` ×2, `app_users` ×2, `user_project_assignments` ×2, `companies` ×1 | crear `domain/unidades/` |

> Pegá **el Recetario de arriba + el bloque de la tajada** para arrancar cada sesión.

---

### Tajada 3 — `rutas`
```
Repo control-consumo-agua, branch desde main. Tajada de T7/PR3: migrar el acceso
directo a Supabase de src/components/rutas/RutasSection.tsx a src/domain/rutas/.
Toca: rutas (3 — lectura del listado + escrituras crear/editar/completar) y
app_users (1 — lookup). Creá domain/rutas/{queries,mutations}.ts (+ schemas si hay
parse de filas) y, donde aplique, reusá lo de app_users (¿domain/sesiones o un
helper?). Seguí el Recetario de docs/T7_PR3_ROADMAP.md. DoD: RutasSection sin
`import supabase`, tsc/build limpios, tests del módulo verdes, PR atómico.
```

### Tajada 4 — `lecturas`
```
Repo control-consumo-agua, branch desde main. Tajada de T7/PR3: migrar
src/components/lecturas/LecturasSection.tsx. Toca: registros (1 — insertar lectura),
ruta_ocurrencias (3) y rutas (1). `registros` es de agua → extendé domain/agua/
(mutations: createRegistro/…); ruta_ocurrencias/rutas → domain/rutas/ (de la
tajada 3; si aún no existe, crealo). Recetario en docs/T7_PR3_ROADMAP.md. DoD:
LecturasSection sin `import supabase`, tsc/build limpios, tests verdes, PR atómico.
```

### Tajada 5 — `calidad`
```
Repo control-consumo-agua, branch desde main. Tajada de T7/PR3: migrar
src/components/calidad/CalidadSection.tsx a src/domain/calidad/. Toca: fuentes_agua
(4 — lecturas + escrituras de fuentes) y registros_calidad (2 — registrar muestreo).
Creá domain/calidad/{queries,mutations,schemas}.ts con parse defensivo de las filas.
Ojo: la lógica de cumplimiento de calidad ya es server-side (no la dupliques).
Recetario en docs/T7_PR3_ROADMAP.md. DoD: CalidadSection sin `import supabase`,
tsc/build limpios, tests del parse verdes, PR atómico.
```

### Tajada 6 — `contadores`
```
Repo control-consumo-agua, branch desde main. Tajada de T7/PR3: migrar el módulo
contadores (src/components/contadores/ContadoresSection.tsx + ImportContadoresModal.tsx)
a src/domain/contadores/. Toca: contadores (3 — CRUD), unidades (1), projects (1),
app_users (1), user_project_assignments (1) — varios son lecturas de apoyo para los
selectores del form. Creá domain/contadores/{queries,mutations,schemas}.ts; las
lecturas de unidades/projects podrían ir a sus propios dominios si existen, o quedar
acá si son específicas del form. Recetario en docs/T7_PR3_ROADMAP.md. DoD: ambos
archivos sin `import supabase`, tsc/build limpios, tests verdes, PR atómico.
```

### Tajada 7 — `unidades`
```
Repo control-consumo-agua, branch desde main. Tajada de T7/PR3: migrar el módulo
unidades (src/components/unidades/UnidadesSection.tsx + ImportUnidadesModal.tsx) a
src/domain/unidades/. Es la más grande de esta tanda (~15 calls): unidades (6 — CRUD),
contadores (2), projects (2), app_users (2), user_project_assignments (2), companies (1).
Creá domain/unidades/{queries,mutations,schemas}.ts; reusá dominios existentes para
las tablas de apoyo donde tenga sentido (projects, companies→empresa). Por el tamaño,
podés partirlo en 2 PRs (UnidadesSection y ImportUnidadesModal) si te resulta más
limpio. Recetario en docs/T7_PR3_ROADMAP.md. DoD: ambos archivos sin `import supabase`,
tsc/build limpios, tests verdes, PR(s) atómico(s).
```

---

## Después de estas 5

Quedan módulos sueltos chicos (`cobros`, `clientes`, `admin-dashboard`, `portal`,
`onboarding`, `superadmin`, `shared`, `empresa` —este ya con dominio, son calls
residuales—) y el grande: **`condominios/tabs` (144 archivos)**, que se hace al final,
ya con el patrón 100% rodado y, idealmente, en lotes por sub-feature (amenidades,
visitantes, paquetería, cuotas, etc.). Cerrá cada lote con su PR atómico.
