-- ════════════════════════════════════════════════════════════════════════════
-- ██  REQUIERE CONFIRMACIÓN  ██  PROPUESTA DE ASIGNACIONES · NO SE HA EJECUTADO · NO SE EJECUTA SOLA
-- Puesta al día: 2026-10-10, cifras re-verificadas el 2026-10-11 (lecturas de producción, SOLO LECTURA). Documento que la acompaña, con
-- la matriz, los tres paquetes y las consultas que producen cada cifra: docs/COMPRAS_PROPUESTA_ASIGNACION_PERMISOS.md
--
-- Qué es: la lista de concesiones que HABRÍA que decidir después de aplicar 20261027000900, que NO concede ninguna llave nueva a
-- nadie. Cada concesión está COMENTADA (las líneas SQL llevan el prefijo «--SQL »), de modo que ejecutar este archivo completo NO
-- cambia nada: lo único sin comentar son SELECT de solo lectura (P-0.x y V-x). Para activar UNA concesión, una persona con
-- autoridad la confirma por escrito y extrae SOLO su bloque a un archivo, quitando el prefijo, p. ej.:
--     sed -n '/^-- ▶ P-1.2/,/^-- ◀ P-1.2/p' scripts/propuesta-asignaciones-permisos-compras.sql | sed 's/^--SQL //' > bloque.sql
--     (editar bloque.sql como dice abajo)   y   psql … -f bloque.sql      ← el archivo ENTERO, en UNA sola conexión
-- TRES seguros, en este orden (el 2.º y el 3.º son distintos a propósito):
--   1. Todo viene comentado («--SQL »): ejecutar este archivo completo no cambia nada.
--   2. Cada bloque tiene la escritura dentro de un DO que LEVANTA EXCEPCIÓN salvo que la sesión tenga
--      current_setting('prop.confirmar', true) = 'si'. La línea que lo fija viene COMENTADA dentro del bloque
--      («-- SET LOCAL prop.confirmar = 'si';»): quien confirma por escrito le quita el «-- ». Es SET LOCAL: vale solo dentro de la
--      transacción del bloque. Por eso NO escribe nada aunque el cliente parta el bloque en sentencias sueltas, use una conexión por
--      sentencia, pegue solo el INSERT o corte en cada «;» (el texto del INSERT va dentro de una cadena del DO, así que ni siquiera
--      existe como sentencia suelta): sin la confirmación vigente en la MISMA transacción el DO falla y no queda nada.
--   3. El bloque TERMINA EN «ROLLBACK;». Para confirmarlo hay que editar a mano esa línea y ponerla en «COMMIT;» después de revisar
--      el SELECT de verificación del propio bloque.
-- ADVERTENCIA: ejecutar el bloque COMPLETO en UNA sola sesión (BEGIN … ROLLBACK/COMMIT en la misma conexión). El ROLLBACK de la línea
-- final solo deshace lo que se hizo en SU transacción; un cliente que ejecute cada sentencia en una conexión o en autocommit aparte
-- (un pooler en modo sentencia, un editor que parte el script) deja confirmada cada sentencia suelta y el ROLLBACK no hace nada.
-- El seguro 2 evita ese caso, pero no lo uses como excusa: nunca pegues solo una parte del bloque.
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
--     pantalla. RECOMENDADO: hacerlo desde ese panel (Empresa › Usuarios › botón Roles y permisos), POR MARCO SANTOS GODOY (cuenta
--     personal): deja a la persona administradora como actor en permission_audit_log y la bitácora nombra a una persona. La cuenta
--     propietaria lleva el nombre de la empresa y no identifica a nadie. Por SQL, quien ejecuta NO queda como actor (auth.uid() es
--     nulo): todas las filas de la bitácora quedan con el actor vacío.
--   · NO se puede ejecutar ANTES del despliegue de la 0900: las cinco llaves no existen en el catálogo (permissions) hasta entonces y
--     role_permissions.permission_key es llave foránea de permissions(key) (P-0.3 lo comprueba).
--
-- HECHOS DE PRODUCCIÓN (lectura del 2026-10-10; volver a correr P-0.x y V-3 inmediatamente antes de decidir)
--   · Alexander Monterroso: id 327ffeda-85e8-4ea4-9423-af9b206ee886 · perfil `operator` · empresa «Prestadora de Servicios S.A.»
--     (24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31) · activo · 6 proyectos asignados (21B+, Cascadas de Vista Hermosa, Edificio SQ,
--     La Arboleda CVH, Parajes Vermont, Viñas del Sur Condominio 3). Un solo rol, sin vencimiento y sin `deny`: la copia de empresa
--     «Finanzas / Contador» (d915897c-b350-431a-8447-b37c61f97e8a), con 1 193 de las 1 201 llaves del catálogo en `allow` (la
--     plantilla de sistema tiene 63): 1 106 concedidas en bloque por la cuenta propietaria el 2026-08-13 21:52:53 y 87 sin actor
--     (2026-06-12 a 2026-09-10). Incluye platform.contabilidad.{view,create,edit,delete,approve,change_status} y
--     condominios.tab.ordenes_compra{,.create,.edit,.approve,.change_status,.delete}. No tiene rol de ajustes individuales.
--       HOY puede las seis acciones. DESPUÉS de la 0900 conserva SOLO «aprobar orden de compra» (tiene la llave de la pestaña) y deja
--       de poder registrar recepciones, aprobar facturas, aprobar órdenes de pago, ejecutar y anular pagos hasta que se le concedan.
--   · QUÉ EXIGE HOY EL SERVIDOR (producción, antes de la 0900; verificado el 2026-10-11): SOLO platform.contabilidad.edit (políticas
--     UPDATE de las cuatro tablas). NO existen compras_exigir_accion ni los disparadores compras_tg_permiso_*; approve y change_status
--     solo gobiernan la pantalla. Por eso cualquier persona con `edit` puede hoy las seis acciones y, tras la 0900, las pierde: hoy
--     solo Alexander tiene edit, approve y change_status (0 personas más). La columna «hoy_antes_0900» de V-3 mide las llaves
--     genéricas (la pantalla y la cadena 0300–0800 de este PR), NO un control del servidor de producción. Una persona con `edit` y sin
--     approve/change_status saldría «no → no» en V-3 aunque hoy pueda las seis: el día del despliegue correr además la fila
--     `perfil_afectado` de scripts/diagnostico-compras-controles.sql (debe seguir en 0).
--   · Marco Santos Godoy: id 86440f9d-e34b-49ba-91c7-3531ed365460 · ADMIN con 3 proyectos asignados (21B+, Edificio SQ, Parajes
--     Vermont). Un administrador pasa TODA llave por su perfil: no pierde ni necesita nada, y NO es exento de proyecto (solo actúa en
--     esos 3, antes y después). Nada que conceder.
--   · Nadie más tiene llaves de Contabilidad ni de la pestaña de órdenes entre las personas no exentas (30 activas). Pasan toda
--     llave por perfil, además de Marco, la cuenta propietaria (`company_owner`) y el superadministrador, ambos sin límite de proyecto.
--   · OJO con el nombre: «Monterroso» coincide con TRES cuentas (Alexander Monterroso `operator`; Alex Monterroso e Isabel Monterroso,
--     `cliente`, sin empresa) y «Santos» con otras TRES (Marco Santos Godoy `admin`; «Marco Santos», cuenta `cliente` sin empresa;
--     «Eduardo Santos», `viewer`). Además hay dos empresas de nombre casi igual: «Prestadora de Servicios S.A.» (la de las personas, 22
--     usuarios, 18 roles, 8 proyectos) y «Prestadora de Servicios» (0 de todo), y la cuenta propietaria se llama «Prestadora de
--     Servicios Básicos S.A.». La versión anterior de este archivo identificaba a la persona con ILIKE '%Monterroso%' también DENTRO
--     de los bloques de concesión; esta versión usa el id y exige perfil, empresa y estado (P-0.1, P-0.2). Nunca buscar por nombre.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- P-0 · COMPROBACIONES PREVIAS (solo lectura, NO comentadas)
--   Además de P-0.1 a P-0.4: el día del despliegue correr la fila `perfil_afectado` de scripts/diagnostico-compras-controles.sql
--   (hoy: 0 filas; si apareciera alguien con `edit` sin approve/change_status, hoy puede las seis y las perdería todas).
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
--   PAQUETES (ver el documento, §5):
--     A · «ninguna llave por ahora»: no se ejecuta ningún bloque (se conceden en un minuto cuando Alexander vuelva a operar).
--     B · «recepción + factura + orden de pago» (RECOMENDADO): P-1.1, P-1.2 y P-1.3.
--     C · «continuidad total» (= lo que Alexander puede hoy): además P-1.4 y P-1.5.
-- ════════════════════════════════════════════════════════════════════════════

