# T7 · PR3 — Migración a `domain/` (estado + backlog)

> **Objetivo de PR3 (track T7):** que **ningún componente importe `supabase` directo**;
> todo el acceso a datos vive en `src/domain/<módulo>/`. Se hace **incremental, un
> módulo por PR atómico**.
>
> **Estado: primera tanda COMPLETA (7/7).** Sigue abajo el **backlog** para continuar.

## ✅ Hecho (primera tanda — 7 módulos)

| Módulo | PR | Dominio |
|---|---|---|
| `mapa` | #440 | `domain/mapa/` (queries + schema) |
| `tarifas` | #441 | `domain/tarifas/mutations` |
| `rutas` | #445 | `domain/rutas/` + `domain/usuarios/` (compartido) |
| `lecturas` | #446 | `domain/agua/mutations` + `domain/rutas/` |
| `calidad` | #447 | `domain/calidad/` (DB + Storage) |
| `contadores` | #448 | `domain/contadores/` |
| `unidades` | #449 | `domain/unidades/` |

**Helpers de dominio reutilizables que ya existen** (úsalos en el backlog en vez de re-crear):
- `domain/usuarios/queries.fetchActiveAppUsers()` — usuarios activos del tenant.
- `domain/contadores/queries.resolveDefaultProjectCompany(userId, fallbackCompanyId)` — resuelve proyecto/empresa (app_users → user_project_assignments → projects).
- `domain/unidades/queries.resolveUnidadProjectCompany(userId, formProjectId, fallbackCompanyId)` — idem con `form` primero; con `formProjectId=null` equivale al de arriba.
- `domain/unidades/queries.checkUnidadesLimit(companyId)` · `domain/contadores/queries.fetchUnidadesByCompany(companyId)`.

---

## Recetario (patrón ya probado en las 7 tajadas)

1. `git fetch origin main` y trabajá desde ahí.
2. Por cada tabla/RPC que toca el componente, creá/extendé `src/domain/<módulo>/`:
   - **lecturas** → `queries.ts`: `fetch…()` con el `select` + **parse defensivo** (`schemas.ts`, zod → `null` si falta/está malformada) cuando aplique.
   - **escrituras** → `mutations.ts`: `create/update/delete…()` que devuelven `{ data?, error: string | null }`. El **armado del payload** (form + `currentUser`) **se queda en la UI**; solo baja el acceso a datos.
   - **storage** → wrappers `upload…/get…SignedUrl` (ver `domain/calidad`).
3. En el componente: importá esas funciones y **borrá `import { supabase }`**.
   Ojo: ajustá `error?.message`/`error.message` → `error` (ahora viene como string), y `data[0] as X` → `data` cuando la mutación ya devuelve la fila.
4. **Tests**: cubrí lo **puro** (parse de filas, mapeo de error / contrato `{ error }`).
5. **Verificá**: el componente **sin `supabase`** (`grep`), `npx tsc --noEmit` limpio (¡atrapa los `error.message` que quedan!), `npm run build` OK, los tests del módulo verdes. (La suite completa local da **ruido de entorno** — la señal autoritativa es el CI del PR.)
6. **PR atómico** por módulo; mergear con CI verde. **Sin migraciones** (solo front).

**Convenciones útiles:**
- `lib/supabase` **no** está tipado con `Database` → payloads de escritura como `Record<string, unknown>` sin fricción.
- Si la tabla ya tiene dominio (`registros`→`agua`, `companies`→`empresa`), **extendé** ese dominio.
- Conteo de calls **multilínea-aware**: `grep -rzoE "supabase\s*\.\s*(from|rpc|storage)\("` (un `grep` de una línea subcuenta).
- Una función de acceso que ya exista en otro dominio → **reusala** (ver helpers arriba).

---

## ⬜ Backlog (próxima tanda)

Conteos aproximados (single-line grep; confirmá multilínea-aware al arrancar):

| Módulo | Aprox. | Nota |
|---|---|---|
| `cobros` | ~3 | pagos/recibos |
| `clientes` | ~3 (archivos grandes) | mutaciones de contratos/STR/company_clientes |
| `admin-dashboard` | ~2 | incl. stats de conversations (count) |
| `portal` | ~3 | portal cliente/condominios |
| `condominios` (raíz) | ~3 | fuera de `tabs/` |
| `empresa` | ~11 (residual) | el dominio ya existe; bajar las calls que quedan |
| `superadmin` · `onboarding` · `shared` | 1 c/u | sueltos |
| **`condominios/tabs`** | **~144** | **el grande** — al final, por lotes |

### Prompt genérico (módulo chico)
```
Repo control-consumo-agua, branch desde main. Tajada de T7/PR3: migrar el acceso
directo a Supabase de src/components/<MÓDULO>/ a src/domain/<MÓDULO>/, siguiendo el
Recetario de docs/T7_PR3_ROADMAP.md (queries.ts/mutations.ts/schemas.ts; el componente
borra `import supabase`; reusá los helpers de dominio existentes —ver el doc— en vez de
recrearlos). Confirmá las calls con grep multilínea-aware. DoD: componente(s) sin
`import supabase`, tsc --noEmit limpio, vite build OK, tests del módulo verdes, PR atómico.
```

### `condominios/tabs` (el grande, ~144) — por lotes
```
Repo control-consumo-agua, branch desde main. Track T7/PR3, lote de condominios/tabs:
migrar UN sub-feature por PR (p. ej. amenidades, visitantes, paquetería, cuotas,
asambleas/actas, mudanzas…). Para cada lote: crear/extender domain/condominios/ con
queries+mutations (parse defensivo en lecturas), borrar `import supabase` de esos tabs,
reusar helpers existentes. Recetario + helpers en docs/T7_PR3_ROADMAP.md. DoD por lote:
sin `import supabase` en los archivos del lote, tsc/build limpios, tests verdes, PR atómico.
Repetir hasta que `grep -rl "lib/supabase" src/components/condominios/tabs` quede vacío.
```

> Métrica de avance: `grep -rlE "from '.*lib/supabase'" src/components | wc -l` debe ir bajando hacia 0.
