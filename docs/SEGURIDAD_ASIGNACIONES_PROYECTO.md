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
crear un administrador nuevo (edge functions `create-user` / `invite-user`) y éste nace **exento**; dos
administradores acotados pueden dejarse exentos entre sí; y **cualquier administrador puede dejar exento a
OTRO administrador borrando por la API el último proyecto de éste** (`projects_delete` se lo permite y el
trigger de autoasignación solo vigila las filas propias: F2-03). Ver D-2, D-5, D-6 y «Otros caminos»; ninguno
de los tres se corrige aquí porque son decisiones de negocio.

## Historial de este PR

| Ronda | Qué pasó |
|---|---|
| 1 | Migración, suite contra PostgreSQL real, interfaz y documento (`0a8b3983`…`1794dc8f`) |
| 2 | **Supabase Preview** aplicó por primera vez la migración en una base construida solo con migraciones y la **abortó**: «privilegios de la tabla mal repartidos» (P0, ver «Lección de ACL»). Dos verificaciones independientes (ataque hostil y flujos/interfaz/CI) encontraron además una carrera real en la baja en cascada (F1) y varios defectos menores. Esta versión corrige todo lo corregible y deja el resto como decisión de negocio (`d1aeb94a`) |
| 3 | **Segunda verificación independiente** (ataque hostil; interfaz, pruebas y documento; paquetes del #926). Corrige la carrera de la baja en cascada **entre dos administradores que comparten proyectos** (R2-1: candado global), los post-vuelos que dependían del `search_path` de la sesión (R2-3), la interfaz tras un guardado parcial (F2-01), las pruebas de interfaz y de guardas que faltaban (F2-08, F2-09), el diagnóstico de `run.sh` (F2-10) y las frases inexactas del documento. Lo que no es técnico queda como decisión (F2-03, R2-2). Ver «Tercera ronda» |

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
| …un proyecto de **otra** empresa | **Se podía**: la fila se crea. El acceso efectivo a datos depende de que cada política pida además la empresa: **77 políticas** (70 de `public` y 7 de `storage`) nombran la asignación o sus helpers y **8 de ellas conceden por la asignación sola, sin condición de empresa** (R2-2, D-7, D-10): una fila cruzada equivale a **leer pagos y contadores, tarifas y unidades** de la otra empresa (medido con datos, ver abajo) | `ASIGNACION_EMPRESA_DISTINTA` (23514) |
| Un administrador acotado borra **sus** filas | **Se podía** (3 filas) y `user_is_project_exempt()` pasa de `false` a `true`: ve toda la empresa | 0 filas; sigue acotado |
| Cambiar su fila de proyecto, pasarla a otra persona, cambiar su `permission_type` | **Se podía** | 0 filas |
| Un administrador asigna a una persona de **otra** empresa, a una **huérfana** (`user_id` sin `app_users`), a alguien **sin empresa** o a un **cliente** | **Se podía** (la política solo miraba el proyecto, nunca a la persona) | `ASIGNACION_EMPRESA_DISTINTA` |
| Un administrador con un solo proyecto lo borra por la API (`DELETE FROM projects`): la baja en cascada le quita su última fila y queda exento | **Se podía** (reproducido a mano en la base sin la migración) | `ASIGNACION_PROPIA_NO_PERMITIDA`; si le queda otra asignación, el borrado sí procede (D-5). **Dos sesiones a la vez** también están cerradas, incluso de DOS administradores que comparten proyectos (F1, R2-1: candado **global** de bajas en cascada) |
| Un administrador borra por la API el último proyecto de **otro administrador**: la cascada deja a éste sin filas, es decir **exento** | **Se podía** | **Se puede** (F2-03): el trigger solo vigila las filas **propias** de quien borra. Decisión abierta (D-2, D-5, D-6); la regla propuesta en D-2 no lo cierra |
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
`app_users` (el trigger `lock_app_users_self_privilege` lo revierte: [alcance 5] de la suite); que `anon`
escriba (la RLS no tiene política para `anon`).

## Qué cambia

| Pieza | Detalle |
|---|---|
| `asignacion_puede_administrar(p_user_id, p_project_id)` | Regla única, `SECURITY DEFINER`, `STABLE`, `search_path` vacío; `EXECUTE` solo para `authenticated` y `service_role`. **Superadministrador** (`super_admin`/`superadmin`): cualquiera. **Propietario** (`company_owner`): persona **y** proyecto de su empresa, también a sí mismo (es exento). **Administrador** (`admin`): persona **y** proyecto de su empresa, **nunca a sí mismo**, y solo los proyectos que él ve. Cualquier otro rol: nada. «Persona de su empresa» = existe en `app_users` con su `company_id`. Devuelve siempre `true`/`false`, nunca `NULL` |
| Políticas INSERT, UPDATE (USING y WITH CHECK) y DELETE | Mismos nombres; las tres llaman a la regla. UPDATE comprueba la fila vieja **y** la nueva. Un `UPSERT` (`INSERT … ON CONFLICT DO UPDATE`) queda cubierto por INSERT y UPDATE |
| Trigger `trg_asignacion_empresa` (BEFORE INSERT OR UPDATE OF `user_id`, `project_id`) | **Para cualquier actor**, también `service_role` y superusuario: la empresa de la persona (`app_users.company_id`) debe existir y ser igual a la del proyecto, o `ASIGNACION_EMPRESA_DISTINTA` (`check_violation`). Valida solo lo que se escribe; no mira ni toca las filas existentes. Lee la fila de la persona y la del proyecto con `FOR SHARE`: si otra transacción está cambiando la empresa de cualquiera de las dos, la asignación espera y ve la empresa nueva |
| Trigger `trg_asignacion_propia` (BEFORE INSERT OR UPDATE OR DELETE) | Defensa en profundidad: con sesión de la API (`auth.uid()` no nulo), tocar una fila propia exige ser propietario o superadministrador, o `ASIGNACION_PROPIA_NO_PERMITIDA` (`insufficient_privilege`). Si una política permisiva futura reabriera el hueco, esto lo sigue cerrando. `service_role` y superusuario (`auth.uid()` nulo) pasan. **`COALESCE` en los dos lados** de la condición (F3): una sesión sin fila en `app_users` tiene rol `NULL` y antes el `IF` daba `NULL` y no levantaba (fallaba abierto). **Excepción**: la baja *en cascada* por borrar el proyecto (la fila padre ya no existe) se permite si la persona conserva otra asignación (D-5); esa comprobación se **serializa con un candado de aviso GLOBAL** de bajas en cascada, `pg_advisory_xact_lock(hashtextextended('asg-cascada', 0))` (una sola clave), tomado en una sentencia **propia y anterior** a cualquier lectura y para **toda** baja en cascada hecha con una sesión de la API, también la del propietario o la del superadministrador (F1, R2-1; coste y límites en D-15). El candado por persona de la ronda anterior se **retiró**: solo ordenaba a las sesiones de la misma persona y quedaba redundante (sólo se tomaba en rutas que ya pasan por el global) |
| Privilegios | `anon`: ninguno. `authenticated`: sin `TRUNCATE`, `TRIGGER` ni `REFERENCES`; **su `SELECT`/`INSERT`/`UPDATE`/`DELETE` no se tocan** (la migración ni los concede ni los quita; la RLS los gobierna donde existen). La misma higiene que `20261026000200` (compras y contabilidad) |
| Pre-vuelo | Exige las funciones, tablas, roles (`anon`, `authenticated`, `service_role`) y `auth.uid()` que da por existentes y que quien corre sea el **propietario** de la tabla (o miembro de su rol). **Bloquea la tabla** (`LOCK TABLE … ACCESS EXCLUSIVE`, bajo el `lock_timeout`) y **solo después** guarda conteo, huella md5 ordenada de `(id, user_id, project_id, permission_type)` y el DML que `authenticated` tiene hoy; informa (sin fallar) de huérfanas, cruces de empresa y administradores sin filas |
| Post-vuelo | Exige conteo y huella **idénticos**; las 4 políticas, los 2 triggers, las 3 funciones y su `EXECUTE` (las de trigger, para `anon` y `authenticated`: ver la fila de la ACL por defecto abajo); `anon` sin ningún privilegio (ni siquiera `MAINTAIN`); `authenticated` sin `TRUNCATE`/`REFERENCES`/`TRIGGER` y con el **mismo** DML que tenía. **Independiente del `search_path`** de la sesión (R2-3): las comprobaciones por texto de `pg_get_expr` aceptan `auth.uid()` y `uid()`. Si algo no se cumple aborta, con la ACL en el mensaje, y la transacción no deja nada |
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
| F-03 | **Cambio de flujo**: el administrador acotado que crea un proyecto **por la API** ya no puede asignárselo (en la pantalla ese flujo no existe: F2-02) | media | **Documentado; decisión D-9** | «Cambio de flujo (F-03)» |
| F2 | Colusión de dos administradores acotados | media | **Documentado; decisión D-2** (regla propuesta, sin aplicar) | probada en una copia: ver D-2 |
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
| R2-1 | **Carrera entre DOS administradores que comparten proyectos.** ADM1 y ADM2 con exactamente `{P1, P2}`: ADM1 borra P1 y ADM2 borra P2 a la vez. La cascada de cada sesión vacía **también la fila del otro** (la fila ajena no se comprueba) y el candado *por persona* de F1 no las ordena (claves distintas): ambos quedan con **0 filas y exentos**, un resultado que no equivale a ningún orden en serie (en serie, la 2ª recibe `ASIGNACION_PROPIA_NO_PERMITIDA` y ambos conservan `{P2}`) | baja (hacen falta dos cuentas de administrador, algo que D-2 ya permite) | **Corregido**: candado **global** de bajas en cascada, antes de calcular quién borra; el candado por persona se retira por redundante | `run.sh` R2-1 con sesiones reales sincronizadas sin tiempos fijos: **rojo** con el candado de la ronda anterior (`\|t\|\|t\|terminó`: nadie espera, ambos exentos) y con el candado tomado solo en la rama propia (el propietario borra P1 y ADM1 queda exento); **verde** con el global (`P2\|f\|P2\|f\|esperando`, un rechazo). Estrés de carrera real, 40 rondas × 6 administradores que comparten `{P1,P2}`, dos sesiones arrancando a la vez: **240 de 240 exentos** sin candado, **222** con el candado por persona (37 de 40 rondas), **0** con el global (40 rechazos, 0 interbloqueos, 0 otros errores) |
| R2-2 | D-7/D-10 tenían más alcance del dicho: 8 políticas conceden por la asignación sola, sin empresa | media (sin efecto hoy: 0 cruces) | **Documentado** (tabla y medición arriba; D-7, D-10) | `SELECT` sobre `pg_policy` de producción; lectura medida con datos |
| R2-3 | Los post-vuelos de la migración y de la reversión (y el diagnóstico) dependían del `search_path` de la sesión | baja | **Corregido** | rojo con `PGOPTIONS='-c search_path=auth,public'` sobre `d1aeb94a` (migración: «la política SELECT no existe…»; reversión: «las políticas no quedaron como las originales»; diagnóstico: «otra» en las cuatro políticas); verde ahora, también con `search_path` vacío; `run.sh` 4d y 8b con la mutación de la comprobación vieja |
| R2-4 | La reversión no es exacta con la ACL de Preview: `anon` recupera `SELECT/INSERT/UPDATE/DELETE` que nunca tuvo | baja | **Documentado**; el texto «reversión exacta» ahora dice en qué perfil lo es (ver «Reversión») | `run.sh` 4c(a) fija el comportamiento; 4c(b) la exactitud con la ACL de producción |
| R2-5 | El candado añade una clase de interbloqueo con el `FOR SHARE` del trigger de integridad en transacciones de **varias** sentencias | info | **Medido y documentado** (D-15); sin consecuencias para los datos | `run.sh` R2-5 (determinista) y `pgbench` (D-15) |
| R2-6 | ACL por defecto de las funciones: producción es otro perfil y `service_role` conserva `EXECUTE` en las dos funciones de trigger | info | **Documentado** (fila de la ACL en «Qué supone…»; cabecera de la migración) | `SELECT` sobre `pg_default_acl` de producción, sandbox y preview; base local con ese perfil |
| R2-7 | `hashtextextended` con semilla 0 es predecible | info | **Documentado** (D-15): no se encontró un camino de denegación de servicio entre usuarios; es teórico | |
| R2-8 | Nota cruzada: la `20261027000900` del #926 repite el patrón F4 | info | **Documentado** (despliegue) | lectura de la `0900` del #926 (`a6ccc2a8`) |
| F2-01 | **Interfaz**: tras un guardado **parcial** `AsignacionModal` no refrescaba el conjunto inicial; si la persona cambiaba la selección y volvía a guardar, la fila ya insertada se quedaba y la pantalla decía «guardado» (acceso otorgado sin querer) | media | **Corregido**: tras un parcial se relee lo que hay en la base y ése es el nuevo «antes» | vitest: 4 pruebas **rojas** sobre `d1aeb94a` y verdes ahora (la selección deshecha, la variante «deja p2 desmarcado y desmarca p3», el reintento sin cambios y la relectura fallida); 5 con su control |
| F2-02 | La compuerta de autoedición protege a un rol que **no llega a la pantalla**, y F-03/D-9 eran falsos para la interfaz | media | **Corregido en el documento** (ver «Cambio de flujo (F-03)» e «Interfaz») | lectura de `routes.tsx`, `Sidebar.tsx`, `queries.ts`, `App.tsx` |
| F2-03 | **Cualquier administrador deja exento a OTRO administrador borrando su último proyecto** (`projects_delete` lo permite; el trigger solo vigila filas propias); D-2, D-5 y D-6 lo omitían y la regla propuesta en D-2 no lo cierra | media | **Documentado como decisión abierta, SIN implementar** (D-2, D-5, D-6) | `assert_alcance` `[otros caminos]` F2-03 (documenta el comportamiento actual); la regla de D-2, aplicada en una copia, deja el caso igual |
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

## Cambio de flujo (F-03): el administrador acotado que crea un proyecto **por la API**

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

**Decisión D-9.** No se implementa ninguna. Como nadie hace esto por la pantalla, el riesgo de uso es bajo; mientras no se decida, el administrador acotado que cree
un proyecto por la API tendrá que pedir que se lo asignen el propietario, el superadministrador u otro administrador.

## Qué NO cambia

* **Las filas**: ni una; conteo y huella idénticos antes y después (la migración lo comprueba y aborta si no).
  Las 10 huérfanas se conservan; no se «arreglan» ni se borran.
* La política **SELECT** (cada persona lee las suyas), `permission_type` (hoy todas `total`; ninguna política,
  función ni pantalla lo lee para decidir acceso), y `user_has_project_access`, `can_access_project`,
  `user_is_project_exempt` y todas las políticas de otras tablas.
* Lo que pueden hacer propietario, superadministrador y administradores sobre **otras** personas de su empresa
  (los 23 flujos legítimos de la pantalla que se probaron dan el mismo resultado antes y después).
* **Excepción conocida a esa frase**: el flujo «administrador acotado crea un proyecto y se lo asigna» sí cambia, pero solo existe por la API (F-03, arriba).

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
por diferencias) con sesiones autenticadas simuladas. **Aviso (F2-02): los flujos con actor `admin` son sintéticos.** La pantalla real solo la
abre el propietario (ver «Cambio de flujo (F-03)»); lo que se prueba con un administrador es lo que ocurriría si un administrador hiciera esas mismas
escrituras directamente por la API, que es lo que la migración protege:

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
asigna» **no está entre los 28** y es el que cambia (F-03; solo por la API).

