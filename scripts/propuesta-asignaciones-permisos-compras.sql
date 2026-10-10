-- ════════════════════════════════════════════════════════════════════════════
-- ██  REQUIERE CONFIRMACIÓN  ██  PROPUESTA DE ASIGNACIONES · NO SE HA EJECUTADO · NO SE EJECUTA SOLA
-- Puesta al día: 2026-10-10 (lecturas de producción, SOLO LECTURA). Documento que la acompaña, con la matriz, la recomendación y
-- las consultas que producen cada cifra: docs/COMPRAS_PROPUESTA_ASIGNACION_PERMISOS.md
--
-- Qué es: la lista de concesiones que HABRÍA que decidir después de aplicar 20261027000900, que NO concede ninguna llave nueva a
-- nadie. Cada concesión está COMENTADA (las líneas SQL llevan el prefijo «--SQL »), de modo que ejecutar este archivo completo NO
-- cambia nada: lo único sin comentar son SELECT de solo lectura (P-0.x y V-x). Para activar UNA concesión, una persona con
-- autoridad la confirma por escrito y extrae SOLO su bloque quitando el prefijo, p. ej.:
--     sed -n '/^-- ▶ P-1.2/,/^-- ◀ P-1.2/p' scripts/propuesta-asignaciones-permisos-compras.sql | sed 's/^--SQL //' | psql …
-- Doble seguro: cada bloque activado abre una transacción y TERMINA EN «ROLLBACK;». Para confirmarla hay que editar a mano esa
-- línea y ponerla en «COMMIT;» después de revisar el SELECT de verificación del propio bloque. Si se ejecuta sin editar, no queda nada.
--
-- QUÉ NO HACE ESTE ARCHIVO
--   · NO toca user_project_assignments: ninguna concesión amplía el acceso a empresas ni a proyectos (V-1 y V-4 lo comprueban antes
--     y después).
--   · NO es una decisión de negocio: no fija quién debe tener qué, ni prohíbe que una misma persona tenga varias llaves. Separar los
--     permisos por acción NO equivale a exigir personas distintas en cada paso. No se inventó ningún umbral ni prohibición.
--   · NO concede nada a las plantillas de sistema ni al rol de empresa «Finanzas / Contador» por defecto: concederle una llave a un
--     ROL se la da a TODA persona que lo tenga hoy o mañana (y una plantilla solo llega a las copias que se creen DESPUÉS, o a
--     quien la tenga asignada directamente: hoy nadie). Lo
--     propuesto es el rol de «ajustes individuales» (roles.user_override_for), el mismo mecanismo del panel «Ajustes finos» de la
--     pantalla. RECOMENDADO: hacerlo desde ese panel (Empresa › Usuarios › botón Roles y permisos): deja a la persona administradora
--     como actor en permission_audit_log; por SQL, quien ejecuta no queda como actor (auth.uid() es nulo).
--   · NO se puede ejecutar ANTES del despliegue de la 0900: las cinco llaves no existen en el catálogo (permissions) hasta entonces y
--     role_permissions.permission_key es llave foránea de permissions(key) (P-0.3 lo comprueba).
--
-- HECHOS DE PRODUCCIÓN (lectura del 2026-10-10; volver a correr P-0.x y V-3 inmediatamente antes de decidir)
--   · Alexander Monterroso: id 327ffeda-85e8-4ea4-9423-af9b206ee886 · perfil `operator` · empresa «Prestadora de Servicios S.A.»
--     (24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31) · activo · 6 proyectos asignados (21B+, Cascadas de Vista Hermosa, Edificio SQ,
--     La Arboleda CVH, Parajes Vermont, Viñas del Sur Condominio 3). Un solo rol, sin vencimiento y sin `deny`: la copia de empresa
--     «Finanzas / Contador» (d915897c-b350-431a-8447-b37c61f97e8a), con 1 193 de las 1 201 llaves del catálogo en `allow` (la
--     plantilla de sistema tiene 63). Incluye platform.contabilidad.{view,create,edit,delete,approve,change_status} y
--     condominios.tab.ordenes_compra{,.create,.edit,.approve,.change_status,.delete}. No tiene rol de ajustes individuales.
--       HOY puede las seis acciones. DESPUÉS de la 0900 conserva SOLO «aprobar orden de compra» (tiene la llave de la pestaña) y deja
--       de poder registrar recepciones, aprobar facturas, aprobar órdenes de pago, ejecutar y anular pagos hasta que se le concedan.
--   · Marco Santos Godoy: id 86440f9d-e34b-49ba-91c7-3531ed365460 · ADMIN con 3 proyectos asignados (21B+, Edificio SQ, Parajes
--     Vermont). Un administrador pasa TODA llave por su perfil: no pierde ni necesita nada, y NO es exento de proyecto (solo actúa en
--     esos 3, antes y después). Nada que conceder.
--   · Nadie más tiene llaves de Contabilidad ni de la pestaña de órdenes entre las personas no exentas (30 activas). Pasan toda
--     llave por perfil, además de Marco, la cuenta propietaria (`company_owner`) y el superadministrador, ambos sin límite de proyecto.
--   · OJO con el nombre: «Monterroso» coincide con TRES cuentas (Alexander Monterroso `operator`; Alex Monterroso e Isabel Monterroso,
--     `cliente`, sin empresa). La versión anterior de este archivo identificaba a la persona con ILIKE '%Monterroso%' también DENTRO
--     de los bloques de concesión; esta versión usa el id y exige perfil, empresa y estado (P-0.1, P-0.2).
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- P-0 · COMPROBACIONES PREVIAS (solo lectura, NO comentadas)
-- ════════════════════════════════════════════════════════════════════════════

