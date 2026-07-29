# Ramas preview de Supabase — costo, limpieza y drift del historial

Cada PR que toca `supabase/` hace que la integración Git de Supabase cree una
**rama preview**: un proyecto Postgres efímero con el esquema construido desde
cero a partir de `supabase/migrations/`. Es útil (valida las migraciones contra
una base limpia) y **se cobra por hora**.

| Concepto | Valor |
| --- | --- |
| Costo por rama preview | **$0.01344/h ≈ $9.68/mes** (plan Pro de esta org) |
| Expiración automática | **ninguna** — Supabase no las caduca |
| Borrado automático propio | solo al mergear/cerrar el PR |

El hueco es el PR en **draft abandonado**: nunca se cierra, así que el preview
vive para siempre. El 2026-07-29 había dos así — PR #541 (27 días) y PR #545
(20 días) — quemando **~$19/mes** sin que ningún check se pusiera rojo. El costo
no aparece en CI, solo en la factura.

## La limpieza automática

`.github/workflows/cleanup-preview-branches.yml` corre **diario a las 06:00 UTC**
(00:00 GT) y borra los previews que ya no sirven.

| Situación del PR | Acción |
| --- | --- |
| Cerrado o mergeado | 🗑️ borra |
| Abierto, sin commits en ≥7 días | 🗑️ borra (abandono) |
| Abierto y activo | ✅ deja |
| Label `keep-preview` | ⏭️ deja (escotilla manual) |
| Rama `is_default` (= **producción**) o `persistent` | ⏭️ intocable |
| PR ilegible, sin `pr_number`, commit sin fecha | ⏭️ deja (ante duda, no borra) |

Detalles que importan:

- **La antigüedad se mide por fecha del último commit, no por `updated_at` del
  PR.** `updated_at` se mueve con cada comentario de bot, así que un PR que
  nadie toca hace un mes parecería "activo" para siempre.
- **Tope duro de 10 borrados por corrida.** Si la API devolviera basura, el daño
  queda acotado y visible en vez de barrer el proyecto.
- **Borrar un preview no toca el código ni el PR.** Si alguien vuelve a hacer
  push a esa rama, Supabase lo recrea desde cero. Por eso el criterio de
  abandono es seguro incluso con un PR que se retome meses después.
- Ejecución manual (`workflow_dispatch`) trae **dry-run activado por defecto**:
  reporta qué borraría sin borrar nada. Los inputs permiten cambiar el umbral.
- Sin `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_ID` hace no-op con aviso.

Para conservar un preview a propósito: ponle el label **`keep-preview`** al PR.

## Por qué la rama `main` sale como `MIGRATIONS_FAILED`

Es **esperado y cosmético**. Producción está sana y al día; lo que falla es el
`supabase db push` que intenta la integración Git, con:

```
Remote migration versions not found in local migrations directory.
```

Durante marzo–junio 2026 varias migraciones se aplicaron a mano / por MCP, y eso
las registró con la versión del *momento de aplicación* (`20260318194400`) en vez
de la del archivo (`20260318000000`). Quedaron **dos numeraciones paralelas**
para la misma historia:

| | Cantidad | Rango |
| --- | --- | --- |
| Versiones en remoto sin archivo local | ~300 | 2026-03-18 → 2026-06-10 |
| Archivos locales sin registrar en remoto | 242 | 2026-03-18 → 2026-06-05 |
| **Desde 2026-06-11** | — | **coinciden 1:1, cero drift** |

Por eso `.github/workflows/apply-migrations-prod.yml` usa la Management API y
**evita `db push` a propósito** (ver su cabecera). Prod se migra por ahí.

### ⚠️ Cuidado con el modo *reconciliar*

`apply-migrations-prod.yml` en `workflow_dispatch` **sin input** aplica toda
migración local cuya versión no esté en el historial remoto. Hoy eso son **242
migraciones legacy**. El SQL es idempotente por diseño, pero es un disparo mucho
más grande de lo que sugiere el nombre del botón. Para una migración puntual,
usa el input `migration_file`.

### Cómo reparar el historial, si algún día se quiere

**No reparar a ciegas.** Borrar las ~300 huérfanas e insertar las 242 locales
equivale a *afirmar* "estos 242 archivos están aplicados" sin probarlo, y no hay
correspondencia 1:1 entre ambos conjuntos. Si la afirmación es falsa en un solo
archivo, el drift queda enterrado y sin forma de detectarlo.

La forma verificable usa el propio mecanismo de previews: **una rama preview se
construye desde cero aplicando solo los archivos del repo**, o sea es "cómo se
vería prod si el repo fuera la verdad". El procedimiento:

1. Crear una rama preview desde `main`.
2. Diff del esquema del preview contra prod.
3. Si son idénticos → la reparación está probada; respaldar
   `supabase_migrations.schema_migrations` y recién ahí reescribirla.
4. Si difieren → acabas de encontrar drift real en producción, que importa
   bastante más que el status rojo del dashboard.

Costo del diff: ~$0.30 (un preview por un día).

## Duplicados de versión — regla (d) del migrations-guard

El historial remoto se indexa por `version` = los 14 dígitos del nombre, y
`apply-migrations-prod.yml` registra con `ON CONFLICT (version) DO NOTHING`. Dos
archivos con el mismo timestamp ⇒ el segundo se aplica (el push a `main` aplica
por nombre de archivo) pero **nunca queda registrado**, y el modo reconciliar —
que decide por versión — se lo salta creyéndolo ya aplicado.

Pasó de verdad, con dos pares:

| Timestamp | Registrado | Ensombrecido |
| --- | --- | --- |
| `20260713100000` | `solicitudes_enforce_rbac_gate` | `soft_delete_registros` |
| `20260713110000` | `cerrar_ciclo_cuotas` | `ambiente_pago_tenant` |

Los cuatro estaban aplicados en prod por suerte, no por diseño — y los dos
ensombrecidos eran justamente los que arreglaban el pago en línea del residente.
Se renombraron a `…100001` / `…110001`, y `scripts/migrations-guard.mjs` ahora
falla en CI ante cualquier timestamp duplicado o nombre no parseable. Esa regla
**no es allowlisteable**: el nombre del archivo es la identidad de la migración.

### El renombre destapó un fallo mudo en `apply-migrations-prod.yml`

Al mergear #681, el workflow reportó **verde sin aplicar ni registrar nada**.
Causa: seleccionaba archivos con `git diff --diff-filter=AM`, y Git detecta un
renombre como una sola entrada `R` — que ese filtro **excluye**. Los dos
archivos renombrados desaparecieron de la lista y el job cayó en la rama
"Nothing to apply", en verde.

No rompió nada (el DDL de ambos ya estaba aplicado en prod: `registros.deleted_at`,
`registros.deleted_by`, `idx_registros_active`, `companies.ambiente_pago`,
`projects.ambiente_pago`, `payment_requests.ambiente` — todos verificados), pero
el registro quedó incompleto **y el fallo fue invisible**, el peor modo posible
para un workflow que escribe en producción.

Peor todavía: la regla (d) recién agregada **manda renombrar** el archivo cuando
hay timestamp duplicado. Sin arreglar esto, seguir esa instrucción metía la
migración justo en este agujero.

Arreglado con `--no-renames` en ambas ramas de selección (descompone el renombre
en `D` + `A`, y la `A` sí entra por el filtro), más un `::warning::` cuando un
`push` toca `supabase/migrations/**` y aun así no selecciona ningún `.sql` — un
verde silencioso ahí no significa "no había nada que hacer".
