# Impacto de la propuesta de alcance de proyecto (`propuesta_alcance_proyecto.sql`)

Todo lo de abajo se midió en **PostgreSQL 16 desechables** (puertos 55621-55629) con la **cadena completa del PR #926** (las diez migraciones, `20261027000000` … `20261027000900`) y `fixture.sql`, sobre una copia de trabajo de `supabase/` y `scripts/` (`cp -r`, sin tocar el checkout). La propuesta se aplicó como una migración **temporal** `20261027001000` en esa copia. Las aserciones del repositorio **no se tocaron**: donde se necesitó adaptar una para demostrar que es la única diferencia, la adaptación vive en una **tercera copia** (§3.4) y se lista tal cual. Nada se escribió en producción, en el sandbox ni en la base de preview: lo único que tocó producción son los `SELECT` de §1.

## 1. Datos de producción (solo lectura, `SELECT`, proyecto de producción, 2026-10-10)

| Consulta | Resultado |
|---|---|
| Documentos con `project_id IS NULL` | `ordenes_compra` **0** de 1 · `recepciones` **0** de 0 · `facturas_proveedor` **0** de 1 · `ordenes_pago` **0** de 0 · `contrasenas_pago` **0** de 0 · `recepcion_respaldos` **0** de 0 · `orden_compra_eventos` **0** de 0 |
| Los dos documentos que existen | la orden histórica (`recibida`) y la factura (`anulada`) **tienen proyecto**: no hay ninguna orden histórica sin proyecto |
| Personas por rol en `app_users` | `super_admin` 1 · `company_owner` 1 · `admin` 1 (con 3 proyectos asignados: no es exento) · `operator` 7 · `viewer` 13 · `cliente` 9 |
| Personas exentas de proyecto hoy (`user_is_project_exempt()`) | **2** (el superadministrador y el propietario) |
| `app_users.project_id` (el otro camino de `user_has_project_access`) | 0 de 32 |
| Llaves de permiso con «sin proyecto» / «todos los proyectos» / «exento» en `permissions` | **0**: no existe ninguna llave explícita que pudiera reutilizarse |

## 2. La matriz completa, tabla × brecha × vía × persona (615 celdas, antes y con la propuesta)

Cada celda se ejecutó como la persona (`SET ROLE` + `request.jwt.claim.sub`) dentro de una subtransacción que se deshace. «API» = `INSERT` / `UPDATE … WHERE id = …` (el camino de PostgREST); «función `SECURITY DEFINER`» = una función de juguete que hace el `UPDATE` por id sin pasar por la RLS (modela cualquier RPC definer). Leyenda: ✅ pasa (1 fila) · ⛔ rechazo `42501` · ⚓ rechazo `23514` de su ancla (`COMPRAS_RECEPCION_ORDEN_AJENA` / `COMPRAS_PAGO_FACTURA_AJENA`: la recepción y la orden de pago atan su proyecto a su orden / factura, antes y después) · 〇 **0 filas** (la política `SELECT` esconde el documento; no es éxito) · `RLS` rechazo de la política · `EMP` `COMPRAS_ALCANCE_EMPRESA` · **a → b** = hoy → con la propuesta.

**Resumen: 615 celdas, 60 cambian, todas `✅ → ⛔` de una persona acotada** (`ua` 22 · `adm2` 22 · `uo` 16). No cambia ninguna celda de las exentas, de `service_role`, de otra empresa ni de `anon`.

Notas de lectura: (1) el rechazo de «A → B» y «NULL → B» ya lo da la 0900 (`trg_zzcompras_mover_alcance`, «…proyecto de destino») y se conserva con su mismo mensaje porque el disparador nuevo dispara **después**; (2) «B → A» / «B → NULL» por la API dan 0 filas **antes y después**, y por una función definer ya las rechazaba la 0900 («…proyecto en que está hoy»); (3) la recepción y la orden de pago no se pueden mover de proyecto sin su orden / factura (⚓), así que para ellas la brecha es solo la **inserción** (a)(b) —y, cuando su ancla ya está «sin proyecto», la propuesta cierra también esa inserción—; (4) la contraseña de pago de la prueba tiene un número fijado por el sistema para que el índice único del número (por contabilidad) no tape el resultado del alcance: sin eso, mover una contraseña de A a NULL falla por `uq_contrasenas_numero` (otro defecto, ajeno a esto: la numeración es por contabilidad).

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

