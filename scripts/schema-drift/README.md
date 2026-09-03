# Auditor de drift de esquema — repositorio ↔ producción

Reconstruye el esquema desde las **449 migraciones** de `supabase/migrations` en
un Postgres desechable y lo compara, dimensión por dimensión, contra el catálogo
real de producción.

## Por qué existe

`src/test/rls/rlsHarness.test.ts` afirma por escrito que `payment_requests` no
tiene policy de `SELECT` y que `anon` no lee ni una fila —"sus filas nunca deben
proyectarse a un cliente"—. El harness corre contra un esquema **construido desde
el repositorio**, así que pasa. Producción tiene:

```
payment_requests_select · SELECT · TO public · USING (true)
```

que ninguna migración declara, sobre una tabla donde `anon` conserva el `GRANT`
de `SELECT`. El test estaba verde y mentía.

Ése es el patrón, y es más grave que las diferencias sueltas: **mientras el
repositorio no describa producción, cualquier garantía que se verifique contra el
repositorio deja de decir nada sobre producción.** El drift no es cosmético — es
el mecanismo por el que un CI verde deja de ser evidencia.

El drift va en las dos direcciones. Producción tiene policies que el repositorio
no declara; el repositorio concede `EXECUTE` a `anon` sobre funciones
`SECURITY DEFINER` que producción tiene revocadas a mano. Ninguno de los dos lados
es «el bueno» por defecto: cada diferencia hay que decidirla. El inventario
completo y la clasificación de seguridad están en **#826**.

## Qué mira

Nueve dimensiones del esquema `public`, agrupadas por objeto para que el
resultado diga *qué* objeto y *qué* aspecto cambió:

| Dimensión | Clave de la huella |
| --- | --- |
| Estado de RLS (habilitada / forzada) | `tabla:<t>/rls` |
| Columnas (tipo, `NOT NULL`, default, identity, generated) | `tabla:<t>/columnas` |
| Constraints (PK, FK con su `ON DELETE`, `UNIQUE`, `CHECK`) | `tabla:<t>/constraints` |
| Índices | `tabla:<t>/indices` |
| Policies (comando, roles, permisividad, `USING`, `WITH CHECK`) | `tabla:<t>/policies` |
| Grants de tabla | `tabla:<t>/grants` |
| Triggers | `tabla:<t>/triggers` |
| Funciones (`SECURITY DEFINER`, `search_path`, volatilidad, cuerpo) | `funcion:<firma>` |
| Grants de `EXECUTE` | `funcion:<firma>/grants` |
| Vistas, vistas materializadas y enums | `vista:` · `matview:` · `enum:` |

Cada grupo se serializa de forma **canónica** y se hashea con **SHA-256 completo
(64 hex)**. Las reglas están en `fingerprint.sql` y existen porque sin ellas dos
bases con el mismo esquema pueden hashear distinto — el peor fallo de un
auditor, porque el drift falso enseña a ignorar la alarma:

| Regla | Por qué |
| --- | --- |
| `ORDER BY … COLLATE "C"` en todo agregado | El orden depende de la collation. La reconstrucción corre con `--locale=C` y producción con la suya: dos catálogos idénticos podían serializar sus columnas en distinto orden. |
| Separadores `\x1e` (registro) y `\x1f` (campo) | El cuerpo de una policy trae saltos de línea, así que separar con `\n` era ambiguo: una policy multilínea podía serializarse igual que dos policies distintas. |
| `NULL` explícito `\x1d`, distinto de `''` | `default=NULL` y `default=''` son cosas distintas y deben hashear distinto. |
| **Ninguna normalización de espacios, en ninguna dimensión** | Ver abajo. |
| `sha256` de `pg_catalog`, no de `pgcrypto` | La huella no depende de qué extensión esté instalada ni en qué esquema viva. |
| 64 hex sin truncar | Un md5 recortado a 12 hex son 48 bits. Con ~2 400 grupos el riesgo de colisión es pequeño pero real, y una colisión aquí es exactamente «drift que el auditor no ve». |

### Por qué no se normalizan los espacios

Una versión anterior colapsaba espacios con `regexp_replace('\s+',' ')` y `btrim`
sobre `prosrc` y sobre las definiciones de vista, para evitar 12 grupos de drift
meramente cosmético. **Estaba mal**, y de la peor manera: un colapso *global* no
distingue la sangría del contenido, así que borraba diferencias reales dentro de

- **literales SQL** — `SELECT 'a  b'` y `SELECT 'a b'` hasheaban **igual**;
- **cuerpos PL/pgSQL y dollar-quoted**, donde un salto de línea dentro de una
  cadena es dato, no formato;
- **definiciones de vista** con literales;
- **identificadores entre comillas**.

Eso es un **falso negativo**: drift real que el auditor no ve. Vale
incomparablemente más conservar una diferencia cosmética declarada en
`drift-conocido.json` —donde alguien la lee y decide— que perder una diferencia
semántica en silencio.

Una normalización *correcta* tendría que ser consciente de la sintaxis
(dollar-quoting anidado, cadenas `E''`, comentarios, comillas dobles): eso es un
parser, y un parser con bugs reintroduce exactamente el fallo que se quiere
evitar. Así que todo el DDL se hashea **en crudo**, y los 12 grupos cosméticos
quedan declarados y marcados como tales.

Las demás dimensiones —defaults (`pg_get_expr`), constraints, índices, policies
(`qual`/`with_check`) y triggers— nunca se normalizaron.

