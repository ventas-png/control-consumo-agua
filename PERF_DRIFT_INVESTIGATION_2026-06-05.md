# Investigación de drift de performance (DB) — 2026-06-05

**Disparador:** durante la validación del PR #417 (banda de perf que cerró 9 WARN de
`get_advisors(performance)`), el **preview branch** del PR reveló **30 WARN** donde
prod mostraba **9**. Esta nota documenta por qué, qué es real, y cómo remediarlo.

> Alcance: **investigación** (decidido por el dueño). Las migraciones de remediación
> de abajo están **listas pero NO aplicadas** — van en PR(s) aparte; un par requieren
> una decisión de producto (ver §2.3 y §2.4).

---

## 0. TL;DR

| # | Hallazgo | Nivel | Causa raíz | Remediación |
|---|---|---|---|---|
| 1 | 27 `multiple_permissive_policies` en 7 tablas de condominios | WARN | policies legacy `company_rw_*` (ALL, **public**) que `20260519000002` NO dropeó (su DROP por regex sólo matcheaba `*_{select,insert,update,delete}`) | drop de las legacy (§2) |
| 2 | 3 `duplicate_index` en `contratos_arrendamiento` | WARN | `fase2` y `fase27` crearon el mismo índice con nombres distintos | drop del set `idx_arrend_*` (§3) |
| 3 | `reservas_str.str_cliente_portal` WITH_CHECK con tautologías | **Seguridad** | `s.unidad_id = s.unidad_id` / `s.company_id = s.company_id` (auto-comparación) | corregir el WITH_CHECK (§4) |
| 4 | prod (9 WARN) ≠ chain (30 WARN); `main` shadow en `MIGRATIONS_FAILED` | Proceso | fixes manuales en prod no capturados en migraciones (drift) + el cap de 500 del advisor ocultaba el resto | reconciliar prod↔chain (§5) |

**El PR #417 está limpio:** sus 2 migraciones aplican sin error en el preview, cerraron
sus 9 WARN (initplan=0, sus 2 permissive fuera, 11 índices de FK presentes) y **no
introdujeron** ninguno de los 30. Todo lo de abajo es **pre-existente**.

---

## 1. Cómo se descubrió

- `get_advisors(performance)` sobre **prod** (`nnsqmeigtgewatameexo`) devolvió **exactamente
  500 lints** — un **cap**. Los 9 WARN visibles cabían en ese tope; el resto quedó cortado.
- El **preview branch** (`vhtnpbdmuxxeqcakycce`) devolvió **730 lints / 30 WARN**. El preview
  **reaplica TODO el chain de migraciones desde cero**, así que expone el estado "según las
  migraciones", sin el cap.
- Diferencia clave: el preview muestra lo que las migraciones PRODUCEN; prod ha **derivado**
  de eso (objetos que el chain crea y prod no tiene, o viceversa).

> Nota: el `main` shadow branch figura `MIGRATIONS_FAILED` con fecha 2026-05-25. El preview
> del PR aplicó el chain **completo y limpio** ahora (Migrations ✅), así que ese estado es
> **stale** — el chain ya aplica de extremo a extremo.

---

## 2. Hallazgo 1 — 27 `multiple_permissive_policies` (7 tablas)

### 2.1 Causa raíz
Cada tabla tiene una policy **legacy** ancha + las policies **granulares** nuevas:

| Tabla | Legacy (ALL) | Rol legacy | Granulares (authenticated) | ¿Legacy dropeada en el chain? |
|---|---|---|---|---|
| `areas_condominio` | `company_rw_areas` | **public** | select/insert/update/delete | ❌ no |
| `mensajes_portal` | `company_rw_mensajes_portal` | **public** | select/insert/update (**sin delete**) | ❌ no |
| `plantillas_tarea_cargo` | `company_rw_plantillas_cargo` | **public** | select/insert/update/delete | ❌ no |
| `puntos_control_ruta` | `company_rw_puntos_control` | **public** | select/insert/update/delete | ❌ no |
| `tareas_bloque` | `company_rw_tareas_bloque` | **public** | select/insert/update/delete | ❌ no |
| `visitas_control` | `company_rw_visitas_control` | **public** | select/insert/update/delete | ❌ no |
| `reservas_str` | `str_cliente_portal` | authenticated | select/insert/update/delete | n/a (audiencia distinta, ver §2.4) |

Una policy `ALL` para `public` se solapa con TODA acción para `authenticated` ⇒ 2 policies
permisivas por acción ⇒ el WARN en cada combinación.

**Por qué no se dropearon:** `20260519000002_rbac_rls_condominios_phase2.sql` añadió las
granulares y limpió viejas con un **DROP por regex** que sólo matchea nombres terminados en
`_select|_insert|_update|_delete` (y salta los que contienen `cliente`). Los nombres
`company_rw_*` **no matchean** → sobreviven. Para `areas_condominio` y `mensajes_portal` no
hubo ni siquiera ese intento de drop.

- Legacy creadas en: `20260424000059_rutas_ronda.sql` (areas:57, puntos:65, visitas:69),
  `20260424000060_tareas_operativas.sql` (plantillas:70, tareas:78),
  `20260424000061_portal_residente.sql` (mensajes:24).
- Granulares en: `20260519000002_rbac_rls_condominios_phase2.sql` y
  `20260519000003_perf_rls_consolidate_policies.sql`.

**Por qué prod NO lo muestra:** las `company_rw_*` fueron removidas en prod por fuera del
chain (hotfix manual / SQL editor). Es el drift de §5.

