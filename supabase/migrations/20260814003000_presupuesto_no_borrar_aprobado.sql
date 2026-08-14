-- ════════════════════════════════════════════════════════════════════════════
-- PRESUPUESTO · un presupuesto aprobado o archivado no se borra
--
-- La UI gana un botón "Eliminar" para descartar un presupuesto que quedó en
-- borrador o propuesto (un año que no se llegó a aprobar, una versión armada
-- por error). Esta es la guarda que hace que esa acción sea segura: la RLS de
-- `presupuestos` deja BORRAR a company_owner/admin sin mirar el estado, así que
-- hasta hoy un DELETE directo se llevaba por delante un presupuesto vigente —
-- y con él, por CASCADE, todas sus partidas.
--
-- Eso no es reversible y rompe cosas que ya se apoyan en ese historial: el
-- comparativo presupuesto vs real, las alertas de partida excedida y el
-- versionado (aprobar archiva la versión anterior, no la borra: las
-- correcciones son una versión nueva).
--
-- Los triggers existentes NO cubrían este caso: `presupuesto_proteger` es
-- BEFORE UPDATE, y `presupuesto_proteger_partidas` no salta en el borrado en
-- cascada porque para entonces la cabecera ya no está y su estado se lee NULL.
--
-- Escape hatch idéntico al del resto del módulo: el GUC
-- `conta.allow_system_write`, que solo encienden las funciones SECURITY DEFINER
-- del sistema.
--
-- Idempotente. RLS intacta.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.presupuesto_proteger_borrado()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('conta.allow_system_write', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF OLD.estado IN ('aprobado', 'archivado') THEN
    RAISE EXCEPTION
      'PRESUPUESTO_INMUTABLE: un presupuesto % no se borra; el comparativo y las alertas se apoyan en él. Si ya no aplica, aprueba una versión nueva (la anterior se archiva sola).',
      OLD.estado
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_presupuesto_proteger_borrado ON public.presupuestos;
CREATE TRIGGER trg_presupuesto_proteger_borrado
  BEFORE DELETE ON public.presupuestos
  FOR EACH ROW EXECUTE FUNCTION public.presupuesto_proteger_borrado();

COMMENT ON FUNCTION public.presupuesto_proteger_borrado() IS
  'Bloquea el DELETE de presupuestos aprobados/archivados. Borrador y propuesto sí se eliminan (con sus partidas, por CASCADE).';