-- ▶ P-1.1 · Registrar recepciones          (pantalla hoy: change_status + edit; servidor hoy: solo edit)  → platform.contabilidad.compras.recepcion_registrar   [paquete B · RECOMENDADA]
--SQL BEGIN;
--SQL -- CONFIRMACIÓN (A-1.1): quitar el «-- » del inicio de la línea SIGUIENTE solo con la respuesta por escrito. Es SET LOCAL a propósito (vale solo dentro de esta transacción), y se escribe 'si' sin tilde.
--SQL -- SET LOCAL prop.confirmar = 'si';
--SQL DO $prop$
--SQL BEGIN
--SQL   IF current_setting('prop.confirmar', true) IS DISTINCT FROM 'si' THEN
--SQL     RAISE EXCEPTION 'P-1.1 SIN CONFIRMAR: no se escribio nada. Ejecutar el bloque COMPLETO en UNA sola sesion y quitar el comentario de SET LOCAL prop.confirmar.';
--SQL   END IF;
--SQL   EXECUTE $q$
--SQL     WITH u AS (
--SQL       SELECT id, company_id, full_name FROM public.app_users
--SQL        WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND role = 'operator' AND activo
--SQL          AND company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR con P-0.1: 1 fila
--SQL     ), r0 AS (
--SQL       SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL     ), r1 AS (
--SQL       INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL       SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL              'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL         FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL       RETURNING id
--SQL     ), r AS (
--SQL       SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL     ), a AS (
--SQL       INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL       SELECT u.id, r.id, NULL FROM u, r
--SQL       ON CONFLICT (user_id, role_id) DO NOTHING
--SQL     )
--SQL     INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL     SELECT r.id, 'platform.contabilidad.compras.recepcion_registrar', 'allow' FROM r
--SQL     ON CONFLICT (role_id, permission_key) DO NOTHING
--SQL   $q$;
--SQL END
--SQL $prop$;
--SQL -- Verificar: 1 fila por cada llave concedida hasta ahora, con effect = allow y expires_at vacío (si sale vacío, el filtro no coincidió y NO se escribió nada):
--SQL SELECT r.name, rp.permission_key, rp.effect, ur.expires_at
--SQL   FROM public.roles r
--SQL   JOIN public.role_permissions rp ON rp.role_id = r.id
--SQL   JOIN public.user_roles ur ON ur.role_id = r.id AND ur.user_id = r.user_override_for
--SQL  WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886';
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT; solo con la confirmación escrita y la verificación revisada
-- ◀ P-1.1

