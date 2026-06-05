# Runbook — Activar SSO/SAML real (handshake) · plat:P10

> **Estado:** el andamiaje **app-level está COMPLETO** (#428 / #429 / #432). El
> *handshake* SAML real está **PARQUEADO a propósito** (issue **#430**, épica #302)
> hasta que se decida habilitarlo. **El login nunca se rompe sin esto**: si SSO no
> está habilitado, todo cae a password (degradación graceful).
>
> Esta guía es el paso-a-paso para **encenderlo** cuando se quiera. Proyecto:
> `nnsqmeigtgewatameexo` (hosted, `*.supabase.co`).

## TL;DR del flujo (qué pasa al activarlo)

```
[app] supabase.auth.signInWithSSO({ domain })
   → POST https://nnsqmeigtgewatameexo.supabase.co/auth/v1/sso   (con el dominio)
   → Supabase arma un SAML AuthnRequest y redirige al IdP del cliente
   → el usuario se autentica en el IdP (Okta / Azure AD / Google Workspace / …)
   → el IdP POSTea la assertion a  /auth/v1/sso/saml/acs
   → Supabase valida la firma, crea/linkea el usuario y emite sesión
   → vuelve a la app, ya logueado
```

---

## Prerrequisitos

- **Plan Pro o superior** del proyecto Supabase — SAML 2.0 es feature de plan pago.
- **Supabase CLI** v1.46.4+ (`supabase -v`), logueado (`supabase login`) y linkeado:
  `supabase link --project-ref nnsqmeigtgewatameexo`.
- Acceso de admin al **IdP** del cliente y su **metadata** (URL o XML). IdPs soportados:
  Google Workspace, Okta/Auth0, Microsoft Entra/Azure AD/AD, PingIdentity, OneLogin, …
- Decisión de negocio: a qué empresas/planes se ofrece (hoy *gated* por el feature
  flag **`enterprise_sso`**; ver `company_features`).

---

## Paso 1 — Habilitar SAML en el proyecto (una sola vez, a nivel proyecto)

**Hosted (este caso):** Dashboard → **Authentication → Providers → SAML 2.0 → Enable**.
Esto activa el motor SAML y administra la **clave de firma del Service Provider** por vos.

- https://supabase.com/dashboard/project/nnsqmeigtgewatameexo/auth/providers

> _Self-hosted (NO aplica hoy, sólo si algún día se migra a Docker):_ se setea
> `GOTRUE_SAML_ENABLED=true` + `GOTRUE_SAML_PRIVATE_KEY` (RSA PKCS#1 DER en base64,
> 2048-bit mínimo). Generación de la clave:
> ```sh
> openssl genpkey -algorithm RSA -out pk_pkcs8.pem -quiet && \
> openssl pkey -in pk_pkcs8.pem -out pk_rsa1.der -outform DER -traditional && \
> base64 -w 0 -i pk_rsa1.der
> ```
> La clave es **secreta** — nunca al control de versiones.

---

## Paso 2 — Datos del Service Provider (SP) para entregar al IdP

El SP es el servidor Auth de Supabase. En la consola del IdP, configurá una nueva app
SAML con estos datos del SP:

| Campo | Valor |
|---|---|
| **ACS URL** (Assertion Consumer Service) | `https://nnsqmeigtgewatameexo.supabase.co/auth/v1/sso/saml/acs` |
| **SP Metadata URL / EntityID** | `https://nnsqmeigtgewatameexo.supabase.co/auth/v1/sso/saml/metadata` |
| **NameID format** | `emailAddress` (el `NameID` debe ser el email del usuario) |

El IdP, a su vez, te da **su** metadata (URL o XML) — la necesitás en el Paso 3.

---

## Paso 3 — Registrar el/los IdP

> Los proveedores se gestionan **en runtime** vía la Admin SSO API (no por env vars).
> No hace falta reiniciar nada al agregar/quitar uno.

**Opción A — desde la app (self-service por tenant, recomendado):**
Empresa → **SSO/SAML** (visible con el flag `enterprise_sso`). El owner/admin pega la
**metadata del IdP** (URL/XML) + entity/ACS y asocia su(s) **dominio(s)**. La edge
**`sso-admin`** (acción `save_metadata`) llama a la Admin SSO API y, una vez hecho el
Paso 1, **rellena `sso_provider_id`** en `company_sso_domains` (deja de responder
`"parqueado"`). Deriva `company_id` de la sesión (nunca del input) y exige owner/admin.

**Opción B — por CLI (operador, alta manual):**
```sh
supabase sso add --project-ref nnsqmeigtgewatameexo \
  --type saml \
  --metadata-url "<IdP metadata URL>" \
  --domains acme.com
# Devuelve el provider UUID (= sso_provider_id).
supabase sso list   --project-ref nnsqmeigtgewatameexo   # ver los registrados
supabase sso show <provider-id> --project-ref nnsqmeigtgewatameexo
```

---

## Paso 4 — Verificar propiedad del dominio (anti-secuestro)

Gate intencional `enforced ⇒ verified`: un tenant **no** puede forzar SSO sobre un
dominio que no probó poseer (si no, el tenant A secuestraría el login del dominio del
tenant B).

- La app ya genera un **token** por dominio (`company_sso_domains.verification_token`).
  El admin publica un registro **DNS TXT** `_admtdo-sso.<dominio>` con ese token.
- **Follow-up pendiente (#430):** el chequeo **automático** que valida el TXT y pone
  `verified=true` aún no está cableado. Hoy: tras confirmar el TXT, un operador puede
  marcar `verified=true`, o se implementa el verificador (edge/cron que resuelve el TXT).
- Sólo dominios `verified=true` se **anuncian** en el login (vía `sso_lookup_domain`) y
  habilitan `enforced`.

---

## Paso 5 — Probar el login SSO

1. En el login, tecleá un email del dominio (p. ej. `alguien@acme.com`).
2. Debe aparecer **"Continuar con SSO"** (lo dispara `sso_lookup_domain` → la detección
   de `src/lib/sso.ts`).
3. Click → redirect al IdP → autenticás → volvés con sesión iniciada.

> El wrapper `signInWithSSO({ domain })` ya está en `src/lib/sso.ts`; el redirect real
> sólo funciona una vez completados los pasos 1–3.

---

## Paso 6 — (Opcional) Forzar SSO para un dominio

Con el dominio **verified**, el admin activa **"Forzar SSO"** (`enforced=true`) en
Empresa → SSO/SAML. El login **oculta el password** para ese dominio (sólo SSO).

---

## Rollback / troubleshooting

- **Quitar un IdP:** `supabase sso remove <provider-id>` (o desde la UI). El login de ese
  dominio vuelve a password.
- **Degradación graceful:** ante cualquier error (SSO no habilitado, IdP caído, etc.) el
  login **cae a password** — nunca se bloquea al usuario.
- **`save_metadata` responde "parqueado":** SAML aún no está habilitado en el proyecto
  (falta el Paso 1).
- **Logs:** Auth/GoTrue logs del proyecto (`supabase` dashboard → Logs → Auth).

---

## Cómo encajan las piezas ya construidas (no hay que reescribir nada)

| Pieza | Rol |
|---|---|
| `company_sso_domains` (mig `20260606130000`) | mapeo dominio↔empresa; `verified`/`enforced`/`sso_provider_id`/`verification_token`; RLS owner-admin de su empresa |
| RPC `sso_lookup_domain` (anon, SECURITY DEFINER) | descubrimiento **pre-login**: ¿este dominio usa SSO? salida mínima, nunca filtra identidad |
| edge **`sso-admin`** (desplegada) | registra/sincroniza el IdP vía Admin SSO API; persiste config; deriva `company_id` de la sesión |
| `SsoConfigSection` (Empresa, gated `enterprise_sso`) | UI admin (dominios, metadata, verificación, enforce) |
| `src/lib/sso.ts` + `LoginScreen` | detección de dominio + `signInWithSSO` + fallback a password |

---

## Referencias oficiales

- **SSO con SAML 2.0 (proyectos):** https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml
- **CLI `supabase sso add`:** https://supabase.com/docs/reference/cli/supabase-sso-add
- **Habilitar SSO para tu organización (dashboard):** https://supabase.com/docs/guides/platform/sso
- **Issue de parqueo:** #430 · **Épica:** #302
