# Housekeeping · el responsable es un usuario elegible, no un texto libre

Migración `20261030000100_housekeeping_responsable_usuario`. Sustituye el campo libre «Nombre del limpiador»
por una asignación a una cuenta real de la empresa, sin tocar la autoría histórica (quién creó, inició, completó
o subió cada foto) y sin vincular por nombre los responsables antiguos. Complementa
[`HOUSEKEEPING_EVIDENCIAS.md`](HOUSEKEEPING_EVIDENCIAS.md) (fotos, autoría y borrado coordinado).

## Archivos

| Qué | Dónde |
|---|---|
| Migración (columnas, elegibilidad, trigger, RPC del catálogo) | `supabase/migrations/20261030000100_housekeeping_responsable_usuario.sql` |
| Suite SQL (Postgres real, sesiones emuladas, mutantes) | `supabase/tests/housekeeping_responsable/` (`run.sh`, `assert.sql`, `datos.sql`, `fixture_rbac.sql`) |
| Datos de prueba del sandbox y su retirada | `supabase/tests/housekeeping_responsable/sandbox_datos_hkr.sql`, `sandbox_limpieza_hkr.sql` |
| Dominio (catálogo, estado que se muestra, preselección, buscador, línea del PDF) | `src/domain/condominios/housekeepingResponsable.ts` |
| Selector y línea «Responsable» | `src/components/condominios/tabs/ResponsableSelector.tsx` |
| Pestaña, detalle con evidencias y PDF | `src/components/condominios/tabs/HousekeepingTab.tsx`, `HousekeepingEvidencias.tsx`, `housekeepingPdf.ts` |
| Pruebas de interfaz y dominio | `src/components/condominios/tabs/__tests__/HousekeepingTab.responsable.test.tsx`, `src/domain/condominios/__tests__/housekeepingResponsable.test.ts`, `src/components/shared/__tests__/UsuarioChip.test.tsx` |
| Recuperación | `scripts/reversion-housekeeping-responsable.sql` |
| Capturas de la prueba real en el sandbox | `docs/capturas/housekeeping_responsable/` |
| CI | paso «Housekeeping — responsable como usuario elegible» en `.github/workflows/coverage.yml` |

## Identidades separadas

Cada columna la escribe una sola cosa y nadie la cambia después:

| Columna de `servicios_housekeeping` | Significa | Quién la escribe |
|---|---|---|
| `creado_por` | quién creó el servicio | `trg_sellar_creado_por` (ya existía) |
| `iniciado_por` / `completado_por` (+ `_en`) | quién lo inició / completó | `trg_hk_sellar_ejecucion` (ya existía) |
| `servicio_housekeeping_fotos.creado_por` | quién subió cada foto | sello de la tabla de fotos (ya existía) |
| **`responsable_user_id`** → `app_users(id)` `ON DELETE SET NULL` | quién es responsable del servicio | el cliente, validado por `trg_hk_responsable` |
| **`responsable_asignado_por`** → `auth.users(id)`, **`responsable_asignado_en`** | quién hizo la última asignación y cuándo | **solo la base** (el trigger ignora lo que mande el cliente) |
| `responsable` (texto) | nombre escrito antes de esta migración | nadie: la pantalla ya no lo manda |

El responsable sigue el modelo de identidades vigente (`app_users.id = auth.users.id`, igual que `asignado_a`
en otras tablas). Reasignar cambia solo las tres columnas nuevas: el trigger copia los sellos de autoría del
registro anterior aunque la petición intente sobrescribirlos (comprobado por la API: un `PATCH` a `creado_por` o a
`responsable_asignado_por` devuelve 200 y no cambia nada).

## Quién es elegible (la misma regla que para entrar al módulo)

`hk_responsable_elegible(usuario, empresa, proyecto)` es verdadero cuando la cuenta está habilitada
(`activo`), es de esa empresa, no es `cliente`, el proyecto pertenece a la empresa, **tiene el permiso
`condominios.tab.housekeeping`** y **tiene acceso al proyecto**. Las dos últimas se evalúan *para esa cuenta* con
las reglas vigentes, no con una interpretación nueva:

- `usuario_tiene_permiso(usuario, permiso)` (nueva) es el espejo por usuario de `user_has_permission`: roles
  exentos (`super_admin`, `superadmin`, `company_owner`, `admin`) → sí; una fila `deny` vigente → no; una fila
  `allow` vigente (sin caducar) → sí.
- `usuario_acceso_a_proyecto(usuario, proyecto)` (ya existía, 20260906000400) es el espejo de
  `user_is_project_exempt() OR user_has_project_access()`: propietarios, administradores sin asignaciones (exentos),
  `app_users.project_id` o una fila en `user_project_assignments`.

