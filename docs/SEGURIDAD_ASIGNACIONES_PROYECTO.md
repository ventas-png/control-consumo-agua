# Seguridad de las asignaciones de proyecto (`user_project_assignments`) y autoridad del principal de la empresa

PR de seguridad **separado** del #926 (compras y contabilidad). **Dos migraciones**, que se despliegan **primero** y en su propio push a `main` (ver «Orden y pasos de despliegue»):

* `supabase/migrations/20261026000600_seguridad_asignaciones_proyecto.sql` — asignaciones de proyecto: nadie cambia las suyas y **sólo el principal de la empresa escribe la tabla**;
* `supabase/migrations/20261026000700_autoridad_principal_empresa.sql` — **sólo el principal** crea y borra proyectos, escribe roles, llaves y asignaciones de roles de la empresa e invita a administradores (11 políticas).

Y, en el mismo PR: las edge functions `create-user` e `invite-user` (el rol `admin` sólo lo otorga el principal), las compuertas de la interfaz y dos guiones de reversión.

## En una frase

Las políticas de escritura de `user_project_assignments` terminaban en
`OR user_id = (SELECT auth.uid())`: cualquier usuario autenticado podía asignarse un proyecto y un
administrador acotado podía borrar sus filas y quedar «exento de proyecto» (ve toda la empresa).
Como `can_access_project()`, `user_is_project_exempt()` y `user_has_project_access()` leen esa
tabla, **el alcance por proyecto no era un límite real contra un usuario hostil**. Ahora nadie
cambia sus propias asignaciones (salvo el propietario y el superadministrador, que son exentos), la
persona y el proyecto tienen que ser de la misma empresa para cualquier actor y —**decisión del dueño del
negocio del 2026-10-11**— la autoridad sobre quién ve qué proyecto, sobre los permisos de la empresa (roles y
llaves), sobre los proyectos y sobre los administradores es del **principal** de la empresa: su propietario
(`company_owner`, dentro de su empresa) o el superadministrador. **Un administrador —acotado o sin filas— no es el
principal.** **No cambia ni una fila.**

**Alcance de la afirmación (léase antes de confiar en ella).** Con las dos migraciones y las dos edge functions, un
administrador *por la API* ya no puede: asignar ni quitar proyectos a nadie (ni a sí mismo ni a otro administrador: D-2 (i)),
crear ni invitar a otro administrador (D-2 (ii): `create-user`, `invite-user` **y** la inserción directa en `user_invitations`),
borrar proyectos (D-2 (iii), F2-03), crear proyectos (D-9) ni escribir roles, llaves o asignaciones de roles de la empresa.
**Lo que sigue abierto, dicho tal cual:**

1. **El rol de servicio y el SQL directo** no pasan por la RLS ni por el trigger de autoasignación (`auth.uid()` nulo): una baja de proyecto
   hecha así sigue pudiendo dejar exento a un administrador (D-6, D-16, V3-06); `delete-user` borra personas sin limpiar sus asignaciones (D-3).
2. **El propietario y el superadministrador** siguen pudiendo dejar exento a un administrador (borrando su último proyecto, D-6): es decisión suya.
3. **Un administrador conserva, por perfil, todas las llaves**: `user_has_permission()` lo deja pasar antes de mirar `role_permissions`. El principal asigna
   llaves a operadores, visores y roles personalizados; **no se las quita a un administrador** (decisión abierta, sin cambiar).
4. **Filas cruzadas heredadas** (D-7, D-10) y la clave del candado con datos heredados (D-17), sin cambio.
5. **Hasta que la 0700 llegue a producción**, un administrador todavía puede escribir roles, llaves y asignaciones de roles, crear y borrar proyectos
   e insertar invitaciones con rol `admin` **por la API** (medido en una copia con el texto de las políticas de producción).
6. **Un `UPDATE` o un `DELETE` que la RLS rechaza devuelve 0 filas SIN error**; sólo el `INSERT` da 42501 (o un `UPDATE` cuyo `WITH CHECK` rechaza la fila
   nueva). La interfaz lee de vuelta tras guardar; cualquier cliente que sólo mire el error verá un éxito falso.
7. Una empresa **sin propietario** sólo la administra el superadministrador: en la última lectura de producción (2026-10-11, anterior a esta ronda; no se volvió a leer) la única empresa con proyectos tiene un propietario y la del superadministrador no tiene proyectos; el pre-vuelo de la `0700` informa de las que no lo tengan.

## Historial de este PR

