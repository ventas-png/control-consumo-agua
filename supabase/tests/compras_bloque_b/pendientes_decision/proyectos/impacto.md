# Impacto de la propuesta de alcance de proyecto (`propuesta_alcance_proyecto.sql`)

Todo lo de abajo se midió en **PostgreSQL 16 desechables** con la **cadena completa del PR #926** (las diez migraciones, `20261027000000` … `20261027000900`, árbol de `edaab0c4` extraído con `git archive`) y `fixture.sql`, con y sin la `20261026000600` del PR de seguridad #928 (versiones `5051eebc` —la del worktree— y `1794dc8f`). Las corridas de `run.sh` se hicieron en **repositorios git desechables** (un commit «base» = `origin/main` y el paquete encima), porque el paso 7 de `run.sh` (`migrations-append-only`) y `RG-4.diagnostico` necesitan `git` (ver §3.1). La propuesta es la migración **`20261027001000`**, justo después de la 0900. Las aserciones del repositorio **no se tocan en la carpeta**: se adaptan con `adaptaciones_aserciones.patch` (§3.3) y se probó el resultado. Nada se escribió en producción, en el sandbox ni en la base de preview: lo único que tocó producción son los `SELECT` de §1.

**Base de cada cifra (segunda verificación independiente, V2-B3).** El informe se midió primero sobre `edaab0c4`; la rama del #926 está hoy en `a6ccc2a8` (entre ambos no cambia ninguna migración ni suite que se ejecute) y esta revisión volvió a medir sobre ella: las cifras de `run.sh`, de la reversión, del catálogo y de `vitest` de §3, §5 y §7 son las **nuevas**, y cada una dice su base: **sin la 0600** (la rama del #926 sola, que es lo que corre `run.sh` en CI de #926), **con la 0600** de `d1aeb94a` del #928 (md5 `194f59f0…`, el orden de despliegue real) y **con o sin `fixture.sql`**.

## 1. Datos de producción (solo lectura, `SELECT`, proyecto de producción, 2026-10-10; las marcadas † se repitieron el 2026-10-11)

| Consulta | Resultado |
|---|---|
| Documentos con `project_id IS NULL` † | `ordenes_compra` **0** de 1 · `recepciones` **0** de 0 · `facturas_proveedor` **0** de 1 · `ordenes_pago` **0** de 0 · `contrasenas_pago` **0** de 0 · `recepcion_respaldos` **0** de 0 · `orden_compra_eventos` **0** de 0 |
| Los dos documentos que existen | la orden histórica (`recibida`) y la factura (`anulada`) **tienen proyecto**: no hay ninguna orden histórica sin proyecto |
| Personas por rol en `app_users` | `super_admin` 1 · `company_owner` 1 · `admin` 1 (con 3 proyectos asignados: no es exento) · `operator` 7 · `viewer` 13 · `cliente` 9 |
| Personas exentas de proyecto hoy (`user_is_project_exempt()`) | **2** (el superadministrador y el propietario) |
| `app_users.project_id` (el otro camino de `user_has_project_access`) | 0 de 32 |
| `user_project_assignments` † | **43 filas, todas `permission_type = 'total'`** (`user_has_project_access` no lee esa columna) |
| Privilegios de `anon` sobre las 9 tablas † | `has_table_privilege(…, 'SELECT' / 'INSERT' / 'UPDATE')`: **0 de 9** en cada una (no «conserva DML»); `authenticated` sin `TRUNCATE` |
| `ON DELETE` de `project_id` → `projects` † | `ordenes_compra` **`CASCADE`** (`c`); `recepciones`, `facturas_proveedor`, `ordenes_pago` y `contrasenas_pago` **`SET NULL`** (`n`) |
| Personas por rol con y sin asignaciones † | `admin` 1 (con asignaciones) · `company_owner` 1 (sin) · `super_admin` 1 (sin) · `operator` 7 (todos con) · `viewer` 13 (todos con) · `cliente` 9 (sin) |
| Versión de PostgreSQL y última migración † | 17.6 · `20261026000500` |
| Llaves de permiso con «sin proyecto» / «todos los proyectos» / «exento» en `permissions` | **0**: no existe ninguna llave explícita que pudiera reutilizarse |

## 2. La matriz completa, tabla × brecha × vía × persona (615 celdas, antes y con la propuesta)

Cada celda se ejecutó como la persona (`SET ROLE` + `request.jwt.claim.sub`) dentro de una subtransacción que se deshace. «API» = `INSERT` / `UPDATE … WHERE id = …` (el camino de PostgREST); «función `SECURITY DEFINER`» = una función de juguete que hace el `UPDATE` por id sin pasar por la RLS (modela cualquier RPC definer). Leyenda: ✅ pasa (1 fila) · ⛔ rechazo `42501` · ⚓ rechazo `23514` de su ancla (`COMPRAS_RECEPCION_ORDEN_AJENA` / `COMPRAS_PAGO_FACTURA_AJENA`: la recepción y la orden de pago atan su proyecto a su orden / factura, antes y después) · 〇 **0 filas** (la política `SELECT` esconde el documento; no es éxito) · `RLS` rechazo de la política · `EMP` `COMPRAS_ALCANCE_EMPRESA` · **a → b** = hoy → con la propuesta.

**Resumen: 615 celdas, 60 cambian, todas `✅ → ⛔` de una persona acotada** (`ua` 22 · `adm2` 22 · `uo` 16). No cambia ninguna celda de las exentas, de `service_role`, de otra empresa ni de `anon`.

Notas de lectura: (1) el rechazo de «A → B» y «NULL → B» ya lo da la 0900 (`trg_zzcompras_mover_alcance`, «…proyecto de destino») y se conserva con su mismo mensaje porque el disparador nuevo dispara **después**; (2) «B → A» / «B → NULL» por la API dan 0 filas **antes y después**, y por una función definer ya las rechazaba la 0900 («…proyecto en que está hoy»); (3) la recepción y la orden de pago no se pueden mover de proyecto sin su orden / factura (⚓), así que para ellas la brecha es solo la **inserción** (a)(b) —y, cuando su ancla ya está «sin proyecto», la propuesta cierra también esa inserción—; (4) para `anon` la prueba le concede `SELECT`/`INSERT`/`UPDATE` sobre las nueve tablas **a propósito y solo mientras corre la matriz** (en producción no los tiene: allí el rechazo es `permission denied` antes de la RLS), para comprobar lo más exigente: que aunque los tuviera, la RLS lo detiene; (5) la contraseña de pago de la prueba tiene un número fijado por el sistema para que el índice único del número (por contabilidad) no tape el resultado del alcance: sin eso, mover una contraseña de A a NULL falla por `uq_contrasenas_numero` (otro defecto, ajeno a esto: la numeración es por contabilidad).