## Interfaz

Se corrigieron F-01, F-02, F-05, F-06 y F-07 (`AsignacionModal.tsx`, `EmpresaUsuariosSection.tsx`,
`domain/empresa/usuarios.ts`):

* **Autoedición**: en la fila del propio administrador el botón «Acceso» queda deshabilitado, con el texto
  «Tus proyectos los cambia otro administrador, el propietario o el superadministrador»; si aun así se abriera el
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

## Resultados de las pruebas

Suite `supabase/tests/asignaciones_proyecto/run.sh` (PostgreSQL 16 real, cadena de 557 migraciones anteriores, cableada
en `coverage.yml`, puerto 55532):

| Bloque | Resultado |
|---|---|
| Datos como producción | 43 filas · 27 usuarios · 10 huérfanas; huella md5 `(id, user_id, project_id, permission_type)` y de **todas** las columnas idénticas antes/después; las 43 coinciden fila a fila con la copia original; `user_is_project_exempt()`, `can_access_project()` (39 personas × 10 proyectos = 390 pares) y lo que cada persona lee **de la tabla**: **0 diferencias** (19 comprobaciones) |
| Catálogo y privilegios | 33 comprobaciones: 4 políticas con los nombres de siempre, SELECT idéntica a producción, 2 triggers por fila BEFORE, 3 funciones `SECURITY DEFINER` con `search_path` vacío, `EXECUTE` solo para quien debe, que la baja en cascada **retiene un candado** (comprobado por comportamiento con `pg_locks`: administrador acotado, propietario y superadministrador sí, el rol de servicio no; antes era un `strpos` sobre `prosrc` que se ponía en rojo con un refactor inocuo; el `COALESCE` lo prueba `assert_defensa`), `anon` sin ningún privilegio, `authenticated` sin `TRUNCATE`/`TRIGGER`/`REFERENCES`, `TRUNCATE` como `authenticated`/propietario/superadministrador falla con `permission denied` |
| Matriz rol × operación × objetivo | **148 casos** (INSERT, UPDATE, DELETE, UPSERT y `INSERT … SELECT`; super_admin/superadmin, propietario, administrador exento, administrador acotado, operador, visor, cliente, sin `app_users`, sin empresa, administrador/propietario/operador de otra empresa, `anon`, `service_role`, superusuario; filas propias y ajenas; proyectos propios, ajenos, de otra empresa y que el administrador no ve; personas de la empresa, de otra empresa, huérfanas, sin empresa e inexistentes; `UPDATE` que cambia `user_id` a sí mismo y `project_id` a otra empresa). Cada «no debe pasar» comprueba **código y mensaje**, que la tabla no cambió y que la **misma sentencia como SISTEMA sí funciona** (el cero no es un `WHERE` equivocado) |
| Flujos legítimos | 41 comprobaciones (28 flujos de pantalla + 13 lecturas/servicio) |
| Alcance | 25 comprobaciones: **290/290** intentos de autoasignación (29 personas × 10 proyectos) bloqueados con 42501/23514 (94 por integridad de empresa, 196 por el trigger de autoasignación); **84/84** intentos de borrar/cambiar lo propio afectaron 0 filas; el alcance de las 33 personas no se movió; ningún administrador acotado se vuelve exento; el borrado en cascada de un proyecto al que está asignado procede si le queda otra asignación y se rechaza si sería la última; F2-03 documentado (un administrador deja exento a otro borrando su último proyecto) |
| Capas por separado | 28 + 37: las **políticas solas** (sin triggers) ya cierran el hueco; los **triggers solos** (con una política `true`, y con una permisiva `zz` añadida a las verdaderas) también, incluida la sesión sin `app_users` (F3) y borrar UNA fila propia (F-08) |
| Control negativo | Sin la migración: matriz **73 rojos / 75 verdes de 148**, y rojas `assert_alcance`, `assert_catalogo`, `assert_defensa`, `assert_capas` |
| Idempotencia | 2ª pasada limpia; huella del catálogo de `public` idéntica (3363 grupos, 0 diferencias); la migración cambia **9** grupos de la huella |
| Guardas | Pre-vuelo: con `can_access_project(uuid)` ausente aborta («faltan can_access_project(uuid)») y no deja ninguna pieza; corrida por un rol que **no es el propietario** (S15) aborta con «asg_intruso no es el propietario de user_project_assignments» y sin piezas. Post-vuelo: si la migración cambiara **una** fila aborta («las filas … CAMBIARON») y la transacción no deja nada. `lock_timeout`: con una transacción larga sobre la tabla falla en 5 s sin dejar piezas y, reintentada, se aplica |
| **4c · ACL de Supabase Preview y de producción** | La migración se aplica **como un rol no superusuario con `BYPASSRLS`** con la ACL de la preview (`authenticated` sin DML: lo deja sin DML) y con la de producción (lo deja con DML); control negativo con el post-vuelo absoluto (aborta en la preview, pasa en producción); `assert_acl.sql` (10 comprobaciones por base) y, sobre la base de producción con ese propietario, **toda** la batería (312 comprobaciones: 33 + 148 + 41 + 25 + 28 + 37); la reversión es relativa (a `authenticated` solo le devuelve `TRUNCATE/TRIGGER/REFERENCES`) y deja el catálogo **exacto** con el propietario no superusuario (3357 grupos, 0 diferencias, ACL incluida) |
| Reversión | `scripts/reversion-asignaciones-proyecto.sql` dos veces: huella del catálogo de `public` **idéntica** a la de antes de la migración (**0 diferencias en 3357 grupos**), `pg_get_expr` de las 4 políticas idéntico (md5 por política), 43 filas intactas, la matriz vuelve a **73 rojos**; reaplicar la migración deja el catálogo idéntico al de la migración |
| Mutaciones | **27** (16 de catálogo + 6 de concurrencia + 1 de privilegios + 4 de guardas). De catálogo: las 13 de la primera ronda (cada política revertida a mano, la regla «concede todo», sin exclusión de sí mismo, sin «proyectos que ve», sin «persona de la empresa», sin cada trigger y deshabilitado, privilegios devueltos, SELECT que pierde las propias, el revert completo) más 3 obtenidas **mutando la función de la propia migración**: F-08 (cascada sin comprobar que el proyecto ya no existe), F3 (sin `COALESCE`) y F1/R2-1 (sin el candado global). De concurrencia: sin `FOR SHARE` (D0), sin el candado y con el candado dentro del `AND` (F1), sin el `LOCK TABLE` inicial (F4), el candado **por persona** de la ronda anterior y el candado tomado **solo en la rama de autoasignación** (R2-1). De privilegios: el post-vuelo con el DML como absoluto. **De guardas (nuevas)**: el post-vuelo de la migración y el de la reversión con la comprobación vieja de `auth\.uid` (R2-3), el pre-vuelo sin la comprobación del propietario (S15) y la reversión sin su `LOCK TABLE` (R02). **En todas alguna aserción se pone en rojo** (la lista de archivos rojos por mutación sale en el log). La cifra se cuenta al ejecutar cada mutación; la anterior («14») salía de un `grep -c` que contaba también su propia línea de resumen (eran 13) |
| Concurrencia | Sesiones reales **sincronizadas sin ninguna espera fija** (un candado «puerta» que toma una sesión de control y la observación de `pg_stat_activity.wait_event_type = 'Lock'`; cada caso comprueba además si la 2ª sesión terminó o quedó esperando): dos administradores sobre la misma persona (proyectos distintos: unión `{P4,P5,P6,P7}` sin duplicados ni deadlock; solapados: gana el primero, el segundo recibe `duplicate key` 23505 limpio; por diferencias: sin error y la fila que no cambió conserva su id); una autoasignación mientras otro administrador asigna; un administrador acotado que intenta ampliarse mientras otro escribe a un tercero; el cambio de empresa de la persona o del proyecto concurrente con la asignación (D0: sin `FOR SHARE`, 1 fila cruzada; D1/D2: con el candado, 0 y `ASIGNACION_EMPRESA_DISTINTA`); **F1**: dos sesiones borran cada una uno de los dos únicos proyectos de un administrador acotado (con el candado: la 2ª espera, recibe `ASIGNACION_PROPIA_NO_PERMITIDA` y queda 1 fila y no exento; sin él: 0 filas y exento); **R2-1**: dos administradores que comparten `{P1,P2}` borran uno cada uno (la 2ª espera y rechaza: ambos conservan `{P2}`; con el candado por persona, ambos 0 filas y exentos) y el propietario contra un administrador (ADM1 espera y conserva `{P2}`; con el candado solo en la rama propia queda exento); **R2-5**: una transacción de varias sentencias cruza el candado y el `FOR SHARE` (PostgreSQL aborta UNA con «deadlock detected»; de P1/P2 se borra exactamente uno, AP sigue acotado, ninguna asignación huérfana; sin el candado, ninguna interbloquea); **F4**: una escritura legítima llega con la migración parada tras su pre-vuelo (espera; la migración pasa; 44 filas); **R02**: lo mismo con la **reversión** (espera; la reversión pasa; 44 filas; sin su `LOCK TABLE`, aborta con el falso «CAMBIARON») |
| Diagnóstico | `scripts/diagnostico-asignaciones-proyecto.sql`: una sentencia, corre con `default_transaction_read_only=on` (un `DELETE` ahí falla), señala «EL HUECO» antes y «corregida» después, la sección «tabla» es idéntica |

