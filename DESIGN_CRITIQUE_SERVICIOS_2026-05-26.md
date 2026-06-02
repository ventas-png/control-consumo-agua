# Design Critique — Módulos de Servicios (Energía · Mapa · Calidad)

**Fecha:** 2026-05-26
**Alcance:** Servicios paralelos al núcleo de agua: gestión de energía/electricidad, visualización geográfica, análisis de calidad de agua.
**Objetivo:** Identificar redundancias con agua, oportunidades de plugin architecture y gaps específicos para soportarlos como módulos premium/add-on en SaaS.
**Repo:** `ventas-png/control-consumo-agua` · v2.0.0
**Documentos relacionados:** `DESIGN_CRITIQUE_AGUA_2026-05-26.md`, `DESIGN_CRITIQUE_PLATAFORMA_SAAS_2026-05-26.md`.

---

## 1. Resumen ejecutivo

Estos tres módulos son **servicios laterales** que conviven con el core de agua. Características:

- **Energía** (~1.911 LOC, 7 archivos, 4 entidades, 1 edge function de cálculo): el más maduro de los tres. Modelo de facturación con tramos, exportación, alumbrado público, IVA. **Pero está catalogado dentro de AGUA_MODULE_GROUPS como `agua_servicios_energia`**, lo que conceptualmente lo hace sub-módulo de agua aunque debería ser un servicio paralelo.
- **Mapa** (~98 LOC, archivo único): visualizador puro con Leaflet. Sin clustering, sin capas, sin interacción. Read-only.
- **Calidad** (~530 LOC, 1 archivo + constants): registra análisis de agua con 9 tipologías y parámetros físico-químicos. Genera PDF. **Sobreescribe props del padre con fetch propio** — patrón confuso.

**Problemas transversales:**

1. **Cero tests** en los tres módulos.
2. **Energía reinventa** patrones de agua (callbacks CRUD, fetch directo, estilos inline) sin compartir abstracciones.
3. **Mapa subutilizado** — podría servir a condominios, rutas, calidad, energía, pero solo muestra clientes de agua.
4. **Sin plugin architecture** — agregar un servicio nuevo (gas, internet, basura) implica clonar y modificar `servicios-energia/`.
5. **Permisos confusos**: energía está bajo `AGUA_MODULE_GROUPS`, no es un módulo de primer nivel.

**Conteo de hallazgos:**

| Severidad | Cantidad |
|-----------|----------|
| 🔴 Crítico | 3 |
| 🟠 Alto    | 11 |
| 🟡 Medio   | 10 |
| 🔵 Bajo    | 4 |
| **Total** | **28** |

**Bloqueantes para SaaS:** S1 (plugin architecture), S2 (energía como sub-módulo de agua), S8 (mapa monolítico), S15 (validaciones de calidad débiles).

---

## 2. Eje E1 — Servicios Energía

### S1 · 🔴 Crítico — Energía catalogada como sub-módulo de agua

`src/lib/aguaPermissions.ts:16` lista `agua_servicios_energia` dentro de `AGUA_MODULE_GROUPS`. Si una administradora compra solo "control de energía" (no agua), tiene que activar todo el módulo de agua para acceder.

**Impacto SaaS:** Pricing y modularidad bloqueados. Imposible vender energía como add-on independiente.

**Recomendación:** Promover energía a módulo de primer nivel:

```ts
export const ENERGIA_MODULE_GROUPS: SectionGroup[] = [
  { key: 'energia_proveedores', ... },
  { key: 'energia_tarifas', ... },
  { key: 'energia_fuentes', ... },
  { key: 'energia_facturas', ... },
  { key: 'energia_dashboard', ... },
]
```

Plan flag `companies.servicio_energia` análogo a `servicio_agua`.

---

### S2 · 🔴 Crítico — `FuenteEnergia.fuente_agua_id` acopla fuertemente con agua

La FK existe (`fuentes_energia.fuente_agua_id REFERENCES fuentes_agua(id)`). Razonable cuando es la misma fuente física, pero hace **imposible** desplegar energía sin tener tablas de agua creadas.

**Recomendación:** Hacerla nullable y crear concepto `recurso_fisico` (id, tipo: agua/energia/ambos, ubicación, GPS) al que ambas fuentes pueden apuntar. Si no hay relación, no hay FK.