**`anon` (con el DML que conserva en producción) · vía API (PostgREST: `WHERE id = …`)**

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

### 3.1 Línea base de este entorno (copia pristina, sin la migración nueva)

`bash supabase/tests/compras_bloque_b/run.sh` con `PGPORT_TEST=55622`: **rc = 0**, `✅ compras (orden → recepción → factura → seguimiento) verificado contra PostgreSQL real`, **985 líneas `✓`** (el informe del PR cuenta 986: la copia no tiene historial `git`, así que el paso 7 `migrations-append-only` imprime «omitido» en vez de su `✓`). Las dos corridas con la migración nueva tampoco tienen ese paso.

### 3.2 Con la migración temporal y las aserciones tal cual: la corrida se detiene en la primera

`run.sh` termina en la primera invariante incumplida: **`assert_inventario.sql:72`** (`❌ invariante incumplida … COMPRAS_ALCANCE_PROYECTO: un documento de compras sin proyecto …`). Para ver **todas** las diferencias (no solo la primera) se corrió una copia «indulgente» (en la copia de análisis, `\set ON_ERROR_STOP off` y los `chk*` cuentan en vez de abortar; el repositorio no se toca) de la batería completa con y sin la migración, archivo por archivo.

### 3.3 Qué cambia de resultado: EXACTAMENTE esto

De los **54 archivos SQL** (16 `assert_*.sql` + 38 de `hallazgos/`) y los pasos de `run.sh`, **cambian cuatro archivos y dos comprobaciones de `run.sh`**; los pasos posteriores a §5r (idempotencia y reversión de la 0900, protección de inventario, concurrencia §6 y §6b: 83 líneas `✓` comparadas una por una) dan lo mismo salvo esas dos comprobaciones de §6c. Todo lo demás da el mismo número de `✓`, `✗` y errores (incluidas `PERM-1`, `PERM-2`, `PERM-4`, `SEP-1…6`, `SEP-idempotencia`, `SEP-reversion`, la concurrencia de §6 y §6b, `RG-4*`, `CONC-*`, `VER-*`, `EV-02…09`, `DEP-*`, `RG-3`):

| # | Archivo:línea | Qué prueba (y qué hace) | Persona | Hoy | Con la propuesta | Por qué | Efecto |
|---|---|---|---|---|---|---|---|
| 1 | `assert_inventario.sql:71-72` | «Una orden de la contabilidad de la EMPRESA (sin proyecto) no tiene bodega»: el montaje inserta la orden `OE` con `project_id NULL` | `UO` (operador del padrón, con C1 y C2: no exento) | pasa | `INSERT` rechazado `42501` «…sin proyecto … solo lo crea una persona exenta de proyecto…» | `NULL` solo para exentos (D-1) | `:73-75` `[1 · una orden de la contabilidad de la empresa no admite insumos de bodega]` pasa a ✗ (la orden no existe: FK `orden_compra_lineas_orden_compra_id_fkey`): **33 ✓ → 32 ✓, 1 ✗, 1 error** |
| 2 | `hallazgos/EV-01.sql:243-251` | `[EV-01i]` contabilidad de la empresa: la factura (`:244`), la contraseña (`:247`) y —por herencia— la orden de pago (`:251`) con `project_id NULL`; la partida (`:249`) falla en cascada por FK | `UA` (administrador con C1 y C2: no exento) | pasa | las tres `INSERT` rechazadas `42501` | idem | `:254`, `:258`, `:266`, `:268` pasan a ✗: **31 ✓ → 27 ✓, 4 ✗, 4 errores** |
| 3 | `hallazgos/EV-10.sql:119-120` | `[EV-10c4]` LEGÍTIMO: una orden de la contabilidad de la empresa (sin proyecto) puede llevar una obra de la empresa | `UA` | pasa | `INSERT` rechazado | idem | `:122` pasa a ✗: **20 ✓ → 19 ✓, 1 ✗, 1 error** |
| 4 | `hallazgos/PERM-3.sql:338` | `[INSERT oc aprobada] una orden SIN proyecto es de la empresa: con la llave nace aprobada` (documenta **P-PERM-1**) | `okc` (operador de A con la llave de la orden) | pasa (`perm_filas … 1`) | rechazado `42501` | **es justo la decisión D-1 / R2**: la aserción describe el comportamiento que el dueño aún no decidió | el bloque `$oc_insert$` aborta en `:338` y no ejecuta las 13 comprobaciones de `:340-369`: **119 ✓ → 106 ✓, 1 error** |
| 5 | `run.sh` §6c, reversión **total** (`scripts/reversion-compras-controles.sql`) | el catálogo revertido debe ser EXACTO al previo a `20261027000000` | — | ✓ | ❌ sobran 12 objetos (3 funciones y 9 disparadores de la propuesta) | el script generado no conoce la migración nueva | hay que añadir la sección de `20261027001000` (el contenido de `reversion_alcance_proyecto.sql`) **encima** de la de la 0900 |
| 6 | `run.sh` §6c, reversión **parcial** de la 0900 | la sección de la 0900, **sola**, devuelve el catálogo al posterior a la 0800 | — | ✓ | ❌ sobran los mismos 12 objetos | la prueba supone que la 0900 es la última migración | revertir primero la sección de la 1000 y después la de la 0900 (una línea de `run.sh`) |

