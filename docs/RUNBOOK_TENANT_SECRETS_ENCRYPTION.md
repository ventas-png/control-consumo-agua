# Runbook — Cifrado en reposo de secretos por tenant (P0 #7)

> **Estado.** Fase EXPAND en curso. La ruta de **pagos** (`company_payment_secrets`)
> ya está cableada al cifrado. Las rutas **fiscal**, **payfac** y **email** siguen
> pendientes (mismo patrón). El cifrado está **inactivo** (passthrough) hasta que un
> operador provisione la llave `TENANT_SECRETS_ENC_KEY`.

## Qué protege

Las tablas *deny-all* (`company_payment_secrets`, `fiscal_pac_secrets`,
`payfac_secrets`, `company_email_configs`) guardan credenciales de pago/PAC/PayFac y
tokens OAuth de Gmail. Hoy están protegidas por RLS (solo `service_role`) pero **en
texto plano**: un volcado de backup o una fuga de la `service_role_key` las expone.
Este trabajo las cifra **en reposo** con AES-256-GCM.

- **Llave:** `TENANT_SECRETS_ENC_KEY` — base64 de **32 bytes**, vive **solo** en los
  secretos de Edge Functions (categoría C del inventario). **Nunca** en la base ni en
  el repo. El motor de BD jamás ve la llave → un dump filtrado es inútil sin ella.
- **Envelope:** `enc:v1:` + base64( `iv`(12 bytes) ‖ `ciphertext+tag` ).
- **Helper:** `supabase/functions/_shared/secretsCrypto.ts`
  (`encryptSecret` / `decryptSecret`, más el núcleo puro `encryptWithKey` /
  `decryptWithKey`).

## Diseño no-disruptivo (expand → migrate → contract)

1. **Passthrough sin llave.** Si `TENANT_SECRETS_ENC_KEY` no está configurada,
   `encryptSecret` devuelve el texto plano tal cual. Cablear los helpers en
   writers/readers es un **NO-OP** hasta provisionar la llave.
2. **Lectura dual.** `decryptSecret` devuelve sin tocar cualquier valor que **no**
   empiece con `enc:v1:` (texto plano legacy). Filas viejas (plano) y nuevas
   (cifradas) conviven durante el backfill.
3. **Idempotencia.** Cifrar un valor ya cifrado lo deja igual.

> **Invariante de seguridad.** Nunca provisiones la llave / hagas backfill de una
> tabla hasta que **todos** sus readers y writers descifren/cifren. Si un reader lee
> ciphertext sin `decryptSecret`, ese flujo se rompe. La lista de readers por tabla
> está abajo — complétala antes de activar.

## Estado de cableado por tabla

| Tabla | Writers | Readers | Estado |
|---|---|---|---|
| `company_payment_secrets` | `save-payment-config` (cifra) | `create-payment-intent`, `test-stripe`, `stripe-webhook-handler` (descifran) | ✅ **cableado (EXPAND)** |
| `fiscal_pac_secrets` | `fiscal-save-credentials` | `fiscal-test-connection`, `timbrar-documento`, `_shared/fiscal/felGtProvider`, `_shared/fiscal/cfdiMxProvider` | ⏳ pendiente |
| `payfac_secrets` | `payfac-save-credentials` | `payfac-test-connection`, `create-charge` | ⏳ pendiente |
| `company_email_configs` | `complete-oauth-onboarding`, `send-email` (refresh token) | `send-email`, `process-email-queue` | ⏳ pendiente |

> `stripe_webhook_secret` no tiene writer en edge (lo fija el operador). Su reader
> (`stripe-webhook-handler`) ya descifra; el backfill lo cubre.

## Provisionar la llave

```bash
# 1. Generar 32 bytes aleatorios en base64 (guardar en el gestor de secretos, NO en el repo)
openssl rand -base64 32

# 2. Publicar como secreto de Edge Functions
supabase secrets set TENANT_SECRETS_ENC_KEY='<base64-de-32-bytes>'

# 3. Redesplegar las funciones que tocan secretos (deploy-functions.yml o manual)
```

Tras esto, las **escrituras nuevas** de las tablas cableadas quedan cifradas; las
lecturas descifran; las filas viejas siguen en plano (lectura dual) hasta el backfill.

## Backfill (MIGRATE)

La llave vive solo en el entorno de las edge functions, así que el backfill **debe**
correr en una edge function (no en SQL). Dos caminos:

- **Perezoso (recomendado para empezar):** cada vez que el tenant re-guarda una
  credencial (UI → `*-save-*` / OAuth refresh), queda cifrada. Cobertura gradual.
- **De una (una tabla a la vez):** función administrativa `service_role` que hace
  `SELECT` de las filas en texto plano (`NOT LIKE 'enc:v1:%'`), `encryptSecret` y
  `UPDATE`. Ejecutar **por tabla, solo después** de cablear todos sus readers.
  Verificar con la función `*-test-connection` correspondiente antes de continuar.

## Contract

Cuando **todas** las filas de todas las tablas estén cifradas y con soak suficiente:

- (Opcional) Endurecer `decryptSecret` para exigir el prefijo `enc:v1:` (quitar el
  passthrough de texto plano) — solo tras confirmar 0 filas en plano.
- Mantener el passthrough de forma indefinida también es seguro (no rompe nada).

## Rotación de llave

Para rotar `TENANT_SECRETS_ENC_KEY`: introducir un segundo envelope `enc:v2:` con la
llave nueva, descifrar-con-vieja + recifrar-con-nueva en un job por tabla, y retirar
la llave vieja cuando no queden valores `enc:v1:`. (El `v1` del prefijo existe
justamente para versionar la llave/algoritmo.)

## Verificación

- `secretsCrypto.ts` tiene tests unitarios (round-trip, IV no determinista,
  idempotencia, lectura dual, manipulación → falla GCM, llave equivocada → falla,
  passthrough sin llave).
- La ruta de pagos pasa `deno check` (tipos) y la suite `vitest — supabase/functions`.