-- ▶ P-1.2 · Aprobar facturas de proveedor  (pantalla hoy: approve + edit; servidor hoy: solo edit)        → platform.contabilidad.compras.factura_aprobar        [paquete B · RECOMENDADA]
--SQL BEGIN;
--SQL -- CONFIRMACIÓN (A-1.2): quitar el «-- » del inicio de la línea SIGUIENTE solo con la respuesta por escrito. Es SET LOCAL a propósito (vale solo dentro de esta transacción), y se escribe 'si' sin tilde.
--SQL -- SET LOCAL prop.confirmar = 'si';
--SQL DO $prop$
--SQL BEGIN
--SQL   IF current_setting('prop.confirmar', true) IS DISTINCT FROM 'si' THEN
--SQL     RAISE EXCEPTION 'P-1.2 SIN CONFIRMAR: no se escribio nada. Ejecutar el bloque COMPLETO en UNA sola sesion y quitar el comentario de SET LOCAL prop.confirmar.';
--SQL   END IF;
--SQL   EXECUTE $q$
--SQL     WITH u AS (
--SQL       SELECT id, company_id, full_name FROM public.app_users
--SQL        WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND role = 'operator' AND activo
--SQL          AND company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR con P-0.1: 1 fila
--SQL     ), r0 AS (
--SQL       SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL     ), r1 AS (
--SQL       INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL       SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL              'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL         FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL       RETURNING id
--SQL     ), r AS (
--SQL       SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL     ), a AS (
--SQL       INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL       SELECT u.id, r.id, NULL FROM u, r
--SQL       ON CONFLICT (user_id, role_id) DO NOTHING
--SQL     )
--SQL     INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL     SELECT r.id, 'platform.contabilidad.compras.factura_aprobar', 'allow' FROM r
--SQL     ON CONFLICT (role_id, permission_key) DO NOTHING
--SQL   $q$;
--SQL END
--SQL $prop$;
--SQL -- Verificar: 1 fila por cada llave concedida hasta ahora, con effect = allow y expires_at vacío (si sale vacío, el filtro no coincidió y NO se escribió nada):
--SQL SELECT r.name, rp.permission_key, rp.effect, ur.expires_at
--SQL   FROM public.roles r
--SQL   JOIN public.role_permissions rp ON rp.role_id = r.id
--SQL   JOIN public.user_roles ur ON ur.role_id = r.id AND ur.user_id = r.user_override_for
--SQL  WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886';
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT; solo con la confirmación escrita y la verificación revisada
-- ◀ P-1.2

