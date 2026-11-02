-- ════════════════════════════════════════════════════════════════════════════
-- Minutas de reunión: los participantes firman los acuerdos
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ
-- Una minuta registra acuerdos y compromisos (20261110000000), pero nada dejaba
-- constancia de que cada involucrado los aceptó. El asistente gana un cuarto
-- paso, «Firmas», y el detalle permite que firme quien no estuvo al guardar.
--
-- LO QUE HACE
--   `notas_admin.firmas jsonb NOT NULL DEFAULT '[]'` — una entrada por
--   participante que firmó:
--     { "participante_id": "<participantes[].id>", "nombre": "…",
--       "path": "<project_id>/minutas-firmas/<archivo>.png",
--       "firmado_at": "2026-11-02T15:04:05.000Z",
--       "version": "<huella de puntos y acuerdos al firmar>" }
--   La firma es un PNG en el bucket privado `condominios-media` (se guarda la
--   ruta, no una URL firmada), como las fotos y los documentos de la minuta.
--   `version` permite mostrar que alguien firmó una versión anterior si los
--   acuerdos cambiaron después. CHECK de lista, igual que participantes/puntos.
--
-- LO QUE **NO** HACE: no toca las policies de la tabla ni las del bucket
-- (20260603220000 ya acota `condominios-media` por proyecto en la primera
-- carpeta de la ruta).
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS y el CHECK se crea solo si no existe.
--
-- REVERSA: ALTER TABLE public.notas_admin DROP COLUMN firmas;
-- (arrastra el CHECK). Los archivos del bucket no se borran solos.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notas_admin
  ADD COLUMN IF NOT EXISTS firmas jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notas_admin_firmas_array') THEN
    ALTER TABLE public.notas_admin
      ADD CONSTRAINT notas_admin_firmas_array CHECK (jsonb_typeof(firmas) = 'array');
  END IF;
END;
$$;

COMMENT ON COLUMN public.notas_admin.firmas IS
  'Firmas de los participantes que aceptaron los acuerdos: [{participante_id, nombre, path, firmado_at, version}]. La imagen va en condominios-media (<project_id>/minutas-firmas/...).';