**`ua` · operador asignado solo a A, con TODAS las llaves · vía API (PostgREST: `WHERE id = …`)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| INSERT en A | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT en B | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** |
| INSERT en NULL | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** |
| UPDATE A>NULL | **✅ → ⛔** | ⚓ | **✅ → ⛔** | ⚓ | **✅ → ⛔** |
| UPDATE A>B | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE NULL>A | **✅ → ⛔** | ⚓ | **✅ → ⛔** | ⚓ | **✅ → ⛔** |
| UPDATE NULL>B | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE B>A | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE B>NULL | 〇 | 〇 | 〇 | 〇 | 〇 |

**`ua` · operador asignado solo a A, con TODAS las llaves · vía función `SECURITY DEFINER` (no pasa por la RLS)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| UPDATE A>NULL | **✅ → ⛔** | ⚓ | **✅ → ⛔** | ⚓ | **✅ → ⛔** |
| UPDATE A>B | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE NULL>A | **✅ → ⛔** | ⚓ | **✅ → ⛔** | ⚓ | **✅ → ⛔** |
| UPDATE NULL>B | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE B>A | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE B>NULL | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |

**`adm2` · administrador CON asignaciones (A y G): NO exento · vía API (PostgREST: `WHERE id = …`)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| INSERT en A | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT en B | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** |
| INSERT en NULL | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** |
| UPDATE A>NULL | **✅ → ⛔** | ⚓ | **✅ → ⛔** | ⚓ | **✅ → ⛔** |
| UPDATE A>B | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE NULL>A | **✅ → ⛔** | ⚓ | **✅ → ⛔** | ⚓ | **✅ → ⛔** |
| UPDATE NULL>B | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE B>A | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE B>NULL | 〇 | 〇 | 〇 | 〇 | 〇 |

**`adm2` · administrador CON asignaciones (A y G): NO exento · vía función `SECURITY DEFINER` (no pasa por la RLS)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| UPDATE A>NULL | **✅ → ⛔** | ⚓ | **✅ → ⛔** | ⚓ | **✅ → ⛔** |
| UPDATE A>B | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE NULL>A | **✅ → ⛔** | ⚓ | **✅ → ⛔** | ⚓ | **✅ → ⛔** |
| UPDATE NULL>B | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE B>A | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE B>NULL | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |

**`uo` · operador asignado solo a A, SIN llaves (el rol `operator` inserta sin ninguna llave) · vía API (PostgREST: `WHERE id = …`)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| INSERT en A | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT en B | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** |
| INSERT en NULL | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** | **✅ → ⛔** |
| UPDATE A>NULL | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE A>B | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE NULL>A | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE NULL>B | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE B>A | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE B>NULL | 〇 | 〇 | 〇 | 〇 | 〇 |

**`uo` · operador asignado solo a A, SIN llaves (el rol `operator` inserta sin ninguna llave) · vía función `SECURITY DEFINER` (no pasa por la RLS)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| UPDATE A>NULL | **✅ → ⛔** | ⚓ | **✅ → ⛔** | ⚓ | **✅ → ⛔** |
| UPDATE A>B | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE NULL>A | **✅ → ⛔** | ⚓ | **✅ → ⛔** | ⚓ | **✅ → ⛔** |
| UPDATE NULL>B | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE B>A | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |
| UPDATE B>NULL | ⛔ | ⚓ | ⛔ | ⚓ | ⛔ |

### Las clases que NO cambian (hoy = con la propuesta, celda por celda)


**`AD` · administrador SIN asignaciones (exento) · vía API (PostgREST: `WHERE id = …`)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| INSERT en A | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT en B | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT en NULL | ✅ | ✅ | ✅ | ✅ | ✅ |
| UPDATE A>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE A>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |

**`AD` · administrador SIN asignaciones (exento) · vía función `SECURITY DEFINER` (no pasa por la RLS)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| UPDATE A>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE A>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |

**`ow` · propietario (`company_owner`) · vía API (PostgREST: `WHERE id = …`)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| INSERT en A | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT en B | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT en NULL | ✅ | ✅ | ✅ | ✅ | ✅ |
| UPDATE A>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE A>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |

**`ow` · propietario (`company_owner`) · vía función `SECURITY DEFINER` (no pasa por la RLS)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| UPDATE A>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE A>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |

**`su` · superadministrador · vía API (PostgREST: `WHERE id = …`)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| INSERT en A | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT en B | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT en NULL | ✅ | ✅ | ✅ | ✅ | ✅ |
| UPDATE A>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE A>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |

**`su` · superadministrador · vía función `SECURITY DEFINER` (no pasa por la RLS)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| UPDATE A>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE A>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |

**`FAD` · administrador de OTRA empresa (exento en la suya) · vía API (PostgREST: `WHERE id = …`)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| INSERT en A | RLS | RLS | RLS | RLS | RLS |
| INSERT en B | RLS | RLS | RLS | RLS | RLS |
| INSERT en NULL | RLS | RLS | RLS | RLS | RLS |
| UPDATE A>NULL | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE A>B | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE NULL>A | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE NULL>B | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE B>A | 〇 | 〇 | 〇 | 〇 | 〇 |
| UPDATE B>NULL | 〇 | 〇 | 〇 | 〇 | 〇 |

**`FAD` · administrador de OTRA empresa (exento en la suya) · vía función `SECURITY DEFINER` (no pasa por la RLS)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| UPDATE A>NULL | EMP | ⚓ | EMP | ⚓ | EMP |
| UPDATE A>B | EMP | ⚓ | EMP | ⚓ | EMP |
| UPDATE NULL>A | EMP | ⚓ | EMP | ⚓ | EMP |
| UPDATE NULL>B | EMP | ⚓ | EMP | ⚓ | EMP |
| UPDATE B>A | EMP | ⚓ | EMP | ⚓ | EMP |
| UPDATE B>NULL | EMP | ⚓ | EMP | ⚓ | EMP |

**`anon` (con el DML que se le CONCEDE solo dentro de la prueba; en producción no lo tiene: 0 de 9 tablas) · vía API (PostgREST: `WHERE id = …`)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| INSERT en A | RLS | RLS | RLS | RLS | RLS |
| INSERT en B | RLS | RLS | RLS | RLS | RLS |
| INSERT en NULL | RLS | RLS | RLS | RLS | RLS |
| UPDATE A>NULL | RLS | RLS | RLS | RLS | RLS |
| UPDATE A>B | RLS | RLS | RLS | RLS | RLS |
| UPDATE NULL>A | RLS | RLS | RLS | RLS | RLS |
| UPDATE NULL>B | RLS | RLS | RLS | RLS | RLS |
| UPDATE B>A | RLS | RLS | RLS | RLS | RLS |
| UPDATE B>NULL | RLS | RLS | RLS | RLS | RLS |

**`service_role` · vía API (PostgREST: `WHERE id = …`)**

| brecha | ordenes_compra | recepciones | facturas_proveedor | ordenes_pago | contrasenas_pago |
|---|---|---|---|---|---|
| INSERT en A | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT en B | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT en NULL | ✅ | ✅ | ✅ | ✅ | ✅ |
| UPDATE A>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE A>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE NULL>B | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>A | ✅ | ⚓ | ✅ | ⚓ | ✅ |
| UPDATE B>NULL | ✅ | ⚓ | ✅ | ⚓ | ✅ |