-- ▶ P-0.1 · identificar a la persona POR ID. Debe devolver EXACTAMENTE 1 fila: operator, «Prestadora de Servicios S.A.»,
--   activo = true, 6 proyectos. Si no, NO continuar.
SELECT u.id, u.full_name, u.role, u.company_id, c.nombre AS empresa, u.activo,
       (SELECT count(*) FROM public.user_project_assignments upa WHERE upa.user_id = u.id) AS proyectos_asignados
  FROM public.app_users u LEFT JOIN public.companies c ON c.id = u.company_id
 WHERE u.id = '327ffeda-85e8-4ea4-9423-af9b206ee886';
-- ◀ P-0.1

-- ▶ P-0.2 · (informativo) por qué NO se filtra por nombre: hoy devuelve 3 filas (una `operator` y dos `cliente` sin empresa).
SELECT id, full_name, role, company_id, activo FROM public.app_users WHERE full_name ILIKE '%Monterroso%' ORDER BY full_name;
-- ◀ P-0.2

-- ▶ P-0.3 · las cinco llaves nuevas deben existir en el catálogo: 5 filas DESPUÉS de la 0900 (hoy: 0 filas, la 0900 no está aplicada).
SELECT key, category, label FROM public.permissions WHERE key LIKE 'platform.contabilidad.compras.%' ORDER BY key;
-- ◀ P-0.3

-- ▶ P-0.4 · ninguna de las seis llaves de las acciones (ni `edit`) debe estar DENEGADA en un rol vigente de la persona: 0 filas.
--   Un `deny` gana a cualquier `allow` (user_has_permission), así que una concesión sobre un `deny` no tendría efecto. Hoy: 0 filas
--   (y 0 filas `deny` en toda la base).
SELECT r.name AS rol, rp.permission_key, rp.effect, ur.expires_at
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.role_permissions rp ON rp.role_id = r.id
 WHERE ur.user_id = '327ffeda-85e8-4ea4-9423-af9b206ee886'
   AND rp.effect = 'deny'
   AND rp.permission_key IN ('platform.contabilidad.edit',
                             'condominios.tab.ordenes_compra.approve',
                             'platform.contabilidad.compras.recepcion_registrar',
                             'platform.contabilidad.compras.factura_aprobar',
                             'platform.contabilidad.compras.orden_pago_aprobar',
                             'platform.contabilidad.compras.pago_ejecutar',
                             'platform.contabilidad.compras.pago_anular');
-- ◀ P-0.4


