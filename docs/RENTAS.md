# Manejo de Rentas

Migración `20261125000000_rentas_modulo`. Tercer grupo del menú, junto a Manejo Agua y Manejo Condominios: la
**cartera de propiedades en renta de la empresa** —las unidades de sus condominios que se rentan y las propiedades que
administra por fuera—, con sus reservas, contratos e inventario.

## Qué resuelve

Las rentas de corto plazo (STR) sólo existían dentro de un condominio (`reservas_str.project_id` es obligatorio). La
empresa que además administra una casa, un local o una bodega no tenía dónde registrarlos, ni una vista de toda su
cartera, ni dónde llevar lo que hay dentro de cada propiedad.

## Modelo

| Tabla | Qué guarda |
|---|---|
| `rentas_propiedades` | Catálogo a nivel **empresa**. Independiente (`project_id`/`unidad_id` nulos) o **enlazada** a una unidad de un proyecto. Tipo: `corto_plazo`, `largo_plazo`, `local_comercial`, `otro` (+ `tipo_detalle`). Estado operativo: `activa`, `mantenimiento`, `inactiva`. Propietario, características, tarifa base y comisión de administración. |
| `rentas_reservas` | Estancias por noche de propiedades **independientes** de corto plazo. |
| `rentas_contratos` | Renta mensual (largo plazo, locales, otros): inquilino, vigencia (fin vacío = indefinido), renta, depósito, día de pago. **Un solo contrato vigente por propiedad.** |
| `rentas_inventario` | Artículos de cada propiedad: categoría, ambiente, cantidad, estado (`bueno`, `regular`, `danado`, `faltante`), valor, serie, última revisión. |

**Una sola fuente de reservas por propiedad.** Las reservas de una propiedad enlazada a una unidad siguen en
`reservas_str` (ahí viven el check-in, los huéspedes, housekeeping y el portal). Manejo de Rentas las **lee y escribe en
esa misma tabla**: lo que se registra aquí aparece en Condominios › STR y al revés. El trigger rechaza una fila en
`rentas_reservas` para una propiedad enlazada (`RENTAS_RESERVA_ENLAZADA`).

**«Ocupada» no se guarda.** Se deriva: una reserva no cancelada que cubre el día (el día de salida ya no cuenta) o un
contrato vigente dentro de sus fechas. Un contrato vencido sin cerrar no ocupa, y se avisa.

## Servicio y permisos

- `companies.servicio_rentas` (**por defecto apagado**). Es el tercer módulo del plan (ver «Plan y cobro»); lo enciende la
  plataforma en *Empresas › detalle › Módulos › Manejo de Rentas*. Apagado, la RLS de las cuatro tablas no deja leer ni
  escribir (ni a la dueña) y el menú no aparece; los datos se conservan.
- 16 claves RBAC `rentas.<propiedades|reservas|contratos|inventario>.<view|create|edit|delete>`. Dueño y
  administradores tienen acceso completo; al resto se le otorgan en el editor de roles (sección «Rentas»).
- Escribir exige además `.view`. El **Panel** se abre con cualquier `.view`. El catálogo de propiedades lo lee
  cualquiera que vea algún módulo (quien lleva sólo inventario necesita saber de qué propiedad es cada artículo).
- **Alcance por proyecto:** quien está acotado a proyectos ve las propiedades independientes y las enlazadas a *sus*
  proyectos, y sólo las hijas de esas.
- Para escribir reservas de una propiedad enlazada aplica la RLS vigente de `reservas_str` (pestaña STR de
  Condominios); eliminarlas se hace desde allá.

Las tablas hijas cuelgan de la propiedad por llave **compuesta** `(propiedad_id, company_id)`: una fila no puede
colgar de la propiedad de otra empresa.

## Plan y cobro (migración `20261126000000_rentas_tercer_modulo_del_plan`)

Rentas es el **tercer módulo del plan**, igual que Agua y Condominios.