Los grants son una dimensión de primera clase a propósito: una policy permisiva
sólo es peligrosa si el rol además tiene el privilegio, y en Supabase `anon` y
`authenticated` lo tienen sobre casi todo por los privilegios por defecto. Un
grant que se mueva cambia el modelo de amenaza sin tocar una sola policy.

## Las tres vías

El auditor compara **tres** puntos, no dos:

| | Qué es |
| --- | --- |
| **P** | La instantánea del catálogo de producción, `huella-produccion.json` |
| **M** | La reconstrucción de la **rama base** |
| **R** | La reconstrucción del **HEAD** de este PR |

Grupo por grupo:

| Situación | Qué significa | Resultado |
| --- | --- | --- |
| `M == R` | El PR no toca ese objeto | Trinquete estricto contra P |
| `P == M` y `R ≠ M` | Cambio planificado, pendiente de desplegar | `CAMBIO PLANIFICADO` → **pasa** |
| `R == P` y `M ≠ P` | El PR converge hacia producción | `DRIFT RESUELTO` → **pasa**, la baseline puede encoger |
| `P ≠ M ≠ R ≠ P` | Nadie coincide con nadie | `CAMBIO AMBIGUO` → **falla** |

### Por qué hacía falta el tercer punto

Con sólo P y R, estos dos casos son **indistinguibles**, y son opuestos:

- alguien tocó producción por fuera y el repositorio no lo declara — drift no
  autorizado, tiene que romper;
- el PR agrega una migración forward-only que todavía no se desplegó — cambio
  planificado, tiene que pasar.

#828 lo dejó a la vista. Cerrar la lectura sin autenticar de `payment_requests`
puso el auditor en rojo por hacer exactamente lo que había que hacer, y las
únicas formas de ponerlo en verde eran declarar la vulnerabilidad como drift
conocido o refrescar la instantánea como si la migración ya estuviera aplicada.
Un auditor que castiga la corrección enseña a ampliar la baseline: justo el
hábito que este auditor existe para impedir.

M dice qué describía el repositorio **antes** del PR, y con eso el caso se
decide sin adivinar.

### Un cambio planificado no se declara

**No entra en `drift-conocido.json`.** Se reporta como pendiente de despliegue y
desaparece solo cuando la migración llega a producción y se refresca la
instantánea con evidencia real. La baseline sigue sin poder crecer — y ahora
tampoco hay ningún motivo para quererlo.

### El ambiguo falla en falso, a propósito

Si producción, la rama base y el PR dicen tres cosas distintas sobre el mismo
objeto, no hay con qué decidir si el PR arregla el drift o lo empeora. Adivinar
en la dirección permisiva es exactamente el fallo que se trata de evitar.

### Un cambio de catálogo exige una migración nueva

R se construye **aplicando** los archivos de migración. Si el esquema
reconstruido se movió y el PR no agrega ninguna migración, lo que cambió fue el
andamiaje (`bootstrap.sql`, `fingerprint.sql`) o una migración histórica.
Ninguna de las dos cosas llega nunca a producción: el repositorio estaría
describiendo un esquema que nadie va a desplegar. Falla.

Y el apéndice tiene que ser limpio: ninguna migración existente modificada ni
borrada, y toda migración nueva con versión **posterior** a la última que ya
existía. Se compara por **hash de blob**, no por nombre — comparar nombres
dejaría pasar una histórica reescrita en su sitio, que es la forma más limpia de
cambiar lo que el repositorio dice que pasó sin que se note.

### De dónde sale M

| Evento | M |
| --- | --- |
| `pull_request` | El **merge-base** con la rama base. No su punta: si la base avanzó desde que se abrió el PR, comparar contra la punta le atribuiría al PR cambios que no hizo. |
| `push` a `main` | `github.event.before`, y si no resuelve —push forzado, rama recién creada— el **primer padre**. |

Si M no se puede resolver, el auditor **falla**. No degrada a la comparación de
dos vías, que es precisamente la que no distingue drift de cambio planificado.
Lo mismo vale para un checkout superficial: una ref que resuelve sin su árbol
lanza en vez de pasar por «no hay nada que comparar». Requiere `fetch-depth: 0`.

### Dos clústeres, no uno con mutaciones

M y R salen de dos `initdb` independientes. Cuando las migraciones son las
mismas, el auditor **exige** que las dos huellas coincidan grupo a grupo: si no,
algo del clúster —un OID, una marca de tiempo— se está colando en la
serialización, y toda comparación posterior mentiría. La verificación de
determinismo corre dos veces sobre el *mismo* clúster y no puede ver eso.

`bootstrap.sql` y `fingerprint.sql` salen siempre de HEAD para los dos lados:
hashear cada lado con una serialización distinta mediría el cambio del auditor y
no el del esquema.

## Qué **no** guarda

- **Ni una fila.** La huella es DDL agregado y hasheado. No hay un solo `SELECT`
  sobre una tabla de negocio, ni un `count(*)`.
- **Nada fuera de `public`.** Ni `auth`, ni `storage`, ni `vault`. El andamiaje
  de `bootstrap.sql` no se compara.
- **Ni contraseñas, ni tokens, ni cadenas de conexión.** Los archivos versionados
  contienen sólo `clave → sha256(64 hex):n`. Hay un guard en `__tests__` que falla si
  aparece algo con forma de secreto.

## Cómo se usa

