# Harness de RBAC/RLS server-side (plat:P15)

`rlsHarness.test.ts` verifica las **políticas RLS reales** contra un Supabase en
vivo (preview branch del PR o sandbox). Complementa —no reemplaza— la cobertura
de la **lógica de permisos pura** (`src/lib/__tests__/permissions.test.ts`,
`condominiosRoles.test.ts`, `systemRoleIds.test.ts`, `aguaPermissions.test.ts`).

No usamos pgTAP en este repo; este harness es la verificación equivalente desde
el cliente, con JWTs de distinto rol/empresa.

## Qué afirma

1. **Secretos = deny-all.** `fiscal_pac_secrets` y `company_payment_secrets` no
   devuelven filas ni para `authenticated` ni para `anon`. El secreto sólo es
   accesible por `service_role` (que hace BYPASSRLS) desde edge functions. El
   cliente nunca lo ve.
2. **anon sin acceso de negocio.** `registros` y `cuotas_condominio` devuelven 0
   filas para `anon` (no hay policy para ese rol).
3. **Aislamiento multi-tenant.** Dos usuarios de **empresas distintas** ven
   conjuntos de `company_id` **disjuntos** en `cuotas_condominio`.

## Por qué está credencial-gated

Necesita una base real + usuarios sembrados, cosa que el runner unitario de CI no
tiene. Si faltan las env vars, el bloque se **skipea** (la suite queda verde) y se
deja un test `.skip` marcador para que el reporte muestre que RLS server-side NO
se verificó en esa corrida. Cuando hay credenciales (job E2E/preview), corre de
verdad.

## Cómo correrlo

Contra el **preview branch del PR** o un **sandbox** (NUNCA producción):

```bash
export RLS_SUPABASE_URL="https://<preview-ref>.supabase.co"
export RLS_SUPABASE_ANON_KEY="<anon-key-del-preview>"

# Dos usuarios YA sembrados, de empresas DISTINTAS:
export RLS_USER_A_EMAIL="qa-a@example.com"
export RLS_USER_A_PASSWORD="********"
export RLS_USER_B_EMAIL="qa-b@example.com"
export RLS_USER_B_PASSWORD="********"

npx vitest run src/test/rls/rlsHarness.test.ts
```

En CI se cablea como job aparte (ver `.github/workflows/coverage.yml`, job
`rls-harness`), que sólo se activa cuando los secretos del repo están presentes.

## Sembrado de datos

El harness es **read-only**: no crea datos. Asume que A y B ya existen en empresas
distintas y que B tiene al menos una `cuota_condominio` para que el assert de
disjunción sea significativo (si B no tiene cuotas, el test sigue pasando pero no
prueba aislamiento — sembrar 1 cuota por empresa lo hace concluyente).

## Limitaciones / siguiente paso

- `registros` no expone `company_id` directo (scoping sólo por RLS), por eso el
  aislamiento por tenant se afirma sobre `cuotas_condominio`. Un assert análogo
  para `registros` requiere ids sembrados conocidos por empresa.
- Un harness que **cree** usuarios/datos por rol (con `service_role`) daría
  cobertura más profunda (INSERT/UPDATE/DELETE denegados cross-tenant) pero es más
  caro de operar; queda como mejora futura. Hoy priorizamos lectura + deny-all de
  secretos + aislamiento, que son los invariantes críticos.
