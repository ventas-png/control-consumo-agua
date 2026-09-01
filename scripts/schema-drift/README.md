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

## Qué **no** guarda

- **Ni una fila.** La huella es DDL agregado y hasheado. No hay un solo `SELECT`
  sobre una tabla de negocio, ni un `count(*)`.
- **Nada fuera de `public`.** Ni `auth`, ni `storage`, ni `vault`. El andamiaje
  de `bootstrap.sql` no se compara.
- **Ni contraseñas, ni tokens, ni cadenas de conexión.** Los archivos versionados
  contienen sólo `clave → md5(12):n`. Hay un guard en `__tests__` que falla si
  aparece algo con forma de secreto.

## Cómo se usa

```bash
# Audita: reconstruye, saca la huella y compara contra la baseline.
node scripts/schema-drift/auditar.mjs

# Igual, y además rechaza que la baseline haya crecido respecto de la rama base.
node scripts/schema-drift/auditar.mjs --trinquete-contra origin/main

# Sólo valida el archivo de baseline (rápido, sin levantar Postgres).
node scripts/schema-drift/auditar.mjs --solo-baseline

# Propiedades de la huella contra un catálogo real: determinismo, estabilidad
# ante el mismo catálogo leído con otro plan, formato y sensibilidad al cambio.
node scripts/schema-drift/auditar.mjs --verificar-huella

# El espaciado dentro del contenido (literales, dollar-quoted, defaults,
# policies) DEBE mover la huella. Cuatro casos; con la normalización anterior
# fallaban dos.
node scripts/schema-drift/auditar.mjs --prueba-espacios

# Prueba negativa: inyecta una columna y una policy que nadie declara.
# DEBE salir distinto de cero.
node scripts/schema-drift/auditar.mjs --prueba-negativa

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

El auditor falla en tres casos:

| Situación | Resultado |
| --- | --- |
| Un grupo que difiere y **no está** en la baseline | `DRIFT NUEVO` → falla |
| Un grupo declarado cuyas huellas **cambiaron** | `DRIFT AGRAVADO` → falla |
| Una entrada de la baseline que **ya no** corresponde a drift | falla, pidiendo que se retire |

Fijar las huellas no estaba en el diseño original: lo destapó la primera prueba
negativa real. Inyectar una policy inesperada en `security_logs` no rompía nada,
porque `security_logs/policies` ya estaba en la lista. Una baseline por clave se
tragaba cualquier cambio posterior — es decir, apagaba la alarma justo en las
tablas donde más importa.

**La lista sólo puede encoger.** `--trinquete-contra origin/main` rechaza un PR
que agregue entradas: un drift nuevo se cierra con una migración forward-only,
nunca ampliando la baseline. Que la entrada se retire en el mismo PR que la
arregla es intencional.

## Modo live — **bloqueado**

Refrescar `huella-produccion.json` contra el catálogo real está implementado a
medias **a propósito**. La instantánea versionada envejece, y mientras no se
refresque, un cambio hecho en producción fuera de banda no se ve. Ése es el
límite honesto de la garantía que da este auditor hoy.

Para desbloquearlo hacen falta tres cosas, y ninguna es opcional:

1. **Una credencial dedicada de solo lectura.** Un rol de Postgres con `USAGE`
   sobre `public` y `SELECT` sobre `pg_catalog`/`information_schema`, y nada más.
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
por `vars.SCHEMA_DRIFT_LIVE_HABILITADO` y documenta exactamente qué falta.

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
