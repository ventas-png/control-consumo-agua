# Decisión — `pg_net`: los grants a `PUBLIC` son del proveedor, y se quedan

> **Registro de decisión. No hay nada que ejecutar acá.** Este documento
> reemplaza a la propuesta de migración que existía antes: la remediación que
> proponía **no está soportada**, así que el SQL se retiró para que nadie lo
> aplique por error.

## Lo medido

El esquema `net` —de la extensión `pg_net`, que instala Supabase para que la
base haga peticiones HTTP salientes— concede `USAGE` a `PUBLIC`, y:

| Objeto | Concede a `PUBLIC` |
| --- | --- |
| `net._http_response` | Los **ocho** privilegios de tabla: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` y —producción va por PostgreSQL 17— `MAINTAIN`. |
| `net.http_request_queue` | Los mismos ocho. |
| `net.http_request_queue_id_seq` | `SELECT`, `USAGE` y `UPDATE`. Es la única secuencia: `_http_response` no tiene una propia. |

Los tres objetos y sus grants pertenecen a `supabase_admin`. Ninguna migración
declara la definición administrada ni los grants de estos objetos. La
reconstrucción local no reproduce la ACL gestionada: `bootstrap.sql` crea
únicamente un stub inerte de `net._http_response`, además de `net.http_post()`
y `net.http_get()` para que las migraciones compilen; no recrea
`net.http_request_queue`, su secuencia ni los grants administrados a `PUBLIC`.

## Lo que respondió Supabase Support

1. **Un rol `LOGIN` propio hereda los privilegios gestionados de `pg_net`
   concedidos a `PUBLIC`.** No hay forma de crearlo por fuera de `PUBLIC`.
2. **Esos grants son intencionales y necesarios** para la compatibilidad actual
   y futura de la plataforma.
3. **No existe hoy una forma soportada** de crear un rol `LOGIN` directo a
   PostgreSQL que no alcance esos objetos.
4. **Retirar los grants a `PUBLIC` no es una remediación soportada.**
5. El ticket quedó **enlazado al backlog de Supabase**.

Antes de eso, sobre la vía HTTP, Support confirmó que PostgREST sólo sirve los
esquemas configurados en *Data API → Exposed schemas*, y que `anon` y
`authenticated` son roles **`NOLOGIN`**: no se puede abrir una conexión directa
a Postgres con una anon key ni con un token de usuario.

## La exposición real, verificada

**`net` NO está expuesto por la Data API.** Los únicos esquemas expuestos en
este proyecto son **`graphql_public`** y **`public`**.

Por eso esto **no** es una exposición HTTP de `anon`/`authenticated`: sin el
esquema expuesto no hay endpoint REST, y esos roles no pueden conectarse
directamente. Lo que queda es la vía de una credencial `LOGIN` directa a
PostgreSQL — que es precisamente la que este auditor necesitaría.

## La decisión

**El auditor de producción en vivo queda diferido.** Refrescar
`huella-produccion.json` automáticamente exigía una credencial `LOGIN` dedicada
de solo lectura, y Supabase confirmó que hoy no existe una que no alcance el
contenido de las integraciones —los cuerpos y las cabeceras de cada respuesta
HTTP que recibe la base, y las peticiones pendientes con las suyas—.

En consecuencia, y de forma deliberada:

* **no se crea** ningún rol dedicado ni se guarda ninguna cadena de conexión;
* **no existe** un job que se conecte a producción; se retiró del workflow;
* **no se agrega** `net` a ninguna tolerancia del guard, ni se afloja el guard;
* la instantánea de producción se refresca **a mano**, y el rojo del auditor
  cuando envejece es información correcta, no un fallo.

Se retoma si Supabase publica un mecanismo de aislamiento soportado. El ticket
está en su backlog.

### Lo que NO se hace, y por qué

| Atajo | Por qué no |
| --- | --- |
| `SET ROLE supabase_admin` | Escalada de privilegios. Si funcionara sería un agujero peor que el que se intenta cerrar. |
| `ALTER TABLE net.… OWNER TO postgres` | Arrebatarle a la extensión sus objetos. La próxima actualización puede fallar o revertirlo. |
| Un wrapper `SECURITY DEFINER` que revoque | Fabricar exactamente la clase de puerta trasera que este auditor existe para detectar. |
| `ALTER EXTENSION pg_net …`, reinstalar o parchear | Modificar una extensión gestionada. Se pierde en la próxima actualización y puede romper las integraciones salientes. |
| Retirar los grants a `PUBLIC` | **No soportado**, según la respuesta de arriba. Y en un proyecto gestionado el ejecutor de migraciones (`postgres`) no es superusuario ni miembro de `supabase_admin`: su `REVOKE` no fallaría, emitiría un `WARNING` y **saldría 0** sin revocar nada. |

Ese último punto —que un `REVOKE` sin autoridad sale 0— es el que hacía
peligrosa la propuesta anterior: una migración así habría quedado registrada
como aplicada con la vía intacta. Está fijado como regresión en
`--prueba-credencial`, **sobre un esquema sintético**, junto con el resto de la
semántica de ACL que el auditor da por cierta: las dos capas
(`pg_class.relacl` y `pg_attribute.attacl`), los privilegios por columna, las
secuencias, los otorgantes y el rollback.

### Qué se toca y qué no, con precisión

`auditar.mjs` **no ejecuta** DDL, `GRANT`, `REVOKE`, `DROP` ni `ALTER` contra
ningún nombre `net.*`; sólo los nombra como datos de `SIN_REMEDIO_SOPORTADO` y
en las entradas de texto de las pruebas puras. Hay un tripwire que lo fija —que
inspecciona **sólo ese archivo** y **sólo su texto**, así que no detecta SQL
armado dinámicamente ni cubre el resto del andamiaje.

**`bootstrap.sql` es la excepción deliberada.** Crea stubs locales de
`net._http_response`, `net.http_post()` y `net.http_get()`, y debe seguir
haciéndolo: **11 migraciones del repositorio los usan**, y sin ellos la
reconstrucción no aplica. Son objetos vacíos dentro del clúster desechable —las
funciones devuelven `1::bigint` y no salen a la red—, sin ninguna conexión con
producción ni con la extensión gestionada. **No se quitan sin comprobar antes
que las migraciones se pueden reconstruir**; hay una prueba que exige que sigan
estando.

## Lo que sí quedó de este trabajo

El endurecimiento del auditor, que no depende de tener acceso a producción:

* los grants se leen del **ACL** y no de `information_schema`, que es relativo
  al rol y habría producido 563 dimensiones `/grants` vacías sin fallar;
* los **ocho** privilegios de tabla, con `MAINTAIN` sólo cuando
  `server_version_num >= 170000`;
* los privilegios **por columna** (`SELECT`, `INSERT`, `UPDATE`, `REFERENCES`),
  con los nombres reales de las columnas en el remedio;
* las **secuencias**, con `has_sequence_privilege`;
* la **procedencia** completa de cada privilegio, y el remedio que sale de ella;
* el guard de separadores de `fingerprint.sql`, fail-closed;
* y `LECTURA_TOLERADA` **vacía**: la tolerancia de `pg_stat_statements` era una
  propuesta del auditor, nunca fue aprobada, y sin aprobación el guard bloquea.
