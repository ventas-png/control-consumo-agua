-- Tras aplicar 20261028000000 SOBRE el estado antiguo: converge y no pierde datos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname IN ('hk_fotos_delete', 'hk_evidencias_delete')) THEN
    RAISE EXCEPTION 'FALLO U1 quedó una policy de DELETE de la versión anterior';
  END IF;
  RAISE NOTICE 'OK    U1 las policies de DELETE de la versión anterior desaparecieron';
  IF (SELECT count(*) FROM public.servicio_housekeeping_fotos) <> 1
     OR (SELECT hallazgos_ingreso FROM public.servicios_housekeeping WHERE id = '5e000000-0000-0000-0000-0000000000a1') <> 'texto previo a la reconciliación' THEN
    RAISE EXCEPTION 'FALLO U2 se perdió la foto o el texto cargados con la versión anterior';
  END IF;
  RAISE NOTICE 'OK    U2 la foto y el texto cargados con la versión anterior siguen intactos';
  IF has_table_privilege('authenticated', 'public.servicio_housekeeping_fotos', 'DELETE') THEN
    RAISE EXCEPTION 'FALLO U3 authenticated conserva DELETE sobre la tabla';
  END IF;
  RAISE NOTICE 'OK    U3 authenticated ya no tiene DELETE sobre la tabla de fotos';
END $$;
-- Limpia el padrón de esta comprobación para que assert.sql parta de cero.
DELETE FROM public.servicios_housekeeping WHERE id = '5e000000-0000-0000-0000-0000000000a1';
DELETE FROM public.hk_limpieza_storage;
DELETE FROM public.projects WHERE id = 'a1000000-0000-0000-0000-000000000001';
DELETE FROM public.companies WHERE id = 'a0000000-0000-0000-0000-00000000000a';