La suite SQL comprueba cuenta por cuenta que `hk_responsable_elegible` coincide con `hk_acceso` evaluado como esa
sesión (13 cuentas × 3 proyectos). Conjuntos esperados: P1 = {dueña, admin acotado, operador, operador bis,
admin exento, asignación explícita}; P2 = {dueña, operador P2, admin exento}; PB = {admin B}.

**Asignar no concede nada.** Ninguna política cambia: la asignación es un dato del servicio, no un permiso.
Quien ya no es elegible (acceso revocado, deshabilitado, caducado) sigue sin ver el proyecto aunque sea
responsable de un servicio; el servicio conserva el vínculo y la pantalla lo marca «requiere reasignación».

## Validación en el servidor

- `trg_hk_responsable` (BEFORE INSERT OR UPDATE) valida al **crear**, al **reasignar** y al **mover de
  proyecto o empresa** un servicio con responsable. Rechaza con `HK_RESPONSABLE_NO_ELEGIBLE` (`23514`,
  `check_violation`). Corre también con `service_role` y ante peticiones directas a PostgREST: filtrar el selector
  en React no es la defensa.
- Si el responsable **no cambia**, no se revalida: un servicio cuyo responsable perdió el acceso sigue siendo
  editable (notas, estado, costo) sin perder el historial.
- Quien asigna debe poder escribir el servicio: lo deciden las políticas RLS de `servicios_housekeeping` (sin
  cambios) y `canActInCondominiosTab(..., 'create' | 'edit')` en la pantalla.
- `hk_responsables_elegibles(p_project_id)` devuelve el catálogo para el selector. Exige que el llamador tenga
  `hk_acceso` a la empresa y al proyecto (`42501 No autorizado` / `Proyecto fuera de la empresa`): nadie obtiene la
  lista de un proyecto que no puede escribir. Devuelve `id, full_name, role, activo` aunque el directorio de
  `app_users` no exponga esa persona al llamador (un operador no ve a otros operadores en el directorio; sí los
  recibe aquí, con nombre, para elegirlos y mostrarlos).
- Las funciones nuevas son `SECURITY DEFINER` con `search_path = ''`, `REVOKE ... FROM PUBLIC`; solo la RPC del
  catálogo se concede a `authenticated`. Sus guardas van con `COALESCE(…, false)`: una sesión de la API sin perfil
  (`get_my_company_id()` NULL) no pasa por NULL (regla de 20261029000000).

## Pantalla

- **Crear**: el usuario conectado va preseleccionado si está en el catálogo (marcado «(tú)»); si no lo está, no
  se preselecciona a nadie y el formulario exige elegir un responsable válido («Responsable requerido»). El
  buscador filtra por nombre o rol sin distinguir mayúsculas ni acentos y solo ofrece lo que devolvió el servidor.
- **Cambiar de proyecto, empresa o sesión**: cierra el formulario, limpia la selección y vuelve a pedir el catálogo
  (efecto sobre `[proyectoId, companyId, userId]`; una respuesta tardía de un proyecto anterior se descarta).
- **Editar**: si el responsable actual ya no es elegible, el formulario lo avisa, no lo ofrece y, si no se cambia,
  se conserva tal cual. Un responsable heredado (texto) aparece como «Responsable anterior sin vincular: …» y
  solo se vincula si alguien elige a un usuario; la pantalla nunca vuelve a escribir `responsable`.
- **Agenda, detalle y PDF** muestran al responsable separado del autor de las evidencias: en la tarjeta,
  «Responsable» frente a «Inició/Completó»; en el PDF, «Responsable: …» frente a «Iniciado por», «Completado por» y
  «Evidencias (fotos) subidas por: …» (nombres distintos de los que subieron cada foto).
- Si la base rechaza al responsable (`HK_RESPONSABLE_NO_ELEGIBLE`) la pantalla lo explica y recarga el catálogo.

## Compatibilidad

- `responsable` (texto) se conserva tal cual y no se vincula por coincidencia de nombre, ni en la migración ni en
  la pantalla (la suite lo comprueba con un texto idéntico al nombre de una cuenta).
- No hay reasignación en bloque: la migración no escribe `responsable_user_id` en ninguna fila.
- `responsable_user_id` admite NULL en la base (filas antiguas y servicios cuyo usuario se borró →
  `ON DELETE SET NULL`); la obligatoriedad al crear la impone la pantalla.

## Pruebas