```bash
# Audita en tres vías contra origin/main: reconstruye HEAD (R) y la rama base
# (M), los compara con la instantánea de producción (P) y rechaza que la
# baseline haya crecido. `--trinquete-contra` sigue aceptándose como sinónimo.
node scripts/schema-drift/auditar.mjs
node scripts/schema-drift/auditar.mjs --base origin/main

# Sólo valida el archivo de baseline (rápido, sin levantar Postgres).
node scripts/schema-drift/auditar.mjs --solo-baseline

# Propiedades de la huella contra un catálogo real: determinismo, estabilidad
# ante el mismo catálogo leído con otro plan, formato y sensibilidad al cambio.
node scripts/schema-drift/auditar.mjs --verificar-huella

# El espaciado dentro del contenido (literales, dollar-quoted, defaults,
# policies) DEBE mover la huella. Cuatro casos; con la normalización anterior
# fallaban dos.
node scripts/schema-drift/auditar.mjs --prueba-espacios

# Los grants salen del ACL y no de information_schema: misma serialización que
# antes (byte a byte), alcanzable por un rol dedicado de solo lectura, y con
# WITH GRANT OPTION moviendo la huella sin mover el conteo.
node scripts/schema-drift/auditar.mjs --prueba-acl

# El modo live de punta a punta contra un clúster desechable que hace de
# producción: conexión por URL con otro rol, credencial medida —un rol culpable
# por cada privilegio que se rechaza—, guards y escritura atómica. Sin
# credenciales y sin red.
node scripts/schema-drift/auditar.mjs --prueba-live

# Prueba negativa: inyecta una columna y una policy que nadie declara, en
# AMBOS clústeres (M y R), para que queden como «objeto que el PR no toca».
# DEBE salir distinto de cero.
node scripts/schema-drift/auditar.mjs --prueba-negativa

# Las tres vías contra un catálogo real: construye M y R desde dos árboles de
# migraciones y exige que un apéndice append-only sea CAMBIO PLANIFICADO y nada
# más, y que el mismo cambio sin migración nueva rompa.
node scripts/schema-drift/auditar.mjs --prueba-tres-vias

# Qué ref usaría como M en un evento dado (lo que llama el workflow).
node scripts/schema-drift/base-git.mjs --evento pull_request --rama-base origin/main

# Reescribe la baseline desde la medición actual. Después hay que escribir el
# `motivo` de cada entrada nueva a mano.
node scripts/schema-drift/auditar.mjs --sembrar-baseline

# Sólo reconstruir y volcar la huella a stdout.
node scripts/schema-drift/reconstruir.mjs
```

Requiere el **servidor** de Postgres, no sólo `psql`: hacen falta `initdb` y
`pg_ctl`. En Ubuntu, `sudo apt-get install -y postgresql`.

## Los archivos

| Archivo | Qué es |
| --- | --- |
| `bootstrap.sql` | El andamiaje que Supabase da de fábrica y las migraciones dan por dado. Las formas se copiaron del catálogo real de producción para que ningún stub invente una diferencia. |
| `fingerprint.sql` | La huella normalizada. **La misma consulta** corre contra la reconstrucción y contra producción. |
| `reconstruir.mjs` | `initdb` → `bootstrap.sql` → las 449 migraciones en orden, cada una en su transacción con `ON_ERROR_STOP`. |
| `auditar.mjs` | Comparación, veredicto y códigos de salida. Su lógica es pura y está probada. |
| `huella-produccion.json` | Instantánea del catálogo de producción, `sha256:n` por grupo. Permite auditar en CI **sin ninguna credencial**. |
| `drift-conocido.json` | La baseline explícita del drift conocido. |

### Por qué no se usa una rama Preview de Supabase

El procedimiento de `docs/SUPABASE_PREVIEW_BRANCHES.md` pedía crear una Preview
desde `main` y hacer diff contra producción. No sirve: el DAG de despliegue de
branching hace **`Pull — retrieves database migrations from your main project`**
*antes* de `Migrate`, así que la rama hereda el historial de producción —las 307
versiones huérfanas incluidas— y reproduce producción, no el repositorio.
Compararla contra producción daría verde sin haber probado nada.

La Preview que sí construye sólo desde el repo es la de la integración Git, y
exige abrir un PR. Un Postgres local no tiene ninguno de los dos problemas: no
cuesta nada, no necesita permisos y es determinista.

## La baseline y su trinquete

`drift-conocido.json` declara **cada grupo que difiere hoy**, con:

- `motivo` obligatorio — una lista sin porqués no se poda, y una lista que nadie
  poda acaba siendo un `permitir todo` de facto. Es el mismo criterio que el
  `_README` de `scripts/migraciones-vs-produccion.allowlist.json`.
- `desde` — cuándo se midió.
- `produccion` y `repo` — **las huellas concretas**, `sha256:n` o `AUSENTE`. La
  baseline declara *esta* diferencia, no «lo que sea que pase en esta tabla».

Sobre los objetos que el PR **no toca** (`M == R`), el auditor falla en tres
casos:

| Situación | Resultado |
| --- | --- |
| Un grupo que difiere y **no está** en la baseline | `DRIFT NUEVO` → falla |
| Un grupo declarado cuyas huellas **cambiaron** | `DRIFT AGRAVADO` → falla |
| Una entrada de la baseline que **ya no** corresponde a drift | falla, pidiendo que se retire |

Sobre los que **sí** toca decide la comparación de tres vías, y ahí un cambio
planificado pasa **sin** tocar la baseline.