-- ▶ P-1.3 · Aprobar órdenes de pago        (pantalla hoy: approve + edit; servidor hoy: solo edit)        → platform.contabilidad.compras.orden_pago_aprobar     [paquete B · RECOMENDADA]
--SQL BEGIN;
--SQL -- CONFIRMACIÓN (A-1.3): quitar el «-- » del inicio de la línea SIGUIENTE solo con la respuesta por escrito. Es SET LOCAL a propósito (vale solo dentro de esta transacción), y se escribe 'si' sin tilde.
--SQL -- SET LOCAL prop.confirmar = 'si';
--SQL DO $prop$
--SQL BEGIN
--SQL   IF current_setting('prop.confirmar', true) IS DISTINCT FROM 'si' THEN
--SQL     RAISE EXCEPTION 'P-1.3 SIN CONFIRMAR: no se escribio nada. Ejecutar el bloque COMPLETO en UNA sola sesion y quitar el comentario de SET LOCAL prop.confirmar.';
--SQL   END IF;
--SQL   EXECUTE $q$
--SQL     WITH u AS (
--SQL       SELECT id, company_id, full_name FROM public.app_users
--SQL        WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND role = 'operator' AND activo
--SQL          AND company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR con P-0.1: 1 fila
--SQL     ), r0 AS (
--SQL       SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL     ), r1 AS (
--SQL       INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL       SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL              'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL         FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL       RETURNING id
--SQL     ), r AS (
--SQL       SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL     ), a AS (
--SQL       INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL       SELECT u.id, r.id, NULL FROM u, r
--SQL       ON CONFLICT (user_id, role_id) DO NOTHING
--SQL     )
--SQL     INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL     SELECT r.id, 'platform.contabilidad.compras.orden_pago_aprobar', 'allow' FROM r
--SQL     ON CONFLICT (role_id, permission_key) DO NOTHING
--SQL   $q$;
--SQL END
--SQL $prop$;
--SQL -- Verificar: 1 fila por cada llave concedida hasta ahora, con effect = allow y expires_at vacío (si sale vacío, el filtro no coincidió y NO se escribió nada):
--SQL SELECT r.name, rp.permission_key, rp.effect, ur.expires_at
--SQL   FROM public.roles r
--SQL   JOIN public.role_permissions rp ON rp.role_id = r.id
--SQL   JOIN public.user_roles ur ON ur.role_id = r.id AND ur.user_id = r.user_override_for
--SQL  WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886';
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT; solo con la confirmación escrita y la verificación revisada
-- ◀ P-1.3