Por qué ninguna es un fallo de la propuesta: las filas 1-4 son **montajes** (o, la 4, una aserción que documenta lo que la propuesta cambia a propósito) en los que una persona **no exenta** crea un documento de la contabilidad de la Empresa; las filas 5-6 son contabilidad de la reversión. En el PR propio, el montaje de 1-3 pasa a hacerse con una persona exenta o con el sistema (`como_sistema`) y la 4 se invierte a un rechazo; el flujo que prueban (pagar la contraseña de la empresa, el asiento sin proyecto, la obra de la orden de la empresa) **no cambia**.

### 3.4 Prueba de que esas seis son TODA la diferencia: la batería completa en verde con esas seis adaptadas

Tercera copia de trabajo = la copia con la migración temporal + (a) las cuatro aserciones adaptadas con el mínimo cambio (1-3: el `INSERT` sin proyecto lo hace el sistema —`como_sistema` / sesión sin usuario— en vez de la persona no exenta; 4: `perm_filas … 1` → `perm_falla … 42501 '^COMPRAS_ALCANCE_PROYECTO: un documento de compras sin proyecto'`), (b) la sección de la 1000 en `scripts/reversion-compras-controles.sql`, (c) `run.sh` §6c parcial que revierte antes la sección de la 1000 y (d) `PRJ-1.sql` copiada a `hallazgos/` (la recoge el glob de §5r). Resultado (`PGPORT_TEST=55622`): **rc = 0**, `✅ compras (orden → recepción → factura → seguimiento) verificado contra PostgreSQL real`, **986 líneas `✓`**: las 985 de la línea base más `✓ PRJ-1 · 854 comprobaciones`. Comparando línea por línea las secciones y los `✓` de la línea base y de esta corrida, **la única diferencia es esa línea de `PRJ-1`** (más un tiempo impreso dentro del texto de una línea de `CONC-01`: «en 0s» contra «en 1s»). La reversión total (9 613 objetos) y la parcial de la 0900 (9 757 objetos) vuelven a ser exactas; `SEP-idempotencia` (nueve pasadas) y `SEP-reversion` siguen en verde (la propuesta no reemplaza nada de la 0900).

Comprobación aparte de las cuatro aserciones, cada una sola en una base nueva: con la migración y SOLO el paso de creación movido a una persona exenta / al sistema, `assert_inventario` 33 ✓ · `EV-01` 31 ✓ · `EV-10` 20 ✓ · `PERM-3` 119 ✓ (los mismos números que sin la migración): la diferencia es el paso de creación, y nada más.

## 4. Las demás suites (`supabase/tests/*/run.sh`, 62 aparte de `compras_bloque_b`)

Con la migración temporal presente y **sin tocar ninguna aserción**, se corrió cada `supabase/tests/<suite>/run.sh` (cada una arma su propia cadena en su propio clúster). **61 de 62 dan `rc = 0`** y **1 da distinto: `compras_cierre_tecnico`**. (Una primera pasada con dos y cuatro clústeres a la vez dio varios `pg_ctl: could not start server` —el mismo fallo de arranque que el informe del PR ya registra para `personal_usuario`—; esas suites se repitieron una por una y todas dieron `rc = 0`. Las suites que arman solo una parte de la cadena —por ejemplo `compras_flujo`, `proveedores_pr_a`, `conta_*`— no aplican la migración nueva: su resultado no cambia por construcción; las que aplican la cadena completa la ejercitan.)

