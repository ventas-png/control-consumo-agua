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

**Alcance de la afirmación (léase antes de confiar en ella).** Esto cierra el camino de un usuario
*cualquiera* (operador, visor, cliente) y el de un administrador acotado *sobre sí mismo*. **No convierte el
alcance por proyecto en un límite real contra un administrador hostil**: un administrador acotado puede
crear un administrador nuevo (edge functions `create-user` / `invite-user`) y éste nace **exento**, y dos
administradores acotados pueden dejarse exentos entre sí. Ver D-2 y «Otros caminos»; ninguno de los dos se
corrige aquí porque ambos son decisiones de negocio.

## Historial de este PR

| Ronda | Qué pasó |
|---|---|
| 1 | Migración, suite contra PostgreSQL real, interfaz y documento (`0a8b3983`…`1794dc8f`) |
| 2 | **Supabase Preview** aplicó por primera vez la migración en una base construida solo con migraciones y la **abortó**: «privilegios de la tabla mal repartidos» (P0, ver «Lección de ACL»). Dos verificaciones independientes (ataque hostil y flujos/interfaz/CI) encontraron además una carrera real en la baja en cascada (F1) y varios defectos menores. Esta versión corrige todo lo corregible y deja el resto como decisión de negocio |

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

Reproducido con la suite `supabase/tests/asignaciones_proyecto/` sobre la base **sin** la migración (control
negativo: **73 de 148 casos de la matriz se ponen en rojo**; los otros 75 son lo legítimo y lo que ya estaba cerrado).

| Qué | Antes de la migración | Después |
|---|---|---|
| Un operador, visor o cualquier rol se asigna otro proyecto de **su** empresa (`POST /rest/v1/user_project_assignments`) | **Se podía** (1 fila). Desde ese momento `can_access_project()` le abre el proyecto | `ASIGNACION_PROPIA_NO_PERMITIDA` (42501) |
| …un proyecto de **otra** empresa | **Se podía**: la fila se crea. El acceso efectivo a datos depende de que cada política pida además la empresa: **77 políticas** (70 de `public` y 7 de `storage`) mencionan directamente la asignación o sus helpers y todas mencionan también la empresa (comprobación textual; no se probó una por una: D-10) | `ASIGNACION_EMPRESA_DISTINTA` (23514) |
| Un administrador acotado borra **sus** filas | **Se podía** (3 filas) y `user_is_project_exempt()` pasa de `false` a `true`: ve toda la empresa | 0 filas; sigue acotado |
| Cambiar su fila de proyecto, pasarla a otra persona, cambiar su `permission_type` | **Se podía** | 0 filas |
| Un administrador asigna a una persona de **otra** empresa, a una **huérfana** (`user_id` sin `app_users`), a alguien **sin empresa** o a un **cliente** | **Se podía** (la política solo miraba el proyecto, nunca a la persona) | `ASIGNACION_EMPRESA_DISTINTA` |
| Un administrador con un solo proyecto lo borra por la API (`DELETE FROM projects`): la baja en cascada le quita su última fila y queda exento | **Se podía** (reproducido a mano en la base sin la migración) | `ASIGNACION_PROPIA_NO_PERMITIDA`; si le queda otra asignación, el borrado sí procede (D-5). **Dos sesiones a la vez** también están cerradas (F1, candado por persona) |
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
| Trigger `trg_asignacion_propia` (BEFORE INSERT OR UPDATE OR DELETE) | Defensa en profundidad: con sesión de la API (`auth.uid()` no nulo), tocar una fila propia exige ser propietario o superadministrador, o `ASIGNACION_PROPIA_NO_PERMITIDA` (`insufficient_privilege`). Si una política permisiva futura reabriera el hueco, esto lo sigue cerrando. `service_role` y superusuario (`auth.uid()` nulo) pasan. **`COALESCE` en los dos lados** de la condición (F3): una sesión sin fila en `app_users` tiene rol `NULL` y antes el `IF` daba `NULL` y no levantaba (fallaba abierto). **Excepción**: la baja *en cascada* por borrar el proyecto (la fila padre ya no existe) se permite si la persona conserva otra asignación (D-5); esa comprobación se **serializa por persona** con `pg_advisory_xact_lock(hashtextextended('asg:' \|\| user_id, 0))` en una sentencia **propia y anterior** (F1) |
| Privilegios | `anon`: ninguno. `authenticated`: sin `TRUNCATE`, `TRIGGER` ni `REFERENCES`; **su `SELECT`/`INSERT`/`UPDATE`/`DELETE` no se tocan** (la migración ni los concede ni los quita; la RLS los gobierna donde existen). La misma higiene que `20261026000200` (compras y contabilidad) |
| Pre-vuelo | Exige las funciones, tablas, roles (`anon`, `authenticated`, `service_role`) y `auth.uid()` que da por existentes y que quien corre sea el **propietario** de la tabla (o miembro de su rol). **Bloquea la tabla** (`LOCK TABLE … ACCESS EXCLUSIVE`, bajo el `lock_timeout`) y **solo después** guarda conteo, huella md5 ordenada de `(id, user_id, project_id, permission_type)` y el DML que `authenticated` tiene hoy; informa (sin fallar) de huérfanas, cruces de empresa y administradores sin filas |
| Post-vuelo | Exige conteo y huella **idénticos**; las 4 políticas, los 2 triggers, las 3 funciones y su `EXECUTE` (las de trigger, para nadie); `anon` sin ningún privilegio (ni siquiera `MAINTAIN`); `authenticated` sin `TRUNCATE`/`REFERENCES`/`TRIGGER` y con el **mismo** DML que tenía. Si algo no se cumple aborta, con la ACL en el mensaje, y la transacción no deja nada |
| Transacción | `BEGIN … COMMIT`, `SET LOCAL lock_timeout = '5s'`, `SET LOCAL statement_timeout = '60s'`, idempotente |

