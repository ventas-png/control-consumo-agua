# Seguridad de las asignaciones de proyecto (`user_project_assignments`)

PR de seguridad **separado** del #926 (compras y contabilidad). Una sola migración,
`supabase/migrations/20261026000600_seguridad_asignaciones_proyecto.sql`, que se despliega
**primero** y en su propio push a `main` (ver «Orden y pasos de despliegue»).

## En una frase

Las políticas de escritura de `user_project_assignments` terminaban en
`OR user_id = (SELECT auth.uid())`: cualquier usuario autenticado podía asignarse un proyecto y un
administrador acotado podía borrar sus filas y quedar «exento de proyecto» (ve toda la empresa).
Como `can_access_project()`, `user_is_project_exempt()` y `user_has_project_access()` leen esa
tabla, **el alcance por proyecto no era un límite real contra un usuario hostil**. Ahora nadie
cambia sus propias asignaciones (salvo el propietario y el superadministrador, que son exentos), y la
persona y el proyecto tienen que ser de la misma empresa para cualquier actor. **No cambia ni una fila.**

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
REFERENCES, TRIGGER`); la RLS es lo único que los frena. La tabla no tiene llave foránea hacia las personas
(`user_id` no apunta a `app_users`) ni triggers propios, y ninguna función de `public` ni ninguna edge function
la escribe: el único flujo de escritura de la aplicación es la pantalla `AsignacionModal`.

## Riesgo real: qué se podía hacer y qué no

Reproducido con la suite `supabase/tests/asignaciones_proyecto/` sobre la base **sin** la migración (control
negativo: **73 de 148 casos de la matriz se ponen en rojo**; los otros 75 son lo legítimo y lo que ya estaba cerrado).

| Qué | Antes de la migración | Después |
|---|---|---|
| Un operador, visor o cualquier rol se asigna otro proyecto de **su** empresa (`POST /rest/v1/user_project_assignments`) | **Se podía** (1 fila). Desde ese momento `can_access_project()` le abre el proyecto | `ASIGNACION_PROPIA_NO_PERMITIDA` (42501) |
| …un proyecto de **otra** empresa | **Se podía**: la fila se crea. El acceso efectivo a datos depende de que cada política pida además la empresa: 106 políticas de `public`/`storage` dependen de la asignación o de sus helpers y todas mencionan la empresa (comprobación textual; no se probó una por una) | `ASIGNACION_EMPRESA_DISTINTA` (23514) |
| Un administrador acotado borra **sus** filas | **Se podía** (3 filas) y `user_is_project_exempt()` pasa de `false` a `true`: ve toda la empresa | 0 filas; sigue acotado |
| Cambiar su fila de proyecto, pasarla a otra persona, cambiar su `permission_type` | **Se podía** | 0 filas |
| Un administrador asigna a una persona de **otra** empresa, a una **huérfana** (`user_id` sin `app_users`), a alguien **sin empresa** o a un **cliente** | **Se podía** (la política solo miraba el proyecto, nunca a la persona) | `ASIGNACION_EMPRESA_DISTINTA` |
| Un administrador con un solo proyecto lo borra por la API (`DELETE FROM projects`): la baja en cascada le quita su última fila y queda exento | **Se podía** (reproducido a mano en la base sin la migración) | `ASIGNACION_PROPIA_NO_PERMITIDA`; si le queda otra asignación, el borrado sí procede (decisión D-5) |
| `TRUNCATE` / `TRIGGER` / `REFERENCES` para `authenticated`; los siete privilegios para `anon` | Concedidos. PostgREST no expone `TRUNCATE`, así que no era explotable por la API, pero era un privilegio de sobra | Retirados |

Lo que **no** se podía (comprobado, no supuesto): leer las asignaciones de otras personas (la política SELECT
es la misma de hoy); cambiarse el rol, la empresa, el proyecto principal, `activo` o `permission_type` en
`app_users` (el trigger `lock_app_users_self_privilege` lo revierte: [alcance 5] de la suite); que `anon`
escriba (la RLS no tiene política para `anon`).

## Qué cambia

| Pieza | Detalle |
|---|---|
| `asignacion_puede_administrar(p_user_id, p_project_id)` | Regla única, `SECURITY DEFINER`, `STABLE`, `search_path` vacío; `EXECUTE` solo para `authenticated` y `service_role`. **Superadministrador** (`super_admin`/`superadmin`): cualquiera. **Propietario** (`company_owner`): persona **y** proyecto de su empresa, también a sí mismo (es exento). **Administrador** (`admin`): persona **y** proyecto de su empresa, **nunca a sí mismo**, y solo los proyectos que él ve. Cualquier otro rol: nada. «Persona de su empresa» = existe en `app_users` con su `company_id`. Devuelve siempre `true`/`false`, nunca `NULL` |
| Políticas INSERT, UPDATE (USING y WITH CHECK) y DELETE | Mismos nombres; las tres llaman a la regla. UPDATE comprueba la fila vieja **y** la nueva. Un `UPSERT` (`INSERT … ON CONFLICT DO UPDATE`) queda cubierto por INSERT y UPDATE |
| Trigger `trg_asignacion_empresa` (BEFORE INSERT OR UPDATE OF `user_id`, `project_id`) | **Para cualquier actor**, también `service_role` y superusuario: la empresa de la persona (`app_users.company_id`) debe existir y ser igual a la del proyecto, o `ASIGNACION_EMPRESA_DISTINTA` (`check_violation`). Valida solo lo que se escribe; no mira ni toca las filas existentes. Lee la fila de la persona y la del proyecto con `FOR SHARE`: si otra transacción está cambiando la empresa de cualquiera de las dos, la asignación espera y ve la empresa nueva |
| Trigger `trg_asignacion_propia` (BEFORE INSERT OR UPDATE OR DELETE) | Defensa en profundidad: con sesión de la API (`auth.uid()` no nulo), tocar una fila propia exige ser propietario o superadministrador, o `ASIGNACION_PROPIA_NO_PERMITIDA` (`insufficient_privilege`). Si una política permisiva futura reabriera el hueco, esto lo sigue cerrando. `service_role` y superusuario (`auth.uid()` nulo) pasan. **Excepción**: la baja *en cascada* por borrar el proyecto (la fila padre ya no existe) se permite si la persona conserva otra asignación (D-5) |
| Privilegios | `anon`: ninguno. `authenticated`: sin `TRUNCATE`, `TRIGGER` ni `REFERENCES`; conserva `SELECT`, `INSERT`, `UPDATE`, `DELETE`, que la RLS gobierna. La misma higiene que `20261026000200` (compras y contabilidad) |
| Pre y post-vuelo | Exige las funciones y tablas que da por existentes; guarda conteo y huella md5 ordenada de `(id, user_id, project_id, permission_type)`; informa (sin fallar) de huérfanas, cruces de empresa y administradores sin filas. Al final exige conteo y huella **idénticos** y que existan las 4 políticas, los 2 triggers, las 3 funciones y los privilegios; si no, aborta y la transacción no deja nada |
| Transacción | `BEGIN … COMMIT`, `SET LOCAL lock_timeout = '5s'`, `SET LOCAL statement_timeout = '60s'`, idempotente |

La interfaz (`AsignacionModal`, `EmpresaUsuariosSection`, `domain/empresa/usuarios.ts`) cambia en dos cosas:
un administrador que no es propietario ni superadministrador **no puede editarse a sí mismo** (el botón
«Acceso» de su fila queda deshabilitado con la explicación y el modal deshabilita «Guardar»; los errores
`ASIGNACION_PROPIA_NO_PERMITIDA`, `ASIGNACION_EMPRESA_DISTINTA` y 42501 se traducen a un mensaje útil), y el guardado
pasa de «borrar todas y volver a insertar» a **diferencias** (inserta las que faltan, borra solo las que sobran y lo
comprueba leyendo de vuelta). Ver «Interfaz».

## Qué NO cambia

* **Las filas**: ni una; conteo y huella idénticos antes y después (la migración lo comprueba y aborta si no).
  Las 10 huérfanas se conservan; no se «arreglan» ni se borran.
* La política **SELECT** (cada persona lee las suyas), `permission_type` (hoy todas `total`; ninguna política,
  función ni pantalla lo lee para decidir acceso), y `user_has_project_access`, `can_access_project`,
  `user_is_project_exempt` y todas las políticas de otras tablas.
* Lo que pueden hacer propietario, superadministrador y administradores sobre **otras** personas de su empresa
  (los 23 flujos legítimos de la pantalla que se probaron dan el mismo resultado antes y después).

## Una diferencia con el diseño inicial, justificada con una prueba

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

## Datos de producción encontrados (solo lectura, 2026-10-10)

| Dato | Valor |
|---|---|
| Filas / usuarios distintos | 43 / 27 |
| `permission_type` | las 43 son `total` (no hay `lectura`, `financiero` ni `administrativo`) |
| Filas **huérfanas** (`user_id` sin `app_users`) | **10**, de **6** usuarios distintos |
| Filas con la empresa de la persona distinta de la del proyecto | **0** |
| Empresas / proyectos | una sola empresa, 8 proyectos |
| Por rol | administrador 3 filas / 1 persona (el único administrador acotado), operador 14 / 7, visor 16 / 13 |
| Privilegios | `anon` y `authenticated` con los 7 sobre la tabla |

Con 0 cruces y una sola empresa, el trigger de integridad no encuentra nada que rechazar en los datos actuales:
solo cierra el camino hacia adelante. `scripts/diagnostico-asignaciones-proyecto.sql` (un único `SELECT` de solo
lectura) repite todos estos números y se corre en producción **antes y después**; no imprime correos ni nombres.

## Flujos legítimos de administración probados

`supabase/tests/asignaciones_proyecto/assert_flujos.sql` reproduce la pantalla (borrar todas + insertar, y el guardado
por diferencias) con sesiones autenticadas simuladas:

| # | Flujo | Resultado |
|---|---|---|
| 1 | Administrador **exento** reemplaza a otra persona de su empresa | Igual que antes |
| 2 | Administrador **acotado** reemplaza a otra persona con proyectos que él ve; lo que no ve sobrevive | Igual que antes |
| 3 | **Propietario** reemplaza a cualquiera de su empresa y **a sí mismo** | Igual que antes |
| 4 | **Superadministrador** (`super_admin` y `superadmin`) administra cualquier empresa | Igual que antes |
| 5 | Un administrador cambia el alcance de **otro administrador** (también lo deja sin filas) | Igual que antes (decisión D-2) |
| 6 | Propietario de otra empresa administra la suya | Igual que antes |
| 7 | Cada persona **lee** solo lo suyo; el administrador acotado, las filas de sus proyectos | Igual que antes |
| 8 | `service_role`: sembrado que borra y vuelve a insertar, `UPSERT … ON CONFLICT (user_id, project_id)` | Igual que antes |
| ✗ | Autoedición (operador, administrador acotado o exento sobre sí mismo): 5 flujos | **Cambian**, a propósito: no escribe nada y devuelve error (o 0 filas) |

De los 28 flujos de la suite, **23 dan exactamente el mismo resultado antes y después** y cambian solo los 5 de
autoedición (`run.sh` lo compara automáticamente). Las escrituras de los scripts de siembra son compatibles:
`scripts/seed-rls-sandbox.mjs` converge con el cliente de servicio (borra y hace `upsert`) y
`scripts/rls-evidencias-datos.sql` asigna personas y proyectos de la misma empresa (se ejecutaron sus `INSERT`
contra una base con la migración puesta: 4 filas, sin error).

## Interfaz

* **Autoedición**: en la fila del propio administrador el botón «Acceso» queda deshabilitado, con el texto
  «Tus proyectos los cambia otro administrador, el propietario o el superadministrador»; si aun así se abriera el
  modal, «Guardar» está deshabilitado con «No puedes cambiar tus propios proyectos…». Propietario y superadministrador
  (`super_admin` y `superadmin`) sí pueden. El servidor es el que manda; esto solo evita ofrecer lo que será rechazado.
* **Guardado por diferencias** (`guardarAsignacionesProyecto`): lee lo actual, **inserta primero** lo que falta
  (`ON CONFLICT DO NOTHING`), **después** borra solo lo que sobra y que la pantalla muestra, y lee de vuelta. Se justificó con la
  prueba: (i) con «borrar todas + insertar», si el insert falla la persona se queda con **cero** asignaciones
  (`[flujo 9]`: `|42501|0`), y un administrador sin filas es exento; por diferencias un insert fallido no borra nada
  (`P2,P3|42501|2`); (ii) las filas que no cambian se **conservan** con el mismo `id`, `created_at` y `permission_type`
  (antes se recreaban como `total`: `[flujo 1]` 0 conservadas frente a 2); (iii) la RLS puede filtrar un `DELETE` y contestar 0 filas
  **sin error**: la lectura posterior lo detecta y la pantalla ya no dice «guardado».
* Pruebas vitest nuevas: 38 (`AsignacionModal.test.tsx` 15, `EmpresaUsuariosSection.acceso.test.tsx` 4,
  `asignacionesProyecto.test.ts` 19); **33 en rojo sobre el código anterior** y las 38 en verde con el cambio.

## Resultados de las pruebas

Suite `supabase/tests/asignaciones_proyecto/run.sh` (PostgreSQL 16 real, cadena de 557 migraciones anteriores, cableada
en `coverage.yml`, puerto 55532):

| Bloque | Resultado |
|---|---|
| Datos como producción | 43 filas · 27 usuarios · 10 huérfanas; huella md5 `(id, user_id, project_id, permission_type)` y de **todas** las columnas idénticas antes/después; las 43 coinciden fila a fila con la copia original; `user_is_project_exempt()`, `can_access_project()` (39 personas × 10 proyectos = 390 pares) y lo que cada persona lee: **0 diferencias** (19 comprobaciones) |
| Catálogo y privilegios | 31 comprobaciones: 4 políticas con los nombres de siempre, SELECT idéntica a producción, 2 triggers por fila BEFORE, 3 funciones `SECURITY DEFINER` con `search_path` vacío, `EXECUTE` solo para quien debe, `anon` sin ningún privilegio, `authenticated` sin `TRUNCATE`/`TRIGGER`/`REFERENCES`, `TRUNCATE` como `authenticated`/propietario/superadministrador falla con `permission denied` |
| Matriz rol × operación × objetivo | **148 casos** (INSERT, UPDATE, DELETE, UPSERT y `INSERT … SELECT`; super_admin/superadmin, propietario, administrador exento, administrador acotado, operador, visor, cliente, sin `app_users`, sin empresa, administrador/propietario/operador de otra empresa, `anon`, `service_role`, superusuario; filas propias y ajenas; proyectos propios, ajenos, de otra empresa y que el administrador no ve; personas de la empresa, de otra empresa, huérfanas, sin empresa e inexistentes; `UPDATE` que cambia `user_id` a sí mismo y `project_id` a otra empresa). Cada «no debe pasar» comprueba **código y mensaje**, que la tabla no cambió y que la **misma sentencia como SISTEMA sí funciona** (el cero no es un `WHERE` equivocado) |
| Flujos legítimos | 41 comprobaciones (28 flujos de pantalla + 13 lecturas/servicio) |
| Alcance | 24 comprobaciones: **290/290** intentos de autoasignación (29 personas × 10 proyectos) bloqueados con 42501/23514 (94 por integridad de empresa, 196 por el trigger de autoasignación); **84/84** intentos de borrar/cambiar lo propio afectaron 0 filas; el alcance de las 33 personas no se movió; ningún administrador acotado se vuelve exento; el borrado en cascada de un proyecto al que está asignado procede si le queda otra asignación y se rechaza si sería la última |
| Capas por separado | 28 + 28: las **políticas solas** (sin triggers) ya cierran el hueco; los **triggers solos** (con una política `true`) también |
| Control negativo | Sin la migración: matriz **73 rojos / 75 verdes de 148**, y rojas `assert_alcance`, `assert_catalogo`, `assert_defensa`, `assert_capas` |
| Idempotencia | 2ª pasada limpia; huella del catálogo de `public` idéntica (3363 grupos, 0 diferencias); la migración cambia **9** grupos de la huella |
| Guardas | Pre-vuelo: con `can_access_project(uuid)` ausente aborta («faltan can_access_project(uuid)») y no deja ninguna pieza. Post-vuelo: si la migración cambiara **una** fila aborta («las filas … CAMBIARON») y la transacción no deja nada. `lock_timeout`: con una transacción larga sobre la tabla falla en 5 s sin dejar piezas y, reintentada, se aplica |
| Reversión | `scripts/reversion-asignaciones-proyecto.sql` dos veces: huella del catálogo de `public` **idéntica** a la de antes de la migración (**0 diferencias en 3357 grupos**), `pg_get_expr` de las 4 políticas idéntico (md5 por política), 43 filas intactas, la matriz vuelve a **73 rojos**; reaplicar la migración deja el catálogo idéntico al de la migración |
| Mutaciones | 14: cada política revertida a mano, la regla «concede todo», sin exclusión de sí mismo, sin «proyectos que ve», sin «persona de la empresa», sin cada trigger (y deshabilitado), privilegios devueltos, SELECT que pierde las propias, y el revert completo. **En las 14 alguna aserción se pone en rojo** (la lista de archivos rojos por mutación sale en el log) |
| Concurrencia | Sesiones reales: dos administradores sobre la misma persona (proyectos distintos: unión `{P4,P5,P6,P7}` sin duplicados ni deadlock; solapados: gana el primero, el segundo recibe `duplicate key` 23505 limpio; por diferencias: sin error y la fila que no cambió conserva su id); una autoasignación mientras otro administrador asigna (recibe `ASIGNACION_PROPIA_NO_PERMITIDA`, queda con lo que le dio el otro y sigue acotado); un administrador acotado que intenta ampliarse mientras otro escribe a un tercero; el cambio de empresa de la persona o del proyecto concurrente con la asignación (control negativo sin `FOR SHARE`: 1 fila cruzada; con el candado: 0 y error `ASIGNACION_EMPRESA_DISTINTA`) |
| Diagnóstico | `scripts/diagnostico-asignaciones-proyecto.sql`: una sentencia, corre con `default_transaction_read_only=on` (un `DELETE` ahí falla), señala «EL HUECO» antes y «corregida» después, la sección «tabla» es idéntica |

Total de la suite: **319 comprobaciones ✓** en los siete bloques de una sesión (19 + 31 + 148 + 41 + 24 + 28 + 28), más el control
negativo, la idempotencia, las dos guardas, el `lock_timeout`, la reversión, las 14 mutaciones, la concurrencia y el diagnóstico.

## Barrido de regresión

Todas las suites `supabase/tests/*/run.sh` (63) con la migración puesta, frente a `origin/main` sin ella, cada una en su propio
PostgreSQL desechable (mismo comando, puerto propio):

| | Resultado |
|---|---|
| `origin/main` sin la migración | **63/63 suites en verde** (`rc=0`), `compras_bloque_b` incluida |
| Con la migración (y la suite nueva) | **64/64 en verde** (las 63 anteriores + `asignaciones_proyecto`) |
| Mismo resultado archivo por archivo | 63/63: mismo `rc`, mismo número de `✓` y de `ERROR`. 57 logs idénticos tras normalizar rutas, puertos, tiempos y hashes; 3 difieren en 2 líneas (la ruta del script dentro de un `NOTICE`); 3 (`compras_bloque_b`, `compras_cierre_tecnico`, `proveedores_pr_a`) tienen exactamente **una** línea `✓ migrations-append-only` más, porque esa guarda corre en el árbol de trabajo y se omite en la copia extraída de `origin/main` |

Las tres pruebas `node` de replay de `supabase/tests` (`replay_acl_helpers/run.mjs`, `declarar_triggers_fill_company_id/replay.mjs`,
`cumplimiento_calidad_firma_inequivoca/replay.mjs`) también salen en verde con la migración.

Las suites que insertan en `user_project_assignments` (`compras_bloque_b`, `compras_cierre_tecnico`, `conta_*`, `personal_usuario`,
`presencia_*`, `proveedores_pr_a`, `registrar_lectura`, `turnos`…) siguen en verde con el trigger de integridad puesto: todas asignan
personas y proyectos de la misma empresa.

**Combinación con el #926** (árbol de la rama del PR #926, `9262bc87`, con esta migración en su sitio, entre `20261026000500` y
`20261027000000`): `asignaciones_proyecto` en verde con las **10 migraciones del #926 aplicadas encima** (paso 7 de `run.sh`: matriz
148 ✓ y flujos 41 ✓), `compras_bloque_b` en verde (985 ✓), `compras_cierre_tecnico` y `compras_flujo` en verde. Esta comprobación
encontró un conflicto real con el diseño inicial del trigger de autoasignación (que también rechazaba la baja en cascada): rompía
`compras_bloque_b/hallazgos/DEP-5.sql`, que exige que un administrador asignado a un proyecto pueda eliminarlo. Ver D-5.

## Riesgos residuales y decisiones abiertas

| # | Qué | Estado |
|---|---|---|
| D-1 | Un administrador **acotado** solo reparte los proyectos que él ve, como hoy. Si el negocio quiere que reparta cualquier proyecto de su empresa, hay que quitar la condición de visibilidad **y** cambiar el guardado de la pantalla (si no, borraría lo que no ve) | Decidido (igual que antes); abierta si se quiere otra cosa |
| D-2 | **Dos administradores pueden colaborar**: uno puede ampliar, acotar o incluso dejar sin filas (y por tanto exento) a otro administrador. Es lo que hoy ofrece la pantalla y no se tocó. Si se quiere que solo el propietario/superadministrador cambie a un administrador, es una regla más en la función | **Decisión de negocio** |
| D-3 | **Filas huérfanas** (10, de 6 usuarios que ya no existen en `app_users`): no son administrables por un administrador ni por el propietario, solo por el superadministrador o el rol de servicio; no se borran ni se «arreglan». Siguen dando `can_access_project` a un `user_id` que ya no existe (inofensivo mientras ese id no vuelva a existir) | Propuesta aparte: confirmar los 6 ids y borrarlos con el superadministrador |
| D-4 | `permission_type`: nada lo lee para decidir acceso (las 43 son `total`). La regla no lo distingue; la pantalla escribe `total` en las filas nuevas y conserva el de las existentes | Sin acción |
| D-5 | **Diferencia con el diseño inicial, justificada con una prueba**: el diseño del trigger de autoasignación rechazaba también la baja *en cascada* de la fila propia. Al probar la combinación con el árbol del #926 (ver «Barrido de regresión») eso rompía `compras_bloque_b/hallazgos/DEP-5.sql`, que comprueba que un administrador asignado a un proyecto **puede eliminarlo** (sus órdenes de pago quedan sin proyecto). Ahora la cascada se permite si la persona conserva **otra** asignación (su alcance solo se reduce) y se rechaza si fuera la **última** (quedaría sin filas y, siendo administrador, exento): `[alcance 3]`. La pantalla no ofrece borrar proyectos | Decidido |
| D-6 | Si el **propietario o el superadministrador** borra el último proyecto de un administrador acotado, éste queda sin filas y por tanto exento (`[alcance 3]`). Es una decisión de quien borra, no del administrador | Riesgo residual; mitigación posible: aviso en la pantalla |
| D-7 | El trigger de integridad valida **al escribir**. Carrera reproducida y cerrada: sin candado, un cambio de empresa de la persona (o del proyecto) concurrente con su asignación dejaba **1 fila cruzada** (`D0` de la suite); con `FOR SHARE` la asignación espera y recibe `ASIGNACION_EMPRESA_DISTINTA` (`D1`, `D2`: 0 filas cruzadas). Lo que **no** cubre: si después se cambia la empresa de una persona o proyecto que **ya tiene** asignaciones, no hay trigger en `app_users`/`projects` y quedan filas cruzadas | Hoy: 0 cruces. La sección «cruces» del diagnóstico las cuenta |
| D-8 | `service_role` ya no puede asignar entre empresas (la integridad vale para todo actor). Si soporte lo necesitara, `ALTER TABLE … DISABLE TRIGGER trg_asignacion_empresa` en una transacción corta y con registro | Documentado |
| D-9 | La regla mira solo `app_users.role` (`company_owner`, `admin`, `super_admin`, `superadmin`), como la política anterior; los roles RBAC personalizados no administran asignaciones | Sin cambio |
| D-10 | No se comprobó, política por política, que cada una de las 106 que dependen de la asignación exija bien la empresa (solo que la mencionan) | Auditoría aparte |

## Otros caminos hacia el mismo efecto (se buscaron; no se corrigen aquí)

* **Cambiarse el rol, la empresa o el proyecto principal en `app_users`**: no se puede. La política `app_users_update`
  deja actualizar la propia fila, pero `trg_lock_app_users_self_privilege` restituye `role`, `company_id`,
  `cliente_id`, `project_id`, `activo` y `permission_type` (`[otros caminos]` de `assert_alcance.sql`: un operador y un
  administrador acotado intentan «promoverse» y la fila queda igual). `user_has_project_access()` también lee
  `app_users.project_id`, por eso importa que ese trigger esté.
* **Borrar el último proyecto** (baja en cascada de la fila propia): era un camino real para un administrador (la
  política `projects_delete` se lo permite; reproducido a mano en la base sin la migración: la cascada le quita su última
  fila y `user_is_project_exempt()` pasa a `true`); lo cierra el trigger de autoasignación solo cuando sería su última
  fila (D-5). Con el propietario o el superadministrador no es una escalada, es una decisión suya (D-6).
* **Crear un proyecto nuevo** en su empresa: no da acceso a él (no hay asignación automática) y la regla no deja asignárselo.
* No se encontró ninguna función de `public`, migración ni edge function que escriba la tabla.

## Orden y pasos de despliegue

`apply-migrations-prod.yml` tiene `MAX_APPLY = 10` por push y aplica solo los `.sql` añadidos en ese push, por orden
de versión. Por eso **cada PR va en su propio push a `main`**, sin undécima migración en el #926 y sin subir el tope:

1. **Este PR** (`20261026000600`, versión > `20261026000500`, el máximo de producción, y < `20261027000000`, la primera del #926).
2. Después el **#926** (10 migraciones `20261027000000 … 20261027000900`).
3. Después el **#927** (`20261028000000`).

Si el #926 se fusionara antes, esta migración quedaría *intercalada* (versión menor que una ya aplicada): el auditor de
drift fallaría y habría que renumerar. Se verificó que **la combinación** funciona: el árbol del #926 con esta migración
intercalada en su sitio, con la suite de este PR aplicando encima las 10 migraciones del #926 (paso 7 de `run.sh`), ver
«Barrido de regresión».

Pasos:

1. **Antes**: correr `scripts/diagnostico-asignaciones-proyecto.sql` en el Editor SQL de producción y guardar la salida
   (esperado: 43 filas, 10 huérfanas, 0 cruces, `permission_type total` = 43, privilegios completos para `anon`, «EL HUECO» en INSERT/UPDATE/DELETE).
2. Fusionar este PR **solo**. El apply toma una tabla de 43 filas: `DROP/CREATE POLICY` piden `ACCESS EXCLUSIVE` un instante
   y van detrás de `lock_timeout = 5s`; si hubiera una transacción larga sobre la tabla falla limpio (55P03), sin piezas a medias,
   y se reintenta.
3. **Después**: volver a correr el diagnóstico. La sección «tabla» (filas, usuarios, huella) debe ser **idéntica**;
   «estado» debe decir «corregida» en INSERT/UPDATE/DELETE, 2 triggers, 3 funciones, `anon` sin privilegios,
   `authenticated` sin `TRUNCATE`/`TRIGGER`/`REFERENCES`. Prueba funcional sugerida en el sandbox existente, con una sesión
   de operador: un `POST` a `user_project_assignments` con su propio `user_id` debe responder 42501.
4. **Recapturar `scripts/schema-drift/huella-produccion.json`** (no se edita a mano): cambian los grants, las políticas y los
   triggers de la tabla y hay tres funciones nuevas (9 grupos). El auditor lo mostrará en rojo en `main` hasta entonces:
   `node scripts/schema-drift/auditar.mjs --base origin/main` en este PR da **verde** («9 cambios planificados», rc 0) y
   `node scripts/schema-drift/auditar.mjs --base HEAD` (lo que ve `main` tras el apply, antes de recapturar) da **rojo**
   («DRIFT NUEVO — 9 grupos», rc 1). Se refresca con `scripts/schema-drift/fingerprint.sql` en el Editor SQL, según el README del auditor.
5. Solo entonces el #926, y luego el #927, cada uno en su push.

## Reversión

`scripts/reversion-asignaciones-proyecto.sql`: devuelve las cuatro políticas a su texto original, quita los triggers y las
funciones y restaura los privilegios; idempotente; no toca filas. **Quien revierte reabre el hueco.** Después hay que volver
a recapturar la huella. Volver a aplicar la migración (idempotente) lo cierra otra vez.

## Cómo reproducirlo

```bash
bash supabase/tests/asignaciones_proyecto/run.sh          # PGPORT_TEST=<puerto> para elegir el puerto del clúster desechable
npx vitest run src/domain/empresa src/components/empresa   # 151 pruebas, 38 de ellas nuevas
node scripts/schema-drift/auditar.mjs --base origin/main   # auditor de drift (offline)
```