| Suite | Con la migración y sin tocar nada | Por qué | Adaptación mínima y resultado |
|---|---|---|---|
| `compras_cierre_tecnico` | `rc = 3` en el paso 4: `fixture_lectura.sql:88` → `COMPRAS_ALCANCE_PROYECTO … asignado al proyecto` | `:83-88` siembra 4 órdenes de pago (de C1, C2, la empresa y de D) como superusuario **pero con el `sub` de `UD` todavía puesto** por el `como(:UD)` anterior (`RESET ROLE` no borra `request.jwt.claim.sub`): para el servidor es una sesión de usuario de la empresa D insertando en proyectos de C. Y `:126-128` / `:136-138` crean con `UA` (administrador con C1 y C2, no exento) la orden y la recepción de la contabilidad de la **Empresa** (`project_id NULL`) | `set_config('request.jwt.claim.sub', '', false)` antes de `:84`, y la orden y la recepción «de la empresa» las siembra el sistema (tres cambios mínimos en el fixture): `rc = 0` y **31 ✓**, los mismos 31 ✓ de la línea base |

Las 61 que dan `rc = 0` sin tocar nada: `acl_definer_expuestas_anon`, `actividad_equipo`, `balance_jornada`, `catalogo_contable_inicial`, `cierre_consumo_atomico`, `compras_flujo`, `comunicados_difusion_residente`, `consumo_insumos`, `conta_ajustes`, `conta_auxiliares_tipo_cargo`, `conta_cobros_bloqueos`, `conta_cobros_cargos`, `conta_cobros_cuotas`, `conta_contabilizacion_cargos`, `conta_cuentas_especiales`, `conta_estado_cuenta`, `conta_pagador_designado`, `conta_pendientes_reproceso`, `conta_rechazo_cobros`, `conta_reglas_imputacion`, `conta_saldos_favor`, `conta_tipo_cambio_mensual`, `cumplimiento_calidad_firma_inequivoca`, `declarar_triggers_fill_company_id`, `drift_produccion`, `drift_turnos`, `evidencia_al_cerrar`, `gastos_duplicados`, `insert_solo_pendiente`, `limpieza_catalogos`, `materializar_rutinas`, `notificaciones_actividad`, `notificaciones_reservas_entrega`, `personal_usuario`, `policies_empresa`, `policies_rondas`, `politica_jornada`, `pr27_project_id`, `presencia_correccion`, `presencia_marcaje`, `presencia_pausas`, `proteger_update_registros`, `proveedores_pr_a`, `puntos_verificacion`, `rbac_recursos_humanos`, `registrar_lectura`, `reparar_estado_tareas_bloque`, `reversa_helpers_rbac`, `rls_initplan_suministros`, `rutas_operadores`, `rutinas_limpieza`, `salud_notificaciones`, `security_definer_anon`, `security_logs_acceso`, `snapshot_al_crear`, `snapshot_del_scope`, `solicitud_renta_contrato`, `tareas_bloque_paridad`, `trazabilidad`, `turnos`, `webhook_stripe_idempotencia`.

Una variante que **no** se entrega, medida: con el bloque opcional de «la empresa del `INSERT` es la de la sesión» (README D-5) falla además `conta_reglas_imputacion/assert.sql:490-493` (siembra una factura de la empresa B con la sesión —el `sub`— de la empresa A) con `COMPRAS_ALCANCE_EMPRESA`; por eso ese bloque no está en el prototipo.

## 5. Código de la pantalla (Vitest) con la migración presente en `supabase/migrations/`

