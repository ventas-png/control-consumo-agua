# Activar el harness de RLS

> **Estado hoy (2026-08-20): el sandbox está montado y el harness corre de
> verdad.** El job `RLS harness (server-side)` se ejecuta con las siete variables
> `RLS_*` cargadas, en PRs internos y en push a `main`. Evidencia de la corrida
> sobre `ec150b7` ([run 32382213772](https://github.com/ventas-png/control-consumo-agua/actions/runs/32382213772)):
>
> ```
> ✓ src/test/rls/rlsHarness.test.ts (128 tests) 9961ms
> ✅ Harness RLS ejecutado de verdad: 128 pruebas pasadas, 0 fallos, 0 omitidas,
>    7 escenarios, 23 RPC obligatorias y 45 evidencias acreditadas
> ```
>
> Desde esa corrida, «aislamiento verificado en CI» **sí** se puede citar — pero
> con el alcance exacto de [Qué cubre exactamente](#qué-cubre-exactamente) y no
> más: cuatro tablas con aislamiento real, diez con cobertura sólo estructural y
> once de las 23 RPC con garantía de tenant. Las
> [Limitaciones](#limitaciones-lo-que-este-harness-no-demuestra) no se movieron
> por estar el job en verde; estar verde no las borra.
>
> El gate sigue siendo **fail-closed**: si faltara cualquiera de las siete
> variables, el job **falla** en vez de quedar verde. Antes quedaba **verde sin
> ejecutar nada**, y un verde por omisión es indistinguible de un verde por
> verificación. Un job que miente sobre cobertura es peor que uno rojo.
>
> Los **pasos 1–4** de abajo ya se ejecutaron una vez: quedan como el
> procedimiento para **rehacer** el sandbox —o montar otro—, no como trabajo
> pendiente.

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

- **Preflight fail-closed** (`scripts/rls-preflight.mjs`): se exigen las **siete**
  variables. Con la URL puesta pero una credencial vacía, el harness se
  auto-saltaba y terminaba verde con cero pruebas — sin ni siquiera el warning.
  Ahora falta cualquiera y el job falla.
- **Verificación de salida** (`scripts/assert-rls-ejecutado.mjs`): lee el
  reporte JSON de vitest y exige pruebas > 0, cero fallos, **cero skips o todos**,
  que **todos los escenarios obligatorios** de `coverage.json` aparezcan como
  pruebas pasadas y que **cada una de las 23 RPC críticas** esté nombrada en
  alguna de ellas.

Hay dos contextos en que GitHub **no entrega** los Actions secrets por diseño, y
sólo en eventos `pull_request`:

| Contexto | Por qué |
|---|---|
| PR desde un **fork** | GitHub no expone secretos a los forks |
| PR de **Dependabot** | los Actions secrets no llegan a `dependabot[bot]`; sólo llegan los *Dependabot secrets*, que son un almacén aparte |

Identificarlos sirve para dar un mensaje honesto —«esto no lo arreglás poniendo
los secretos»— pero **no cambia el desenlace: el check queda en rojo**.

#### Por qué una omisión también bloquea

Antes, estos dos casos salían con exit 0 y un `::notice`: un check **verde** en un
PR cuyo aislamiento **nadie había verificado**. Y un check verde es exactamente lo
que autoriza a fusionar.

El argumento de entonces —«se valida igualmente en el push a `main` posterior al
merge»— confunde **detección** con **prevención**. Cuando ese job falla, el cambio
**ya está en main**. Y encima ni siquiera era cierto: con auto-merge, el push a
`main` también corre con `github.actor = dependabot[bot]`, así que con la regla
vieja —que sólo miraba el actor— se habría omitido otra vez.

Ahora la omisión bloquea, y el resumen del job explica cómo desbloquear:

1. Reproducir el cambio en una **rama interna** del repositorio (`gh pr checkout`
   y push a una rama propia, o un cherry-pick). Ahí los Actions secrets sí llegan.
2. Comprobar que `RLS harness (server-side)` pasa **en verde sobre ese commit**,
   con pruebas > 0 y todos los escenarios obligatorios.
3. Fusionar esa rama interna; el PR original se cierra como duplicado.

Es más trabajo que antes, y es el trabajo correcto: la alternativa era fusionar
sin verificar y contarlo como verificado.

Para que los PR de **Dependabot** verifiquen por sí solos, declará las siete
variables **también** como *Dependabot secrets*, con los mismos nombres:
**Settings → Secrets and variables → Dependabot**. El preflight las ve igual y no
hay nada que diferir.

> **Pendiente hoy.** Esa segunda copia todavía no está cargada, y los PR de
> Dependabot abiertos traen checks **anteriores** al fail-closed (el último corrió
> el 2026-08-17, dos días antes de que se fusionara #775). En cuanto se
> re-ejecuten, su job RLS pasará a rojo: es el desenlace previsto, y se desbloquea
> con los Dependabot secrets o con el rebote a rama interna descrito arriba.

En ningún caso se recurre a **`pull_request_target`**, que sí expondría los
secretos al código del PR: sería un problema peor que el que resuelve.

En `push` no hay contexto que valga: si faltan las variables es un fallo de
configuración, incluso si el actor es `dependabot[bot]`.

La tabla de verdad del gate (fork · PR de Dependabot · PR interno · push a main ·
push a main iniciado por Dependabot · `workflow_dispatch` · destino rechazado)
tiene prueba contractual en `scripts/__tests__/rls-preflight.test.mjs`, junto con
la comprobación de que el workflow conserva el disparador `push: branches: [main]`
y de que el preflight corre antes de `npm ci`.

### Por qué el verificador ya no busca un marcador de omisión

La primera versión rechazaba el reporte si el nombre de alguna prueba contenía
`omitido`. Era un **fallo permanente**: vitest incluye las pruebas *skipped* en
el reporte JSON, así que el `it.skip('omitido — …')` del bloque alternativo
aparecía **siempre**, también con credenciales. El job no podía ponerse verde ni
con el sandbox montado. El bloque alternativo se eliminó del harness y la
constancia de que el harness no corrió la da el preflight —que es quien tiene la
información— y además ya no como aviso verde, sino bloqueando el check.

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

**El harness declara 128 aserciones**, y en la corrida verde pasaron las 128 sin
ninguna omitida. Sin credenciales el bloque queda bajo `describe.skipIf` y el
verificador lo detecta (cero pasadas); en CI no se llega a ese punto, porque el
preflight falla antes.

Para contarlas sin sandbox hay que **declarar el destino** —`vitest list` no
lista lo que está bajo `skipIf`—, pero no hace falta ni red ni credenciales
válidas: el guard sólo mira la forma de la URL y el ref declarado.

```bash
RLS_SUPABASE_URL=https://noexiste1234.supabase.co \
RLS_EXPECTED_PROJECT_REF=noexiste1234 \
RLS_SUPABASE_ANON_KEY=x \
RLS_USER_A_EMAIL=a@x RLS_USER_A_PASSWORD=x \
RLS_USER_B_EMAIL=b@x RLS_USER_B_PASSWORD=x \
npx vitest list src/test/rls/rlsHarness.test.ts | wc -l   # → 128
```

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

### Escenarios obligatorios y RPC declaradas una a una

`coverage.json` declara **siete escenarios** que deben aparecer como pruebas
pasadas. Un piso numérico no bastaba: se podía borrar un `describe` entero y
seguir por encima del mínimo.

`secretos-deny-all` · `anon-deny-negocio` · `tenant-no-trivial` ·
`tenant-estructural` · `user-scoped` · `negative-write` ·
`negative-write-verificado-como-b`

Agrupar las RPC por dominio tenía el mismo defecto un nivel más abajo: bastaba
con que sobreviviera el bloque «RPCs del ERP financiero» para dar por cubiertas
sus seis RPC, así que borrar `banco_ajuste_conciliacion` no se notaba. Ahora
`coverage.json` declara **las 23 RPC críticas una por una** y el verificador
exige el nombre exacto de cada una en alguna prueba pasada.

`scripts/__tests__/assert-rls-ejecutado.test.mjs` elimina de forma simulada
**cada** escenario y **cada** RPC del reporte y comprueba que el verificador lo
detecta: si alguien añade una al manifiesto y el verificador no la mira, esa
prueba falla.

### Qué demuestra el rechazo de cada RPC (y qué no)

No todos los rechazos prueban lo mismo, y sumarlos como si fueran equivalentes
es contar cobertura que no existe. Cada RPC declara su `garantia`, derivada del
esquema y verificada por `src/test/rls/__tests__/esquemaFixtures.test.ts`:

| Garantía | Cuántas | Qué demuestra |
|---|---|---|
| `tenant` | 11 | La RPC es ejecutable por `authenticated` y compara `get_my_company_id()` con la empresa del recurso. A es `company_owner`, así que pasa rol y permisos: **el rechazo sólo puede venir de la pertenencia**. Aislamiento demostrado |
| `rol` | 8 | El guard exige ser cliente del portal (`current_user_role()` o `mis_unidades_propietario_ids()`) y los usuarios fixture son staff: rechaza **antes** de mirar la pertenencia. Demuestra que el guard existe y que la RPC no es anon-ejecutable. **No es aislamiento** |
| `privilegio` | 4 | `REVOKE EXECUTE FROM PUBLIC` + `GRANT` sólo a `service_role`: ningún usuario del navegador puede invocarla, que es lo que se cerró en #378/#380. **Tampoco es aislamiento** |

Las ocho de garantía `rol` son las `portal_*` del self-service del propietario.
Para subirlas a `tenant` harían falta usuarios fixture con rol `cliente` y fila
en `unidad_residentes`, lo que exige dos credenciales más allá de las siete
`RLS_*` que define el harness. Queda declarado como limitación, no como
cobertura.
Las de reservas (`portal_reservar_amenidad`, `portal_cancelar_reserva`) sí llegan
a `tenant` porque aceptan al staff del tenant y comparan `company_id`.

### Los payloads negativos respetan los CHECK del esquema

Un INSERT que viola un `CHECK` lo aborta Postgres **antes** de evaluar la
policy: la prueba pasa sin haber probado aislamiento. Pasó de verdad con
`documentos_fiscales.regimen = 'general'`, valor que el esquema no admite
(`CHECK (regimen IN ('fel_gt','cfdi_mx'))`, migración `20260604220000`). Los
fixtures viven ahora en `coverage.json` y
`src/test/rls/__tests__/esquemaFixtures.test.ts` lee la migración y falla si
alguno vuelve a salirse del dominio permitido.

### Las escrituras cross-tenant se verifican COMO B

«El INSERT devolvió `data` vacío para A» no prueba que la fila no se escribiera:
RLS puede ocultarle a A una fila que sí quedó. Por eso cada escritura negativa
lleva un marcador único por corrida (`RLS-NEG-<ts>-<rand>`) y, después del
rechazo, **se consulta como B**. Si la fila apareció, se limpia como B y la
prueba falla. El UPDATE cross-tenant apunta al `id` exacto de la cuota fixture
de A —no a «todas las filas de la empresa»— y después se comprueba que esa fila
sigue perteneciendo a A.

### Las pruebas negativas apuntan a recursos que EXISTEN

Las escrituras y los RPC de A contra "el tenant ajeno" usan recursos **reales de
B**, leídos entrando como B: `company_id`, `project_id`, `unidad_id`, y también
el asiento contable, el movimiento bancario, la amenidad, la reserva y el cliente
que las RPC reciben por parámetro. Pasarles el `company_id` como si fuera un
`asiento_id` hacía que la RPC fallara por «no existe», no por autorización. Antes se
usaba un UUID cero, y eso debilitaba todas las pruebas: un INSERT con
`project_id` inexistente puede morir en la **foreign key** antes de que RLS se
evalúe, así que el verde no demostraba que la policy funcionara. Con FKs
válidas, el rechazo sólo puede venir de RLS. Lo mismo con los RPC: negar la
metadata de una empresa que existe es una comprobación de autorización; negar la
de un id inventado no prueba nada.

### Las limpiezas no pueden tocar los fixtures

El `afterAll` barre lo que un negative-write nunca debió dejar. Cada `DELETE` se
filtra por el **marcador efímero de esa corrida** (`RLS-NEG-<ts>-<rand>`) o por
**ids concretos** leídos antes; ninguno por `company_id`.

La regla no es teórica: había un `documentos_fiscales.delete().eq('company_id',
B.companyId)` que se llevaba por delante **todos** los comprobantes de B, incluido
el que siembra el seed — el que hace que esa tabla tenga cobertura no trivial. La
primera corrida pasaba y la segunda fallaba por «B no ve ninguna fila propia»; y si
alguien hubiera relajado esa aserción para «arreglarlo», la disjunción habría
vuelto a ser trivial. Una limpieza demasiado amplia no rompe la corrida en la que
se escribe: rompe la siguiente, y en la dirección de un verde hueco.

`src/test/rls/__tests__/destinoHarness.test.ts` audita el fuente y falla si algún
`DELETE` vuelve a filtrar por `company_id` o queda sin acotar. Como el marcador
lleva parte aleatoria, dos corridas simultáneas contra el mismo sandbox tampoco se
pisan.

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

Además de las tablas no triviales, el seed crea por tenant los recursos que las
RPC reciben por parámetro —proyecto, unidad, asiento contable, cuenta bancaria y
su movimiento, amenidad, reserva y cliente (con su fila en `company_clientes`,
que es donde vive la pertenencia: `clientes` no tiene `company_id`)— e imprime
sus ids. Esa traza es lo que separa «la RPC falló porque el id no existe» de «la
RPC rechazó por pertenencia». Al final imprime también el desglose de las 23 RPC
por garantía (`tenant` / `rol` / `privilegio`), para que el informe de la corrida
no pueda sumarlas todas como aislamiento.

Es idempotente y **regenera las contraseñas en cada corrida**: si las perdés,
volvé a correrlo y usá las nuevas.

## Paso 4 — Pegar los secretos

**Settings → Secrets and variables → Actions → New repository secret.**

| Secreto | De dónde sale |
|---|---|
| `RLS_SUPABASE_URL` | URL del sandbox |
| `RLS_SUPABASE_ANON_KEY` | Dashboard → API → `anon public` |
| `RLS_EXPECTED_PROJECT_REF` | el ref del sandbox (el `<ref>` de la URL); lo imprime el script. **No es una credencial** |
| `RLS_USER_A_EMAIL` · `RLS_USER_A_PASSWORD` | los imprime el script |
| `RLS_USER_B_EMAIL` · `RLS_USER_B_PASSWORD` | los imprime el script |

**Las siete.** Con seis, el preflight falla — a propósito.

### Por qué `RLS_EXPECTED_PROJECT_REF` es obligatoria

No aporta secreto ninguno: aporta **declaración**. El harness hace `INSERT`,
`UPDATE` y `DELETE` de filas de prueba, así que la pregunta «¿contra qué proyecto
corre?» tiene consecuencias. Con una sola variable —la URL— cambiar ese secreto
bastaría para redirigir todas esas escrituras a otro proyecto sin que nada lo
notara. Exigir que URL y ref coincidan convierte ese cambio en un abort.

El preflight valida el destino **antes de `setup-node` y de `npm ci`**, así que
un destino rechazado no llega a instalar dependencias ni a abrir una conexión:

| Caso | Desenlace |
|---|---|
| URL de producción (`nnsqmeigtgewatameexo`), aunque el ref declarado coincida | abortado — lista negra explícita |
| Dominio que no es Supabase | abortado — sólo los de `coverage.json` |
| `RLS_EXPECTED_PROJECT_REF` ausente | abortado — sin declaración no se opera |
| Ref declarado ≠ ref de la URL | abortado — uno de los dos está mal y no se adivina cuál |

La validación vive en **`scripts/rls-destino.mjs`**, es **pura** (no lee disco,
no toca la red) y la comparten las tres piezas que pueden escribir: el seed, el
preflight y **el propio harness**, que la repite como defensa en profundidad —
porque quien corre `npx vitest` a mano no pasa por el preflight. Sus pruebas
están en `scripts/__tests__/rls-destino.test.mjs` y
`src/test/rls/__tests__/destinoHarness.test.ts`; estas últimas sustituyen
`@supabase/supabase-js` por un espía y comprueban que `createClient` **no se
llama ni una vez** cuando el destino se rechaza.

## Paso 5 — Comprobar que ahora sí corre

Ya no hace falta leer el log a ojo: el job **falla solo** si no verificó nada.
Aun así, la señal positiva está en el resumen de la corrida — así salió en
[la corrida sobre `ec150b7`](https://github.com/ventas-png/control-consumo-agua/actions/runs/32382213772):

```
✅ Harness RLS ejecutado (aislamiento multi-tenant verificado)
- Pruebas pasadas: 128 (total 128, fallos 0, omitidas 0)
- Escenarios obligatorios presentes: 7/7
- RPC críticas verificadas una a una: 23/23
- Evidencias acreditadas (por RPC, garantía y vector): 45/45
- Piso mínimo exigido: 100
```

El harness declara **128 pruebas** (contarlas sin sandbox: ver el bloque de
`vitest list` en «Qué cubre exactamente»). Cualquier número por debajo del piso,
cualquier `skip` inesperado o cualquier escenario, RPC o evidencia ausente hace
fallar el job.

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
5. **Ocho de las 23 RPC críticas tienen garantía de ROL, no de tenant.** Son las
   `portal_*` del self-service del propietario: con usuarios fixture staff, el
   guard rechaza por rol antes de mirar la pertenencia. Se prueba que el guard
   existe y que no son anon-ejecutables; **no** se prueba aislamiento entre
   tenants. Otras cuatro (notificaciones) tienen garantía de PRIVILEGIO. El
   desglose está en la tabla de garantías, más arriba.
6. **No hay usuarios de portal sembrados.** El seed crea dos `company_owner`. Un
   usuario con `app_users.role = 'cliente'` y fila en `unidad_residentes` por
   tenant convertiría las ocho RPC de garantía `rol` en garantía `tenant`; exige
   dos credenciales más y va en un PR aparte.
7. **Los E2E siguen siendo no-op verdes.** En la misma corrida en que el harness
   RLS verificó 128 aserciones, el job `E2E (caminos de dinero/auth)` pasó su
   gate y **salteó todos los pasos** por falta del secreto `E2E_BASE_URL`: sigue
   siendo un verde que no ejecutó nada. Se aborda en un PR aparte; su gate no se
   ha tocado aquí. Los secretos que necesita están en `e2e/README.md`.

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

**Hecho.** `coverage.json` declara los siete escenarios obligatorios **y las 23
RPC críticas una por una**; `scripts/assert-rls-ejecutado.mjs` falla si
cualquiera no aparece como prueba pasada, aunque el total supere el piso. El
piso numérico queda como red secundaria. Que el verificador realmente lo detecte
está probado eliminando cada pieza de forma simulada
(`scripts/__tests__/assert-rls-ejecutado.test.mjs`).

Pendiente: aplicar el mismo patrón al job de E2E cuando se active — hoy su
ausencia es un warning, y un warning no bloquea nada. Va en el PR de E2E.
