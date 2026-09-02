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
# antes (byte a byte) y alcanzable por un rol dedicado de solo lectura.
node scripts/schema-drift/auditar.mjs --prueba-acl

# El modo live de punta a punta contra un clúster desechable que hace de
# producción: conexión por URL con otro rol, credencial medida, guards y
# escritura. Sin credenciales y sin red.
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
| El rol es superusuario, tiene `BYPASSRLS`, puede crear roles o bases, o puede escribir en alguna tabla de `public` | Leer producción con una credencial que además puede modificarla. Se **mide**, no se declara. |
| La sesión no quedó en solo lectura | `PGOPTIONS` fuerza `default_transaction_read_only` desde la conexión; si no rigió, se aborta. |
| El rol no tiene `USAGE` sobre algún esquema del `search_path` | El fallo más caro: no rompe nada, sólo serializa `extensions.citext` donde el dueño escribe `citext`, y el refresco quedaría versionado con drift permanente. |
| La URL apunta a otro proyecto que el declarado | Capturar el **sandbox** y versionarlo como producción. El ref se deduce del host (`db.<ref>.supabase.co`) o del usuario del pooler (`<rol>.<ref>`, con cualquier rol, no sólo `postgres`). Si no se puede deducir, hay que pasar `--proyecto`: no se adivina. |
| Algún valor no es SHA-256 de 64 hex | Una lectura truncada o a medias. |
| **Todos** los grupos `/grants` vinieron vacíos | El síntoma exacto de leer los privilegios con un catálogo relativo al rol. Que algunos estén vacíos es normal; que lo estén todos, no. |
| El número de grupos cambia más de un 20 % | Haber leído otra base. Un cambio así merece mirarse a mano. |

Y la URL **nunca se imprime**: viaja por el entorno, y el script recorta de sus
propios mensajes de error cualquier cadena de conexión —y la contraseña por
separado— antes de escribirlos.

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
coincide con la del dueño. Después, en el environment `production-db`, el secret
`SCHEMA_DRIFT_READONLY_URL` con su cadena de conexión, y la variable de
repositorio `SCHEMA_DRIFT_LIVE_HABILITADO` en `true`.

**Sobre la cadena de conexión.** Sirve tanto la conexión directa
(`db.<ref>.supabase.co:5432`) como el pooler en modo sesión
(`aws-0-<región>.pooler.supabase.com:5432`, usuario `drift_readonly.<ref>`). Con
el pooler hay que usar el modo **sesión**, no el de transacción: `PGOPTIONS`
—que es lo que fuerza la sesión a solo lectura— sólo rige en modo sesión. El
runner de Actions decide cuál hace falta: si su red no alcanza la conexión
directa, el pooler es la vía.

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
y las lee cualquiera que pueda leer el catálogo. `--prueba-acl` fija las cuatro
propiedades:

| Propiedad | Cómo se comprueba |
| --- | --- |
| **Equivalencia** | Las 260 tablas y 303 funciones serializan idéntico por ACL que por `information_schema` para un rol privilegiado. Es lo que permite que `huella-produccion.json`, capturada con la formulación anterior, siga siendo válida sin regenerarla. |
| **No vacuidad** | Se exige que haya objetos comparados y con grants no vacíos: dos conjuntos vacíos coinciden siempre. |
| **Alcanzabilidad** | Un rol con `USAGE` sobre `public` y sin membresías saca los mismos 563 grupos `/grants` que el dueño. |
| **Contraprueba** | Ese mismo rol ve **0** de las 7 306 concesiones que `information_schema` le muestra al dueño. Si algún día se volviera a leer de ahí, la alcanzabilidad se rompería en silencio. |
| **Sensibilidad** | Revocar un `SELECT` mueve exactamente un grupo y baja su conteo en uno — si la lectura por ACL devolviera algo constante, todo lo anterior seguiría pasando. |

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