### Renglones (hijas), persona acotada `ua` (también `adm2` y `uo`)

| Hija | `INSERT` en la cabecera de A | en la de B (no asignado) | en una cabecera ya sin proyecto | mover un renglón de A a un documento de B |
|---|---|---|---|---|
| `orden_compra_lineas` | ✅ | **✅ → ⛔** | ✅ (límite D-4) | RLS (hoy) → ⛔ del disparador (con la propuesta; control) |
| `recepcion_lineas` | ✅ | **✅ → ⛔** | ✅ | — |
| `factura_proveedor_lineas` | ✅ | **✅ → ⛔** | ✅ | — |
| `contrasena_pago_facturas` | ✅ | **✅ → ⛔** | ✅ | — |

`UPDATE` y `DELETE` de los renglones de B por la API dan 〇 (0 filas) antes y después; `service_role` sigue pudiendo. Una función definer que saca un renglón de un documento de B hacia uno de A pasa hoy y muere con la propuesta (el documento de **origen** también se mira).

## 3. La batería existente `compras_bloque_b/run.sh`

### 3.1 Línea base de este entorno (árbol de `edaab0c4` sin la migración nueva)

`bash supabase/tests/compras_bloque_b/run.sh` con `PGPORT_TEST` propio, **en un repositorio git** (un commit «base» que hace de `origin/main`): **rc = 0**, `✅ compras (orden → recepción → factura → seguimiento) verificado contra PostgreSQL real`, **986 líneas `✓`** (la cifra que cuenta el informe del PR). Con la `20261026000600` del PR #928 ya en «main» (el orden de despliegue real): **rc = 0, 986 ✓ también**; línea por línea solo cambian los números de objetos de la reversión (la 0600 añade 5 al catálogo: 9 618 y 9 762 contra 9 613 y 9 757) y los milisegundos impresos por `EV-09`.

**En una copia sin `.git`** (`cp -r`, un tar de `git archive`) la línea base son **985**, por dos razones que hay que conocer antes de comparar números: (a) el paso 7 `migrations-append-only` imprime «(omitido: sin git/node en este entorno)» en vez de su `✓`; (b) `hallazgos/RG-4.diagnostico.sql` localiza `scripts/diagnostico-numeros-factura.sql` con `git rev-parse --show-toplevel` y, sin git, falla con `[RG-4·diag] el archivo del diagnóstico existe y no está vacío`: hay que exportar `DIAG=<raíz>/scripts/diagnostico-numeros-factura.sql` (comprobado: sin `DIAG` rojo; con `DIAG` verde). Medido en esta revisión sobre el árbol puro sin `.git` y con `DIAG` exportado: **rc = 0 y 985 ✓** (una primera corrida de esas dos se detuvo una vez en `hallazgos/RG-4.rpc.sql:196` —`[RG-4·limpieza] la prueba no deja residuo — esperado 0, recibido 1`— sin ninguna relación con el paquete, y no se reprodujo en la segunda. **Causa raíz (F2-11, segunda verificación):** la limpieza contaba `id::text LIKE 'fb5%'` —y `'fb4%'` y `'fb6%'` en `RG-4.sql` y `RG-4.diagnostico.sql`—, un prefijo de 3 caracteres hexadecimales que cualquier id aleatorio (`gen_random_uuid()`) de otra suite cumple por azar: en ese punto de la corrida hay **244 ids no fijos** (132 de facturas, 103 de usuarios, 9 de proveedores), ≈ 5,8 % de probabilidad por prueba y ≈ 16 % por corrida entre las tres. Reproducida de forma determinista (un id producido de verdad por `gen_random_uuid()` con ese prefijo, confirmado antes de la prueba: rojo en las tres, en 8 de 9 combinaciones prueba × tabla) y **corregida** contando solo la forma completa de los ids fijos del montaje, `fbNNNNNN-0000-0000-0000-…` (un uuid aleatorio nunca tiene «0000» en el grupo 3): verde con los mismos señuelos, rojo con un residuo fijo a propósito). La primera versión de este informe contaba «985 ✓» en una copia sin `.git` y «986 = 985 + `PRJ-1`», mezclando las dos cuentas.

### 3.2 Con la migración y las aserciones tal cual: la corrida se detiene en la primera

`run.sh` termina en la primera invariante incumplida: **`assert_inventario.sql:72`** (`❌ invariante incumplida … COMPRAS_ALCANCE_PROYECTO: un documento de compras sin proyecto …`, rc = 1; reproducido en esta revisión). Para ver **todas** las diferencias (no solo la primera) se corrió una copia «indulgente» (en la copia de análisis, `\set ON_ERROR_STOP off` y los `chk*` cuentan en vez de abortar; el repositorio no se toca) de la batería completa con y sin la migración, archivo por archivo.

### 3.3 Qué cambia de resultado: EXACTAMENTE esto

De los **54 archivos SQL** (16 `assert_*.sql` + 38 de `hallazgos/`) y los pasos de `run.sh`, **cambian cuatro archivos y dos comprobaciones de `run.sh`**; los pasos posteriores a §5r (idempotencia y reversión de la 0900, protección de inventario, concurrencia §6 y §6b: 83 líneas `✓` comparadas una por una) dan lo mismo salvo esas dos comprobaciones de §6c. Todo lo demás da el mismo número de `✓`, `✗` y errores (incluidas `PERM-1`, `PERM-2`, `PERM-4`, `SEP-1…6`, `SEP-idempotencia`, `SEP-reversion`, la concurrencia de §6 y §6b, `RG-4*`, `CONC-*`, `VER-*`, `EV-02…09`, `DEP-*`, `RG-3`):

