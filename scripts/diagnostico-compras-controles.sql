-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO PREVIO A 20261027000000…0500 (controles de servidor de Compras)
-- SOLO LECTURA: un único SELECT, sin escribir nada. Se puede correr en el SQL
-- Editor del proyecto (producción incluida) ANTES de aplicar las migraciones.
--
-- QUÉ RESPONDE
-- Las migraciones solo restringen escrituras NUEVAS: no reparan ni borran nada. Este
-- diagnóstico lista lo que YA existe y las migraciones habrían impedido, y a quién
-- alcanzará el control de permisos por acción, para que quien administra decida.
--
-- CÓMO LEERLO — una fila por hallazgo: apartado · tabla · id · detalle
--   · `referencia_cruzada`  documentos que apuntan a un proveedor, proyecto, cuenta,
--                           factura o contraseña de OTRA empresa o contabilidad. Cada
--                           fila es un defecto de datos a corregir con un plan propio.
--   · `pago_sin_control`    facturas pagadas por encima de su total (suma de órdenes
--                           pagadas), pagos de facturas que nunca se aprobaron, y
--                           facturas «aprobadas» sin devengo contable.
--   · `duplicado`           mismo proveedor escrito igual (sin acentos ni mayúsculas) y
--                           misma factura con otro formato de número o sin número.
--                           NO se fusiona nada solo.
--   · `perfil_afectado`     usuarios NO administradores con «Editar — Contabilidad» que
--                           no tienen «Autorizar / Denegar» y/o «Cambiar estado»: hoy
--                           pueden hacer por API lo que la pantalla ya no les ofrece y
--                           dejarán de poder. Si es un olvido, asignar el permiso ANTES
--                           de aplicar.
--   Cero filas en un apartado = nada que decidir ahí.
-- ════════════════════════════════════════════════════════════════════════════
WITH
perfiles AS (
  SELECT u.id, u.full_name, u.company_id, u.role,
         EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                  WHERE ur.user_id = u.id AND rp.effect = 'allow'
                    AND (ur.expires_at IS NULL OR ur.expires_at > now())
                    AND rp.permission_key = 'platform.contabilidad.edit') AS puede_editar,
         EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                  WHERE ur.user_id = u.id AND rp.effect = 'allow'
                    AND (ur.expires_at IS NULL OR ur.expires_at > now())
                    AND rp.permission_key = 'platform.contabilidad.approve')
         AND NOT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                          WHERE ur.user_id = u.id AND rp.effect = 'deny'
                            AND (ur.expires_at IS NULL OR ur.expires_at > now())
                            AND rp.permission_key = 'platform.contabilidad.approve') AS puede_autorizar,
         EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                  WHERE ur.user_id = u.id AND rp.effect = 'allow'
                    AND (ur.expires_at IS NULL OR ur.expires_at > now())
                    AND rp.permission_key = 'platform.contabilidad.change_status')
         AND NOT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                          WHERE ur.user_id = u.id AND rp.effect = 'deny'
                            AND (ur.expires_at IS NULL OR ur.expires_at > now())
                            AND rp.permission_key = 'platform.contabilidad.change_status') AS puede_cambiar_estado
    FROM public.app_users u
   WHERE u.activo IS NOT FALSE
     AND u.role NOT IN ('super_admin', 'superadmin', 'company_owner', 'admin')
),
pagos_directos AS (
  SELECT o.factura_id, SUM(o.monto) AS pagado
    FROM public.ordenes_pago o
   WHERE o.estado = 'pagada' AND o.factura_id IS NOT NULL
   GROUP BY o.factura_id
),
pagos_contrasena AS (
  SELECT cf.factura_id, SUM(cf.monto) AS pagado
    FROM public.contrasena_pago_facturas cf
    JOIN public.ordenes_pago o ON o.contrasena_pago_id = cf.contrasena_id AND o.estado = 'pagada'
   GROUP BY cf.factura_id
),
hallazgos AS (
  -- ── Referencias cruzadas entre empresas / contabilidades ──────────────────
  SELECT 'referencia_cruzada' AS apartado, 'ordenes_compra' AS tabla, o.id::text AS id,
         'proveedor o proyecto de otra empresa' AS detalle
    FROM public.ordenes_compra o
   WHERE (o.proveedor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.proveedores v WHERE v.id = o.proveedor_id AND v.company_id = o.company_id))
      OR (o.project_id   IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p    WHERE p.id = o.project_id    AND p.company_id = o.company_id))
  UNION ALL
  SELECT 'referencia_cruzada', 'facturas_proveedor', f.id::text, 'proveedor o proyecto de otra empresa'
    FROM public.facturas_proveedor f
   WHERE NOT EXISTS (SELECT 1 FROM public.proveedores v WHERE v.id = f.proveedor_id AND v.company_id = f.company_id)
      OR (f.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = f.project_id AND p.company_id = f.company_id))
  UNION ALL
  SELECT 'referencia_cruzada', 'contrasenas_pago', c.id::text, 'proveedor o proyecto de otra empresa'
    FROM public.contrasenas_pago c
   WHERE NOT EXISTS (SELECT 1 FROM public.proveedores v WHERE v.id = c.proveedor_id AND v.company_id = c.company_id)
      OR (c.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = c.project_id AND p.company_id = c.company_id))
  UNION ALL
  SELECT 'referencia_cruzada', 'ordenes_pago', o.id::text,
         'proveedor/proyecto de otra empresa, o factura/contraseña de otra empresa, proveedor o contabilidad'
    FROM public.ordenes_pago o
    LEFT JOIN public.facturas_proveedor f ON f.id = o.factura_id
    LEFT JOIN public.contrasenas_pago c ON c.id = o.contrasena_pago_id
   WHERE NOT EXISTS (SELECT 1 FROM public.proveedores v WHERE v.id = o.proveedor_id AND v.company_id = o.company_id)
      OR (o.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = o.project_id AND p.company_id = o.company_id))
      OR (f.id IS NOT NULL AND (f.company_id <> o.company_id OR f.proveedor_id <> o.proveedor_id OR f.project_id IS DISTINCT FROM o.project_id))
      OR (c.id IS NOT NULL AND (c.company_id <> o.company_id OR c.proveedor_id <> o.proveedor_id OR c.project_id IS DISTINCT FROM o.project_id))
  UNION ALL
  SELECT 'referencia_cruzada', 'orden_compra_lineas', l.id::text, 'renglón de una empresa sobre la orden de otra'
    FROM public.orden_compra_lineas l JOIN public.ordenes_compra o ON o.id = l.orden_compra_id
   WHERE l.company_id <> o.company_id
  UNION ALL
  SELECT 'referencia_cruzada', 'factura_proveedor_lineas', l.id::text,
         'renglón de una empresa sobre la factura de otra, o con una cuenta de otra contabilidad'
    FROM public.factura_proveedor_lineas l
    JOIN public.facturas_proveedor f ON f.id = l.factura_id
    LEFT JOIN public.conta_cuentas c ON c.id = l.cuenta_id
   WHERE l.company_id <> f.company_id
      OR (c.id IS NOT NULL AND (c.company_id <> f.company_id OR c.project_id IS DISTINCT FROM f.project_id))
  UNION ALL
  -- ── Pagos sin control ──────────────────────────────────────────────────────
  SELECT 'pago_sin_control', 'facturas_proveedor', f.id::text,
         format('pagada por %s (órdenes pagadas) sobre un total de %s', COALESCE(d.pagado, 0) + COALESCE(c.pagado, 0), f.monto_total)
    FROM public.facturas_proveedor f
    LEFT JOIN pagos_directos d ON d.factura_id = f.id
    LEFT JOIN pagos_contrasena c ON c.factura_id = f.id
   WHERE f.estado <> 'anulada' AND COALESCE(d.pagado, 0) + COALESCE(c.pagado, 0) > f.monto_total
  UNION ALL
  SELECT 'pago_sin_control', 'ordenes_pago', o.id::text,
         format('orden pagada contra la factura %s que nunca se aprobó (estado %s)', COALESCE(f.numero_factura, f.id::text), f.estado)
    FROM public.ordenes_pago o JOIN public.facturas_proveedor f ON f.id = o.factura_id
   WHERE o.estado = 'pagada' AND f.aprobada_at IS NULL
  UNION ALL
  SELECT 'pago_sin_control', 'facturas_proveedor', f.id::text, 'aprobada o pagada sin asiento de devengo publicado (¿cola de contabilización pendiente?)'
    FROM public.facturas_proveedor f
   WHERE f.estado IN ('aprobada', 'pagada_parcial', 'pagada')
     AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                      WHERE a.company_id = f.company_id AND a.origen_tabla = 'facturas_proveedor' AND a.origen_id = f.id
                        AND a.origen_evento = 'factura_prov_aprobada')
  UNION ALL
  -- ── Duplicados ────────────────────────────────────────────────────────────
  SELECT 'duplicado', 'proveedores', string_agg(p.id::text, ', ' ORDER BY p.created_at),
         format('%s proveedores con el mismo nombre normalizado «%s» (códigos: %s)', count(*),
                public.proveedor_normalizar_nombre(min(p.nombre)), string_agg(COALESCE(p.codigo, 's/código'), ', ' ORDER BY p.created_at))
    FROM public.proveedores p
   GROUP BY p.company_id, public.proveedor_normalizar_nombre(p.nombre)
  HAVING count(*) > 1 AND public.proveedor_normalizar_nombre(min(p.nombre)) <> ''
  UNION ALL
  SELECT 'duplicado', 'facturas_proveedor', string_agg(f.id::text, ', ' ORDER BY f.created_at),
         format('%s facturas vivas con un número equivalente («%s») del mismo proveedor', count(*), string_agg(f.numero_factura, '» / «' ORDER BY f.created_at))
    FROM public.facturas_proveedor f
   WHERE f.estado <> 'anulada' AND NULLIF(regexp_replace(upper(coalesce(f.numero_factura, '')), '[^A-Z0-9]', '', 'g'), '') IS NOT NULL
   GROUP BY f.company_id, f.proveedor_id, NULLIF(regexp_replace(upper(coalesce(f.numero_factura, '')), '[^A-Z0-9]', '', 'g'), '')
  HAVING count(*) > 1
  UNION ALL
  SELECT 'duplicado', 'facturas_proveedor', string_agg(f.id::text, ', ' ORDER BY f.created_at),
         format('%s facturas vivas SIN número, del mismo proveedor, fecha %s y monto %s (pueden ser legítimas: revisar)', count(*), f.fecha_emision, f.monto_total)
    FROM public.facturas_proveedor f
   WHERE f.estado <> 'anulada' AND NULLIF(regexp_replace(upper(coalesce(f.numero_factura, '')), '[^A-Z0-9]', '', 'g'), '') IS NULL
   GROUP BY f.company_id, f.proveedor_id, f.fecha_emision, f.monto_total
  HAVING count(*) > 1
  UNION ALL
  -- ── Perfiles afectados por el control de permisos por acción ─────────────
  SELECT 'perfil_afectado', 'app_users', p.id::text,
         format('%s (empresa %s, rol %s): edita Contabilidad pero le falta %s',
                COALESCE(p.full_name, 's/nombre'), p.company_id, p.role,
                concat_ws(' y ', CASE WHEN NOT p.puede_autorizar THEN '«Autorizar / Denegar» (aprobar órdenes, facturas y órdenes de pago)' END,
                                 CASE WHEN NOT p.puede_cambiar_estado THEN '«Cambiar estado» (emitir, cancelar, registrar recepciones, anular, pagar)' END))
    FROM perfiles p
   WHERE p.puede_editar AND (NOT p.puede_autorizar OR NOT p.puede_cambiar_estado)
)
SELECT apartado, tabla, id, detalle FROM hallazgos ORDER BY apartado, tabla, id;