| Capa | Qué | Cómo correrla |
|---|---|---|
| SQL (Postgres 16 desechable) | 168 comprobaciones: equivalencia con `hk_acceso` cuenta por cuenta; catálogo; crear/rechazar (otra empresa, otro proyecto, sin módulo, deshabilitado, caducado, denegado, cliente, id inventado) por sesión y por `service_role`; manipulación directa (sellos, mover de proyecto); reasignar conserva creado/iniciado/completado/fotos/texto; revocación conserva el historial y no da acceso; heredados sin vincular; borrado de usuario → SET NULL; inventario y ACL. Idempotencia (se aplica dos veces con huella) y 4 mutantes que deben fallar (sin acceso al proyecto, sin empresa, sin `activo`, sin sello del asignador). | `supabase/tests/housekeeping_responsable/run.sh` (`PGPORT_TEST` opcional) |
| SQL de #927 con esta migración encima | la suite de evidencias sigue pasando con 20261030000100 aplicada | `supabase/tests/housekeeping_evidencias/run.sh` |
| SQL de #930 (`fail_open_sin_perfil`) con esta migración encima | la matriz función × sesión recorre también `hk_responsables_elegibles` (nueva, ejecutable por `authenticated`) y la juzga frente a las sesiones sin perfil; la suite anota en `fos.posteriores` las funciones que traen migraciones posteriores a su serie en vez de exigir que estuvieran «antes» | `supabase/tests/fail_open_sin_perfil/run.sh` |
| Interfaz y dominio (vitest) | 14 de dominio, 11 de la pestaña, 8 del chip | `npx vitest run src/components/condominios src/domain/condominios src/components/shared` |
| Guardas del repo | `migrations-guard`, `append-only`, `type-check`, `lint` | CI |

## Verificación en el sandbox existente (`jwpmivhvlstslncrtokb`, 2026-10-15)

Nada de esto tocó producción. Ninguna clave ni contraseña se imprimió: las cuentas de prueba usan contraseñas
aleatorias fijadas en la misma llamada SQL (`set_config('hkr.pwN', …)`) y guardadas solo fuera del repositorio.

**Migraciones.** El sandbox iba por `20261026000500`; se pusieron al día en orden con
`apply-migrations-sandbox.yml` (0600, 0700, 29000000, 29000100, 30000000) y luego `20261030000100` desde la rama
(run 38679070210, success). Después: 575 versiones, máx. `20261030000100`; funciones `usuario_tiene_permiso`,
`hk_responsable_elegible`, `hk_responsable_validar`, `hk_responsables_elegibles`; trigger `trg_hk_responsable`;
columnas `responsable_user_id`, `responsable_asignado_por`, `responsable_asignado_en`.

**Datos ZZ HKR** (`sandbox_datos_hkr.sql`; ids `5b5b3000-…`): empresa A con P1 y P2, empresa B con PB; siete
cuentas: f1 dueña, f2 operadora P1, f3 operador P1 bis, f4 operador P2, f5 operador P1 sin el módulo (rol de
cuotas), f6 operador P1 deshabilitado, f7 admin de B; un servicio heredado con `responsable = 'Limpiador Antiguo'`.
El acceso de los operadores es una fila en `user_project_assignments` (la pantalla la exige: sin ella el operador
ve «No tienes ningún proyecto asignado»).

**Catálogo por cuenta (SQL, sesión emulada con el claim del JWT y `SET ROLE authenticated`):**

| Cuenta | P1 | P2 | PB |
|---|---|---|---|
| f1 dueña | dueña, operador P1 bis, operadora P1 | dueña, operador P2 | — |
| f2 operadora P1 | dueña, operador P1 bis, operadora P1 | `42501 No autorizado` | — |
| f4 operador P2 | `42501 No autorizado` | dueña, operador P2 | — |
| f5 sin módulo | `42501 No autorizado` | — | — |
| f7 admin de B | `42501 Proyecto fuera de la empresa` | — | admin B |

**Pantalla real (build del árbol de esta PR con la URL y la clave pública del sandbox, servido por HTTPS local bajo
un nombre con forma de preview de Vercel; Chromium con Playwright; inicio de sesión real por contraseña):**

| Paso | Resultado |
|---|---|
| f2 abre «+ Nuevo Servicio» | preseleccionada «ZZ HKR Operadora P1 (tú)»; el catálogo ofrece dueña, operador P1 bis y operadora P1 (no f4, f5, f6 ni f7); el filtro «operadora» deja una (`10-f2-alta-preseleccion.png`, `11-f2-catalogo.png`) |
| f2 crea, inicia y completa | `creado_por = iniciado_por = completado_por = responsable_asignado_por = f2`, `responsable_user_id = f2` |
| f2 reasigna a f3 por la pantalla (filtro «bis») | tarjeta: «Responsable: ZZ HKR Operador P1 bis · Completó: ZZ HKR Operadora P1»; sellos intactos (`15-f2-reasignado.png`) |
| f1 (dueña) abre el detalle y sube una foto | cabecera con responsable f3; foto con `creado_por = f1` (`21-f1-evidencia.png`) |
| PDF generado por f1 | «Responsable: ZZ HKR Operador P1 bis», «Iniciado por / Completado por: ZZ HKR Operadora P1», «Evidencias (fotos) subidas por: ZZ HKR Dueña» (`informe-pdf-texto.txt`) |
| f1 cambia de P1 a P2 con el formulario abierto | el formulario se cierra; al reabrir, preselecciona a la dueña y el catálogo pasa a dueña + operador P2 (dos llamadas a la RPC, una por proyecto; `32-f1-P2-catalogo.png`) |
| f4 (operador P2) | solo ve P2, no ve el servicio heredado de P1; catálogo dueña + «Operador P2 (tú)» (`40-f4-P2-catalogo.png`) |
| f5 (sin módulo) | «Acceso Denegado» en la pestaña; sin botón de alta |
| servicio heredado | «Responsable anterior sin vincular: Limpiador Antiguo» en la tarjeta y el detalle; al editar no se vincula solo |

