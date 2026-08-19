# Activar el harness de RLS

> **Estado hoy:** el job `RLS harness (server-side)` **falla** en PRs internos y
> en push a `main` mientras no existan los seis secretos `RLS_*`. Eso es
> deliberado: antes quedaba **verde sin ejecutar nada**, y un verde por omisión
> es indistinguible de un verde por verificación. Un job que miente sobre
> cobertura es peor que uno rojo.

## Por qué importa más de lo que parece

El harness verifica, contra un Supabase real y con dos usuarios de empresas
distintas, que **A no ve datos de B**. Eso es lo que la auditoría 2026-07-28
puso como prioridad número uno — y todo el Bloque A se validó por análisis
estático de las migraciones y por `security-guard.mjs` sobre el catálogo de
producción, **nunca probando el aislamiento de verdad desde un cliente
autenticado**.

Un análisis estático te dice que la policy existe y tiene la forma correcta. No
te dice que el motor la aplique como creés.

## Los dos huecos que este harness cierra

### 1. El verde por omisión

`vitest run` sobre un archivo cuyo `describe` está bajo `describe.skipIf(...)`
termina con **exit code 0 y cero pruebas ejecutadas**. Para GitHub Actions eso
es un job verde. Por eso ahora hay dos guardas:

- **Preflight fail-closed** (`scripts/rls-preflight.mjs`): se exigen las **seis**
  variables. Con la URL puesta pero una credencial vacía, el harness se
  auto-saltaba y terminaba verde con cero pruebas — sin ni siquiera el warning.
  Ahora falta cualquiera y el job falla.
- **Verificación de salida** (`scripts/assert-rls-ejecutado.mjs`): lee el
  reporte JSON de vitest y exige pruebas > 0, cero fallos, **cero skips o todos**
  y que **todos los escenarios obligatorios** de `coverage.json` aparezcan como
  pruebas pasadas.

Las **únicas** omisiones legítimas son los contextos en que GitHub no entrega
los Actions secrets por diseño:

| Contexto | Por qué |
|---|---|
| PR desde un **fork** | GitHub no expone secretos a los forks |
| Ejecución de **Dependabot** | los Actions secrets no llegan a `dependabot[bot]`; sólo los Dependabot secrets, que este repo no usa |

En ambos el job se omite **explícitamente** (notice + resumen), **sin ejecutar
código ajeno con credenciales** y **sin recurrir a `pull_request_target`**, que
sí las expondría al código del PR. El aislamiento se verifica igualmente en el
push a `main` posterior al merge.

La tabla de verdad del gate (fork · Dependabot · PR interno · push a main) tiene
prueba contractual en `scripts/__tests__/rls-preflight.test.mjs`.

### Por qué el verificador ya no busca un marcador de omisión

La primera versión rechazaba el reporte si el nombre de alguna prueba contenía
`omitido`. Era un **fallo permanente**: vitest incluye las pruebas *skipped* en
el reporte JSON, así que el `it.skip('omitido — …')` del bloque alternativo
aparecía **siempre**, también con credenciales. El job no podía ponerse verde ni
con el sandbox montado. El bloque alternativo se eliminó del harness y la
constancia de la omisión la da el preflight, que es quien tiene la información.

### 2. El verde por conjuntos vacíos

La aserción de aislamiento es, en esencia:

```ts
for (const co of companyIdsQueVeB) {
  expect(companyIdsQueVeA.has(co)).toBe(false)
}
```

**Si A y B no ven ninguna fila, ambos conjuntos son vacíos, el bucle no itera y
el test pasa sin comparar nada.** Un sandbox con dos usuarios pero sin datos
produce un verde igual de hueco que el no-op — sólo que más difícil de detectar,
porque ahora *parece* que corrió.

Por eso existe `src/test/rls/coverage.json`, la fuente única que comparten el
seed y el harness:

- **`noTriviales`** — el seed siembra filas de las dos empresas y **verifica**,
  entrando como cada usuario, que ve ≥1 fila propia y 0 de la otra. El harness
  **exige conjuntos no vacíos** antes de comprobar la disjunción.