Total de la suite: **663 comprobaciones ✓** (331 del flujo principal —19 + 33 + 148 + 41 + 25 + 28 + 37—, 10 de `4c(a)` y 322 de `4c(b)`
—10 + 33 + 148 + 41 + 25 + 28 + 37—), más el control negativo, la idempotencia, las guardas, el `lock_timeout`, la reversión, las 27
mutaciones, la concurrencia y el diagnóstico. En el paso 7 de `run.sh` sobre el árbol del #926 (con las 10 migraciones de esa serie
aplicadas encima) son **852** (663 + matriz 148 + flujos 41).

**La suite de esta ronda pasó 3 veces seguidas (`rc` 0, 663 comprobaciones y ningún `❌` cada vez): 121 s, 135 s y 270 s con 12 bucles de CPU sobre 4
núcleos (3 por núcleo).** La máquina era compartida con procesos de otras tareas en las tres; el caso C (`lock_timeout`) dio 5 s también con la CPU saturada, dentro de su
límite de 8 s. Después corrió una cuarta vez sobre el árbol del #926 (852, ver arriba) mientras otros tres PostgreSQL desechables corrían a la vez. Ningún caso de
concurrencia depende de un tiempo fijo (solo hay sondeos de 50–100 ms); el mismo resultado con la máquina cargada o no.