| # | Archivo:línea | Qué prueba (y qué hace) | Persona | Hoy | Con la propuesta | Por qué | Efecto |
|---|---|---|---|---|---|---|---|
| 1 | `assert_inventario.sql:71-72` | «Una orden de la contabilidad de la EMPRESA (sin proyecto) no tiene bodega»: el montaje inserta la orden `OE` con `project_id NULL` | `UO` (operador del padrón, con C1 y C2: no exento) | pasa | `INSERT` rechazado `42501` «…sin proyecto … solo lo crea una persona exenta de proyecto…» | `NULL` solo para exentos (D-1) | `:73-75` `[1 · una orden de la contabilidad de la empresa no admite insumos de bodega]` pasa a ✗ (la orden no existe: FK `orden_compra_lineas_orden_compra_id_fkey`): **33 ✓ → 32 ✓, 1 ✗, 1 error** |
| 2 | `hallazgos/EV-01.sql:243-251` | `[EV-01i]` contabilidad de la empresa: la factura (`:244`), la contraseña (`:247`) y —por herencia— la orden de pago (`:251`) con `project_id NULL`; la partida (`:249`) falla en cascada por FK | `UA` (administrador con C1 y C2: no exento) | pasa | las tres `INSERT` rechazadas `42501` | idem | `:254`, `:258`, `:266`, `:268` pasan a ✗: **31 ✓ → 27 ✓, 4 ✗, 4 errores** |
| 3 | `hallazgos/EV-10.sql:119-120` | `[EV-10c4]` LEGÍTIMO: una orden de la contabilidad de la empresa (sin proyecto) puede llevar una obra de la empresa | `UA` | pasa | `INSERT` rechazado | idem | `:122` pasa a ✗: **20 ✓ → 19 ✓, 1 ✗, 1 error** |
| 4 | `hallazgos/PERM-3.sql:338` | `[INSERT oc aprobada] una orden SIN proyecto es de la empresa: con la llave nace aprobada` (documenta **P-PERM-1**) | `okc` (operador de A con la llave de la orden) | pasa (`perm_filas … 1`) | rechazado `42501` | **es justo la decisión D-1 / R2**: la aserción describe el comportamiento que el dueño aún no decidió | el bloque `$oc_insert$` aborta en `:338` y no ejecuta las 13 comprobaciones de `:340-369`: **119 ✓ → 106 ✓, 1 error** |
| 5 | `run.sh` §6c, reversión **total** (`scripts/reversion-compras-controles.sql`) | el catálogo revertido debe ser EXACTO al previo a `20261027000000` | — | ✓ | ❌ sobran 12 objetos (3 funciones y 9 disparadores de la propuesta) | el script generado no conoce la migración nueva | `reversion_script.patch` añade la sección de `20261027001000` **encima** de la de la 0900 |
| 6 | `run.sh` §6c, reversión **parcial** de la 0900 | la sección de la 0900, **sola**, devuelve el catálogo al posterior a la 0800 | — | ✓ | ❌ sobran los mismos 12 objetos | la prueba supone que la 0900 es la última migración | `reversion_script.patch`: `run.sh` §6c prueba la sección de la 1000 sola (vuelve al estado posterior a la 0900) y la 1000 + la 0900 en ese orden (vuelve al posterior a la 0800) |

Por qué ninguna es un fallo de la propuesta: las filas 1-4 son **montajes** (o, la 4, una aserción que documenta lo que la propuesta cambia a propósito) en los que una persona **no exenta** crea un documento de la contabilidad de la Empresa; las filas 5-6 son contabilidad de la reversión. En `adaptaciones_aserciones.patch`, el montaje de 1-3 pasa a hacerse con el sistema (`como_sistema`) y la 4 se invierte a un rechazo; el flujo que prueban (pagar la contraseña de la empresa, el asiento sin proyecto, la obra de la orden de la empresa) **no cambia**.

### 3.4 Prueba de que esas seis son TODA la diferencia: la batería completa en verde con los parches