- **`estructurales`** — la tabla puede estar vacía. El harness comprueba que la
  policy responde y que no hay fuga observable, pero **su disjunción no
  demuestra aislamiento** y no debe declararse como tal.

Mover una tabla a `noTriviales` sin sembrarla rompe el seed (falla al verificar)
y rompe el harness (falla la aserción de no-vacío). Es deliberado: la única
forma de declarar cobertura real es tenerla.

---

## Qué cubre exactamente

**El harness declara 125 aserciones.** Sin credenciales las 125 salen como
*skipped* y el verificador lo detecta (cero pasadas); con credenciales deben
pasar las 125, sin ninguna omitida.

### Tablas con aislamiento REAL demostrado (`noTriviales`)

Cuatro tablas tenant-scoped, sembradas con datos de A y de B:

| Tabla | Qué siembra el seed | Prerrequisitos que crea |
|---|---|---|
| `proveedores` | 1 proveedor por empresa | — |
| `conta_cuentas` | 1 cuenta contable por empresa | — |
| `cuotas_condominio` | 1 cuota por empresa | proyecto + unidad |
| `documentos_fiscales` | 1 documento por empresa | — |

Para cada una, el seed comprueba **en ambos sentidos**: A ve su fila y ninguna
de B; B ve la suya y ninguna de A. El harness añade, por tabla, tres
aserciones: A no vacío, B no vacío, y disjunción.

### Tablas con cobertura ESTRUCTURAL (pueden estar vacías)

Diez tablas donde **no se demuestra aislamiento real**, sólo que la policy
responde sin error y sin fuga observable:

| Tabla | Por qué no se siembra |
|---|---|
| `notifications_outbox` | la llena el orquestador, no un INSERT directo |
| `user_invitations` | exige el flujo de invitación por correo |
| `conta_asientos` | publicar exige la RPC y el folio correlativo |
| `facturas_proveedor` | exige orden de compra y recepción |
| `presupuestos` | exige partidas y ejercicio abierto |
| `cuentas_bancarias` | exige catálogo contable enlazado |
| `banco_movimientos` | exige cuenta bancaria e importación |
| `unidad_residentes` | exige portal activo y cliente residente |
| `company_email_configs` | exige OAuth de correo por tenant |
| `fuentes_agua` | exige el módulo de agua configurado |

### El resto de la superficie

Además del aislamiento por tenant, el harness cubre —y esto no depende del
seed— tablas de secretos deny-all, tablas sin policy de SELECT, el store de
sesiones, el deny total para `anon` sobre 31 tablas de negocio, el aislamiento
user-scoped, las escrituras negativas cross-tenant y los guards `anon` /
`authenticated` sobre los RPCs sensibles (notificaciones, ERP, bóvedas, portal).

### Escenarios obligatorios

`coverage.json` declara diez bloques que **deben** aparecer como pruebas pasadas
en el reporte. Un piso numérico no bastaba: se podía borrar un `describe` entero
y seguir por encima del mínimo. Ahora borrar cualquiera de estos rompe el job
aunque el total suba:

`secretos-deny-all` · `anon-deny-negocio` · `tenant-no-trivial` ·
`tenant-estructural` · `user-scoped` · `negative-write` · `rpc-notificaciones` ·
`rpc-erp` · `rpc-bovedas` · `rpc-portal`

### Las pruebas negativas apuntan a recursos que EXISTEN

Las escrituras y los RPC de A contra "el tenant ajeno" usan el `company_id`,
`project_id` y `unidad_id` **reales de B**, leídos entrando como B. Antes se
usaba un UUID cero, y eso debilitaba todas las pruebas: un INSERT con
`project_id` inexistente puede morir en la **foreign key** antes de que RLS se
evalúe, así que el verde no demostraba que la policy funcionara. Con FKs
válidas, el rechazo sólo puede venir de RLS. Lo mismo con los RPC: negar la
metadata de una empresa que existe es una comprobación de autorización; negar la
de un id inventado no prueba nada.

