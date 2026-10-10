# PENDIENTE (fuera del PR #926 y de la migración 0900) · alcance de proyecto al capturar y «sin proyecto» solo para personas exentas

**Estado: PROPUESTA con un prototipo SQL PROBADO en una base desechable. NO es una migración del PR #926 (ya tiene diez, el tope de `MAX_APPLY`: no habrá undécima), NO se desplegó, y nada de esto escribió en producción, en el sandbox ni en la base de preview (solo hubo `SELECT` de lectura sobre producción, abajo).** Se entrega para llevarse como PR propio, con su migración, su push y su corrida de `apply-migrations-prod.yml`, **después** del push del PR #926 (depende de objetos de la 0900).

## 1. En una frase

Una persona acotada a un proyecto (rol `operator`, o `admin` CON asignaciones) puede hoy, por la API, **insertar borradores en un proyecto que no tiene asignado**, **insertar o dejar sus documentos «sin proyecto»** (`project_id = NULL`, que `can_access_project()` trata como «de la empresa»: lo ve y lo aprueba cualquiera con la llave), **reclamar para su proyecto un documento sin proyecto** y **agregar renglones a un borrador de un proyecto ajeno**. La 0900 solo mira el proyecto al cambiar el **estado** y al **mover entre proyectos**; la política `INSERT` no mira el proyecto y las hijas tampoco miran el de su cabecera. La propuesta cierra eso con **un solo punto de decisión** y sin tocar nada de lo que ya funciona.

## 2. Contenido de esta carpeta

| Archivo | Qué es |
|---|---|
| `propuesta_alcance_proyecto.sql` | **El prototipo** (no está en `supabase/migrations/`). Una transacción con `lock_timeout = 10 s`, pre-vuelo (requisitos de la 0900 y conteos), tres piezas aditivas, post-vuelo (los conteos de documentos no cambian). Idempotente |
| `reversion_alcance_proyecto.sql` | **Su reversión**: quita los 9 disparadores y las 3 funciones; devuelve el catálogo EXACTO (9 805 objetos comparados con `reversion_catalogo.sql`). Idempotente; no toca datos ni la 0900 |
| `PRJ-1.sql` | **Prueba SQL de estilo del repo** (`\set ON_ERROR_STOP on`, un `NOTICE ✓` por comprobación, ids `md5('prj:PRJ-1:…')`): tabla × brecha × vía × clase de persona, lo legítimo y el flujo de pantalla de Contabilidad. **ROJA sin la propuesta, VERDE con ella.** No copiarla a `hallazgos/` sin la migración: `run.sh` la recogería por el glob y saldría roja (ese es su sentido) |
| `impacto.md` | La matriz «hoy / con la propuesta» completa, lo que cambia de resultado en la batería existente (aserción por aserción, sin tocarlas), los flujos de pantalla afectados (archivo y línea), costo y bloqueos |

## 3. La regla (un solo punto de decisión)

`compras_puede_destinar_proyecto(proyecto)` = «la persona de la sesión puede dejar un documento en ese proyecto»:

| Proyecto del documento | ¿Quién puede? |
|---|---|
| un proyecto | quien tiene acceso a él (`can_access_project`: asignación, `app_users.project_id` o exención) |
| `NULL` («sin proyecto» = la contabilidad de la **Empresa**) | **solo una persona exenta de proyecto** (`user_is_project_exempt()`: superadministrador, propietario, administrador SIN asignaciones). **No existe hoy ninguna llave explícita para «sin proyecto»** (consultado en el catálogo de producción, solo lectura: 0 coincidencias), así que no se inventa ni se concede ninguna |

Tres piezas, todas **aditivas** (no reemplazan nada de la 0900; revertir = `DROP`):