Fijar las huellas no estaba en el diseño original: lo destapó la primera prueba
negativa real. Inyectar una policy inesperada en `security_logs` no rompía nada,
porque `security_logs/policies` ya estaba en la lista. Una baseline por clave se
tragaba cualquier cambio posterior — es decir, apagaba la alarma justo en las
tablas donde más importa.

**La lista sólo puede encoger.** El trinquete rechaza un PR que agregue
entradas: un drift nuevo se cierra con una migración forward-only, nunca
ampliando la baseline. Que la entrada se retire en el mismo PR que la arregla es
intencional — eso es lo que `DRIFT RESUELTO` permite.

Son **dos puertas independientes**. Declarar un drift nuevo en la baseline lo
saca de `DRIFT NUEVO`… y entonces lo detiene el trinquete, que compara contra la
baseline de la rama base. Ninguna de las dos alcanza sola.

## Modo live — implementado, apagado hasta que exista la credencial

Refrescar `huella-produccion.json` contra el catálogo real **está implementado y
probado**: `--prueba-live` lo ejercita de punta a punta contra un clúster
desechable que hace de producción, con conexión por URL y un rol distinto. Lo
único que falta para encenderlo es la credencial.

Mientras no se refresque, la instantánea versionada envejece y un cambio hecho
en producción fuera de banda no se ve. Ése es el límite honesto de la garantía
que da este auditor hoy.

```bash
# Refresca la instantánea leyendo producción. Exige SCHEMA_DRIFT_READONLY_URL.
node scripts/schema-drift/auditar.mjs --sembrar-produccion

# Lo mismo sin escribir: imprime el diff y sale. Para mirar antes de tocar.
node scripts/schema-drift/auditar.mjs --sembrar-produccion --en-seco
```

### Los guards, y qué previene cada uno

El peor resultado posible no es un error: es un refresco que se escribe con
datos incompletos y queda versionado como verdad. A partir de ahí el auditor
deja de ver el drift que esos grupos taparían. Por eso todo es fail-closed en
las dos direcciones — se mide la credencial antes de leer, y la huella antes de
escribir.

| Guard | Qué previene |
| --- | --- |
| Falta `SCHEMA_DRIFT_READONLY_URL` | Que alguien «arregle» el modo live reutilizando el token administrativo. El mensaje lo dice por su nombre. |
| El rol es superusuario, tiene `BYPASSRLS`, `CREATEROLE`, `CREATEDB` o `REPLICATION` | Leer producción con una credencial que además puede modificarla. `REPLICATION` es el que se olvida: se lleva la base entera por el stream sin ejecutar un solo `SELECT`. Se **mide**, no se declara. |
| El rol puede escribir en alguna tabla | Lo obvio, y por eso el primero que hubo. |
| El rol tiene `SELECT` sobre alguna tabla | La huella sale del **catálogo**, no de los datos: leer filas no le sirve de nada al auditor y convierte el secreto de `production-db` en una filtración esperando un log. |
| El rol tiene `SELECT` **por columna** | La variante que se escapa: un `GRANT SELECT (email)` no aparece en `has_table_privilege` y alcanza igual para leer datos. Se pregunta aparte, con `has_any_column_privilege`. |
| El rol tiene `CREATE` sobre algún esquema | Crear es escribir. Y con una función propia en un esquema del `search_path` se secuestra la resolución de nombres. |
| El rol es miembro de algún rol | `has_table_privilege` ya cuenta lo que se hereda, pero un rol `NOINHERIT` llega a lo mismo con `SET ROLE`. Un rol dedicado no necesita ninguna membresía, así que cualquiera sobra. |
| El rol puede ejecutar una función `SECURITY DEFINER` **alcanzable** | Esa función corre con los privilegios de **su dueño**: mientras esté al alcance, el «solo lectura» medido arriba describe lo que el rol hace *directamente* y hay un camino al lado. Alcanzable = `USAGE` sobre el esquema **y** `EXECUTE` efectivo, en **cualquier** esquema no interno. Ver «`SECURITY DEFINER`: qué mira el guard y qué no». |
| La URL puede redirigirse o viajar sin cifrar | Ver «La cadena de conexión, antes de abrirla». |
| La sesión no quedó en solo lectura | `PGOPTIONS` fuerza `default_transaction_read_only` desde la conexión; si no rigió, se aborta. |
| El rol no tiene `USAGE` sobre algún esquema del `search_path` | El fallo más caro: no rompe nada, sólo serializa `extensions.citext` donde el dueño escribe `citext`, y el refresco quedaría versionado con drift permanente. |
| La URL apunta a otro proyecto que el declarado | Capturar el **sandbox** y versionarlo como producción. El ref se deduce del host (`db.<ref>.supabase.co`) o del usuario del pooler (`<rol>.<ref>`, con cualquier rol, no sólo `postgres`). El host se valida contra esas **dos formas oficiales**, no por «contiene supabase»: `pooler.supabase.com.atacante.net` lo registra cualquiera. Si no se puede deducir, hay que pasar `--proyecto`: no se adivina. |
| El archivo recién escrito no se relee igual que lo medido | Se escribe en un temporal, se **relee del disco** y sólo entonces se reemplaza con `rename(2)`, que es atómico. Un `writeFileSync` sobre la ruta versionada trunca primero y escribe después: si el proceso muere en el medio queda un JSON cortado que no es ni la instantánea vieja ni la nueva, y el workflow lo publicaría como artefacto. |
| Algún valor no es SHA-256 de 64 hex | Una lectura truncada o a medias. |
| **Todos** los grupos `/grants` vinieron vacíos | El síntoma exacto de leer los privilegios con un catálogo relativo al rol. Que algunos estén vacíos es normal; que lo estén todos, no. |
| El número de grupos cambia más de un 20 % | Haber leído otra base. Un cambio así merece mirarse a mano. |

