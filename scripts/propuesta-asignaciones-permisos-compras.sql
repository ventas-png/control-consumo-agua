-- ════════════════════════════════════════════════════════════════════════════
-- ██  REQUIERE CONFIRMACIÓN  ██  PROPUESTA DE ASIGNACIONES · NO SE HA EJECUTADO · NO SE EJECUTA SOLA
--
-- Qué es: la lista de concesiones que HABRÍA que decidir después de aplicar 20261027000900, que NO concede ninguna llave
-- nueva a nadie. Cada concesión está COMENTADA (las líneas SQL llevan el prefijo «--SQL »), de modo que ejecutar este archivo
-- completo NO cambia nada. Para activar UNA concesión, una persona con autoridad la confirma y quita el prefijo «--SQL »
-- SOLO de sus líneas (p. ej.:  sed -n '/^-- ▶ P-1.1/,/^-- ◀ P-1.1/p' propuesta_asignaciones.sql | sed 's/^--SQL //' | psql …).
--
-- QUÉ NO HACE ESTE ARCHIVO
--   · NO toca user_project_assignments: ninguna concesión amplía el acceso a empresas ni a proyectos. (Al final hay una
--     comprobación de solo lectura para verificarlo antes y después.)
--   · NO es una decisión de negocio: no fija quién debe tener qué, ni prohíbe que una misma persona tenga varias llaves. Separar los
--     permisos por acción NO equivale a exigir personas distintas en cada paso. Conceder las cinco llaves a quien hoy tenía
--     `approve` y `change_status` reproduce EXACTAMENTE lo que hacía hasta hoy; conceder menos es una decisión de separación de funciones.
--   · NO usa el rol «Finanzas / Contador» como vehículo por defecto: concederle una llave a un ROL se la da a TODA persona que lo
--     tenga hoy o mañana. Se propone, en cambio, el rol de «ajustes individuales» (roles.user_override_for), el mismo mecanismo
--     del panel de permisos de la pantalla («Ajustes finos»). RECOMENDADO: hacerlo desde ese panel (deja huella con el usuario
--     administrador que lo hace en permission_audit_log); por SQL, quien ejecuta no queda como actor (auth.uid() es nulo).
--
-- ANTES DE CONFIRMAR NADA
--   1. Correr matriz_antes_despues.sql (solo lectura) en la base de destino y revisar la columna «pierde».
--   2. Confirmar con la persona responsable del negocio, por escrito, cada línea que se active.
--   3. Probar primero en el sandbox; nunca directamente en producción sin la confirmación del punto 2.
--
-- HECHOS DE PRODUCCIÓN (consulta de solo lectura previa; verificar de nuevo con la matriz antes de decidir)
--   · Alexander Monterroso: operator; rol de empresa «Finanzas / Contador» (platform.contabilidad.{view,create,edit,delete,approve,
--     change_status} y condominios.tab.ordenes_compra.{create,edit,approve,change_status}); 6 proyectos asignados.
--       HOY puede las seis acciones. DESPUÉS conserva SOLO «aprobar orden de compra» (tiene la llave de la pestaña) y deja de poder
--       registrar recepciones, aprobar facturas, aprobar órdenes de pago, ejecutar y anular pagos hasta que se le concedan.
--   · Marco Santos Godoy: ADMIN con 3 proyectos asignados. Un administrador pasa TODA llave por su perfil: no pierde ni necesita
--     nada, y NO es exento de proyecto (solo actúa en esos 3, antes y después). Nada que conceder.
--   · No hay otros perfiles no administradores con esas llaves.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- P-1 · ALEXANDER MONTERROSO · cinco concesiones INDEPENDIENTES (elegir cuáles)
--   Cada bloque es completo y repetible (ON CONFLICT): crea el rol de ajustes individuales si no existe, se lo asigna sin vencimiento
--   y concede UNA llave. Antes de activar cualquiera, confirmar que la consulta del bloque «P-1.0» devuelve EXACTAMENTE UNA fila.
-- ════════════════════════════════════════════════════════════════════════════

-- ▶ P-1.0 · (solo lectura, NO comentada) identificar a la persona. Debe devolver 1 fila; si devuelve 0 o más de 1, NO continuar.
SELECT u.id, u.full_name, u.role, u.company_id, c.nombre AS empresa, u.activo,
       (SELECT count(*) FROM public.user_project_assignments upa WHERE upa.user_id = u.id) AS proyectos_asignados
  FROM public.app_users u LEFT JOIN public.companies c ON c.id = u.company_id
 WHERE u.full_name ILIKE '%Monterroso%';
-- ◀ P-1.0