---

### S3 · 🟠 Alto — `ServiciosEnergiaSection.tsx` (186L) replica patrón de agua sin reutilizar

Switch entre tabs (Proveedores, Tarifas, Fuentes, Facturas, Dashboard) con callbacks CRUD (`onProveedorAdded`, `onProveedorUpdated`). Idéntico al patrón monolítico de agua (`App.tsx` switch + props). No usa hooks compartidos.

**Recomendación:** Cuando se introduzca `react-router-dom` (Fase 1 plataforma), energía pasa a tener sus propias rutas (`/energia/proveedores`, `/energia/tarifas`, ...). Capa de datos `src/domain/energia/` con TanStack Query.

---

### S4 · 🟠 Alto — Fetch directo en cada tab

Igual que en condominios: cada tab energía abre Supabase a mano. Sin TanStack Query, sin invalidación automática entre tabs.

---

### S5 · 🟠 Alto — `businessEnergia.ts` aislado de `business.ts`

Dos calculadores de factura (agua / energía) sin interfaz común. Cuando entre gas/internet/basura habrá 5 implementaciones independientes.

**Recomendación:** Interfaz `CalculadorFactura<TInput, TOutput>` con implementaciones por servicio. Tests por implementación.

---

### S6 · 🟠 Alto — Sin validación "kwh_actual ≥ kwh_anterior"

Mismo problema que en agua. Si el operador captura una lectura menor, calcula consumo negativo o erróneo.

**Recomendación:** Validación shared en `domain/serviciosMedidos/validations.ts` consumible desde agua y energía.

---

### S7 · 🟡 Medio — Tarifas energía sin tramos escalonados

`businessEnergia.ts` modela precio_kwh único + alumbrado + IVA + exportación, pero no tramos escalonados. Tarifas reales suelen tener bloques.

**Recomendación:** Estructura `precio_kwh_tramos: { hasta_kwh, precio }[]` con cálculo escalonado. Mismo patrón que `business.ts` (3 tramos).

---

### S8 · 🟡 Medio — Sin captura GPS / foto en lecturas de energía

Las lecturas de agua sí capturan GPS y foto. Las de energía no (basado en `FacturaEnergia` sin esos campos).

**Recomendación:** Agregar a `lecturas_energia` (si existe) o `facturas_energia.lectura_inicial/final` con metadata GPS+foto.

---

### S9 · 🟡 Medio — RLS sin granularidad por proyecto/colector en energía

Migración `20260414000001_create_servicios_energia.sql` tiene RLS por rol pero no por colector asignado (mismo problema que agua).

---

### S10 · 🟡 Medio — Sin tests de `businessEnergia.ts`

73 líneas de cálculo sin tests. Si alguien cambia la lógica del IVA o de la exportación, no hay red.

**Recomendación:** Spec por escenario (consumo normal, alumbrado fijo, alumbrado porcentual, exportación con crédito, demanda alta).

---

### S11 · 🟡 Medio — Sin integración con factura digital electrónica regional

GT (FEL), MX (CFDI), CO (DIAN) requieren formato específico de factura. Energía emite PDF simple sin firma digital ni timbrado.

**Recomendación:** En la Fase 4 SaaS, edge function `emitir-fel` por país. Adapter por jurisdicción.

---

### S12 · 🔵 Bajo — `numero_factura` permite duplicados

Sin constraint UNIQUE en `(company_id, project_id, proveedor_id, numero_factura)`.

---

## 3. Eje E2 — Mapa

### S13 · 🟠 Alto — `MapaSection.tsx` monolítico genérico para agua

`MapaSection.tsx` (98 LOC) solo conoce `Cliente` + `Registro` de agua. No puede mostrar visitantes, incidentes de condominios, fuentes de energía, contadores de calidad. Genérico en intención pero específico en implementación.

**Recomendación:** Componente `<MapView layers={[...]} />` con definición de capas:

```ts
type Layer = {
  key: string
  label: string
  visible: boolean
  fetchPoints: () => Promise<MapPoint[]>
  renderPin: (point) => ReactNode
  renderPopup: (point) => ReactNode
}
```

Cada módulo aporta sus capas (clientes agua, fuentes energía, visitantes condominios, etc.). El mapa los integra con un layer-control.

