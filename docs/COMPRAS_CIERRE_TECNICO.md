# Compras: cierre técnico — PR #922

## Alcance

Esta serie cierra la lectura financiera por permiso, empresa y proyecto; crea órdenes mediante `compras_orden_crear` en una transacción idempotente; y hace que los errores reales de acumulación de facturas aborten la operación completa.

Migraciones incrementales: `20261026000000` a `20261026000400`. No se modifica el historial antiguo ni se reparan datos automáticamente.

## Evidencia del sandbox existente

Validación realizada el 2026-10-05, sobre el código `0af6278b974ad1d1cfa3adfbb1493b9bf2efd456`, en `control-agua-rls-sandbox` (`jwpmivhvlstslncrtokb`). No se consultó ni modificó producción en esta validación.

- El historial del sandbox ya contenía las cinco migraciones; no se reaplicaron.
- `scripts/diagnostico-acumulacion-facturas.sql`: cero filas, sin descuadres detectados.
- `scripts/diagnostico-lectura-financiera.sql`: dos perfiles del padrón de pruebas, ZZ Admin y ZZ Contador, tienen acceso a uno de los dos proyectos de su empresa. No se modificaron sus asignaciones. Este resultado no sustituye el diagnóstico previo en producción.
- `supabase/tests/compras_cierre_tecnico/sandbox_cierre_tecnico.sql`: **52 comprobaciones coinciden con lo esperado**. Resultado final: `GUION_OK_REVERTIDO`.
- Se verificaron permisos de perfiles no superadministradores, aislamiento de empresa y proyecto, privilegios de 17 tablas, reportes y RPC, creación desde Operaciones y Contabilidad, reintentos sin duplicados, rollback ante un renglón inválido, aprobación, anulación, cierre/reapertura y propagación de errores reales.
- La excepción final es deliberada: revierte toda la prueba. Verificación posterior a las 16:11:52 UTC (10:11:52 Guatemala): cero empresas y cero usuarios temporales con el prefijo reservado `5c0c0000`.

Este guion comprueba SQL del servidor con roles autenticados; **no es una prueba de pantalla ni de sesiones de navegador**. La concurrencia de sesiones reales está en `run.sh`, no en este guion. Los checks del SHA citado estaban verdes, incluido el arnés de CI en PostgreSQL desechable; no se ejecutó localmente ese arnés porque falta `initdb`.

## Seguridad: observaciones adicionales

Se consultaron los asesores del sandbox. Hay advertencias de `search_path` mutable en seis funciones, una función SECURITY DEFINER ejecutable por anon (`sso_lookup_domain`), múltiples funciones DEFINER ejecutables por authenticated y protección de contraseñas filtradas desactivada. Son avisos que requieren revisión contextual; no equivalen por sí solos a vulnerabilidades confirmadas ni se atribuyen automáticamente a este PR. No se cambiaron permisos ni configuración global para silenciarlos.

Referencias: [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [DEFINER para anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [DEFINER autenticado](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Límites y pendientes

1. **Pantalla contra el sandbox pendiente**: usar el código de este PR con `VITE_SUPABASE_URL` apuntando a `jwpmivhvlstslncrtokb`; confirmar que ninguna petición llega a producción. Probar con Operaciones y Contabilidad no superadministradores: crear orden, reintentar sin duplicar, corregir error, cambiar proyecto y comprobar accesos. Conservar evidencia sin tokens ni contraseñas. No usar una preview sin verificar su backend.
2. **Órdenes/recepciones**: su SELECT exige empresa y proyecto, pero no un permiso específico de lectura de compras. Hay consumidores legítimos en contratos y evaluación de proveedores. Mapear todos los consumidores y permisos antes de endurecerlo en otra serie; no imponer solo el permiso de la pestaña de órdenes.
3. Los manejadores de avisos de presupuesto y contabilización con cola visible/reintentable no se cambian aquí. Este PR endurece únicamente la acumulación de facturas; no promete eliminar todo manejador de excepciones del circuito.
4. Diagnósticos previos de producción, autorización de despliegue y verificación posfusión siguen pendientes. El sandbox no acredita que las asignaciones ni acumulados de producción sean correctos.

## Despliegue y recuperación

Mantener el PR en borrador hasta completar las verificaciones pendientes. Fusionar dispara el workflow de migraciones de producción: no es una acción exclusivamente documental.

Antes de autorizarlo, ejecutar los dos diagnósticos de solo lectura en producción, revisar usuarios afectados con el responsable y resolver cualquier inconsistencia mediante un plan específico. Confirmar las cinco migraciones exactas pendientes y el orden de aplicación; no aumentar topes ni ejecutar reparación masiva del historial para eludir guardas.

Después del despliegue autorizado: confirmar el workflow de aplicación, funciones/políticas instaladas, pruebas con roles normales y diagnóstico de acumulación sin hallazgos. Refrescar la huella de producción desde su catálogo real si el auditor lo requiere; no fabricar hashes desde el replay local.

Un `git revert` no deshace DDL ya aplicado. La recuperación de base exige una migración compensatoria revisada: las cabeceras de cada migración describen las definiciones/políticas anteriores. No reintroducir silenciamiento de errores, permisos amplios ni operaciones no atómicas sin evaluar el riesgo. Conservar los datos e identificadores de idempotencia; no borrar órdenes ni resetear la base como rollback.
