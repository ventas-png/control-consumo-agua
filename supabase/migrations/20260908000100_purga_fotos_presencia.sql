-- ════════════════════════════════════════════════════════════════════════════
-- Las fotos de fichaje también caducan: un año, y el GPS con ellas
-- ════════════════════════════════════════════════════════════════════════════
-- 20260908000000 creó `presencia-evidencias`: una foto por cada entrada y cada
-- salida de cada empleado, con su ubicación en `presencia_personal.gps_entrada`
-- y `gps_salida`. Nació sin plazo, y eso lo dejaba como el único dato del
-- sistema que se acumula para siempre — justo el más sensible que guarda: una
-- serie temporal de la cara y la posición de cada trabajador.
--
-- La retención de fotos ya existía para las lecturas de agua (20260723000000,
-- 90 días): `run_purga_fotos_storage()` la dispara por pg_cron → pg_net contra
-- la edge function `purgar-fotos-registros`, que borra los objetos y anula la
-- columna. Esta migración NO inventa una segunda mecánica: le pasa a la que ya
-- hay los dos plazos, y la edge function barre los dos buckets.
--
-- EL PLAZO — 365 días. La evidencia sirve para resolver un marcaje discutido, y
-- eso se discute dentro del ciclo laboral: la planilla del año, el aguinaldo y
-- el bono 14. Un año cubre esa ventana entera con margen. Pasada, la foto ya no
-- contesta ninguna pregunta abierta y solo queda el rastro. (Si el asesor
-- laboral pide alinearlo con el plazo de prescripción de reclamos, el número
-- vive en un solo sitio y se cambia aquí.)
--
-- EL GPS CADUCA CON LA FOTO, y es una decisión, no un descuido: es el mismo
-- dato —dónde estuvo una persona identificada, a qué hora— y sin la foto ya no
-- sirve para lo único que justificaba guardarlo. Dejarlo sobrevivir lo
-- convertiría en el rastro de ubicación más longevo del producto.
--
-- LA FILA NO SE BORRA. Se anulan `foto_entrada`, `foto_salida`, `gps_entrada` y
-- `gps_salida`. La hora, el estado y las horas trabajadas son dato de planilla:
-- purgar la prueba de un marcaje no es borrar el marcaje.
--
-- POR QUÉ NO UNA FUNCIÓN HERMANA. Habría necesitado su propio secreto de URL en
-- el Vault, y los de 20260723000000 TODAVÍA NO ESTÁN CREADOS (ver
-- docs/PURGA_FOTOS_SCHEDULE.md, «Lo único que falta»). Una segunda función
-- significaba un segundo paso manual pendiente, y por tanto una segunda purga
-- que no corre. Extendiendo la que ya está, el día que se creen esos dos
-- secretos empiezan a correr las dos.
--
-- SIN CRON NUEVO: `purgar_fotos_storage_monthly` ('30 3 1 * *') ya llama a esta
-- función y sigue llamándola igual.
--
-- REVERSIÓN — volver al body anterior:
--   body := jsonb_build_object('mode', 'batch')
--   (y redesplegar la edge function desde 20260723000000).
--
-- Idempotente: CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.run_purga_fotos_storage()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'purga_fotos_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'purga_fotos_service_key';

  -- Sin los secretos es un no-op seguro, igual que desde 20260723000000: la
  -- migración se puede aplicar antes de configurarlos y el cron no revienta.
  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      -- Los plazos viajan EXPLÍCITOS aunque la edge function tenga los mismos
      -- por defecto: así la política de retención se lee en la base —donde vive
      -- el dato— y no solo en el código desplegado. Si alguien cambia uno de los
      -- dos números, esta función es el sitio donde se ve.
      body    := jsonb_build_object(
        'mode',           'batch',
        'dias_registros', 90,
        'dias_presencia', 365
      )
    );
  END IF;
END $$;

COMMENT ON FUNCTION public.run_purga_fotos_storage() IS
  'Dispara la purga por retención de las fotos en buckets privados (pg_cron → pg_net → edge function purgar-fotos-registros): registro-fotos a 90 días y presencia-evidencias a 365, este último junto con el GPS del marcaje. La fila nunca se borra: se anulan solo las columnas de la evidencia. No-op seguro si faltan los secretos del Vault.';

REVOKE EXECUTE ON FUNCTION public.run_purga_fotos_storage() FROM PUBLIC, anon, authenticated;