---

### S14 · 🟠 Alto — Sin clustering ni paginación de pines

`L.featureGroup` con todos los markers a la vez. Con 5.000 contadores el mapa colapsa.

**Recomendación:** `leaflet.markercluster` plugin. Cargar puntos visibles via bbox.

---

### S15 · 🟠 Alto — Sin interacción (click para crear / arrastrar)

No se puede pinchar el mapa para crear un contador, ni mover un pin para corregir GPS. Pura visualización.

**Recomendación:** Modo "editar GPS" en el detalle de contador. Componente reutilizable de captura GPS para `LecturasSection`.

---

### S16 · 🟡 Medio — Coordenadas hard-coded a Guatemala

`L.map(...).setView([14.6349, -90.5069], 13)`. Sin respeto al locale del tenant.

**Recomendación:** `companies.center_lat/lng/zoom_default` por tenant.

---

### S17 · 🟡 Medio — Sin filtros (estado, ruta, fecha)

El mapa muestra todos los clientes/registros. Sin filtro por estado de cobro, por ruta asignada, por rango de fecha.

---

### S18 · 🔵 Bajo — Sin modo "mapa de calor"

Útil para identificar zonas de alto consumo / mora / fugas. No implementado.

---

### S19 · 🔵 Bajo — Tiles de OSM sin atribución

`L.tileLayer('https://{s}.tile.openstreetmap.org/...')` sin `.attribution = '© OSM'`. Viola los terms de OSM.

---

## 4. Eje E3 — Calidad

### S20 · 🔴 Crítico — Sin validaciones de negocio del análisis

`calcularCumplimiento` valida rango por parámetro pero:
- No verifica que el análisis sea realizado por laboratorio acreditado.
- No requiere evidencia (PDF/foto) — actualmente opcional.
- No marca incumplimientos críticos vs aceptables.
- No genera alerta proactiva al guardar un análisis fuera de norma.

**Impacto SaaS:** Para clientes regulados (administradores con compliance ambiental, condominios premium con auditorías), esto es bloqueante.

**Recomendación:**
- Campo `laboratorio_acreditado_id`, `tecnico_responsable`.
- Adjunto obligatorio (PDF certificado o foto firmada).
- Niveles de gravedad: crítico (notifica admin de inmediato), advertencia (informa en próximo reporte).
- Edge function `notify-quality-breach` que envía email/WhatsApp si el análisis incumple.

---

### S21 · 🟠 Alto — `CalidadSection` sobreescribe props del padre con fetch propio

El padre pasa `fuentesAgua` y `registrosCalidad`, pero el componente los descarta y vuelve a hacer `supabase.from(...)`. Confuso y duplica trabajo.

**Recomendación:** Eliminar las props no usadas. O migrar todo a TanStack Query y eliminar el fetch local.

---

### S22 · 🟠 Alto — Cálculo de cumplimiento solo en cliente

`calcularCumplimiento()` corre en JS. Si guardamos el cumplimiento calculado, debería ser revalidable en DB.

**Recomendación:** Función Postgres `calcular_cumplimiento(tipo_agua, parametros jsonb)` que devuelve el mismo resultado. Trigger en `registros_calidad` BEFORE INSERT/UPDATE que recalcula y persiste.

---

### S23 · 🟠 Alto — TIPOLOGIAS_CALIDAD hard-coded en cliente

`src/components/calidad/constants.ts` define 9 tipologías con sus rangos. Si una autoridad sanitaria actualiza el rango admitido de coliformes, hay que hacer code push.

**Recomendación:** Tabla `parametros_calidad_norma` (norma_id, tipo_agua, parametro_key, min, max, unidad, gravedad). Tabla `normas_calidad` (id, codigo, nombre, region/país, vigencia). UI para super_admin que actualice rangos sin deploy.

---

### S24 · 🟠 Alto — Reporte adjunto en base64 dentro del registro

`registros_calidad.reporte_base64` guarda el PDF/imagen como base64 en la fila. Infla la tabla y rompe paginación rápida.

**Recomendación:** Subir a bucket `calidad-reportes/{project_id}/{registro_id}/` y guardar `storage_path`. RLS por rol.

---

### S25 · 🟠 Alto — Sin histórico/tendencia por fuente