-- ▶ P-1.1 · Registrar recepciones          (hoy: change_status + edit)  → platform.contabilidad.compras.recepcion_registrar
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users WHERE full_name ILIKE '%Monterroso%'              -- CONFIRMAR: 1 fila
--SQL ), r AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT company_id, 'Ajustes — ' || full_name, 'Ajustes finos asignados directamente al usuario', false, '#7E9389', id FROM u
--SQL   ON CONFLICT (user_override_for) WHERE user_override_for IS NOT NULL DO UPDATE SET updated_at = now()
--SQL   RETURNING id
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id) SELECT u.id, r.id FROM u, r
--SQL   ON CONFLICT (user_id, role_id) DO NOTHING
--SQL )
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, 'platform.contabilidad.compras.recepcion_registrar', 'allow' FROM r
--SQL ON CONFLICT (role_id, permission_key) DO UPDATE SET effect = 'allow';
--SQL -- Verificar y, SOLO si es lo esperado, confirmar la transacción:
--SQL -- COMMIT;   (o ROLLBACK;)
-- ◀ P-1.1

-- ▶ P-1.2 · Aprobar facturas de proveedor  (hoy: approve + edit)        → platform.contabilidad.compras.factura_aprobar
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users WHERE full_name ILIKE '%Monterroso%'              -- CONFIRMAR: 1 fila
--SQL ), r AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT company_id, 'Ajustes — ' || full_name, 'Ajustes finos asignados directamente al usuario', false, '#7E9389', id FROM u
--SQL   ON CONFLICT (user_override_for) WHERE user_override_for IS NOT NULL DO UPDATE SET updated_at = now()
--SQL   RETURNING id
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id) SELECT u.id, r.id FROM u, r
--SQL   ON CONFLICT (user_id, role_id) DO NOTHING
--SQL )
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, 'platform.contabilidad.compras.factura_aprobar', 'allow' FROM r
--SQL ON CONFLICT (role_id, permission_key) DO UPDATE SET effect = 'allow';
--SQL -- COMMIT;   (o ROLLBACK;)
-- ◀ P-1.2

-- ▶ P-1.3 · Aprobar órdenes de pago        (hoy: approve + edit)        → platform.contabilidad.compras.orden_pago_aprobar
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users WHERE full_name ILIKE '%Monterroso%'              -- CONFIRMAR: 1 fila
--SQL ), r AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT company_id, 'Ajustes — ' || full_name, 'Ajustes finos asignados directamente al usuario', false, '#7E9389', id FROM u
--SQL   ON CONFLICT (user_override_for) WHERE user_override_for IS NOT NULL DO UPDATE SET updated_at = now()
--SQL   RETURNING id
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id) SELECT u.id, r.id FROM u, r
--SQL   ON CONFLICT (user_id, role_id) DO NOTHING
--SQL )
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, 'platform.contabilidad.compras.orden_pago_aprobar', 'allow' FROM r
--SQL ON CONFLICT (role_id, permission_key) DO UPDATE SET effect = 'allow';
--SQL -- COMMIT;   (o ROLLBACK;)
-- ◀ P-1.3

-- ▶ P-1.4 · Ejecutar pagos                 (hoy: change_status + edit)  → platform.contabilidad.compras.pago_ejecutar
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users WHERE full_name ILIKE '%Monterroso%'              -- CONFIRMAR: 1 fila
--SQL ), r AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT company_id, 'Ajustes — ' || full_name, 'Ajustes finos asignados directamente al usuario', false, '#7E9389', id FROM u
--SQL   ON CONFLICT (user_override_for) WHERE user_override_for IS NOT NULL DO UPDATE SET updated_at = now()
--SQL   RETURNING id
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id) SELECT u.id, r.id FROM u, r
--SQL   ON CONFLICT (user_id, role_id) DO NOTHING
--SQL )
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, 'platform.contabilidad.compras.pago_ejecutar', 'allow' FROM r
--SQL ON CONFLICT (role_id, permission_key) DO UPDATE SET effect = 'allow';
--SQL -- COMMIT;   (o ROLLBACK;)
-- ◀ P-1.4

-- ▶ P-1.5 · Anular pagos                   (hoy: change_status + edit)  → platform.contabilidad.compras.pago_anular
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users WHERE full_name ILIKE '%Monterroso%'              -- CONFIRMAR: 1 fila
--SQL ), r AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT company_id, 'Ajustes — ' || full_name, 'Ajustes finos asignados directamente al usuario', false, '#7E9389', id FROM u
--SQL   ON CONFLICT (user_override_for) WHERE user_override_for IS NOT NULL DO UPDATE SET updated_at = now()
--SQL   RETURNING id
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id) SELECT u.id, r.id FROM u, r
--SQL   ON CONFLICT (user_id, role_id) DO NOTHING
--SQL )
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, 'platform.contabilidad.compras.pago_anular', 'allow' FROM r
--SQL ON CONFLICT (role_id, permission_key) DO UPDATE SET effect = 'allow';
--SQL -- COMMIT;   (o ROLLBACK;)
-- ◀ P-1.5