Y la URL **nunca se imprime**: viaja por el entorno, y el script recorta de sus
propios mensajes de error cualquier cadena de conexión —y la contraseña por
separado— antes de escribirlos.

### Tres jobs, y por qué no son uno

El workflow está partido en tres, y el corte no es cosmético:

| Job | Qué hace | De qué depende |
| --- | --- | --- |
| `verificar` | **Todas** las pruebas del auditor: `--verificar-huella`, `--prueba-espacios`, `--prueba-acl`, `--prueba-live`, `--prueba-tres-vias` y la prueba negativa. | De nada. |
| `veredicto` | Lo que el workflow existe para decir: comparar P, M y R y fallar si hay drift que nadie declaró. | `needs: verificar`. |
| `live` | Refrescar la instantánea leyendo producción. | `needs: verificar`. **No** de `veredicto`. |

Dos cosas que arregla esta separación.

**El veredicto apagaba las pruebas.** Los pasos de un job no corren si uno
anterior falló. Con todo junto, cada vez que producción y la instantánea
divergían —un hecho del mundo, no un defecto del código— el veredicto se ponía
rojo y las pruebas que venían detrás quedaban en *skipped*. Justo cuando hay
algo que auditar, el auditor se quedaba sin la evidencia de que funciona. Ahora
el veredicto vive en su propio job, y dentro de `verificar` cada paso lleva
`if: !cancelled()`: una prueba que falla no saltea a las siguientes, así que lo
que se ve es el cuadro completo y no el primer error.

**`live` gateado por el veredicto era circular.**

> La auditoría falla porque la instantánea envejeció respecto de producción → el
> refresco no corre porque la auditoría falló → la instantánea sigue vieja.

Y eso no es un caso raro: es exactamente para lo que existe el refresco. Por eso
`live` depende de `verificar` y no de `veredicto`. De `verificar` sí depende en
la forma normal —si las pruebas del auditor fallan, el job no corre—: lo que no
se puede exigir es el veredicto, no la corrección del código que va a conectarse
a producción.

### Cómo está protegido el job `live`

Cuatro condiciones, y las cuatro tienen que darse:

| Condición | Por qué |
| --- | --- |
| `github.event_name == 'workflow_dispatch'` | La única referencia de confianza. En `pull_request` el código lo propone quien abre el PR. Nunca `pull_request_target`. |
| `github.ref == 'refs/heads/main'` | Se despacha sobre una rama, y una rama cualquiera puede traer un `auditar.mjs` modificado. |
| `vars.SCHEMA_DRIFT_LIVE_HABILITADO == 'true'` | Encender el modo live tiene que ser un acto deliberado, no el efecto colateral de que aparezca un secreto. |
| `needs: verificar` | Un auditor cuyas pruebas fallan no se acerca a producción. |

Y además, del lado de GitHub y no del archivo:

* `environment: production-db`, restringido a `main`, con revisores requeridos y
  sin bypass de administradores. **El `if` repite esa restricción, no la
  reemplaza**: un `if` lo cambia cualquiera que pueda editar este archivo; la
  regla del environment la hace cumplir GitHub aunque el archivo mienta.
* `permissions: contents: read`.
* Checkout **explícito** de `${{ github.sha }}`, con `persist-credentials: false`.
  Entre el despacho y el arranque del job —que puede esperar la aprobación del
  environment— `main` avanza; sin `ref`, se ejecutaría código que nadie miró al
  aprobar.

### Nunca se publica un resultado fallido

El paso de refresco tiene `id`, y de ahí cuelga todo lo demás:

* El resumen con el diff y el artefacto se generan **sólo** si el refresco
  terminó bien.
* Si no, el resumen dice con todas las letras que esta corrida **no publica
  ningún artefacto** y que la instantánea del repositorio quedó intacta.
* Antes de publicar se comprueba que la fecha `capturada` del archivo sea la de
  hoy: lo que se sube es la lectura de esta corrida, no la instantánea
  versionada de siempre.

El modo de fallo que se evita es el peor de todos: alguien encuentra un
artefacto en una corrida roja, lo da por bueno y versiona la instantánea vieja
como si fuera producción de hoy.

### `SECURITY DEFINER`: qué mira el guard y qué no

Una función `SECURITY DEFINER` corre con los privilegios de **su dueño**. Si la
credencial del auditor puede ejecutar una, el «solo lectura» que se mide sobre
el rol no describe lo que ese rol puede hacer: describe lo que puede hacer
*directamente*, y hay un camino al lado.

**Alcanzable** son dos condiciones, y hacen falta las dos:

```sql
has_schema_privilege(current_user, n.oid, 'USAGE')     -- se puede nombrar
has_function_privilege(current_user, p.oid, 'EXECUTE') -- se puede ejecutar
```

en **cualquier** esquema que no sea interno del motor — no sólo `public` y
`graphql_public`. La credencial se conecta a **PostgreSQL**, no a PostgREST: un
esquema propio o `extensions` es tan alcanzable como `public`, y menos mirado.
La otra mitad importa igual: una función con `EXECUTE` a `PUBLIC` en un esquema
sobre el que el rol no tiene `USAGE` **no** se rechaza, porque no puede ni
nombrarla — un guard que ladrara por eso se vuelve ruido y a la tercera vez
alguien lo apaga.