**Contra el código anterior (rojo antes).** La suite nueva, ejecutada contra la migración, la reversión y el diagnóstico de `d1aeb94a`, **falla** (`rc` 1) en
`assert_catalogo` («borrar un proyecto con una sesión de la API … toma un candado de aviso»: el propietario y el superadministrador no lo tomaban); contra la migración
con la comprobación de `auth.uid` corregida pero con el candado **por persona**, falla en el mismo punto. Las carreras concretas (R2-1) y las guardas frente al `search_path`
(R2-3) se ven en rojo con sus mutaciones dentro de la propia suite (4d, 8b, R2-1) y, a mano, así: el guion del verificador (`xp.sh`) deja `ADM1=[] exento=t · ADM2=[] exento=t ·
rechazos=0` con `d1aeb94a` y `ADM1=[P2] exento=f · ADM2=[P2] exento=f · rechazos=1` con la corrección (3 repeticiones iguales).

Vitest de la interfaz (`src/components/empresa` y `src/domain/empresa`): **192 pruebas en 18 archivos** (180 de la ronda anterior + 12 nuevas). De las 12 nuevas,
**4 fallan** sobre el código de `d1aeb94a` (F2-01: la selección deshecha tras un parcial, la variante «deja p2 desmarcado», el reintento sin cambios y la relectura fallida);
una quinta de F2-01 es un control que el código anterior también cumple, y las otras 7 (M06, M11, M15, M19, M20, M23) pasan con el código y **matan mutantes que antes
sobrevivían**. En el PR entero las pruebas nuevas de interfaz son 79: `AsignacionModal` 35, `AsignacionModal.excepcion` 2, `AsignacionModal.carrera` 2,
`EmpresaUsuariosSection.acceso` 7, `asignacionesProyecto` 19 y `guardarAsignaciones` 14.