-- ▶ P-1.4 · Ejecutar pagos                 (pantalla hoy: change_status + edit; servidor hoy: solo edit)  → platform.contabilidad.compras.pago_ejecutar         [SOLO paquete C «continuidad total»]
--SQL BEGIN;
--SQL -- CONFIRMACIÓN (A-1.4): quitar el «-- » del inicio de la línea SIGUIENTE solo con la respuesta por escrito. Es SET LOCAL a propósito (vale solo dentro de esta transacción), y se escribe 'si' sin tilde.
--SQL -- SET LOCAL prop.confirmar = 'si';
--SQL DO $prop$
--SQL BEGIN
--SQL   IF current_setting('prop.confirmar', true) IS DISTINCT FROM 'si' THEN
--SQL     RAISE EXCEPTION 'P-1.4 SIN CONFIRMAR: no se escribio nada. Ejecutar el bloque COMPLETO en UNA sola sesion y quitar el comentario de SET LOCAL prop.confirmar.';
--SQL   END IF;
--SQL   EXECUTE $q$
--SQL     WITH u AS (
--SQL       SELECT id, company_id, full_name FROM public.app_users
--SQL        WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND role = 'operator' AND activo
--SQL          AND company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR con P-0.1: 1 fila
--SQL     ), r0 AS (
--SQL       SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL     ), r1 AS (
--SQL       INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL       SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL              'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL         FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL       RETURNING id
--SQL     ), r AS (
--SQL       SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL     ), a AS (
--SQL       INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL       SELECT u.id, r.id, NULL FROM u, r
--SQL       ON CONFLICT (user_id, role_id) DO NOTHING
--SQL     )
--SQL     INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL     SELECT r.id, 'platform.contabilidad.compras.pago_ejecutar', 'allow' FROM r
--SQL     ON CONFLICT (role_id, permission_key) DO NOTHING
--SQL   $q$;
--SQL END
--SQL $prop$;
--SQL -- Verificar: 1 fila por cada llave concedida hasta ahora, con effect = allow y expires_at vacío (si sale vacío, el filtro no coincidió y NO se escribió nada):
--SQL SELECT r.name, rp.permission_key, rp.effect, ur.expires_at
--SQL   FROM public.roles r
--SQL   JOIN public.role_permissions rp ON rp.role_id = r.id
--SQL   JOIN public.user_roles ur ON ur.role_id = r.id AND ur.user_id = r.user_override_for
--SQL  WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886';
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT; solo con la confirmación escrita y la verificación revisada
-- ◀ P-1.4