**Peticiones directas a PostgREST con la sesión real de f2** (saltándose el selector):

| Petición | Respuesta |
|---|---|
| `PATCH responsable_user_id` = f7 (otra empresa), f5 (sin módulo), f4 (otro proyecto), f6 (deshabilitado), id inventado | `400 23514 HK_RESPONSABLE_NO_ELEGIBLE` (×5) |
| `PATCH project_id` = P2 (mover el servicio con responsable de P1) | `400 23514` |
| `POST` servicio con responsable f4 / f7 | `400 23514` (×2) |
| `PATCH responsable_asignado_por` = f7, `responsable_asignado_en` = 2020 / `PATCH creado_por` = f7 | `200`, **sin efecto**: la base conserva f2 y la hora real |
| `PATCH responsable_user_id` = f1 y luego f3 (elegibles) | `200` |
| `rpc/hk_responsables_elegibles(P2)` | `403 42501 No autorizado` |

**Revocación.** Se retiró el acceso de f3 a P1 (su asignación y el `app_users.project_id` heredado, que las reglas
vigentes también cuentan como acceso). Resultado: `hk_responsable_elegible(f3, A, P1) = false`; el servicio conserva
`responsable_user_id = f3` y su foto. Para f2 la tarjeta muestra «requiere reasignación» y al editar el formulario
avisa y no ofrece a f3 (`50-f2-requiere-reasignacion.png`); f2 reasigna a la dueña y el aviso desaparece
(`52-f2-reasignado-duena.png`): `responsable = dueña`, `asignado_por = f2`, `creado/iniciado/completado = f2`,
foto de la dueña. f3 inicia sesión: «No tienes ningún proyecto asignado»; por la API no ve el servicio (`[]`),
el `PATCH` no afecta filas y el catálogo de P1 le da `403 42501` (`60-f3-sin-acceso.png`). Asignar no le dio nada.

**Borrado.** La dueña borra el servicio por la pantalla: `hk_eliminar_servicio` → 1, `housekeeping-limpieza`
`tomadas 1, borradas 1` (foto y objeto retirados). Después, `sandbox_limpieza_hkr.sql` en modo ensayo (revertido)
y, con autorización, aplicado; ver la PR.

## Recuperación

`scripts/reversion-housekeeping-responsable.sql`, no se ejecuta solo: **A)** contener (quita trigger y funciones,
conserva columnas y asignaciones; volver a aplicar la migración lo restaura); **B)** cerrar solo el catálogo
(`REVOKE EXECUTE` de la RPC); **C)** revertir exactamente (borra las tres columnas; con copia previa);
**D)** comprobaciones de solo lectura. Ninguna sección toca `responsable` ni los sellos de autoría.

## Despliegue

Solo la migración; no hay funciones Edge ni secretos nuevos. Producción se aplica por `apply-migrations.yml` con
la aprobación `production-db`, una migración por ejecución, tras las ya desplegadas (`20261030000000` es la última
en producción). No hay relleno de datos: los servicios existentes quedan con su texto como «anterior sin
vincular» hasta que alguien los edite.

## Límites conocidos

- Un responsable **revocado** se muestra con nombre solo si el directorio de `app_users` lo expone al que mira
  (propietarios y administradores); un operador ve «Usuario xxxxxxxx» + «requiere reasignación», porque ya no viene
  en el catálogo. El vínculo y el historial están intactos.
- `responsable_user_id` no es `NOT NULL` en la base (compatibilidad con filas antiguas y `ON DELETE SET NULL`):
  una petición directa puede crear un servicio sin responsable; la pantalla no lo permite.
- La elegibilidad por **permiso** se evalúa con un espejo por usuario de `user_has_permission`
  (`usuario_tiene_permiso`); si esa función cambia, hay que cambiar el espejo (la suite compara ambas).
- `app_users.project_id` sigue contando como acceso al proyecto porque las reglas vigentes
  (`user_has_project_access`) lo cuentan; revocar de verdad exige retirar también ese valor.
