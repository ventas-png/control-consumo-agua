-- Mantener contadores.project_id / company_id en sintonía con su unidad.
--
-- Contexto: se detectaron contadores cuyo project_id apuntaba a un proyecto
-- distinto al de su unidad (p.ej. importados a "Edificio SQ"/"Parajes Vermont"
-- y luego asignados a unidades de "21B+"/"Cascadas de Vista Hermosa"). Como la
-- app filtra contadores y registros por proyecto, esos medidores aparecían sin
-- historial ("sin lectura inicial") aunque tuvieran lecturas cargadas.
--
-- Este trigger fuerza el invariante: si el contador tiene unidad, su proyecto y
-- empresa son SIEMPRE los de esa unidad, sin importar la vía de escritura
-- (importación, edición, SQL manual). Si no tiene unidad, no se toca.

CREATE OR REPLACE FUNCTION public.sync_contador_project_from_unidad()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  u_project uuid;
  u_company uuid;
BEGIN
  IF NEW.unidad_id IS NOT NULL THEN
    SELECT project_id, company_id INTO u_project, u_company
    FROM unidades WHERE id = NEW.unidad_id;
    -- Solo sobrescribimos si la unidad existe y es legible; si no, dejamos NEW
    -- intacto para no romper el INSERT/UPDATE.
    IF u_project IS NOT NULL THEN
      NEW.project_id := u_project;
      NEW.company_id := u_company;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Dispara en alta y cuando cambian unidad o (intentos de cambiar) proyecto/empresa.
DROP TRIGGER IF EXISTS trg_contadores_sync_project ON public.contadores;
CREATE TRIGGER trg_contadores_sync_project
  BEFORE INSERT OR UPDATE OF unidad_id, project_id, company_id ON public.contadores
  FOR EACH ROW EXECUTE FUNCTION public.sync_contador_project_from_unidad();

-- El trigger se dispara en el DML de su tabla; no necesita exponerse como RPC
-- (consistente con el endurecimiento de funciones de trigger del proyecto).
REVOKE EXECUTE ON FUNCTION public.sync_contador_project_from_unidad() FROM public, anon, authenticated;