1. **`compras_puede_destinar_proyecto(uuid)`** — la regla de arriba (`SECURITY DEFINER`, NULL-segura, sin `EXECUTE` para `anon`/`authenticated`).
2. **`trg_zzzcompras_alcance_captura`** (`BEFORE INSERT OR UPDATE OF project_id`, en las cinco tablas): `INSERT` (también **borrador**, por la API, por las RPC `compras_*_crear` y por cualquier función `SECURITY DEFINER`): la persona puede destinar el proyecto del documento. `UPDATE`: pasar **desde o hacia** «sin proyecto» exige exención; mover entre proyectos lo sigue decidiendo `trg_zzcompras_mover_alcance` de la 0900, que **dispara antes** (el nombre lleva tres «z»), con sus mismos mensajes.
3. **`trg_zzzcompras_alcance_hija`** (`BEFORE INSERT OR UPDATE OF <llave a la cabecera>`, en `orden_compra_lineas`, `recepcion_lineas`, `factura_proveedor_lineas` y `contrasena_pago_facturas`): la cabecera (y la de origen, si el renglón cambia de documento) tiene que estar al alcance de la persona. Una cabecera que ya está sin proyecto no se toca.

Solo para **sesiones de usuario**, con la **misma guarda de la 0900** (`compras_sesion_usuario()`): `service_role`, migraciones y procesos de sistema (`conta.allow_system_write`) **nunca** se bloquean, y la acción referencial de **eliminar un proyecto** (`ON DELETE SET NULL`) tampoco. Los mensajes llevan el código `COMPRAS_ALCANCE_PROYECTO` / `COMPRAS_ALCANCE_EMPRESA` con SQLSTATE `42501` y la frase «necesita estar asignado al proyecto»: la pantalla (`src/domain/compras/errores.ts`) ya los reconoce como `alcance_proyecto`, **con o sin** el SQLSTATE, y los muestra sin el código técnico (verificado con `erroresMigraciones.test.ts`, abajo).

**Por qué aditiva y no «extender `compras_tg_mover_alcance`»:** redefinir la función de la 0900 haría que reaplicar la 0900 (la prueba §5s la aplica nueve veces) **deshaga** esta corrección, obligaría a reescribir la sección de la 0900 de la reversión y movería los mensajes que ya fijan `PERM-4` y `erroresFinalesCompras.ts`. Con disparadores nuevos, el catálogo de la 0900 queda intacto y la reversión es un `DROP`.

## 4. La brecha, reproducida HOY y con la propuesta (persona acotada `ua`: operador asignado solo a A, con TODAS las llaves; vía API; matriz completa en `impacto.md`)

Leyenda: ✅ pasa (1 fila) · ⛔ rechazo `42501` · ⚓ rechazo `23514` por su ancla (la recepción y la orden de pago atan su proyecto a la orden / factura) · 〇 **0 filas** (la política `SELECT` esconde el documento; **no es éxito** y `PRJ-1` lo exige como `OK0`, distinto de `OK1`). «a → b» = hoy → con la propuesta.

| Brecha | `ordenes_compra` | `recepciones` | `facturas_proveedor` | `ordenes_pago` | `contrasenas_pago` |
|---|---|---|---|---|---|
| (a) insertar un borrador en **B** (no asignado) | ✅ → ⛔ | ✅ → ⛔ | ✅ → ⛔ | ✅ → ⛔ | ✅ → ⛔ |
| (b) insertar **sin proyecto** | ✅ → ⛔ | ✅ → ⛔ | ✅ → ⛔ | ✅ → ⛔ | ✅ → ⛔ |
| (c) cambiar A → NULL | ✅ → ⛔ | ⚓ | ✅ → ⛔ | ⚓ | ✅ → ⛔ |
| (d) cambiar A → B | ⛔ (0900) | ⚓ | ⛔ (0900) | ⚓ | ⛔ (0900) |
| (e) cambiar NULL → A | ✅ → ⛔ | ⚓ | ✅ → ⛔ | ⚓ | ✅ → ⛔ |
| (e) cambiar NULL → B | ⛔ (0900) | ⚓ | ⛔ (0900) | ⚓ | ⛔ (0900) |
| (f) mover un documento de B (a A o a NULL) | 〇 por la API · ⛔ (0900) por una función definer | 〇 · ⚓ | 〇 · ⛔ | 〇 · ⚓ | 〇 · ⛔ |
| (h) renglón en la cabecera de B | `orden_compra_lineas` ✅ → ⛔ | `recepcion_lineas` ✅ → ⛔ | `factura_proveedor_lineas` ✅ → ⛔ | — | `contrasena_pago_facturas` ✅ → ⛔ |