### Qué supone la migración del entorno (revisado línea por línea tras el P0)

| Suposición | Antes | Ahora |
|---|---|---|
| `authenticated` tiene `SELECT/INSERT/UPDATE/DELETE` sobre la tabla | **Exigida como absoluto** (era el P0) | **Relativa**: el post-vuelo exige lo mismo que había en el pre-vuelo |
| `anon` ya tenía privilegios que quitar | No se supone: `REVOKE ALL` y se exige que no quede ninguno (también por `aclexplode`, que ve `MAINTAIN`) | Igual, con la ACL en el mensaje de error |
| ACL por defecto de las funciones nuevas (en la preview solo `postgres=X`; en el arnés `GRANT ALL` a los tres roles; en Supabase nuevo, además `PUBLIC=X`) | Cada función hace `REVOKE ALL … FROM PUBLIC, anon[, authenticated]` y `GRANT` explícito: converge igual en los tres casos | Igual, y el post-vuelo ahora **comprueba** el `EXECUTE` de las dos funciones de trigger (antes solo el de la regla) |
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
reiniciar esa rama** (a diferencia de la del #926, cuyo archivo `0800` ya estaba registrado con otro contenido).

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
| F-04 | Un administrador acotado puede crear un administrador nuevo (`create-user`/`invite-user`) y éste nace exento | media | **Documentado** (el alcance por proyecto no es un límite contra un administrador hostil) | D-2, «Otros caminos» |
| F-03 | **Cambio de flujo legítimo**: el administrador acotado que crea un proyecto ya no puede asignárselo | media | **Documentado; decisión D-9** (recomendación: aviso) | «Cambio de flujo» |
| F2 | Colusión de dos administradores acotados | media | **Documentado; decisión D-2** (regla propuesta, sin aplicar) | probada en una copia: ver D-2 |
| F5 | Bloqueo `ACCESS EXCLUSIVE` con una transacción larga: hasta 5 s de parón de las lecturas con RLS | baja | **Procedimiento de despliegue** | «Orden y pasos de despliegue» |
| F6 | `FOR SHARE` del trigger de integridad bloquea altas mientras alguien edita su propia fila de `app_users`; posibles deadlocks en transacciones de varias sentencias | baja | **Aceptado** | D-13 |
| F7 | Cambio de empresa posterior a la asignación deja filas cruzadas | baja | **Documentado** (D-7) | |
| F8 | En PG17 `authenticated` conserva `MAINTAIN` | info | **No se revoca**, por qué: D-14 | |

## Cambio de flujo legítimo (F-03): el administrador acotado que crea un proyecto

La interfaz ofrece «Nuevo Proyecto» a quien llega a `/empresa` y la política `projects_insert` deja crear a `admin` y
`company_owner`. Antes de esta migración, un administrador **acotado** (hoy: el único administrador de producción, con 3
proyectos) creaba un proyecto, **no lo veía** (su alcance es por asignación) y se lo asignaba a sí mismo desde «Acceso» en su
propia fila. **Después de la migración eso ya no es posible** (es justo la autoasignación que se cierra): el proyecto existe
pero él no lo ve, y quien debe asignárselo es el propietario, el superadministrador u otro administrador. Medido en la base con
la forma de producción: tras crear el proyecto, `can_access_project(nuevo)` es `false` para él; antes, su `INSERT` en
`user_project_assignments` pasaba sin error; ahora falla con `ASIGNACION_PROPIA_NO_PERMITIDA`.

| Opción | Qué | Coste | |
|---|---|---|---|
| (a) **Aviso en pantalla** | Al crear un proyecto siendo administrador acotado: «Pídele al propietario que te lo asigne» | Una línea de interfaz; ningún cambio de seguridad | **Recomendada** |
| (b) Trigger `AFTER INSERT ON projects` (`SECURITY DEFINER`) que asigne el proyecto nuevo a su creador acotado | Amplía su alcance solo con lo que él mismo creó | Una pieza más de servidor que escribe la tabla; hay que probarla (también con `service_role`) | No implementada |
| (c) Solo el propietario crea proyectos | Cambia `projects_insert` y la pantalla | Quita una capacidad a los administradores | No implementada |

**Decisión D-9.** No se implementa ninguna: es una decisión de producto. Mientras no se tome, el administrador acotado que cree
un proyecto tendrá que pedirlo (el aviso (a) lo hace explícito).

## Qué NO cambia

* **Las filas**: ni una; conteo y huella idénticos antes y después (la migración lo comprueba y aborta si no).
  Las 10 huérfanas se conservan; no se «arreglan» ni se borran.
* La política **SELECT** (cada persona lee las suyas), `permission_type` (hoy todas `total`; ninguna política,
  función ni pantalla lo lee para decidir acceso), y `user_has_project_access`, `can_access_project`,
  `user_is_project_exempt` y todas las políticas de otras tablas.
* Lo que pueden hacer propietario, superadministrador y administradores sobre **otras** personas de su empresa
  (los 23 flujos legítimos de la pantalla que se probaron dan el mismo resultado antes y después).
* **Excepción conocida a esa frase**: el flujo «administrador acotado crea un proyecto y se lo asigna» sí cambia (F-03, arriba).

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
por diferencias) con sesiones autenticadas simuladas:

| # | Flujo | Resultado |
|---|---|---|
| 1 | Administrador **exento** reemplaza a otra persona de su empresa | Igual que antes |
| 2 | Administrador **acotado** reemplaza a otra persona con proyectos que él ve; lo que no ve sobrevive | Igual que antes |
| 3 | **Propietario** reemplaza a cualquiera de su empresa y **a sí mismo** | Igual que antes |
| 4 | **Superadministrador** (`super_admin` y `superadmin`) administra cualquier empresa | Igual que antes |
| 5 | Un administrador cambia el alcance de **otro administrador** (también lo deja sin filas) | Igual que antes (D-2) |
| 6 | Propietario de otra empresa administra la suya | Igual que antes |
| 7 | Cada persona **lee** solo lo suyo; el administrador acotado, las filas de sus proyectos | Igual que antes |
| 8 | `service_role`: sembrado que borra y vuelve a insertar, `UPSERT … ON CONFLICT (user_id, project_id)` | Igual que antes |
| ✗ | Autoedición (operador, administrador acotado o exento sobre sí mismo): 5 flujos | **Cambian**, a propósito: no escribe nada y devuelve error (o 0 filas) |

De los 28 flujos de la suite, **23 dan exactamente el mismo resultado antes y después** y cambian solo los 5 de
autoedición (`run.sh` lo compara automáticamente). Las escrituras de los scripts de siembra son compatibles:
`scripts/seed-rls-sandbox.mjs` converge con el cliente de servicio (borra y hace `upsert`) y
`scripts/rls-evidencias-datos.sql` asigna personas y proyectos de la misma empresa (se ejecutaron sus `INSERT`
contra una base con la migración puesta: 4 filas, sin error). El flujo «administrador acotado crea un proyecto y se lo
asigna» **no está entre los 28** y es el que cambia (F-03).

## Interfaz

Se corrigieron F-01, F-02, F-05, F-06 y F-07 (`AsignacionModal.tsx`, `EmpresaUsuariosSection.tsx`,
`domain/empresa/usuarios.ts`):

* **Autoedición**: en la fila del propio administrador el botón «Acceso» queda deshabilitado, con el texto
  «Tus proyectos los cambia otro administrador, el propietario o el superadministrador»; si aun así se abriera el
  modal, «Guardar» está deshabilitado con «No puedes cambiar tus propios proyectos…». Propietario y superadministrador
  (`super_admin` y `superadmin`) sí pueden. El servidor es el que manda; esto solo evita ofrecer lo que será rechazado.
  **`actor` es obligatorio** en `AsignacionModal` (un llamador que lo omitiera no tendría compuerta; ahora es un error de tipos,
  probado con `@ts-expect-error`).
* **Conjunto inicial y diferencia de tres vías** (F-01, F-02). El modal guarda lo que había **al abrir**. La diferencia ya no se
  calcula contra una lectura nueva al guardar sino contra ese conjunto: `insertar = deseadas ∖ inicial`,
  `borrar = (inicial ∖ deseadas) ∩ proyectos que la pantalla muestra`. Así solo se escribe lo que la persona cambió y **dos
  administradores a la vez no se deshacen el trabajo** (sondas S4: «el otro añadió p3, éste quita p2» ⇒ p3 sobrevive; S5: «el otro
  quitó p2, éste añade p3 con p2 aún marcado» ⇒ p2 no resucita; ambas son ahora pruebas de vitest). Una asignación a un proyecto
  que la pantalla no lista se conserva (S8).
* **Lectura inicial fallida** (F-01, S6): se muestra el error («No se pudieron cargar las asignaciones actuales…») con
  «Reintentar», no se pintan casillas y **«Guardar» queda deshabilitado**: nunca se borra por una lectura fallida (antes: las
  casillas salían vacías, «Guardar» activo y, sin tocar nada, se borraba todo lo editable).
* **`guardar()` con `try/catch`** (F-05, S2): una excepción de red ya no deja un rechazo sin manejar ni un botón en «Guardando…»;
  `guardarAsignacionesProyecto` tampoco lanza (devuelve `{ error, parcial }`).
* **Fallo parcial** (F-06, S3): si el insert valió y el borrado (o la lectura de comprobación) falló, el aviso dice «Se aplicó una
  parte de los cambios y otra no. Vuelve a guardar para completar el resto», la lista de atrás se recarga (`onReload`) y el
  diálogo sigue abierto. Reintentar converge porque se calcula otra vez contra el **mismo** conjunto inicial (idempotente).
* **Guardado por diferencias** (`guardarAsignacionesProyecto`): **inserta primero** lo que falta (`ON CONFLICT DO NOTHING`:
  `ignoreDuplicates`), **después** borra solo lo que sobra, y lee de vuelta. Se justificó con la prueba: (i) con «borrar todas +
  insertar», si el insert falla la persona se queda con **cero** asignaciones (`[flujo 9]`: `|42501|0`), y un administrador sin
  filas es exento; por diferencias un insert fallido no borra nada (`P2,P3|42501|2`); (ii) las filas que no cambian se
  **conservan** con el mismo `id`, `created_at` y `permission_type` (antes se recreaban como `total`: `[flujo 1]` 0 conservadas
  frente a 2); (iii) la RLS puede filtrar un `DELETE` y contestar 0 filas **sin error**: la lectura posterior lo detecta y la
  pantalla ya no dice «guardado».
* `deleteUserProjectAssignments` e `insertUserProjectAssignments` quedan `@deprecated` (la pantalla ya no las usa; sus pruebas
  existentes se conservan).
