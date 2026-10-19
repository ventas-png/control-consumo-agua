# Mascotas y vehículos: registro desde el portal y autorización

Migración `20261031000500_padron_mascotas_vehiculos_autorizacion.sql`.

El residente registra sus mascotas y vehículos desde el portal y la
administración los **autoriza**. Mismo circuito operativo que la solicitud de
renta: el residente arma un borrador con sus datos y documentos, lo envía, la
administración lo revisa y aprueba o rechaza con motivo, y el residente puede
retirarlo o darlo de baja después.

## Flujo

```
portal                         base de datos                        panel admin
──────                         ─────────────                        ───────────
"+ Registrar"  ── reservar ──▶ borrador (inactivo)
sube adjuntos  ─────────────▶ padron-docs/{unidad}/{mascotas|vehiculos}/{id}/
"Enviar"       ── enviar ───▶ pendiente ── aviso al staff ──▶ Mascotas / Vehículos
                                                               → "Solicitudes del portal"
                               aprobada (activo)  ◀── Autorizar (+ TAG de ingreso)
                               rechazada          ◀── Rechazar (motivo obligatorio)
aviso al residente ◀──────────
"Retirar" / "Dar de baja" ──▶  baja (inactivo; libera el TAG)
```

| Estado | Activo | Quién lo pone |
| --- | --- | --- |
| `borrador` | no | `portal_reservar_*` (solo lo ve quien lo creó) |
| `pendiente` | no | `portal_enviar_*` |
| `aprobada` | sí (o no, si el staff lo desactiva) | `resolver_*`, o el staff al crear directo |
| `rechazada` | no | `resolver_*` |
| `baja` | no | `portal_baja_*` |

**Invariante de la base:** `CHECK (activo = false OR estado = 'aprobada')`.
Ningún consumidor del padrón (Directorio, KPIs, filtros por `activo`) puede
contar como autorizado algo que no lo está. Las filas existentes y las que el
staff crea directo nacen `aprobada`, así que su comportamiento no cambia.

## Quién puede qué

| Acción | Quién |
| --- | --- |
| Registrar (reservar / enviar / descartar borrador) | Cualquier residente de la unidad (propietario, inquilino, familiar) |
| Retirar pendiente / dar de baja autorizado | Quien lo registró, o el propietario de la unidad |
| Aprobar / rechazar / asignar TAG | Staff de la empresa con `condominios.tab.mascotas` o `condominios.tab.vehiculos` |
| Leer documentos | Quien lo registró, el propietario de la unidad y el staff con el permiso del tab |
| Escribir documentos | Solo quien lo registró, y solo mientras es borrador |

El residente **no escribe las tablas**: sus policies de escritura siguen
exigiendo el permiso del tab. Todo pasa por RPC `SECURITY DEFINER`.

## Lo que se pide

**Mascota:** nombre, especie, raza, color, sexo, tamaño, peso, nacimiento,
esterilizada, microchip, foto, veterinario, última desparasitación, notas y el
**esquema de vacunas** (catálogo por especie — rabia, polivalente/DHPP,
parvovirus, moquillo, leptospirosis, bordetella… para perros; rabia, triple
felina, leucemia… para gatos — más "otra"), cada una con fecha aplicada y
próxima dosis. Perros y gatos deben declarar al menos una. `fecha_ultima_vacuna`
se deriva de las vacunas, así que la alerta de vacunas vencidas del panel sigue
funcionando. Adjuntos: carnet de vacunación, certificados.

**Vehículo:** placa (normalizada; única entre pendientes y aprobados del
condominio), tipo, marca, modelo, color, año, notas. Adjuntos: tarjeta de
circulación, licencia. Al aprobar, la administración asigna el **TAG de
ingreso** (código + tipo: sticker, RFID, tarjeta, control, otro), único por
condominio entre vehículos aprobados; también se puede asignar, reponer o
quitar después desde el padrón (🏷️).

### Placa única: garantía atómica

El `IF EXISTS` de `portal_enviar_vehiculo` solo da un mensaje legible en el caso
común: entre su `SELECT` y su `UPDATE` otra sesión puede enviar la misma placa, y
ninguna ve a la otra hasta el `COMMIT`. La garantía es el índice único parcial

```sql
idx_vehiculos_placa_unica ON vehiculos_residentes
  (project_id, upper(regexp_replace(btrim(placa), '\s+', ' ', 'g')))
  WHERE estado IN ('pendiente', 'aprobada')
```

La segunda inserción en el índice espera a que la primera transacción termine:
si ésta confirma, falla con `unique_violation` (la RPC la traduce al mismo
mensaje); si revierte, entra. Cubre también el alta y la edición directas del
staff (el panel muestra el mismo mensaje). Borradores, rechazados y bajas no
reservan la placa. Un vehículo que el staff **desactiva** sigue `aprobada` y
conserva su placa: para liberarla hay que darlo de baja o borrarlo.

**Auditoría previa.** Antes de crear el índice, la migración busca placas
duplicadas entre pendientes/aprobados y, si las hay, **aborta** nombrando cada
grupo (proyecto, placa, ids) sin borrar ni modificar ninguna fila. Al escribirla
(2026-10-16) producción y el sandbox RLS tenían 0 filas en `vehiculos_residentes`
(consulta de solo lectura como `postgres`).

## Versión de la migración

`20261031000500`: por encima del máximo de `main` (`20261031000300`) con
holgura, como pide `supabase/migrations/README.md`. Las versiones de este repo
son ordinales, no la fecha del calendario (las cinco anteriores también van por
delante de la fecha en que se escribieron); una versión con la fecha real
(`20261016…`) quedaría intercalada por debajo de `main` y el auditor de drift la
rechazaría. Se renombró desde `20261101000000` antes de aplicarse en ningún
entorno persistente (producción y sandbox RLS terminan en `20261031000300`).

## Verificación

- `supabase/tests/padron_autorizacion/run.sh` — 37 invariantes contra Postgres
  real con las policies vigentes, idempotencia, **concurrencia con sesiones
  reales** (dos envíos simultáneos de la misma placa: uno queda; si el primero
  revierte, el segundo entra), **auditoría** con duplicados preexistentes (aborta,
  filas y esquema intactos) y 10 mutantes, incluido uno sin el índice que hace
  fallar la prueba de concurrencia (CI: `coverage.yml`).
- `src/test/rls/rlsHarness.test.ts` — gate de rol de las 8 RPC `portal_*`
  contra el sandbox.
- Vitest: `PortalPadronTabs.test.tsx`, `SolicitudesPadronPanel.test.tsx`,
  `padronMascotas.test.ts`, `portalTabs.test.ts`.

Reversión: `scripts/reversion-padron-autorizacion.sql`.

## Despliegue

**Desplegada el 2026-10-16** (PR #947 fusionada como `33db8c8a`; run 38958867992 de «Apply Migrations to
Production», evento `push`, `success` a las 20:13 UTC). Comprobación posterior de solo lectura en producción
(2026-10-19 17:09 UTC): 887 migraciones, máx. `20261031000500`. Huella de producción recapturada
(`scripts/schema-drift/huella-produccion.json`): 32 grupos nuevos y 8 cambiados, 3699 → 3731. Son las 16 funciones
nuevas del padrón con sus grants, y columnas, constraints, índices y triggers de `mascotas` y
`vehiculos_residentes`, con valores idénticos a la reconstrucción de `main`. Los 3691 grupos restantes son
idénticos a la captura anterior y el sha256 completo coincide con el medido en producción; `drift-conocido.json`
no cambia.
