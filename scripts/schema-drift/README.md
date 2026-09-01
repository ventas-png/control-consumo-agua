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
| `huella-produccion.json` | Instantánea del catálogo de producción. Permite auditar en CI **sin ninguna credencial**. |
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
- `produccion` y `repo` — **las huellas concretas**. La baseline declara *esta*
  diferencia, no «lo que sea que pase en esta tabla».

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

## Estado al 2026-09-01

- **449/449** migraciones aplican sobre una base vacía. El repositorio levanta el
  esquema solo.
- **2 438** grupos comparados, **2 318 coinciden**, **120 difieren**.
- Las 260 tablas existen a ambos lados con el mismo estado de RLS.
- De las 120: 25 índices, 26 definiciones de función, 29 grants de `EXECUTE`,
  16 columnas, 13 constraints, 8 policies y 3 triggers.
- Las diferencias de **policies y grants están clasificadas como seguridad
  prioritaria** en #826. Ninguna se corrige aquí: este PR sólo mide.
