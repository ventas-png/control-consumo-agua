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

## Overrides de npm vigentes

`package.json → overrides` fuerza versiones que los padres aún no declaran.
Cada entrada existe por un advisory concreto y tiene criterio de retiro; no
agregar overrides sin documentarlos aquí.

| Override | Por qué | Evidencia de compatibilidad | Retirar cuando |
| --- | --- | --- | --- |
| `exceljs → uuid ^11.1.1` | uuid <11.1.1: falta el bounds-check del `buf` en v3/v5/v6 (advisory de npm audit). exceljs@4.4.0 declara `uuid ^8.3.2` y no hay release del padre con uuid parcheado; el «fix» que propone `npm audit` DEGRADA exceljs a 3.4.0, que no es aceptable. | exceljs consume únicamente `v4()` por `require` CJS (`lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`); uuid 11 conserva el build CJS y el named export (13+ es ESM-only: NO subir el override a 13 sin verificar). La costura se ejecuta de verdad en `src/lib/__tests__/xlsx.test.ts` (round-trip con formato condicional dataBar → uuidv4 real). | exceljs publique una versión con `uuid >=11.1.1`. |
| `xcode → uuid ^11.1.1` | Misma vulnerabilidad, vía `@capacitor/cli → xcode@3.0.1` (`uuid ^7.0.3`). Sólo devDependencies (tooling móvil). | xcode consume únicamente `uuid.v4()` por CJS (`lib/pbxProject.js`), mismo análisis. El tooling iOS corre sólo en macOS: verificar `npx cap sync ios` en la próxima build móvil. | xcode (o @capacitor/cli) declare `uuid >=11.1.1`. |

Estado al 2026-08-28 (Node 22, tras actualizar dompurify a 3.4.14 —
GHSA-55q2-fjhq-7xh7— y refrescar brace-expansion/fast-uri/nanoid en rango):
`npm audit` y `npm audit --omit=dev` reportan **0 vulnerabilidades**, sin
advisories residuales. Regresión del sanitizador en
`src/lib/__tests__/validation.test.ts` (piso de versión + vectores mXSS +
forma IN_PLACE del advisory).

## Configuración del repositorio (checklist del owner)

Estas protecciones se activan en GitHub → Settings (no viven en archivos):

- [ ] **Secret scanning** + **Push protection** (Settings → Code security).
- [ ] **Dependabot alerts** y **security updates** habilitados.
- [ ] Environment `production-db` con *required reviewers* (gate de migraciones).