#### El diagnóstico dice por dónde llega, porque el remedio depende de eso

Hay tres formas de que el privilegio alcance a la credencial, y el `REVOKE` que
las cierra es distinto:

| Procedencia | Remedio |
| --- | --- |
| `EXECUTE` a `PUBLIC` | `REVOKE EXECUTE ON FUNCTION f FROM PUBLIC;` |
| `GRANT` directo al auditor | `REVOKE EXECUTE ON FUNCTION f FROM <auditor>;` |
| Una membresía | **Quitar la membresía**, no tocar el rol intermedio: puede ser `authenticated`, y revocarle rompe la aplicación. La regla MEMBRESÍA ya lo rechaza aparte. |

Proponer el `REVOKE` equivocado es peor que no proponer ninguno: `… FROM PUBLIC`
sobre una función concedida directamente al auditor no hace **nada**, y deja
creer que el agujero se cerró. Por eso el mensaje trae `[vía …]` en cada
función.

#### Qué NO es esta regla

**No es un juicio sobre los privilegios de `anon` o de `authenticated`.** La
credencial del auditor es un rol independiente sin membresías —lo exige la regla
MEMBRESÍA—, y un rol así **no hereda** permisos concedidos explícitamente a
`anon` o a `authenticated`.

Los hechos, de una consulta de solo lectura al catálogo real de producción del
**2026-09-03 17:29 UTC**:

| | |
| --- | --- |
| `SECURITY DEFINER` en `public` | 249 |
| con `proacl` nulo o por defecto (`EXECUTE` a `PUBLIC`) | **0** |
| con `EXECUTE` efectivo procedente de `PUBLIC` | **0** |
| ejecutables explícitamente por `anon` | 1 |
| ejecutables explícitamente por `authenticated` | 118 |

Es decir: **producción no tiene ninguna `SECURITY DEFINER` abierta a `PUBLIC`**,
y por lo tanto este guard **no bloquea el refresco**. Lo que hay son permisos
explícitos a `anon` y `authenticated`, que son otra conversación —función por
función, con los advisors de Supabase delante— y que no se resuelve desde acá ni
con un `REVOKE` masivo.

> Una versión anterior de este documento afirmaba «26 de 246 ejecutables por
> `PUBLIC` en producción». Era **falso**: ese 26 salió de la reconstrucción local
> desde migraciones, donde una `CREATE FUNCTION` sin `REVOKE` posterior deja el
> ACL por defecto, y se atribuyó a producción sin medirla. Que la reconstrucción
> y producción difieran ahí es en sí mismo drift, y el auditor ya lo declara
> —29 de los 131 grupos de la baseline son grants de `EXECUTE`—.

#### La allowlist

`SECDEF_PERMITIDAS`, en `auditar.mjs`, está **vacía** y no es un trámite
llenarla: cada entrada afirma que esa función, corriendo como su dueño, no le da
a esta credencial nada que no debería tener. Es una afirmación sobre el **cuerpo**
de la función, y la firma quien revisa el PR que agrega la línea. Hay una prueba
que falla si deja de estar vacía, para que agregarla sea un acto visible.

### La cadena de conexión, antes de abrirla

La lista blanca del hostname **no alcanza**. libpq acepta parámetros en la URI y
varios mandan sobre el destino:

```
postgresql://u:p@db.<ref>.supabase.co:5432/postgres?hostaddr=203.0.113.9
```

pasa cualquier comprobación de hostname y **habla con otra máquina**: con
`hostaddr` libpq se conecta a esa IP y usa `host` sólo para el SNI y el
certificado. `host=` en la query hace lo mismo por la vía directa, y `options=`
puede deshacer el `default_transaction_read_only` que `PGOPTIONS` fija por
entorno — el guard que se apoya en el entorno, desactivado desde la URL.

Por eso `validarUrlLive()` es una lista blanca **de parámetros**:

| Regla | |
| --- | --- |
| Un solo host, y oficial | `db.<ref>.supabase.co` o `<región>.pooler.supabase.com`. Una lista `a:5432,b:5432` se rechaza: libpq prueba uno por uno. |
| Prohibidos | `host`, `hostaddr`, `port`, `dbname`, `user`, `password`, `service`, `servicefile`, `options`. |
| Permitidos, y sólo éstos | `sslmode`, `sslrootcert`, `connect_timeout`, `application_name`. |
| Sin repetidos | libpq se queda con el **último**: `sslmode=verify-full&sslmode=disable` se lee seguro y se conecta inseguro. |
| `sslmode` exigido | `require`, `verify-ca` o `verify-full`. Sin él libpq negocia y **acepta texto plano**; `disable`, `allow` y `prefer` también lo permiten. |

Con `sslmode=require` la conexión se cifra pero **no** se verifica el
certificado: protege del que escucha, no del que se hace pasar por la base. Se
acepta y se **recomienda** subir a `verify-full` con `sslrootcert=<ruta>` cuando
el runner tenga el certificado de la CA de Supabase.

La única excepción es un **socket de dominio Unix** (`?host=/…`), que no puede
alcanzar otra máquina: es lo que usa `--prueba-live` contra su clúster
desechable. No es un bypass — que un socket no termine versionado como
producción lo cuida el guard del proyecto, porque de esa URL no se deduce ningún
ref y sin ref el refresco exige `--proyecto` a mano.

### El job no commitea

