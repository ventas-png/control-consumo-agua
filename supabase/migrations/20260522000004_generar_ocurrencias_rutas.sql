-- ============================================================
-- Generador de ocurrencias de rutas
-- ============================================================
-- Materializa las próximas ocurrencias (p_dias_adelante días) de cada ruta según
-- su frecuencia, y marca como 'vencida' las pendientes ya pasadas. Idempotente vía
-- UNIQUE(ruta_id, fecha). SECURITY DEFINER y SIN helpers de auth.uid() porque lo
-- ejecuta el cron (sin JWT): la empresa/proyecto se copian de la ruta.

CREATE OR REPLACE FUNCTION public.generar_ocurrencias_rutas(p_dias_adelante int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r          record;
  d          date;
  hoy        date := (now() AT TIME ZONE 'America/Guatemala')::date;
  horizonte  date;
  ini        date;
  fin        date;
  inserted   int := 0;
BEGIN
  horizonte := hoy + p_dias_adelante;

  FOR r IN
    SELECT * FROM public.rutas
    WHERE recurrencia_activa = true OR frecuencia = 'unica'
  LOOP
    -- ── Ruta de una sola vez ──────────────────────────────────────
    IF r.frecuencia = 'unica' THEN
      IF r.fecha_programada IS NOT NULL AND r.fecha_programada >= hoy THEN
        INSERT INTO public.ruta_ocurrencias (ruta_id, company_id, project_id, fecha, hora)
        VALUES (r.id, r.company_id, r.project_id, r.fecha_programada, r.hora_programada)
        ON CONFLICT (ruta_id, fecha) DO NOTHING;
        IF FOUND THEN inserted := inserted + 1; END IF;
      END IF;
      CONTINUE;
    END IF;

    ini := GREATEST(hoy, COALESCE(r.fecha_inicio, hoy));
    fin := LEAST(horizonte, COALESCE(r.fecha_fin, horizonte));

    -- ── Fechas específicas ────────────────────────────────────────
    IF r.frecuencia = 'fechas' THEN
      FOR d IN SELECT elem::date FROM jsonb_array_elements_text(r.fechas_especificas) AS elem LOOP
        IF d BETWEEN ini AND fin THEN
          INSERT INTO public.ruta_ocurrencias (ruta_id, company_id, project_id, fecha, hora)
          VALUES (r.id, r.company_id, r.project_id, d, r.hora_programada)
          ON CONFLICT (ruta_id, fecha) DO NOTHING;
          IF FOUND THEN inserted := inserted + 1; END IF;
        END IF;
      END LOOP;
      CONTINUE;
    END IF;

    -- ── Diaria / semanal / quincenal / mensual ────────────────────
    d := ini;
    WHILE d <= fin LOOP
      IF (
        r.frecuencia = 'diaria'
        OR (r.frecuencia = 'semanal'
            AND r.dias_semana @> to_jsonb(EXTRACT(ISODOW FROM d)::int))
        OR (r.frecuencia = 'quincenal'
            AND r.fecha_inicio IS NOT NULL
            AND ((d - r.fecha_inicio) % GREATEST(COALESCE(r.intervalo_dias, 14), 1)) = 0)
        OR (r.frecuencia = 'mensual'
            AND EXTRACT(DAY FROM d)::int = LEAST(
                  COALESCE(r.dia_mes, 1),
                  EXTRACT(DAY FROM (date_trunc('month', d::timestamp) + interval '1 month - 1 day'))::int
                ))
      ) THEN
        INSERT INTO public.ruta_ocurrencias (ruta_id, company_id, project_id, fecha, hora)
        VALUES (r.id, r.company_id, r.project_id, d, r.hora_programada)
        ON CONFLICT (ruta_id, fecha) DO NOTHING;
        IF FOUND THEN inserted := inserted + 1; END IF;
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;

  -- Pendientes ya pasadas → vencidas
  UPDATE public.ruta_ocurrencias
    SET estado = 'vencida'
    WHERE estado = 'pendiente' AND fecha < hoy;

  RETURN inserted;
END $$;

-- Los permisos se endurecen en 20260522000006: solo service_role (edge function)
-- y el job (definer) la invocan; no se expone a anon/authenticated vía RPC.
