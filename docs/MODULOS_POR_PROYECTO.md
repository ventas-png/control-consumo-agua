# Módulos por proyecto

Migración `20261127000000_modulos_por_proyecto`. La empresa contrata módulos (Agua, Condominios, Rentas) y **cada
proyecto elige en cuáles de ellos opera**: un edificio con los tres, un residencial con Agua + Condominios, una
lotificación sólo con Agua.

## Regla

Un módulo está activo en un proyecto cuando **la empresa lo tiene contratado** (`companies.servicio_*`) **y el proyecto
lo tiene encendido** (`projects.modulo_agua`, `modulo_condominios`, `modulo_rentas`; por defecto `true`). El interruptor
del proyecto sólo resta sobre lo contratado: nunca enciende un módulo que la empresa no paga.

No cambia el plan ni el cobro: la activación se paga por empresa, y proyectos y unidades se cuentan igual tengan los
módulos que tengan.

## Dónde se elige

*Mis Proyectos › tarjeta del proyecto › **Módulos*** (aparece con dos o más módulos contratados). Cada tarjeta muestra los
módulos activos del proyecto.

- Sólo el **propietario** de la empresa (y la plataforma) mueve los interruptores, igual que crear o borrar proyectos.
  Un administrador sigue editando el resto del proyecto. La base lo hace cumplir: `MODULOS_PROYECTO_SOLO_PRINCIPAL`.
- Un proyecto conserva **al menos un módulo de los contratados**: `MODULOS_PROYECTO_VACIO`.
- Apagar un módulo **no borra nada**: los datos del proyecto en ese módulo se conservan y vuelven al encenderlo.

## Qué cambia al apagar un módulo en un proyecto

| Módulo | Efecto |
|---|---|
| Agua | El proyecto, sus unidades, contadores, lecturas, tarifas y rutas salen de las secciones de Manejo Agua (lecturas, historial, cobros, dashboard, mapa, rutas, tarifas, contadores). |
| Condominios | El proyecto deja de ofrecerse en el selector de condominio y en el panel de Condominios. |
| Rentas | Sus unidades ya no se pueden enlazar como propiedad en renta (`RENTAS_PROYECTO_SIN_MODULO`). Lo ya enlazado se conserva. |

- **Menú:** si *ninguno* de los proyectos que una persona ve opera en Agua (o en Condominios), ese grupo del menú se
  oculta. Así, quien está asignado sólo a un proyecto de Agua no ve Condominios. Rentas no se oculta por esto: tiene
  propiedades independientes, que no cuelgan de ningún proyecto.
- **Portal del residente:** `portal_mis_unidades` cruza el servicio de la empresa con el módulo del proyecto de cada
  unidad. El residente de un proyecto de sólo Agua entra al portal de Agua, no al de Condominios.
  - La sesión guarda cada servicio como `true` **o `false`** (`serviciosDelResidente`, `src/lib/portalServicios.ts`) y
    `App` elige el portal con `portalDelCliente`. Antes un servicio que ninguna unidad tenía quedaba `undefined`, y
    `servicio_agua !== false` lo leía como «tiene Agua»: el residente de un condominio sin Agua (o de una empresa que no
    la contrata) seguía viendo el botón **Agua**. Si la lectura falla, el respaldo sigue siendo el portal de Agua.
  - Con unidades en varios proyectos, cada portal muestra sólo las suyas: el de Condominios descarta las unidades con
    `servicio_condominios = false`, y el de Agua descarta unidades, contadores, proyectos y lecturas de los proyectos
    sin Agua (`proyectosSinServicio`).
  - **Asambleas** y **Transparencia** del portal dependen del **plan** de la empresa del condominio (no de los
    interruptores de módulo). El residente no tiene empresa, así que `my_feature_flags` le llega vacía: el portal
    pregunta `company_has_feature` por la empresa de cada condominio y, sin la función, la pestaña no aparece (antes
    salía siempre, con un «mejore su plan» que el residente no puede atender).
- Las secciones compartidas (Clientes, Unidades, Comunicación, Contabilidad, Empresa, panel del dueño) siguen mostrando
  todos los proyectos.

## Límites conocidos

- Es una decisión de **operación**, no una frontera de seguridad nueva: no se añadió RLS por módulo a las tablas de cada
  módulo. Los datos siguen protegidos por empresa, proyecto y permiso; quien llegue por enlace directo a una sección de
  Agua no verá ahí los proyectos sin Agua, pero la API no rechaza por módulo (salvo el enlace de Rentas).
- Las pestañas internas de Condominios y Energía que consultan por empresa no se filtran por este interruptor más allá
  del selector de proyecto.
- Si la plataforma apaga un módulo a la empresa, un proyecto puede quedar sin módulos activos hasta que se le encienda
  otro: la regla del «al menos uno» se comprueba al mover los interruptores del proyecto.

## Archivos

| Qué | Dónde |
|---|---|
| Migración | `supabase/migrations/20261127000000_modulos_por_proyecto.sql` |
| Suite SQL (Postgres real, 20 comprobaciones, 4 mutantes) | `supabase/tests/modulos_por_proyecto/` |
| Lógica pura | `src/lib/modulosProyecto.ts` |
| Menú y rutas | `src/hooks/useModulosPorProyecto.ts`, `src/App.tsx`, `src/components/app/routes.tsx` |
| Portal del residente | `src/lib/portalServicios.ts`, `src/lib/portalTabs.ts` (`TAB_FUNCION_PLAN`), `src/domain/auth/session.ts`, `src/components/portal/` |
| Pantalla | `src/components/empresa/EmpresaProyectosSection.tsx` |
| Recuperación | `scripts/reversion-modulos-por-proyecto.sql` |
| CI | paso «Módulos por proyecto» en `coverage.yml` |

## Pruebas

```bash
supabase/tests/modulos_por_proyecto/run.sh
npx vitest run src/lib/__tests__/modulosProyecto.test.ts src/hooks/__tests__/useModulosPorProyecto.test.ts src/components/empresa/__tests__/EmpresaProyectosSection.modulos.test.tsx src/__tests__/modulosPorProyectoMigracion.test.ts src/lib/__tests__/portalServicios.test.ts src/lib/__tests__/portalTabs.test.ts src/components/portal/__tests__/CondominiosClientPortal.modulos.test.tsx
```

## Despliegue

1. Aplicar la migración (`apply-migrations-prod.yml`, aprobación `production-db`). El front tolera publicarse antes: lee
   los interruptores en una consulta aparte y, si las columnas no existen, no ofrece «Módulos» y todo se comporta como
   hasta ahora.
2. Regenerar `database.types.ts` y la huella de producción como en cualquier migración.