Árbol de `a6ccc2a8` (antes `edaab0c4`) + el paquete, **sin** y **con** la `20261026000600` de `d1aeb94a` en «main»: la propuesta como **`supabase/migrations/20261027001000_compras_alcance_proyecto_captura.sql`**, `PRJ-1.sql` en `hallazgos/` (la recoge el glob de §5r), `reversion_script.patch` y `adaptaciones_aserciones.patch` (las cuatro aserciones y el *fixture* de `compras_cierre_tecnico`; los tres parches se comprobaron con `git apply --check` sobre el árbol de `a6ccc2a8`, el `git archive` de la rama del #926). Resultado: **rc = 0**, `✅ compras (orden → recepción → factura → seguimiento) verificado contra PostgreSQL real`, **988 líneas `✓`** = las **986** de la línea base (en un repositorio git, §3.1) más `✓ PRJ-1 · 891 comprobaciones` más la comprobación nueva de la reversión parcial de la 1000 sola. Comparando línea por línea los `✓` de la línea base **con la 0600** (986) y de esta corrida, **las únicas diferencias son esas dos líneas** y los números que dependen del tiempo y que varían entre corridas de la MISMA línea base (los milisegundos que imprime `EV-09`; en `SEP-conc`, «25+25 cambios: 25 efectivos» salió «27» en una de las corridas); la línea de la reversión parcial de la 0900 ahora dice «(revertida después de la de 20261027001000)». Dos corridas completas del paquete (la primera con `PRJ-1` de 890 comprobaciones, la definitiva con 891) dieron el mismo resultado: rc = 0 y 988 ✓. **Esta revisión repitió la corrida completa en las dos bases, con el paquete armado por `armar_paquete.sh` sobre el árbol de `a6ccc2a8`: sin la 0600 y con la 0600 dan ambas rc = 0 y 988 ✓ (9 m 40 s cada una), con la misma salida salvo los objetos comparados de la reversión.** La reversión total (**9 613** objetos sin la 0600; 9 618 con ella), la parcial de la 1000 (**9 797**; 9 802 con la 0600) y la de la 1000 + 0900 (**9 757**; 9 762 con la 0600) son exactas; `SEP-idempotencia` (nueve pasadas) y `SEP-reversion` siguen en verde (la propuesta no reemplaza nada de la 0900). Sin `adaptaciones_aserciones.patch` la misma corrida se detiene en `assert_inventario.sql:72` (rc = 1).

Comprobación aparte de las cuatro aserciones, cada una sola en una base nueva (con el parche aplicado a la aserción): con la migración puesta, `assert_inventario` 33 ✓ · `EV-01` 31 ✓ (tras `assert_controles_servidor.sql`, que define sus ayudas) · `EV-10` 20 ✓ · `PERM-3` 119 ✓ —los mismos números que sin la migración—: la diferencia es el paso de creación, y nada más.

## 4. Las demás suites (`supabase/tests/*/run.sh`, 62 aparte de `compras_bloque_b`)

**Barrido de la primera versión de este informe** (la propuesta como migración temporal y **sin tocar ninguna aserción**; cada `supabase/tests/<suite>/run.sh` arma su propia cadena en su propio clúster): **61 de 62 dan `rc = 0`** y **1 da distinto: `compras_cierre_tecnico`**. (Una primera pasada con dos y cuatro clústeres a la vez dio varios `pg_ctl: could not start server` —el mismo fallo de arranque que el informe del PR ya registra para `personal_usuario`—; esas suites se repitieron una por una y todas dieron `rc = 0`. Las suites que arman solo una parte de la cadena —por ejemplo `compras_flujo`, `proveedores_pr_a`, `conta_*`— no aplican la migración nueva: su resultado no cambia por construcción; las que aplican la cadena completa la ejercitan.) **Ese barrido de las otras 61 NO se repitió en esta revisión** (el cuerpo SQL de la propuesta es byte a byte el mismo; solo cambió su cabecera de comentarios y su versión de archivo); el escéptico repitió `compras_bloque_b` y `compras_cierre_tecnico`, no el resto.

| Suite | Con la migración y sin tocar nada | Por qué | Con `adaptaciones_aserciones.patch` |
|---|---|---|---|
| `compras_cierre_tecnico` | `rc = 3` en el paso 4: `fixture_lectura.sql:88` → `COMPRAS_ALCANCE_PROYECTO: para crear un documento de compras tu perfil necesita estar asignado al proyecto del documento` (reproducido en esta revisión) | `:83-88` siembra 4 órdenes de pago (de C1, C2, la empresa y de D) como superusuario **pero con el `sub` de `UD` todavía puesto** por el `como(:UD)` anterior (`RESET ROLE` no borra `request.jwt.claim.sub`): para el servidor es una sesión de usuario de la empresa D insertando en proyectos de C. Y `:126-128` / `:136-138` crean con `UA` (administrador con C1 y C2, no exento) la orden y la recepción de la contabilidad de la **Empresa** (`project_id NULL`) | `set_config('request.jwt.claim.sub', '', false)` antes de `:84`, y la orden y la recepción «de la empresa» las siembra el sistema (`como_sistema`; tres cambios mínimos en el fixture): **`rc = 0`**, y las **32 líneas `✓` son las mismas** que las de la línea base (con la 0600 puesta), línea por línea |

Las 61 que dieron `rc = 0` en aquel barrido sin tocar nada: `acl_definer_expuestas_anon`, `actividad_equipo`, `balance_jornada`, `catalogo_contable_inicial`, `cierre_consumo_atomico`, `compras_flujo`, `comunicados_difusion_residente`, `consumo_insumos`, `conta_ajustes`, `conta_auxiliares_tipo_cargo`, `conta_cobros_bloqueos`, `conta_cobros_cargos`, `conta_cobros_cuotas`, `conta_contabilizacion_cargos`, `conta_cuentas_especiales`, `conta_estado_cuenta`, `conta_pagador_designado`, `conta_pendientes_reproceso`, `conta_rechazo_cobros`, `conta_reglas_imputacion`, `conta_saldos_favor`, `conta_tipo_cambio_mensual`, `cumplimiento_calidad_firma_inequivoca`, `declarar_triggers_fill_company_id`, `drift_produccion`, `drift_turnos`, `evidencia_al_cerrar`, `gastos_duplicados`, `insert_solo_pendiente`, `limpieza_catalogos`, `materializar_rutinas`, `notificaciones_actividad`, `notificaciones_reservas_entrega`, `personal_usuario`, `policies_empresa`, `policies_rondas`, `politica_jornada`, `pr27_project_id`, `presencia_correccion`, `presencia_marcaje`, `presencia_pausas`, `proteger_update_registros`, `proveedores_pr_a`, `puntos_verificacion`, `rbac_recursos_humanos`, `registrar_lectura`, `reparar_estado_tareas_bloque`, `reversa_helpers_rbac`, `rls_initplan_suministros`, `rutas_operadores`, `rutinas_limpieza`, `salud_notificaciones`, `security_definer_anon`, `security_logs_acceso`, `snapshot_al_crear`, `snapshot_del_scope`, `solicitud_renta_contrato`, `tareas_bloque_paridad`, `trazabilidad`, `turnos`, `webhook_stripe_idempotencia`.

Una variante que **no** se entrega, medida: con el bloque opcional de «la empresa del `INSERT` es la de la sesión» (README D-5) falla además `conta_reglas_imputacion/assert.sql:490-493` (siembra una factura de la empresa B con la sesión —el `sub`— de la empresa A) con `COMPRAS_ALCANCE_EMPRESA`; por eso ese bloque no está en el prototipo.

## 5. Código de la pantalla (Vitest): `erroresMigraciones.test.ts` y `ui_mensajes.patch`

**La migración y los mensajes.** `src/domain/compras/__tests__/erroresMigraciones.test.ts` lee cada `RAISE` de las migraciones y exige que la pantalla los clasifique igual **con y sin SQLSTATE**: los cinco `COMPRAS_ALCANCE_PROYECTO` de la propuesta llevan la frase «necesita estar asignado al proyecto» y la prueba pasa sin tocar `errores.ts` ni la prueba (la primera versión de los mensajes daba 3 rojos: sin SQLSTATE no se reconocían como `alcance_proyecto`). `node scripts/migrations-guard.mjs` con la migración presente: ✅ (RLS y policies, RPC con alcance, `SECURITY DEFINER` nuevas con `REVOKE` de `PUBLIC`).

**El parche de pantalla (`ui_mensajes.patch`), sobre el árbol de `edaab0c4`.** Lo que cambia: `mensajeCrearOrden` delega en `mensajeAccionCompras` (conserva su caso de clave repetida); los avisos de error de `ComprasTab.tsx:598/764`, `CuentasPorPagarTab.tsx:601/1018` y `OrdenesCompraTab.tsx:171` pasan por `mensajeAccionCompras` con `DURACION_ERROR_LARGO_MS` (12 s); y `ContabilidadSection.tsx` abre por omisión el primer proyecto asignado a la persona acotada **solo cuando no hay una elección recordada** (`ledgerInicialPorAlcance`, una vez por empresa y por montaje). **«Empresa» elegida a propósito se recuerda** (V2-B1): el selector guarda `conta-ledger:<empresa>` = `empresa` (por empresa y por navegador, como un proyecto), de modo que no se deshace al volver a entrar a Contabilidad ni al recargar; antes se guardaba borrando la llave, igual que «nada recordado», y la persona acotada regresaba al primer proyecto. Abrir en «Empresa» por omisión (personas exentas) sigue sin dejar rastro. Un proyecto recordado que **ya no existe** se descarta y se decide en el render siguiente, ya sin él (antes la persona acotada quedaba en «Empresa»). Pruebas nuevas, todas en el parche (36 pruebas en 4 archivos):

| Archivo | Qué prueba | Sin el código del parche | Con el parche |
|---|---|---|---|
| `contabilidad/__tests__/erroresCapturaProyecto.test.tsx` | los cuatro flujos de creación de Contabilidad (Nueva orden, Recibir, Emitir contraseña, Pagar) con los dos textos reales del servidor: texto sin `COMPRAS_`, igual al del servidor con la primera letra en mayúscula, aviso de 12 s; y un rechazo de datos que conserva su código | 9 rojas | 9 verdes |
| `condominios/tabs/__tests__/OrdenesCompraTab.errorAlcance.test.tsx` | Operaciones › Nueva OC: lo mismo | 2 rojas | 2 verdes |
| `contabilidad/__tests__/ledgerPorOmision.test.tsx` | (9) la persona acotada abre su primer proyecto; el administrador con asignaciones también; propietario / superadministrador / administrador sin asignaciones conservan «Empresa»; lo recordado se respeta; no decide hasta tener las asignaciones; elegir «Empresa» a propósito no se quita en el mismo montaje. **(10 nuevas, V2-B1)** elegir «Empresa» persiste al **remontar** y al **recargar** (las asignaciones llegan después), se guarda con un valor propio (`empresa`, no se borra la llave), elegir luego un proyecto lo reemplaza, es **por empresa**, sin elección recordada se preselecciona el primer proyecto, **un proyecto recordado que ya no existe se descarta** (la persona acotada abre su primer proyecto; la exenta, «Empresa»), y **las personas exentas no cambian** (propietario: sin escribir nada por omisión y su «Empresa» elegida también persiste; administrador sin asignaciones: sin escribir nada) | 10 rojas, 9 verdes (los casos que ya se cumplían son guardas de regresión) | 19 verdes |
| `lib/__tests__/ledgerInicialPorAlcance.test.ts` | la función pura de esa decisión, incluida «Empresa» elegida a propósito (`empresaElegida`), que se respeta también a la persona acotada | 6 rojas (la función no existe) | 6 verdes |

Total de las 36 aplicando **solo las pruebas** del parche (`git apply --include='*__tests__*'`) al árbol puro de `a6ccc2a8`: **27 rojas, 9 verdes**; con el parche completo: **36 verdes**. De las 12 nuevas de esta revisión, **6 están rojas contra la versión anterior del parche** (la que hacía que «Empresa» se deshiciera y dejaba a la persona acotada en «Empresa» con un proyecto recordado inexistente): remontar, recargar, valor propio, personas exentas, la función pura y el proyecto recordado inexistente; las otras 6 son guardas de regresión que ya se cumplían. **Mutación de la lógica nueva** (7 mutantes aplicados a mano sobre `ContabilidadSection.tsx` y `proyectosAccess.ts`: no guardar «Empresa» elegida, no leer el valor guardado, que el selector no marque la elección, quitar la espera del proyecto inexistente, ignorar `empresaElegida` en la función pura, no pasarla desde el resolvedor y marcar como elegida la corrección automática): **7 de 7 muertos** por `ledgerPorOmision.test.tsx` + `ledgerInicialPorAlcance.test.ts`; el control sin mutar, 25 de 25 en verde. `vitest run compras contabilidad condominios cxp platformPermissions` (línea base de este árbol: 136 archivos, 1 863 pruebas en verde) con el parche: **139 archivos, 1 893 pruebas en verde** (+3 archivos y +30 pruebas; la cuarta, de `src/lib`, no cae en esos filtros); `tsc --noEmit` rc = 0 y `eslint` sin errores en los archivos tocados (los archivos de prueba los ignora la configuración). El barrido completo de `src/` no se repitió. **No** se probó en un navegador real.

## 6. Flujos de la pantalla afectados (lectura de `src/` en `edaab0c4`, con archivo y línea; el arreglo es `ui_mensajes.patch`)

El servidor solo cambia para **personas no exentas** y solo en lo que crea o mueve **sin proyecto** o **en un proyecto que no tienen**. La pantalla sigue funcionando con un proyecto asignado; lo que cambia es el flujo de la contabilidad de la **Empresa**, y cómo se **muestra** el rechazo.

| Dónde | Qué hace | Efecto |
|---|---|---|
| `src/components/contabilidad/ContabilidadSection.tsx:64, 79-83, 111, 139-146` | el selector «Contabilidad» arranca en `🏢 Empresa` (`project_id = null`) salvo que `localStorage` (por navegador) recuerde un proyecto; pasa `ledgerProjectId` a `ComprasTab` (`:207`) y `CuentasPorPagarTab` (`:210`) | una persona **acotada** que abra Compras o Cuentas por pagar sin elegir proyecto ve «Nueva…» habilitado y el rechazo al guardar. **Afecta a Alexander Monterroso (operador, 6 proyectos) y a Marco Santos Godoy (administrador con 3 proyectos, no exento)**; en producción hoy no hay ningún documento sin proyecto, así que nadie lo usó. **`ui_mensajes.patch` (D-8, obligatorio)**: sin contabilidad recordada, la persona acotada abre el primer proyecto que ve (`ledgerInicialPorAlcance`); la exenta conserva «Empresa». **«Empresa» elegida a propósito se recuerda** (V2-B1: `conta-ledger:<empresa>` = `empresa`, por empresa y por navegador) y no se deshace al remontar ni al recargar; una persona acotada que elige «Empresa» a propósito sigue viendo el rechazo del servidor, ahora legible |
| `mutations.ts:129-143` (`crearOrdenTransaccional`, `p_project_id: projectId ?? null`) ← `ComprasTab.tsx:559, 577`; error en **`:598`** | nueva orden de compra de Contabilidad › Compras | con «Empresa»: `COMPRAS_ALCANCE_PROYECTO`; con su proyecto: igual que hoy. **Antes:** `mensajeCrearOrden(e)` devolvía `e.message` con el prefijo y el aviso duraba **3,5 s**. **Con el parche:** `mensajeCrearOrden` delega en `mensajeAccionCompras` (sin código) y el aviso dura 12 s |
| `mutations.ts:225-239` (`crearRecepcionTransaccional`) ← `ComprasTab.tsx:671`; error en **`:764`** | registrar recepción | idem. **Antes:** `e.message` crudo, 3,5 s. **Con el parche:** `mensajeAccionCompras(e, 'No se pudo crear la recepción.')`, 12 s |
| `mutations.ts:287-298` (`useCrearContrasenaMutation`, `insert({ …, project_id: projectId ?? null })`) ← `CuentasPorPagarTab.tsx:551`; error en **`:601`**; partidas (`contrasena_pago_facturas`) en `mutations.ts:305-320` | emitir contraseña de pago | idem; las partidas pasan si la cabecera es de su proyecto. **Antes:** `e.message` crudo, 3,5 s. **Con el parche:** `mensajeAccionCompras(e, 'No se pudo emitir.')`, 12 s |
| `cxp/mutations.ts:82-100` (`crearFacturaProveedor`, `p_project_id: project_id ?? null`) ← `CuentasPorPagarTab.tsx:386, 682-789`; error en `:828` | nueva factura de proveedor | idem. **Ya estaba bien:** `textoErrorServidor` quita el código y el aviso dura 12 s (`DURACION_ERROR_LARGO_MS`) |
| `cxp/mutations.ts:159-170` (`useCrearOrdenPagoMutation`, `project_id: vars.projectId`) ← `CuentasPorPagarTab.tsx:1014` (`projectId: factura.project_id`); error en **`:1018`** | solicitar orden de pago | hereda el proyecto de la factura: si la factura está sin proyecto y la persona no es exenta, rechazo; con factura de su proyecto, pasa. **Antes:** `e.message` crudo, 3,5 s. **Con el parche:** `mensajeAccionCompras(e, 'No se pudo crear la orden.')`, 12 s |
| `mutations.ts:360-380` (`useCrearOrdenPagoDeContrasenaMutation`, `project_id: vars.contrasena.project_id`) | orden de pago de una contraseña | idem (hereda de la contraseña); sus errores pasan por `mensajeAccionCompras` de la acción que la dispara |
| `src/components/condominios/tabs/OrdenesCompraTab.tsx:134` (editar borrador: manda `project_id: proyectoId` y `company_id` en el `UPDATE`; el error de la edición, `:145`, muestra `error.message` y la propuesta no lo dispara) y `:156` (crear; error en **`:171`**) | Operaciones › Órdenes de compra | **sin cambio de comportamiento**: `UPDATE OF project_id` con el mismo valor no mueve nada (la propuesta lo deja pasar y `PRJ-1` lo comprueba), y crear lleva siempre el proyecto de la pestaña. Solo llegaría el rechazo si la persona pierde ese proyecto con la pantalla abierta. **Antes:** `mensajeCrearOrden(e)` con el código, 3,5 s. **Con el parche:** sin código, 12 s |
| `compras_lineas_importar_aplicar` (carga masiva de renglones) | inserta renglones en una orden en borrador | pasa si la orden es de un proyecto de la persona o no tiene proyecto; no pasa en un borrador de un proyecto que no tiene |
| Funciones de borde (`supabase/functions/`) | ninguna escribe estas cinco tablas (búsqueda en el repositorio) | — |

**Corrección a la primera versión de este informe.** Decía que lo que el servidor devuelve en esos casos «es un texto que la pantalla ya muestra tal cual (`ComprasTab.tsx:121`, `mensajeAccionCompras`), sin el código técnico». Eso es cierto **solo** para las acciones sobre documentos existentes (`ComprasTab.tsx:121`, `CuentasPorPagarTab.tsx:101, 446`) y para la factura (`:828`). En **cinco de los seis flujos de creación** (`ComprasTab.tsx:598` y `:764`, `CuentasPorPagarTab.tsx:601` y `:1018`, `OrdenesCompraTab.tsx:171`) la pantalla mostraba `e.message` entero («Error: COMPRAS_ALCANCE_PROYECTO: un documento de compras sin proyecto (la contabilidad de la Empresa) solo lo crea una persona exenta de proyecto; si no lo eres, tu perfil necesita estar asignado al proyecto del documento: elige uno de los tuyos.») y `notify` dura **3 500 ms** por omisión (`Dialog.tsx:160-202`), poco para ~170 caracteres. `ui_mensajes.patch` lo arregla y trae pruebas que lo cubren: `erroresCapturaProyecto.test.tsx` (los cuatro flujos de Contabilidad, con los dos textos del servidor: rojas sin el parche, verdes con él), `OrdenesCompraTab.errorAlcance.test.tsx` (Operaciones), `ledgerPorOmision.test.tsx` y `ledgerInicialPorAlcance.test.ts` (D-8). El ajuste opcional que **no** se incluye es deshabilitar las altas cuando el libro activo es «Empresa» y la persona no es exenta.

## 7. Costo, bloqueos y datos

* **Datos:** no crea índices, restricciones ni columnas, y no escribe ni reescribe ninguna fila; el post-vuelo exige que los conteos de documentos no cambien.
* **Bloqueos al aplicar** (medido con `pg_locks` dentro de la propia transacción, justo antes del `COMMIT`, y luego `ROLLBACK`): **9 tablas con `ShareRowExclusiveLock`** (deja leer, bloquea `INSERT`/`UPDATE`/`DELETE` durante los milisegundos de la transacción) — `ordenes_compra`, `recepciones`, `facturas_proveedor`, `ordenes_pago`, `contrasenas_pago`, `orden_compra_lineas`, `recepcion_lineas`, `factura_proveedor_lineas`, `contrasena_pago_facturas` — y además `AccessShareLock` en las cinco cabeceras (el pre-vuelo cuenta documentos); `lock_timeout = 10 s` y `statement_timeout = 120 s`. **Riesgos reales, no medidos con tráfico:** los candados se toman **en serie** (un `CREATE OR REPLACE TRIGGER` por tabla) y se sueltan juntos al `COMMIT`; una transacción concurrente que toque varias de estas tablas en otro orden (un pago que escribe `ordenes_pago` y `contrasenas_pago`, una aprobación que toca factura y renglones) podría **interbloquearse** con la migración y PostgreSQL abortaría una de las dos —quizá la de la aplicación—, y una espera por el candado **encola escrituras** hasta 10 s por tabla. Por eso: aplicar **fuera de pagos y aprobaciones**, y reintentar si falla por `lock_timeout` (no deja nada). Revertir usa `DROP TRIGGER` (`AccessExclusiveLock`, bloquea incluso las lecturas hasta el final de la transacción): correrla fuera de uso.
* **Costo por escritura** (1 000 cabeceras y 1 000 renglones insertados como persona acotada en su proyecto, dentro de una transacción que se deshace; 5 corridas **alternadas** con y sin los disparadores de la propuesta sobre la misma cadena, **máquina compartida y con carga ajena**, mediana). Medición original (autor):

| | cabecera (`ordenes_compra`), por `INSERT` | renglón (`orden_compra_lineas`), por `INSERT` |
|---|---|---|
| sin la propuesta | 0,67 ms | 1,75 ms |
| con la propuesta | 0,96 ms | 2,16 ms |
| diferencia | **+0,28 ms** | **+0,41 ms** |

Otras cuatro mediciones del mismo método, cada una en otra máquina o con otra carga: el escéptico (cabecera 0,71 → 1,05 ms, **+0,34**; renglón 1,15 → 1,56 ms, **+0,41**), el segundo verificador (cabecera 0,37 → 0,72 ms, **+0,34**/+0,35; renglón 1,01 → 1,44 ms, **+0,43**) y dos tandas de esta revisión con otra batería corriendo en la misma máquina (`prj1`, `ua` de `PRJ-1`; con la propuesta 1,31 y 1,61 ms por cabecera contra 0,82 y 0,95 sin ella: **+0,49** y **+0,66**; renglón 2,75 y 2,84 contra 2,24 y 2,31: **+0,51** y **+0,52**). **Lo que se sostiene es el delta absoluto, de +0,3 a +0,7 ms por escritura** («medio milisegundo»); **los porcentajes se retiran** (+22 % a +90 % según la línea base de cada máquina: 0,37 a 0,95 ms por cabecera). Relevante solo en cargas masivas de renglones (la carga masiva `compras_lineas_importar_aplicar` inserta hasta 500 por lote: de 0,2 a 0,3 s más).
* **Idempotencia y reversión:** aplicada dos veces, la huella del catálogo no cambia entre la primera y la segunda; añade **exactamente 12 objetos** (3 funciones, 9 disparadores) y la reversión (dos veces) devuelve el catálogo EXACTO (9 805 objetos sobre el #926; 9 810 con la 0600), tanto con `reversion_alcance_proyecto.sql` como con la sección del script de la serie. Con la propuesta aplicada, `SEP-idempotencia.sh` (la 0900 aplicada nueve veces) y `SEP-reversion.sh` siguen en verde: por eso es aditiva.
* **Pre-vuelo:** si falta algo de la 0900 se detiene con `COMPRAS_MIGRACION_REQUISITOS` y no cambia nada (probado quitando el disparador de mover, la función `compras_sesion_usuario()` y una tabla). Es la misma clase de desfase que dejó a `Supabase Preview` del PR #926 sin la 0800 final.

## 8. Cómo se reproduce

```bash
# 1 · árbol del #926 (edaab0c4) como repositorio git desechable, con la 0600 del #928 en «main»
git -C <repo> archive edaab0c4 | tar -x -C /tmp/arbol && cd /tmp/arbol && git init -q -b main . && cp <worktree-928>/supabase/migrations/20261026000600_*.sql supabase/migrations/ \
  && git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD && git checkout -qb prueba
# 2 · el paquete encima (copia la migración y PRJ-1, aplica los tres parches)
bash <repo>/supabase/tests/compras_bloque_b/pendientes_decision/proyectos/armar_paquete.sh /tmp/arbol
# 3 · la batería completa (rc = 0 y 988 líneas ✓) y PRJ-1 sola en una base de la cadena
PGPORT_TEST=<puerto> bash supabase/tests/compras_bloque_b/run.sh
psql -d <copia> -f supabase/tests/compras_bloque_b/pendientes_decision/proyectos/PRJ-1.sql      # ROJA sin la propuesta (PGOPTIONS="-c prj.continuar=si" para contar)
psql -d <copia> -f supabase/tests/compras_bloque_b/pendientes_decision/proyectos/propuesta_alcance_proyecto.sql   # ×2
psql -d <copia2> -f supabase/tests/compras_bloque_b/pendientes_decision/proyectos/PRJ-1.sql    # VERDE
psql -d <copia2> -f supabase/tests/compras_bloque_b/pendientes_decision/proyectos/reversion_alcance_proyecto.sql   # ×2; reversion_catalogo.sql idéntico al previo
```

**Cifras de catálogo (V2-B3), con su base.** Objetos de `reversion_catalogo.sql` (`psql -q -t -A -d <bd> -f supabase/tests/compras_bloque_b/reversion_catalogo.sql | wc -l`) sobre la cadena del #926 (`a6ccc2a8`) construida como lo hace `run.sh` §3:

| Base | sin la 0600 | con la 0600 (`d1aeb94a`, md5 `194f59f0…`) |
|---|---|---|
| cadena sola (hasta la 0900) | **9 797** | **9 802** |
| + `fixture.sql` | **9 805** | **9 810** |
| + la propuesta (`20261027001000`) | 9 809 | 9 814 |
| + `fixture.sql` + la propuesta | 9 817 | 9 822 |

Y las tablas de `public` con `project_id`, clasificadas por su política `INSERT` (por catálogo; no es un `INSERT` de prueba por tabla; el resultado es el mismo en las cuatro bases anteriores):

```sql
WITH t AS (
  SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'project_id' AND NOT a.attisdropped)
), pol AS (
  SELECT p.polrelid, p.polcmd, p.polpermissive,
         COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') || ' ' || COALESCE(pg_get_expr(p.polqual, p.polrelid), '') AS expr
    FROM pg_policy p
), cls AS (
  SELECT t.relname,
         EXISTS (SELECT 1 FROM pol WHERE pol.polrelid = t.oid AND pol.polpermissive AND pol.polcmd IN ('a', '*')) AS politica_insert_permisiva,
         EXISTS (SELECT 1 FROM pol WHERE pol.polrelid = t.oid AND pol.polpermissive AND pol.polcmd IN ('a', '*')
                   AND pol.expr ~ '(can_access_project|user_has_project_access|user_is_project_exempt)') AS mira_proyecto
    FROM t
)
SELECT count(*) AS tablas, count(*) FILTER (WHERE NOT politica_insert_permisiva) AS sin_politica_insert,
       count(*) FILTER (WHERE politica_insert_permisiva AND mira_proyecto) AS con_funcion_de_acceso,
       count(*) FILTER (WHERE politica_insert_permisiva AND NOT mira_proyecto) AS sin_chequeo FROM cls;
-- 217 | 28 | 8 | 181.  Contando también las políticas RESTRICTIVAS como «política INSERT» salen 26 | 8 | 183: la diferencia son
-- fiscal_pac_secrets y payfac_secrets, cuya única política es «Deny access to all» (ALL, restrictiva, USING false) y no admiten INSERT.
```

## 9. El arnés `run.sh` y las migraciones que caen fuera (o dentro) de la serie `20261027*` (F2-12)

`run.sh` (no se modificó) construye la cadena en cuatro tramos (`run.sh` §3): **(1)** todo lo anterior a `20261021000000`; **(2)** las siete del bloque (`2026102[12345]…`, cada una dos veces); **(3)** **todo lo que no es `20261027*`** (`[[ "$base" != 20261027* ]]`: ahí cae la `20261026000600` del #928); tras eso toma la foto `catalogo_previo` (y `catalogo_pre0900`, y con este paquete `catalogo_pre1000`, justo antes de cada una); **(4)** la serie `20261027*`. Los pasos **6c y 6d** comparan lo revertido contra esas fotos, **tomadas antes de la serie**.

| Migración | Dónde cae | Efecto en 6c / 6d |
|---|---|---|
| `20261026000600` (PR #928) | **antes** de la serie (tramo 3: versión menor que `20261027…`) | entra en `catalogo_previo`; la reversión de la serie no la toca; **no afecta**. Medido: rc = 0 y 988 ✓ igual que sin ella; solo cambian los objetos comparados (+5: 9 618 / 9 802 / 9 762 frente a 9 613 / 9 797 / 9 757) |
| `20261027001000` (este PR) | **dentro** de la serie (justo después de la 0900) | su efecto está en `catalogo_migrado`, así que la reversión total tiene que deshacerlo: **por eso lleva `reversion_script.patch`** (su sección encima de la de la 0900 y, en `run.sh`, la foto `catalogo_pre1000` y las dos comparaciones parciales) |
| una migración `20261027…` imprevista que toque políticas o funciones existentes | **dentro** de la serie | la reversión total no la devuelve a `catalogo_previo`: 6c falla (ver abajo) |
| una migración posterior con versión que no es `20261027*` (p. ej. `20261028…`) que dependa de la serie | **antes** de la serie (tramo 3) | su pre-vuelo se detiene con `COMPRAS_MIGRACION_REQUISITOS` (README §7, reproducido con esta propuesta) |

**Regla:** la 0600 conserva su versión `20261026000600`; todo lo que haya de caer dentro de la serie trae su sección de reversión y, si 6c/6d lo piden, excluye sus objetos de los *diffs* **en su propio PR**. `run.sh` no se toca aquí. La interacción con el PR #927 (`20261028000000`) no se probó: no está en este árbol.

**Reproducción del caso «dentro de la serie sin reversión» (F2-12):** el paquete con la 0600 de `d1aeb94a` renombrada a `20261027000950` (cae dentro de la serie, entre la 0900 y la 1000) : **medido en esta revisión**, `run.sh` se detiene en el paso 6c con `❌ la reversión no deja el catálogo como estaba` —sobran las funciones `asignacion_bloquear_propia()`, `asignacion_puede_administrar(uuid,uuid)` y `asignacion_validar_empresa()` y cambian las políticas `user_project_assignments_delete`, `_insert` y `_update`—, tras 8 m 36 s, mientras que con la misma 0600 en su versión `20261026000600` (antes de la serie) la corrida completa da rc = 0 y 988 ✓. El escéptico la hizo pasar (985 ✓) solo tras adaptar a mano esos dos *diffs* en su copia.