-- ════════════════════════════════════════════════════════════════════════════
-- P-1 · ALEXANDER MONTERROSO · cinco concesiones INDEPENDIENTES (se elige cuáles; una por una y por escrito)
--   Cada bloque es completo y repetible: busca su rol de ajustes individuales (o lo crea con el MISMO nombre y los mismos campos que
--   la pantalla: «Ajustes individuales — <nombre> (<8 primeros caracteres del id>)»), se lo asigna sin vencimiento y concede UNA llave
--   con ON CONFLICT DO NOTHING (no pisa un `deny` ajeno: P-0.4 lo descarta antes). La condición del filtro (perfil, empresa, activo)
--   hace que, si la persona no es la esperada, el bloque no escriba nada.
--
--   RECOMENDADAS (propuesta «mínimo privilegio con continuidad»): P-1.1, P-1.2 y P-1.3.
--   SOLO SI SE ELIGE LA ALTERNATIVA «continuidad total» (= lo que Alexander puede hoy): además P-1.4 y P-1.5.
-- ════════════════════════════════════════════════════════════════════════════

-- ▶ P-1.1 · Registrar recepciones          (hoy: change_status + edit)  → platform.contabilidad.compras.recepcion_registrar   [RECOMENDADA]
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users
--SQL    WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND role = 'operator' AND activo
--SQL      AND company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR con P-0.1: 1 fila
--SQL ), r0 AS (
--SQL   SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL ), r1 AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL          'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL     FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL   RETURNING id
--SQL ), r AS (
--SQL   SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL   SELECT u.id, r.id, NULL FROM u, r
--SQL   ON CONFLICT (user_id, role_id) DO NOTHING
--SQL )
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, 'platform.contabilidad.compras.recepcion_registrar', 'allow' FROM r
--SQL ON CONFLICT (role_id, permission_key) DO NOTHING;
--SQL -- Verificar: 1 fila con effect = allow y expires_at vacío (si sale vacío, el filtro no coincidió y NO se escribió nada):
--SQL SELECT r.name, rp.permission_key, rp.effect, ur.expires_at
--SQL   FROM public.roles r
--SQL   JOIN public.role_permissions rp ON rp.role_id = r.id
--SQL   JOIN public.user_roles ur ON ur.role_id = r.id AND ur.user_id = r.user_override_for
--SQL  WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886';
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT; solo con la confirmación escrita y el SELECT revisado
-- ◀ P-1.1

-- ▶ P-1.2 · Aprobar facturas de proveedor  (hoy: approve + edit)        → platform.contabilidad.compras.factura_aprobar        [RECOMENDADA]
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users
--SQL    WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND role = 'operator' AND activo
--SQL      AND company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR con P-0.1: 1 fila
--SQL ), r0 AS (
--SQL   SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL ), r1 AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL          'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL     FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL   RETURNING id
--SQL ), r AS (
--SQL   SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL   SELECT u.id, r.id, NULL FROM u, r
--SQL   ON CONFLICT (user_id, role_id) DO NOTHING
--SQL )
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, 'platform.contabilidad.compras.factura_aprobar', 'allow' FROM r
--SQL ON CONFLICT (role_id, permission_key) DO NOTHING;
--SQL SELECT r.name, rp.permission_key, rp.effect, ur.expires_at
--SQL   FROM public.roles r
--SQL   JOIN public.role_permissions rp ON rp.role_id = r.id
--SQL   JOIN public.user_roles ur ON ur.role_id = r.id AND ur.user_id = r.user_override_for
--SQL  WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886';
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT;
-- ◀ P-1.2

-- ▶ P-1.3 · Aprobar órdenes de pago        (hoy: approve + edit)        → platform.contabilidad.compras.orden_pago_aprobar     [RECOMENDADA]
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users
--SQL    WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND role = 'operator' AND activo
--SQL      AND company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR con P-0.1: 1 fila
--SQL ), r0 AS (
--SQL   SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL ), r1 AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL          'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL     FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL   RETURNING id
--SQL ), r AS (
--SQL   SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL   SELECT u.id, r.id, NULL FROM u, r
--SQL   ON CONFLICT (user_id, role_id) DO NOTHING
--SQL )
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, 'platform.contabilidad.compras.orden_pago_aprobar', 'allow' FROM r
--SQL ON CONFLICT (role_id, permission_key) DO NOTHING;
--SQL SELECT r.name, rp.permission_key, rp.effect, ur.expires_at
--SQL   FROM public.roles r
--SQL   JOIN public.role_permissions rp ON rp.role_id = r.id
--SQL   JOIN public.user_roles ur ON ur.role_id = r.id AND ur.user_id = r.user_override_for
--SQL  WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886';
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT;
-- ◀ P-1.3