De las 615 celdas (7 clases de persona × 75 + 2 × 45), **60 cambian y todas son `✅ → ⛔` de una persona acotada** (`ua` 22, `adm2` —administrador con asignaciones— 22, `uo` —operador sin llaves— 16). **No cambia ninguna celda de las exentas (administrador sin asignaciones, propietario, superadministrador), de `service_role`, de otra empresa ni de `anon`.**

Datos de producción (solo `SELECT`, 2026-10-10): **0 documentos con `project_id` NULL en las siete tablas** (`ordenes_compra` 1 de 1 con proyecto; `recepciones` 0; `facturas_proveedor` 1 de 1 con proyecto; `ordenes_pago` 0; `contrasenas_pago` 0; `recepcion_respaldos` 0; `orden_compra_eventos` 0). La orden histórica (`recibida`) y la factura (`anulada`) **tienen proyecto**: no es cierto que haya una orden histórica sin proyecto. Personas exentas hoy: **2** (1 superadministrador y 1 propietario); el administrador (Marco Santos Godoy) tiene 3 proyectos asignados, **no** es exento. `app_users.project_id`: 0 de 32.

## 5. Decisiones abiertas (sí/no, con recomendación)

Ninguna se tomó por el dueño. La propuesta aplica la columna «Propuesta»; cada una se puede cambiar sin tocar el resto.

| Ref. | Pregunta | Propuesta (y qué cambiaría un «distinto») | Recomendación |
|---|---|---|---|
| **D-1** | ¿Se permite «sin proyecto» (la contabilidad de la **Empresa**) a la persona acotada? | **NO**: solo exentas (2 personas hoy en producción). Un «SÍ» exige una llave explícita nueva (no existe) y asignarla: es otra decisión de asignaciones. Se cambia solo `compras_puede_destinar_proyecto` | **NO** por ahora: hoy hay 0 documentos sin proyecto, y el costo es que Alexander Monterroso y Marco Santos Godoy (acotados) dejan de poder abrir la contabilidad «Empresa» para capturar (ver `impacto.md` §6) |
| **D-2** | ¿Qué pasa con los documentos que ya están sin proyecto? | **No se tocan** (la propuesta no migra datos; en producción hay 0). El pre-vuelo informa cuántos hay por tabla | **Dejarlos** y repetir el `SELECT` del pre-vuelo justo antes de desplegar; si apareciera alguno, decidir caso por caso |
| **D-3** | ¿Se rechazan los borradores en proyectos no asignados (API, RPC y funciones definer)? | **SÍ** | **SÍ**: es la brecha (a); ninguna pantalla lo usa |
| **D-4** | ¿Puede la persona acotada seguir actuando (aprobar, pagar, editar renglones) sobre un documento que **ya** está sin proyecto? | **SÍ, no cambia** (`PRJ-1` lo deja como `[límite D-4]`). El «NO» es **una línea**: en `compras_exigir_permiso` cambiar `can_access_project(p_project_id)` por `compras_puede_destinar_proyecto(p_project_id)`; medido en una base desechable: de las 853 comprobaciones de `PRJ-1` cambia **solo esa** (la batería existente no se midió con la variante) | **Mantener SÍ** mientras haya 0 documentos sin proyecto y la creación esté cerrada; revisar cuando se decida D-1 |
| **D-5** | ¿El `INSERT` exige además que la empresa del documento sea la de la sesión (R1 «empresa», para funciones `SECURITY DEFINER`)? | **NO** (no se pidió; en la API ya lo hacen la RLS y `trg_00_compras_rls_empresa`; hoy ninguna función definer inserta en estas tablas). `PRJ-1` deja tres `[límite D-5]`. Medido con el bloque puesto (5 líneas al inicio del `IF TG_OP = 'INSERT'`: `IF NOT (COALESCE(is_super_admin(), false) OR COALESCE(NEW.company_id = get_my_company_id(), false)) THEN RAISE EXCEPTION 'COMPRAS_ALCANCE_EMPRESA: …' USING ERRCODE = 'insufficient_privilege'; END IF;`): **rompe una aserción existente fuera de este módulo**, `conta_reglas_imputacion/assert.sql:490-493` (siembra una factura de la empresa B con la sesión de A), y las tres `[límite D-5]` pasan a rechazo | **SÍ, después**, en otro PR: corregir antes esa siembra (limpiar el `sub`) y entonces añadir el bloque; es defensa en profundidad |
| **D-6** | ¿«Todo UPDATE» (P-PERM-2): comprobar el proyecto también al editar columnas que no mueven el documento? | **NO** (más ancho que el encargo; `PRJ-1` deja `[límite D-6]`: una función definer o un `UPDATE` a ciegas pueden editar el concepto de un borrador de B) | **SÍ**, en otra migración, tras medir el costo de una evaluación más por `UPDATE` |
| **D-7** | ¿Se cubren las hijas (renglones) en el mismo PR? | **SÍ** (pieza 3). Separable: quitar la pieza 3 deja las cabeceras cerradas y los renglones de un borrador ajeno abiertos | **SÍ**: es la misma brecha (a) por otro camino |
| **D-8** | ¿Se ajusta la pantalla para que las personas acotadas no vean «Nueva …» con la contabilidad «Empresa» activa? | **NO en este PR** (solo servidor). Sin ajuste la persona ve el mensaje del servidor al guardar | **SÍ**, en un PR de pantalla aparte o dentro de este (deshabilitar las altas cuando el libro activo es «Empresa» y la persona no es exenta) |