`vitest run src/domain/compras src/components/contabilidad src/components/condominios src/domain/cxp src/lib/__tests__/platformPermissions.test.ts`: **177 archivos y 2 050 pruebas en verde (rc = 0)**. Antes de reescribir los mensajes eran 3 rojos en `src/domain/compras/__tests__/erroresMigraciones.test.ts`: esa prueba lee cada `RAISE` de las migraciones y exige que la pantalla los clasifique igual **con y sin SQLSTATE**; los tres mensajes de «sin proyecto» no traían la frase «necesita estar asignado al proyecto» y caían en la familia `otro` (se mostraban con el código técnico). Ahora los cinco `COMPRAS_ALCANCE_PROYECTO` de la propuesta la llevan y la prueba pasa sin tocar `errores.ts` ni la prueba. `node scripts/migrations-guard.mjs` con la migración presente: ✅ (RLS y policies, RPC con alcance, `SECURITY DEFINER` nuevas con `REVOKE` de `PUBLIC`).

## 6. Flujos de la pantalla afectados (lectura de `src/`, con archivo y línea)

El servidor solo cambia para **personas no exentas** y solo en lo que crea o mueve **sin proyecto** o **en un proyecto que no tienen**. La pantalla no necesita cambios para seguir funcionando con un proyecto asignado; lo que cambia es el flujo de la contabilidad de la **Empresa**.

| Dónde | Qué hace | Efecto |
|---|---|---|
| `src/components/contabilidad/ContabilidadSection.tsx:79-83, 111, 139-146` | el selector «Contabilidad» arranca en `🏢 Empresa` (`project_id = null`) salvo que `localStorage` recuerde un proyecto; pasa `ledgerProjectId` a `ComprasTab` (`:207`) y `CuentasPorPagarTab` (`:210`) | una persona **acotada** que abra Compras o Cuentas por pagar sin elegir proyecto verá el rechazo del servidor al guardar. **Afecta a Alexander Monterroso (operador, 6 proyectos) y a Marco Santos Godoy (administrador con 3 proyectos, no exento)**; en producción hoy no hay ningún documento sin proyecto, así que nadie lo usó |
| `src/domain/compras/mutations.ts:129-143` (`crearOrdenTransaccional`, `p_project_id: projectId ?? null`) ← `ComprasTab.tsx:559` (`useCrearOrdenCompraMutation(companyId, projectId)`), `:577` | nueva orden de compra de Contabilidad › Compras | con «Empresa»: `COMPRAS_ALCANCE_PROYECTO` (sin proyecto); con su proyecto: igual que hoy |
| `src/domain/compras/mutations.ts:225-239` (`crearRecepcionTransaccional`) ← `ComprasTab.tsx:671` | registrar recepción | idem |
| `src/domain/compras/mutations.ts:287-298` (`useCrearContrasenaMutation`, `insert({ …, project_id: projectId ?? null })`) ← `CuentasPorPagarTab.tsx:551`; partidas (`contrasena_pago_facturas`) en `:305-320` | emitir contraseña de pago | idem; las partidas pasan si la cabecera es de su proyecto |
| `src/domain/cxp/mutations.ts:82-100` (`crearFacturaProveedor`, `p_project_id: project_id ?? null`) ← `CuentasPorPagarTab.tsx:386, 682-789` | nueva factura de proveedor | idem |
| `src/domain/cxp/mutations.ts:159-170` (`useCrearOrdenPagoMutation`, `project_id: vars.projectId`) ← `CuentasPorPagarTab.tsx:1014` (`projectId: factura.project_id`) | solicitar orden de pago | hereda el proyecto de la factura: si la factura está sin proyecto y la persona no es exenta, rechazo; con factura de su proyecto, pasa |
| `src/domain/compras/mutations.ts:360-380` (`useCrearOrdenPagoDeContrasenaMutation`, `project_id: vars.contrasena.project_id`) | orden de pago de una contraseña | idem (hereda de la contraseña) |
| `src/components/condominios/tabs/OrdenesCompraTab.tsx:134` (editar borrador: manda `project_id: proyectoId` y `company_id` en el `UPDATE`) y `:156` (crear, `proyectoId` es siempre un proyecto) | Operaciones › Órdenes de compra | **sin cambio**: `UPDATE OF project_id` con el mismo valor no mueve nada (la propuesta lo deja pasar y `PRJ-1` lo comprueba), y crear lleva siempre el proyecto de la pestaña |
| `compras_lineas_importar_aplicar` (carga masiva de renglones) | inserta renglones en una orden en borrador | pasa si la orden es de un proyecto de la persona o no tiene proyecto; no pasa en un borrador de un proyecto que no tiene |
| Funciones de borde (`supabase/functions/`) | ninguna escribe estas cinco tablas (búsqueda en el repositorio) | — |