UI muestra registros como tabla. No hay gráfico de tendencia (pH a lo largo del tiempo, coliformes por mes). Difícil identificar deterioro.

**Recomendación:** Tab "Tendencia" con chart.js por parámetro × fuente × rango de fecha. Alerta si la tendencia indica deterioro (n análisis consecutivos fuera de rango).

---

### S26 · 🟡 Medio — Sin programación de muestreos

No hay calendario de análisis programados (mensual, trimestral) ni alerta cuando se aproxima el siguiente muestreo.

**Recomendación:** Tabla `plan_muestreo` (fuente_id, frecuencia, proximo_muestreo, asignado_a). Cron edge function envía recordatorio.

---

### S27 · 🟡 Medio — Sin export Excel

Solo PDF. Para reportes regulatorios suele pedirse CSV/Excel con histórico.

---

### S28 · 🟡 Medio — Sin integración con dispositivos IoT

Sondas IoT (pH, cloro, conductividad) podrían volcar lecturas automáticamente. Hoy todo es captura manual.

**Recomendación:** Edge function `ingest-iot-quality` que recibe payloads de Influx/AWS IoT y crea `registros_calidad` automáticos.

---

## 5. Eje E4 — Transversal (Plugin Architecture)

### S29 · 🟠 Alto — Sin abstracción "servicio medido"

Agua y energía comparten estructura conceptual (medidor → lecturas → factura). Cada uno reimplementa entidades, validaciones, UI. Cuando entren gas, internet, basura → N reimplementaciones.

**Recomendación:** Abstracción de "Servicio Medido":

```ts
type ServicioMedido = {
  tipo: 'agua' | 'energia' | 'gas' | ...
  medidor: MedidorBase
  calcularConsumo: (lectura_anterior, lectura_actual) => number
  calcularFactura: (consumo, tarifa) => Factura
}
```

Plugin architecture. Cada servicio extiende. UI genérica.

---

## 6. Roadmap para robustecer como SaaS

> `[+]` marca trabajo compartido con critiques previos.

### Fase 1 — Fundaciones
- `[+]` Router por dominio (`/energia/*`, `/mapa`, `/calidad/*`).
- `[+]` TanStack Query + `src/domain/{energia,calidad}/api.ts`.
- Promover energía a módulo de primer nivel (S1).
- Hacer `fuente_agua_id` nullable + concepto `recurso_fisico` (S2).
- Componente `<MapView layers={[]} />` genérico (S13).

### Fase 2 — Dominio
- Validaciones de lectura compartidas para agua/energía (S6).
- Cálculo de cumplimiento en Postgres + trigger (S22).
- Tablas `normas_calidad` y `parametros_calidad_norma` (S23).
- Reportes de calidad a bucket Storage (S24).
- Plugin "Servicio Medido" (S29).
- Tarifa escalonada en energía (S7).

### Fase 3 — UX
- `[+]` Reemplazar SweetAlert2 en energía/calidad por Radix.
- `[+]` Adoptar `<DataTable>` shared en los tabs de energía.
- Clustering + filtros + paginación en mapa (S14, S17).
- Modo editar GPS y captura desde mapa (S15).
- Gráficos de tendencia por parámetro de calidad (S25).
- Plan de muestreo con alertas (S26).

### Fase 4 — Operaciones SaaS
- Feature flag por plan: energía/calidad/mapa premium (S1, S20).
- Notificación de incumplimiento de calidad (S20).
- Facturación electrónica regional (FEL/CFDI/DIAN) (S11).
- IoT ingest (S28).
- Export Excel de calidad (S27).

### Fase 5 — Calidad continua
- Tests del cálculo de factura energía y de cumplimiento (S10, S22).
- `[+]` axe-core en CI cubre estos módulos.
- Heatmap de zonas en mapa (S18).
- Atribución OSM (S19).
- Coordenadas/locale por tenant (S16).

---

## 7. Tabla consolidada