### 2.2 Remediación (5 tablas con CRUD granular completo) — SEGURA
Las granulares cubren las 4 acciones; dropear la legacy no quita capacidad. Además mejora
seguridad (quita policies sobre `public`). Idempotente:

```sql
DROP POLICY IF EXISTS company_rw_areas          ON public.areas_condominio;
DROP POLICY IF EXISTS company_rw_plantillas_cargo ON public.plantillas_tarea_cargo;
DROP POLICY IF EXISTS company_rw_puntos_control  ON public.puntos_control_ruta;
DROP POLICY IF EXISTS company_rw_tareas_bloque   ON public.tareas_bloque;
DROP POLICY IF EXISTS company_rw_visitas_control ON public.visitas_control;
```
Resuelve 20 de los 27 WARN. `IF EXISTS` ⇒ no-op en prod (ya no existen).

### 2.3 `mensajes_portal` — DECISIÓN NECESARIA
No tiene granular `_delete`; `company_rw_mensajes_portal` es el ÚNICO camino de DELETE.
Opciones:
- **(a)** si DELETE debe existir para authenticated: crear `mensajes_portal_delete` granular
  (con el qual de empresa/rol que corresponda) y luego dropear la legacy.
- **(b)** si DELETE no debe permitirse: dropear la legacy sin reemplazo (endurece; cambio de
  comportamiento). 

### 2.4 `reservas_str` — DECISIÓN NECESARIA (audiencia distinta)
`str_cliente_portal` (ALL, authenticated) NO es legacy redundante: da acceso al **portal del
cliente** (`current_user_role()='cliente'` con solicitud de renta aprobada). Coexiste con las
granulares de staff ⇒ el advisor lo marca, pero es un **segundo público legítimo**. Resolver
el WARN sin perder funcionalidad implica rediseñar (p.ej. una sola policy por acción que
combine staff OR cliente). **Recomendación:** tratarlo aparte; priorizar el bug de §4.

---

## 3. Hallazgo 2 — 3 `duplicate_index` (`contratos_arrendamiento`)

Índices idénticos creados dos veces con distinto nombre, ninguno dropeado:

| Columna | Set A (queda) | Set B (se dropea) |
|---|---|---|
| `estado` | `idx_contratos_arr_estado` (`fase2`:355) | `idx_arrend_estado` (`fase27`:121) |
| `project_id` | `idx_contratos_arr_project` (`fase2`:353) | `idx_arrend_project` (`fase27`:119) |
| `unidad_id` | `idx_contratos_arr_unidad` (`fase2`:354) | `idx_arrend_unidad` (`fase27`:120) |

Se conserva el set `idx_contratos_arr_*` (el que **prod ya tiene**) y se dropea `idx_arrend_*`
para alinear chain↔prod. Idempotente:

```sql
DROP INDEX IF EXISTS public.idx_arrend_estado;
DROP INDEX IF EXISTS public.idx_arrend_project;
DROP INDEX IF EXISTS public.idx_arrend_unidad;
```

---

## 4. Hallazgo 3 — bug de seguridad en `reservas_str.str_cliente_portal` (WITH_CHECK)

El `WITH_CHECK` compara columnas consigo mismas:
```
... AND (s.unidad_id = s.unidad_id) AND (s.company_id = s.company_id) ...
```
Debería referenciar la fila destino (`reservas_str`), como sí hace el `USING`:
```
... AND (s.unidad_id = reservas_str.unidad_id) AND (s.company_id = reservas_str.company_id) ...
```
**Impacto:** en INSERT/UPDATE el chequeo no ata la reserva a la unidad/empresa aprobada del
cliente — basta que el cliente tenga *alguna* solicitud STR aprobada. Un cliente podría
crear/editar una `reservas_str` para una unidad que no es la suya. Es independiente de perf;
**conviene corregirlo aunque no se toque lo demás.** (Recrear la policy con el WITH_CHECK
correcto; revisar la migración que la creó: `20260519000003`/origen de `str_cliente_portal`.)

---

## 5. Hallazgo 4 — drift prod ↔ chain (meta-problema)

prod (9 WARN reales tras el cap) está **más limpio** que el chain (30 WARN) porque recibió
fixes manuales (las `company_rw_*` removidas, `idx_arrend_*` ausentes) que **no volvieron al
repo** como migraciones. El `migrations/README.md` ya advierte: *"nunca crear/alterar vía SQL
Editor del dashboard"*. Esto es exactamente eso.

**Recomendación de proceso:**
1. Aplicar §2.2 + §3 (+ decidir §2.3/§2.4 y §4) como migraciones idempotentes → el chain pasa
   a producir lo mismo que prod ya tiene (drift cerrado para estos objetos).
2. Validar en preview que `get_advisors(performance)` baja de 30 → ~3 WARN (queda
   `reservas_str` si se decide dejarla, hasta rediseñar).
3. A futuro: capturar TODO cambio de prod como migración; considerar un check de CI que
   compare el set de policies/índices del preview vs prod y falle ante drift.

---

## 6. Plan de PRs (atómicos, separados de #417)

- **PR A (seguro):** §2.2 (drop 5 legacy) + §3 (drop 3 índices dup). Bajo riesgo, sin decisión.
- **PR B:** §4 (fix WITH_CHECK de `str_cliente_portal`). Seguridad; revisar con dueño.
- **PR C:** §2.3 (`mensajes_portal` DELETE) según decisión (a/b).
- **PR D (diseño):** §2.4 (`reservas_str` doble audiencia) — consolidación con cuidado.

Cada uno: migración idempotente en banda de perf (timestamp > último mergeado), validar en el
preview del PR (NO `apply_migration` a prod), re-correr `get_advisors`.