-- ════════════════════════════════════════════════════════════════════════════
-- P-2 · MARCO SANTOS GODOY · NADA QUE CONCEDER
--   Es administrador: user_has_permission() le da toda llave, antes y después. Su alcance de proyecto (3 asignados) NO cambia y la
--   pieza lo respeta: el administrador con asignaciones solo actúa en SUS proyectos. No se propone ninguna línea.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- P-3 · CUALQUIER OTRA PERSONA que la matriz marque con «pierde» (plantilla; rellenar con el nombre y las llaves CONFIRMADAS)
--   No se conoce ninguna más en producción. Si aparece, el bloque es el mismo de P-1.x con otro nombre y las llaves que correspondan
--   (cada llave nueva sustituye a la genérica que la persona usaba: ver la tabla del encabezado de matriz_antes_despues.sql).
-- ════════════════════════════════════════════════════════════════════════════

-- ▶ P-3 · <NOMBRE>  ← sustituir ambos <…>; las llaves a conceder se listan en el ARRAY (solo las confirmadas)
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users WHERE id = '<UUID_DE_LA_PERSONA>'                  -- CONFIRMAR: 1 fila
--SQL ), r AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT company_id, 'Ajustes — ' || full_name, 'Ajustes finos asignados directamente al usuario', false, '#7E9389', id FROM u
--SQL   ON CONFLICT (user_override_for) WHERE user_override_for IS NOT NULL DO UPDATE SET updated_at = now()
--SQL   RETURNING id
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id) SELECT u.id, r.id FROM u, r
--SQL   ON CONFLICT (user_id, role_id) DO NOTHING
--SQL )
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, k, 'allow' FROM r, unnest(ARRAY[
--SQL   'platform.contabilidad.compras.recepcion_registrar',
--SQL   'platform.contabilidad.compras.factura_aprobar',
--SQL   'platform.contabilidad.compras.orden_pago_aprobar',
--SQL   'platform.contabilidad.compras.pago_ejecutar',
--SQL   'platform.contabilidad.compras.pago_anular'
--SQL   -- y, solo si la persona usaba `approve` genérico para la orden de compra y NO tiene la llave de la pestaña:
--SQL   -- 'condominios.tab.ordenes_compra.approve'
--SQL ]) k
--SQL ON CONFLICT (role_id, permission_key) DO UPDATE SET effect = 'allow';
--SQL -- COMMIT;   (o ROLLBACK;)
-- ◀ P-3


-- ════════════════════════════════════════════════════════════════════════════
-- P-4 · ALTERNATIVA POR ROL (NO recomendada por defecto): conceder una llave a un ROL de empresa
--   Afecta a TODA persona que tenga ese rol, hoy o en el futuro (por ejemplo, a quien se asigne «Finanzas / Contador» mañana).
--   Solo si negocio decide que el rol entero debe incluir la acción. Sustituir <EMPRESA> y <LLAVE>.
-- ════════════════════════════════════════════════════════════════════════════
-- ▶ P-4 · rol «Finanzas / Contador» de <EMPRESA> ← <LLAVE>
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, '<LLAVE>', 'allow'
--SQL   FROM public.roles r
--SQL  WHERE r.name = 'Finanzas / Contador' AND r.is_system = false AND r.company_id = '<UUID_DE_LA_EMPRESA>'   -- CONFIRMAR: 1 fila
--SQL ON CONFLICT (role_id, permission_key) DO UPDATE SET effect = 'allow';
-- ◀ P-4


-- ════════════════════════════════════════════════════════════════════════════
-- V · VERIFICACIONES DE SOLO LECTURA (NO comentadas; pueden correrse antes y después de cualquier concesión)
-- ════════════════════════════════════════════════════════════════════════════

-- V-1 · Las asignaciones de proyecto NO deben cambiar con ninguna concesión: guardar esta salida antes y comparar después.
SELECT u.full_name, u.role, count(*) AS proyectos, string_agg(p.nombre, '; ' ORDER BY p.nombre) AS lista, md5(string_agg(p.id::text, ',' ORDER BY p.id)) AS huella
  FROM public.app_users u
  JOIN public.user_project_assignments upa ON upa.user_id = u.id
  JOIN public.projects p ON p.id = upa.project_id
 WHERE u.full_name ILIKE '%Monterroso%' OR u.full_name ILIKE '%Santos Godoy%'
 GROUP BY u.full_name, u.role
 ORDER BY u.full_name;

-- V-2 · Llaves nuevas efectivas por persona (solo roles vigentes) para las dos personas conocidas.
SELECT u.full_name, rp.permission_key, rp.effect, r.name AS rol, ur.expires_at
  FROM public.app_users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.role_permissions rp ON rp.role_id = r.id
 WHERE (u.full_name ILIKE '%Monterroso%' OR u.full_name ILIKE '%Santos Godoy%')
   AND (rp.permission_key LIKE 'platform.contabilidad.compras.%' OR rp.permission_key = 'condominios.tab.ordenes_compra.approve')
 ORDER BY u.full_name, rp.permission_key;