| Ronda | Qué pasó |
|---|---|
| 1 | Migración, suite contra PostgreSQL real, interfaz y documento (`0a8b3983`…`1794dc8f`) |
| 2 | **Supabase Preview** aplicó por primera vez la migración en una base construida solo con migraciones y la **abortó**: «privilegios de la tabla mal repartidos» (P0, ver «Lección de ACL»). Dos verificaciones independientes (ataque hostil y flujos/interfaz/CI) encontraron además una carrera real en la baja en cascada (F1) y varios defectos menores. Esta versión corrige todo lo corregible y deja el resto como decisión de negocio (`d1aeb94a`) |
| 3 | **Segunda verificación independiente** (ataque hostil; interfaz, pruebas y documento; paquetes del #926). Corrige la carrera de la baja en cascada **entre dos administradores que comparten proyectos** (R2-1: candado global), los post-vuelos que dependían del `search_path` de la sesión (R2-3), la interfaz tras un guardado parcial (F2-01), las pruebas de interfaz y de guardas que faltaban (F2-08, F2-09), el diagnóstico de `run.sh` (F2-10) y las frases inexactas del documento. Lo que no es técnico queda como decisión (F2-03, R2-2). Ver «Tercera ronda» |
| 4 | **Tercera verificación independiente** (#928 y paquetes del #926). Encuentra que el candado global de la ronda 3 dejaba a un propietario de cualquier empresa bloquear las bajas de proyecto de todas las demás (V3-01, media; el documento decía que no había camino de denegación de servicio), una clase de fallo de la interfaz que quedaba sin cubrir (V3-02, respuesta perdida de la primera escritura), huecos de pruebas (V3-03), la reversión con `search_path` vacío (V3-04) y la carrera residual del rol de servicio (V3-06). Acota el candado a la empresa de la persona, y corrige y documenta el resto. Ver «Cuarta ronda» |
| 5 | **Cuarta verificación independiente** (la «ronda 4 de verificación» de los informes; #928). Ningún hueco nuevo de datos, pero 12 puntos. **Interfaz**: las casillas no se reconciliaban tras un guardado parcial o incierto y el siguiente «Guardar» podía deshacer el trabajo de otro administrador —borrar una asignación ajena o **reinsertar una recién revocada**— (H1, media); un guardado tardío que cerraba el modal de otra persona (H2) y la ventana de un render al cambiar de persona sin remontar (H3); dos mutantes vivos (H4); y un `code` de pasarela tomado como respuesta de la base (H5). **Candado**: un ciclo determinista de interbloqueo con **tres** peticiones de **una** sola sentencia (H-01), el aislamiento `REPEATABLE READ` (H-02), el alcance de la clave con datos heredados (H-03, H-04), dos mutantes del candado que sobrevivían a la suite (H-05) y dos límites menores (H-06, H-07). Corrige lo corregible (H1–H5, H-05), **reescribe como límite medido** lo que el documento afirmaba de más (H-01, H-03, H-04, H-06, H-07) y deja el endurecimiento de H-02 como **decisión abierta, sin implementar**. Ver «Quinta ronda» |
| 6 | **Decisión del dueño del negocio (2026-10-11)**: la autoridad es del *principal* de la empresa (propietario o superadministrador); un administrador, acotado o exento, no lo es. Reescribe la regla de las asignaciones (lectura amplia: sólo el principal escribe; la condición de «proyectos que él ve» y D-1 desaparecen), añade la migración `0700` (proyectos, roles, llaves, asignaciones de roles e invitaciones `admin`), las compuertas de `create-user`/`invite-user`, las de la interfaz, y cierra D-2 (i)(ii)(iii) y D-9 en lo que alcanza (no el rol de servicio ni el SQL directo). El barrido de las 63 suites encontró una prueba de este árbol que asumía que un administrador borra roles (`auditoria_roles`, corregida) y la combinación con el #926 otras dos (`DEP-5` y `PERM-4` de `compras_bloque_b`, **sin adaptar: son del #926**). Ver «La decisión del dueño del negocio (2026-10-11)» y «Combinación con el #926» |

## La decisión del dueño del negocio (2026-10-11): la autoridad es del principal de la empresa

Las decisiones abiertas D-2 (administradores que se dejan exentos o fabrican otros administradores) y D-9 (quién crea proyectos) y la pregunta de a quién se le asignan las llaves nuevas de compras y contabilidad (#926) las resolvió el dueño del negocio el 2026-10-11, en estas palabras (se copian literales):

* Permisos y llaves: «Deberia de quedar para que el principal de la empresa asigne permisos.»
* Proyectos: «Deberia ser en funcion del que tiene los permisos de la empresa y todos los proyectos.»

**Cómo se leyó, y es una lectura** (si el dueño quiso decir otra cosa, es un cambio acotado: la regla `asignacion_puede_administrar` y 11 políticas, ver abajo). *Principal* = quien tiene los permisos de la empresa y ve todos sus proyectos:

| `app_users.role` | ¿Principal? | Sobre qué empresa |
|---|---|---|
| `company_owner` (propietario) | **Sí** | Sólo la suya (`company_id = get_my_company_id()`) |
| `super_admin` / `superadmin` (superadministrador, las dos grafías) | **Sí** | Cualquiera |
| `admin` (administrador), **acotado** (con filas de asignación) **o sin filas** («exento») | **No** | — |
| Operador, visor, cliente y cualquier otro | No | — |
| Un operador (o quien sea) con un **rol RBAC** de «administrador» en `user_roles` | No | Se mide `app_users.role` y nada más |
| Una sesión sin fila en `app_users` | No | — |
| El propietario de **otra** empresa | No sobre ésta | Su autoridad acaba en su `company_id` |

No se crea ninguna función nueva: es `public.is_super_admin() OR public.is_company_owner()`, las dos que ya usaban las políticas.

### Por qué el administrador sin filas NO es el principal (la lectura literal que se descartó)

«El que tiene los permisos de la empresa y todos los proyectos» también podría leerse como «cualquier persona que ve todos los proyectos», y un administrador sin filas los ve todos (es *exento*, `user_is_project_exempt()`). Se descartó porque **la exención no es una cualidad de la persona sino un estado de la tabla, y se fabrica**. Estos son los caminos que la dejaban en manos de quien no la tenía (el 1 está leído en el código de las edge functions y cubierto con vitest, no ejecutado en Deno; del 2 al 5 hay caso en la suite de SQL, antes y después):

1. `create-user` e `invite-user` dejaban a un administrador crear **otro administrador**, que nace sin filas, es decir exento (F-04).
2. Una invitación con `role = 'admin'` insertada **directamente** en `user_invitations` (PostgREST): la lista blanca de las funciones de borde no es un control, porque `accept-invitation` crea el `app_users` con `invitation.role` sin saber quién invitó.
3. Borrar por la API el último proyecto de **otro** administrador (F2-03).
4. Borrar el propio último proyecto con dos sesiones `REPEATABLE READ` (D-16).
5. Que el propietario o el superadministrador borren las filas de un administrador (D-6): ésa sí es una decisión de ellos.

Si «principal» fuera «exento», cualquiera de esos caminos entregaría **la autoridad** (crear más principales, repartir llaves, borrar proyectos), no sólo la visibilidad. La suite lo mide con una mutación: con la regla escrita como `user_is_project_exempt()` en vez de «propietario o superadministrador» la prueba del principal se pone en rojo (`run.sh`, mutaciones de la regla). Y los permisos de la empresa —roles, llaves, altas y ascensos en `app_users`— ya estaban en el modelo en manos del propietario (`app_users_*` sólo admitía `company_owner`), así que la lectura «propietario o superadministrador» es la que no cambia lo que el modelo ya decía.

### La regla de las asignaciones (`20261026000600`), reescrita: lectura amplia

Antes (D-1): el administrador administraba a personas y proyectos de su empresa, nunca a sí mismo y sólo los proyectos que **él** veía. Ahora:

* **Superadministrador**: cualquier persona y cualquier proyecto.
* **Propietario**: la persona **y** el proyecto son de su empresa (`app_users.company_id` de la persona y `projects.company_id` del proyecto, ambos `= get_my_company_id()`), **también a sí mismo** (es exento: no cambia su alcance).
* **Cualquier otro rol, incluido el administrador**: nada. Devuelve siempre `true`/`false`, nunca `NULL`.

**Por qué ya no hace falta «los proyectos que él ve».** Esa condición existía porque la subconsulta de la política anterior corría bajo la RLS de `projects` y un administrador **acotado** sólo repartía —y sólo podía borrar— sus proyectos; sin ella, el «borrar todas y volver a insertar» de la pantalla habría borrado asignaciones a proyectos que ese administrador no ve y no podía restituir. El único actor no superadministrador que escribe ahora es el propietario, que es exento y **ve todos los proyectos de su empresa**: la condición sería redundante, y el guardado de la pantalla no pierde filas ajenas por esa vía. La regla es más simple (dos ramas) y la prueba que justificaba la condición ya no aplica; D-1 queda **superada**, no abierta.

`asignacion_bloquear_propia` (el trigger de autoasignación y el candado de bajas en cascada) **no cambia**: `md5(prosrc)` = `a6ba72f5d332034ec60f4fa339543238` (3 642 caracteres) antes y después (comparado sobre el texto del `HEAD` anterior y el actual). Sigue siendo la defensa en profundidad: una sesión de la API (`auth.uid()` no nulo) no toca sus propias filas salvo que sea propietario o superadministrador.

### La `20261026000700`: 11 políticas, sólo el principal

`ALTER POLICY` (mismos nombres, comandos y roles de base de datos; sólo cambian las expresiones). Donde decía `current_user_role() = ANY (ARRAY['company_owner','admin'])` pasa a `public.is_company_owner()`; se **conservan exactamente** los demás predicados de producción (rol no de sistema, empresa del rol, persona de la empresa, `assigned_by`, la rama `is_super_admin()`).

| Tabla | Política | Antes | Ahora |
|---|---|---|---|
| `projects` | `projects_insert` (WITH CHECK) | superadministrador, o propietario/administrador de la empresa | superadministrador, o **propietario** de la empresa (D-9, opción c) |
| `projects` | `projects_delete` (USING) | ídem | ídem que `projects_insert` (D-2 iii, F2-03) |
| `roles` | `roles_insert`, `roles_update` (USING y WITH CHECK), `roles_delete` | …o propietario/administrador | …o **propietario** |
| `role_permissions` | `role_permissions_insert`, `role_permissions_delete` | …o propietario/administrador | …o **propietario** (las llaves) |
| `user_roles` | `user_roles_insert`, `user_roles_delete` | …o propietario/administrador | …o **propietario** |
| `user_invitations` | `user_invitations_insert` (WITH CHECK), `user_invitations_update` (WITH CHECK) | propietario/administrador de la empresa | lo mismo **y** `(role <> 'admin' OR is_company_owner() OR is_super_admin())`: invitar operadores, visores o cobros sigue permitido a un administrador; invitar a un **administrador**, no |

No cambian: `projects_update` (los administradores siguen configurando fiscal y cobros), ninguna política de **lectura**, `user_invitations_delete`, `app_users_*` (que ya eran sólo del propietario) ni las 7 políticas de esas cinco tablas que no se tocan (de las 18 que existen, 11 cambian y 7 conservan el `md5` de producción: la suite lo comprueba contra el texto leído en producción el 2026-10-11).

La migración **no cambia ninguna fila** (conteo y `md5` de la fila completa de las cinco tablas antes y después; aborta si difieren), ni ningún privilegio, función ni trigger. Su pre-vuelo no consulta ninguna ACL ni depende del `search_path` (el texto de `pg_get_expr` cambia con el `search_path`: se normaliza quitando `public.` y `auth.`), la lección del P0 de la `0600`; compara las 18 políticas con el texto de producción y **aborta si hay deriva** en vez de sobrescribir un predicado que no es el que se leyó. Las dos migraciones del PR (`0600` y `0700`) deben ir en el **mismo push** (2 archivos, bajo el tope `MAX_APPLY = 10`) y antes de la serie del #926.

### Las edge functions y la interfaz

* **`create-user` e `invite-user`**: el rol `admin` sólo lo otorga o invita el principal. Un administrador que lo intenta recibe **403** con «Solo el propietario de la empresa puede crear administradores.» / «…invitar administradores.» (`createRoleDenial`/`canCreateRole`, `canInviteRole`). **No se ejecutaron en Deno**: se probaron sus funciones puras con vitest y el cableado de los manejadores se comprobó leyendo el código fuente en una prueba. `delete-user` y `accept-invitation` **no cambian** (ver «Lo que sigue abierto»).
* **Interfaz** (`src/domain/empresa/usuarios.ts`): `esPrincipalEmpresa`, `puedeEditarAsignaciones` (el principal puede; un administrador no, con «Solo el propietario de la empresa asigna proyectos, permisos y administradores.», y sobre su propia fila la autoedición conserva su motivo), `puedeCrearProyectos` (el botón «Nuevo Proyecto» se deshabilita para quien no sea principal, con «Solo el propietario de la empresa crea proyectos.») y `veAsistentePrimerProyecto` (el asistente de primer proyecto, sólo el propietario). **El servidor es el que manda**: la interfaz sólo evita ofrecer lo que será rechazado. Hoy ningún administrador llega a esas pantallas (`/empresa` es sólo del propietario): son defensa en profundidad por si un día se abren.

### Lo que esto cierra y lo que no (dicho tal cual)

| Qué | Estado |
|---|---|
| Un administrador asigna o quita proyectos (a sí mismo, a otro administrador, a cualquiera) por la API | **Cerrado** (`0600`): 0 filas o 42501 |
| Un administrador crea otro administrador con `create-user`/`invite-user` | **Cerrado en el código** (403); vale cuando las funciones se **desplieguen** (workflow de funciones, aparte del de migraciones) |
| …o insertando la invitación con `role = 'admin'` en `user_invitations` | **Cerrado** (`0700`) |
| Un administrador borra proyectos (F2-03: deja exento a otro; D-16: se deja exento él con dos sesiones `REPEATABLE READ`) | **Cerrado** para la API (`0700`: `projects_delete` es del principal) |
| Un administrador crea proyectos (D-9: ya no queda con un proyecto que no ve) | **Cerrado** (`0700`, opción c) |
| Un administrador escribe roles, llaves o asignaciones de roles de la empresa | **Cerrado** (`0700`) |
| El **rol de servicio** y el **SQL directo** | **Siguen abiertos**: no pasan por la RLS (el rol de servicio tiene `BYPASSRLS`) ni por el trigger de autoasignación (`auth.uid()` nulo). Una baja de proyecto hecha así puede dejar exento a un administrador (D-6, D-16, V3-06) |
| Un administrador **conserva, por perfil, todas las llaves** | **Sin cambio**: `user_has_permission()` lo deja pasar antes de mirar `role_permissions`. El principal asigna llaves a operadores, visores y roles personalizados, pero **no se las puede quitar a un administrador**. Decisión abierta |
| El propietario y el superadministrador pueden dejar exento a un administrador (borrar su último proyecto, D-6) | Es decisión suya |
| `delete-user` sigue sin limpiar las asignaciones de la persona (D-3) y `accept-invitation` sigue creando el `app_users` con el rol de la invitación | **Sin cambio** (no se tocaron). Con la `0700` la invitación `admin` ya sólo la inserta el principal |
| **Hasta que la `0700` llegue a producción**, un administrador todavía escribe RBAC, crea y borra proyectos e inserta invitaciones `admin` por la API | Medido en una base con el texto de las políticas de producción (control negativo de `run.sh`) |
| Filas cruzadas heredadas (D-7, D-10) y la clave del candado con datos heredados (D-17) | Sin cambio |
| Una empresa **sin propietario** sólo la administra el superadministrador | El pre-vuelo de la `0700` lo informa (en el padrón de la suite, con la forma de producción, hay 1 empresa con administradores y sin propietario). En la última lectura de producción (2026-10-11, anterior a esta ronda; **no se volvió a leer**) la única empresa con proyectos tiene un propietario y la del superadministrador no tiene proyectos |

**Un `UPDATE` o un `DELETE` que la RLS rechaza devuelve 0 filas SIN error**; sólo el `INSERT` (y un `UPDATE` cuyo `WITH CHECK` rechaza la fila nueva) da 42501. La interfaz ya lee de vuelta tras guardar; cualquier cliente que sólo mire el error verá un éxito falso.

**Advertencia sobre `user_has_permission()`**: que un rol RBAC (`user_roles`) lleve la llave `compras.*` o «administrador» **no** convierte a nadie en principal: la autoridad se mide por `app_users.role`. Un operador con el rol RBAC de sistema «Admin Plataforma» recibe 42501/0 filas en todas las escrituras sensibles (`assert_principal.sql`, actor `OP2`).

## Hallazgo

`supabase/migrations/20260417000013_consolidate_rls_policies_part2.sql` (líneas 539-580) creó las cuatro
políticas con la misma expresión:

```sql
is_super_admin()
OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
    AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
OR user_id = (SELECT auth.uid())        -- razonable en SELECT; el hueco en INSERT / UPDATE / DELETE
```

Producción tiene exactamente esas cuatro políticas (leídas con un `SELECT` sobre `pg_policy`, solo lectura,
2026-10-10; el texto de `pg_get_expr` coincide con el de la cadena de migraciones). Además, `anon` y
`authenticated` tienen sobre la tabla **los siete privilegios** (`SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
REFERENCES, TRIGGER`; en PostgreSQL 17 también `MAINTAIN`); la RLS es lo único que los frena. La tabla no tiene
llave foránea hacia las personas (`user_id` no apunta a `app_users`) ni triggers propios, y ninguna función de
`public` ni ninguna edge function la escribe: el único flujo de escritura de la aplicación es la pantalla
`AsignacionModal`.

## Riesgo real: qué se podía hacer y qué no

Reproducido con la suite `supabase/tests/asignaciones_proyecto/` sobre la base **sin** las migraciones (control
negativo: **98 de 160 casos de la matriz se ponen en rojo**, y con la `0600` sola el principal sigue en rojo en
30 de sus 244 casos; los demás son lo legítimo y lo que ya estaba cerrado). La columna «Después» describe el estado con las dos migraciones (`0600` + `0700`) y las edge functions.

| Qué | Antes de la migración | Después |
|---|---|---|
| Un operador, visor o cualquier rol se asigna otro proyecto de **su** empresa (`POST /rest/v1/user_project_assignments`) | **Se podía** (1 fila). Desde ese momento `can_access_project()` le abre el proyecto | `ASIGNACION_PROPIA_NO_PERMITIDA` (42501) |
| …un proyecto de **otra** empresa | **Se podía**: la fila se crea. El acceso efectivo a datos depende de que cada política pida además la empresa: **77 políticas** (70 de `public` y 7 de `storage`) nombran la asignación o sus helpers y **8 de ellas conceden por la asignación sola, sin condición de empresa** (R2-2, D-7, D-10): una fila cruzada equivale a **leer pagos y contadores, tarifas y unidades** de la otra empresa (medido con datos, ver abajo) | `ASIGNACION_EMPRESA_DISTINTA` (23514) |
| Un administrador acotado borra **sus** filas | **Se podía** (3 filas) y `user_is_project_exempt()` pasa de `false` a `true`: ve toda la empresa | 0 filas; sigue acotado |
| Cambiar su fila de proyecto, pasarla a otra persona, cambiar su `permission_type` | **Se podía** | 0 filas |
| Un administrador asigna a una persona de **otra** empresa, a una **huérfana** (`user_id` sin `app_users`), a alguien **sin empresa** o a un **cliente** | **Se podía** (la política solo miraba el proyecto, nunca a la persona) | `ASIGNACION_EMPRESA_DISTINTA` |
| Un administrador con un solo proyecto lo borra por la API (`DELETE FROM projects`): la baja en cascada le quita su última fila y queda exento | **Se podía** (reproducido a mano en la base sin la migración) | Con la `0700`, **0 filas**: un administrador ya no borra proyectos. Con la `0600` sola, `ASIGNACION_PROPIA_NO_PERMITIDA`; si le queda otra asignación, el borrado sí procede (D-5). **Dos sesiones a la vez** también están cerradas, incluso de DOS administradores que comparten proyectos (F1, R2-1: candado de bajas en cascada **por empresa**, V3-01) |
| Un administrador borra por la API el último proyecto de **otro administrador**: la cascada deja a éste sin filas, es decir **exento** | **Se podía** | **Cerrado para la API con la `0700`**: un administrador ya no borra proyectos (0 filas). Con la `0600` **sola** se podía (F2-03): el trigger solo vigila las filas **propias** de quien borra. Lo siguen pudiendo el propietario, el superadministrador, el rol de servicio y el SQL directo (D-6) |
| Un administrador **crea o borra proyectos**, **crea roles de la empresa, concede llaves (`role_permissions`) y asigna roles (`user_roles`)** | **Se podía** (las políticas admitían `company_owner` y `admin`; medido con el texto de producción) | Rechazado: 42501 en los `INSERT`, 0 filas en los `UPDATE`/`DELETE` (`0700`; sólo el principal) |
| Un administrador se fabrica **otro administrador** insertando una invitación con `role = 'admin'` en `user_invitations`, o con `create-user`/`invite-user` (el nuevo nace sin filas, es decir **exento**) | **Se podía** (F-04) | 42501 en la invitación (`0700`) y 403 en las funciones de borde; invitar operadores, visores o cobros sigue permitido a un administrador |
| `TRUNCATE` / `TRIGGER` / `REFERENCES` para `authenticated`; los siete privilegios para `anon` | Concedidos. PostgREST no expone `TRUNCATE`, así que no era explotable por la API, pero era un privilegio de sobra | Retirados |

**Cómo se contó «77 políticas»** (reproducible con un `SELECT`; en producción y en la cadena de migraciones da lo mismo):

```sql
SELECT n.nspname, count(*)
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('public', 'storage')
   AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
       ~ 'can_access_project|user_has_project_access|user_is_project_exempt|user_project_assignments'
 GROUP BY n.nspname;      -- public 70, storage 7
```

Es la definición «la expresión de la política *nombra* una de esas cuatro cosas». La cifra anterior («106») no salía de
ninguna definición reproducible: contando también las políticas que llaman a una función que a su vez llama a un helper
salen 118, y con cierre transitivo 120. Se usa la directa (77) porque es la única que se puede volver a contar con una consulta.

**Qué NO prueba esa cifra (R2-2).** La versión anterior de este documento decía que las 77 «mencionan también la empresa». Eso es una
comprobación textual de que *aparece* la empresa en algún lado de la expresión, no de que *toda* alternativa que concede acceso la exija.
Leyendo el texto de las políticas de producción (solo `SELECT` sobre `pg_policy`, 2026-10-11), **8 políticas tienen al menos una alternativa
que concede por la asignación sola**:

| Política | Alternativa sin empresa |
|---|---|
| `pagos_select` | `EXISTS (… user_project_assignments … user_id = auth.uid() AND project_id = pagos.project_id)`, sin rol ni empresa |
| `pagos_insert` | la misma, con rol `admin`, `operator` u `operador`, sin empresa |
| `registros_insert`, `registros_update`, `registros_delete` | `EXISTS (… asignación propia al proyecto)`, sin empresa (UPDATE y DELETE necesitan además ver la fila con `registros_select`, que sí liga la empresa; el INSERT no se pudo ejercitar: un trigger de negocio lo frena antes) |
| `contadores_select`, `tarifas_select`, `unidades_select` | `has_admin_project_access` / `has_operator_project_access` / `has_viewer_project_access` `AND can_access_project(project_id)`: los tres helpers miran el rol y la asignación (o `app_users.project_id`), nunca la empresa |

Medido con datos (base de la suite, sin la migración para poder escribir la fila cruzada a mano): con una fila cruzada a un proyecto de **otra**
empresa, un **operador**, un **visor** y un **administrador** de la empresa C leen **1 de 1** fila de `pagos`, `contadores`, `tarifas` y
`unidades` de ese proyecto (0 de 1 sin la fila). Con la migración puesta la fila cruzada ya no se puede escribir, pero **sigue valiendo si el
superadministrador mueve el proyecto o a la persona de empresa después** (D-7): un operador y un administrador asignados a P1 siguen leyendo sus
`pagos` y `contadores` tras pasar P1 a la empresa D. **Hoy no tiene efecto**: producción tiene una sola empresa con proyectos y 0 cruces.

Lo que **no** se podía (comprobado, no supuesto): leer las asignaciones de otras personas (la política SELECT
es la misma de hoy); cambiarse el rol, la empresa, el proyecto principal, `activo` o `permission_type` en
`app_users` (el trigger `lock_app_users_self_privilege` lo revierte: la prueba «[otros caminos] OP1 se «promueve» en app_users…» de `assert_alcance.sql`; la suite no tiene un «[alcance 5]»); que `anon`
escriba (la RLS no tiene política para `anon`).

## Qué cambia

| Pieza | Detalle |
|---|---|
| `asignacion_puede_administrar(p_user_id, p_project_id)` | Regla única, `SECURITY DEFINER`, `STABLE`, `search_path` vacío; `EXECUTE` solo para `authenticated` y `service_role`. **Sólo el principal** (decisión del dueño del negocio, ver «La decisión del dueño del negocio»): **superadministrador** (`super_admin`/`superadmin`): cualquiera. **Propietario** (`company_owner`): persona **y** proyecto de su empresa, también a sí mismo (es exento). **Cualquier otro rol, el administrador incluido: nada.** (Hasta la quinta ronda el administrador administraba a personas y proyectos de su empresa, nunca a sí mismo y sólo los proyectos que él veía: D-1, superada.) «Persona de su empresa» = existe en `app_users` con su `company_id`. Devuelve siempre `true`/`false`, nunca `NULL` |
| **Segunda migración** `20261026000700_autoridad_principal_empresa.sql` | 11 `ALTER POLICY` (sólo cambian expresiones; mismos nombres, comandos y roles de base de datos): `projects_insert`, `projects_delete`, `roles_insert`/`update`/`delete`, `role_permissions_insert`/`delete`, `user_roles_insert`/`delete` pasan a «superadministrador o propietario», y `user_invitations_insert`/`update` añaden `role <> 'admin' OR is_company_owner() OR is_super_admin()`. Pre-vuelo con las 18 políticas de las cinco tablas contra el texto de producción (aborta si hay deriva), `LOCK TABLE` de las cinco tablas antes de medir, conteo y `md5` de la fila completa antes/después, sin consultar ninguna ACL ni depender del `search_path`. Detalle en «La decisión del dueño del negocio» |
| Políticas INSERT, UPDATE (USING y WITH CHECK) y DELETE | Mismos nombres; las tres llaman a la regla. UPDATE comprueba la fila vieja **y** la nueva. Un `UPSERT` (`INSERT … ON CONFLICT DO UPDATE`) queda cubierto por INSERT y UPDATE |
| Trigger `trg_asignacion_empresa` (BEFORE INSERT OR UPDATE OF `user_id`, `project_id`) | **Para cualquier actor**, también `service_role` y superusuario: la empresa de la persona (`app_users.company_id`) debe existir y ser igual a la del proyecto, o `ASIGNACION_EMPRESA_DISTINTA` (`check_violation`). Valida solo lo que se escribe; no mira ni toca las filas existentes. Lee la fila de la persona y la del proyecto con `FOR SHARE`: si otra transacción está cambiando la empresa de cualquiera de las dos, la asignación espera y ve la empresa nueva |
| Trigger `trg_asignacion_propia` (BEFORE INSERT OR UPDATE OR DELETE) | Defensa en profundidad: con sesión de la API (`auth.uid()` no nulo), tocar una fila propia exige ser propietario o superadministrador, o `ASIGNACION_PROPIA_NO_PERMITIDA` (`insufficient_privilege`). Si una política permisiva futura reabriera el hueco, esto lo sigue cerrando. `service_role` y superusuario (`auth.uid()` nulo) pasan. **`COALESCE` en los dos lados** de la condición (F3): una sesión sin fila en `app_users` tiene rol `NULL` y antes el `IF` daba `NULL` y no levantaba (fallaba abierto). **Excepción**: la baja *en cascada* por borrar el proyecto (la fila padre ya no existe) se permite si la persona conserva otra asignación (D-5); esa comprobación se **serializa con un candado de aviso POR EMPRESA** de bajas en cascada: `pg_advisory_xact_lock(hashtextextended('asg-cascada:' || <empresa de la PERSONA cuya fila se borra, leída de app_users>, 0))`, tomado en sentencias **propias y anteriores** a la lectura que decide y para **toda** baja en cascada hecha con una sesión de la API, también la del propietario o la del superadministrador (F1, R2-1; coste y límites en D-15). Las rondas anteriores usaron un candado por persona (`d1aeb94a`: no ordena la fila ajena) y uno **global** (`b9b630b1`: un propietario de cualquier empresa retenía las bajas de todas las demás, V3-01). La clave sale de la **persona** y no del proyecto, así que dos bajas que quitan filas de la misma persona comparten siempre clave, también con una fila cruzada anterior al trigger de integridad. Una fila **huérfana** (la persona no existe en `app_users`) no toma candado. La función lleva su propio **`lock_timeout` de 2 s**: si no obtiene el candado, falla con `55P03` («canceling statement due to lock timeout») en vez de ocupar una conexión hasta el `statement_timeout`. `service_role` y superusuario no pasan por el trigger y **no** lo toman (V3-06, D-6) |
| Privilegios | `anon`: ninguno. `authenticated`: sin `TRUNCATE`, `TRIGGER` ni `REFERENCES`; **su `SELECT`/`INSERT`/`UPDATE`/`DELETE` no se tocan** (la migración ni los concede ni los quita; la RLS los gobierna donde existen). La misma higiene que `20261026000200` (compras y contabilidad) |
| Pre-vuelo | Exige las funciones, tablas, roles (`anon`, `authenticated`, `service_role`) y `auth.uid()` que da por existentes y que quien corre sea el **propietario** de la tabla (o miembro de su rol). **Bloquea la tabla** (`LOCK TABLE … ACCESS EXCLUSIVE`, bajo el `lock_timeout`) y **solo después** guarda conteo, huella md5 ordenada de `(id, user_id, project_id, permission_type)` y el DML que `authenticated` tiene hoy; informa (sin fallar) de huérfanas, cruces de empresa, de los **principales** (los únicos que escribirán la tabla), de las empresas con filas y **sin propietario** y de los administradores (acotados y sin filas), que ya no la escriben. Exige además `is_company_owner()` |
| Post-vuelo | Exige conteo y huella **idénticos**; las 4 políticas, los 2 triggers, las 3 funciones (la regla usa `is_company_owner()` y ya no nombra `'admin'`) y su `EXECUTE` (las de trigger, para `anon` y `authenticated`: ver la fila de la ACL por defecto abajo); `anon` sin ningún privilegio (ni siquiera `MAINTAIN`); `authenticated` sin `TRUNCATE`/`REFERENCES`/`TRIGGER` y con el **mismo** DML que tenía. **Independiente del `search_path`** de la sesión (R2-3): las comprobaciones por texto de `pg_get_expr` aceptan `auth.uid()` y `uid()`. Si algo no se cumple aborta, con la ACL en el mensaje, y la transacción no deja nada |
| Transacción | `BEGIN … COMMIT`, `SET LOCAL lock_timeout = '5s'`, `SET LOCAL statement_timeout = '60s'`, idempotente |

### Qué supone la migración del entorno (revisado línea por línea tras el P0)

| Suposición | Antes | Ahora |
|---|---|---|
| `authenticated` tiene `SELECT/INSERT/UPDATE/DELETE` sobre la tabla | **Exigida como absoluto** (era el P0) | **Relativa**: el post-vuelo exige lo mismo que había en el pre-vuelo |
| `anon` ya tenía privilegios que quitar | No se supone: `REVOKE ALL` y se exige que no quede ninguno (también por `aclexplode`, que ve `MAINTAIN`) | Igual, con la ACL en el mensaje de error |
| ACL por defecto de las funciones nuevas: **cuatro perfiles**. Producción y sandbox (leído con `SELECT` sobre `pg_default_acl`, 2026-10-11): `{postgres=X, authenticated=X, service_role=X}`, sin `anon` y sin `PUBLIC`; Supabase Preview: solo `{postgres=X}`; el arnés: `GRANT ALL` a los tres roles; en un Supabase nuevo, además `PUBLIC=X` | Cada función hace `REVOKE ALL … FROM PUBLIC, anon[, authenticated]` y `GRANT` explícito: converge a lo que importa en los cuatro. **Una diferencia (R2-6)**: con la ACL de producción las dos funciones de trigger conservan `EXECUTE` para `service_role` (el `REVOKE` no lo nombra; comprobado en una base con ese perfil: `{postgres=X, service_role=X}`). Es inofensivo (una función de trigger no se puede invocar a mano: «trigger functions can only be called as triggers», probado con `service_role`), pero la frase «las funciones de trigger quedan para nadie» era inexacta | El post-vuelo **comprueba** el `EXECUTE` de las dos funciones de trigger solo para `anon` y `authenticated` |
| El `search_path` de la sesión que corre la migración | Implícita: el post-vuelo buscaba el texto `auth\.uid` en `pg_get_expr`, que sale **sin calificar** (`uid()`) si el esquema `auth` está en el `search_path` (p. ej. el rol `supabase_admin`, o `PGOPTIONS='-c search_path=auth,public'`): abortaba con «la política SELECT no existe o perdió la lectura de las propias» sin que nada estuviera mal (R2-3) | **Ya no**: acepta `auth.uid()` y `uid()`. Lo mismo en la reversión y en el diagnóstico (que mostraba «otra» en las cuatro políticas). Probado con `search_path=auth,public` y con uno vacío; rojo con la comprobación vieja |
| Los roles `anon`, `authenticated`, `service_role` y `auth.uid()` existen | Implícita (fallaba con un error críptico) | El pre-vuelo la **comprueba** y lo dice |
| Quien corre es el propietario de la tabla | Implícita (`DROP POLICY` fallaba con «must be owner» o, peor, `REVOKE` no hacía nada) | El pre-vuelo la **comprueba** (`pg_has_role`) |
| El propietario es superusuario | No | No. La suite aplica la migración como un rol **no superusuario con `BYPASSRLS`** (como el `postgres` de Supabase) |
| Privilegios de esquema (`USAGE` en `public`/`auth`) | Se da por hecho (las políticas existentes ya llaman a funciones de `public`) | Igual: si faltara, la aplicación entera ya estaría rota; no se añade una comprobación que oculte eso |
| El DML de `service_role` | No se toca | No se toca (la suite lo comprueba idéntico antes/después) |

## Lección de ACL (el P0 de Supabase Preview)

**Qué pasó.** La primera vez que la migración corrió en una base de Supabase construida **solo con migraciones** (la rama
de preview del #928: PostgreSQL 17.11, 557 migraciones hasta `20261026000500`), el post-vuelo abortó con
`seguridad_asignaciones_proyecto (post-vuelo): privilegios de la tabla mal repartidos` (`P0001`, sentencia 24 = el bloque
`DO $post$`). La ACL de la tabla en esa base es

```
{postgres=arwdDxtm/postgres, anon=Dxtm/postgres, authenticated=Dxtm/postgres, service_role=Dxtm/postgres}
```

(`anon` y `authenticated` **sin** `SELECT/INSERT/UPDATE/DELETE`; solo `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`), mientras
que producción tiene `arwdDxtm` para `anon` y `authenticated`. El post-vuelo exigía que `authenticated` *tuviera* el DML: una
suposición del entorno, no una propiedad de la migración, que nunca lo concede. El resto de la migración llegó a ejecutarse en
esa base y **todas las comprobaciones anteriores del post-vuelo pasaron** (filas idénticas, 4 políticas, triggers, funciones,
`EXECUTE`); la que falló era la **última** del bloque, así que no hay comprobaciones sin ejecutar detrás de ella.

**Lo que se leyó (solo `SELECT`) de esa base para imitarla**: el propietario es `postgres`, que **no es superusuario** pero sí
tiene `BYPASSRLS`; `supabase_admin` es el superusuario; los privilegios por defecto de `postgres` en `public` para tablas son
`{postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm}` (por eso las tablas nuevas nacen sin DML para esos
roles) y para funciones solo `postgres=X`. El arnés (`scripts/schema-drift/bootstrap.sql`) hace `GRANT ALL` por defecto a
`anon`/`authenticated`/`service_role`: **era más permisivo que la preview y por eso la suite no lo vio**.

**Reproducido (rojo → verde).**

| | Resultado |
|---|---|
| Rojo | La migración del SHA `1794dc8f`, aplicada como un rol propietario **no superusuario con `BYPASSRLS`** sobre la ACL exacta de la preview, aborta con **el mismo mensaje** («privilegios de la tabla mal repartidos», `PL/pgSQL function inline_code_block line 63 at RAISE`) y no deja ninguna pieza (0 funciones `asignacion_*`) |
| Verde (preview) | La migración corregida, en esa misma base, se aplica; deja a `authenticated` **sin** DML (no se lo concede), a `anon` sin nada y a `service_role` intacto: ACL final `{propietario=arwdDxt, service_role=Dxt}`. Una segunda pasada no cambia nada |
| Verde (producción) | Con la ACL de producción (`arwdDxt` a los tres roles) también se aplica y deja a `authenticated` con `arwd` (conserva el DML, pierde `D/x/t`), a `anon` sin nada y a `service_role` intacto |
| Control | El post-vuelo **absoluto** (la versión anterior) *sí pasa* con la ACL de producción, que es exactamente por qué nadie lo vio hasta que corrió en una base distinta |

La suite lo ejecuta en el paso `4c` de `run.sh` (con el propietario no superusuario `sb_postgres`, fichero
`propietario_supabase.sql`, y `assert_acl.sql`), y además corre **toda** la batería de invariantes (catálogo, matriz, flujos,
alcance, capas, defensa) y la reversión exacta contra la base con la ACL de producción y ese propietario.

**La lección, en tres líneas.**

1. Una base construida solo con migraciones **no tiene los privilegios de producción** (producción se ha ido ajustando fuera de
   la cadena). Supabase Preview es la única prueba real que se corre contra esa base y es la que lo detectó: hay que
   mirar su resultado antes de dar por buena una migración que toque grants, funciones o políticas.
2. Una migración **no debe afirmar como absoluto un privilegio que ella no concede**. O lo concede ella (declarado y probado), o
   compara contra lo que había (pre-vuelo / post-vuelo). Aquí se eligió lo segundo para no ampliar privilegios en un entorno en
   el que alguien pudo retirarlos a propósito.
3. Un arnés de pruebas debe poder correr **las dos formas** del entorno. Ahora `run.sh` monta la ACL de la preview y la de
   producción, y aplica la migración sin ser superusuario.

**La base de preview del #928 quedó limpia tras el aborto** (comprobado con `SELECT`: 0 funciones `asignacion_*`, la versión
`20261026000600` sin registrar, las 4 políticas originales y ningún trigger; el `BEGIN … COMMIT` de la migración lo deshizo todo). Como el
archivo sigue siendo «nuevo» para Supabase Preview (no está en su historial), el siguiente commit lo vuelve a aplicar: **no hace falta
reiniciar esa rama** (a diferencia de la del #926, cuyo archivo `0800` ya estaba registrado con otro contenido). *(Esto valía para ese momento. Después la rama aplicó la versión `d1aeb94a` y, desde entonces, Preview no la vuelve a aplicar: ver «Notas de despliegue de la tercera ronda» y «Cuarta ronda».)*

**Deuda previa que esto deja a la vista (no es de este PR, D-12).** En una base construida solo con migraciones,
`authenticated` no tiene DML sobre esta tabla, de modo que la aplicación no podría usarla ahí. Habría que *declarar* esos
privilegios en una migración propia (como hizo `20260911223000_declarar_acl_definer_expuestas_anon.sql` con las funciones),
pero hacerlo es una decisión sobre qué debe tener `authenticated` en una base nueva y se deja fuera de este PR de seguridad.

**Qué no se pudo probar.** Las pruebas locales son PostgreSQL 16; la preview y producción son 17. La única diferencia de
privilegios relevante es `MAINTAIN` (nuevo en 17); las comprobaciones nuevas usan listas de privilegios explícitas y `aclexplode`
sobre `anon` (que sí lo ve), de modo que no dependen de la versión, pero no se ejecutaron en 17.

## Segunda ronda: hallazgos de la verificación independiente y su estado

Dos verificaciones independientes (ataque hostil: **F1–F8**; flujos, interfaz y CI: **F-01–F-13**) más el P0.

| Id | Qué | Gravedad | Estado | Prueba |
|---|---|---|---|---|
| P0 | El post-vuelo exigía el DML de `authenticated` como absoluto; abortó en Supabase Preview | alta | **Corregido** | `run.sh` 4c: rojo con el post-vuelo absoluto en la ACL de la preview, verde con el relativo; también con la de producción |
| F1 | Carrera en la baja en cascada: dos sesiones, cada una borra uno de los dos únicos proyectos de un administrador acotado ⇒ **0 filas y exento** | alta | **Corregido** | `run.sh` F1, dos sesiones reales sincronizadas sin esperas fijas; rojo sin el candado y con el candado *dentro* del `AND`; verde con él |
| F3 | El trigger de autoasignación fallaba abierto con `current_user_role()` `NULL` | baja | **Corregido** | `assert_defensa` con una política `zz` permisiva y la sesión de un `user_id` huérfano; mutación sin `COALESCE` |
| F4 | Falso «las filas CAMBIARON» si una escritura legítima se confirmaba entre la medición y el bloqueo | baja | **Corregido** (`LOCK TABLE` antes de medir) | `run.sh` F4: la escritura espera y la migración pasa; mutación sin el `LOCK` reproduce el falso positivo |
| F-08 | Mutante vivo: borrar UNA fila propia con otras restantes | baja | **Corregido** (aserción nueva) | `assert_defensa`; mutación «cascada sin comprobar que el proyecto ya no existe» |
| F-09 | «14 mutaciones» eran 13 (`grep -c` contaba su propia línea) | baja | **Corregido** | las mutaciones se cuentan al ejecutarlas (ver «Resultados») |
| F-13 | Concurrencia con tiempos fijos (0,4 s / 1,5 s) | baja | **Corregido** | candado «puerta» + `pg_stat_activity` (`wait_event_type = 'Lock'`): ningún `pg_sleep` |
| F-01, F-02, F-05, F-06, F-07 | Interfaz: lectura inicial fallida con «Guardar» activo, diferencias contra una lectura nueva, `guardar()` sin `try/catch`, fallo parcial sin aviso, mutantes vivos | media/baja | **Corregidos** | ver «Interfaz» |
| F-10, F-11, F-12 | Cifras del documento (106 políticas, «una empresa», SHA del #926) | baja | **Corregidas** en este documento | |
| F-04 | Un administrador acotado puede crear un administrador nuevo (`create-user`/`invite-user`) y éste nace exento | media | **Documentado** en la segunda ronda; **cerrado en la sexta** (edge functions + `0700`: la invitación `admin` sólo la inserta el principal) | D-2, «Otros caminos»; sexta ronda |
| F-03 | **Cambio de flujo**: el administrador acotado que crea un proyecto **por la API** ya no puede asignárselo (en la pantalla ese flujo no existe: F2-02) | media | **Documentado; decisión D-9** → **decidida en la sexta ronda (opción c): sólo el principal crea proyectos** | «Cambio de flujo (F-03)» |
| F2 | Colusión de dos administradores acotados | media | **Documentado; decisión D-2** → **cerrado en la sexta ronda para la API**: un administrador ya no escribe asignaciones de nadie | sexta ronda |
| F5 | Bloqueo `ACCESS EXCLUSIVE` con una transacción larga: hasta 5 s de parón de las lecturas con RLS | baja | **Procedimiento de despliegue** | «Orden y pasos de despliegue» |
| F6 | `FOR SHARE` del trigger de integridad bloquea altas mientras alguien edita su propia fila de `app_users`; posibles deadlocks en transacciones de varias sentencias | baja | **Aceptado** | D-13 |
| F7 | Cambio de empresa posterior a la asignación deja filas cruzadas | baja | **Documentado** (D-7) | |
| F8 | En PG17 `authenticated` conserva `MAINTAIN` | info | **No se revoca**, por qué: D-14 | |

## Tercera ronda: segunda verificación independiente

Dos nuevas verificaciones (ataque hostil: **R2-1…R2-8**; interfaz, pruebas y documento: **F2-01…F2-13**; una tercera revisó los paquetes del
#926). Cada punto de la tabla se reprodujo o se leyó (código, `SELECT` de solo lectura sobre producción) en esta ronda, no se copió del informe, salvo F2-11 y F2-12,
que son del #926 y se anotan tal como los reportó la verificación, sin repetirlos.

| Id | Qué | Gravedad | Estado | Prueba |
|---|---|---|---|---|
| R2-1 | **Carrera entre DOS administradores que comparten proyectos.** ADM1 y ADM2 con exactamente `{P1, P2}`: ADM1 borra P1 y ADM2 borra P2 a la vez. La cascada de cada sesión vacía **también la fila del otro** (la fila ajena no se comprueba) y el candado *por persona* de F1 no las ordena (claves distintas): ambos quedan con **0 filas y exentos**, un resultado que no equivale a ningún orden en serie (en serie, la 2ª recibe `ASIGNACION_PROPIA_NO_PERMITIDA` y ambos conservan `{P2}`) | baja (hacen falta dos cuentas de administrador, algo que D-2 ya permite) | **Corregido** con un candado de bajas en cascada antes de calcular quién borra (ronda 3: global; **ronda 4, V3-01: por empresa**, ver «Cuarta ronda») | `run.sh` R2-1 con sesiones reales sincronizadas sin tiempos fijos: **rojo** con el candado de la ronda anterior (`\|t\|\|t\|terminó`: nadie espera, ambos exentos) y con el candado tomado solo en la rama propia (el propietario borra P1 y ADM1 queda exento); **verde** con el global (`P2\|f\|P2\|f\|esperando`, un rechazo). Estrés de carrera real, 40 rondas × 6 administradores que comparten `{P1,P2}`, dos sesiones arrancando a la vez: **240 de 240 exentos** sin candado, **222** con el candado por persona (37 de 40 rondas), **0** con el global (40 rechazos, 0 interbloqueos, 0 otros errores) |
| R2-2 | D-7/D-10 tenían más alcance del dicho: 8 políticas conceden por la asignación sola, sin empresa | media (sin efecto hoy: 0 cruces) | **Documentado** (tabla y medición arriba; D-7, D-10) | `SELECT` sobre `pg_policy` de producción; lectura medida con datos |
| R2-3 | Los post-vuelos de la migración y de la reversión (y el diagnóstico) dependían del `search_path` de la sesión | baja | **Corregido** | rojo con `PGOPTIONS='-c search_path=auth,public'` sobre `d1aeb94a` (migración: «la política SELECT no existe…»; reversión: «las políticas no quedaron como las originales»; diagnóstico: «otra» en las cuatro políticas); verde ahora: la migración y el diagnóstico también con `search_path` vacío; **la reversión no lo cumplía** (V3-04, cuarta ronda): con `search_path` vacío abortaba con «function is_super_admin() does not exist» y ahora lleva los nombres calificados; `run.sh` 4d, 8b y 8c con la mutación de la comprobación vieja y la de los nombres sin calificar |
| R2-4 | La reversión no es exacta con la ACL de Preview: `anon` recupera `SELECT/INSERT/UPDATE/DELETE` que nunca tuvo | baja | **Documentado**; el texto «reversión exacta» ahora dice en qué perfil lo es (ver «Reversión») | `run.sh` 4c(a) fija el comportamiento; 4c(b) la exactitud con la ACL de producción |
| R2-5 | El candado añade una clase de interbloqueo con el `FOR SHARE` del trigger de integridad en transacciones de **varias** sentencias | info | **Medido y documentado** (D-15, repetido en la ronda 4 con el candado por empresa); sin consecuencias para los datos. **Corregido en la quinta ronda (V4-H01):** este renglón decía que no era alcanzable por PostgREST y que con una sentencia por transacción no había interbloqueos; eso es lo que midieron las cargas probadas, **no una garantía**: con **tres** peticiones de **una** sola sentencia hay un ciclo determinista con el candado que no existe sin él | `run.sh` R2-5 (determinista) y `carga/medir.sh` (D-15); el caso de una sentencia, en «Quinta ronda» |
| R2-6 | ACL por defecto de las funciones: producción es otro perfil y `service_role` conserva `EXECUTE` en las dos funciones de trigger | info | **Documentado** (fila de la ACL en «Qué supone…»; cabecera de la migración) | `SELECT` sobre `pg_default_acl` de producción, sandbox y preview; base local con ese perfil |
| R2-7 | La clave del candado era una constante conocida (`hashtextextended('asg-cascada', 0)`). La ronda 3 afirmó que «no se encontró un camino de denegación de servicio entre usuarios; es teórico» | info → **media (V3-01)** | **Reabierto y corregido en la ronda 4**: esa frase era **falsa**. Un propietario de cualquier empresa (`signup-company` es público) retenía el candado con una baja pesada y bloqueaba las bajas de proyecto de **todas** las demás (medido en «Cuarta ronda»). Ahora la clave depende de la empresa de la persona y el efecto se acota a la **propia** empresa. El hash sigue siendo determinista pero ya no es una constante: para estorbar a la empresa C hay que conocer su `uuid` **y** poder tomar un candado de aviso de 64 bits con un texto elegido (solo otras funciones que hagan `pg_advisory_xact_lock(hashtextextended(<texto del usuario>, 0))`, como las de compras del #926, lo permitirían; **teórico, no probado**; si se quisiera cerrar, un candado de dos enteros —clase fija, objeto = hash— separaría los espacios de claves) | `run.sh` V3-01 (la baja de C no espera a la de D; la de D espera a la de D; 55P03 a los 2 s) y `carga/medir.sh` (D-15) |
| R2-8 | Nota cruzada: la `20261027000900` del #926 repite el patrón F4 | info | **Documentado** (despliegue) | lectura de la `0900` del #926 (`a6ccc2a8`) |
| F2-01 | **Interfaz**: tras un guardado **parcial** `AsignacionModal` no refrescaba el conjunto inicial; si la persona cambiaba la selección y volvía a guardar, la fila ya insertada se quedaba y la pantalla decía «guardado» (acceso otorgado sin querer) | media | **Corregido**: tras un parcial se relee lo que hay en la base y ése es el nuevo «antes» | vitest: 4 pruebas **rojas** sobre `d1aeb94a` y verdes ahora (la selección deshecha, la variante «deja p2 desmarcado y desmarca p3», el reintento sin cambios y la relectura fallida); 5 con su control |
| F2-02 | La compuerta de autoedición protege a un rol que **no llega a la pantalla**, y F-03/D-9 eran falsos para la interfaz | media | **Corregido en el documento** (ver «Cambio de flujo (F-03)» e «Interfaz») | lectura de `routes.tsx`, `Sidebar.tsx`, `queries.ts`, `App.tsx` |
| F2-03 | **Cualquier administrador deja exento a OTRO administrador borrando su último proyecto** (`projects_delete` lo permite; el trigger solo vigila filas propias); D-2, D-5 y D-6 lo omitían y la regla propuesta en D-2 no lo cierra | media | **Documentado como decisión abierta** en la tercera ronda → **cerrado para la API en la sexta** (`0700`: `projects_delete` es del principal). Sigue abierto para el rol de servicio y el SQL directo (D-6) | `assert_alcance` `[otros caminos]` F2-03 (hoy: 0 filas); `assert_principal` J2; la regla de D-2, aplicada en una copia, dejaba el caso igual |
| F2-04 | D-3 no nombraba la causa de las huérfanas: `delete-user` no limpia `user_project_assignments` | baja | **Documentado** con propuesta (D-3) | lectura de `supabase/functions/delete-user/index.ts` |
| F2-05 | D-14 decía `arwm`; es `arwdm` | baja | **Corregido** | `relacl` de producción (`arwdDxtm`) y de la preview (`m` tras la migración) |
| F2-06 | D-13: `FOR KEY SHARE` no cierra la carrera D1/D2 | baja | **Descartado** (D-13) | medido: con `FOR KEY SHARE` la asignación no espera y queda 1 fila cruzada |
| F2-07 | Referencia obsoleta al SHA del #926 | baja | **Corregido** («Combinación con el #926») | `git rev-parse` de la punta de la rama `peaceful-bell-u9mad4` |
| F2-08 | Mutantes de interfaz vivos no equivalentes: M06, M11, M15, M19, M20, M23 | baja | **Corregido** (ver «Interfaz») | 8 mutantes **vivos** con las pruebas de `d1aeb94a` (los 6 más 2 de F2-01) y **muertos** con las nuevas |
| F2-09 | Mutantes SQL vivos (S15, R02) y lint textual frágil (`strpos` sobre `prosrc`) | baja | **Corregido** | `run.sh` 4e (S15), R02 y `assert_catalogo` por comportamiento |
| F2-10 | `run.sh` salía sin mensaje si la primera aplicación de la migración fallaba | baja | **Corregido** | con una migración que falla, el `run.sh` anterior termina con `rc=3` y **sin** el motivo; el nuevo imprime «la migración falló al aplicarse por primera vez» y la línea `ERROR`; además una trampa `ERR` impide cualquier otra salida muda |

Fuera de este PR (se anotan, no se tocan; no se reprodujeron aquí): **F2-11**, una prueba intermitente de `compras_bloque_b` del #926 (`RG-4.sql`; la verificación sospecha que cuenta ids aleatorios que
empiezan por `fb4`, sin haber capturado la fila), y **F2-12**, el arnés de `compras_bloque_b` del #926 aplica antes de la serie todo lo que no es `20261027*`, así que la migración
del futuro PR de alcance por proyecto (`20261027001000`, que cae en ese mismo patrón) lo romperá hasta que se adapte el arnés.

**F2-13** (detalles menores de CI) no se toca: `coverage.yml` pasa `PGBIN` al paso nuevo y `run.sh` lo ignora (solo recorre `/usr/lib/postgresql/*/bin`, como la mayoría de las
suites, y no importa con un solo PostgreSQL instalado), y el job no declara `timeout-minutes`.

## Cuarta ronda: tercera verificación independiente

Dos verificaciones más: una del #928 (**V3-01…V3-06**) y otra de los paquetes del #926 (de ésta, aquí solo lo que toca a este PR). Cada punto se **reprodujo** en esta ronda (rojo: comando y salida
antes de corregir) y se volvió a ejecutar después (verde); no se copió del informe. La verificación del #928 no encontró ningún hueco nuevo de datos —cero administradores exentos en 300 rondas de la
carrera R2-1, con 2, 6 y 30 sesiones— pero sí un **hallazgo de gravedad media** (V3-01) que desmentía una frase de este documento.

| Id | Qué | Gravedad | Estado | Prueba |
|---|---|---|---|---|
| V3-01 | **El candado global de bajas en cascada dejaba a un propietario o administrador de CUALQUIER empresa bloquear las bajas de proyecto de TODAS las demás** (`signup-company` es público y crea un propietario; basta asignarse un proyecto propio con muchas filas en cascada y borrarlo en bucle). R2-7 y D-15 decían «no hay camino de denegación de servicio, es teórico»: era **falso** | **media** | **Corregido**: la clave sale de la **empresa de la persona** cuya fila se borra (`'asg-cascada:' \|\| company_id`) y la función lleva un `lock_timeout` de 2 s. Con datos sanos, un propietario solo estorba a **su** empresa (medido y probado, ver abajo); con filas cruzadas heredadas o personas sin empresa no vale: V4-H03 y V4-H04 en «Quinta ronda» | **rojo** (`b9b630b1`, mismo ataque): la víctima de otra empresa pasa de 212,3 a 0,50 tx/s; **verde**: de 209,5 a 192,7. `run.sh` V3-01: la baja de C termina sin esperar y ninguna sesión espera ningún candado; mutación «candado global» en rojo; R2-1 a escala (2, 6 y 30 sesiones) |
| V3-02 | **Interfaz**: una excepción o un error de red de la PRIMERA escritura (o de un `DELETE` sin `INSERT` previo) se tomaba por «no se aplicó nada» aunque la respuesta se perdiera con la escritura ya hecha; el modal no releía y la pantalla podía decir «guardado» con la base distinta (misma familia que F2-01). `@supabase/postgrest-js` **no lanza** ante un fallo de red: devuelve `{ error: { code: '' }, status: 0 }` | baja | **Corregido**: solo una respuesta de la base con código es definitiva; lo demás es ambiguo → `parcial` + `incierto`, el modal relee; si la relectura falla, error con Guardar deshabilitado | vitest: 9 de las 14 pruebas nuevas **rojas** sobre `b9b630b1` (E1, E1b, E3, la 502, la excepción sin aplicar, E3b, D1 y las dos de E4) y verdes ahora; 18 mutantes, los 18 mueren |
| V3-03 | **Huecos de pruebas**: (a) el mutante N08 de interfaz (`fetchUserProjectAssignments` sin `.eq('user_id', …)`) sobrevivía porque nadie sembraba filas de OTRA persona; (b) el mutante M-c de SQL (tomar el candado en cualquier `DELETE`, también en un borrado directo) pasaba las 663 comprobaciones; (c) los mutadores de `run.sh` dependían del texto literal de la guarda del candado | baja | **Corregidos** | (a) 3 pruebas N08; (b) `assert_catalogo`: «borrar DIRECTAMENTE una asignación no retiene ningún candado» + la mutación en `run.sh` (rojo); (c) los mutadores solo dependen de `PERFORM pg_advisory_xact_lock(…);`, de `BEGIN … END IF;` y de `IF v_toca AND NOT … THEN`, y `mutar_funcion` aborta en voz alta si una sustitución no cambia nada |
| V3-04 | **La reversión fallaba con `search_path` vacío** («function is_super_admin() does not exist») aunque este documento decía que el `search_path` vacío estaba probado para migración, reversión y diagnóstico | baja | **Corregido**: el texto original de las políticas va con los nombres calificados (`public.…`); el árbol que queda guardado es el mismo | rojo: `PGOPTIONS='-c search_path=' psql -f scripts/reversion-asignaciones-proyecto.sql` → `ERROR: function is_super_admin() does not exist`; verde con 6 `search_path` (vacío, `public`, `pg_catalog`, `"$user",public`, `auth,public`, `auth,public,extensions`); `run.sh` 8c con la mutación «sin calificar» |
| V3-05 | La relectura posterior a un fallo no tenía la guardia de vigencia del efecto de carga: si cambiaba el prop `usuario` mientras volaba, pisaba el conjunto inicial de la persona nueva (no alcanzable desde `EmpresaUsuariosSection`) | info | **Corregido** (contador de «versión» de la pantalla) | vitest E4 y su variante (rojas antes, verdes ahora; mutantes muertos) |
| V3-06 | Una baja de proyecto con `service_role` o superusuario, concurrente con una baja por la API, deja exento a un administrador: el rol de servicio no toma el candado | info | **Documentado como carrera residual; decisión: el rol de servicio NO toma el candado** (razones y coste en D-6 y D-15) | `run.sh` V3-06 fija el comportamiento actual (ADM1 no espera, queda con 0 filas y exento) |

### V3-01 · lo medido

Se reprodujo primero con los guiones del verificador y luego se hizo reproducible dentro del repositorio: `ASG_CARGA=1 PGPORT_TEST=<puerto> bash supabase/tests/asignaciones_proyecto/run.sh` monta el clúster desechable
(cadena de migraciones + fixture + la migración), saca una copia por variante del candado —**empresa** (esta versión), **global** (`b9b630b1`: una sola clave y sin `lock_timeout` propio) y **sin** candado— y
corre `carga/medir.sh` (pgbench con sesiones que imitan una petición de PostgREST: `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL statement_timeout = '8s'; set_config('request.jwt.claim.sub', …); DELETE; ROLLBACK`).
**Son cifras de referencia de una máquina compartida de 4 núcleos con PostgreSQL 16: la relación entre variantes importa, el valor absoluto no.**

Ataque = el propietario de la empresa D borra en bucle (2 clientes) un proyecto con una cascada pesada (400 000 filas en `amenidades`; una baja tarda ≈ 4 s) y lo deshace. Víctima = el propietario de la empresa C
borrando proyectos pequeños (4 clientes, 12 s):

| Variante del candado | Víctima de **otra** empresa, sola | …bajo el ataque de D | El atacante (2 clientes) |
|---|---|---|---|
| sin candado | 339,8 tx/s · 11,8 ms | 297,1 tx/s · 13,5 ms | 3 bajas en 12 s |
| **global** (`b9b630b1`) | 212,3 tx/s · 18,8 ms | **0,50 tx/s · 7 922 ms** (7 bajas en 10 s) | 5 bajas en 12 s |
| **por empresa** (esta versión) | 209,5 tx/s · 19,1 ms | **192,7 tx/s · 20,8 ms** | 1 baja en 12 s |

(Una reproducción previa a mano, con los guiones del verificador: 158,8 → 0,42 tx/s y, entre empresas, 139,6 → 0,29 tx/s con 3 de 4 clientes abortados por `statement_timeout`; la mía, con el mismo ataque
sobre `b9b630b1`: 220,5 → 0,54 tx/s. La caída residual de la última fila, ≈ 8 %, es la CPU que consume la cascada pesada de la otra empresa: también aparece sin candado, ≈ 13 %.)

Un atacante de la **misma** empresa solo afecta a su propia empresa: el mismo ataque contra otro propietario de D (2 clientes en bucle de peticiones sueltas):

| Variante | Baja de la víctima (otro propietario de D) mientras el atacante de D retiene el candado |
|---|---|
| sin candado | 129 bajas, todas bien: media 141 ms, máximo 230 ms |
| **global** (`b9b630b1`) | 5 bajas bien tras esperar de media **5 143 ms** (máximo 7 785 ms: casi el `statement_timeout` de 8 s) |
| **por empresa** | 5 bajas bien (media 1 641 ms, máximo 2 050 ms) y 6 que fallan **solas a los ≈ 2,0–2,3 s** con `55P03` (una a 3,9 s con la máquina cargada) |

Coste del candado (solo bajas de proyectos pequeños; 8 clientes de una empresa y 4 + 4 de dos empresas, 15 s, tres repeticiones):

| Variante | 8 clientes de **una** empresa (3 repeticiones) | 4 clientes de C **+** 4 de D (suma, 3 repeticiones) |
|---|---|---|
| sin candado | 442,6 · 432,1 · 435,1 tx/s | 526,7 · 501,1 · 544,1 tx/s |
| **global** (`b9b630b1`) | 203,0 · 204,5 · 195,7 tx/s (≈ 0,46×) | 193,4 · 197,9 · 194,2 tx/s (≈ 0,37×: las dos empresas se esperan entre sí) |
| **por empresa** | 196,2 · 190,3 · 195,7 tx/s (≈ 0,45×) | **403,5 · 386,4 · 401,7 tx/s** (≈ 0,76×: cada empresa tiene su fila de espera) |

El coste dentro de una empresa es el mismo que tenía el global (la serialización de las bajas de proyecto, ≈ 0,45×; la cifra de la ronda anterior era ≈ 0,45× con 166–172 frente a 353–401 tx/s); lo que cambia es que
dos empresas ya no se esperan. Es irrelevante en la práctica: producción tiene 8 proyectos y ninguna pantalla ni función de `public` los borra; la única vía es `DELETE /rest/v1/projects`.

Interbloqueos (pgbench, `--failures-detailed`):

| Variante | UNA sentencia por transacción (12 clientes, 15 s) | VARIAS sentencias por transacción (8 clientes, 15 s; 3 repeticiones) |
|---|---|---|
| sin candado | 11 341 tx · 754,8 tx/s · **0 interbloqueos** | 99 · 52 · 54 tx; interbloqueos 28 · 49 · 46 % |
| **global** (`b9b630b1`) | 5 564 tx · 370,4 tx/s · **0 interbloqueos** | 5 · 8 · 6 tx; interbloqueos 82 · 82 · 80 % |
| **por empresa** | 5 976 tx · 397,6 tx/s · **0 interbloqueos** | 10 · 11 · 15 tx; interbloqueos 72 · 69 · 48 %; 3 · 4 · 5 de los 8 clientes abortaron con `55P03` (el `lock_timeout`) |

Lectura: (1) el candado **global** de la ronda 3 sí permitía la denegación de servicio entre empresas, y la acotaba solo el `statement_timeout`; (2) con la clave por empresa la víctima de otra empresa conserva su
rendimiento (la caída residual es CPU compartida con la cascada pesada, no espera de candado: `pg_locks` no muestra a ninguna sesión de C esperando una clave de D, ver `run.sh` V3-01); (3) quien ataca desde su
propia empresa solo retiene a la suya, y a los 2 s las bajas que esperan fallan con `55P03` en vez de ocupar una conexión hasta los 8 s; (4) dos empresas ya no se esperan entre sí (la suma de dos empresas es ≈ 2× el rendimiento de una; con el global era el de una);
(5) los interbloqueos aparecen **solo** en transacciones de varias sentencias, con cualquier variante (también sin candado, 28–49 %: el `FOR SHARE` del trigger de integridad contra la fila del proyecto que otra
transacción está borrando; el candado lo empeora, 48–82 %), y **no** —en las cargas medidas— con una sentencia por transacción, que es lo que emite PostgREST (0 en las tres variantes; **no es una garantía**: con tres peticiones de una sola sentencia hay un ciclo determinista, V4-H01 en «Quinta ronda»). Con el candado por empresa, los clientes que esperan más de 2 s abortan con `55P03` en vez
de seguir esperando.

**Por qué esa clave y no otra** (cada alternativa se probó):

* **Por persona** (`d1aeb94a`): no ordena la fila ajena. Dos administradores que comparten `{P1, P2}` quedaban con 0 filas y exentos en el 100 % de las rondas (2, 6 y 30 sesiones: `run.sh` R2-1, mutación).
* **Por persona en cada fila de la cascada** (tomar la clave de cada persona afectada): las claves se tomarían en el orden en que la cascada recorra las filas, que no se controla; con un retardo de 0,3 s inyectado tras cada
  candado, dos cascadas que recorren a dos administradores en orden inverso se interbloquean (`deadlock detected`, probado en una copia; sin el retardo la ventana es de microsegundos y no se vio en las carreras).
* **Global** (`b9b630b1`): V3-01.
* **Por empresa de la persona** (ahora): la integridad (`trg_asignacion_empresa`) garantiza que persona y proyecto son de la misma empresa, y dos bajas que quitan filas de la misma persona comparten siempre la clave
  (la clave sale de la persona, no del actor ni del proyecto; vale también con una fila cruzada anterior al trigger **para la serialización de esa persona**, pero con filas cruzadas o con personas sin empresa el
  «solo estorba a su empresa» deja de valer y una baja puede tomar dos claves: V4-H03 y V4-H04 en «Quinta ronda»). Cierra R2-1 con 2, 6 y 30 sesiones (guion del verificador: 2 × 60, 6 × 40 y 30 × 25 rondas, **0 exentos**,
  0 interbloqueos, 0 otros errores; con `d1aeb94a`, exentos en todas) y con la propia suite (`run.sh` «R2-1 a escala»: tres administradores comparten K proyectos y cada sesión borra uno; el resultado equivale a un orden en serie).

**¿Basta tomarlo solo si la persona es administradora?** Sí basta (es el único rol que `user_is_project_exempt()` deja exento por perder sus filas): se probó en una copia con la lectura `... AND u.role = 'admin'`, y
R2-1 sigue cerrada con 2 × 40, 6 × 30 y 30 × 15 rondas, 0 exentos. **No se adopta**: acopla el trigger a la lista de roles de otra función (si alguien añadiera un rol exento sin filas, la protección fallaría en
silencio sin que ninguna prueba lo viera) y no cambia nada frente a un atacante, que puede asignar un administrador de **su** empresa a su proyecto pesado. Queda como opción.

**`lock_timeout` de 2 s.** Es una cláusula `SET` de la propia función (no cambia el del resto de la sesión). Falla limpio con `55P03` en vez de ocupar una conexión hasta el `statement_timeout` de 8 s de `authenticated`
(menos tiempo de conexión retenida si alguien amontona peticiones). Cuesta: una ráfaga de bajas de proyecto de la **misma empresa** se ejecuta en serie, y cada baja recorre todas las llaves foráneas del proyecto
(≈ 10–70 ms en esta máquina), así que con ≈ 30 bajas simultáneas de una misma empresa las últimas de la cola agotan los 2 s y reciben `55P03` (se reintentan; no cambian nada). Con 6 sesiones no ocurre (`run.sh`),
con 30 sí y la prueba lo registra como «ronda con esperas agotadas» —nadie queda exento ni con filas de menos—; con el plazo alargado a 60 s las 4 rondas de 30 son exactas. No hay pantalla ni función de `public` que borre
proyectos, así que la ráfaga no es un flujo real. **Residual no medido**: PostgREST/Supavisor reales y su límite de conexiones; el efecto de amplificación (muchas peticiones del propio atacante esperando el candado de su
empresa, cada una con una conexión hasta 2 s) existe con cualquier espera y solo se acota con el plazo.

**V3-06 · por qué el rol de servicio no toma el candado.** Medido: añadirle el candado a una baja con `service_role` cuesta ≈ 0,01 ms por fila de asignación en cascada (3 000 asignaciones: 29–44 ms → 72–75 ms). No es el
coste lo que lo descarta: (1) cambiaría el comportamiento de rutas del servidor que hoy nunca esperan (`delete-company` y cualquier SQL de soporte), que de pronto podrían fallar con `55P03` por una cascada pesada de la
API en la misma empresa o interbloquearse en una transacción de varias sentencias; (2) la única ruta de la aplicación que borra proyectos con el rol de servicio es `delete-company`, que borra la empresa entera, administradores
incluidos, así que «dejar exento a un administrador» no tiene sentido ahí; (3) la carrera exige que una baja del servicio y una baja por la API del mismo administrador coincidan. Quien borre proyectos con el rol de servicio o
con SQL directo y quiera ordenarse con la API puede tomar a mano `pg_advisory_xact_lock(hashtextextended('asg-cascada:' || '<empresa>', 0))` al empezar su transacción. `run.sh` V3-06 fija el comportamiento actual.

**Qué no se pudo probar en esta ronda.** PostgreSQL 17 (solo hay 16 local); PostgREST, Supavisor y su límite de conexiones reales (las sesiones de pgbench imitan una petición, no son el proxy); el despliegue real en
Supabase Preview (ver «Notas de despliegue»); las cifras de una cascada de producción (una empresa con 8 proyectos); triggers de borrado de otras tablas que pudieran tocar una fila compartida y dar un ciclo con el
candado (hipótesis sin probar: con una sentencia por transacción no apareció ningún interbloqueo en la carga mixta; **la cuarta verificación sí encontró un ciclo con tres peticiones de una sentencia** que esa carga no
ejercía: V4-H01, «Quinta ronda»).

## Quinta ronda: cuarta verificación independiente

Dos verificaciones sobre `ae49119f`: una de la **interfaz** (`H1…H5`) y otra del **candado y de las pruebas SQL** (`H-01…H-07`). No encontraron ningún hueco nuevo de **datos** (con el candado, ningún administrador quedó exento en
las rondas probadas) pero sí una interfaz que podía deshacer el trabajo de otro administrador, un ciclo de interbloqueo con tres peticiones de una sentencia, dos mutantes del candado que la suite no veía y varias afirmaciones de este
documento y de la cabecera de la migración que eran **más fuertes de lo que se había medido**. En esta ronda cada punto se **reprodujo** (SQL: sesiones `psql` reales sincronizadas con `pg_stat_activity`/`pg_locks`, sin esperas fijas, en un clúster
desechable propio; interfaz: pruebas rojas con promesas controladas, que **fallan sobre `ae49119f` y pasan ahora**) o se leyó; los textos corregidos dicen lo que se midió y lo que no. Los nombres `V4-…` son de este documento; entre paréntesis, el
del informe.

| Id | Qué | Gravedad | Estado | Prueba |
|---|---|---|---|---|
| V4-H01 (H-01) | **Interbloqueo con TRES peticiones de UNA sola sentencia cada una** (lo que emite PostgREST): un `UPDATE` que mueve la asignación de P1 a P2, el `DELETE` de P1 y el `DELETE` de P2, con una transacción ajena que retiene la fila de `app_users` de la persona. Existe con el candado y **no sin él**. R2-5 y D-15 decían «0 interbloqueos con una sentencia por transacción» y «no alcanzable por PostgREST» | baja | **Documentado: texto corregido** (R2-5, D-15, cabecera de la migración). Es un límite medido, no un defecto que se cierre aquí: el desenlace es limpio (`40P01` + `ASIGNACION_EMPRESA_DISTINTA`, nada a medias, queda uno de P1/P2) | reproducido a mano 3 de 3 veces (guion de la verificación, fuera de `run.sh`); control sin candado: 0 interbloqueos y ambos proyectos borrados |
| V4-H02 (H-02) | **Con aislamiento `REPEATABLE READ` o `SERIALIZABLE` el candado no basta**: «¿le queda otra fila?» lee con la instantánea tomada antes de esperar; un administrador, él solo con dos sesiones, queda con 0 filas y **exento** (en `SERIALIZABLE` tampoco hay `40001`) | baja (no alcanzable por PostgREST, que no fija el aislamiento por petición: **por su documentación, no medido**; sí con una conexión directa) | **Documentado como límite y decisión abierta (D-16); el endurecimiento NO se implementa** | reproducido a mano: `REPEATABLE READ` y `SERIALIZABLE` → filas de AP `[]`, exento `t`, sin error; `READ COMMITTED` → `ASIGNACION_PROPIA_NO_PERMITIDA`, AP conserva `{P1}`, exento `f` |
| V4-H03 (H-03) | **La clave sale de la empresa de la PERSONA, no de la del actor ni de la del proyecto**: «un propietario solo puede retener el candado de SU empresa» vale con datos sanos; con una **fila cruzada heredada** (persona de C, proyecto de D) el propietario de D retiene la clave de C y las bajas del de C fallan con `55P03`; las **personas sin empresa** comparten la clave única `sin-empresa` entre TODAS las empresas | baja (los inquilinos no pueden fabricar esas filas; hacen falta datos heredados o al superadministrador; producción: **0 cruces**, y **no se sabe** si las 9 personas sin empresa tienen filas) | **Documentado: texto corregido** (cabecera de la migración y este documento; D-17) y **fijado como límite medido en la suite** | `run.sh` H-03 y H-05/M7 (sesiones reales) y `assert_catalogo` (una sola clave `sin-empresa`, distinta de la de C); reproducido además a mano |
| V4-H04 (H-04) | Con filas cruzadas una baja puede tomar **DOS claves** en el orden en que la cascada recorre las filas; dos bajas con el orden inverso se interbloquean **candado contra candado** (`40P01`), con una sentencia por transacción | baja | **Documentado** (D-17): el texto de «por empresa de la persona sirve también con filas cruzadas» solo valía si todas las filas de la baja son de una empresa | reproducido a mano: `deadlock detected` entre las claves de C y de D; queda 1 de {X, Y} |
| V4-H05 (H-05) | **Hueco de pruebas: dos mutantes del candado sobrevivían** a toda la sección de concurrencia (0 rojos). **M6**: la clave sale de la empresa del **actor** (`get_my_company_id()`): defecto real si ocurriera —un superadministrador de OTRA empresa que borra un proyecto no se ordena con el administrador al que vacía la fila y lo deja exento—. **M7**: sin el `COALESCE` de `sin-empresa` (`pg_advisory_xact_lock(NULL)` no bloquea nada) | baja | **Corregido** | `run.sh` H-05/M6 y H-05/M7 con sesiones reales (verde con el código; rojo con cada mutante: M6 → ADM1 no espera y queda con 0 filas y **exento**; M7 → ninguna baja toma candado) + `assert_catalogo` (3 comprobaciones nuevas) + 4 mutaciones nuevas (2 de catálogo, 2 de concurrencia); el código real no tiene el defecto |
| V4-H06 (H-06) | El `lock_timeout` de 2 s es fijo en la función: **ignora un `lock_timeout` más estricto del llamador** | info | **Documentado** (cabecera de la migración y D-15) | medido a mano: con `SET LOCAL lock_timeout = '200ms'` en la sesión, la baja que espera el candado falla a los **2 011,8 ms** con `55P03`, no a los 200 ms |
| V4-H07 (H-07) | Un `UPDATE` de `user_id`/`project_id` y un `DELETE` **directo** de una asignación **no toman el candado**: la carrera de uno de ellos con la baja en cascada de otro administrador deja a la persona con 0 filas y exenta | baja | **Documentado**: es la clase ya documentada D-2 (otro administrador lo puede hacer él solo, en serie); no es una escalada nueva ni de la persona en solitario (no puede tocar sus filas) | reproducido a mano: AP `{P1,P2}`; AP borra P1 sin confirmar; AX2 (administrador) mueve la fila (AP,P2) a OP4 y termina sin esperar → filas de AP `[]`, exento `t` |
| V4-U1 (H1) | **Interfaz: tras un guardado parcial o incierto la relectura renovaba `inicial` pero NO las casillas**; con un cambio ajeno entre la apertura y la relectura, el siguiente «Guardar» sin tocar nada borraba una asignación ajena o **reinsertaba una recién revocada** (acceso restituido) | **media** | **Corregido**: fusión de tres vías de las casillas (`reconciliarCasillas`; ver «Interfaz») | `AsignacionModal.reconciliacion.test.tsx`: alta ajena y baja ajena, cada una **con y sin** cambio propio pendiente, y el caso de un parcial con respuesta definitiva de la base: las 5 **rojas** sobre `ae49119f` y verdes ahora; «lo marcado mientras el guardado vuela» y MM10 pasan antes y después (matan mutantes); 12 pruebas de la función pura (rojas: no existía) |
| V4-U2 (H2) | Un guardado de A que **termina bien** cuando la pantalla ya es la de B (o el modal se cerró) cerraba el de B (`onSaved(); onClose()` sin comprobar la versión de pantalla) | baja (la aplicación no cambia `usuario` sin desmontar) | **Corregido**: la rama de éxito comprueba la versión; si ya no es la misma no cierra ni da por guardado y recarga la lista de atrás | 3 pruebas rojas con promesas controladas (cambio de persona sin remontar, remontado con `key`, modal cerrado en pleno guardado) y su control |
| V4-U3 (H3) | Ventana de un render al cambiar de persona **sin remontar**: con `usuario` ya igual a B, las casillas y el `inicial` seguían siendo los de A hasta el efecto de carga; un clic en «Guardar» ahí escribía la selección de A sobre B | baja (artificial: la aplicación no lo hace) | **Corregido (defensa estructural)**: la Sección pasa `key={usuarioAsignar.id}`; cambiar de persona remonta el modal | `EmpresaUsuariosSection.acceso.test.tsx`: abrir A y luego B desmonta la instancia de A y monta otra (rojo sin la `key`); abrir a la misma persona no remonta |
| V4-U4 (H4) | Dos mutantes vivos: **MM10** (`editables` = proyectos ∪ `inicial`) y **MM5** (sin `errorCarga` en el guard interno de `guardar()`) | baja | MM10: **corregido** (prueba que lo mata). MM5: **equivalente** a nivel de DOM (documentado en el comentario de la prueba; no hace falta código) | prueba MM10: el reintento tras la relectura no borra la fila de un proyecto no mostrado |
| V4-U5 (H5) | `escrituraAmbigua` tomaba **cualquier `error.code` no vacío** por respuesta definitiva de la base: el `code` de una pasarela (504 numérico, `upstream_timeout`) se clasificaba como «no se aplicó nada» y no había relectura | baja (hipótesis de robustez; no se vio ninguna pasarela real de Supabase con ese JSON) | **Corregido**: solo es definitivo un SQLSTATE (5 caracteres, dígitos y mayúsculas) o `PGRSTnnn`; todo lo demás es ambiguo | `guardarAsignaciones.test.ts`: 21 pruebas rojas sobre `ae49119f` (código numérico, texto, longitud, minúsculas, `PGRST` incompleto…) y verdes ahora, con los códigos reales (42501, 23514, 55P03, 57014, P0001, XX000, PGRST301…) como control |

### Lo medido (candado)

Todo en un clúster PostgreSQL 16 desechable propio, con la cadena de migraciones anteriores + el padrón con la forma de producción + la migración, y sesiones `psql` reales sincronizadas con `pg_stat_activity` y `pg_locks`
(sondeos de 20 ms, ninguna espera fija).

* **V4-H01 · el ciclo.** `ctl`: `BEGIN; UPDATE app_users SET full_name = full_name WHERE id = <VW8>` (retiene la fila de la persona). `su` (propietario): `UPDATE user_project_assignments SET project_id = P2 WHERE user_id = <VW8> AND project_id = P1`
  bloquea la tupla (VW8, P1) y espera el `FOR SHARE` de `app_users`. `sd1` (propietario): `DELETE FROM projects WHERE id = P1` toma el candado de la empresa y espera esa tupla. `sd2` (propietario): `DELETE FROM projects WHERE id = P2` espera el
  candado. `ctl` confirma: `su` pide `FOR SHARE` sobre `projects(P2)` (en borrado por `sd2`) y se cierra el ciclo `su → sd2 → sd1 → su`. **3 de 3**: `deadlock detected` + `ASIGNACION_EMPRESA_DISTINTA`; queda 1 de {P1, P2}. Con la misma
  secuencia y el candado quitado de la función: ningún interbloqueo, `su` recibe `ASIGNACION_EMPRESA_DISTINTA` y se borran P1 y P2. No se midió la frecuencia con peticiones reales (la ventana exige la transacción ajena).
* **V4-H02 · el aislamiento.** AP con `{P1,P2}`. `s1` (AP): `BEGIN ISOLATION LEVEL …; SELECT count(*) FROM projects` (fija la instantánea); `s2` (AP, `READ COMMITTED`): `DELETE FROM projects WHERE id = P2; COMMIT`; `s1`: `DELETE FROM projects WHERE id = P1; COMMIT`.

  | Aislamiento de `s1` | Error | Filas de AP | Exento |
  |---|---|---|---|
  | `REPEATABLE READ` | ninguno | `[]` | **sí** |
  | `SERIALIZABLE` | ninguno (tampoco `40001`) | `[]` | **sí** |
  | `READ COMMITTED` | `ASIGNACION_PROPIA_NO_PERMITIDA` | `[P1]` | no |

  Ninguna migración, función, `config.toml` ni script del repositorio fija el aislamiento (`grep` sobre `supabase/migrations`, `supabase/functions`, `supabase/config.toml` y `scripts`, sin resultados salvo el comentario de esta ronda).
  Que PostgREST no deja elegirlo por petición **es lectura de su documentación, no una medición**.
* **V4-H03 · la clave de la persona.** Datos sanos: el propietario de D retiene `624734017/2267934393` y el de C borra otro proyecto y **termina sin esperar** (0 esperas de candado, 0 errores). Fila cruzada heredada (OP1, persona de C, en D1, proyecto de D; solo
  montable con `session_replication_role = replica`): el propietario de D que borra D1 retiene `3318012178/3943810061` —la clave de **C**— y el propietario de C, al borrar P3, espera y falla con `canceling statement due to lock timeout`.
  Personas sin empresa con filas heredadas (SINEMP en P4 de C, CLI en D1 de D): el propietario de D retiene `4259767145/4192058358` (`sin-empresa`) y el de C espera y falla con `55P03`. Un inquilino no puede fabricar esas filas: el propietario y un
  administrador de C que asignan a una persona sin empresa reciben `ASIGNACION_EMPRESA_DISTINTA`. Las tres situaciones están fijadas en `run.sh` (H-03, H-05/M7) y `assert_catalogo`.
* **V4-H04 · dos claves.** X e Y son proyectos de C con filas heredadas en orden físico (OP1[C], DOP[D]) en X y (DOP[D], OP1[C]) en Y. `ctl` retiene la tupla (DOP, X); `s1` borra X (toma la clave de C y espera la tupla); `s2` borra Y (toma la clave de D y
  espera la de C); `ctl` confirma; `s1` pide la clave de D: `deadlock detected` (`s2` espera `[…,3318012178,3943810061]`, `s1` espera `[…,624734017,2267934393]`). Queda 1 de {X, Y}.
* **V4-H05 · M6 y M7.** `expF`: ADM1 y ADM2 con `{P1,P2}` de C; SU2 (superadministrador de D) borra P1 sin confirmar; ADM1 borra P2. **Código real**: ADM1 espera (`esperan=1;retiene_1=1`, misma clave de C), recibe `ASIGNACION_PROPIA_NO_PERMITIDA` y conserva `{P2}`,
  no exento. **M6**: SU2 retiene la clave de D, ADM1 termina sin esperar y queda con 0 filas y **exento**. M7: ninguna baja toma candado (`esperan=0;retiene_1=0`).
* **V4-H06 · `lock_timeout` del llamador.** La sesión que espera el candado de su empresa, con `SET LOCAL lock_timeout = '200ms'`, falla a los **2 011,8 ms** (el `SET` de la función se impone al del llamador mientras la función corre).
* **V4-H07 · caminos que no toman el candado.** Un `DELETE` directo no toma candado (fijado por `assert_catalogo`, V3-03 M-c) y un `UPDATE` de `user_id`/`project_id` tampoco (medido a mano: AX2 termina sin esperar). Una baja de `app_users` **no cascada** a las asignaciones (no hay llave foránea): las 2 filas de OP5 siguen tras borrar a
  OP5, huérfanas, sin candado. Borrar P1 y P2 de AP en **una** sentencia se rechaza con `ASIGNACION_PROPIA_NO_PERMITIDA` y AP conserva `{P1,P2}`.

**Qué no se pudo probar en esta ronda.** PostgREST y Supavisor reales (el aislamiento por petición y «una sentencia por transacción» son lectura de la documentación y del repositorio, no medición); PostgreSQL 17 (producción es 17.6; aquí solo hay 16, con `fsync`
apagado y 4 núcleos: los recuentos de `55P03` con 30 sesiones y las tasas de interbloqueo no se extrapolan); los datos de producción (no se leyeron: «0 cruces» y «9 personas sin empresa» vienen de la sección «Datos de producción encontrados»; **no se sabe**
si esas 9 personas tienen filas); `ASG_CARGA=1` (las cifras de carga no se repitieron); la atribución exacta de los interbloqueos de la mezcla con transacciones de varias sentencias (hay `40P01` también sin la migración; solo se aisló con un ciclo determinista el
caso de V4-H01 y el de V4-H04).

## Cambio de flujo (F-03): el administrador acotado que crea un proyecto **por la API** (decidido en la sexta ronda)

> **Sexta ronda.** El dueño del negocio decidió (ver «La decisión del dueño del negocio»): la autoridad sobre los proyectos es del principal. Se implementó la **opción (c)**: `projects_insert` y `projects_delete` son del principal (`0700`). El flujo «un administrador crea un proyecto por la API y se lo asigna» **ya no existe** ni por la API: no puede crear el proyecto. El texto que sigue describe el problema tal como estaba planteado en la tercera ronda.

**Esto es un cambio solo de API, no de pantalla** (F2-02; leído en el código, no supuesto):

* La ruta `/empresa` —la única que usa `AsignacionModal`, vía `EmpresaSection` → `EmpresaUsuariosSection`— declara `allowedRoles: ['company_owner']`
  (`src/components/app/routes.tsx:253-255`) y `RoleGuard` niega el paso a cualquier otro rol (`src/components/shared/AccessDenied.tsx`). La pestaña
  «Mis Proyectos» que lleva a ella solo se muestra a `company_owner` (`src/components/layout/Sidebar.tsx:47-49`). El superadministrador entra por
  `/superadmin`, no por `/empresa`.
* La lista de personas de esa pantalla **excluye a la persona conectada** (`src/domain/empresa/queries.ts:89`, `.neq('id', currentUserId)`, anterior a este PR):
  nadie ve su propia fila ni el botón «Acceso» sobre ella.
* El asistente de configuración que crea el primer proyecto (`src/App.tsx`, `necesitaOnboarding`) solo aparece a quien es **exento** de proyecto y la
  empresa no tiene proyectos.

Por tanto un `admin` **no abre `/empresa`, no ve «Nuevo Proyecto» y su fila no se pinta**: el flujo «un administrador acotado crea un proyecto, no lo ve y
se lo asigna a sí mismo desde “Acceso” en su propia fila», que decía la versión anterior de este documento, **no existe en la pantalla**. Solo se puede
hacer con peticiones directas a PostgREST: `POST /rest/v1/projects` (`projects_insert` deja crear a `admin` y `company_owner`) y después
`POST /rest/v1/user_project_assignments` con su propio `user_id`. Esa segunda petición es la que la migración rechaza. Medido en la base con la forma de
producción: tras crear el proyecto, `can_access_project(nuevo)` es `false` para él; antes, su `INSERT` en `user_project_assignments` pasaba sin error; ahora
falla con `ASIGNACION_PROPIA_NO_PERMITIDA` (`assert_alcance`, `[otros caminos]`).

| Opción | Qué | Coste | |
|---|---|---|---|
| (a) ~~Aviso en pantalla al administrador~~ | **Retirada**: viviría en una pantalla que el afectado no puede abrir. Si se quisiera una guía, iría a quien **sí** ve la pantalla: al propietario, al crear un proyecto («los administradores acotados no lo verán hasta que se lo asignes») | Una línea de interfaz; ningún cambio de seguridad | Opcional, del propietario |
| (b) Trigger `AFTER INSERT ON projects` (`SECURITY DEFINER`) que asigne el proyecto nuevo a su creador acotado | Amplía su alcance solo con lo que él mismo creó | Una pieza más de servidor que escribe la tabla; hay que probarla (también con `service_role`) | No implementada |
| (c) Solo el propietario crea proyectos | Cambia `projects_insert` | Quita a los administradores una capacidad que la pantalla ya no les ofrece | No implementada |

**Decisión D-9 (sexta ronda): cerrada con la opción (c).** Sólo el principal crea proyectos (`projects_insert`, `0700`); un administrador que lo intente por la API recibe 42501 (`assert_principal` J1). Nadie queda ya con un proyecto creado que no ve. En la interfaz, el botón «Nuevo Proyecto» se deshabilita para quien no sea principal, con «Solo el propietario de la empresa crea proyectos.», y el asistente de primer proyecto sólo lo ve el propietario (ambas compuertas son defensa en profundidad: ningún administrador abre hoy esa pantalla). Hasta que la `0700` llegue a producción, el flujo antiguo existe tal como estaba descrito (con la `0600` sola, el administrador crea el proyecto pero no puede asignárselo).

## Qué NO cambia

* **Las filas**: ni una; conteo y huella idénticos antes y después (la migración lo comprueba y aborta si no).
  Las 10 huérfanas se conservan; no se «arreglan» ni se borran.
* La política **SELECT** (cada persona lee las suyas), `permission_type` (hoy todas `total`; ninguna política,
  función ni pantalla lo lee para decidir acceso), y `user_has_project_access`, `can_access_project`,
  `user_is_project_exempt` y todas las políticas de otras tablas.
* Lo que pueden hacer el **propietario** y el **superadministrador** sobre **otras** personas de su empresa y lo de **otra empresa**
  (de los 28 flujos de la pantalla, los 10 del principal y de otra empresa dan el mismo resultado antes y después).
* **Lo que SÍ cambia, a propósito (decisión del dueño)**: lo que hacía un **administrador** —asignar y quitar proyectos a otras personas, crear y borrar proyectos,
  escribir roles, llaves y asignaciones de roles, invitar administradores— ya no lo hace por la API (los 13 flujos con actor administrador y los 5 de autoedición). En la pantalla real
  no cambia nada para nadie: sólo el propietario abre `/empresa` (F2-02).

## Una diferencia con el diseño inicial, justificada con una prueba (superada en la sexta ronda)

> **Sexta ronda.** Esta condición («sólo los proyectos que el administrador ve») ya no existe: el administrador dejó de escribir la tabla y el único actor no superadministrador que la escribe, el propietario, ve todos los proyectos de su empresa (ver «La decisión del dueño del negocio»). Se conserva el texto porque explica por qué la condición existía y qué prueba la justificaba; esa prueba ya no aplica a la regla vigente.

El diseño pedía que el administrador pudiera administrar «persona y proyecto de su empresa». Se añadió una
condición: **solo los proyectos que él mismo ve** (`user_is_project_exempt() OR user_has_project_access(proyecto)`).
Motivo: la política anterior hacía `project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id())`,
y esa subconsulta corre bajo la RLS de `projects`; un administrador acotado solo repartía —y solo podía borrar—
filas de **sus** proyectos. La regla es `SECURITY DEFINER` y no pasa por esa RLS: si solo comparara la empresa, el
«borrar todas y volver a insertar» de la pantalla de un administrador acotado **borraría también las asignaciones
de la persona a proyectos que ese administrador no ve y no podría restituirlas** (pérdida de acceso de terceros).
Prueba: `[B2] «borrar todas» de OP4 (P4, P5: ninguno lo ve) NO borra nada` y `[flujo 2] el administrador acotado NO
borra lo que no ve`; la mutación «la regla compara sólo la empresa» pone en rojo `assert_matriz`, `assert_flujos` y
`assert_capas`. Es lo mismo que hacía la política anterior (esos casos están **en verde también sin la migración**).

## Datos de producción encontrados (solo lectura, 2026-10-10; recontados 2026-10-11)

| Dato | Valor |
|---|---|
| Filas / usuarios distintos | 43 / 27 |
| `permission_type` | las 43 son `total` (no hay `lectura`, `financiero` ni `administrativo`) |
| Filas **huérfanas** (`user_id` sin `app_users`) | **10**, de **6** usuarios distintos |
| Filas con la empresa de la persona distinta de la del proyecto | **0** |
| Empresas / proyectos | **5 empresas registradas**; los 8 proyectos (7 activos y 1 suspendido) y todo el personal con filas están en **una sola**; la otra empresa con personas es la del superadministrador, **sin proyectos**; las otras tres no tienen ni proyectos ni personas |
| Personas (`app_users`) | 32: 22 en la empresa con proyectos (1 propietario, 1 administrador, 7 operadores, 13 visores), 1 superadministrador en otra empresa y 9 clientes sin empresa |
| Por rol (filas / personas) | administrador 3 / 1 (el único administrador acotado), operador 14 / 7, visor 16 / 13 |
| Privilegios | `anon` y `authenticated` con los 7 sobre la tabla (en PG17, `arwdDxtm`) |

Con 0 cruces y los proyectos en una sola empresa, el trigger de integridad no encuentra nada que rechazar en los datos
actuales: solo cierra el camino hacia adelante. `scripts/diagnostico-asignaciones-proyecto.sql` (un único `SELECT` de solo
lectura) repite los números de la tabla y se corre en producción **antes y después**; no imprime correos ni nombres.

**Qué compara «lo que cada persona lee».** En la suite y en este documento, «lo que cada persona lee» es **la tabla
`user_project_assignments`** (lo que devuelve la política SELECT, 39 personas, 0 diferencias antes/después). La verificación
independiente comprobó además, sobre una base propia con la forma de producción, que `user_is_project_exempt()`,
`can_access_project()` (8 proyectos, `NULL` y uno inexistente) y las lecturas de `projects`, pagos, registros,
`user_project_assignments` y `app_users` son idénticas antes y después en **39 de 39** personas; esa comparación ampliada no
está en `run.sh`.

## Flujos legítimos de administración probados

`supabase/tests/asignaciones_proyecto/assert_flujos.sql` reproduce la pantalla (borrar todas + insertar, y el guardado
por diferencias) con sesiones autenticadas simuladas. **Aviso (F2-02): los flujos con actor `admin` son sintéticos.** La pantalla real solo la
abre el propietario (ver «Cambio de flujo (F-03)»); lo que se prueba con un administrador es lo que ocurriría si un administrador hiciera esas mismas
escrituras directamente por la API, que es lo que las migraciones protegen. **Desde la sexta ronda sólo el principal escribe**, y los flujos de administrador pasan de «igual que antes» a «no escribe»:

| # | Flujo | Resultado frente a la versión anterior de la suite |
|---|---|---|
| 1 | Administrador **exento** reemplaza a otra persona de su empresa | **Cambia, a propósito**: no escribe nada (42501 o 0 filas) |
| 2 | Administrador **acotado** reemplaza a otra persona; antes, lo que no veía sobrevivía | **Cambia**: no escribe nada; la condición de «lo que no ve» ya no existe |
| 3 | **Propietario** reemplaza a cualquiera de su empresa y **a sí mismo** | Igual que antes |
| 4 | **Superadministrador** (`super_admin` y `superadmin`) administra cualquier empresa | Igual que antes |
| 5 | Un administrador cambia el alcance de **otro administrador** (también lo deja sin filas) | **Cambia**: ya no puede (D-2 i) |
| 6 | Propietario de otra empresa administra la suya | Igual que antes |
| 7 | Cada persona **lee** solo lo suyo; el administrador acotado, las filas de sus proyectos | Igual que antes (la política SELECT no cambió) |
| 8 | `service_role`: sembrado que borra y vuelve a insertar, `UPSERT … ON CONFLICT (user_id, project_id)` | Igual que antes |
| ✗ | Autoedición (operador, administrador acotado o exento sobre sí mismo): 5 flujos | **Cambian** desde la primera ronda: no escribe nada y devuelve error (o 0 filas) |

De los **28 flujos** de la suite, **10 dan exactamente el mismo resultado antes y después** (los del principal y los de otra empresa) y **cambian 18**: los 13 con actor administrador (el servidor ya no los deja escribir) y los 5 de autoedición (`run.sh` lo compara automáticamente y falla si el número de diferencias cambia). Las escrituras de los scripts de siembra son compatibles:
`scripts/seed-rls-sandbox.mjs` converge con el cliente de servicio (borra y hace `upsert`) y
`scripts/rls-evidencias-datos.sql` asigna personas y proyectos de la misma empresa (se ejecutaron sus `INSERT`
contra una base con la `0600` puesta en la primera ronda: 4 filas, sin error; **no se repitió con la regla de la sexta ronda**: son fixtures de sandbox y **no se comprobó** con qué rol se cargan: con el rol de servicio o un superusuario no pasan por las políticas; con la sesión de un administrador ya no escribirían). El flujo «administrador acotado crea un proyecto y se lo
asigna» **no está entre los flujos** y deja de existir (F-03, D-9).

## Interfaz

Se corrigieron F-01, F-02, F-05, F-06 y F-07 (`AsignacionModal.tsx`, `EmpresaUsuariosSection.tsx`,
`domain/empresa/usuarios.ts`):

* **Sexta ronda · el principal** (`domain/empresa/usuarios.ts`, `EmpresaUsuariosSection`, `EmpresaProyectosSection`, `EmpresaSection`, `App.tsx`): `esPrincipalEmpresa(role)` es `company_owner`, `super_admin` o `superadmin`. `puedeEditarAsignaciones(actor, usuario)` deja pasar al principal; a cualquier otro lo niega con `MOTIVO_SOLO_PRINCIPAL`
  («Solo el propietario de la empresa asigna proyectos, permisos y administradores.») salvo en su propia fila, que conserva el motivo de la autoedición. `puedeCrearProyectos(role)` deshabilita «Nuevo Proyecto» para quien no es principal
  (`MOTIVO_SOLO_PRINCIPAL_PROYECTOS`: «Solo el propietario de la empresa crea proyectos.») y `veAsistentePrimerProyecto(role)` limita el asistente de primer proyecto al propietario. La propia lista de `/empresa` sigue siendo del propietario. **El servidor manda**: esto sólo evita ofrecer lo que será rechazado.
* **Autoedición**: en la fila del propio administrador el botón «Acceso» queda deshabilitado, con el texto
  «Tus proyectos los cambia otro administrador, el propietario o el superadministrador» (desde la sexta ronda, para un administrador, el motivo de las demás filas es el del principal); si aun así se abriera el
  modal, «Guardar» está deshabilitado con «No puedes cambiar tus propios proyectos…». Propietario y superadministrador
  (`super_admin` y `superadmin`) sí pueden. El servidor es el que manda; esto solo evita ofrecer lo que será rechazado.
  **Es defensa en profundidad hoy inalcanzable (F2-02):** la pantalla solo la abre el propietario y su lista excluye a la persona conectada,
  así que ningún administrador llega a ver su propia fila; las pruebas con actor `admin` (`AsignacionModal`, `EmpresaUsuariosSection.acceso`)
  son **sintéticas**. La compuerta vale si un día se abre `/empresa` a administradores. Del mismo modo, «dos administradores a la vez» en la
  pantalla son en realidad **dos sesiones del propietario** (dos pestañas o dos dispositivos): los administradores no están en esa pantalla.
  **`actor` es obligatorio** en `AsignacionModal` (un llamador que lo omitiera no tendría compuerta; ahora es un error de tipos,
  probado con `@ts-expect-error`).
* **Conjunto inicial y diferencia de tres vías** (F-01, F-02). El modal guarda lo que había **al abrir**. La diferencia ya no se
  calcula contra una lectura nueva al guardar sino contra ese conjunto: `insertar = deseadas ∖ inicial`,
  `borrar = (inicial ∖ deseadas) ∩ proyectos que la pantalla muestra`. Así solo se escribe lo que la persona cambió y **dos
  administradores a la vez no se deshacen el trabajo** (en la pantalla real, dos sesiones del propietario; sondas S4: «el otro añadió p3, éste quita p2» ⇒ p3 sobrevive; S5: «el otro
  quitó p2, éste añade p3 con p2 aún marcado» ⇒ p2 no resucita; ambas son ahora pruebas de vitest). Una asignación a un proyecto
  que la pantalla no lista se conserva (S8).
* **Lectura inicial fallida** (F-01, S6): se muestra el error («No se pudieron cargar las asignaciones actuales…») con
  «Reintentar», no se pintan casillas y **«Guardar» queda deshabilitado**: nunca se borra por una lectura fallida (antes: las
  casillas salían vacías, «Guardar» activo y, sin tocar nada, se borraba todo lo editable).
* **`guardar()` con `try/catch`** (F-05, S2): una excepción de red ya no deja un rechazo sin manejar ni un botón en «Guardando…»;
  `guardarAsignacionesProyecto` tampoco lanza (devuelve `{ error, parcial }`).
* **Fallo parcial** (F-06, S3, F2-01): si el insert valió y el borrado (o la lectura de comprobación) falló, el aviso dice «Se aplicó una
  parte de los cambios y otra no. Vuelve a guardar para completar el resto», la lista de atrás se recarga (`onReload`) y el
  diálogo sigue abierto. **Tras un parcial se relee lo que HAY en la base y ése es el nuevo conjunto inicial** (F2-01): antes se conservaba el de
  la apertura, y quien cambiaba de idea y guardaba otra vez (re-marcaba lo que había quitado y desmarcaba lo que se había insertado) calculaba la
  diferencia contra un estado que ya no era cierto: la fila ya insertada se quedaba y la pantalla decía «guardado». Reintentar sin tocar nada sigue
  convergiendo (y ya no vuelve a insertar lo que ya entró). Si la relectura falla, no se sabe qué hay en la base: se pasa a la pantalla de error con
  «Reintentar» y «Guardar» deshabilitado (nunca se guarda a ciegas); «Reintentar» recarga desde la base y descarta la selección en pantalla.
* **Fallo SIN respuesta de la base** (V3-02, misma familia que F2-01). `guardarAsignacionesProyecto` solo marcaba `parcial` si ya había una escritura confirmada: una excepción, un
  error de red o una pasarela 502 en la **primera** escritura (o en un `DELETE` sin `INSERT` previo) se tomaba por «no se aplicó nada» aunque la petición hubiera llegado y valido en el servidor. El
  modal no releía, `inicial` quedaba desfasado y, si la persona cambiaba de idea y guardaba otra vez, la pantalla decía «guardado» con la base distinta (añade p3, la respuesta se pierde, quita p3: p3
  se quedaba). Importa que `@supabase/postgrest-js` **no lanza** ante un fallo de red: devuelve `{ error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }`. Ahora solo una respuesta
  de la base **con un código que tenga su forma** —un SQLSTATE de cinco caracteres, dígitos y mayúsculas: 42501, 23514, 23505, 55P03, 57014…, o un `PGRSTnnn` de PostgREST— deja claro que la sentencia se deshizo; todo lo demás es **ambiguo**
  (`escrituraAmbigua`: excepción, `status` 0, error sin código, **o un `code` que no tiene esa forma**, p. ej. el numérico 504 o `upstream_timeout` de una pasarela: H5, quinta ronda; antes cualquier código no vacío se tomaba por definitivo) y da
  `parcial` + `incierto`: el aviso dice «No se pudo confirmar si los cambios se aplicaron», se recarga la lista de atrás y el modal **relee** lo que HAY (ése es el nuevo «antes»); si la relectura falla,
  pantalla de error con «Guardar» deshabilitado. El título del aviso distingue «sin guardar», «a medias» y «no se pudo confirmar el guardado». La lectura de comprobación posterior a las escrituras se
  atrapa por separado (una excepción ahí ya no sale de la función). Dos pruebas antiguas fijaban el comportamiento equivocado («una excepción en la primera escritura no es parcial» y «no se recarga la
  lista») y se corrigieron en el mismo sentido.
* **La relectura tardía no pisa a otra persona** (V3-05): la relectura posterior a un fallo lleva la guardia de vigencia del efecto de carga (un contador de «versión» de la pantalla que sube con cada
  carga): si mientras vuela cambia el prop `usuario`, no toca el `inicial` ni el error de carga de la persona nueva. Era inalcanzable desde `EmpresaUsuariosSection` (el fondo del modal tapa los botones «Acceso»), pero el
  componente es reutilizable; en la quinta ronda el cambio de persona **remonta** el modal (`key={usuarioAsignar.id}`, H3) y la guardia cubre también el éxito tardío (H2): ver abajo.
* **La lectura filtra por persona** (V3-03 a): pruebas con filas de **otra** persona en la tabla simulada (el modal de `u-op` muestra solo `{p1,p2}` con filas de `u-op2` en p3 y p4); matan el mutante N08
  (`fetchUserProjectAssignments` sin `.eq('user_id', …)`), que sobrevivía a las 192 pruebas.
* **Guardado por diferencias** (`guardarAsignacionesProyecto`): **inserta primero** lo que falta (`ON CONFLICT DO NOTHING`:
  `ignoreDuplicates`), **después** borra solo lo que sobra, y lee de vuelta. Se justificó con la prueba: (i) con «borrar todas +
  insertar», si el insert falla la persona se queda con **cero** asignaciones (`[flujo 9]`: `|42501|0`), y un administrador sin
  filas es exento; por diferencias un insert fallido no borra nada (`P2,P3|42501|2`); (ii) las filas que no cambian se
  **conservan** con el mismo `id`, `created_at` y `permission_type` (antes se recreaban como `total`: `[flujo 1]` 0 conservadas
  frente a 2); (iii) la RLS puede filtrar un `DELETE` y contestar 0 filas **sin error**: la lectura posterior lo detecta y la
  pantalla ya no dice «guardado».
* `deleteUserProjectAssignments` e `insertUserProjectAssignments` quedan `@deprecated` (la pantalla ya no las usa; sus pruebas
  existentes se conservan).
* **Mutantes de interfaz** (F-07, F2-08): se aplicaron a mano y ahora mueren: no pasar la lista editable al guardar (el proyecto oculto se
  borraría), `ignoreDuplicates: false`, no deshabilitar «Guardar» tras una lectura fallida, calcular contra una lectura nueva,
  quitar el `try/catch` del modal. La segunda verificación aplicó 25 mutantes a `usuarios.ts`, `AsignacionModal.tsx` y `EmpresaUsuariosSection.tsx`: 16
  morían y **6 no equivalentes sobrevivían**: la comprobación posterior que no mira lo insertado (M06, `guardarAsignaciones.test.ts`), la guardia de
  lectura obsoleta `vigente` (M11) y «Guardar» deshabilitado mientras «Reintentar» relee (M15, ambas en `AsignacionModal.carrera.test.tsx`, con lecturas
  que responden cuando la prueba lo decide), que la Sección pase `onSaved` y `onReload` al modal (M20, M19) y `aria-describedby` (M23,
  `EmpresaUsuariosSection.acceso.test.tsx`). Con las pruebas de `d1aeb94a` esos 6 y los 2 de F2-01 (M26, M27) **sobreviven**; con las nuevas **mueren los 8**.
  De los 27 mutantes quedan vivos **2, equivalentes**: M12 (`guardar()` sin su guardia propia: el botón ya está deshabilitado y no hay otra vía de
  entrada) y M14 (casillas habilitadas para quien no puede editar: «Guardar» sigue deshabilitado). M18 (`deseadas` = todo lo marcado) también es
  equivalente —lo oculto está en `inicial` y no cambia nada— y muere ahora por casualidad, por el orden de los argumentos en una aserción nueva.
  **Cuarta ronda**: 18 mutantes nuevos sobre `usuarios.ts` y `AsignacionModal.tsx` (la ambigüedad siempre falsa, sin la rama «sin código» o sin la de «status 0», una excepción que no es ambigua, la rama ambigua que
  no es parcial o pierde `incierto`, el mensaje genérico, el DELETE o el INSERT ambiguo tratado como definitivo, la lectura de comprobación sin `try/catch`, el modal que no relee o no distingue el título,
  la relectura sin guardia, la guardia que siempre vale, el efecto que no sube la versión, la versión capturada tarde y el N08): **mueren los 18**. La
  limpieza del efecto que subía la versión al desmontar era redundante para la relectura (la siguiente ejecución del efecto ya la sube; al desmontar, un `setState` tardío lo ignora React) y se quitó; **la quinta ronda la
  restituye por otra razón (H2)**: sin ella, un guardado que termina bien después de desmontar el modal llamaba a `onClose()` y cerraba el de la persona siguiente.
* **Quinta ronda · H1: tras un guardado parcial o incierto las casillas se reconcilian con lo que hay (fusión de tres vías).** `AsignacionModal` relee tras un `parcial`/`incierto` y renovaba `inicial`, pero **no las casillas**:
  si otro administrador cambió a la misma persona entre la apertura y la relectura, el siguiente «Guardar» sin tocar nada **lo deshacía** —borraba una asignación ajena que la persona nunca vio (la casilla seguía desmarcada
  aunque la base la tenía) o **reinsertaba una que el otro acababa de revocar** (la casilla seguía marcada: acceso restituido, lo sensible en un PR de seguridad)—. Ahora las casillas pasan a
  `(inicial NUEVO ∖ lo que la persona QUITÓ) ∪ (lo que AÑADIÓ)`, limitada a los proyectos editables (`quitó = inicial ANTERIOR ∖ casillas`, `añadió = casillas ∖ inicial ANTERIOR`; función pura `reconciliarCasillas` en
  `domain/empresa/usuarios.ts`, regla documentada en el componente): un proyecto que la persona no tocó refleja lo que **hay**, uno que sí tocó conserva su elección (apliqué o no el servidor esa escritura: lo que falta por
  escribir es la diferencia contra el `inicial` nuevo). Se fusiona sobre las casillas de **ahora** (`setAsignados(prev => …)`): lo que la persona marca mientras el guardado vuela no se pierde. Es el caso de «dos sesiones del
  propietario» (dos pestañas): la regla de tres vías de F-01 ya cubría el entrelazado normal; esto cubre el que pasa por una respuesta perdida o un parcial.
* **Quinta ronda · H2 y H3: un guardado tardío no cierra la pantalla de otra persona, y cambiar de persona remonta el modal.** (H2) La rama de éxito (`onSaved(); onClose()`) no comprobaba la versión de pantalla: si el modal pasaba
  de A a B (o se cerraba) mientras el guardado de A seguía en vuelo y éste terminaba bien, se cerraba el modal de B. Ahora, si la pantalla ya no es la misma, no se llama a `onSaved` ni a `onClose` y **sí se recarga la lista
  de atrás** (`onReload`: la base cambió). La relectura de un parcial ya llevaba su guardia (V3-05). (H3) Con `usuario` ya igual a B, durante un render `loading`, `inicial` y las casillas seguían siendo los de A hasta que corría el efecto
  de carga: un clic en «Guardar» dentro de esa ventana habría escrito la selección de A sobre B (la ventana se forzó con un `useLayoutEffect`; la aplicación no cambia `usuario` sin desmontar). Defensa estructural: la Sección pasa
  `key={usuarioAsignar.id}` al modal, así que otra persona = otra instancia con el estado de cero. El componente lo documenta como contrato.
* **Quinta ronda · H4: dos mutantes vivos.** MM10 (`editables` = proyectos mostrados ∪ `inicial`: una fila de un proyecto **no mostrado** que aparece en `inicial` tras una relectura se borraría al reintentar) se mata con una prueba nueva
  (el reintento tras la relectura no emite ningún `DELETE` de ese proyecto). MM5 (quitar `errorCarga` del guard interno de `guardar()`) es **equivalente a nivel de DOM**: el botón deshabilitado ya impide el clic y no hay otra
  vía (no hay `<form>`, Enter no envía nada) hacia `guardar()` con la carga fallida; el guard interno es defensa en profundidad que la interfaz no puede ejercitar, y queda anotado en el comentario de la prueba.
* **Mutantes de la quinta ronda** (cada uno aplicado con un guion que no forma parte del repositorio y restaurado después, corriendo `src/components/empresa` y `src/domain/empresa`): 21, **los 21 mueren** —casillas = solo el inicial nuevo (pierde la intención), = solo las casillas de antes (el
  comportamiento anterior), quitó/añadió invertidos, fusión sobre las casillas del cierre y no sobre las de ahora, sin limitar a los editables, fusión contra el inicial nuevo, éxito sin comprobar la versión, sin la limpieza del efecto, sin
  `key`, MM10, éxito tardío sin recargar la lista, relectura sin guardia y seis de `escrituraAmbigua` (código no vacío = definitivo, sin la forma `PGRSTnnn`, sin la forma SQLSTATE, sin comprobar que sea texto, SQLSTATE en minúsculas y
  longitud libre, sin el `status` 0) más tres de `reconciliarCasillas`.

## Resultados de las pruebas

Suite `supabase/tests/asignaciones_proyecto/run.sh` (PostgreSQL 16 real, cadena de 557 migraciones anteriores a la serie, cableada en `coverage.yml`, puerto 55532). **Las cifras de esta sección son de la sexta ronda y salen de contar lo que la suite imprime al ejecutarla** (no se editaron a mano); las de rondas anteriores que se conservan más abajo llevan su ronda y no se re-midieron.

| Bloque | Resultado |
|---|---|
| Datos como producción | 43 filas · 27 usuarios · 10 huérfanas; huella md5 `(id, user_id, project_id, permission_type)` y de **todas** las columnas idénticas antes/después; las 43 coinciden fila a fila con la copia original; `user_is_project_exempt()`, `can_access_project()` (39 personas × 10 proyectos = 390 pares) y lo que cada persona lee **de la tabla**: **0 diferencias** (19 comprobaciones) |
| Catálogo y privilegios | 48 comprobaciones: 4 políticas de asignaciones con la regla, SELECT idéntica a producción, 2 triggers por fila BEFORE, 3 funciones `SECURITY DEFINER` con `search_path` vacío, `EXECUTE` solo para quien debe, el candado de bajas en cascada (comportamiento con `pg_locks`, clave por empresa de la persona, `lock_timeout` de 2 s), `anon` sin privilegios, `authenticated` sin `TRUNCATE`/`TRIGGER`/`REFERENCES`; **y las 18 políticas de las cinco tablas de la `0700`: las 11 del principal con el texto esperado (y que no admiten al administrador) y las 7 que no se tocan con el `md5` de `pg_get_expr` de producción** |
| Matriz rol × operación × objetivo | **160 casos** (INSERT, UPDATE, DELETE, UPSERT e `INSERT … SELECT`; superadministrador en las dos grafías, propietario, administrador exento y acotado, operador, visor, cliente, sesión sin `app_users`, sin empresa, administrador/propietario/operador de otra empresa, `anon`, `service_role`, superusuario; filas propias y ajenas; proyectos propios, ajenos y de otra empresa; personas de la empresa, de otra, huérfanas, sin empresa e inexistentes; `UPDATE` que cambia `user_id` a sí mismo y `project_id` a otra empresa). Cada «no debe pasar» comprueba **código y mensaje**, que la tabla no cambió y que la **misma sentencia como SISTEMA sí funciona** (el cero no es un `WHERE` equivocado). Sólo el principal escribe. Frente a los 148 casos de la quinta ronda: 121 no cambiaron, 27 se reescribieron con la expectativa nueva (un administrador pasa de «escribe» a «42501 o 0 filas») y se añadieron 12 (la comparación sale de las líneas de caso del archivo: 27 quitadas, 39 añadidas) |
| Flujos legítimos | 41 comprobaciones (28 flujos de pantalla + lecturas/servicio): 10 dan el mismo resultado que sin las migraciones, 18 cambian (13 de actor administrador y 5 de autoedición); la guarda de `run.sh` falla si ese número cambia |
| Alcance | 31 comprobaciones: **290/290** intentos de autoasignación (29 personas × 10 proyectos) bloqueados con 42501/23514; **84/84** intentos de borrar/cambiar lo propio afectaron 0 filas; el alcance de las personas no se movió; ningún administrador acotado se vuelve exento por su cuenta; F2-03 **invertido** (un administrador ya no borra el proyecto de otro: 0 filas) |
| Capas por separado | 39 + 37: las **políticas solas** (sin triggers) ya cierran el hueco; los **triggers solos** (con una política `true`, y con una permisiva `zz` añadida a las verdaderas) también, incluida la sesión sin `app_users` (F3) y borrar UNA fila propia (F-08) |
| **El principal (nuevo)** | **246 comprobaciones** (`assert_principal.sql`): **10 actores** —superadministrador en las dos grafías, propietario, administrador acotado, administrador exento, operador, visor, sesión sin `app_users`, propietario de **otra** empresa y un operador con el rol RBAC de sistema «Admin Plataforma»— por **21 escrituras sensibles** (5 de invitaciones, 2 de `app_users`, 3 de proyectos, 3 de roles, 2 de llaves, 3 de asignaciones de roles y 3 de asignaciones de proyecto), más la empresa D (propietario y administrador de D), el límite de lo que **no** cambia (la lectura de roles, asignaciones de roles e invitaciones, la edición de proyectos y la invitación de operadores siguen abiertas al administrador), la sesión sin `app_users` (la regla devuelve `false`, no `NULL`) y el flujo de D-9/D-2 (lo asigna el principal; un administrador no se lo asigna ni acota a otro). Cada caso lleva su control (la misma sentencia como sistema sí afecta filas) y distingue 42501 de «0 filas sin error» |
| Control negativo | **Sin las migraciones**: matriz **98 rojos y 62 verdes de 160**, el principal **38 rojos y 188 verdes de 226** (los verdes son lo legítimo y lo que ya estaba cerrado), y rojas `assert_alcance`, `assert_catalogo`, `assert_defensa`, `assert_capas` y `assert_principal`. **Con la `0600` sola**: el principal sigue en rojo en **30 casos** (proyectos, roles, llaves e invitaciones `admin`, que son de la `0700`) y verde en 214 de 244. (Los totales impresos varían entre bases —226, 244, 246—: la suite cuenta las líneas que imprime y no se investigó la diferencia entre ellas.) |
| Idempotencia | 2ª pasada limpia de cada migración; huella del catálogo de `public` idéntica (3363 grupos, 0 diferencias); la `0600` cambia **9** grupos de la huella y la `0700` **5**, todos de políticas |
| Guardas | `0600`: pre-vuelo con `can_access_project(uuid)` ausente aborta y no deja ninguna pieza; corrida por un rol que **no es el propietario** (S15) aborta y sin piezas; post-vuelo que cambia **una** fila aborta («las filas … CAMBIARON»); `lock_timeout` con una transacción larga: falla en 5 s sin piezas y, reintentada, se aplica. **`0700` (4f)**: sin `is_company_owner()` aborta («faltan is_company_owner()») sin cambiar ninguna política; con una política de otro texto (`roles_insert = true`) aborta con «DERIVA» y no la sobrescribe (mutación «sin la guarda de deriva»: la sobrescribe en silencio, la prueba la ve); post-vuelo con una fila de `roles` cambiada aborta (mutación «sin la comprobación de filas»: la confirma); rol que no es propietario: «asg_intruso no es el propietario de projects»; con `search_path` vacío, `auth,public`, `public`, `pg_catalog` y `"$user", public` deja el **mismo** catálogo (sin calificar los nombres, aborta con el vacío); **con CERO privilegios para `anon`, `authenticated`, `service_role` y `PUBLIC` sobre las cinco tablas y las cuatro funciones auxiliares se aplica igual** (no consulta ninguna ACL: el P0 de la `0600` no se repite); aplicada **sola** sobre la cadena sin la `0600` deja las mismas 18 políticas |
| **4c · ACL de Supabase Preview y de producción** | Las dos migraciones se aplican **como un rol no superusuario con `BYPASSRLS`** con la ACL de la preview (`authenticated` sin DML: lo deja sin DML) y con la de producción (lo deja con DML); control negativo con el post-vuelo absoluto (aborta en la preview, pasa en producción); `assert_acl.sql` (10 comprobaciones por base) y, sobre la base de producción con ese propietario, **toda** la batería (612 comprobaciones: 10 + 48 + 160 + 41 + 31 + 39 + 37 + 246); las dos reversiones dejan el catálogo **exacto** con el propietario no superusuario (3 357 grupos, 0 diferencias, ACL incluida) y migraciones → reversiones → migraciones cierra el ciclo |
| Reversión | `scripts/reversion-asignaciones-proyecto.sql` (0600) y `scripts/reversion-principal-empresa.sql` (0700), dos veces cada una: huella del catálogo de `public` **idéntica** a la de antes de la serie (**0 diferencias en 3 357 grupos**); el `pg_get_expr` de las 4 políticas de asignaciones y de las 18 de la `0700` con el **`md5` exacto de producción**; 43 filas intactas; la matriz vuelve a **98 rojos** y, revertida sólo la `0700`, el principal vuelve a los **30 casos rojos** de «la `0600` sola». **8e: juntas** (0700 → 0600 y 0600 → 0700) dejan el catálogo idéntico al de antes de la serie, y **por separado** (revertir sólo la `0600` con la `0700` puesta) deja el catálogo de «sólo la `0700`». También con `search_path` vacío, `public`, `pg_catalog`, `"$user",public` y `auth,public,extensions` (V3-04) |
| Mutaciones | **67** (43 de catálogo + 11 de concurrencia + 1 de privilegios + 12 de guardas), contadas al ejecutar cada una; **en todas alguna aserción se pone en rojo** y el log imprime qué archivos. De catálogo, además de las de las rondas anteriores (cada política de asignaciones vuelta a la original, la regla que concede todo, sin cada trigger, privilegios devueltos, el revert completo y las ocho mutaciones de la función de bajas en cascada: F-08, F3, F1, V3-01 ×2, V3-03 M-c, H-05/M6 y M7): **M-a** (la regla vuelve a admitir al administrador, la versión anterior), **M-a2** (…sin la condición de «proyectos que él ve»), **M-b** («principal» = `user_is_project_exempt()`: el administrador **sin filas** contaría como principal), **M-c** (el propietario pierde la comprobación de empresa: el de D administraría C), la regla sin comprobar la persona, sin comprobar el proyecto, sin `COALESCE` y sólo para el superadministrador, y **17 de la `0700`**: cada una de las 11 políticas vuelta a su texto de producción (una por una), la reversión completa, `user_invitations_insert` que pierde sólo la condición del rol `admin`, `projects_update` hecha del principal (no debe cambiar), un `SELECT` (`roles_select`) que deja de admitir al administrador (no debe cambiar), `projects_insert` con «principal = exento» y `roles_insert` sin la condición de empresa. De guardas, **12**: las 5 de rondas anteriores (la comprobación vieja de `auth.uid` en el post-vuelo de la migración y en el de la reversión, el pre-vuelo sin la comprobación del propietario, la reversión sin su `LOCK TABLE` y la reversión sin calificar los nombres) y 7 de la `0700` (sin la guarda de deriva, sin la comprobación de filas, sin la comprobación del propietario, sin calificar los nombres con `search_path` vacío, la reversión de la `0700` sin calificar, la `0700` sin su `LOCK TABLE` inicial y su reversión sin `LOCK TABLE`). De concurrencia, las 11 de siempre; de privilegios, 1 |
| Concurrencia | Sesiones reales **sincronizadas sin ninguna espera fija** (un candado «puerta» y `pg_stat_activity.wait_event_type = 'Lock'`). **Escrituras de asignaciones** (A, B, D, F4): hechas por el **principal** —dos pestañas del propietario sobre la misma persona; el propietario contra un administrador que intenta autoasignarse (AX2: `ASIGNACION_PROPIA_NO_PERMITIDA`, no exento)—; D0/D1/D2 (cambio de empresa de la persona o del proyecto concurrente con la asignación); **F4 y R02 de las dos migraciones** (una escritura legítima llega con la migración o la reversión parada tras su pre-vuelo: espera, pasa, la escritura se aplica; sin el `LOCK TABLE`, el falso «CAMBIARON»); `lock_timeout` (C) de las dos migraciones. **Bajas en cascada de un NO principal** (F1, R2-1, V3-06, V3-01, H-05, la ronda a escala y R2-5): desde la `0700` **no existen por la API** (`projects_delete` es del principal) y se ejercitan con el rol de base de datos **propietario** y la sesión del administrador (`'!AP'`, `'!ADM1'`: salta la RLS, el trigger lee al actor de `app_users`), que es lo que el trigger y el candado siguen defendiendo (defensa en profundidad: una función `SECURITY DEFINER` futura, una conexión del dueño con un JWT, una política más permisiva). Los resultados son los de siempre (F1: la 2ª espera, recibe `ASIGNACION_PROPIA_NO_PERMITIDA`, AP conserva 1 fila y no es exento; sin el candado, 0 filas y exento; R2-1: ambos conservan `{P2}`; V3-01: la baja de otra empresa no espera, la de la misma sí y a los ≈ 2 s falla con 55P03; R2-1 a escala con 2, 6 y 30 sesiones) |
| Diagnóstico | `scripts/diagnostico-asignaciones-proyecto.sql`: una sentencia, corre con `default_transaction_read_only=on` (un `DELETE` ahí falla); antes: 10 huérfanas, «EL HUECO» señalado y las 11 políticas que admiten al administrador; después: «corregida», la regla y las 11 políticas del principal, `anon` sin privilegios; la sección «tabla» es idéntica |

Total de la suite: **1243 comprobaciones ✓** (621 del flujo principal —19 + 48 + 160 + 41 + 31 + 39 + 37 + 246—, 10 de `4c(a)` y 612 de `4c(b)`), más el control negativo, la idempotencia, las guardas, el `lock_timeout`, la reversión, las 67 mutaciones, la concurrencia y el diagnóstico. En la quinta ronda eran 679 comprobaciones y 38 mutaciones; la sexta añade 564 comprobaciones y 29 mutaciones (el principal, la matriz de 160, el catálogo de la `0700`, las guardas de la `0700` y las reversiones juntas y por separado). El paso 7 de `run.sh` (aplicar encima la serie del #926) **no corre en este árbol** (hay 0 migraciones posteriores); sí se midió sobre el árbol del #926: 1 444 comprobaciones, ver «Combinación con el #926».

**La suite de esta ronda pasó tres veces seguidas sobre el árbol final** (`rc` 0, 1243 comprobaciones, 67 mutaciones y ningún `❌` cada vez; duraciones: 342 s, 338 s, 344 s, con la máquina de 4 núcleos sin otra carga salvo dos comprobaciones breves —`migrations-guard` y el auditor de drift— durante la tercera). Una pasada anterior sobre el mismo árbol de pruebas, sin cronómetro, dio las mismas cifras. El clúster desechable de la suite arranca con `fsync` apagado (se borra al terminar) para que las rondas de muchas sesiones no dependan del disco. Ningún caso de concurrencia depende de un tiempo fijo.

**Vitest y compuertas de la sexta ronda** (salida de cada comando, medida en esta ronda):

| Comando | Resultado |
|---|---|
| `npx vitest run src/components/empresa src/domain/empresa` | **365 pruebas en 23 archivos**, `rc` 0 (en la quinta ronda: 286 en 21; +79 y 2 archivos nuevos: `EmpresaProyectosSection.permiso.test.tsx` y `EmpresaSection.puedeCrear.test.tsx`) |
| `npx vitest run supabase/functions/create-user supabase/functions/invite-user` | **46 pruebas en 2 archivos** (antes 30: +16, las del principal) |
| `npx vitest run supabase/functions` (todas las `__tests__` de las funciones) | **918 pruebas en 60 archivos**, `rc` 0 |
| `npx vitest run` (completo) | **457 archivos pasan y 1 omitido; 7 427 pruebas pasan y 157 omitidas**, `rc` 0 (en la quinta ronda: 455 archivos y 7 330 pruebas) |
| `npx vitest run scripts` | 25 archivos y 987 pruebas, `rc` 0 |
| `npx tsc --noEmit` | `rc` 0 |
| `npx eslint . --max-warnings=0` | `rc` 0 (los archivos de prueba los ignora la configuración de ESLint: «File ignored because no matching configuration was supplied»; los 6 archivos de código tocados —`App.tsx`, `AsignacionModal.tsx`, `EmpresaProyectosSection.tsx`, `EmpresaSection.tsx`, `EmpresaUsuariosSection.tsx` y `usuarios.ts`— se comprobaron además solos) |
| `git diff --check` | limpio |
| `node scripts/migrations-guard.mjs` | `rc` 0 |
| `node scripts/schema-drift/auditar.mjs --base origin/main` | `rc` 0: **14 cambios planificados** (9 de la `0600` + 5 de la `0700`: las políticas de `projects`, `role_permissions`, `roles`, `user_invitations` y `user_roles` figuran), «Sin drift no autorizado». Con `--base HEAD` (lo que ve `main` tras el apply, antes de recapturar) `rc` 1: «DRIFT NUEVO — 14 grupos». `huella-produccion.json` **no se editó** |

**Rojo antes** (las pruebas nuevas contra el código anterior): copiadas las 7 pruebas nuevas o modificadas de interfaz y de funciones de borde sobre el código de `8d34392b`, **87 de 411 fallan** (`veAsistentePrimerProyecto`, `puedeEditarAsignaciones` con el principal, `isPrincipalRole`, `canCreateRole`/`createRoleDenial`, `canInviteRole`, el cableado de los manejadores, las compuertas de «Nuevo Proyecto»…); las otras 324 son controles y lo que no cambia. Con el código nuevo pasan las 411.

**Mutante de interfaz que sobrevive (equivalente, anotado).** Quitar `|| !puedeCrear` de la guarda de `crearProyecto()` no cambia nada observable: el botón «Nuevo Proyecto» ya está `disabled` cuando `puedeCrear` es falso y no hay otra vía de entrada a esa función (misma clase que MM5 y M12 de rondas anteriores). El servidor es el que manda (`projects_insert`, `0700`).

**No se ejecutó en Deno** ninguna edge function: se probaron sus funciones puras y el cableado de los manejadores se comprueba leyendo el código fuente desde la prueba.

### Resultados de rondas anteriores (conservados como historia: **no se re-midieron** en la sexta)

**Contra el código anterior (rojo antes).** La suite nueva, ejecutada contra la migración, la reversión y el diagnóstico de `d1aeb94a`, **falla** (`rc` 1) en
`assert_catalogo` («borrar un proyecto con una sesión de la API … toma un candado de aviso»: el propietario y el superadministrador no lo tomaban); contra la migración
con la comprobación de `auth.uid` corregida pero con el candado **por persona**, falla en el mismo punto. Las carreras concretas (R2-1) y las guardas frente al `search_path`
(R2-3) se ven en rojo con sus mutaciones dentro de la propia suite (4d, 8b, R2-1) y, a mano, así: el guion del verificador (`xp.sh`) deja `ADM1=[] exento=t · ADM2=[] exento=t ·
rechazos=0` con `d1aeb94a` y `ADM1=[P2] exento=f · ADM2=[P2] exento=f · rechazos=1` con la corrección (3 repeticiones iguales).

**Rojo antes de la cuarta ronda.** La suite nueva contra la migración y la reversión de `b9b630b1` **falla** (`rc` 1) en `assert_catalogo` (esperado `true|search_path="",lock_timeout=2s`, recibido `true|search_path=""`); contra la migración nueva con la reversión de `b9b630b1`, falla en `8c · la reversión abortó con search_path=''` (`rc` 1). Las carreras de V3-01 están en rojo dentro de la propia suite con sus mutaciones (global, sin `lock_timeout`, sin candado a escala) y, medidas, en «Cuarta ronda»: la víctima de otra empresa 212,3 → 0,50 tx/s con `b9b630b1` y 209,5 → 192,7 con la versión nueva. La carrera R2-1 del verificador (`race.sh`: N administradores comparten `{P1,P2}` y la sesión i borra `P(i%2+1)`) da, con la versión nueva, **0 exentos** en 2 × 60, 6 × 40 y 30 × 25 rondas (0 interbloqueos y 0 otros errores) y, con `d1aeb94a`, exentos en todas (2 × 20, 6 × 20 y 30 × 10).

Vitest de la interfaz en la **quinta ronda** (`src/components/empresa` y `src/domain/empresa`): **286 pruebas en 21 archivos** (229 + 57 nuevas: 11 en `AsignacionModal.reconciliacion.test.tsx`, 12 en `reconciliarCasillas.test.ts`, 32 en
`guardarAsignaciones.test.ts` —3 casos ambiguos nuevos en la tabla de V3-02, 11 códigos de la base y 18 que no lo son— y 2 en `EmpresaUsuariosSection.acceso.test.tsx`; además se corrigió un dato de prueba: el `DELETE` rechazado de
`AsignacionModal.respuestaPerdida.test.tsx` devolvía el código `500` y ahora un SQLSTATE `XX000`, porque `500` ya no cuenta como respuesta de la base). **42 de las 57 fallan sobre `ae49119f`**: 8 de las 11 de `reconciliacion`, las 12 de
`reconciliarCasillas` (la función no existía), 21 de `guardarAsignaciones` y 1 de las 2 de la Sección; las otras 15 son controles o **matan mutantes** (MM10, «lo marcado mientras el guardado vuela», el control de H2, los 11 códigos de la base que ya
eran definitivos y la prueba de que la misma persona no remonta). 21 mutantes de la quinta ronda, **los 21 mueren** (ver «Interfaz»). En el PR entero las pruebas nuevas de interfaz son **173** en 9 archivos (116 + 57). `vitest` completo:
**455 archivos pasan y 1 omitido (`rlsHarness.test.ts`), 7 330 pruebas pasan y 157 omitidas** (`rc` 0).

**Cuarta ronda.** Vitest de la interfaz: **229 pruebas en 19 archivos** (192 de la ronda anterior + 37 nuevas de la cuarta: 14 en `AsignacionModal.respuestaPerdida.test.tsx` y 23 en
`guardarAsignaciones.test.ts`; dos pruebas antiguas que fijaban el comportamiento equivocado de V3-02 se corrigieron). **9 de las 14 nuevas de la interfaz fallan sobre el código de `b9b630b1`** (E1, E1b, E3, E3b, la
502, la excepción sin aplicar, D1 y las dos de E4); las otras 5 (E2, el control con la petición que funciona y las tres N08) pasan con el código y **matan mutantes que antes sobrevivían** (N08). La ronda anterior añadió 12:
**4 fallaban** sobre el código de `d1aeb94a` (F2-01: la selección deshecha tras un parcial, la variante «deja p2 desmarcado», el reintento sin cambios y la relectura fallida); una quinta de F2-01 es un control y las
otras 7 (M06, M11, M15, M19, M20, M23) mataban mutantes que antes sobrevivían. En el PR entero las pruebas nuevas de interfaz eran 116 en la cuarta ronda: `AsignacionModal` 35, `AsignacionModal.excepcion` 2, `AsignacionModal.carrera` 2,
`AsignacionModal.respuestaPerdida` 14, `EmpresaUsuariosSection.acceso` 7, `asignacionesProyecto` 19 y `guardarAsignaciones` 37. `vitest` completo: **453 archivos pasan y 1 omitido, 7 273 pruebas pasan y 157
omitidas** (`rc` 0); `scripts/__tests__`: 19 archivos y 772 pruebas (cifra de la cuarta ronda, no re-medida en la quinta).

## Barrido de regresión

> **Sexta ronda.** La `0700` cambia las políticas de escritura de cinco tablas que muchas suites siembran o usan (`projects`, `roles`, `role_permissions`, `user_roles`, `user_invitations`), así que **sí se repitió el barrido**, sólo con las dos migraciones puestas: las **63 suites** `supabase/tests/*/run.sh` distintas de `asignaciones_proyecto` (que se mide aparte, arriba), cada una en su propio PostgreSQL desechable de la rama, **tres a la vez** con puertos propios y reintento sólo si el clúster no arranca (no hizo falta ninguno). Resultado: **62 en `rc` 0 y 1 en `rc` 1**, ≈ 14 min de reloj (≈ 20 min de suma de suites; la más lenta, `compras_bloque_b`, 329 s).
>
> * **La que falló**: `compras_cierre_tecnico`, paso 7b. Ejecuta `auditoria_roles/assert.sql`, que hacía que un **administrador** borrara un rol de su empresa y esperaba 1 fila (`AUDIT_ADMIN_DELETE_FAILED`). Era la prueba, no la migración: desde la `0700` borrar roles es del principal y el administrador recibe 0 filas sin error. **Corregida** (commit `483fb370`): el administrador debe recibir 0 filas (`AUDIT_NON_PRINCIPAL_DELETE_ALLOWED` si no), un propietario temporal de la empresa borra el mismo rol y el evento `delete_role` queda con **su** actor; si el actor configurado para el sandbox ya es principal, borra él mismo. Rojo: en una copia del árbol sin la `0700` la regresión falla con `AUDIT_NON_PRINCIPAL_DELETE_ALLOWED`; verde: `compras_cierre_tecnico` `rc` 0. **Mismo riesgo en las pruebas del #926**: ver «Combinación con el #926».
> * **Qué NO se hizo**: no se repitió la comparación archivo por archivo contra `origin/main` sin las migraciones de las rondas anteriores (ni el orden inverso con el #926); las 62 suites que pasan lo hacen con las migraciones puestas, que es lo que importa, y la única que falló se explicó y corrigió. No se ejecutaron en PostgreSQL 17 ni contra PostgREST.

> **Quinta ronda.** Las cifras de esta sección son de la **cuarta** ronda y no se re-midieron en la quinta: ni el árbol del #926 ni el orden inverso. Lo que cambió desde entonces es la interfaz, las pruebas SQL y la cabecera de comentarios de la migración
> (el cuerpo de las funciones no cambió: `md5(prosrc)` de `asignacion_bloquear_propia` = `a6ba72f5d332034ec60f4fa339543238`, 3 642 caracteres, igual que antes). Las sumas «673 + …» y «38 + …» pasan a 679 y 41 por aritmética de las 3 comprobaciones nuevas, no por medición.

Todas las suites `supabase/tests/*/run.sh` (63) con la migración puesta, frente a `origin/main` sin ella, cada una en su propio
PostgreSQL desechable (mismo comando, puerto propio), **en la primera ronda**:

| | Resultado |
|---|---|
| `origin/main` sin la migración | **63/63 suites en verde** (`rc=0`), `compras_bloque_b` incluida |
| Con la migración (y la suite nueva) | **64/64 en verde** (las 63 anteriores + `asignaciones_proyecto`) |
| Mismo resultado archivo por archivo | 63/63: mismo `rc`, mismo número de `✓` y de `ERROR`. 57 logs idénticos tras normalizar rutas, puertos, tiempos y hashes; 3 difieren en 2 líneas (la ruta del script dentro de un `NOTICE`); 3 (`compras_bloque_b`, `compras_cierre_tecnico`, `proveedores_pr_a`) tienen exactamente **una** línea `✓ migrations-append-only` más, porque esa guarda corre en el árbol de trabajo y se omite en la copia extraída de `origin/main` |

**En esta ronda** (la migración cambió: candado global y guardas; el resto de suites no): se volvieron a correr, con la migración corregida y cada una en su propio
PostgreSQL desechable (tres a la vez, puertos propios), las 20 suites que escriben o leen la tabla —`balance_jornada`, `conta_ajustes`, `conta_auxiliares_tipo_cargo`,
`conta_contabilizacion_cargos`, `conta_pagador_designado`, `conta_pendientes_reproceso`, `notificaciones_actividad`, `personal_usuario`, `politica_jornada`,
`presencia_correccion`, `presencia_marcaje`, `presencia_pausas`, `proteger_update_registros`, `proveedores_pr_a`, `registrar_lectura`, `rutas_operadores`,
`rutinas_limpieza`, `tareas_bloque_paridad`, `turnos` y `webhook_stripe_idempotencia`— y, sobre el árbol del #926 (`a6ccc2a8`) con la migración en su sitio,
`asignaciones_proyecto`, `compras_bloque_b`, `compras_cierre_tecnico` y `compras_flujo`. Resultado: **19 de 20 en `rc` 0 dentro del barrido** (18 a la primera; `presencia_correccion`
tras reintentar el arranque del clúster) y `webhook_stripe_idempotencia` en `rc` 1 en el barrido por el arranque del clúster y en `rc` 0 repetida sola (salvedad, abajo);
**4 de 4 en `rc` 0** sobre el árbol del #926: `asignaciones_proyecto` 852, `compras_bloque_b` 985 ✓,
`compras_cierre_tecnico` 31 ✓ y `compras_flujo`.

**En la cuarta ronda** (la migración cambió otra vez: candado por empresa y `lock_timeout`; la reversión: nombres calificados) se repitió, con la migración nueva y cada suite en su propio PostgreSQL desechable
(tres a la vez, puertos propios), el mismo barrido de las 20 suites que escriben o leen la tabla y, sobre el árbol del #926 (`git archive` de `origin/claude/peaceful-bell-u9mad4`, `e9764d3a`) con la migración en su
sitio, `asignaciones_proyecto`, `compras_bloque_b`, `compras_cierre_tecnico` y `compras_flujo`. Resultado, dicho tal cual:

* **Las 20 suites**: **18 en `rc` 0 dentro del barrido** (p. ej. `conta_ajustes` 485 ✓, `proveedores_pr_a` 535 ✓, `conta_pendientes_reproceso` 116 ✓, `conta_contabilizacion_cargos` 75 ✓,
  `conta_auxiliares_tipo_cargo` 71 ✓, `conta_pagador_designado` 33 ✓; las demás no imprimen `✓`) y **2 en `rc` 1 dentro del barrido** —`presencia_correccion` y `webhook_stripe_idempotencia`, en sus cuatro intentos, con
  «pg_ctl: could not start server» antes de que corriera ninguna prueba—, que **repetidas solas, en otro puerto de mi rango, dieron `rc` 0 en 4–5 s**. Es el mismo fallo de arranque, con las mismas dos suites, que las
  dos rondas anteriores (ver la primera salvedad): sigue sin causa conocida.
* **Árbol del #926, orden normal (la `0600` y luego las 10 migraciones)**: `asignaciones_proyecto` **862 ✓** (673 + matriz 148 + flujos 41), `compras_bloque_b` **985 ✓** (`DIAG` exportado, `rc` 0, 0 `❌`),
  `compras_cierre_tecnico` **31 ✓** y `compras_flujo`, todos en `rc` 0.
* **Orden inverso (las 10 migraciones del #926 y DESPUÉS la `0600`)**: las 6 suites de una sesión de este PR sobre una base montada así (cadena `< 0600` + las 10 + fixture + la `0600` aplicada **dos veces**):
  **317 ✓** (38 + 148 + 41 + 25 + 28 + 37), `rc` 0; `compras_cierre_tecnico` 31 ✓ y `compras_flujo` `rc` 0 con la `0600` renombrada a `20261027000950` (su arnés aplica antes de la serie todo lo que no es
  `20261027*`). **`compras_bloque_b` con ese renombrado llega a 983 ✓ y se detiene en el paso 6c** (la reversión del #926 compara contra la cadena anterior a la serie, y el renombrado deja la `0600` *dentro* de la serie:
  la diferencia son exactamente los objetos de la `0600` —3 políticas y 2 triggers de `user_project_assignments`—): es un artefacto del renombrado, no del orden; el orden inverso real queda cubierto por la base montada a mano.
* **Estado de Preview simulado** (base sin superusuario con `BYPASSRLS`, como el `postgres` de Supabase): con la **ACL de Preview** (`authenticated` sin DML) y con la **de producción**, la versión **previa ya aplicada
  (`d1aeb94a`, que es la que tiene hoy la rama de Preview, o `b9b630b1`) y la nueva encima, tres veces**, termina sin error y deja la huella de `public` y el catálogo extendido (`prosrc`, ACL de la función, dueño,
  `proconfig`, comentario, políticas, triggers, ACL de la tabla y datos) **idénticos a aplicar solo la nueva**; sobre ese resultado: `assert_acl` 10 ✓ con la ACL de Preview y la batería de 6 suites + `assert_acl`
  (327 ✓) con la de producción.
* **Auditor de drift offline**: `--base origin/main` rc 0 («9 cambios planificados», 3 363 grupos, «Sin drift no autorizado»); `--base HEAD` rc 1 («DRIFT NUEVO — 9 grupos»). `migrations-guard` rc 0, `migrations-append-only
  --base origin/main --head HEAD` rc 0 (1 migración nueva, 0 violaciones), `git diff --check` limpio, `tsc --noEmit` rc 0 y `eslint . --max-warnings=0` rc 0.

Dos salvedades, dichas tal cual:

* **`pg_ctl: could not start server`.** `webhook_stripe_idempotencia` falló en sus cuatro intentos dentro del barrido en paralelo (`rc` 1) y `presencia_correccion` necesitó
  cuatro; repetida **sola**, en otro puerto de mi rango, `webhook_stripe_idempotencia` salió a la primera con `rc` 0. **No se determinó la causa**: el registro del clúster se
  borra al terminar la suite y el arranque falla antes de que ninguna prueba corra, así que no toca la migración ni las tablas. Lo que sí se comprobó: reiniciar un clúster
  12 veces seguidas en el mismo puerto no falla ninguna vez, y son las mismas dos suites que fallaron así en la ronda anterior. **Hipótesis (sin probar)**: el rango de puertos
  efímeros del kernel (`32768–60999`) incluye 55731–55739 y una conexión saliente de otro proceso de la máquina pudo ocupar el puerto en ese momento. Mientras no se pruebe,
  no se le pone nombre. **Se repitió en la cuarta ronda con las mismas dos suites** (cuatro intentos fallidos en el barrido en paralelo; solas, `rc` 0).
* **`compras_bloque_b` en una copia sin `.git`.** La primera pasada falló en `RG-4.diagnostico.sql` («el archivo del diagnóstico existe y no está vacío — esperado 1,
  recibido 0»): esa prueba localiza `scripts/diagnostico-numeros-factura.sql` con `git rev-parse --show-toplevel`, y el árbol del #926 que se prueba es una copia de `git archive`
  (sin repositorio). Es un artefacto de la copia, no de la migración: con `DIAG=<ruta del archivo>` pasa entera (`rc` 0, 0 `❌`). Por la misma razón el paso `append-only` de esa suite se
  omite en la copia.

Las tres pruebas `node` de replay de `supabase/tests` (`replay_acl_helpers/run.mjs`, `declarar_triggers_fill_company_id/replay.mjs`,
`cumplimiento_calidad_firma_inequivoca/replay.mjs`) también salieron en verde con la migración (primera ronda).

**Combinación con el #926 (sexta ronda): HAY DOS PRUEBAS DEL #926 QUE LA `0700` ROMPE.** Se probó sobre el árbol de `origin/claude/peaceful-bell-u9mad4` (`8df56590`, punta de esa rama leída con `git log -1` el 2026-10-12; `git archive` en una carpeta propia, sin `.git`), con las dos migraciones de este PR intercaladas entre `20261026000500` y `20261027000000` y con los archivos de este PR (pruebas, diagnóstico y reversiones). **No se tocó ninguna migración ni ninguna prueba del #926.**

| Suite sobre ese árbol | Resultado |
|---|---|
| `asignaciones_proyecto` (paso 7: las 10 migraciones del #926 aplicadas encima) | `rc` 0, **1 444 comprobaciones** (las 1 243 + matriz 160 + flujos 41 sobre la cadena del #926), 67 mutaciones |
| `compras_cierre_tecnico` (con la regresión de auditoría de roles ya corregida) y `compras_flujo` | `rc` 0 las dos |
| **`compras_bloque_b`** | **`rc` 1**: falla `hallazgos/DEP-5.sql` (`[DEP-5a] el administrador elimina el proyecto con una orden de pago APROBADA … pasó pero NO afectó ninguna fila`) y, en una copia de trabajo que no se detiene en el primer fallo, también `hallazgos/PERM-4.sql` (`[purga] el administrador con asignaciones elimina el proyecto G …: se esperaban 1 filas afectadas y fueron 0`). **Los otros 36 de los 38 archivos de hallazgos pasan** |

**Por qué.** Es el mismo defecto de prueba que el de `auditoria_roles` (ver «Barrido de regresión»): esas dos pruebas hacen que un **administrador** borre un proyecto por la API y esperan 1 fila; desde la `0700`, `projects_delete` es del principal y el administrador recibe 0 filas sin error. El motor de las pruebas lo detecta como «falso verde». **No es un defecto de la migración**: es la decisión del dueño del negocio (D-2 iii, D-9), y las pruebas de esos hallazgos comprueban el comportamiento de la baja en cascada del #926 (la orden de pago sobrevive sin proyecto), no quién puede borrar.

**Qué hay que hacer (en el #926, no aquí).** Que esas pruebas borren el proyecto como principal o como sistema. Probado en una copia de trabajo (fuera del repositorio): con el actor del fixture `BB Admin C` hecho `company_owner`, **`DEP-5` pasa**; **`PERM-4` sigue en rojo** porque su actor es otro: el bloque `[purga]` borra con un administrador **acotado a propósito** (comprueba que no es exento y que tiene acceso al proyecto), así que esa prueba necesita borrar como sistema o como principal y conservar el montaje. Como cada archivo se detiene en su primer error, **lo que viene detrás del primer fallo de `DEP-5` (sus bloques b, c y d borran el proyecto con la sesión de ese mismo administrador) y de `PERM-4` no se evaluó** y puede traer más fallos del mismo tipo. **No se ejecutaron** el paquete `pendientes_decision/proyectos` (`PRJ-1`, `armar_paquete.sh`; su `PRJ-1.sql` contiene un `DELETE FROM public.projects`, que no se revisó) ni la propuesta de alcance por proyecto (`propuesta_alcance_proyecto.sql`), cuya D-9 («la exención “sin filas” se evade ascendiendo a otro administrador») interactúa con esta decisión y debe releerse a la luz de ella.

**Hasta que el #926 adapte esas dos pruebas, su `compras_bloque_b` y la CI que la ejecute fallarán con las dos migraciones intercaladas.** El orden de despliegue no cambia (este PR va primero), pero el #926 no debería fusionarse sin ese ajuste. Tampoco se midió el **orden inverso** (las diez migraciones del #926 y después las de este PR) en esta ronda.

**Combinación con el #926 (cuarta ronda).** La cuarta ronda se probó sobre el árbol de **`e9764d3a`** (`git rev-parse origin/claude/peaceful-bell-u9mad4` el 2026-10-11, punta de esa rama) con esta migración en su sitio, entre
`20261026000500` y `20261027000000`, en el orden de despliegue normal y en el inverso (ver «Barrido de regresión»). Ese SHA envejece con cada push del #926 y por eso no se llama «vigente» sin fecha: de `a6ccc2a8` (el árbol
de la ronda anterior) a `e9764d3a` difieren 11 archivos —un documento de compras, `scripts/propuesta-asignaciones-permisos-compras.sql`, cuatro pruebas SQL de `compras_bloque_b` (`RG-4*` y `VER-09`: solo su limpieza de ids
aleatorios) y cinco archivos de `pendientes_decision/proyectos/`—; **ninguna migración**. Resultado: `asignaciones_proyecto` 862 ✓ (673 + matriz 148 + flujos 41 con las 10 migraciones del #926 aplicadas encima),
`compras_bloque_b` 985 ✓, `compras_cierre_tecnico` 31 ✓ y `compras_flujo`, todos en `rc` 0. La cadena con esta migración intercalada se probó en esta ronda en los dos órdenes.
La primera ronda encontró un conflicto real con el diseño inicial del trigger de autoasignación (que
también rechazaba la baja en cascada): rompía `compras_bloque_b/hallazgos/DEP-5.sql`, que exige que un administrador asignado a un
proyecto pueda eliminarlo. Ver D-5.

## Riesgos residuales y decisiones abiertas

| # | Qué | Estado |
|---|---|---|
| D-1 | ~~Un administrador **acotado** solo reparte los proyectos que él ve, como hoy.~~ | **Superada (sexta ronda)**: el administrador ya no reparte nada; sólo el principal (el propietario ve todos los proyectos de su empresa, así que la condición de visibilidad sobra y el guardado de la pantalla no pierde filas ajenas) |
| D-2 | **El alcance por proyecto no es un límite real contra un administrador hostil.** **Cerrada para la API en la sexta ronda por decisión del dueño del negocio** (la autoridad es del principal: `0600` + `0700` + edge functions). Cada vía, con su estado: (i) **Colusión (F2)**: un administrador acotado dejaba exento a otro o acotaba al jefe exento escribiendo asignaciones → **cerrada** (`0600`: sólo el principal escribe `user_project_assignments`). (ii) **Creación (F-04)**: `create-user` e `invite-user` dejaban a un administrador crear **otro administrador**, que nace sin filas, es decir exento → **cerrada** (403 en las funciones de borde y, **por la API**, la invitación con `role = 'admin'` insertada directamente en `user_invitations` → 42501 con la `0700`). (iii) **Borrar el último proyecto de otro administrador (F2-03)** → **cerrada para la API** (`0700`: `projects_delete` es del principal). **Lo que sigue abierto**: el **rol de servicio** y el **SQL directo** (no pasan por la RLS ni por el trigger de autoasignación); el **propietario y el superadministrador**, que pueden dejar exento a un administrador (D-6: decisión suya); `accept-invitation`, que crea el `app_users` con el rol de la invitación sin saber quién invitó (la `0700` impide ya que la invitación `admin` la inserte un administrador; una invitación `admin` insertada con el rol de servicio sigue creando un administrador exento) y `delete-user` (D-3). Las opciones que se barajaron antes de la decisión (regla «un administrador no administra filas de administradores», ampliar el trigger de autoasignación a la baja de cualquier administrador, quitar `projects_delete` a `admin`) quedan **superadas**: la tercera es, en esencia, lo que se hizo. | **Cerrada para la API; abierta para el rol de servicio y el SQL directo** |
| D-3 | **Filas huérfanas** (10, de 6 usuarios que ya no existen en `app_users`): no son administrables por un administrador ni por el propietario, solo por el superadministrador o el rol de servicio; no se borran ni se «arreglan». Siguen dando `can_access_project` a un `user_id` que ya no existe (inofensivo mientras ese id no vuelva a existir: comprobado con `SELECT`, los 6 ids **no** están en `auth.users`). **Causa, y por qué volverán a aparecer (F2-04):** `supabase/functions/delete-user/index.ts` borra `user_roles` (línea 98), el rol de ajustes (109), `app_users` (118) y `auth.users` (126), pero **nunca** `user_project_assignments`, y la tabla no tiene llave foránea hacia las personas que lo haga en cascada: cada baja de usuario deja huérfanas nuevas, y con esta migración solo el superadministrador o el rol de servicio podrán borrarlas (antes el propietario podía por la API) | Propuesta aparte: que `delete-user` (rol de servicio) borre las asignaciones de la persona **antes** de borrar su perfil, y limpiar los 6 ids actuales con el superadministrador (confirmándolos antes) |
| D-4 | `permission_type`: nada lo lee para decidir acceso (las 43 son `total`). La regla no lo distingue; la pantalla escribe `total` en las filas nuevas y conserva el de las existentes | Sin acción |
| D-5 | **Diferencia con el diseño inicial, justificada con una prueba**: el diseño del trigger de autoasignación rechazaba también la baja *en cascada* de la fila propia. Al probar la combinación con el árbol del #926 eso rompía `compras_bloque_b/hallazgos/DEP-5.sql`, que comprueba que un administrador asignado a un proyecto **puede eliminarlo** (sus órdenes de pago quedan sin proyecto). Ahora la cascada se permite si la persona conserva **otra** asignación (su alcance solo se reduce) y se rechaza si fuera la **última** (quedaría sin filas y, siendo administrador, exento): `[alcance 3]`. La comprobación está **serializada con un candado de bajas en cascada por empresa** (F1, R2-1, V3-01: sin él, dos borrados simultáneos de sus dos únicos proyectos —o de dos administradores que comparten los suyos— los dejaban con cero filas). **Límite (F2-03):** la comprobación solo vigila las filas **propias** de quien borra; la cascada que deja sin filas a OTRO administrador no se comprueba. Desde la sexta ronda **un administrador ya no borra proyectos por la API** (`0700`), así que el límite sólo alcanza al propietario, al superadministrador, al rol de servicio y al SQL directo (D-2 iii, D-6); por eso `DEP-5.sql` del #926 vuelve a romperse, ahora porque el administrador ya no borra el proyecto (ver «Combinación con el #926»). La pantalla no ofrece borrar proyectos | Decidido; el límite quedó acotado a quien no pasa por la RLS de un administrador |
| D-6 | Si el **propietario o el superadministrador** borra el último proyecto de un administrador acotado, éste queda sin filas y por tanto exento (`[alcance 3]`). Es una decisión de quien borra, no del administrador. **Un administrador podía hacer lo mismo con OTRO administrador (F2-03)**; desde la `0700` ya no por la API (D-2 iii). Las bajas hechas con el rol de servicio o con SQL directo (p. ej. `delete-company`) no pasan por el trigger ni toman el candado. **Carrera residual (V3-06):** una baja de proyecto con `service_role` concurrente con una baja por la API del mismo administrador no se ordenan: el administrador ve su fila de la baja del servicio como viva, no espera y al confirmar ambas queda con 0 filas y exento (`run.sh` V3-06 lo fija). **Decisión: el rol de servicio NO toma el candado** (razones y coste en «Cuarta ronda» y D-15); quien lo necesite puede tomarlo a mano con `pg_advisory_xact_lock(hashtextextended('asg-cascada:' \|\| '<empresa>', 0))` | Riesgo residual del principal, del rol de servicio y del SQL directo; mitigación posible: aviso en la pantalla del propietario. La parte de los administradores, cerrada para la API (D-2) |
| D-7 | El trigger de integridad valida **al escribir**. Carrera reproducida y cerrada en un orden: sin candado, un cambio de empresa de la persona (o del proyecto) concurrente con su asignación dejaba **1 fila cruzada** (`D0` de la suite); con `FOR SHARE` la asignación espera y recibe `ASIGNACION_EMPRESA_DISTINTA` (`D1`, `D2`: 0 filas cruzadas). **No cubre el orden inverso** (F7): si la asignación va primero y el cambio de empresa después, o si se cambia la empresa de una persona o proyecto que **ya tiene** asignaciones, no hay trigger en `app_users`/`projects` y quedan filas cruzadas (la persona queda con una fila en un proyecto de la empresa de antes y `can_access_project` sigue dando `true`). Solo el superadministrador puede cambiar el `company_id` de otra persona (propietario y administrador no: `WITH CHECK`). **Alcance real de una fila cruzada (R2-2):** 8 políticas conceden por la asignación sola, sin condición de empresa (`pagos_select`/`pagos_insert`, `registros_insert`/`update`/`delete`, `contadores_select`, `tarifas_select`, `unidades_select`; tabla en «Riesgo real»): una fila cruzada equivale a **leer pagos y contadores, tarifas y unidades** de la otra empresa (medido: un operador, un visor y un administrador, 1 de 1 fila en cada tabla; y sigue valiendo tras mover un proyecto de empresa con la migración puesta) | Hoy: 0 cruces y una sola empresa con proyectos, así que sin efecto. La sección «cruces» del diagnóstico las cuenta; **córrela tras cualquier cambio de empresa de una persona o un proyecto**. Cierre propuesto (dos caminos, no excluyentes): un trigger `AFTER UPDATE OF company_id` en `app_users` y en `projects` que rechace o limpie las filas cruzadas, o añadir la condición de empresa a esas 8 políticas (la segunda es la defensa en profundidad; la primera ataca la causa) |
| D-8 | `service_role` ya no puede asignar entre empresas (la integridad vale para todo actor). Si soporte lo necesitara, `ALTER TABLE … DISABLE TRIGGER trg_asignacion_empresa` en una transacción corta y con registro | Documentado |
| D-9 | **Cambio de flujo (F-03): el administrador acotado que crea un proyecto por la API ya no puede asignárselo.** **Cerrada en la sexta ronda con la opción (c): sólo el principal crea proyectos** (`projects_insert`, `0700`; decisión del dueño del negocio). Ya no existe el flujo (el administrador no puede crear el proyecto) ni, por tanto, el proyecto creado que quien lo creó no ve. Ver «Cambio de flujo (F-03)» | **Cerrada**; las opciones (a) y (b) quedan descartadas |
| D-10 | **Alcance real de las 77 políticas (R2-2).** Se leyó el texto de cada una en producción: las 77 (70 en `public`, 7 en `storage`) nombran la asignación o sus helpers, y **8 tienen al menos una alternativa que concede por la asignación sola, sin condición de empresa** (tabla en «Riesgo real»). El resto no se comprobó una por una; que «mencionen la empresa» no prueba que toda alternativa la exija. La conclusión práctica es la de D-7: la integridad de empresa de la tabla es la única barrera para esas 8 políticas | Auditoría aparte del resto; cierre de las 8 en D-7 |
| D-11 | La regla mira solo `app_users.role` (`company_owner`, `super_admin`, `superadmin`); el rol `admin` ya no cuenta (sexta ronda) y los roles RBAC personalizados tampoco: un operador con el rol de sistema «Admin Plataforma» no escribe ni asignaciones, ni proyectos, ni roles, ni llaves, ni invitaciones `admin` (`assert_principal`, actor `OP2`) | Sin cambio en lo RBAC; el administrador, ver D-18 |
| D-12 | **Deuda previa de la cadena de migraciones** (P0): en una base construida solo con migraciones `authenticated` no tiene DML sobre esta tabla (ver «Lección de ACL»). Esta migración no lo arregla ni lo oculta | PR aparte: declarar los privilegios que debe tener `authenticated` en una base nueva |
| D-13 | **`FOR SHARE` en el trigger de integridad (F6)**: bloquea una alta mientras alguien edita su propia fila de `app_users` en una transacción abierta (medido: una asignación esperó 3,07 s a que la otra transacción terminara; el `DELETE` no espera). En una carga mixta artificial de transacciones de varias sentencias (6–8 clientes) hubo 2 deadlocks en ~3100 transacciones en una corrida y 0 en ~18 000 en seis repeticiones; **sin** la migración la misma carga dio 3–5 por corrida (por la autoedición). Ninguna fila duplicada ni cruzada. Por PostgREST (una sentencia por transacción) el riesgo es mínimo. **`FOR KEY SHARE` queda DESCARTADO (F2-06)**: un `UPDATE` de `company_id` no es una columna clave y no choca con `FOR KEY SHARE`; medido en esta ronda con la carrera D1, la asignación **no espera** y queda **1 fila cruzada** (con `FOR SHARE`: espera, `ASIGNACION_EMPRESA_DISTINTA` y 0 cruzadas) | Aceptado |
| D-14 | **`MAINTAIN` en PG17 (F8)**: `REVOKE TRUNCATE, TRIGGER, REFERENCES … FROM authenticated` deja `authenticated` con `arwdm` (leído en producción, PG 17.6: `arwdDxtm` antes, `arwdm` después; la `d` minúscula es `DELETE`, la `m` es `MAINTAIN`; en la preview del #928, sin DML por D-12, queda solo `m`). **No se revoca** porque es inocuo por la API: PostgREST no emite `VACUUM`/`ANALYZE`/`REINDEX`/`CLUSTER`/`REFRESH`/`LOCK TABLE`, y `LOCK TABLE … ACCESS EXCLUSIVE` ya era posible con solo `UPDATE`/`DELETE` (probado) sin que sea alcanzable desde la API; `anon` sí pierde `MAINTAIN` (`REVOKE ALL`). Tampoco haría falta una sentencia distinta por versión para quitarlo: bastaría `REVOKE ALL` seguido de un `GRANT` del DML anotado en el pre-vuelo; no se hace porque tocaría el DML de una tabla viva por un privilegio que nada usa. Las comprobaciones de privilegios usan listas explícitas, así que ignoran `MAINTAIN` por construcción | Aceptado; no probado en PG17 |
| D-15 | **Candado de bajas en cascada por empresa: alcance, coste y límites (R2-1, R2-5, R2-7, V3-01, V3-06).** Las cifras están en «Cuarta ronda» y se repiten con `ASG_CARGA=1 … run.sh` (`carga/medir.sh`, pgbench; **cifras de referencia de una máquina compartida de 4 núcleos con PostgreSQL 16: importa la relación, no el valor**). (1) **Alcance (V3-01)**: la clave sale de la empresa de la persona cuya fila se borra, así que, **con datos sanos**, quien retiene el candado —una baja pesada, un administrador malicioso— **solo estorba a las bajas de SU empresa** (con una fila cruzada heredada o con personas sin empresa no vale: D-17). Un propietario de otra empresa ya no puede retenerlo: la víctima de otra empresa conserva su rendimiento (209,5 → 192,7 tx/s; con el candado global de la ronda 3, 212,3 → **0,50** tx/s) y `pg_locks` no muestra a ninguna sesión de C esperando una clave de D (`run.sh` V3-01, determinista, sin tiempos fijos). **Dentro de la propia empresa el efecto existe** y es el de cualquier serialización: las demás bajas de proyecto de esa empresa esperan y, a los 2 s, fallan con `55P03` («canceling statement due to lock timeout»; antes esperaban hasta el `statement_timeout` de 8 s, 5,1 s de media). Un atacante de una empresa solo afecta a la suya; lo que no se mide es el efecto sobre el límite de conexiones de PostgREST/Supavisor si amontona peticiones (cada una retiene una conexión hasta 2 s). (2) **Coste medido**: dentro de una empresa las bajas de proyecto se ejecutan una tras otra (≈ 0,45× el rendimiento sin candado, igual que el global); dos empresas ya no se esperan (suma ≈ 0,76× frente a ≈ 0,37× con el global). Es irrelevante en la práctica: producción tiene 8 proyectos y ninguna pantalla ni función de `public` los borra; la única vía es `DELETE /rest/v1/projects`. Con ≈ 30 bajas simultáneas de una misma empresa las últimas de la cola agotan el `lock_timeout` y reciben `55P03` (se reintentan; no cambian nada y nadie queda exento: `run.sh` «R2-1 a escala»). (3) **Interbloqueos (R2-5)**: en una transacción de **varias** sentencias que combine «borrar un proyecto» con «asignar sobre el siguiente», el candado de aviso y el `FOR SHARE` del trigger de integridad pueden cruzarse; PostgreSQL lo detecta y aborta **una** de las dos (`deadlock detected`, tras `deadlock_timeout` = 1 s), la otra termina y **no queda nada a medias** (probado de forma determinista en `run.sh` R2-5; sin el candado esa misma transacción no se interbloquea). En la carga artificial de ese tipo (8 clientes, 15 s) fallaron por interbloqueo **28–49 % sin candado** (el `FOR SHARE` contra la fila del proyecto que otra transacción está borrando), **80–82 % con el global** y **48–72 % con el candado por empresa**; con **una sentencia por transacción —lo que emite PostgREST— hubo 0 interbloqueos en las tres variantes y en las cargas medidas** (5 976 tx con el candado por empresa; la cuarta verificación volvió a medir 0 con 2, 6 y 30 clientes y 12 s por celda). **Eso es lo que se midió, no una garantía (V4-H01):** con **tres** peticiones de **una** sola sentencia cada una hay un ciclo determinista que con el candado existe y sin él no (una transacción ajena retiene la fila de `app_users` de la persona; un `UPDATE` que mueve su asignación de P1 a P2 espera el `FOR SHARE` de esa fila; el `DELETE` de P1 toma el candado de la empresa y espera esa asignación; el `DELETE` de P2 espera el candado; al confirmar la ajena, el `UPDATE` pide `FOR SHARE` sobre `projects(P2)`, que el `DELETE` de P2 tiene en borrado). Desenlace limpio (`40P01` + `ASIGNACION_EMPRESA_DISTINTA`; de P1/P2 queda uno; nada a medias) pero es un error espurio de una operación legítima, alcanzable con peticiones simultáneas; exige una transacción ajena que retenga la fila de `app_users` de la persona (p. ej. la edición de su perfil). El caso de **varias** sentencias (R2-5) solo se da con SQL directo de un operador, que debería evitar mezclar bajas de proyecto y altas de asignación en una misma transacción. (4) **V3-06, el rol de servicio**: no toma el candado (decisión). Medido: tomarlo costaría ≈ 0,01 ms por asignación en cascada (3 000 filas: 29–44 ms → 72–75 ms), pero cambiaría el comportamiento de rutas del servidor que hoy nunca esperan (`delete-company`, SQL de soporte), que podrían fallar con `55P03` o interbloquearse en una transacción de varias sentencias; y la única ruta de la aplicación que borra proyectos con el rol de servicio es `delete-company`, que borra la empresa entera con sus administradores. La carrera residual (una baja del servicio concurrente con una baja por la API del mismo administrador) queda documentada y fijada en `run.sh` V3-06; quien la necesite puede tomar el candado a mano. (5) **R2-7**: la clave ya no es una constante (`hashtextextended('asg-cascada:' \|\| <empresa>, 0)`, semilla 0, determinista pero dependiente del `uuid` de la empresa). Ver R2-7 en la tabla de la tercera ronda: la frase «no hay camino de denegación de servicio» era falsa y se retiró. Si se quisiera endurecer el espacio de claves, un candado de dos enteros (clase fija, objeto = hash) lo separaría del de otras funciones | Aceptado |
| D-16 | **Aislamiento `REPEATABLE READ`/`SERIALIZABLE` (V4-H02).** *Sexta ronda: desaparece para quien no es principal —un administrador ya no borra proyectos por la API— pero **no** para el rol de servicio ni para el SQL directo, ni para el propietario o el superadministrador, que pueden borrar proyectos y dejar exentos a otros por decisión suya; la comprobación de la cascada sigue siendo válida para el candado.*  El candado se toma pero «¿le queda otra fila?» lee con la instantánea tomada **antes** de esperarlo: un administrador, él solo con dos sesiones, queda con 0 filas y **exento** (en `SERIALIZABLE` tampoco hay `40001`). Con `READ COMMITTED` (el valor por omisión) se rechaza bien. Medido (tabla en «Quinta ronda»); **no alcanzable por PostgREST** (por su documentación: no deja fijar el aislamiento por petición; no se midió) y ninguna migración, función, `config.toml` ni script del repositorio lo fija, así que hace falta una **conexión directa** que lo elija. **Endurecimiento posible, NO implementado**: (1) rechazar la baja en cascada con sesión de la API si `current_setting('transaction_isolation') <> 'read committed'` (rompería a quien use legítimamente otro aislamiento por SQL directo); o (2) bloquear con `FOR UPDATE` las filas de la persona antes de mirar (serializa más y añade esperas y un orden de bloqueo más). Mismo límite que D-2: un administrador hostil con conexión directa ya tiene caminos mucho más cortos | **Decisión abierta**; riesgo bajo |
| D-17 | **Alcance real de la clave del candado con datos heredados (V4-H03, V4-H04, V4-H06, V4-H07).** La clave sale de la empresa de la **persona**. «Un propietario solo retiene el candado de SU empresa» **vale con datos sanos** (medido). **No vale** con (a) una **fila cruzada** heredada (persona de C, proyecto de D): el propietario de D que borra ese proyecto retiene la clave de C y las bajas del de C esperan y fallan a los 2 s con `55P03`; (b) **personas sin empresa** (`company_id` NULL): comparten UNA clave, `asg-cascada:sin-empresa`, entre todas las empresas, y el propietario de D bloquea al de C si ambos borran proyectos con filas heredadas de personas sin empresa; (c) con dos o más claves en una baja (filas cruzadas), dos bajas con el orden inverso se interbloquean **candado contra candado** (`40P01`, aborta una; con una sentencia por transacción). Los inquilinos no pueden fabricar esas filas (la integridad de empresa y la RLS de `app_users`/`projects` lo impiden), así que exige un dato heredado o al superadministrador (D-7). **Producción: 0 cruces; no se sabe si las 9 personas sin empresa tienen filas.** Además, **el `lock_timeout` de 2 s es fijo** en la función (ignora uno más estricto del llamador: 2 011,8 ms con 200 ms en la sesión; informativo) y **solo la baja en cascada toma el candado**: un `UPDATE` de `user_id`/`project_id` y un `DELETE` directo no lo toman, y la carrera de uno de ellos con la baja en cascada de otro administrador deja a la persona con 0 filas y exenta (medido; es la clase de D-2). Cerrar (a)–(c) pasa por limpiar los datos cruzados (D-7: trigger o condición de empresa en las 8 políticas) o por una clave que no dependa de la fila; no se hace aquí | Documentado; **límite medido**, sin implementar |
| D-18 | **Un administrador conserva, por perfil, todas las llaves (sexta ronda).** `user_has_permission()` deja pasar al administrador antes de mirar `role_permissions`: el principal asigna llaves a operadores, visores y roles personalizados (las `INSERT`/`DELETE` de `role_permissions` y `user_roles` son sólo suyas), pero **no se las puede quitar a un administrador**. Hasta que la `0700` llegue a producción, un administrador todavía escribe `roles`, `role_permissions` y `user_roles` por la API (medido con el texto de las políticas de producción). Las llaves nuevas del #926 no se conceden a nadie en esta rama | **Decisión abierta**: hacer que el administrador deje de pasar por perfil exige tocar `user_has_permission()` y las políticas que la usan; no se hace aquí |
| D-19 | **Lo que no se cambió (sexta ronda).** `delete-user` no limpia las asignaciones (D-3) y **no** se endureció; `accept-invitation` crea el `app_users` con `invitation.role` sin comprobar quién invitó (la `0700` cierra la inserción de la invitación `admin` por un administrador; el rol de servicio y el SQL directo la siguen pudiendo insertar). Los administradores pueden editar `projects` (`projects_update` no cambió: fiscal y cobros) y gestionar el resto de invitaciones | Sin cambio; documentado |

## Otros caminos hacia el mismo efecto (se buscaron; no se corrigen aquí)

* **Cambiarse el rol, la empresa o el proyecto principal en `app_users`**: no se puede. La política `app_users_update`
  deja actualizar la propia fila, pero `trg_lock_app_users_self_privilege` restituye `role`, `company_id`,
  `cliente_id`, `project_id`, `activo` y `permission_type` (`[otros caminos]` de `assert_alcance.sql`: un operador y un
  administrador acotado intentan «promoverse» y la fila queda igual). `user_has_project_access()` también lee
  `app_users.project_id`, por eso importa que ese trigger esté.
* **Crear un administrador nuevo (F-04): cerrado en la sexta ronda para quien no es principal.** Hasta la quinta, un administrador (acotado o no) podía crear
  un usuario de rol `admin` con la edge function `create-user` o invitarlo con `invite-user` (`ALLOWED_ROLES_FOR_NON_SUPER`, `INVITABLE_ROLES`) y el nuevo nacía **exento**.
  Ahora `createRoleDenial`/`canCreateRole` y `canInviteRole` devuelven 403 («Solo el propietario de la empresa puede crear administradores.» / «…invitar administradores.»); la inserción
  directa de la invitación con `role = 'admin'` en `user_invitations` (el camino que la lista blanca de las funciones de borde no controlaba) la rechaza la `0700` (42501; `assert_principal` I1), y el `UPDATE`
  que convierte una invitación de operador en `admin` también (I3). La inserción directa en `app_users` por un administrador ya fallaba por RLS (U1). **`accept-invitation` no cambia**: crea el `app_users` con `invitation.role` sin saber quién invitó,
  así que una invitación `admin` ya existente (en el padrón de la suite, 0) sigue creando un administrador exento. No se ejecutaron las funciones (Deno): se probaron las funciones puras y se leyó el cableado.
* **Colusión de dos administradores (F2)**: cerrada para la API en la sexta ronda (D-2): un administrador ya no escribe asignaciones de nadie.
* **Borrar el último proyecto PROPIO** (baja en cascada de la fila propia): era un camino real para un administrador (la
  política `projects_delete` se lo permite; reproducido a mano en la base sin la migración: la cascada le quita su última
  fila y `user_is_project_exempt()` pasa a `true`); lo cierra el trigger de autoasignación solo cuando sería su última
  fila (D-5), también con dos sesiones a la vez (F1) y aunque comparta sus proyectos con otro administrador (R2-1). Con el propietario o el
  superadministrador no es una escalada, es una decisión suya (D-6).
* **Borrar el último proyecto de OTRO administrador (F2-03): cerrado para la API en la sexta ronda (`0700`).** Hasta la quinta, la misma baja en cascada vacía las filas de **todas** las
  personas asignadas al proyecto, y el trigger solo comprueba la de quien borra: un administrador deja exento a otro. No es un hueco nuevo (ya
  ocurría antes de la migración) pero la versión anterior de este documento decía que el camino de «borrar el último proyecto» estaba cerrado. Decisión
  abierta en D-2 (iii); `assert_alcance` lo documenta (`[otros caminos]` F2-03) y hay que invertir ese caso si se cierra. **Se cerró**: `projects_delete` es del principal, el caso se invirtió (0 filas) y sigue abierto sólo para el propietario, el superadministrador, el rol de servicio y el SQL directo (D-6).
* **Crear un proyecto nuevo** en su empresa: ya sólo lo hace el principal (D-9, `0700`); antes, un administrador lo creaba sin poder asignárselo (F-03).
* **Roles, llaves y asignaciones de roles de la empresa** (`roles`, `role_permissions`, `user_roles`): un administrador los escribía por la API; desde la `0700`, sólo el principal. Un administrador conserva las llaves por perfil (D-18).
* **Insertar la invitación `admin` directamente en `user_invitations`**: cerrado por la `0700` para quien no es principal; ver «Crear un administrador nuevo».
* **Mover de empresa a una persona o a un proyecto que ya tiene asignaciones** (superadministrador): deja filas cruzadas que valen como
  acceso a pagos, contadores, tarifas y unidades de la otra empresa (D-7, R2-2).
* No se encontró ninguna función de `public`, migración ni edge function que escriba la tabla.

## Orden y pasos de despliegue

`apply-migrations-prod.yml` tiene `MAX_APPLY = 10` por push y aplica solo los `.sql` añadidos en ese push, por orden
de versión. Por eso **cada PR va en su propio push a `main`**, sin undécima migración en el #926 y sin subir el tope (no se tocó):

1. **Este PR** (`20261026000600` y `20261026000700`: **2 archivos en el mismo push**, bajo el tope; versiones > `20261026000500`, el máximo de producción, y < `20261027000000`, la primera del #926).
2. Después el **#926** (10 migraciones `20261027000000 … 20261027000900`).
3. Después el futuro PR de alcance por proyecto (`20261027001000`) y, por último, el **#927** (`20261028000000`).

Si el #926 se fusionara antes, esta migración quedaría *intercalada* (versión menor que una ya aplicada): el auditor de
drift fallaría y habría que renumerar. **La combinación** se probó (el árbol del #926 con las dos migraciones intercaladas en su
sitio, y la suite de este PR aplicando encima las 10 migraciones del #926: paso 7 de `run.sh`): la suite de este PR y dos de las tres suites de compras pasan,
pero **`compras_bloque_b` del #926 necesita que se adapten `DEP-5` y `PERM-4`** (ver «Combinación con el #926»).

Pasos:

1. **Antes (F5, el bloqueo)**: la migración toma `ACCESS EXCLUSIVE` sobre la tabla **lo primero** y lo mantiene hasta el `COMMIT`.
   Mientras espera ese bloqueo (hasta `lock_timeout`, 5 s), **toda lectura con RLS que toque la tabla se pone en cola detrás**
   (la política SELECT de `projects`, de pagos, etc., la leen). Medido por la verificación independiente con `pgbench` (8 clientes leyendo `projects` bajo RLS, base local de 43 filas): caso sano,
   la migración entera tarda 0,174 s y la latencia máxima de lectura fue 76 ms; con una transacción que leía la tabla y seguía abierta
   12 s, la migración falló a los 5,17 s y los 8 clientes se quedaron parados ~5,0 s. **Por eso, antes de lanzarla**: mirar
   `pg_stat_activity` en busca de transacciones largas y elegir un horario tranquilo —

   ```sql
   SELECT pid, state, now() - xact_start AS edad, wait_event_type
     FROM pg_stat_activity
    WHERE xact_start IS NOT NULL AND pid <> pg_backend_pid() AND now() - xact_start > interval '3 seconds'
    ORDER BY xact_start;   -- esperado: ninguna fila (no imprime consultas ni datos)
   ```

   Si hay alguna, esperar a que termine (o pedir que se cierre). Además, correr `scripts/diagnostico-asignaciones-proyecto.sql`
   en el Editor SQL de producción y guardar la salida (esperado: 43 filas, 10 huérfanas, 0 cruces, `permission_type total` = 43,
   privilegios completos para `anon`, «EL HUECO» en INSERT/UPDATE/DELETE).
2. Fusionar este PR **solo**. El apply toma una tabla de 43 filas (la `0600`) y después **cinco tablas** (`projects`, `role_permissions`, `roles`, `user_invitations`, `user_roles`: la `0700`, `ACCESS EXCLUSIVE` unos milisegundos, siempre en el mismo orden; `roles`, `user_roles` y `projects` se leen en cada inicio de sesión, así que **elegir un horario tranquilo** y mirar `pg_stat_activity` como en el paso 1). Si hubiera una transacción larga sobre alguna de ellas falla limpio
   (`55P03`, «canceling statement due to lock timeout»), **sin piezas a medias** (probado: 0 funciones tras el fallo de la `0600`; ninguna política cambiada tras el de la `0700`), y el
   workflow es *fail-fast*, **sin reintento automático**: se relanza a mano con **`workflow_dispatch`** de
   `apply-migrations-prod.yml`, campo `migration_file` = `20261026000600_seguridad_asignaciones_proyecto.sql` y después `20261026000700_autoridad_principal_empresa.sql` (el modo sin
   archivo reconcilia *todas* las pendientes: no usarlo aquí). **Si la `0700` aborta con «DERIVA»**, alguna de las 18 políticas ya no tiene el texto leído en producción el 2026-10-11: no se sobrescribe; hay que releerla y decidir.
3. **Después**: volver a correr el diagnóstico. La sección «tabla» (filas, usuarios, huella) debe ser **idéntica**;
   «estado» debe decir «corregida» en INSERT/UPDATE/DELETE (y la regla del principal), 2 triggers, 3 funciones, `anon` sin privilegios,
   `authenticated` sin `TRUNCATE`/`TRIGGER`/`REFERENCES` y con **el mismo DML que antes**; la sección «principales» cuenta quién escribirá la tabla; «administrables» da lo que alcanza el propietario (esperado en producción **33 de 43**; las otras 10, las huérfanas, sólo las alcanzan el superadministrador y el rol de servicio: es la cifra del padrón con la forma de producción, no se leyó en producción en esta ronda); «0700» debe decir «sólo el principal» en las 11 políticas. Prueba funcional sugerida en el
   sandbox existente, con una sesión de operador: un `POST` a `user_project_assignments` con su propio `user_id` debe responder 42501.
4. **Recapturar `scripts/schema-drift/huella-produccion.json`** (no se edita a mano; **no se tocó**): cambian los grants, las políticas y los
   triggers de la tabla y hay tres funciones nuevas (9 grupos de la `0600`) y las 11 políticas de la `0700` (5 grupos más). El auditor lo mostrará en rojo en `main` hasta entonces:
   `node scripts/schema-drift/auditar.mjs --base origin/main` en este PR da **verde** («14 cambios planificados», rc 0) y
   `node scripts/schema-drift/auditar.mjs --base HEAD` (lo que ve `main` tras el apply, antes de recapturar) da **rojo**
   («DRIFT NUEVO — 14 grupos», rc 1). Se refresca con `scripts/schema-drift/fingerprint.sql` en el Editor SQL, según el README del auditor.
5. Solo entonces el #926, luego el PR de alcance por proyecto y por último el #927, cada uno en su push.

**Notas de despliegue de la sexta ronda.**

* **Las ramas de Supabase Preview las recrea el orquestador/responsable** (no se tocaron aquí). Lo que Preview verá al recrear la rama del #928: la cadena entera con la `0600` y la `0700`, sobre una base construida sólo con migraciones (ACL de Preview). Lo que se probó aquí de eso: la `0600` y la `0700` aplicadas **como un rol no superusuario con `BYPASSRLS`** con la ACL de Preview y con la de producción (`run.sh` 4c), la `0700` con **cero** privilegios para todos los roles (no consulta ACL), con cinco `search_path` distintos, y la simulación de Preview: la versión anterior de la `0600` (`d1aeb94a` —la que tiene hoy la rama de Preview— o `8d34392b`) ya aplicada y la `0600` nueva más la `0700` encima, **tres veces**, con la ACL de Preview y con la de producción y como propietario no superusuario (2 perfiles × 2 versiones previas × 3 pasadas = 12): el catálogo extendido (`prosrc`, ACL de la función, dueño, `proconfig`, comentario, políticas, triggers, ACL de las seis tablas y datos) y la huella de `public` quedan **idénticos** a aplicar sólo la nueva en las 12; la `0700` aplicada **sola** sobre una `0600` anterior ya registrada (la rama de Preview no recreada) se aplica y deja las 11 políticas del principal, y reaplicar `0600` + `0700` no cambia nada. **No se probó en PostgreSQL 17 ni en Supabase real.**
* **Lo que el despliegue NO hace**: no conceder ninguna llave nueva del #926 (paquete A) a nadie —el principal las asignará a operadores, visores y roles personalizados—, no tocar `delete-user` ni `accept-invitation`, no recapturar la huella.
* **Hasta que la `0700` llegue a producción** un administrador todavía puede, por la API, escribir `roles`, `role_permissions` y `user_roles`, crear y borrar proyectos e insertar invitaciones con rol `admin` (medido contra el texto de las políticas de producción en el control negativo de `run.sh`). Las dos migraciones van en el mismo push para que esa ventana sea la del propio apply.
* **Edge functions**: `create-user` e `invite-user` se despliegan aparte de las migraciones (workflow de funciones). Hasta entonces un administrador sigue pudiendo crear o invitar administradores con ellas: las dos escriben con el **rol de servicio** (`create-user` inserta en `app_users` y `user_roles`, `invite-user` en `user_invitations`), así que la RLS de la `0700` no las alcanza y el único control es el de la propia función. La `0700` cierra la invitación `admin` insertada **directamente** por PostgREST, no estas dos rutas.

**Notas de despliegue de la tercera ronda.**

* **La rama de Supabase Preview de este PR conserva la versión `d1aeb94a` de la `0600` y no la vuelve a aplicar.** Releído con `SELECT` en la cuarta ronda (rama `utvotlctydazydmhbnop`, solo lectura):
  `md5(prosrc)` de `asignacion_bloquear_propia` = `ffc3eba1bbde772539c30946597452d0` (2 460 caracteres, `proconfig` solo `search_path`, es decir, el candado **por persona**), y la versión `20261026000600`
  figura registrada. El código actual da `a6ba72f5d332034ec60f4fa339543238` (3 642 caracteres, `proconfig` `search_path="",lock_timeout=2s`; el archivo, `049eb590…`; la reversión, `744574c2…`). La versión
  intermedia `b9b630b1` (candado global) **nunca llegó a verse en Preview**. Preview no vuelve a aplicar un archivo cuya versión ya figura registrada, así que **el check verde de Preview no valida la versión
  final de la `0600`**; para verificarla en la infraestructura real hay que **borrar y recrear esa rama de preview** (acción del responsable, como se hizo con la del #926). Lo que sí se probó aquí es el paso
  intermedio que Preview vería al recrearla o al aplicarla sobre lo existente: la base con `d1aeb94a` **o** `b9b630b1` ya aplicada y la versión nueva encima (3 pasadas, idempotente), con la ACL de Preview y con la de
  producción, que deja el catálogo idéntico a aplicar solo la nueva (ver «Barrido de regresión»).
* **Nota cruzada con el #926 (R2-8).** La `20261027000900` cuenta las filas de `user_project_assignments` en su pre-vuelo (línea 141) y las compara en su
  post-vuelo (línea 1775, `COMPRAS_MIGRACION_POSTVUELO: las asignaciones de proyecto cambiaron`) **sin bloquear la tabla** (ninguna migración de esa serie hace
  `LOCK TABLE`): el mismo patrón que F4 corrigió aquí. Si una asignación legítima se confirma en esa ventana, la `0900` aborta con un falso positivo (falla
  limpio y se reintenta, no deja nada a medias). Por eso esta migración va **antes** y conviene correr el #926 **sin escrituras de asignaciones** (o dar a la `0900`
  el mismo orden que F4: `LOCK TABLE` antes de contar). No se toca aquí: es del #926.
* La `0600` no choca con ninguna migración del #926: ninguna hace `ALTER`/`CREATE TRIGGER`/`CREATE POLICY` sobre `app_users`, `projects` ni `user_project_assignments`, y el
  workflow de producción aplica un archivo por vez.

## Reversión

**Dos guiones, independientes** (`run.sh` 8a, 8d y 8e): `scripts/reversion-principal-empresa.sql` (la `0700`: devuelve las 11 políticas a su **texto exacto de producción**, con `public.*`; idempotente; no toca filas, privilegios, funciones ni triggers; toma su propio `LOCK TABLE` de las cinco tablas antes de medir; se corre **primero**) y `scripts/reversion-asignaciones-proyecto.sql` (la `0600`, descrita abajo). Probadas **juntas** (0700 → 0600 y 0600 → 0700 dejan el catálogo idéntico al de antes de la serie: 3 357 grupos, 0 diferencias), **por separado** (revertir sólo la `0600` con la `0700` puesta deja el catálogo de «sólo la `0700`»; revertir sólo la `0700` deja el de «sólo la `0600`» y las 18 políticas con el `md5` de producción) y con `search_path` vacío. **Quien revierte la `0700` reabre** la creación y el borrado de proyectos, la escritura de roles, llaves y asignaciones de roles y la invitación de administradores por parte de un administrador; **quien revierte la `0600`** reabre la autoasignación. Después hay que volver a recapturar la huella.

`scripts/reversion-asignaciones-proyecto.sql`: devuelve las cuatro políticas a su texto original, quita los triggers y las
funciones y restaura los privilegios (a `anon` los siete; a `authenticated` solo `TRUNCATE`, `TRIGGER` y `REFERENCES`: su
`SELECT`/`INSERT`/`UPDATE`/`DELETE` **no se tocan**, igual que la migración); idempotente; bloquea la tabla antes de medir; no toca
filas. **Probada**: con la **ACL de producción** (anon y authenticated con `arwdDxt`, más `m` en PostgreSQL 17) deja el catálogo **exacto** (huella
idéntica, 0 diferencias, ACL incluida) tanto con el propietario superusuario del arnés como con un propietario **no superusuario con `BYPASSRLS`**, y
migración → reversión → migración cierra el ciclo; también con `auth` en el `search_path` (R2-3) y con un `search_path` **vacío** o sin `public` (V3-04: `run.sh` 8c; antes abortaba con «function is_super_admin() does not exist» porque el texto original de las políticas iba sin calificar, y ahora lleva `public.…`). **No es exacta con la ACL de Supabase Preview (R2-4):** a
`authenticated` no le inventa DML (solo le devuelve `TRUNCATE`, `TRIGGER` y `REFERENCES`), pero a `anon` le devuelve los **siete**, que son los de producción;
en una base con la ACL de Preview (`anon` solo con `TRUNCATE`/`REFERENCES`/`TRIGGER`) `anon` recupera `SELECT`/`INSERT`/`UPDATE`/`DELETE` que **nunca tuvo**
(medido: ACL `{postgres=arwdDxt, service_role=Dxt}` tras migrar y `anon=arwdDxt` tras revertir). No hay exposición —la RLS no le da nada a `anon` y volver a
aplicar la migración se lo quita—, y la reversión es un guion de emergencia **para producción**; se decidió no volverla relativa (guardar el estado previo de
`anon` exigiría persistirlo en el catálogo o ramificar por versión de PostgreSQL, y el privilegio `MAINTAIN` de PG17 no se puede ejercitar aquí) para no
meter lógica de privilegios en un guion de emergencia. `run.sh` 4c(a) fija este comportamiento y 4c(b) la exactitud con la ACL de producción. La reversión también
toma su propio `LOCK TABLE` antes de medir (R02: una escritura concurrente espera; sin él, la reversión abortaba con un falso «las filas CAMBIARON»). **Quien
revierte reabre el hueco.** Después hay que volver a recapturar la huella. Volver a aplicar la migración (idempotente) lo cierra otra vez.

## Cómo reproducirlo

```bash
bash supabase/tests/asignaciones_proyecto/run.sh          # PGPORT_TEST=<puerto> para elegir el puerto del clúster desechable
ASG_CARGA=1 PGPORT_TEST=<puerto> bash supabase/tests/asignaciones_proyecto/run.sh   # mediciones de carga (pgbench): tres variantes del candado; no es la suite
npx vitest run src/domain/empresa src/components/empresa   # interfaz
npx vitest run supabase/functions/create-user supabase/functions/invite-user   # funciones puras de las edge functions
node scripts/schema-drift/auditar.mjs --base origin/main   # auditor de drift (offline)
```

Los guiones de reproducción manual de la quinta ronda (V4-H01, V4-H02, V4-H04, V4-H06 y V4-H07: sesiones `psql` reales sincronizadas con `pg_stat_activity` y `pg_locks`) **no forman parte de `run.sh`**; están descritos paso a paso
en «Quinta ronda · Lo medido» y en la cabecera de la migración. Sí están fijados en `run.sh` y en `assert_catalogo.sql` V4-H03 y V4-H05 (la clave de la persona, la de las personas sin empresa y los mutantes M6 y M7).