* **Mutantes de interfaz** (F-07): se aplicaron a mano y ahora mueren: no pasar la lista editable al guardar (el proyecto oculto se
  borraría), `ignoreDuplicates: false`, no deshabilitar «Guardar» tras una lectura fallida, calcular contra una lectura nueva,
  quitar el `try/catch` del modal.

## Resultados de las pruebas

Suite `supabase/tests/asignaciones_proyecto/run.sh` (PostgreSQL 16 real, cadena de 557 migraciones anteriores, cableada
en `coverage.yml`, puerto 55532):

| Bloque | Resultado |
|---|---|
| Datos como producción | 43 filas · 27 usuarios · 10 huérfanas; huella md5 `(id, user_id, project_id, permission_type)` y de **todas** las columnas idénticas antes/después; las 43 coinciden fila a fila con la copia original; `user_is_project_exempt()`, `can_access_project()` (39 personas × 10 proyectos = 390 pares) y lo que cada persona lee **de la tabla**: **0 diferencias** (19 comprobaciones) |
| Catálogo y privilegios | 33 comprobaciones: 4 políticas con los nombres de siempre, SELECT idéntica a producción, 2 triggers por fila BEFORE, 3 funciones `SECURITY DEFINER` con `search_path` vacío, `EXECUTE` solo para quien debe, el candado por persona y el `COALESCE` en su sitio, `anon` sin ningún privilegio, `authenticated` sin `TRUNCATE`/`TRIGGER`/`REFERENCES`, `TRUNCATE` como `authenticated`/propietario/superadministrador falla con `permission denied` |
| Matriz rol × operación × objetivo | **148 casos** (INSERT, UPDATE, DELETE, UPSERT y `INSERT … SELECT`; super_admin/superadmin, propietario, administrador exento, administrador acotado, operador, visor, cliente, sin `app_users`, sin empresa, administrador/propietario/operador de otra empresa, `anon`, `service_role`, superusuario; filas propias y ajenas; proyectos propios, ajenos, de otra empresa y que el administrador no ve; personas de la empresa, de otra empresa, huérfanas, sin empresa e inexistentes; `UPDATE` que cambia `user_id` a sí mismo y `project_id` a otra empresa). Cada «no debe pasar» comprueba **código y mensaje**, que la tabla no cambió y que la **misma sentencia como SISTEMA sí funciona** (el cero no es un `WHERE` equivocado) |
| Flujos legítimos | 41 comprobaciones (28 flujos de pantalla + 13 lecturas/servicio) |
| Alcance | 24 comprobaciones: **290/290** intentos de autoasignación (29 personas × 10 proyectos) bloqueados con 42501/23514 (94 por integridad de empresa, 196 por el trigger de autoasignación); **84/84** intentos de borrar/cambiar lo propio afectaron 0 filas; el alcance de las 33 personas no se movió; ningún administrador acotado se vuelve exento; el borrado en cascada de un proyecto al que está asignado procede si le queda otra asignación y se rechaza si sería la última |
| Capas por separado | 28 + 37: las **políticas solas** (sin triggers) ya cierran el hueco; los **triggers solos** (con una política `true`, y con una permisiva `zz` añadida a las verdaderas) también, incluida la sesión sin `app_users` (F3) y borrar UNA fila propia (F-08) |
| Control negativo | Sin la migración: matriz **73 rojos / 75 verdes de 148**, y rojas `assert_alcance`, `assert_catalogo`, `assert_defensa`, `assert_capas` |
| Idempotencia | 2ª pasada limpia; huella del catálogo de `public` idéntica (3363 grupos, 0 diferencias); la migración cambia **9** grupos de la huella |
| Guardas | Pre-vuelo: con `can_access_project(uuid)` ausente aborta («faltan can_access_project(uuid)») y no deja ninguna pieza. Post-vuelo: si la migración cambiara **una** fila aborta («las filas … CAMBIARON») y la transacción no deja nada. `lock_timeout`: con una transacción larga sobre la tabla falla en 5 s sin dejar piezas y, reintentada, se aplica |
| **4c · ACL de Supabase Preview y de producción** | La migración se aplica **como un rol no superusuario con `BYPASSRLS`** con la ACL de la preview (`authenticated` sin DML: lo deja sin DML) y con la de producción (lo deja con DML); control negativo con el post-vuelo absoluto (aborta en la preview, pasa en producción); `assert_acl.sql` (10 comprobaciones por base) y, sobre la base de producción con ese propietario, **toda** la batería (311 comprobaciones: 33 + 148 + 41 + 24 + 28 + 37); la reversión es relativa (a `authenticated` solo le devuelve `TRUNCATE/TRIGGER/REFERENCES`) y deja el catálogo **exacto** con el propietario no superusuario (3357 grupos, 0 diferencias, ACL incluida) |
| Reversión | `scripts/reversion-asignaciones-proyecto.sql` dos veces: huella del catálogo de `public` **idéntica** a la de antes de la migración (**0 diferencias en 3357 grupos**), `pg_get_expr` de las 4 políticas idéntico (md5 por política), 43 filas intactas, la matriz vuelve a **73 rojos**; reaplicar la migración deja el catálogo idéntico al de la migración |
| Mutaciones | **21** (16 de catálogo + 4 de concurrencia + 1 de privilegios). De catálogo: las 13 de la primera ronda (cada política revertida a mano, la regla «concede todo», sin exclusión de sí mismo, sin «proyectos que ve», sin «persona de la empresa», sin cada trigger y deshabilitado, privilegios devueltos, SELECT que pierde las propias, el revert completo) más 3 nuevas obtenidas **mutando la función de la propia migración**: F-08 (cascada sin comprobar que el proyecto ya no existe), F3 (sin `COALESCE`) y F1 (sin el candado). De concurrencia: sin `FOR SHARE` (D0), sin el candado por persona y con el candado dentro del `AND` (F1), sin el `LOCK TABLE` inicial (F4). De privilegios: el post-vuelo con el DML como absoluto. **En todas alguna aserción se pone en rojo** (la lista de archivos rojos por mutación sale en el log). La cifra se cuenta al ejecutar cada mutación; la anterior («14») salía de un `grep -c` que contaba también su propia línea de resumen (eran 13) |
| Concurrencia | Sesiones reales **sincronizadas sin ninguna espera fija** (un candado «puerta» que toma una sesión de control y la observación de `pg_stat_activity.wait_event_type = 'Lock'`; cada caso comprueba además si la 2ª sesión terminó o quedó esperando): dos administradores sobre la misma persona (proyectos distintos: unión `{P4,P5,P6,P7}` sin duplicados ni deadlock; solapados: gana el primero, el segundo recibe `duplicate key` 23505 limpio; por diferencias: sin error y la fila que no cambió conserva su id); una autoasignación mientras otro administrador asigna; un administrador acotado que intenta ampliarse mientras otro escribe a un tercero; el cambio de empresa de la persona o del proyecto concurrente con la asignación (D0: sin `FOR SHARE`, 1 fila cruzada; D1/D2: con el candado, 0 y `ASIGNACION_EMPRESA_DISTINTA`); **F1**: dos sesiones borran cada una uno de los dos únicos proyectos de un administrador acotado (con el candado: la 2ª espera, recibe `ASIGNACION_PROPIA_NO_PERMITIDA` y queda 1 fila y no exento; sin él: 0 filas y exento); **F4**: una escritura legítima llega con la migración parada tras su pre-vuelo (espera; la migración pasa; 44 filas) |
| Diagnóstico | `scripts/diagnostico-asignaciones-proyecto.sql`: una sentencia, corre con `default_transaction_read_only=on` (un `DELETE` ahí falla), señala «EL HUECO» antes y «corregida» después, la sección «tabla» es idéntica |