| Módulos | Plan (`billing_plans.code`) | Activación |
|---|---|---|
| Rentas | `rentas_only` | $10 |
| Agua + Rentas | `agua_rentas` | $15 |
| Condominios + Rentas | `condominios_rentas` | $15 |
| Agua + Condominios + Rentas | `suite` | $20 |

(`agua_only`, `condominios_only` y `bundle` no cambian.) Los precios por uso —proyecto adicional $10, unidad del proyecto
principal $1, unidad adicional $0.80— son los mismos en todos los planes. Los planes nuevos heredan los `feature_codes`
del plan equivalente sin Rentas (uno con Condominios conserva `asambleas_digitales`).

- **Una sola tabla módulos → plan:** `plan_code_por_modulos(agua, condominios, rentas)`. La usan el alta de empresa
  (`create_trial_subscription`) y el trigger de los interruptores. Su espejo en el front es `planCodePorModulos`
  (`src/components/superadmin/empresaHelpers.ts`), con una prueba que los compara caso por caso.
- **Los interruptores mueven el plan.** En *Gestión de Empresas › detalle › Módulos*, encender o apagar Agua,
  Condominios o Rentas pasa la suscripción viva al plan de esa combinación (`trg_companies_modulos_plan`) y el total se
  recalcula. Con todos apagados la empresa conserva su último plan. Si la suscripción **ya se factura por Stripe** el
  cambio se rechaza (`MODULOS_PLAN_STRIPE`): repuntar el plan sin cambiar los precios en Stripe duplicaría líneas; ese
  cambio va por el checkout.
- **La empresa no se enciende módulos.** `lock_companies_billing_columns` congela `servicio_agua`,
  `servicio_condominios` y `servicio_rentas` para todo el que no sea la plataforma (antes un dueño podía cambiarlos por
  la API).
- **Las propiedades independientes cuentan como unidades adicionales** (las que no tienen unidad enlazada, y sólo con
  Rentas contratado): entran en `calculate_monthly_total_cents` (a $0.80), en `get_company_usage`, en el panel de
  plataforma y contra `max_units` al registrarlas (`plan_limit_reached`). Una enlazada a una unidad no se cobra dos
  veces.
- **Registro:** la pantalla de alta y `signup-company` aceptan Rentas como módulo; el trial nace en el plan de la
  combinación elegida. La página de precios deja elegir uno o varios módulos (10 / 15 / 20).

Lo que **no** hace: no cambia el plan de ninguna empresa existente hasta que alguien toque sus módulos; no crea precios
en Stripe (los planes nuevos nacen sin `stripe_price_id_*`, como los tres actuales en producción); no toca
`enforce_max_units` (drift declarado), así que el tope al crear una *unidad* sigue contando sólo unidades.

## Finanzas (migración `20261128000000_rentas_finanzas`)

Lleva dentro de la aplicación la hoja de Excel que las administradoras mantienen por apartamento.

- **Conceptos** (`rentas_conceptos`): las columnas del desglose, por empresa, en dos bloques: «Cobro al huésped» y
  «Recibido por el anfitrión». Cada uno suma o resta (`signo`) y entra o no en la base de la comisión
  (`comisionable`). Al contratar Rentas se siembran los 13 de la hoja de Airbnb; la empresa los renombra, reordena,
  desactiva o agrega propios desde **Finanzas › Configurar conceptos**. No se borran.
- **Desglose de una reserva** (`rentas_liquidaciones.importes`: concepto → monto ≥ 0). Una fila por reserva, sea de
  `rentas_reservas` o de `reservas_str` (propiedad enlazada): esta última no se toca. Se captura en el formulario
  de la reserva; al guardar, el `monto_total` de la reserva pasa a ser el «Total recibido». Los totales no se
  almacenan: se calculan con los conceptos vigentes (`totalesDesglose`).
- **Gastos** (`rentas_gastos`): por propiedad y fecha, a cargo del propietario o de la administradora.
- **El mes** (`resumenMes`, puro): el dinero de una reserva va entero al mes en que **entra**; la ocupación cuenta
  las noches que caen en el mes. `acreditado − comisión − gastos del propietario = a pagar al propietario`. La
  comisión es `comision_pct` de la propiedad sobre los conceptos comisionables (más la renta de contratos). Una
  reserva sin desglose aporta su `monto_total`. El test `finanzas.test.ts` reproduce una hoja real (febrero 2026).