`live` es de solo lectura de los dos lados: `contents: read` y una credencial
sin permisos de escritura. La huella refrescada sale como **artefacto** y con el
diff en el resumen del job; el PR que la versiona se abre aparte. Darle
`contents: write` a un job que además tiene acceso a la base de producción sería
juntar las dos mitades de un problema.

### Qué falta para encenderlo

```sql
CREATE ROLE drift_readonly LOGIN PASSWORD '…';
GRANT USAGE ON SCHEMA public, extensions TO drift_readonly;
```

Los **dos** esquemas: son los del `search_path`, y sin el segundo la huella no
coincide con la del dueño. Y **nada más**: sin `SELECT` sobre ninguna tabla, sin
membresías, sin `CREATE`. El rol así, pelado, ya alcanza para sacar la huella
completa —lo fija `--prueba-acl`—, y cualquier privilegio de más lo rechaza el
guard. Después, en el environment `production-db`, el secret
`SCHEMA_DRIFT_READONLY_URL` con su cadena de conexión, y la variable de
repositorio `SCHEMA_DRIFT_LIVE_HABILITADO` en `true`.

**Sobre la cadena de conexión.** Sirve tanto la conexión directa como el pooler
en modo sesión, y en los dos casos **`sslmode` es obligatorio**:

```
postgresql://drift_readonly:<clave>@db.<ref>.supabase.co:5432/postgres?sslmode=require
postgresql://drift_readonly.<ref>:<clave>@aws-1-<región>.pooler.supabase.com:5432/postgres?sslmode=require
```

Con el pooler hay que usar el modo **sesión** (5432), no el de transacción
(6543): `PGOPTIONS` —que es lo que fuerza la sesión a solo lectura— sólo rige en
modo sesión. El runner de Actions decide cuál hace falta: si su red no alcanza
la conexión directa, el pooler es la vía.

Y **nada más en la query**: `hostaddr`, `host`, `port`, `dbname`, `user`,
`password`, `service`, `servicefile` y `options` se rechazan, igual que
cualquier parámetro repetido o no documentado (ver «La cadena de conexión, antes
de abrirla»). Si el runner tiene el certificado de la CA de Supabase, conviene
`sslmode=verify-full&sslrootcert=<ruta>` en lugar de `require`.

Siguen valiendo las tres condiciones de siempre, y ninguna es opcional:

1. **Una credencial dedicada de solo lectura.** Un rol de Postgres con `USAGE`
   sobre `public`, y nada más. Ese rol ya **alcanza** para sacar la huella
   completa: lo fija `--prueba-acl` (ver «Los grants se leen del ACL»). Antes no
   alcanzaba, y el fallo era silencioso — los grants salían vacíos sin error.
   **No se reutiliza `SUPABASE_ACCESS_TOKEN`**: ese token es de la Management API
   y puede aplicar DDL, crear y borrar ramas y leer secretos. Que
   `drift-esquema.yml` ya lo use no es una razón para extender su alcance — es
   una razón más para no hacerlo.
2. **El environment `production-db`.** El secreto vive ahí, no a nivel de
   repositorio. Desde el 2026-09-01 ese environment está restringido a `main`,
   con revisores requeridos y sin bypass de administradores.
3. **Nunca desde `pull_request_target`.** Ese disparador corre con el token y los
   secretos del repositorio base sobre código que propone quien abre el PR. El
   job live sólo se dispara a mano (`workflow_dispatch`), donde la referencia es
   de confianza. El job offline no usa `pull_request_target` tampoco, porque no
   necesita ningún secreto.

Mientras tanto el job `live` de `.github/workflows/schema-drift.yml` está apagado
por `vars.SCHEMA_DRIFT_LIVE_HABILITADO`. Apagado, no sin escribir: el camino
completo corre en CI en cada PR mediante `--prueba-live`, sin credenciales y sin
red.

## Cómo se prueban las propiedades de la huella

`--verificar-huella` corre contra un catálogo real, no contra una
reimplementación en JavaScript: lo que puede fallar es la serialización en SQL, y
probar el doble no prueba la cosa.

| Propiedad | Cómo se comprueba |
| --- | --- |
| **Determinismo** | Dos corridas consecutivas dan la huella byte a byte idéntica. |
| **Estabilidad ante entradas equivalentes** | El mismo catálogo leído con otro plan de ejecución (`enable_seqscan=off`, `enable_hashagg=off`) da la misma huella. Si el orden del agregado dependiera del plan y no del `ORDER BY … COLLATE "C"`, esto lo delataría. |
| **Formato** | Los 2 432 grupos con SHA-256 de 64 hex. |
| **Sensibilidad al cambio** | Quitar un `NOT NULL` —el cambio más pequeño que existe: no toca nombres, ni tipos, ni conteos— mueve **exactamente un** grupo y deja el conteo igual. |

`--prueba-espacios` cubre los cuatro casos en que el espaciado **es** contenido:

| Caso | Grupo que debe moverse |
| --- | --- |
| Función que devuelve `'a  b'` frente a `'a b'` | `funcion:esp_literal()` |
| `default ' '` frente a `default ''` | `tabla:esp_tabla/columnas` |
| Policy comparando contra un literal con uno y dos espacios | `tabla:esp_tabla/policies` |
| Cuerpo dollar-quoted con un salto de línea dentro de la cadena | `funcion:esp_dollar()` |

