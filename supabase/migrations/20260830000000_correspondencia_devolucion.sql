-- ============================================================
-- Correspondencia: devolución al remitente
-- ============================================================
-- Fase 2 de la convergencia (20260828000300 → 20260829000600 → esta).
--
-- Paquetería siempre tuvo 'devuelto' para la pieza que sale de custodia sin
-- llegar a su destinatario. Correspondencia no: una carta cuyo destinatario ya
-- no vive en el condominio, o una notificación que el residente se niega a
-- recibir, solo podía cerrarse como 'atendido' (mentira: nadie la atendió) o
-- 'archivado' (ambiguo: no dice que volvió al remitente). En una notificación
-- legal esa diferencia importa — la devolución es parte del acto.
--
-- Se amplía el vocabulario de estados de la clase 'correspondencia'. El resto
-- del CHECK queda idéntico a 20260829000600, incluido el NOT VALID: la tabla
-- arrastra doce meses de filas anteriores a cualquier CHECK de estado y
-- validarlas es un paso aparte, después de auditarlas en producción.
ALTER TABLE public.paquetes_recibidos DROP CONSTRAINT IF EXISTS paquetes_estado_chk;
ALTER TABLE public.paquetes_recibidos
  ADD CONSTRAINT paquetes_estado_chk CHECK (
    CASE clase
      WHEN 'paquete'        THEN estado IN ('pendiente','entregado','devuelto')
      WHEN 'correspondencia' THEN estado IN ('pendiente','atendido','archivado','devuelto')
      ELSE false
    END
  ) NOT VALID;

COMMENT ON COLUMN public.paquetes_recibidos.estado IS
  'Vocabulario según clase. paquete: pendiente|entregado|devuelto. correspondencia: pendiente|atendido|archivado|devuelto.';