-- ▶ P-1.4 · Ejecutar pagos                 (hoy: change_status + edit)  → platform.contabilidad.compras.pago_ejecutar         [SOLO alternativa «continuidad total»]
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users
--SQL    WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND role = 'operator' AND activo
--SQL      AND company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR con P-0.1: 1 fila
--SQL ), r0 AS (
--SQL   SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL ), r1 AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL          'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL     FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL   RETURNING id
--SQL ), r AS (
--SQL   SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL   SELECT u.id, r.id, NULL FROM u, r
--SQL   ON CONFLICT (user_id, role_id) DO NOTHING
--SQL )
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, 'platform.contabilidad.compras.pago_ejecutar', 'allow' FROM r
--SQL ON CONFLICT (role_id, permission_key) DO NOTHING;
--SQL SELECT r.name, rp.permission_key, rp.effect, ur.expires_at
--SQL   FROM public.roles r
--SQL   JOIN public.role_permissions rp ON rp.role_id = r.id
--SQL   JOIN public.user_roles ur ON ur.role_id = r.id AND ur.user_id = r.user_override_for
--SQL  WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886';
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT;
-- ◀ P-1.4

-- ▶ P-1.5 · Anular pagos                   (hoy: change_status + edit)  → platform.contabilidad.compras.pago_anular           [SOLO alternativa «continuidad total»]
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users
--SQL    WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND role = 'operator' AND activo
--SQL      AND company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR con P-0.1: 1 fila
--SQL ), r0 AS (
--SQL   SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL ), r1 AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL          'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL     FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL   RETURNING id
--SQL ), r AS (
--SQL   SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL   SELECT u.id, r.id, NULL FROM u, r
--SQL   ON CONFLICT (user_id, role_id) DO NOTHING
--SQL )
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, 'platform.contabilidad.compras.pago_anular', 'allow' FROM r
--SQL ON CONFLICT (role_id, permission_key) DO NOTHING;
--SQL SELECT r.name, rp.permission_key, rp.effect, ur.expires_at
--SQL   FROM public.roles r
--SQL   JOIN public.role_permissions rp ON rp.role_id = r.id
--SQL   JOIN public.user_roles ur ON ur.role_id = r.id AND ur.user_id = r.user_override_for
--SQL  WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886';
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT;
-- ◀ P-1.5


-- ════════════════════════════════════════════════════════════════════════════
-- P-2 · MARCO SANTOS GODOY · NADA QUE CONCEDER
--   Es administrador: user_has_permission() le da toda llave, antes y después. Su alcance de proyecto (3 asignados) NO cambia y la
--   pieza lo respeta: el administrador con asignaciones solo actúa en SUS proyectos. No se propone ninguna línea. Lo mismo vale para
--   la cuenta propietaria (company_owner) y el superadministrador: pasan toda llave por su perfil y no hay llave que se la quite.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- P-3 · CUALQUIER OTRA PERSONA que la matriz (scripts/diagnostico-permisos-compras.sql) marque con «pierde» (plantilla)
--   No se conoce ninguna más en producción (30 personas activas no exentas; solo Alexander y Marco aparecen). Si aparece, el bloque es
--   el de P-1.x con otro id y las llaves que correspondan (cada llave nueva sustituye a la genérica que la persona usaba: ver la
--   tabla del encabezado del diagnóstico). Rellenar el id y el ARRAY con SOLO las llaves confirmadas.
-- ════════════════════════════════════════════════════════════════════════════