### Las pruebas deny-all distinguen "denegado" de "roto"

`expect(data ?? []).toHaveLength(0)` convertía **cualquier** error en «0 filas»:
una tabla inexistente, un schema cache desactualizado, una migración sin aplicar
o un fallo de red producían el mismo verde que una policy funcionando. Ahora
sólo se acepta: **sin error y con cero filas**, o un error cuyo código esté en la
lista blanca de denegación (`42501`, `PGRST116`). Cualquier otro código falla e
informa cuál era.

---

## Modelo de credenciales

| Credencial | Dónde vive | Por qué |
|---|---|---|
| `service_role` del sandbox | **sólo en la máquina del operador**, al correr el seed | Es BYPASSRLS: con ella se puede leer y escribir cualquier tenant. En un secreto de CI, cualquier workflow comprometido la tendría |
| `anon` del sandbox | secreto de GitHub | Es pública por diseño; sin JWT no abre nada |
| Usuarios A y B | secretos de GitHub | `company_owner` de dos empresas de juguete, en un proyecto desechable, sin datos reales |

**Nunca producción.** El seed se niega a correr contra el ref de prod
(`nnsqmeigtgewatameexo`) y exige `SEED_CONFIRM=si` para cualquier otro proyecto.

---

## Paso 1 — Crear el proyecto sandbox