## 6. Evidencia (todo en PostgreSQL 16 desechable, cadena completa del PR #926; los comandos y los conteos están en `impacto.md`)

| Prueba | Resultado |
|---|---|
| `PRJ-1.sql` CON la propuesta | **853 comprobaciones en verde, 0 en rojo** (854 líneas `✓` con la de limpieza; rc = 0) |
| `PRJ-1.sql` SIN la propuesta (modo informe, `PGOPTIONS="-c prj.continuar=si"`) | **125 en rojo y 728 en verde** (los verdes son controles que ya cierran la RLS, la 0900 o la ancla del documento; el rojo son las celdas `✅ → ⛔`, los renglones, el catálogo y el flujo de pantalla). En modo estricto, el de `run.sh`, muere en la primera |
| Autoprueba del arnés (`PRJ-0`, 8 comprobaciones) | 0 filas **no** es éxito donde se espera 1 fila; 1 fila no es éxito donde se espera 0; un rechazo con otro SQLSTATE o por otro motivo **no** pasa por el esperado |
| Mutación: se rompe una pieza a la vez | **41 mutantes, 41 detectados** (regla de decisión, `INSERT` con/sin proyecto, `UPDATE` hacia/desde NULL, salto «mismo valor», salto de eliminar proyecto, guarda de sesión, cada disparador en cada tabla, `AFTER`, nombre, `REVOKE`, `SECURITY DEFINER`, `search_path`, reemplazo de la 0900…). 7 solo los detecta el catálogo (equivalentes en comportamiento: `AFTER`, `OF`, los tres `REVOKE`, `SECURITY DEFINER`, `search_path`); los demás hacen fallar el comportamiento. Dos sobrevivieron a la primera versión de `PRJ-1` (una comparación de empresa NULL-insegura, hoy fuera del prototipo, y el salto «mismo valor» de las hijas) y se cerraron con casos nuevos |
| Aplicar ×2 / revertir ×2 | idempotente; añade exactamente **12 objetos** (3 funciones + 9 disparadores); la reversión devuelve la huella del catálogo **exacta** (9 805 objetos, `reversion_catalogo.sql`); `PRJ-1` vuelve a ponerse roja (125) |
| Pre-vuelo | se detiene con `COMPRAS_MIGRACION_REQUISITOS` y sin cambiar nada si falta el disparador de mover de la 0900, `compras_sesion_usuario()` o una tabla (probado quitando cada uno) |
| Convive con la corrección de `user_project_assignments` | `fix_asignaciones.sql` + esta propuesta + `PRJ-1`: 853 en verde. **Sin** esa corrección, la propuesta es tan firme como esa tabla: `PRJ-1` deja la comprobación `[límite D-0]` (una persona se asigna B y captura en B) |
| Batería `compras_bloque_b/run.sh` con la propuesta como migración temporal `20261027001000` | línea base **rc = 0, 985 ✓** (sin el paso `append-only`, que pide historial `git`). Con la migración y las aserciones tal cual: se detiene en `assert_inventario.sql:72`. Enumerado todo: cambian **cuatro archivos y dos comprobaciones de §6c** (`impacto.md` §3.3). Con esas seis adaptadas al mínimo: **rc = 0, 986 ✓ = 985 + `PRJ-1`**, y la única diferencia con la línea base es esa línea (y un tiempo impreso en una línea de `CONC-01`) |
| Las otras 62 suites `supabase/tests/*/run.sh` | **61 en verde sin tocar nada**; **1 distinta**: `compras_cierre_tecnico` (su `fixture_lectura.sql` siembra con una sesión de usuario ajena y crea con una persona no exenta la orden «de la empresa»; con tres cambios mínimos de siembra: rc = 0, 31 ✓ = línea base) — `impacto.md` §4 |
| Vitest (`src/domain/compras`, `contabilidad`, `condominios`, `cxp`, `platformPermissions`) con la migración presente | **177 archivos, 2 050 pruebas en verde**; incluye `erroresMigraciones.test.ts` (la primera versión de los mensajes daba 3 rojos: sin SQLSTATE no se reconocían como `alcance_proyecto`; se reescribieron con «necesita estar asignado al proyecto») |
| `migrations-guard.mjs` con la migración presente | ✅ |
| Costo | `+0,4 ms` por cabecera y `+0,3 ms` por renglón insertados (1,12 → 1,50 ms y 1,59 → 1,90 ms; mediana de 5); 9 tablas con `ShareRowExclusiveLock` unos milisegundos al aplicar |

