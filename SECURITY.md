# Política de seguridad — AdministraTodo

## Reporte de vulnerabilidades

Si encontrás una vulnerabilidad, **no abras un issue público**. Escribí a
**ventas@mayanresidenciales.com** con el asunto `[SECURITY]` incluyendo:

- Descripción y impacto potencial (¿qué datos/tenants alcanza?).
- Pasos de reproducción o PoC.
- Versión/URL donde la observaste.

Compromiso: acuse de recibo en 72 horas; corrección priorizada según impacto
(las vulnerabilidades de aislamiento entre tenants y del camino de dinero se
tratan como P0). Pedimos divulgación coordinada: no publiques detalles hasta
que el fix esté desplegado.

## Alcance

- Aplicación web (Vercel) y Edge Functions / base de datos (Supabase).
- Aislamiento multi-tenant (RLS), autenticación/MFA, camino de pagos
  (Stripe/payfac), portal del residente.

Fuera de alcance: DoS volumétrico, ingeniería social, hallazgos que requieran
acceso físico al dispositivo de la víctima.

## Postura de seguridad (resumen para revisores)

- **Aislamiento**: RLS en todas las tablas de tenant + harness de invariantes
  en CI (`RLS harness`); RPCs `SECURITY DEFINER` con scoping explícito por
  `company_id` y guards trivaluados fail-closed.
- **Secretos de tenant**: bóveda cifrada (AES-GCM vía `TENANT_SECRETS_ENC_KEY`)
  con RPCs `*_estatus` que jamás devuelven el secreto.
- **Camino de dinero**: rate limiting por usuario, comparación de secretos en
  tiempo constante (`timingSafeEqualSecret`), validación estricta de bodies
  (`validate.ts` por edge), idempotencia por llaves naturales UNIQUE.
- **Códigos/tokens**: siempre CSPRNG (`crypto.getRandomValues` /
  `gen_random_bytes`) — nunca `Math.random()`/`random()`.
- **MFA**: enforcement server-side (`aal2`) vía políticas RESTRICTIVE cuando el
  tenant lo exige.
- **Dependencias**: Dependabot (npm + GitHub Actions) semanal.

## Configuración del repositorio (checklist del owner)

Estas protecciones se activan en GitHub → Settings (no viven en archivos):

- [ ] **Secret scanning** + **Push protection** (Settings → Code security).
- [ ] **Dependabot alerts** y **security updates** habilitados.
- [ ] Environment `production-db` con *required reviewers* (gate de migraciones).