## Barrido de regresión

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

Dos salvedades, dichas tal cual:

* **`pg_ctl: could not start server`.** `webhook_stripe_idempotencia` falló en sus cuatro intentos dentro del barrido en paralelo (`rc` 1) y `presencia_correccion` necesitó
  cuatro; repetida **sola**, en otro puerto de mi rango, `webhook_stripe_idempotencia` salió a la primera con `rc` 0. **No se determinó la causa**: el registro del clúster se
  borra al terminar la suite y el arranque falla antes de que ninguna prueba corra, así que no toca la migración ni las tablas. Lo que sí se comprobó: reiniciar un clúster
  12 veces seguidas en el mismo puerto no falla ninguna vez, y son las mismas dos suites que fallaron así en la ronda anterior. **Hipótesis (sin probar)**: el rango de puertos
  efímeros del kernel (`32768–60999`) incluye 55731–55739 y una conexión saliente de otro proceso de la máquina pudo ocupar el puerto en ese momento. Mientras no se pruebe,
  no se le pone nombre.
* **`compras_bloque_b` en una copia sin `.git`.** La primera pasada falló en `RG-4.diagnostico.sql` («el archivo del diagnóstico existe y no está vacío — esperado 1,
  recibido 0»): esa prueba localiza `scripts/diagnostico-numeros-factura.sql` con `git rev-parse --show-toplevel`, y el árbol del #926 que se prueba es una copia de `git archive`
  (sin repositorio). Es un artefacto de la copia, no de la migración: con `DIAG=<ruta del archivo>` pasa entera (`rc` 0, 0 `❌`). Por la misma razón el paso `append-only` de esa suite se
  omite en la copia.

Las tres pruebas `node` de replay de `supabase/tests` (`replay_acl_helpers/run.mjs`, `declarar_triggers_fill_company_id/replay.mjs`,
`cumplimiento_calidad_firma_inequivoca/replay.mjs`) también salieron en verde con la migración (primera ronda).

