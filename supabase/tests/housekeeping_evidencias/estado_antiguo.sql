-- Estado que dejó la versión ANTERIOR de la migración (la del preview branch de #927):
-- policies viejas, y una foto cargada con ellas.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'servicio_housekeeping_fotos') <> 3
     OR (SELECT count(*) FROM pg_policies WHERE tablename = 'objects' AND policyname = 'hk_evidencias_delete') <> 1 THEN
    RAISE EXCEPTION 'la versión anterior no dejó el estado esperado (3 policies en la tabla y la de DELETE en el bucket)';
  END IF;
END $$;
-- Un servicio con una foto, tal como lo habría dejado el código viejo.
INSERT INTO public.companies (id, nombre) VALUES ('a0000000-0000-0000-0000-00000000000a', 'Empresa A');
INSERT INTO public.projects (id, company_id, nombre) VALUES ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'P1');
INSERT INTO public.servicios_housekeeping (id, company_id, project_id, estado, hallazgos_ingreso)
  VALUES ('5e000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'completado', 'texto previo a la reconciliación');
INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path)
  VALUES ('5e000000-0000-0000-0000-0000000000a1', 'ingreso', 'a1000000-0000-0000-0000-000000000001/5e000000-0000-0000-0000-0000000000a1/vieja.jpg');
