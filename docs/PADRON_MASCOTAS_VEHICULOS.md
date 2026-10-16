# Mascotas y vehículos: registro desde el portal y autorización

Migración `20261101000000_padron_mascotas_vehiculos_autorizacion.sql`.

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

## Verificación

- `supabase/tests/padron_autorizacion/run.sh` — 34 invariantes contra Postgres
  real con las policies vigentes, idempotencia, y 8 mutantes (CI: `coverage.yml`).
- `src/test/rls/rlsHarness.test.ts` — gate de rol de las 8 RPC `portal_*`
  contra el sandbox.
- Vitest: `PortalPadronTabs.test.tsx`, `SolicitudesPadronPanel.test.tsx`,
  `padronMascotas.test.ts`, `portalTabs.test.ts`.

Reversión: `scripts/reversion-padron-autorizacion.sql`.