- **Pantalla** `/rentas/finanzas`: cartera del mes (una fila por propiedad) y, por propiedad, calendario día por
  día, ocupación, ingresos por concepto, estado del propietario, gastos y PDF del estado mensual. El Panel muestra
  los totales del mes en curso a quien ve Finanzas.
- **Importar reservas**: plantilla Excel/CSV con una columna por concepto activo; una fila con un código de reserva
  que ya existe en la propiedad la actualiza. No lee el CSV de ganancias de Airbnb tal cual.
- **Permisos**: `rentas.finanzas.*` cubre gastos, conceptos y ver el estado mensual. El desglose es parte de la
  reserva: lo escribe quien crea o edita reservas y lo lee Reservas o Finanzas.

## Moneda y carga masiva (migración `20261129000000_rentas_moneda`)

- **Moneda por reserva, gasto y contrato**: columna `moneda` (ISO 4217 en mayúsculas, `USD` por defecto) en
  `rentas_liquidaciones`, `rentas_gastos` y `rentas_contratos`. La de la reserva vive en su ficha de liquidación
  —que sirve a las dos fuentes de reservas—; una reserva sin ficha se considera en USD (`monedaDeReserva`).
- **Sin tipo de cambio**: Finanzas muestra una moneda a la vez (selector, USD por defecto) y avisa cuando el mes
  tiene montos en otras. Una estadía en otra moneda cuenta para la ocupación, no para el dinero. El Panel resume en USD.
- **Carga masiva** desde la pestaña Reservas: la misma plantilla de Finanzas con las columnas `Propiedad` (nombre o
  código; se omite si hay una propiedad filtrada) y `Moneda`. Código de reserva repetido en la misma propiedad = actualización.

## Tendencia

**Finanzas › Tendencia** muestra el desempeño mes a mes de una propiedad o de toda la cartera en los últimos 6, 12 o
24 meses (hasta el mes elegido): acreditado y ocupación por mes en dos gráficas —una medida cada una—, los totales
del periodo (acreditado, ocupación, ingreso por noche ocupada, mejor mes, a pagar a propietarios) y la tabla, desde
la que se salta al detalle de un mes. Es el mismo cálculo de `resumenCarteraMes` repetido por mes (`tendenciaMeses`,
puro), en la moneda elegida. Se alimenta del historial cargado con «Carga masiva».

## La reserva con los datos de la estancia (migración `20261203000000_rentas_reservas_estancia`)

El formulario de reserva de Rentas captura lo mismo que el de la pestaña STR de Condominios:

- **Todas las propiedades**: fecha de reservación, hora estimada de llegada y de salida, y el grupo como adultos /
  niños / bebés (`num_huespedes` sigue siendo el total). Para las independientes son columnas nuevas de
  `rentas_reservas`; para las enlazadas, las de `reservas_str` que ya existían.
- **Sólo propiedades enlazadas a un condominio**: fotos del huésped principal y de su documento, y las personas del
  grupo. Son las mismas columnas `foto_url` / `foto_documento_url` y las mismas filas `huespedes_str` de la pestaña
  STR (bucket `condominios-media`, que autoriza por proyecto), así que lo capturado en un lado se ve en el otro y
  sirve al control de ingreso. Las independientes no las llevan todavía: necesitan su propio bucket y tabla.
- Una persona del grupo que ya registró su ingreso no se quita. Si la reserva se guarda y el grupo falla, se avisa
  aparte y la reserva queda.
- La carga masiva no trae estos campos y no los pisa al actualizar una reserva existente.

## STR es operativo; el dinero vive en Rentas

La pestaña STR de Condominios ya no pide ni muestra montos: sin «Tarifa/noche» ni «Total» en el formulario, sin el
indicador «Ingreso del mes» y sin el monto en la tarjeta de la reserva. Al guardar desde STR los montos no viajan,
así que los que la reserva ya tenga (capturados en Rentas o por carga masiva) se conservan. La tarifa, el total, la
moneda y el desglose se llevan en Manejo de Rentas › Reservas y Finanzas.