Total de la suite: **661 comprobaciones ✓** (330 del flujo principal —19 + 33 + 148 + 41 + 24 + 28 + 37—, 10 de `4c(a)` y 321 de `4c(b)`
—10 + 33 + 148 + 41 + 24 + 28 + 37—), más el control negativo, la idempotencia, las dos guardas, el `lock_timeout`, la reversión, las 21
mutaciones, la concurrencia y el diagnóstico. En el paso 7 de `run.sh` sobre el árbol del #926 (con las 10 migraciones de esa serie
aplicadas encima) son **850** (661 + matriz 148 + flujos 41).

**La suite pasó 3 veces seguidas sola (`rc` 0, 661 cada una, ≈97 s), una vez más con cuatro PostgreSQL desechables corriendo a la vez (4 de 4
con `rc` 0, 118 s), otra con la CPU saturada (cuatro procesos `yes`) y una más sobre el árbol del #926 (850).** Ningún caso de
concurrencia depende ya de un tiempo: el mismo resultado con la máquina cargada o no.

Vitest de la interfaz (`src/components/empresa` y `src/domain/empresa`): **180 pruebas** (151 antes de esta ronda + 29 nuevas). De las
29 nuevas, **23 fallan** sobre el código de la ronda anterior (`1794dc8f`) y **todas pasan** con el cambio; las otras 6 son controles que
el código anterior también cumple. En el PR entero las pruebas nuevas de interfaz son 67: `AsignacionModal` 30, `AsignacionModal.excepcion` 2,
`EmpresaUsuariosSection.acceso` 4, `asignacionesProyecto` 19 y `guardarAsignaciones` 12.

## Barrido de regresión

Todas las suites `supabase/tests/*/run.sh` (63) con la migración puesta, frente a `origin/main` sin ella, cada una en su propio
PostgreSQL desechable (mismo comando, puerto propio), **en la primera ronda**:

| | Resultado |
|---|---|
| `origin/main` sin la migración | **63/63 suites en verde** (`rc=0`), `compras_bloque_b` incluida |
| Con la migración (y la suite nueva) | **64/64 en verde** (las 63 anteriores + `asignaciones_proyecto`) |
| Mismo resultado archivo por archivo | 63/63: mismo `rc`, mismo número de `✓` y de `ERROR`. 57 logs idénticos tras normalizar rutas, puertos, tiempos y hashes; 3 difieren en 2 líneas (la ruta del script dentro de un `NOTICE`); 3 (`compras_bloque_b`, `compras_cierre_tecnico`, `proveedores_pr_a`) tienen exactamente **una** línea `✓ migrations-append-only` más, porque esa guarda corre en el árbol de trabajo y se omite en la copia extraída de `origin/main` |