## 7. Riesgos

* **Cambia comportamiento para personas acotadas que hoy capturan en la contabilidad «Empresa»**: `ContabilidadSection.tsx` la deja elegida por omisión (`🏢 Empresa`), así que alguien acotado que abra Compras o Cuentas por pagar sin cambiar el selector verá el rechazo al guardar. En producción no hay ningún documento sin proyecto (nadie lo usó), pero el flujo existe (`impacto.md` §6).
* **Es tan firme como `user_project_assignments`**: sin la corrección de `pendientes_decision/asignaciones/`, una persona se asigna el proyecto B y captura en B (y un administrador con asignaciones se vuelve «exento» borrándolas y entonces puede crear sin proyecto). Desplegar **después** de esa corrección, o juntas.
* **Cuatro archivos y dos comprobaciones de la batería existente dejan de cumplir un supuesto** (no son fallos de la propuesta; `impacto.md` §3.3 y §4): `assert_inventario.sql:71-72`, `hallazgos/EV-01.sql:243-251`, `hallazgos/EV-10.sql:119-120` y `hallazgos/PERM-3.sql:338` (montajes que crean con una persona **no exenta** un documento de la contabilidad «Empresa»; el de `PERM-3` documenta justo P-PERM-1), `compras_cierre_tecnico/fixture_lectura.sql:84-88, 126-128, 136-138` (siembra con el `sub` de otra persona y crea «la empresa» con una persona no exenta) y las dos comprobaciones de `run.sh` §6c (la reversión no conoce la migración nueva). Se adaptan en el PR propio; con esas adaptaciones la batería completa da lo mismo que sin la propuesta.
* **Orden de versión**: `20261027001000` es solo el nombre temporal de la prueba. En un *push* a `main`, `apply-migrations-prod.yml` aplica los `.sql` **añadidos en ese push** (no compara versiones, y el tope de diez cuenta solo esos), así que este PR entra con su propia corrida; conviene una versión **posterior a la última aplicada** (p. ej. después de `20261028000000` del PR #927 si ya salió) para que el historial quede en orden.
* **Carrera de cabecera**: el disparador de las hijas lee el proyecto de la cabecera sin bloquearla; un `UPDATE` simultáneo que la mueva entre la lectura y el `INSERT` del renglón no se serializa. Es la misma clase de límite que el resto de comprobaciones de alcance (no hay candado de proyecto) y no abre un proyecto que la persona no tenga.
* **Costo**: dos o tres llamadas a funciones `STABLE` por `INSERT` de cabecera y una búsqueda por llave primaria más `can_access_project` por renglón; medido en `impacto.md` §7: **+0,4 ms por cabecera y +0,3 ms por renglón** (mediana de 5 corridas).

## 8. Cómo desplegarlo sin una undécima migración en el PR #926 (despliegues separados)

1. **No tocar el PR #926**: sigue con sus diez migraciones y en borrador; `MAX_APPLY = 10` no se sube ni se desactiva.
2. **Orden de los pushes a `main`** (cada uno con su propia corrida de `apply-migrations-prod.yml`, cada una por debajo del tope): (1) corrección de `user_project_assignments`; (2) PR #926 (las diez); (3) PR #927; (4) **este PR** (1 migración).
3. **Abrir un PR propio** con: (a) la migración (copia de `propuesta_alcance_proyecto.sql`, con una versión posterior a la última aplicada); (b) `PRJ-1.sql` copiada a `supabase/tests/compras_bloque_b/hallazgos/` (la recoge `run.sh` §5r; no deja ninguna clave de idempotencia en la base, que `VER-09` cuenta); (c) la sección nueva de `scripts/reversion-compras-controles.sql` (el cuerpo de `reversion_alcance_proyecto.sql`, **encima** de la sección de la 0900); (d) en `run.sh` §6c parcial, aplicar antes la sección de la 1000 (una línea); (e) las adaptaciones mínimas de `impacto.md` §3.3 y §4 (cuatro aserciones y el fixture de `compras_cierre_tecnico`); y, si se decide D-8, el cambio de pantalla. Con (a)-(e) la batería completa dio `rc = 0` y la misma salida que la línea base más la línea de `PRJ-1`.
4. **Antes de desplegar, con el pre-vuelo**: (a) confirmar en producción, con `SELECT`, que la 0900 ya está (`to_regprocedure('public.compras_exigir_permiso(text,text,uuid,uuid)')`, 5 disparadores `trg_zzcompras_mover_alcance`); la propia migración se detiene con `COMPRAS_MIGRACION_REQUISITOS` y sin cambiar nada si falta algo (la causa de `Supabase Preview` en el PR #926 es justo esa clase de desfase: una rama que no recibió la 0800 final); (b) repetir el conteo de documentos sin proyecto por tabla; (c) correr la propuesta en el **sandbox** con `apply-migrations-sandbox.yml` y repetir `PRJ-1` allí; (d) aplicar fuera de pagos, aprobaciones y cierres (toma `SHARE ROW EXCLUSIVE` unos milisegundos en 9 tablas y `lock_timeout = 10 s`).
5. **Después**: `apply-migrations-prod.yml` con la aprobación del *Environment* `production-db`; comprobar con `SELECT` los 9 disparadores y que `PRJ-1` (la parte de solo lectura del catálogo) coincide. Reversión: `reversion_alcance_proyecto.sql` (reabre la brecha; los datos no se tocan).

## 9. Verificación que debe repetir quien lo lleve

1. Base desechable con la cadena del PR #926 y `fixture.sql`: `PRJ-1.sql` **roja** (modo informe) → aplicar la propuesta ×2 → `PRJ-1.sql` **verde** → reversión ×2 → `reversion_catalogo.sql` idéntico al de antes → `PRJ-1.sql` roja otra vez.
2. Con la migración puesta: `bash supabase/tests/compras_bloque_b/run.sh` (debe detenerse en `assert_inventario.sql:72` hasta aplicar las adaptaciones de `impacto.md` §3.3) y el barrido de las demás suites (`compras_cierre_tecnico` es la única distinta); comparar con `impacto.md` §3–§4. Si una suite arranca mal con `pg_ctl: could not start server`, repetirla sola.
3. `node scripts/migrations-guard.mjs` y `vitest run src/domain/compras`.
4. Revisar a mano en pantalla: Contabilidad › Compras y Cuentas por pagar con un proyecto asignado (debe seguir igual) y con «Empresa» como persona acotada (debe mostrar el mensaje del servidor).
5. `PRJ-1.sql` se corre **una vez por base** (crea empresas y documentos de compras que no se pueden borrar) y, si una comprobación falla en modo estricto, deja sus ayudas `prj_*` y su padrón en esa base: para repetirla, usar una copia nueva (`CREATE DATABASE … TEMPLATE …`).
