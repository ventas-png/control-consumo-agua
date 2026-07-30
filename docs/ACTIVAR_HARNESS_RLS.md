# Activar el harness de RLS (y los E2E)

> **Estado hoy:** los jobs `RLS harness (server-side)` y `E2E (caminos de
> dinero/auth)` están **verdes sin ejecutar nada**. Les faltan secretos, y sin
> ellos se saltan entero. Son 22 aserciones de aislamiento multi-tenant y 9
> specs de dinero/auth que **nunca han corrido**.

## Por qué importa más de lo que parece

El harness RLS verifica, contra un Supabase real y con dos usuarios de empresas
distintas, que **A no ve datos de B**. Eso es exactamente lo que la auditoría
2026-07-28 puso como prioridad número uno — y todo el Bloque A se validó por
análisis estático de las 352 migraciones y por `security-guard.mjs` sobre el
catálogo de producción, **nunca probando el aislamiento de verdad desde un
cliente autenticado**.

Un análisis estático te dice que la policy existe y tiene la forma correcta. No
te dice que el motor la aplique como creés.

## El detalle que hay que entender antes de empezar

La aserción de aislamiento del harness es, en esencia:

```ts
for (const co of companyIdsQueVeB) {
  expect(companyIdsQueVeA.has(co)).toBe(false)
}
```

**Si A y B no ven ninguna fila, ambos conjuntos son vacíos, el bucle no itera y
el test pasa sin comparar nada.** Un sandbox con dos usuarios pero sin datos
produce un verde igual de hueco que el no-op actual — sólo que más difícil de
detectar, porque ahora *parece* que corrió.

Por eso `scripts/seed-rls-sandbox.mjs` siembra filas reales en tablas
tenant-scoped **y verifica** que cada usuario vea las suyas y ninguna de la otra
empresa. Si no puede demostrarlo, sale con error en vez de dejarte un sandbox
que mienta.

---

## Paso 1 — Crear el proyecto sandbox

En [supabase.com/dashboard](https://supabase.com/dashboard): **New project**.

- Nombre sugerido: `control-agua-rls-sandbox`
- **No** uses producción. El script se niega explícitamente a correr contra el
  ref de prod, pero la razón de fondo es que crea empresas y usuarios de prueba.

## Paso 2 — Aplicar el esquema

El sandbox necesita las mismas tablas y policies que producción:

```bash
supabase link --project-ref <ref-del-sandbox>
supabase db push
```

Si `db push` se queja del historial (el repo arrastra numeraciones paralelas —
ver `docs/SUPABASE_PREVIEW_BRANCHES.md`), aplicá las migraciones con el
workflow `apply-migration.yml` apuntando al sandbox, o pegá el SQL por el editor
del dashboard.

## Paso 3 — Sembrar las dos empresas y sus usuarios

Las claves salen de **Dashboard → Project Settings → API**. La `service_role`
sólo se usa en este comando, en tu máquina: **no** va a ningún secreto del repo.

```bash
SEED_SUPABASE_URL="https://<ref>.supabase.co" \
SEED_SERVICE_ROLE_KEY="<service_role del sandbox>" \
SEED_ANON_KEY="<anon public del sandbox>" \
SEED_CONFIRM=si \
node scripts/seed-rls-sandbox.mjs
```

`SEED_ANON_KEY` es opcional pero **conviene ponerla**: es lo que permite al
script entrar como cada usuario y comprobar el aislamiento de verdad. Sin ella
crea los datos pero no puede verificarlos.

El script es idempotente y **regenera las contraseñas en cada corrida**: si las
perdés, volvé a correrlo y usá las nuevas.

## Paso 4 — Pegar los secretos

**Settings → Secrets and variables → Actions → New repository secret.**

| Secreto | De dónde sale |
|---|---|
| `RLS_SUPABASE_URL` | URL del sandbox |
| `RLS_SUPABASE_ANON_KEY` | Dashboard → API → `anon public` |
| `RLS_USER_A_EMAIL` · `RLS_USER_A_PASSWORD` | los imprime el script |
| `RLS_USER_B_EMAIL` · `RLS_USER_B_PASSWORD` | los imprime el script |

En cuanto exista `RLS_SUPABASE_URL`, el job deja de saltarse y empieza a
verificar en cada PR.

## Paso 5 — Comprobar que ahora sí corre

Esto es lo que **no** hay que saltarse: el job ya estaba verde antes, así que
«verde» no prueba que se haya activado.

Abrí el log de `RLS harness (server-side)` y confirmá que:

1. **No** aparece `RLS secrets no configurados — harness omitido`.
2. El recuento de tests es **> 0** (antes eran 0 ejecutados).

Si el recuento sigue en cero, el secreto no llegó y volvés a tener un no-op.

---

## Los E2E (mismo problema, arreglo aparte)

9 specs de Playwright que tampoco corren. Necesitan:

| Secreto | Para qué |
|---|---|
| `E2E_BASE_URL` | preview de Vercel o staging. **Sin ella todo se salta** |
| `E2E_LOGIN_EMAIL` · `E2E_LOGIN_PASSWORD` | login, agua, condominios, fiscal |
| `E2E_INVITE_TOKEN` | sólo el spec de aceptar invitación |
| `E2E_RESTRICTED_EMAIL` · `E2E_RESTRICTED_PASSWORD` | flujo de rol restringido |

Ese job **sí** avisa cuando se salta (deja un warning y un resumen en la corrida),
así que es menos traicionero que el de RLS. Detalle en `e2e/README.md`.

---

## Qué NO cubre esto

- El sandbox no tiene datos de producción: verifica que **las policies aíslan**,
  no que los datos reales estén bien.
- El seed siembra `proveedores` y `conta_cuentas` porque sólo necesitan
  `company_id`. Las tablas que exigen proyecto y unidades
  (`cuotas_condominio`, etc.) quedan vacías, así que su aserción de disjunción
  sigue siendo trivial. Ampliar el seed a esas tablas es la mejora natural
  siguiente si querés cobertura completa.