Lo que el servidor devuelve en esos casos es un texto que la pantalla ya muestra tal cual (`ComprasTab.tsx:121`, `mensajeAccionCompras` en `src/domain/compras/errores.ts`), sin el código técnico: «Un documento de compras sin proyecto (la contabilidad de la Empresa) solo lo crea una persona exenta de proyecto; si no lo eres, tu perfil necesita estar asignado al proyecto del documento: elige uno de los tuyos.» Un ajuste opcional de pantalla (D-8 del README) sería deshabilitar las altas cuando el libro activo es «Empresa» y la persona no es exenta; no es necesario para que nada se rompa.

## 7. Costo, bloqueos y datos

* **Datos:** no crea índices, restricciones ni columnas, y no escribe ni reescribe ninguna fila; el post-vuelo exige que los conteos de documentos no cambien.
* **Bloqueos al aplicar** (medido con `pg_locks` dentro de la propia transacción): **9 tablas con `ShareRowExclusiveLock`** (deja leer, bloquea escrituras durante los milisegundos de la transacción) — `ordenes_compra`, `recepciones`, `facturas_proveedor`, `ordenes_pago`, `contrasenas_pago`, `orden_compra_lineas`, `recepcion_lineas`, `factura_proveedor_lineas`, `contrasena_pago_facturas` —; `lock_timeout = 10 s` y `statement_timeout = 120 s`. Revertir usa `DROP TRIGGER` (`AccessExclusiveLock`, bloquea incluso las lecturas hasta el final de la transacción): correrla fuera de uso.
* **Costo por escritura** (1 000 cabeceras y 1 000 renglones insertados como persona acotada en su proyecto, dentro de una transacción que se deshace; máquina compartida y cargada, así que es ruidoso): 

| | cabecera (`ordenes_compra`), por `INSERT` | renglón (`orden_compra_lineas`), por `INSERT` |
|---|---|---|
| sin la propuesta (mediana de 5 corridas) | 1,12 ms | 1,59 ms |
| con la propuesta (mediana de 5 corridas) | 1,50 ms | 1,90 ms |
| diferencia | **+0,4 ms** (cada cabecera ya pasa por unos 26 disparadores) | **+0,3 ms** |

Rangos: cabeceras 1 036-1 237 ms contra 1 396-1 542 ms por 1 000; renglones 1 513-1 667 ms contra 1 787-2 067 ms por 1 000 (con la máquina casi sin carga).
* **Idempotencia y reversión:** aplicada dos veces, la huella del catálogo no cambia entre la primera y la segunda; añade **exactamente 12 objetos** (3 funciones, 9 disparadores) y la reversión (dos veces) devuelve los 9 805 objetos del catálogo EXACTOS. Con la propuesta aplicada, `SEP-idempotencia.sh` (la 0900 aplicada nueve veces) y `SEP-reversion.sh` siguen en verde: por eso es aditiva.
* **Pre-vuelo:** si falta algo de la 0900 se detiene con `COMPRAS_MIGRACION_REQUISITOS` y no cambia nada (probado quitando el disparador de mover, la función `compras_sesion_usuario()` y una tabla). Es la misma clase de desfase que dejó a `Supabase Preview` del PR #926 sin la 0800 final.

## 8. Cómo se reproduce

```bash
# cadena del PR #926 + fixture en un clúster desechable (como run.sh pasos 1-4), luego, en copias de esa base:
psql -d <copia> -f supabase/tests/compras_bloque_b/pendientes_decision/proyectos/PRJ-1.sql      # ROJA sin la propuesta (PGOPTIONS="-c prj.continuar=si" para contar)
psql -d <copia> -f supabase/tests/compras_bloque_b/pendientes_decision/proyectos/propuesta_alcance_proyecto.sql   # ×2
psql -d <copia2> -f supabase/tests/compras_bloque_b/pendientes_decision/proyectos/PRJ-1.sql    # VERDE
psql -d <copia2> -f supabase/tests/compras_bloque_b/pendientes_decision/proyectos/reversion_alcance_proyecto.sql   # ×2; reversion_catalogo.sql idéntico al previo
```