-- ▶ P-1.5 · Anular pagos                   (pantalla hoy: change_status + edit; servidor hoy: solo edit)  → platform.contabilidad.compras.pago_anular           [SOLO paquete C «continuidad total»]
--SQL BEGIN;
--SQL -- CONFIRMACIÓN (A-1.5): quitar el «-- » del inicio de la línea SIGUIENTE solo con la respuesta por escrito. Es SET LOCAL a propósito (vale solo dentro de esta transacción), y se escribe 'si' sin tilde.
--SQL -- SET LOCAL prop.confirmar = 'si';
--SQL DO $prop$
--SQL BEGIN
--SQL   IF current_setting('prop.confirmar', true) IS DISTINCT FROM 'si' THEN
--SQL     RAISE EXCEPTION 'P-1.5 SIN CONFIRMAR: no se escribio nada. Ejecutar el bloque COMPLETO en UNA sola sesion y quitar el comentario de SET LOCAL prop.confirmar.';
--SQL   END IF;
--SQL   EXECUTE $q$
--SQL     WITH u AS (
--SQL       SELECT id, company_id, full_name FROM public.app_users
--SQL        WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND role = 'operator' AND activo
--SQL          AND company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR con P-0.1: 1 fila
--SQL     ), r0 AS (
--SQL       SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL     ), r1 AS (
--SQL       INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL       SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL              'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL         FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL       RETURNING id
--SQL     ), r AS (
--SQL       SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL     ), a AS (
--SQL       INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL       SELECT u.id, r.id, NULL FROM u, r
--SQL       ON CONFLICT (user_id, role_id) DO NOTHING
--SQL     )
--SQL     INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL     SELECT r.id, 'platform.contabilidad.compras.pago_anular', 'allow' FROM r
--SQL     ON CONFLICT (role_id, permission_key) DO NOTHING
--SQL   $q$;
--SQL END
--SQL $prop$;
--SQL -- Verificar: 1 fila por cada llave concedida hasta ahora, con effect = allow y expires_at vacío (si sale vacío, el filtro no coincidió y NO se escribió nada):
--SQL SELECT r.name, rp.permission_key, rp.effect, ur.expires_at
--SQL   FROM public.roles r
--SQL   JOIN public.role_permissions rp ON rp.role_id = r.id
--SQL   JOIN public.user_roles ur ON ur.role_id = r.id AND ur.user_id = r.user_override_for
--SQL  WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886';
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT; solo con la confirmación escrita y la verificación revisada
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
--SQL -- CONFIRMACIÓN (respuesta por escrito de esa persona): quitar el «-- » del inicio de la línea SIGUIENTE solo con la respuesta por escrito. Es SET LOCAL a propósito (vale solo dentro de esta transacción), y se escribe 'si' sin tilde.
--SQL -- SET LOCAL prop.confirmar = 'si';
--SQL DO $prop$
--SQL BEGIN
--SQL   IF current_setting('prop.confirmar', true) IS DISTINCT FROM 'si' THEN
--SQL     RAISE EXCEPTION 'P-3 SIN CONFIRMAR: no se escribio nada. Ejecutar el bloque COMPLETO en UNA sola sesion y quitar el comentario de SET LOCAL prop.confirmar.';
--SQL   END IF;
--SQL   EXECUTE $q$
--SQL     WITH u AS (
--SQL       SELECT id, company_id, full_name FROM public.app_users
--SQL        WHERE id = '<UUID_DE_LA_PERSONA>' AND activo
--SQL          AND company_id = '<UUID_DE_LA_EMPRESA>'                                  -- CONFIRMAR: 1 fila
--SQL     ), r0 AS (
--SQL       SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id
--SQL     ), r1 AS (
--SQL       INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
--SQL       SELECT u.company_id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')',
--SQL              'Ajustes finos asignados directamente al usuario', false, '#7E9389', u.id
--SQL         FROM u WHERE NOT EXISTS (SELECT 1 FROM r0)
--SQL       RETURNING id
--SQL     ), r AS (
--SQL       SELECT id FROM r0 UNION ALL SELECT id FROM r1
--SQL     ), a AS (
--SQL       INSERT INTO public.user_roles (user_id, role_id, expires_at)
--SQL       SELECT u.id, r.id, NULL FROM u, r
--SQL       ON CONFLICT (user_id, role_id) DO NOTHING
--SQL     )
--SQL     INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL     SELECT r.id, k, 'allow' FROM r, unnest(ARRAY[
--SQL       'platform.contabilidad.compras.recepcion_registrar',
--SQL       'platform.contabilidad.compras.factura_aprobar',
--SQL       'platform.contabilidad.compras.orden_pago_aprobar',
--SQL       'platform.contabilidad.compras.pago_ejecutar',
--SQL       'platform.contabilidad.compras.pago_anular'
--SQL       -- y, solo si la persona usaba `approve` genérico para la orden de compra y NO tiene la llave de la pestaña:
--SQL       -- 'condominios.tab.ordenes_compra.approve'
--SQL     ]) k
--SQL     ON CONFLICT (role_id, permission_key) DO NOTHING
--SQL   $q$;
--SQL END
--SQL $prop$;
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
--SQL -- CONFIRMACIÓN (decisión A-2.2 por escrito): quitar el «-- » del inicio de la línea SIGUIENTE solo con la respuesta por escrito. Es SET LOCAL a propósito (vale solo dentro de esta transacción), y se escribe 'si' sin tilde.
--SQL -- SET LOCAL prop.confirmar = 'si';
--SQL DO $prop$
--SQL BEGIN
--SQL   IF current_setting('prop.confirmar', true) IS DISTINCT FROM 'si' THEN
--SQL     RAISE EXCEPTION 'P-4 SIN CONFIRMAR: no se escribio nada. Ejecutar el bloque COMPLETO en UNA sola sesion y quitar el comentario de SET LOCAL prop.confirmar.';
--SQL   END IF;
--SQL   EXECUTE $q$
--SQL     INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL     SELECT r.id, '<LLAVE>', 'allow'
--SQL       FROM public.roles r
--SQL      WHERE r.id = 'd915897c-b350-431a-8447-b37c61f97e8a' AND r.name = 'Finanzas / Contador' AND r.is_system = false
--SQL        AND r.company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'                                  -- CONFIRMAR: 1 fila
--SQL     ON CONFLICT (role_id, permission_key) DO NOTHING
--SQL   $q$;
--SQL END
--SQL $prop$;
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT;
-- ◀ P-4