**Combinación con el #926.** Esta ronda se probó sobre el árbol de `a6ccc2a8` (`git rev-parse` de la punta de la rama `peaceful-bell-u9mad4` el 2026-10-11) con esta
migración en su sitio, entre `20261026000500` y `20261027000000`. Ese SHA envejece con cada push del #926 y por eso aquí no se llama «vigente»: de
`edaab0c4` (el árbol de la ronda anterior) a `a6ccc2a8` difieren 13 archivos: dos documentos de compras, `scripts/propuesta-asignaciones-permisos-compras.sql` y
diez bajo `supabase/tests/compras_bloque_b/pendientes_decision/` (que `compras_bloque_b/run.sh` no nombra); **ninguna migración ni suite que se ejecute**. Resultado: `asignaciones_proyecto` 852 ✓ (663 + matriz 148 + flujos 41 con las 10 migraciones del #926 aplicadas encima), `compras_bloque_b` 985 ✓, `compras_cierre_tecnico` 31 ✓ y `compras_flujo`, todos en `rc` 0 (ver «Barrido de regresión»).
La primera ronda encontró un conflicto real con el diseño inicial del trigger de autoasignación (que
también rechazaba la baja en cascada): rompía `compras_bloque_b/hallazgos/DEP-5.sql`, que exige que un administrador asignado a un
proyecto pueda eliminarlo. Ver D-5.

## Riesgos residuales y decisiones abiertas

| # | Qué | Estado |
|---|---|---|
| D-1 | Un administrador **acotado** solo reparte los proyectos que él ve, como hoy. Si el negocio quiere que reparta cualquier proyecto de su empresa, hay que quitar la condición de visibilidad **y** cambiar el guardado de la pantalla (si no, borraría lo que no ve) | Decidido (igual que antes); abierta si se quiere otra cosa |
| D-2 | **El alcance por proyecto no es un límite real contra un administrador hostil.** (i) **Colusión (F2)**: un administrador acotado puede dejar exento a otro («Marco borra la fila de `adm2` en P1 y éste queda exento; `adm2`, ya exento, borra las 3 de Marco»: ninguna autoedición, así que el trigger no interviene), o acotar al jefe exento. (ii) **Creación (F-04)**: `create-user` e `invite-user` dejan a un administrador crear **otro administrador** (`ALLOWED_ROLES_FOR_NON_SUPER` / `INVITABLE_ROLES` incluyen `admin`); el nuevo nace **sin filas, es decir exento**, y quien lo crea conoce sus credenciales (`create-user`) o controla el correo de la invitación. (iii) **Borrar el último proyecto de otro administrador (F2-03)**: cualquier administrador, acotado o no, deja exento a OTRO administrador borrando por la API un proyecto que ve y que era el último de éste (`projects_delete` permite borrar a `admin` de la empresa; la cascada vacía la fila ajena y el trigger de autoasignación solo vigila las filas **propias** de quien borra). Reproducido en esta ronda (`assert_alcance`, `[otros caminos]` F2-03: AX2 con solo P1, AP borra P1 → AX2 exento, AP conserva P2 y P3). **Regla propuesta, SIN aplicar**: «un administrador no administra (ni borra ni mueve) filas de personas con rol `admin`, `company_owner` o `super_admin`/`superadmin`» —una condición más en `asignacion_puede_administrar`. Probada en una copia, no aplicada: cambia exactamente **4 casos de la matriz** (B2, C4 ×3) y los 2 resultados del [flujo 5]; los otros 144 casos y 26 flujos quedan idénticos. **Por qué no se aplica**: quita a los administradores la colaboración que hoy ofrece la pantalla (flujo 5) y el negocio no la ha pedido; **y no cierra (ii) ni (iii)**: (ii) necesita cambiar las edge functions (que solo el propietario y el superadministrador creen administradores, o que el nuevo herede las asignaciones de quien lo crea); (iii) es una baja en cascada, y las acciones referenciales de una llave foránea **no pasan por la RLS**, de modo que una regla sobre las políticas de la tabla no la ve (se aplicó la regla en una copia y el caso F2-03 dio el mismo resultado). **Opciones para (iii), como decisión y SIN implementar**: (1) ampliar el trigger de autoasignación para rechazar la baja en cascada que deje sin filas a **cualquier** administrador (hoy solo a quien borra), salvo que quien borra sea el propietario o el superadministrador (D-6); cuesta una lectura de `app_users` por fila en cascada y obliga a decidir qué hacer con un proyecto que es el último de otro administrador (¿no se puede borrar?); o (2) quitar `projects_delete` a `admin` (solo el propietario y el superadministrador borran proyectos; la pantalla hoy no ofrece borrar proyectos a nadie). Mitigación sin código: auditar quién crea administradores y quién borra proyectos | **Decisión de negocio** |
| D-3 | **Filas huérfanas** (10, de 6 usuarios que ya no existen en `app_users`): no son administrables por un administrador ni por el propietario, solo por el superadministrador o el rol de servicio; no se borran ni se «arreglan». Siguen dando `can_access_project` a un `user_id` que ya no existe (inofensivo mientras ese id no vuelva a existir: comprobado con `SELECT`, los 6 ids **no** están en `auth.users`). **Causa, y por qué volverán a aparecer (F2-04):** `supabase/functions/delete-user/index.ts` borra `user_roles` (línea 98), el rol de ajustes (109), `app_users` (118) y `auth.users` (126), pero **nunca** `user_project_assignments`, y la tabla no tiene llave foránea hacia las personas que lo haga en cascada: cada baja de usuario deja huérfanas nuevas, y con esta migración solo el superadministrador o el rol de servicio podrán borrarlas (antes el propietario podía por la API) | Propuesta aparte: que `delete-user` (rol de servicio) borre las asignaciones de la persona **antes** de borrar su perfil, y limpiar los 6 ids actuales con el superadministrador (confirmándolos antes) |
| D-4 | `permission_type`: nada lo lee para decidir acceso (las 43 son `total`). La regla no lo distingue; la pantalla escribe `total` en las filas nuevas y conserva el de las existentes | Sin acción |
| D-5 | **Diferencia con el diseño inicial, justificada con una prueba**: el diseño del trigger de autoasignación rechazaba también la baja *en cascada* de la fila propia. Al probar la combinación con el árbol del #926 eso rompía `compras_bloque_b/hallazgos/DEP-5.sql`, que comprueba que un administrador asignado a un proyecto **puede eliminarlo** (sus órdenes de pago quedan sin proyecto). Ahora la cascada se permite si la persona conserva **otra** asignación (su alcance solo se reduce) y se rechaza si fuera la **última** (quedaría sin filas y, siendo administrador, exento): `[alcance 3]`. La comprobación está **serializada con un candado global de bajas en cascada** (F1, R2-1: sin él, dos borrados simultáneos de sus dos únicos proyectos —o de dos administradores que comparten los suyos— los dejaban con cero filas). **Límite (F2-03):** la comprobación solo vigila las filas **propias** de quien borra; la cascada que deja sin filas a OTRO administrador no se comprueba (D-2 iii). La pantalla no ofrece borrar proyectos | Decidido; el límite es una decisión abierta (D-2) |
| D-6 | Si el **propietario o el superadministrador** borra el último proyecto de un administrador acotado, éste queda sin filas y por tanto exento (`[alcance 3]`). Es una decisión de quien borra, no del administrador. **Cualquier administrador puede hacer lo mismo con OTRO administrador (F2-03)**, y eso sí es una escalada: ver D-2 (iii). Las bajas hechas con el rol de servicio o con SQL directo (p. ej. `delete-company`) no pasan por el trigger ni toman el candado | Riesgo residual; mitigación posible: aviso en la pantalla del propietario. La parte de los administradores, decisión abierta (D-2) |
| D-7 | El trigger de integridad valida **al escribir**. Carrera reproducida y cerrada en un orden: sin candado, un cambio de empresa de la persona (o del proyecto) concurrente con su asignación dejaba **1 fila cruzada** (`D0` de la suite); con `FOR SHARE` la asignación espera y recibe `ASIGNACION_EMPRESA_DISTINTA` (`D1`, `D2`: 0 filas cruzadas). **No cubre el orden inverso** (F7): si la asignación va primero y el cambio de empresa después, o si se cambia la empresa de una persona o proyecto que **ya tiene** asignaciones, no hay trigger en `app_users`/`projects` y quedan filas cruzadas (la persona queda con una fila en un proyecto de la empresa de antes y `can_access_project` sigue dando `true`). Solo el superadministrador puede cambiar el `company_id` de otra persona (propietario y administrador no: `WITH CHECK`). **Alcance real de una fila cruzada (R2-2):** 8 políticas conceden por la asignación sola, sin condición de empresa (`pagos_select`/`pagos_insert`, `registros_insert`/`update`/`delete`, `contadores_select`, `tarifas_select`, `unidades_select`; tabla en «Riesgo real»): una fila cruzada equivale a **leer pagos y contadores, tarifas y unidades** de la otra empresa (medido: un operador, un visor y un administrador, 1 de 1 fila en cada tabla; y sigue valiendo tras mover un proyecto de empresa con la migración puesta) | Hoy: 0 cruces y una sola empresa con proyectos, así que sin efecto. La sección «cruces» del diagnóstico las cuenta; **córrela tras cualquier cambio de empresa de una persona o un proyecto**. Cierre propuesto (dos caminos, no excluyentes): un trigger `AFTER UPDATE OF company_id` en `app_users` y en `projects` que rechace o limpie las filas cruzadas, o añadir la condición de empresa a esas 8 políticas (la segunda es la defensa en profundidad; la primera ataca la causa) |
| D-8 | `service_role` ya no puede asignar entre empresas (la integridad vale para todo actor). Si soporte lo necesitara, `ALTER TABLE … DISABLE TRIGGER trg_asignacion_empresa` en una transacción corta y con registro | Documentado |
| D-9 | **Cambio de flujo (F-03): el administrador acotado que crea un proyecto por la API ya no puede asignárselo.** En la pantalla ese flujo no existe (F2-02): `/empresa` solo la abre el `company_owner`. Opciones: (a) ~~aviso en pantalla al administrador~~ (retirada: viviría en una pantalla que no puede abrir; si se quiere una guía, para el propietario), (b) trigger `AFTER INSERT ON projects` que asigne el proyecto nuevo a su creador acotado, (c) solo el propietario crea proyectos. Ver «Cambio de flujo (F-03)» | **Decisión de producto**; ninguna implementada, riesgo de uso bajo (nadie lo hace por la pantalla) |
| D-10 | **Alcance real de las 77 políticas (R2-2).** Se leyó el texto de cada una en producción: las 77 (70 en `public`, 7 en `storage`) nombran la asignación o sus helpers, y **8 tienen al menos una alternativa que concede por la asignación sola, sin condición de empresa** (tabla en «Riesgo real»). El resto no se comprobó una por una; que «mencionen la empresa» no prueba que toda alternativa la exija. La conclusión práctica es la de D-7: la integridad de empresa de la tabla es la única barrera para esas 8 políticas | Auditoría aparte del resto; cierre de las 8 en D-7 |
| D-11 | La regla mira solo `app_users.role` (`company_owner`, `admin`, `super_admin`, `superadmin`), como la política anterior; los roles RBAC personalizados no administran asignaciones | Sin cambio |
| D-12 | **Deuda previa de la cadena de migraciones** (P0): en una base construida solo con migraciones `authenticated` no tiene DML sobre esta tabla (ver «Lección de ACL»). Esta migración no lo arregla ni lo oculta | PR aparte: declarar los privilegios que debe tener `authenticated` en una base nueva |
| D-13 | **`FOR SHARE` en el trigger de integridad (F6)**: bloquea una alta mientras alguien edita su propia fila de `app_users` en una transacción abierta (medido: una asignación esperó 3,07 s a que la otra transacción terminara; el `DELETE` no espera). En una carga mixta artificial de transacciones de varias sentencias (6–8 clientes) hubo 2 deadlocks en ~3100 transacciones en una corrida y 0 en ~18 000 en seis repeticiones; **sin** la migración la misma carga dio 3–5 por corrida (por la autoedición). Ninguna fila duplicada ni cruzada. Por PostgREST (una sentencia por transacción) el riesgo es mínimo. **`FOR KEY SHARE` queda DESCARTADO (F2-06)**: un `UPDATE` de `company_id` no es una columna clave y no choca con `FOR KEY SHARE`; medido en esta ronda con la carrera D1, la asignación **no espera** y queda **1 fila cruzada** (con `FOR SHARE`: espera, `ASIGNACION_EMPRESA_DISTINTA` y 0 cruzadas) | Aceptado |
| D-14 | **`MAINTAIN` en PG17 (F8)**: `REVOKE TRUNCATE, TRIGGER, REFERENCES … FROM authenticated` deja `authenticated` con `arwdm` (leído en producción, PG 17.6: `arwdDxtm` antes, `arwdm` después; la `d` minúscula es `DELETE`, la `m` es `MAINTAIN`; en la preview del #928, sin DML por D-12, queda solo `m`). **No se revoca** porque es inocuo por la API: PostgREST no emite `VACUUM`/`ANALYZE`/`REINDEX`/`CLUSTER`/`REFRESH`/`LOCK TABLE`, y `LOCK TABLE … ACCESS EXCLUSIVE` ya era posible con solo `UPDATE`/`DELETE` (probado) sin que sea alcanzable desde la API; `anon` sí pierde `MAINTAIN` (`REVOKE ALL`). Tampoco haría falta una sentencia distinta por versión para quitarlo: bastaría `REVOKE ALL` seguido de un `GRANT` del DML anotado en el pre-vuelo; no se hace porque tocaría el DML de una tabla viva por un privilegio que nada usa. Las comprobaciones de privilegios usan listas explícitas, así que ignoran `MAINTAIN` por construcción | Aceptado; no probado en PG17 |
| D-15 | **Candado global de bajas en cascada: coste y límites (R2-1, R2-5, R2-7).** (1) **Coste medido** (`pgbench`, 8 clientes, 15 s, tres repeticiones por variante, base de la suite, máquina compartida con otros procesos: las cifras absolutas son indicativas, la relación no; los guiones son de la verificación y no están en el repositorio): una transacción que solo borra un proyecto como propietario y hace `ROLLBACK` rinde **166–172 transacciones/s con el candado global frente a 353–401 sin candado y 367–377 con el candado por persona** (las bajas de proyecto se ejecutan una tras otra, ≈ 0,45×); sin fallos. Es irrelevante en la práctica: producción tiene 8 proyectos y ninguna pantalla ni función de `public` los borra; la única vía es `DELETE /rest/v1/projects`. (2) **Interbloqueos (R2-5)**: en una transacción de **varias** sentencias que combine «borrar un proyecto» con «asignar sobre otro proyecto que otra transacción está borrando», el candado de aviso y el `FOR SHARE` del trigger de integridad pueden cruzarse. PostgreSQL lo detecta y aborta **una** de las dos (`deadlock detected`, tras `deadlock_timeout` = 1 s); la otra termina y **no queda nada a medias** (probado de forma determinista en `run.sh` R2-5; sin el candado esa misma transacción no se interbloquea). En una carga artificial extrema de ese tipo (8 clientes que borran un proyecto y asignan sobre el siguiente, al azar, 15 s, `--failures-detailed`) fallaron por interbloqueo **55–75 % de las transacciones con el candado global (0,75–1,5 tx/s), frente a 0–0,08 % sin candado o con el candado por persona (81–142 tx/s)**: con el candado global, cada transacción retiene la clave mientras espera filas que tienen las demás. **No es alcanzable por PostgREST** (una sentencia por transacción) ni por ninguna función de `public`; solo con SQL directo de un operador, que debería evitar mezclar bajas de proyecto y altas de asignación en una misma transacción. (3) Un administrador puede retener el candado lo que dure su baja (hasta el `statement_timeout` de 8 s de `authenticated`); las otras bajas esperan y, si pasan de ese plazo, fallan limpio y se reintentan. (4) **R2-7**: la clave es una constante (`hashtextextended('asg-cascada', 0)`, semilla 0, predecible). No se encontró un camino para que un usuario sin permiso de borrar proyectos la tome: solo la toma el trigger de una baja en cascada. El único vector teórico son otras funciones que usan `pg_advisory_xact_lock(hashtextextended(<texto del usuario>, 0))` (compras): un texto fabricado con el mismo hash de 64 bits podría retener esa clave unos milisegundos y retrasar una baja de proyecto, acotado por el `statement_timeout`. Sin acción; si se quisiera endurecer, un candado de dos enteros (clase fija, objeto = hash) separaría el espacio de claves. Si el coste importara, el candado podría limitarse a las cascadas que tocan filas de administradores; no se hizo para no añadir una lectura por fila | Aceptado |

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
* **Borrar el último proyecto PROPIO** (baja en cascada de la fila propia): era un camino real para un administrador (la
  política `projects_delete` se lo permite; reproducido a mano en la base sin la migración: la cascada le quita su última
  fila y `user_is_project_exempt()` pasa a `true`); lo cierra el trigger de autoasignación solo cuando sería su última
  fila (D-5), también con dos sesiones a la vez (F1) y aunque comparta sus proyectos con otro administrador (R2-1). Con el propietario o el
  superadministrador no es una escalada, es una decisión suya (D-6).
* **Borrar el último proyecto de OTRO administrador (F2-03): sigue abierto.** La misma baja en cascada vacía las filas de **todas** las
  personas asignadas al proyecto, y el trigger solo comprueba la de quien borra: un administrador deja exento a otro. No es un hueco nuevo (ya
  ocurría antes de la migración) pero la versión anterior de este documento decía que el camino de «borrar el último proyecto» estaba cerrado. Decisión
  abierta en D-2 (iii); `assert_alcance` lo documenta (`[otros caminos]` F2-03) y hay que invertir ese caso si se cierra.
* **Crear un proyecto nuevo** en su empresa: no da acceso a él (no hay asignación automática) y la regla no deja asignárselo:
  es un **cambio de flujo solo de API** (F-03, D-9).
* **Mover de empresa a una persona o a un proyecto que ya tiene asignaciones** (superadministrador): deja filas cruzadas que valen como
  acceso a pagos, contadores, tarifas y unidades de la otra empresa (D-7, R2-2).
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

**Notas de despliegue de la tercera ronda.**

* **La rama de Supabase Preview de este PR ya aplicó la versión anterior (`d1aeb94a`)** y su historial la registra: leído con `SELECT`, la función
  `asignacion_bloquear_propia` de esa preview todavía tiene el candado **por persona** (`md5(prosrc)` `ffc3eba1…`), no el global. Preview no vuelve a aplicar
  un archivo cuya versión ya figura registrada, de modo que **verificar la versión nueva en Preview exige reiniciar esa rama** (como se hizo con la del #926).
  Mientras no se reinicie, el check verde de Preview no dice nada de este cambio.
* **Nota cruzada con el #926 (R2-8).** La `20261027000900` cuenta las filas de `user_project_assignments` en su pre-vuelo (línea 141) y las compara en su
  post-vuelo (línea 1775, `COMPRAS_MIGRACION_POSTVUELO: las asignaciones de proyecto cambiaron`) **sin bloquear la tabla** (ninguna migración de esa serie hace
  `LOCK TABLE`): el mismo patrón que F4 corrigió aquí. Si una asignación legítima se confirma en esa ventana, la `0900` aborta con un falso positivo (falla
  limpio y se reintenta, no deja nada a medias). Por eso esta migración va **antes** y conviene correr el #926 **sin escrituras de asignaciones** (o dar a la `0900`
  el mismo orden que F4: `LOCK TABLE` antes de contar). No se toca aquí: es del #926.
* La `0600` no choca con ninguna migración del #926: ninguna hace `ALTER`/`CREATE TRIGGER`/`CREATE POLICY` sobre `app_users`, `projects` ni `user_project_assignments`, y el
  workflow de producción aplica un archivo por vez.

## Reversión

`scripts/reversion-asignaciones-proyecto.sql`: devuelve las cuatro políticas a su texto original, quita los triggers y las
funciones y restaura los privilegios (a `anon` los siete; a `authenticated` solo `TRUNCATE`, `TRIGGER` y `REFERENCES`: su
`SELECT`/`INSERT`/`UPDATE`/`DELETE` **no se tocan**, igual que la migración); idempotente; bloquea la tabla antes de medir; no toca
filas. **Probada**: con la **ACL de producción** (anon y authenticated con `arwdDxt`, más `m` en PostgreSQL 17) deja el catálogo **exacto** (huella
idéntica, 0 diferencias, ACL incluida) tanto con el propietario superusuario del arnés como con un propietario **no superusuario con `BYPASSRLS`**, y
migración → reversión → migración cierra el ciclo; también con `auth` en el `search_path` (R2-3). **No es exacta con la ACL de Supabase Preview (R2-4):** a
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
npx vitest run src/domain/empresa src/components/empresa   # interfaz
node scripts/schema-drift/auditar.mjs --base origin/main   # auditor de drift (offline)
```
