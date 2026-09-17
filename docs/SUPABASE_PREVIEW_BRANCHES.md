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
| Versiones en remoto sin archivo local | **307** | 2026-03-18 → 2026-06-10 |
| Archivos locales sin registrar en remoto | **0** | — |
| **Desde 2026-06-11** | — | **coinciden 1:1, cero divergencia de historial de migraciones en ese tramo** |

### De dónde salen esas cifras

La fila de **0** no es una inferencia por totales: la demuestra el workflow
**Drift de esquema (migraciones ↔ producción)**, que consulta
`supabase_migrations.schema_migrations` con credenciales reales y compara
**conjunto contra conjunto**, versión por versión — `aplicadas` en
`scripts/migraciones-vs-produccion.mjs` filtra los archivos locales por
pertenencia al `Set` de versiones registradas, no por conteo ni por máximo.

Su [run 35195425883](https://github.com/ventas-png/control-consumo-agua/actions/runs/35195425883)
(#62, `schedule`, 2026-09-17T07:37Z, main `8bed9eec`, **success**) imprimió:

```
Migraciones locales: 480 · registradas en producción: 480 · columnas comprobadas: 3659 · constraints críticos: 1 · policies críticas: 1
```

Los **480 de 480** son la fila de 0: **cada** archivo local tiene su versión en
el historial remoto. Ese checkout ya incluía las cuatro migraciones de #870, así
que cubre el árbol completo de hoy.

Sobre esa base sí cierra la resta: producción registra **787** versiones (medido
el 2026-09-17, máxima `20260917000825`) y las 480 locales están todas presentes,
luego **787 − 480 = 307** versiones sólo remotas y **0** sólo locales.

La fila de locales sin registrar **decía 242 y hoy es 0**:
`scripts/backfill-schema-migrations.sql` registró como papeleo las 257 versiones
≤ `20260605230000`, y el resto se fue aplicando y registrando por la Management
API.

### Qué demuestra la arqueología Git, y qué no

Lo que queda es historial duplicado, no esquema faltante. **Ningún archivo de
migración se perdió**, y eso está medido sobre el historial completo
(`git log --all --full-history`):

| | |
| --- | --- |
| Nombres de migración que alguna vez existieron | **495** |
| Vivos hoy | **480** |
| Ausentes | **15**, todos **renumerados hacia adelante** |
| De esos 15, byte a byte idénticos al archivo actual | **13** |
| Con diferencias, ninguna de DDL | **2** — `saved_reports_email_delivery` envuelve dos `COMMENT ON POLICY` en un `DO` tolerante, y `webhook_stripe_idempotencia_real` sólo cambia el número en tres `RAISE EXCEPTION` y un comentario |

Los 15 archivos tienen **14 números de versión distintos** (`20260522000001` lo
compartían dos). De esos 14, **13 quedaron ocupados por otra migración local** —
justamente la que causó la colisión—, así que son versiones locales registradas y
no pueden estar entre las 307. El único número que quedó libre es
`20260911201500`, y su archivo **nunca llegó a `main`**: se renumeró en la rama
del PR (commit `4627f00b`, «#858 llegó a producción primero»).

**Lo que la arqueología no puede decidir por sí sola** es la identidad de las 307,
porque este repositorio no guarda su lista. No se afirma aquí que ninguna coincida
con un nombre histórico: para descartarlo —en particular para `20260911201500`—
hace falta enumerarlas con
`select version from supabase_migrations.schema_migrations order by version`.
Lo que sí está demostrado es que **ninguna migración desapareció del repositorio**,
así que ninguna de las 307 puede corresponder a un archivo perdido; y la hipótesis
documentada arriba —timestamps del *momento de aplicación*, como `20260318194400`
en vez de `20260318000000`— sigue siendo la explicación registrada de su origen.

Por eso `.github/workflows/apply-migrations-prod.yml` usa la Management API y
**evita `db push` a propósito** (ver su cabecera). Prod se migra por ahí.

### El check externo «Supabase Preview» de `main`

La integración Git de Supabase publica un estado propio para la rama persistente
`main`, y **falla por esta misma divergencia histórica**: es el `db push` de arriba
devolviendo `Remote migration versions not found in local migrations directory`.

Tres aclaraciones, porque se confunde fácil:

- **No es un workflow de este repositorio.** No existe ningún
  `.github/workflows/*.yml` llamado «Supabase Preview»; el estado lo publica
  Supabase, y para `main` se ve en el panel como `MIGRATIONS_FAILED`.
- **No bloquea el CI del repositorio.** Los checks propios de `main` (CI,
  Coverage gate, Security guard, Health check) no dependen de él y pasan en verde.
- **En los PR sí pasa**, porque una preview de PR se construye **desde cero con
  los archivos del repo** y no hereda el historial huérfano: salió `success` en
  #868 y #870, los dos últimos PR que tocaron `supabase/`.

### ⚠️ Cuidado con el modo *reconciliar*

`apply-migrations-prod.yml` en `workflow_dispatch` **sin input** aplica toda
migración local cuya versión no esté en el historial remoto. Hoy eso son **cero
migraciones** —todas las locales están registradas—, pero **la advertencia sigue
en pie y el botón sigue siendo peligroso**: cualquier reparación del historial
cambia qué reaplicaría, y ese conjunto volvería a crecer en el momento en que se
borre una fila de `schema_migrations`. Cuando se leía «242 migraciones legacy»,
esto era un disparo masivo. Aquí se leía que "el SQL es idempotente por diseño": **no
lo es en el efecto**, y esa suposición es la que tumbó producción el 2026-08-03
—entre las reaplicadas iba una que empieza con
`DROP TABLE IF EXISTS public.app_users CASCADE`, idempotente en la forma y
destructiva con datos dentro—. Es un disparo mucho más grande de lo que sugiere
el nombre del botón, y no es seguro. Para una migración puntual, usa el input
`migration_file` (que además rechaza versiones ya registradas).

### Cómo reparar el historial, si algún día se quiere

**No reparar a ciegas.** Borrar las 307 huérfanas equivale a *afirmar* que los
archivos locales que les corresponden están aplicados sin probarlo, y **no hay
correspondencia 1:1**: son timestamps del momento de aplicación, no de los
archivos. Si la afirmación es falsa en un solo archivo, el drift queda enterrado
y sin forma de detectarlo.

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