En [supabase.com/dashboard](https://supabase.com/dashboard): **New project**.

- Nombre sugerido: `control-agua-rls-sandbox`
- **No** uses producción. El script se niega, pero la razón de fondo es que crea
  empresas y usuarios de prueba.

## Paso 2 — Aplicar el esquema

El sandbox necesita las mismas tablas y policies que producción:

```bash
supabase link --project-ref <ref-del-sandbox>
supabase db push
```

Si `db push` se queja del historial (el repo arrastra numeraciones paralelas —
ver `docs/SUPABASE_PREVIEW_BRANCHES.md`), aplicá las migraciones con el workflow
`apply-migration.yml` apuntando al sandbox, o pegá el SQL por el editor del
dashboard.

## Paso 3 — Sembrar y verificar

Las claves salen de **Dashboard → Project Settings → API**.

```bash
SEED_SUPABASE_URL="https://<ref>.supabase.co" \
SEED_EXPECTED_REF="<ref>" \
SEED_SERVICE_ROLE_KEY="<service_role del sandbox>" \
SEED_ANON_KEY="<anon public del sandbox>" \
SEED_CONFIRM=si \
node scripts/seed-rls-sandbox.mjs
```

Cuatro cerrojos de destino, todos obligatorios, porque este script usa la
`service_role` (BYPASSRLS) y apuntarlo al proyecto equivocado no es un CI en
rojo sino datos de un cliente contaminados:

| Cerrojo | Qué impide |
|---|---|
| Dominio en la lista de `coverage.json` | sembrar contra un host que no es Supabase |
| Ref de producción en lista negra | el accidente conocido |
| `SEED_EXPECTED_REF` == ref de la URL | **cualquier otro** proyecto: hay que declarar de antemano el destino, así que un copiar-pegar de la URL equivocada no ejecuta nada |
| `SEED_CONFIRM=si` | la ejecución distraída |

`SEED_ANON_KEY` es **obligatoria**: es lo que permite al script entrar como cada
usuario y demostrar el aislamiento. Antes era opcional, y sin ella el seed
sembraba y salía verde sin haber comprobado nada — el mismo hueco a otro nivel.

El script sólo imprime **«Sandbox listo»** si autenticó a los dos usuarios y
verificó las cuatro tablas no triviales en ambos sentidos. Si algo falla, sale
con error y te dice qué mover a `estructurales`.

Es idempotente y **regenera las contraseñas en cada corrida**: si las perdés,
volvé a correrlo y usá las nuevas.

## Paso 4 — Pegar los secretos

**Settings → Secrets and variables → Actions → New repository secret.**

| Secreto | De dónde sale |
|---|---|
| `RLS_SUPABASE_URL` | URL del sandbox |
| `RLS_SUPABASE_ANON_KEY` | Dashboard → API → `anon public` |
| `RLS_USER_A_EMAIL` · `RLS_USER_A_PASSWORD` | los imprime el script |
| `RLS_USER_B_EMAIL` · `RLS_USER_B_PASSWORD` | los imprime el script |

**Los seis.** Con cinco, el preflight falla — a propósito.

## Paso 5 — Comprobar que ahora sí corre

Ya no hace falta leer el log a ojo: el job **falla solo** si no verificó nada.
Aun así, la señal positiva está en el resumen de la corrida:

```
✅ Harness RLS ejecutado (aislamiento multi-tenant verificado)
- Pruebas pasadas: 125 (total 125, fallos 0, omitidas 0)
- Escenarios obligatorios presentes: 10/10
```

Y el artefacto `rls-report-<run_id>` guarda el reporte JSON. **No contiene
secretos**: sólo nombres de prueba (literales del repo) y recuentos.

---

## Limitaciones (lo que este harness NO demuestra)

1. **Diez de las catorce tablas tenant-scoped tienen cobertura sólo
   estructural.** Su disjunción se cumple de forma trivial porque están vacías.
   No es cobertura de aislamiento; está listado arriba tabla por tabla.
2. **El sandbox no tiene datos de producción.** Verifica que *las policies
   aíslan*, no que los datos reales estén bien clasificados.
3. **Dos tenants, no N.** Se prueba A↔B. Un bug que sólo aparezca con tres o más
   empresas, o con roles distintos de `company_owner`, no se detecta.
4. **El esquema del sandbox puede derivar del de producción** si alguien aplica
   migraciones en un sitio y no en el otro. `security-guard.yml` sigue siendo el
   que mira el catálogo real de prod.
5. **Los E2E siguen siendo no-op verdes.** Se abordan en un PR aparte; su gate
   por `E2E_BASE_URL` no se ha tocado aquí.

---

## Recomendaciones para hacer esto reproducible

### Probar el commit exacto de cada PR

Hoy el harness corre contra un sandbox **compartido y de larga vida**: dos PRs
simultáneos ven el mismo estado, y el esquema del sandbox puede ir por detrás de
las migraciones del PR. Para que el harness pruebe *ese commit*:

- Usar **preview branches de Supabase** (ver `docs/SUPABASE_PREVIEW_BRANCHES.md`):
  cada PR obtiene su propia base con las migraciones del PR aplicadas. El job
  pasaría a leer la URL del preview branch en vez de un secreto fijo, y el seed
  correría contra ella al inicio del job.
- Mientras tanto, dejar constancia en el resumen del job de **qué ref de sandbox
  se usó**, para que un verde sea atribuible a un esquema concreto.

### Fixtures deterministas

El seed actual es idempotente pero genera **contraseñas nuevas en cada corrida**
y usa nombres fijos. Para fixtures reproducibles:

- Derivar los identificadores de un **semilla estable** (por ejemplo el hash del
  commit) en vez de nombres fijos, de modo que dos corridas concurrentes no se
  pisen las filas.
- Separar «crear el tenant» de «sembrar los datos», y que la parte de datos sea
  un `TRUNCATE` + `INSERT` de un fixture versionado, para que el estado sea
  función del commit y no del historial de corridas.
- Fijar los UUID de las empresas de prueba (constantes en el fixture) para poder
  afirmar en el harness **qué** company_id espera ver cada usuario, no sólo que
  los conjuntos sean disjuntos.

### Fallar si se omiten escenarios críticos

**Hecho.** `coverage.json` declara los diez escenarios obligatorios y
`scripts/assert-rls-ejecutado.mjs` falla si alguno no aparece como prueba pasada,
aunque el total supere el piso. El piso numérico queda como red secundaria.

Pendiente: aplicar el mismo patrón al job de E2E cuando se active — hoy su
ausencia es un warning, y un warning no bloquea nada. Va en el PR de E2E.