Las horas estimadas de llegada y salida se eligen con `HoraSelect` (hora, minutos cada 15, a. m. / p. m.) en los dos
formularios, sin teclado.

## Archivos

| Qué | Dónde |
|---|---|
| Migración | `supabase/migrations/20261125000000_rentas_modulo.sql` |
| Suite SQL (Postgres real, 58 comprobaciones, 5 mutantes) | `supabase/tests/rentas_modulo/` |
| Migración del plan y su suite (46 comprobaciones, 7 mutantes) | `supabase/migrations/20261126000000_rentas_tercer_modulo_del_plan.sql`, `supabase/tests/rentas_plan/` |
| Finanzas y moneda: migraciones y suite (53 comprobaciones, 6 mutantes) | `supabase/migrations/20261128000000_rentas_finanzas.sql`, `20261129000000_rentas_moneda.sql`, `supabase/tests/rentas_finanzas/` |
| Dominio | `src/domain/rentas/` (`logica.ts`, `finanzas.ts` e `importacion.ts` puras; `queries.ts`, `mutations.ts`) |
| Pantallas | `src/components/rentas/` (`RentasSection.tsx` + `tabs/`) |
| Permisos en el front | `src/lib/moduleConfig.ts` (`RENTAS_*`), `src/hooks/usePermissions.ts`, `src/lib/rentasPermissions.ts` |
| Menú y rutas | `Sidebar.tsx` (grupo «Manejo Rentas»), `app/routes.tsx` (`/rentas`, `/rentas/<pestaña>`) |
| Recuperación | `scripts/reversion-rentas-modulo.sql`, `scripts/reversion-rentas-plan.sql`, `scripts/reversion-rentas-finanzas.sql` |
| CI | paso «Rentas — propiedades, reservas, contratos e inventario» en `coverage.yml` |

## Pruebas

```bash
supabase/tests/rentas_modulo/run.sh
supabase/tests/rentas_plan/run.sh
supabase/tests/rentas_finanzas/run.sh
npx vitest run src/domain/rentas src/components/rentas src/hooks/__tests__/usePermissions.rentas.test.ts src/__tests__/rentasModuloMigracion.test.ts src/__tests__/rentasFinanzasMigracion.test.ts
```

## Despliegue

1. Aplicar la migración (`apply-migrations-prod.yml`, aprobación `production-db`). El front tolera publicarse antes:
   `servicio_rentas` se lee en una consulta aparte y, si la columna no existe, el módulo simplemente no aparece.
2. Encender el servicio en cada empresa que lo contrate (panel de plataforma) u
   `UPDATE companies SET servicio_rentas = true WHERE id = …`.
3. Regenerar `database.types.ts` y la huella de producción como en cualquier migración.

## Límites conocidos

- Los montos son informativos: Rentas no genera cargos, cobros ni asientos contables.
- El selector de plan del perfil de la empresa lista todos los planes activos (ahora siete) sin filtrar por sus módulos; cambiar de plan desde ahí no enciende módulos.
- El panel de plataforma refresca sus totales cada 15 minutos: tras mover un interruptor, el detalle de la empresa muestra el plan y el desglose al momento, el listado puede tardar.
- No hay fotos de propiedades ni de artículos.
- Finanzas no cierra meses: el estado mensual se recalcula cada vez; cambiar una reserva, un gasto, el signo de un
  concepto o la comisión de la propiedad cambia también los meses pasados. No registra el pago al propietario.
- El importador de reservas usa su propia plantilla; el CSV de ganancias de Airbnb no se interpreta directamente.
- La comisión es un único porcentaje por propiedad; no hay tramos ni comisión fija por estadía.
- El solape de fechas entre reservas es un aviso, no un bloqueo (igual que en STR).
- `locales_comerciales` y `contratos_arrendamiento` de Condominios no se migran: son registros por proyecto y siguen
  donde están.
