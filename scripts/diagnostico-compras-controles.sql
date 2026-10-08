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
  -- ── Consistencia pago ↔ asiento (revisión adversarial: un error contable no debe quedar oculto) ──
  SELECT 'pago_sin_asiento', 'ordenes_pago', o.id::text,
         format('orden pagada (%s) sin asiento «orden_pago_pagada» vivo, en un proyecto cuya contabilidad opera', o.monto)
    FROM public.ordenes_pago o
   WHERE o.estado = 'pagada'
     AND EXISTS (SELECT 1 FROM public.conta_cuentas c WHERE c.company_id = o.company_id AND c.project_id IS NOT DISTINCT FROM o.project_id)
     AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                      WHERE a.company_id = o.company_id AND a.origen_tabla = 'ordenes_pago' AND a.origen_id = o.id
                        AND a.origen_evento = 'orden_pago_pagada' AND a.estado <> 'anulado')
  UNION ALL
  SELECT 'reverso_pendiente', 'ordenes_pago', o.id::text, 'orden de pago anulada cuyo asiento de pago sigue publicado, sin reverso'
    FROM public.ordenes_pago o
    JOIN public.conta_asientos a ON a.company_id = o.company_id AND a.origen_tabla = 'ordenes_pago' AND a.origen_id = o.id
                                AND a.origen_evento = 'orden_pago_pagada'
   WHERE o.estado = 'anulada' AND a.estado = 'publicado' AND a.anulado_por_id IS NULL
  UNION ALL
  SELECT 'reverso_pendiente', 'facturas_proveedor', f.id::text, 'factura anulada cuyo devengo sigue publicado, sin reverso'
    FROM public.facturas_proveedor f
    JOIN public.conta_asientos a ON a.company_id = f.company_id AND a.origen_tabla = 'facturas_proveedor' AND a.origen_id = f.id
                                AND a.origen_evento = 'factura_prov_aprobada'
   WHERE f.estado = 'anulada' AND a.estado = 'publicado' AND a.anulado_por_id IS NULL
  UNION ALL
  SELECT 'reverso_pendiente', 'recepciones', r.id::text, 'recepción anulada cuyo asiento sigue publicado, sin reverso'
    FROM public.recepciones r
    JOIN public.conta_asientos a ON a.company_id = r.company_id AND a.origen_tabla = 'recepciones' AND a.origen_id = r.id
   WHERE r.estado = 'anulada' AND a.estado = 'publicado' AND a.anulado_por_id IS NULL
  UNION ALL
  -- ── Contraseñas de pago incoherentes ──────────────────────────────────────
  SELECT 'contrasena_inconsistente', 'contrasenas_pago', c.id::text,
         format('total %s distinto de la suma de sus partidas (%s)', c.total,
                COALESCE((SELECT SUM(cf.monto) FROM public.contrasena_pago_facturas cf WHERE cf.contrasena_id = c.id), 0))
    FROM public.contrasenas_pago c
   WHERE c.estado <> 'anulada'
     AND round(c.total, 2) <> round(COALESCE((SELECT SUM(cf.monto) FROM public.contrasena_pago_facturas cf WHERE cf.contrasena_id = c.id), 0), 2)
  UNION ALL
  SELECT 'contrasena_inconsistente', 'ordenes_pago', o.id::text, 'orden de pago de otro proveedor o de otro proyecto que su contraseña'
    FROM public.ordenes_pago o JOIN public.contrasenas_pago c ON c.id = o.contrasena_pago_id
   WHERE o.proveedor_id <> c.proveedor_id OR o.project_id IS DISTINCT FROM c.project_id
  UNION ALL
  SELECT 'contrasena_inconsistente', 'contrasenas_pago', o.contrasena_pago_id::text,
         format('%s órdenes de pago vivas sobre la misma contraseña', count(*))
    FROM public.ordenes_pago o
   WHERE o.contrasena_pago_id IS NOT NULL AND o.estado <> 'anulada'
   GROUP BY o.contrasena_pago_id HAVING count(*) > 1
  UNION ALL
  -- ── Documentos que perdieron su vínculo o su respaldo ─────────────────────
  SELECT 'documento_desvinculado', 'facturas_proveedor', f.id::text, 'factura aprobada/pagada sin orden, pero con renglones ligados a renglones de una orden'
    FROM public.facturas_proveedor f
   WHERE f.estado IN ('aprobada', 'pagada_parcial', 'pagada') AND f.orden_compra_id IS NULL
     AND EXISTS (SELECT 1 FROM public.factura_proveedor_lineas l WHERE l.factura_id = f.id AND l.orden_compra_linea_id IS NOT NULL)
  UNION ALL
  SELECT 'acumulado_sin_respaldo', 'orden_compra_lineas', l.id::text,
         format('recibido %s contra %s en recepciones registradas', l.cantidad_recibida,
                COALESCE((SELECT SUM(rl.cantidad) FROM public.recepcion_lineas rl JOIN public.recepciones r ON r.id = rl.recepcion_id
                           WHERE rl.orden_compra_linea_id = l.id AND r.estado = 'registrada'), 0))
    FROM public.orden_compra_lineas l
   WHERE round(l.cantidad_recibida, 4) <> round(COALESCE((SELECT SUM(rl.cantidad) FROM public.recepcion_lineas rl JOIN public.recepciones r ON r.id = rl.recepcion_id
                                                          WHERE rl.orden_compra_linea_id = l.id AND r.estado = 'registrada'), 0), 4)
  UNION ALL
  SELECT 'acumulado_sin_respaldo', 'orden_compra_lineas', l.id::text,
         format('facturado %s contra %s en facturas aprobadas o pagadas', l.cantidad_facturada,
                COALESCE((SELECT SUM(fl.cantidad) FROM public.factura_proveedor_lineas fl JOIN public.facturas_proveedor f ON f.id = fl.factura_id
                           WHERE fl.orden_compra_linea_id = l.id AND f.estado IN ('aprobada', 'pagada_parcial', 'pagada')), 0))
    FROM public.orden_compra_lineas l
   WHERE round(l.cantidad_facturada, 4) <> round(COALESCE((SELECT SUM(fl.cantidad) FROM public.factura_proveedor_lineas fl JOIN public.facturas_proveedor f ON f.id = fl.factura_id
                                                           WHERE fl.orden_compra_linea_id = l.id AND f.estado IN ('aprobada', 'pagada_parcial', 'pagada')), 0), 4)
  UNION ALL
  SELECT 'orden_incoherente', 'ordenes_compra', o.id::text,
         format('orden %s sin proveedor del catálogo (proveedor_id vacío)', COALESCE(o.numero, o.id::text))
    FROM public.ordenes_compra o
   WHERE o.proveedor_id IS NULL AND o.estado NOT IN ('borrador', 'cancelada')
  UNION ALL
  SELECT 'orden_incoherente', 'ordenes_compra', o.id::text,
         format('total %s distinto de la suma de sus renglones (%s)', o.total, COALESCE((SELECT SUM(l.total) FROM public.orden_compra_lineas l WHERE l.orden_compra_id = o.id), 0))
    FROM public.ordenes_compra o
   WHERE o.estado NOT IN ('borrador', 'cancelada')
     AND round(o.total, 2) <> round(COALESCE((SELECT SUM(l.total) FROM public.orden_compra_lineas l WHERE l.orden_compra_id = o.id), 0), 2)
  UNION ALL
  -- ── Separación solicitante / aprobador ────────────────────────────────────
  SELECT 'autoaprobacion', 'ordenes_compra', o.id::text,
         format('orden %s aprobada por quien la creó, en una empresa con la separación solicitante/aprobador activa', COALESCE(o.numero, o.id::text))
    FROM public.ordenes_compra o JOIN public.compras_config cfg ON cfg.company_id = o.company_id AND cfg.aprobacion_separada
   WHERE o.aprobada_por IS NOT NULL AND o.created_by = o.aprobada_por
  UNION ALL
  SELECT 'configuracion', 'compras_config', NULL,
         format('%s empresa(s) con la separación solicitante/aprobador ACTIVA y %s con ella apagada (de %s con configuración de compras)',
                count(*) FILTER (WHERE aprobacion_separada), count(*) FILTER (WHERE NOT aprobacion_separada), count(*))
    FROM public.compras_config
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
