# Adapter PAC — Ainnova (FEL Guatemala) · serv:S11

**Decisión de proveedor (épica #305):** el dueño factura con **Ainnova** (grupo
Guatefacturas), certificador FEL autorizado por SAT GT (Acuerdo de Directorio
13-2018). Es el primer certificador **real** conectado a la arquitectura pluggable
`FiscalProvider`. El resto del sistema no cambia: solo se enchufa este adapter.

## Qué quedó listo en este PR (verificable, sin el manual de Ainnova)

- **Selección:** `ainnova` aparece en el catálogo FEL del selector "selecciona y
  conecta" (`src/components/tarifas/pacCatalogo.ts`).
- **Ruteo:** `getFiscalProvider('fel_gt', { proveedor: 'ainnova', … })` devuelve
  `AinnovaProvider` (los demás certificadores GT siguen como stub).
- **Plomería de credenciales:** `FiscalProviderConfig` ahora lleva `ambiente`
  (`sandbox`/`prod`) y `credenciales` (por ambiente). Las edge functions
  `timbrar-documento` y `fiscal-test-connection` cargan el secreto de la bóveda
  `fiscal_pac_secrets` (override locación→empresa, deny-all bajo RLS) y lo inyectan
  al provider. El secreto nunca se loguea ni se devuelve al cliente.
- **Mapeo del DTE:** `felGtDte.ts` convierte el DTE canónico → estructura DTE FEL
  (emisor/receptor/items/totales) con la regla FEL de **precios IVA-incluidos**.
  Es PAC-agnóstico dentro de GT (reutilizable por Infile/Megaprint) y está testeado.
- **Validación de credenciales** del ambiente activo (usuario/clave, tolerante a
  llaves equivalentes) en `AinnovaProvider`.

## Qué falta para timbrar con valor fiscal (transporte)

El transporte SOAP/REST contra `dte.guatefacturas.com` **falla seguro** hoy
(`AinnovaContratoNoConfirmadoError`): jamás finge un timbrado. Para habilitarlo se
necesita, de Ainnova/del dueño:

1. **Contrato del web service**: operación y envelope EXACTOS (SOAP `webservices63`
   — endpoint de pruebas `…/feltest/` — vs. una API REST con token), del manual de
   integración de Ainnova.
2. **Modelo de firma**: ¿firma **Ainnova** el DTE por el emisor (SaaS), o hay que
   **firmar el XML con el certificado del emisor** antes de enviarlo? El 2º caso
   exige guardar el certificado (.pfx + clave) en la bóveda y firmar en el edge.
3. **Credenciales sandbox** reales de Ainnova para validar end-to-end.
4. **Red del entorno**: habilitar `dte.guatefacturas.com` en la política de red
   (hoy fuera del allowlist) para que el edge alcance al certificador.

## Configuración (secrets del edge — Supabase → Edge Functions → Secrets)

Opcionales; si se omiten, se usan los endpoints por defecto del código:

```
AINNOVA_ENDPOINT_SANDBOX=https://dte.guatefacturas.com/webservices63/feltest/
AINNOVA_ENDPOINT_PROD=https://dte.guatefacturas.com/webservices63/fel/
```

Las credenciales (usuario/clave de Ainnova, y eventualmente el certificado del
emisor) se cargan por tenant/locación desde la UI: **Empresa → Facturación →
Credenciales del PAC**, y viven en `fiscal_pac_secrets` (service-role-only).