-- ════════════════════════════════════════════════════════════════════════════
-- P-5 · ALTERNATIVA POR PLANTILLA DE SISTEMA (NO recomendada ahora; decisión A-2): conceder una llave a la plantilla
--   Las plantillas (roles.is_system) NO se editan desde la pantalla: "Usar plantilla" y "Personalizar" CLONAN. Su role_permissions
--   solo lo escribe el superadministrador (la política de INSERT exige is_super_admin() para un rol de sistema) o una migración.
--   Y una plantilla NO se propaga: la copia de empresa es una fotografía de las llaves de la plantilla en el momento de crearla
--   (ensureCompanyRoleFromTemplate; una copia fiel ya existente se reutiliza, nunca se refresca) y NO se copia sola al crear una
--   empresa nueva (ninguna migración o función siembra copias al crear una empresa; la ÚNICA siembra fue la conversión única
--   20260612100300_rbac_assignments_to_company_roles.sql, origen de las copias de Alexander y de Marco; después la copia nace en la
--   pantalla, al usar la plantilla o al crear un usuario con ese rol). Excepción: create-user y accept-invitation asignan DIRECTAMENTE la plantilla de
--   plataforma del perfil (admin → «Admin Plataforma», operator → «Operador Plataforma»…), un vínculo vivo; hoy hay 0 así.
--   Efecto, entonces: solo las copias que se creen DESPUÉS (y quien tuviera la plantilla asignada directamente: nadie hoy).
--   Ninguna persona ni copia actual cambia. Tres plantillas relevantes:
--     «Finanzas / Contador» 00000000-0000-0000-0000-000000000003 · «Admin Plataforma» …0201 · «Administrador General» …0001.
-- ════════════════════════════════════════════════════════════════════════════
-- ▶ P-5 · plantilla «Finanzas / Contador» ← llaves confirmadas (editar el ARRAY)
--SQL BEGIN;
--SQL -- CONFIRMACIÓN (decisión A-2.1 por escrito): quitar el «-- » del inicio de la línea SIGUIENTE solo con la respuesta por escrito. Es SET LOCAL a propósito (vale solo dentro de esta transacción), y se escribe 'si' sin tilde.
--SQL -- SET LOCAL prop.confirmar = 'si';
--SQL DO $prop$
--SQL BEGIN
--SQL   IF current_setting('prop.confirmar', true) IS DISTINCT FROM 'si' THEN
--SQL     RAISE EXCEPTION 'P-5 SIN CONFIRMAR: no se escribio nada. Ejecutar el bloque COMPLETO en UNA sola sesion y quitar el comentario de SET LOCAL prop.confirmar.';
--SQL   END IF;
--SQL   EXECUTE $q$
--SQL     INSERT INTO public.role_permissions (role_id, permission_key, effect)
--SQL     SELECT r.id, k, 'allow'
--SQL       FROM public.roles r, unnest(ARRAY[
--SQL         'platform.contabilidad.compras.recepcion_registrar',
--SQL         'platform.contabilidad.compras.factura_aprobar',
--SQL         'platform.contabilidad.compras.orden_pago_aprobar'
--SQL       ]) k
--SQL      WHERE r.id = '00000000-0000-0000-0000-000000000003' AND r.is_system AND r.name = 'Finanzas / Contador'   -- CONFIRMAR: 1 fila
--SQL     ON CONFLICT (role_id, permission_key) DO NOTHING
--SQL   $q$;
--SQL END
--SQL $prop$;
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT; solo con A-2 respondida por escrito
-- ◀ P-5