-- ▶ P-3 · <NOMBRE>  ← sustituir <UUID_DE_LA_PERSONA> y <UUID_DE_LA_EMPRESA>; las llaves a conceder van en el ARRAY (solo las confirmadas)
--SQL BEGIN;
--SQL WITH u AS (
--SQL   SELECT id, company_id, full_name FROM public.app_users
--SQL    WHERE id = '<UUID_DE_LA_PERSONA>' AND activo AND company_id = '<UUID_DE_LA_EMPRESA>'      -- CONFIRMAR: 1 fila
--SQL ), r0 AS (
--SQL   SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL ), r1 AS (
--SQL   INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL   SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL          'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL     FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL   RETURNING id
--SQL ), r AS (
--SQL   SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL ), a AS (
--SQL   INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL   SELECT u.id, r.id, NULL FROM u, r
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
--SQL ON CONFLICT (role_id, permission_key) DO NOTHING;
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT; tras verificar con V-3 (cambiando el id)
-- ◀ P-3


-- ════════════════════════════════════════════════════════════════════════════
-- P-4 · ALTERNATIVA POR ROL DE EMPRESA (NO recomendada): conceder una llave al rol «Finanzas / Contador» de la empresa
--   Afecta a TODA persona que tenga ese rol, hoy (solo Alexander) o en el futuro. Es un rol de 1 193 llaves: desde la pantalla se
--   editaría con set_role_permissions(), que DEJA EL ROL EXACTAMENTE con la lista que se le pasa (borra lo que no esté en ella): un
--   guardado incompleto lo vaciaría. Por SQL, el bloque de abajo solo AÑADE una fila. Sustituir <LLAVE>.
-- ════════════════════════════════════════════════════════════════════════════
-- ▶ P-4 · rol «Finanzas / Contador» de «Prestadora de Servicios S.A.» ← <LLAVE>
--SQL BEGIN;
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, '<LLAVE>', 'allow'
--SQL   FROM public.roles r
--SQL  WHERE r.id = 'd915897c-b350-431a-8447-b37c61f97e8a' AND r.name = 'Finanzas / Contador' AND r.is_system = false
--SQL    AND r.company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR: 1 fila
--SQL ON CONFLICT (role_id, permission_key) DO NOTHING;
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT;
-- ◀ P-4


-- ════════════════════════════════════════════════════════════════════════════
-- P-5 · ALTERNATIVA POR PLANTILLA DE SISTEMA (NO recomendada ahora; decisión A-2): conceder una llave a la plantilla
--   Las plantillas (roles.is_system) NO se editan desde la pantalla: "Usar plantilla" y "Personalizar" CLONAN. Su role_permissions
--   solo lo escribe el superadministrador (la política de INSERT exige is_super_admin() para un rol de sistema) o una migración.
--   Y una plantilla NO se propaga: la copia de empresa es una fotografía de las llaves de la plantilla en el momento de crearla
--   (ensureCompanyRoleFromTemplate; una copia fiel ya existente se reutiliza, nunca se refresca) y NO se copia sola al crear una
--   empresa nueva (ni las migraciones ni las funciones de borde siembran roles de empresa: la copia nace en la pantalla, al usar la
--   plantilla o al crear un usuario con ese rol). Excepción: create-user y accept-invitation asignan DIRECTAMENTE la plantilla de
--   plataforma del perfil (admin → «Admin Plataforma», operator → «Operador Plataforma»…), un vínculo vivo; hoy hay 0 así.
--   Efecto, entonces: solo las copias que se creen DESPUÉS (y quien tuviera la plantilla asignada directamente: nadie hoy).
--   Ninguna persona ni copia actual cambia. Tres plantillas relevantes:
--     «Finanzas / Contador» 00000000-0000-0000-0000-000000000003 · «Admin Plataforma» …0201 · «Administrador General» …0001.
-- ════════════════════════════════════════════════════════════════════════════
-- ▶ P-5 · plantilla «Finanzas / Contador» ← llaves confirmadas (editar el ARRAY)
--SQL BEGIN;
--SQL INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL SELECT r.id, k, 'allow'
--SQL   FROM public.roles r, unnest(ARRAY[
--SQL     'platform.contabilidad.compras.recepcion_registrar',
--SQL     'platform.contabilidad.compras.factura_aprobar',
--SQL     'platform.contabilidad.compras.orden_pago_aprobar'
--SQL   ]) k
--SQL  WHERE r.id = '00000000-0000-0000-0000-000000000003' AND r.is_system AND r.name = 'Finanzas / Contador'   -- CONFIRMAR: 1 fila
--SQL ON CONFLICT (role_id, permission_key) DO NOTHING;
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT; solo con A-2 respondida por escrito
-- ◀ P-5


-- ════════════════════════════════════════════════════════════════════════════
-- V · VERIFICACIONES DE SOLO LECTURA (NO comentadas; pueden correrse antes y después de cualquier concesión)
-- ════════════════════════════════════════════════════════════════════════════

-- V-1 · Las asignaciones de proyecto de las dos personas NO deben cambiar con ninguna concesión: guardar esta salida antes y comparar
--   después. Lectura del 2026-10-10: Alexander 6 proyectos, huella 89b81779cee9b2b1b7aeaf4ad42362fb; Marco 3 proyectos, huella
--   1d3dc6bd1682b02e445d9cbe567fcc38.
SELECT u.full_name, u.role, count(*) AS proyectos, string_agg(p.nombre, '; ' ORDER BY p.nombre) AS lista, md5(string_agg(p.id::text, ',' ORDER BY p.id)) AS huella
  FROM public.app_users u
  JOIN public.user_project_assignments upa ON upa.user_id = u.id
  JOIN public.projects p ON p.id = upa.project_id
 WHERE u.id IN ('327ffeda-85e8-4ea4-9423-af9b206ee886', '86440f9d-e34b-49ba-91c7-3531ed365460')
 GROUP BY u.full_name, u.role
 ORDER BY u.full_name;

-- V-2 · Llaves de las acciones que cada una de las dos personas tiene por sus roles vigentes (con su efecto y vencimiento).
--   Antes de conceder: Alexander muestra las genéricas y las de la pestaña de órdenes; Marco, solo la visibilidad de la pestaña
--   (su permiso viene del perfil `admin`, no de llaves).
SELECT u.full_name, rp.permission_key, rp.effect, r.name AS rol, ur.expires_at
  FROM public.app_users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.role_permissions rp ON rp.role_id = r.id
 WHERE u.id IN ('327ffeda-85e8-4ea4-9423-af9b206ee886', '86440f9d-e34b-49ba-91c7-3531ed365460')
   AND (rp.permission_key LIKE 'platform.contabilidad.%' OR rp.permission_key LIKE 'condominios.tab.ordenes_compra%')
 ORDER BY u.full_name, rp.permission_key;

-- V-3 · LA COMPROBACIÓN: las seis acciones de las dos personas, antes (llaves genéricas) y después (llave de la acción), con `edit`
--   y las mismas reglas que user_has_permission() (perfil que pasa toda llave; un `deny` vigente gana; un rol vencido no cuenta).
--   Lectura del 2026-10-10 (antes de la 0900 y de cualquier concesión):
--     Alexander: hoy sí en las 6; después: 1 sí; 2, 3, 4, 5 y 6 no.     Marco: sí → sí en las 6.
--   Resultado esperado TRAS conceder la propuesta RECOMENDADA (P-1.1 a P-1.3): Alexander 1, 2, 3 y 4 «sí»; 5 y 6 «no».
--   Resultado esperado TRAS la alternativa «continuidad total» (P-1.1 a P-1.5): Alexander «sí» en las 6.
WITH acciones (n, accion, generica, nueva) AS (
  VALUES
    (1, 'Aprobar orden de compra',      'platform.contabilidad.approve',       'condominios.tab.ordenes_compra.approve'),
    (2, 'Registrar recepción',          'platform.contabilidad.change_status', 'platform.contabilidad.compras.recepcion_registrar'),
    (3, 'Aprobar factura de proveedor', 'platform.contabilidad.approve',       'platform.contabilidad.compras.factura_aprobar'),
    (4, 'Aprobar orden de pago',        'platform.contabilidad.approve',       'platform.contabilidad.compras.orden_pago_aprobar'),
    (5, 'Ejecutar pago',                'platform.contabilidad.change_status', 'platform.contabilidad.compras.pago_ejecutar'),
    (6, 'Anular pago',                  'platform.contabilidad.change_status', 'platform.contabilidad.compras.pago_anular')
), personas AS (
  SELECT id, full_name, role, (role IN ('super_admin', 'superadmin', 'company_owner', 'admin')) AS pasa_todo
    FROM public.app_users
   WHERE id IN ('327ffeda-85e8-4ea4-9423-af9b206ee886', '86440f9d-e34b-49ba-91c7-3531ed365460')
), llaves AS (
  SELECT p.id AS user_id,
         COALESCE(array_agg(DISTINCT rp.permission_key) FILTER (WHERE rp.effect = 'allow'), ARRAY[]::text[]) AS permite,
         COALESCE(array_agg(DISTINCT rp.permission_key) FILTER (WHERE rp.effect = 'deny'),  ARRAY[]::text[]) AS niega
    FROM personas p
    LEFT JOIN public.user_roles ur ON ur.user_id = p.id AND (ur.expires_at IS NULL OR ur.expires_at > now())
    LEFT JOIN public.role_permissions rp ON rp.role_id = ur.role_id
   GROUP BY p.id
)
SELECT p.full_name, a.n, a.accion,
       CASE WHEN p.pasa_todo OR (NOT ('platform.contabilidad.edit' = ANY (l.niega)) AND 'platform.contabilidad.edit' = ANY (l.permite)) THEN 'sí' ELSE 'no' END AS edit,
       CASE WHEN (p.pasa_todo OR (NOT ('platform.contabilidad.edit' = ANY (l.niega)) AND 'platform.contabilidad.edit' = ANY (l.permite)))
                 AND (p.pasa_todo OR (NOT (a.generica = ANY (l.niega)) AND a.generica = ANY (l.permite))) THEN 'sí' ELSE 'no' END AS hoy_antes_0900,
       CASE WHEN (p.pasa_todo OR (NOT ('platform.contabilidad.edit' = ANY (l.niega)) AND 'platform.contabilidad.edit' = ANY (l.permite)))
                 AND (p.pasa_todo OR (NOT (a.nueva = ANY (l.niega)) AND a.nueva = ANY (l.permite))) THEN 'sí' ELSE 'no' END AS despues_0900
  FROM personas p JOIN llaves l ON l.user_id = p.id CROSS JOIN acciones a
 ORDER BY p.full_name, a.n;

-- V-4 · Las asignaciones de proyecto de TODA la base no deben cambiar. Lectura del 2026-10-10: 43 filas, huella
--   d32daf1d38d862b1cdd938a59ad2ff5f. (Contadores de la propuesta: 3 661 filas en role_permissions, 26 en user_roles y 34 roles; tras
--   la propuesta RECOMENDADA deben subir +3, +1 y +1 —el rol de ajustes individuales—; con la alternativa, +5, +1 y +1; si en
--   el intervalo otra persona cambió roles, comparar contra una lectura hecha justo antes.)
SELECT (SELECT count(*) FROM public.user_project_assignments) AS asignaciones_total,
       (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM public.user_project_assignments) AS huella_asignaciones,
       (SELECT count(*) FROM public.role_permissions) AS role_permissions_total,
       (SELECT count(*) FROM public.user_roles) AS user_roles_total,
       (SELECT count(*) FROM public.roles) AS roles_total,
       (SELECT count(*) FROM public.role_permissions WHERE permission_key LIKE 'platform.contabilidad.compras.%') AS concesiones_de_las_cinco_llaves;

-- V-5 · Quién concedió qué (hacerlo desde la pantalla deja a la persona administradora como actor; por SQL, actor vacío).
--   Tras una concesión: 1 create_role (si el rol de ajustes no existía), 1 assign_role y 1 grant_permission por llave.
SELECT a.occurred_at, a.action, a.actor_id, a.target_user_id, a.target_role_id, a.details
  FROM public.permission_audit_log a
 WHERE a.occurred_at > now() - interval '7 days'
   AND (a.target_user_id = '327ffeda-85e8-4ea4-9423-af9b206ee886'
        OR a.target_role_id IN (SELECT r.id FROM public.roles r WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886'))
 ORDER BY a.occurred_at;
