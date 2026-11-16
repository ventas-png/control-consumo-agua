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

- `companies.servicio_rentas` (**por defecto apagado**). Es un servicio aparte de Agua y de Condominios; lo enciende la
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

## Archivos

| Qué | Dónde |
|---|---|
| Migración | `supabase/migrations/20261125000000_rentas_modulo.sql` |
| Suite SQL (Postgres real, 58 comprobaciones, 5 mutantes) | `supabase/tests/rentas_modulo/` |
| Dominio | `src/domain/rentas/` (`logica.ts` pura, `queries.ts`, `mutations.ts`) |
| Pantallas | `src/components/rentas/` (`RentasSection.tsx` + `tabs/`) |
| Permisos en el front | `src/lib/moduleConfig.ts` (`RENTAS_*`), `src/hooks/usePermissions.ts`, `src/lib/rentasPermissions.ts` |
| Menú y rutas | `Sidebar.tsx` (grupo «Manejo Rentas»), `app/routes.tsx` (`/rentas`, `/rentas/<pestaña>`) |
| Recuperación | `scripts/reversion-rentas-modulo.sql` |
| CI | paso «Rentas — propiedades, reservas, contratos e inventario» en `coverage.yml` |

## Pruebas

```bash
supabase/tests/rentas_modulo/run.sh
npx vitest run src/domain/rentas src/components/rentas src/hooks/__tests__/usePermissions.rentas.test.ts src/__tests__/rentasModuloMigracion.test.ts
```

## Despliegue

1. Aplicar la migración (`apply-migrations-prod.yml`, aprobación `production-db`). El front tolera publicarse antes:
   `servicio_rentas` se lee en una consulta aparte y, si la columna no existe, el módulo simplemente no aparece.
2. Encender el servicio en cada empresa que lo contrate (panel de plataforma) u
   `UPDATE companies SET servicio_rentas = true WHERE id = …`.
3. Regenerar `database.types.ts` y la huella de producción como en cualquier migración.

## Límites conocidos

- Los montos son informativos: Rentas no genera cargos, cobros ni asientos contables.
- No hay fotos de propiedades ni de artículos, ni carga masiva (la de reservas STR sigue en Condominios).
- El solape de fechas entre reservas es un aviso, no un bloqueo (igual que en STR).
- El listado de empresas de la plataforma no muestra aún el servicio en la columna «Módulos»; sí en el detalle.
- `locales_comerciales` y `contratos_arrendamiento` de Condominios no se migran: son registros por proyecto y siguen
  donde están.