**En esta ronda** (la migración cambió; el resto de suites no): se volvieron a correr, con la migración corregida, las 20 suites
que escriben o leen la tabla —`balance_jornada`, `conta_ajustes`, `conta_auxiliares_tipo_cargo`, `conta_contabilizacion_cargos`,
`conta_pagador_designado`, `conta_pendientes_reproceso`, `notificaciones_actividad`, `personal_usuario`, `politica_jornada`,
`presencia_correccion`, `presencia_marcaje`, `presencia_pausas`, `proteger_update_registros`, `proveedores_pr_a`, `registrar_lectura`,
`rutas_operadores`, `rutinas_limpieza`, `tareas_bloque_paridad`, `turnos` y `webhook_stripe_idempotencia`— y, sobre el árbol del #926 con la
migración en su sitio, `asignaciones_proyecto`, `compras_bloque_b`, `compras_cierre_tecnico` y `compras_flujo`. Resultado: **20 de 20 en
`rc` 0** y **4 de 4 en `rc` 0** (`compras_bloque_b` 985 ✓). Una salvedad honesta: `webhook_stripe_idempotencia` falló cuatro veces con
`pg_ctl: could not start server` (el puerto del trabajador seguía ocupado por el clúster de la suite anterior: un artefacto de mi lanzador,
que reintenta, no de la migración) y pasó a la primera en un puerto libre; `presencia_correccion` necesitó un reintento por lo mismo.

Las tres pruebas `node` de replay de `supabase/tests` (`replay_acl_helpers/run.mjs`, `declarar_triggers_fill_company_id/replay.mjs`,
`cumplimiento_calidad_firma_inequivoca/replay.mjs`) también salieron en verde con la migración (primera ronda).

**Combinación con el #926.** La rama del #926 está en `f3f01a2a` (SHA vigente en `origin`; las pruebas de esta ronda
usaron su árbol `edaab0c4`, del que `f3f01a2a` difiere solo en dos documentos: `docs/COMPRAS_CONTROLES_SERVIDOR.md` y un
`README`; ningún `.sql` ni `.sh`). Con esta migración en su sitio, entre `20261026000500` y `20261027000000`: `asignaciones_proyecto`
en verde con las **10 migraciones del #926 aplicadas encima** (paso 7 de `run.sh`), `compras_bloque_b`, `compras_cierre_tecnico`
y `compras_flujo` en verde. La primera ronda encontró un conflicto real con el diseño inicial del trigger de autoasignación (que
también rechazaba la baja en cascada): rompía `compras_bloque_b/hallazgos/DEP-5.sql`, que exige que un administrador asignado a un
proyecto pueda eliminarlo. Ver D-5.

## Riesgos residuales y decisiones abiertas