Reintroduciendo la normalización anterior, los casos 1 y 4 fallan — que es
exactamente el agujero que cerró quitarla. Los casos 2 y 3 pasan en ambas
versiones porque esas dimensiones nunca se normalizaron.

### Los grants se leen del ACL

`information_schema.role_table_grants` y `role_routine_grants` son **relativos al
rol**: sólo proyectan concesiones en las que el usuario actual es otorgante,
otorgado, o miembro de alguno de los dos. Medido sobre un clúster desechable con
el patrón de roles de Supabase:

| Rol | Filas visibles | ¿Lee datos de negocio? |
| --- | --- | --- |
| `postgres` (dueño) | 28 | sí |
| Rol de solo lectura, `USAGE` sobre `public` | **0** | no |
| Rol de solo lectura + membresía, `INHERIT` | 28 | **sí** |
| Rol de solo lectura + membresía, `NOINHERIT` | **0** | no |

No hay configuración que sea a la vez de solo lectura y capaz de ver los grants
por esa vía: las únicas que los ven pueden leer el camino de dinero. Con la
credencial que el modo live necesita, la huella habría salido con la cadena
vacía en las 563 dimensiones `/grants` **sin que nada fallara** — un falso
negativo que además habría quedado grabado en `huella-produccion.json`.

`relacl` y `proacl` son columnas de `pg_class`/`pg_proc`, no son relativas al rol
y las lee cualquiera que pueda leer el catálogo. `--prueba-acl` fija estas
propiedades:

| Propiedad | Cómo se comprueba |
| --- | --- |
| **Equivalencia** | Las 260 tablas y 303 funciones serializan idéntico por ACL que por `information_schema` para un rol privilegiado. Es lo que permite que `huella-produccion.json`, capturada con la formulación anterior, siga siendo válida sin regenerarla. |
| **No vacuidad** | Se exige que haya objetos comparados y con grants no vacíos: dos conjuntos vacíos coinciden siempre. |
| **Alcanzabilidad** | Un rol con `USAGE` sobre `public` y sin membresías saca los mismos 563 grupos `/grants` que el dueño. |
| **Contraprueba** | Ese mismo rol ve **0** de las 7 306 concesiones que `information_schema` le muestra al dueño. Si algún día se volviera a leer de ahí, la alcanzabilidad se rompería en silencio. |
| **Sensibilidad** | Revocar un `SELECT` mueve exactamente un grupo y baja su conteo en uno — si la lectura por ACL devolviera algo constante, todo lo anterior seguiría pasando. |
| **Compatibilidad de la marca** | Hoy no hay **ni un** aclitem con grant option en el catálogo, así que la marca de la regla 8 no puede mover ninguna huella ya capturada. Se mide antes de nada; si dejara de ser cierto, la prueba falla. |
| **La marca se ve** | `GRANT SELECT … WITH GRANT OPTION` mueve exactamente el grupo de esa tabla, y `GRANT EXECUTE … WITH GRANT OPTION` el de esa función. |
| **Y no se cuenta dos veces** | El conteo **no** cambia: `aclexplode` devuelve una fila por privilegio con `is_grantable` al lado, y la marca se agrega a esa fila. |
| **Ida y vuelta** | Al quitar la grant option, el grupo vuelve **byte a byte** a su huella anterior: un ACL sin grant option serializa como antes de la regla 8. Es la mitad que mantiene comparable la instantánea versionada. |

**Por qué hacía falta la marca.** La formulación anterior descartaba
`is_grantable`: `authenticated=r/postgres` y `authenticated=r*/postgres`
serializaban igual. Conceder la facultad de **re-conceder** un privilegio —el
paso previo a que un rol reparta acceso por su cuenta— era invisible para el
auditor.

### La baseline en la rama base

Sólo la **ausencia comprobada** del archivo cuenta como «primera vez». Un
`try/catch` alrededor de `git show` fallaba igual con el archivo ausente, con una
ref inexistente y con un checkout incompleto, y los tres pasaban por «primera
vez»: bastaba un `fetch-depth: 1` para **apagar el trinquete en silencio**. Ahora
se separan: `rev-parse --verify` (¿existe la ref?), `cat-file -e <ref>^{tree}`
(¿están sus objetos?) y sólo entonces `ls-tree` — cuyo resultado vacío, con el
árbol completo delante, sí es información.

En `vitest` se prueba lo que sí es JavaScript: que el parser rechace una huella
que no sea SHA-256 de 64 hex (incluido el md5 truncado anterior), que entradas
equivalentes —CRLF, espacios sobrantes, líneas en blanco— den el mismo mapa, y
que ningún valor versionado haya quedado truncado.

## Estado al 2026-09-01

- **449/449** migraciones aplican sobre una base vacía. El repositorio levanta el
  esquema solo.
- **2 438** grupos comparados, **2 307 coinciden**, **131 difieren** — de los
  cuales **12 son cosméticos** (espaciado en cuerpos de función), marcados como
  tales en la baseline.
- Las 260 tablas existen a ambos lados con el mismo estado de RLS.
- De los 131: 37 definiciones de función (12 de ellas cosméticas), 29 grants de
  `EXECUTE`, 25 índices, 16 columnas, 13 constraints, 8 policies y 3 triggers.
- La lista fue 120 → 119 → 131. La subida es **sólo la deuda cosmética que antes
  estaba oculta** por la normalización; no apareció ninguna diferencia semántica
  nueva.
- Las diferencias de **policies y grants están clasificadas como seguridad
  prioritaria** en #826. Ninguna se corrige aquí: este PR sólo mide.