| ID  | Sev. | Hallazgo                                                       | Evidencia                                                                  | Fase |
|-----|------|----------------------------------------------------------------|----------------------------------------------------------------------------|------|
| S1  | 🔴   | Energía catalogada como sub-módulo de agua                     | `src/lib/aguaPermissions.ts:16`                                            | 1    |
| S2  | 🔴   | `FuenteEnergia.fuente_agua_id` acopla con agua                 | `supabase/migrations/20260414000001_create_servicios_energia.sql`          | 1    |
| S3  | 🟠   | `ServiciosEnergiaSection.tsx` replica patrón monolítico        | `src/components/servicios-energia/ServiciosEnergiaSection.tsx:186 LOC`     | 1    |
| S4  | 🟠   | Fetch directo en cada tab                                       | `src/components/servicios-energia/tabs/*`                                  | 1    |
| S5  | 🟠   | `businessEnergia.ts` aislado de `business.ts`                  | `src/lib/businessEnergia.ts:73 LOC` vs `src/lib/business.ts:42 LOC`        | 2    |
| S6  | 🟠   | Sin validación `kwh_actual ≥ anterior`                          | `businessEnergia.ts`                                                       | 2    |
| S7  | 🟡   | Tarifas energía sin tramos escalonados                          | `businessEnergia.ts:calcularFacturaEnergia`                                | 2    |
| S8  | 🟡   | Sin GPS/foto en lecturas energía                                 | `types/index.ts:FacturaEnergia`                                            | 3    |
| S9  | 🟡   | RLS sin granularidad por colector en energía                    | `20260414000001_create_servicios_energia.sql`                              | 2    |
| S10 | 🟡   | Sin tests de `businessEnergia.ts`                                | sin `*.test.*`                                                              | 5    |
| S11 | 🟡   | Sin integración FEL/CFDI/DIAN                                   | sin edge function                                                          | 4    |
| S12 | 🔵   | `numero_factura` permite duplicados                             | schema                                                                     | 5    |
| S13 | 🟠   | Mapa monolítico específico para agua                            | `src/components/mapa/MapaSection.tsx:98 LOC`                               | 1    |
| S14 | 🟠   | Sin clustering ni paginación de pines                            | `MapaSection.tsx`                                                          | 3    |
| S15 | 🟠   | Mapa sin interacción (no click para crear)                       | `MapaSection.tsx`                                                          | 3    |
| S16 | 🟡   | Coordenadas hard-coded a Guatemala                               | `MapaSection.tsx` `[14.6349, -90.5069]`                                    | 5    |
| S17 | 🟡   | Sin filtros (estado/ruta/fecha)                                  | `MapaSection.tsx`                                                          | 3    |
| S18 | 🔵   | Sin modo mapa de calor                                            | `MapaSection.tsx`                                                          | 5    |
| S19 | 🔵   | Tiles OSM sin atribución                                          | `MapaSection.tsx`                                                          | 5    |
| S20 | 🔴   | Calidad sin validaciones de laboratorio/severidad/notificación   | `src/components/calidad/CalidadSection.tsx:530 LOC`                        | 2,4  |
| S21 | 🟠   | `CalidadSection` sobreescribe props con fetch propio              | `CalidadSection.tsx`                                                       | 1    |
| S22 | 🟠   | Cálculo de cumplimiento solo en cliente                           | `calcularCumplimiento`                                                     | 2    |
| S23 | 🟠   | `TIPOLOGIAS_CALIDAD` hard-coded en cliente                        | `src/components/calidad/constants.ts:130 LOC`                              | 2    |
| S24 | 🟠   | Reporte adjunto en base64 dentro del registro                     | `registros_calidad.reporte_base64`                                         | 2    |
| S25 | 🟠   | Sin histórico/tendencia por fuente                                | `CalidadSection.tsx`                                                       | 3    |
| S26 | 🟡   | Sin programación de muestreos                                      | sin tabla                                                                  | 3    |
| S27 | 🟡   | Sin export Excel de calidad                                        | `CalidadSection.tsx` solo PDF                                              | 4    |
| S28 | 🟡   | Sin integración con dispositivos IoT                               | sin edge function                                                          | 4    |
| S29 | 🟠   | Sin abstracción "servicio medido" para plugin architecture          | agua + energía como islas                                                  | 2    |

---

## 8. Priorización para SaaS

**Bloqueantes (Fase 1-2):** S1 · S2 · S13 · S20 · S22 · S29.
**Importantes (Fase 2-3):** S3 · S4 · S5 · S6 · S14 · S15 · S21 · S23 · S24 · S25.
**Mejoras (Fase 3-5):** resto.