| # | Qué | Estado |
|---|---|---|
| D-1 | Un administrador **acotado** solo reparte los proyectos que él ve, como hoy. Si el negocio quiere que reparta cualquier proyecto de su empresa, hay que quitar la condición de visibilidad **y** cambiar el guardado de la pantalla (si no, borraría lo que no ve) | Decidido (igual que antes); abierta si se quiere otra cosa |
| D-2 | **El alcance por proyecto no es un límite real contra un administrador hostil.** (i) **Colusión (F2)**: un administrador acotado puede dejar exento a otro («Marco borra la fila de `adm2` en P1 y éste queda exento; `adm2`, ya exento, borra las 3 de Marco»: ninguna autoedición, así que el trigger no interviene), o acotar al jefe exento. (ii) **Creación (F-04)**: `create-user` e `invite-user` dejan a un administrador crear **otro administrador** (`ALLOWED_ROLES_FOR_NON_SUPER` / `INVITABLE_ROLES` incluyen `admin`); el nuevo nace **sin filas, es decir exento**, y quien lo crea conoce sus credenciales (`create-user`) o controla el correo de la invitación. **Regla propuesta, SIN aplicar**: «un administrador no administra (ni borra ni mueve) filas de personas con rol `admin`, `company_owner` o `super_admin`/`superadmin`» —una condición más en `asignacion_puede_administrar`. Probada en una copia, no aplicada: cambia exactamente **4 casos de la matriz** (B2, C4 ×3) y los 2 resultados del [flujo 5]; los otros 144 casos y 26 flujos quedan idénticos. **Por qué no se aplica**: quita a los administradores la colaboración que hoy ofrece la pantalla (flujo 5) y el negocio no la ha pedido; **y no cierra (ii)**, que necesita cambiar las edge functions (que solo el propietario y el superadministrador creen administradores, o que el nuevo herede las asignaciones de quien lo crea). Mitigación sin código: auditar quién crea administradores | **Decisión de negocio** |
| D-3 | **Filas huérfanas** (10, de 6 usuarios que ya no existen en `app_users`): no son administrables por un administrador ni por el propietario, solo por el superadministrador o el rol de servicio; no se borran ni se «arreglan». Siguen dando `can_access_project` a un `user_id` que ya no existe (inofensivo mientras ese id no vuelva a existir) | Propuesta aparte: confirmar los 6 ids y borrarlos con el superadministrador |
| D-4 | `permission_type`: nada lo lee para decidir acceso (las 43 son `total`). La regla no lo distingue; la pantalla escribe `total` en las filas nuevas y conserva el de las existentes | Sin acción |
| D-5 | **Diferencia con el diseño inicial, justificada con una prueba**: el diseño del trigger de autoasignación rechazaba también la baja *en cascada* de la fila propia. Al probar la combinación con el árbol del #926 eso rompía `compras_bloque_b/hallazgos/DEP-5.sql`, que comprueba que un administrador asignado a un proyecto **puede eliminarlo** (sus órdenes de pago quedan sin proyecto). Ahora la cascada se permite si la persona conserva **otra** asignación (su alcance solo se reduce) y se rechaza si fuera la **última** (quedaría sin filas y, siendo administrador, exento): `[alcance 3]`. La comprobación está **serializada por persona** (F1: sin el candado, dos borrados simultáneos de sus dos únicos proyectos lo dejaban con cero filas). La pantalla no ofrece borrar proyectos | Decidido |
| D-6 | Si el **propietario o el superadministrador** borra el último proyecto de un administrador acotado, éste queda sin filas y por tanto exento (`[alcance 3]`). Es una decisión de quien borra, no del administrador | Riesgo residual; mitigación posible: aviso en la pantalla |
| D-7 | El trigger de integridad valida **al escribir**. Carrera reproducida y cerrada en un orden: sin candado, un cambio de empresa de la persona (o del proyecto) concurrente con su asignación dejaba **1 fila cruzada** (`D0` de la suite); con `FOR SHARE` la asignación espera y recibe `ASIGNACION_EMPRESA_DISTINTA` (`D1`, `D2`: 0 filas cruzadas). **No cubre el orden inverso** (F7): si la asignación va primero y el cambio de empresa después, o si se cambia la empresa de una persona o proyecto que **ya tiene** asignaciones, no hay trigger en `app_users`/`projects` y quedan filas cruzadas (la persona queda con una fila en un proyecto de la empresa de antes y `can_access_project` sigue dando `true`). Solo el superadministrador puede cambiar el `company_id` de otra persona (propietario y administrador no: `WITH CHECK`) | Hoy: 0 cruces. La sección «cruces» del diagnóstico las cuenta. Posible cierre: trigger `AFTER UPDATE OF company_id` en `app_users`/`projects` que rechace o limpie |
| D-8 | `service_role` ya no puede asignar entre empresas (la integridad vale para todo actor). Si soporte lo necesitara, `ALTER TABLE … DISABLE TRIGGER trg_asignacion_empresa` en una transacción corta y con registro | Documentado |
| D-9 | **Cambio de flujo (F-03): el administrador acotado que crea un proyecto ya no puede asignárselo.** Opciones (a) aviso en pantalla, (b) trigger `AFTER INSERT ON projects` que asigne el proyecto nuevo a su creador acotado, (c) solo el propietario crea proyectos. Ver «Cambio de flujo legítimo» | **Decisión de producto**; recomendación (a). No se implementa ninguna |
| D-10 | No se comprobó, política por política, que cada una de las **77** que nombran la asignación o sus helpers (70 en `public`, 7 en `storage`) exija bien la empresa (solo que la mencionan) | Auditoría aparte |
| D-11 | La regla mira solo `app_users.role` (`company_owner`, `admin`, `super_admin`, `superadmin`), como la política anterior; los roles RBAC personalizados no administran asignaciones | Sin cambio |
| D-12 | **Deuda previa de la cadena de migraciones** (P0): en una base construida solo con migraciones `authenticated` no tiene DML sobre esta tabla (ver «Lección de ACL»). Esta migración no lo arregla ni lo oculta | PR aparte: declarar los privilegios que debe tener `authenticated` en una base nueva |
| D-13 | **`FOR SHARE` en el trigger de integridad (F6)**: bloquea una alta mientras alguien edita su propia fila de `app_users` en una transacción abierta (medido: una asignación esperó 3,07 s a que la otra transacción terminara; el `DELETE` no espera). En una carga mixta artificial de transacciones de varias sentencias (6–8 clientes) hubo 2 deadlocks en ~3100 transacciones en una corrida y 0 en ~18 000 en seis repeticiones; **sin** la migración la misma carga dio 3–5 por corrida (por la autoedición). Ninguna fila duplicada ni cruzada. Por PostgREST (una sentencia por transacción) el riesgo es mínimo. `FOR KEY SHARE` no chocaría con un `UPDATE` de columnas que no son clave, pero habría que validar que siga cerrando la carrera D1/D2 antes de cambiarlo | Aceptado |
| D-14 | **`MAINTAIN` en PG17 (F8)**: `REVOKE TRUNCATE, TRIGGER, REFERENCES … FROM authenticated` deja `authenticated` con `arwm` (la `m` es `MAINTAIN`). **No se revoca** porque es inocuo por la API: PostgREST no emite `VACUUM`/`ANALYZE`/`REINDEX`/`CLUSTER`/`REFRESH`/`LOCK TABLE`, y `LOCK TABLE … ACCESS EXCLUSIVE` ya era posible con solo `UPDATE`/`DELETE` (probado) sin que sea alcanzable desde la API; `anon` sí pierde `MAINTAIN` (`REVOKE ALL`). Revocarlo exigiría una rama por versión (en PG15/16 el privilegio no existe y la sentencia falla). Las comprobaciones de privilegios usan listas explícitas, así que ignoran `MAINTAIN` por construcción | Aceptado; no probado en PG17 |

## Otros caminos hacia el mismo efecto (se buscaron; no se corrigen aquí)

* **Cambiarse el rol, la empresa o el proyecto principal en `app_users`**: no se puede. La política `app_users_update`
  deja actualizar la propia fila, pero `trg_lock_app_users_self_privilege` restituye `role`, `company_id`,
  `cliente_id`, `project_id`, `activo` y `permission_type` (`[otros caminos]` de `assert_alcance.sql`: un operador y un
  administrador acotado intentan «promoverse» y la fila queda igual). `user_has_project_access()` también lee
  `app_users.project_id`, por eso importa que ese trigger esté.
* **Crear un administrador nuevo (F-04)**: **sí se puede, y esquiva el alcance.** Un administrador (acotado o no) puede crear
  un usuario de rol `admin` con la edge function `create-user` o invitarlo con `invite-user` (`supabase/functions/create-user/validate.ts`,
  `ALLOWED_ROLES_FOR_NON_SUPER`; `invite-user/validate.ts`, `INVITABLE_ROLES`). Nadie le asigna filas, así que el administrador
  nuevo es **exento** (ve toda la empresa). La inserción directa en `app_users` por un administrador sí falla por RLS: solo es
  posible por las funciones de borde. **Esta migración no lo cambia** y por eso la frase de cabecera acota lo que se logra
  (D-2). No se ejecutaron las funciones (Deno): se leyó el código.