-- ════════════════════════════════════════════════════════════════════════════
-- P-9 · REVERSIÓN EXACTA de lo concedido con P-1.x / P-3 (la bitácora, que es de solo añadir, conserva el rastro y no se borra)
--   La reversión exacta es DESMARCAR las casillas en el panel (el producto borra el rol oculto si no quedan ajustes) o borrar el rol de
--   ajustes: DELETE FROM roles WHERE user_override_for = <id>. Borrar SOLO filas de role_permissions deja un rol de ajustes vacío y su
--   asignación (user_roles +1 y roles +1 respecto del estado previo). El DELETE de este bloque borra el rol de ajustes COMPLETO de la
--   persona: si ese rol tuviera, además, ajustes ajenos a esta propuesta, también se irían; revisarlo antes con V-6.
-- ════════════════════════════════════════════════════════════════════════════
-- ▶ P-9 · REVERSIÓN exacta de los ajustes individuales de Alexander (deshace P-1.x): borra su rol de ajustes y, en cascada, su asignación y sus filas de role_permissions
--SQL BEGIN;
--SQL -- CONFIRMACIÓN (reversión decidida por escrito): quitar el «-- » del inicio de la línea SIGUIENTE solo con la respuesta por escrito. Es SET LOCAL a propósito (vale solo dentro de esta transacción), y se escribe 'si' sin tilde.
--SQL -- SET LOCAL prop.confirmar = 'si';
--SQL DO $prop$
--SQL BEGIN
--SQL   IF current_setting('prop.confirmar', true) IS DISTINCT FROM 'si' THEN
--SQL     RAISE EXCEPTION 'P-9 SIN CONFIRMAR: no se escribio nada. Ejecutar el bloque COMPLETO en UNA sola sesion y quitar el comentario de SET LOCAL prop.confirmar.';
--SQL   END IF;
--SQL   EXECUTE $q$
--SQL     DELETE FROM public.roles r
--SQL      USING public.app_users u
--SQL      WHERE r.user_override_for = u.id AND r.is_system = false AND r.company_id = u.company_id
--SQL        AND u.id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND u.role = 'operator' AND u.company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'   -- CONFIRMAR con P-0.1: 1 fila
--SQL   $q$;
--SQL END
--SQL $prop$;
--SQL -- Verificar: 0 filas (la persona ya no tiene rol de ajustes individuales, ni asignación, ni filas de role_permissions de ese rol):
--SQL SELECT r.id, r.name FROM public.roles r WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886';
--SQL ROLLBACK;   -- ← por defecto NO confirma. Para confirmar: cambiar por COMMIT;
-- ◀ P-9


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
--   OJO con la columna `hoy_antes_0900`: mide las llaves GENÉRICAS (lo que exigía la pantalla y la cadena 0300–0800 de este PR), NO un
--   control del servidor de producción, que hoy exige SOLO `edit` (la columna `edit`). Una persona con `edit` y sin approve/change_status
--   saldría «no» en `hoy_antes_0900` aunque hoy pueda las seis: para ellas correr la fila `perfil_afectado` de
--   scripts/diagnostico-compras-controles.sql (hoy: 0 filas; solo Alexander tiene edit, approve y change_status).
--   Lectura del 2026-10-10 (antes de la 0900 y de cualquier concesión):
--     Alexander: hoy sí en las 6; después: 1 sí; 2, 3, 4, 5 y 6 no.     Marco: sí → sí en las 6.
--   Resultado esperado TRAS el paquete B (P-1.1 a P-1.3): Alexander 1, 2, 3 y 4 «sí»; 5 y 6 «no».
--   Resultado esperado TRAS el paquete C «continuidad total» (P-1.1 a P-1.5): Alexander «sí» en las 6 (sí → sí).
--   Con el paquete A (ninguna llave) no cambia nada: queda como la lectura de arriba.
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
--   el paquete B deben subir +3, +1 y +1 —el rol de ajustes individuales—; con el paquete C, +5, +1 y +1; con el A, +0; si en
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

-- V-6 · Qué tiene hoy el rol de ajustes individuales de Alexander (0 filas si no existe). Antes de P-9 (reversión): si aparece alguna
--   llave ajena a esta propuesta, borrar el rol la quitaría también; en ese caso desmarcar solo las casillas en el panel.
SELECT r.name AS rol, rp.permission_key, rp.effect, ur.expires_at
  FROM public.roles r
  LEFT JOIN public.role_permissions rp ON rp.role_id = r.id
  LEFT JOIN public.user_roles ur ON ur.role_id = r.id AND ur.user_id = r.user_override_for
 WHERE r.user_override_for = '327ffeda-85e8-4ea4-9423-af9b206ee886'
 ORDER BY rp.permission_key;
