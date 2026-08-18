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

- **Preflight fail-closed**: se exigen las **seis** variables. Con la URL puesta
  pero una credencial vacía, el harness se auto-saltaba y terminaba verde con
  cero pruebas — sin ni siquiera el warning. Ahora falta cualquiera y el job
  falla.
- **Verificación de salida** (`scripts/assert-rls-ejecutado.mjs`): lee el
  reporte JSON de vitest y exige pruebas > 0, cero fallos, ausencia del marcador
  `omitido` y un piso mínimo de aserciones.

La única omisión legítima es un **PR desde un fork**: GitHub no expone secretos
a los forks por diseño, así que ahí el job se omite **explícitamente** (notice +
resumen) y **no ejecuta código del fork con credenciales**.

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

**El harness declara 127 aserciones** cuando está habilitado (128 contando el
marcador de omisión, que sólo existe en la rama sin credenciales).

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
SEED_SERVICE_ROLE_KEY="<service_role del sandbox>" \
SEED_ANON_KEY="<anon public del sandbox>" \
SEED_CONFIRM=si \
node scripts/seed-rls-sandbox.mjs
```

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
- Pruebas ejecutadas: 127 (total 127, fallos 0)
- Marcador de omisión "omitido": ausente
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

`scripts/assert-rls-ejecutado.mjs` ya exige un piso de aserciones para que un
archivo recortado no pase por harness completo. El paso natural siguiente es
hacerlo por **escenario** en vez de por recuento:

- Declarar en `coverage.json` los nombres de los bloques obligatorios
  (aislamiento no trivial, negative write, guards de RPC) y que el verificador
  falle si alguno no aparece en el reporte, aunque el total supere el piso.
- Aplicar el mismo patrón al job de E2E cuando se active: hoy su ausencia es un
  warning, y un warning no bloquea nada.