* **Colusión de dos administradores (F2)**: ver D-2.
* **Borrar el último proyecto** (baja en cascada de la fila propia): era un camino real para un administrador (la
  política `projects_delete` se lo permite; reproducido a mano en la base sin la migración: la cascada le quita su última
  fila y `user_is_project_exempt()` pasa a `true`); lo cierra el trigger de autoasignación solo cuando sería su última
  fila (D-5), también con dos sesiones a la vez (F1). Con el propietario o el superadministrador no es una escalada, es una
  decisión suya (D-6).
* **Crear un proyecto nuevo** en su empresa: no da acceso a él (no hay asignación automática) y la regla no deja asignárselo:
  es un **cambio de flujo** (F-03, D-9).
* No se encontró ninguna función de `public`, migración ni edge function que escriba la tabla.

## Orden y pasos de despliegue

`apply-migrations-prod.yml` tiene `MAX_APPLY = 10` por push y aplica solo los `.sql` añadidos en ese push, por orden
de versión. Por eso **cada PR va en su propio push a `main`**, sin undécima migración en el #926 y sin subir el tope:

1. **Este PR** (`20261026000600`, versión > `20261026000500`, el máximo de producción, y < `20261027000000`, la primera del #926).
2. Después el **#926** (10 migraciones `20261027000000 … 20261027000900`).
3. Después el futuro PR de alcance por proyecto (`20261027001000`) y, por último, el **#927** (`20261028000000`).

Si el #926 se fusionara antes, esta migración quedaría *intercalada* (versión menor que una ya aplicada): el auditor de
drift fallaría y habría que renumerar. Se verificó que **la combinación** funciona: el árbol del #926 con esta migración
intercalada en su sitio, con la suite de este PR aplicando encima las 10 migraciones del #926 (paso 7 de `run.sh`), ver
«Barrido de regresión».

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
2. Fusionar este PR **solo**. El apply toma una tabla de 43 filas. Si hubiera una transacción larga sobre la tabla falla limpio
   (`55P03`, «canceling statement due to lock timeout»), **sin piezas a medias** (probado: 0 funciones tras el fallo), y el
   workflow es *fail-fast*, **sin reintento automático**: se relanza a mano con **`workflow_dispatch`** de
   `apply-migrations-prod.yml`, campo `migration_file` = `20261026000600_seguridad_asignaciones_proyecto.sql` (el modo sin
   archivo reconcilia *todas* las pendientes: no usarlo aquí).
3. **Después**: volver a correr el diagnóstico. La sección «tabla» (filas, usuarios, huella) debe ser **idéntica**;
   «estado» debe decir «corregida» en INSERT/UPDATE/DELETE, 2 triggers, 3 funciones, `anon` sin privilegios,
   `authenticated` sin `TRUNCATE`/`TRIGGER`/`REFERENCES` y con **el mismo DML que antes**. Prueba funcional sugerida en el
   sandbox existente, con una sesión de operador: un `POST` a `user_project_assignments` con su propio `user_id` debe responder 42501.
4. **Recapturar `scripts/schema-drift/huella-produccion.json`** (no se edita a mano): cambian los grants, las políticas y los
   triggers de la tabla y hay tres funciones nuevas (9 grupos). El auditor lo mostrará en rojo en `main` hasta entonces:
   `node scripts/schema-drift/auditar.mjs --base origin/main` en este PR da **verde** («9 cambios planificados», rc 0) y
   `node scripts/schema-drift/auditar.mjs --base HEAD` (lo que ve `main` tras el apply, antes de recapturar) da **rojo**
   («DRIFT NUEVO — 9 grupos», rc 1). Se refresca con `scripts/schema-drift/fingerprint.sql` en el Editor SQL, según el README del auditor.
5. Solo entonces el #926, luego el PR de alcance por proyecto y por último el #927, cada uno en su push.

## Reversión

`scripts/reversion-asignaciones-proyecto.sql`: devuelve las cuatro políticas a su texto original, quita los triggers y las
funciones y restaura los privilegios (a `anon` los siete; a `authenticated` solo `TRUNCATE`, `TRIGGER` y `REFERENCES`: su
`SELECT`/`INSERT`/`UPDATE`/`DELETE` **no se tocan**, igual que la migración); idempotente; bloquea la tabla antes de medir; no toca
filas. **Probada**: deja el catálogo **exacto** (huella idéntica, 0 diferencias, ACL incluida) tanto con el propietario superusuario
del arnés como con un propietario **no superusuario con `BYPASSRLS`**, y migración → reversión → migración cierra el ciclo. En una
base que no tenía el DML de `authenticated` (como la preview) tampoco se lo inventa; a `anon` sí le devuelve los siete (los de
producción). **Quien revierte reabre el hueco.** Después hay que volver a recapturar la huella. Volver a aplicar la migración
(idempotente) lo cierra otra vez.

## Cómo reproducirlo

```bash
bash supabase/tests/asignaciones_proyecto/run.sh          # PGPORT_TEST=<puerto> para elegir el puerto del clúster desechable
npx vitest run src/domain/empresa src/components/empresa   # interfaz
node scripts/schema-drift/auditar.mjs --base origin/main   # auditor de drift (offline)
```
