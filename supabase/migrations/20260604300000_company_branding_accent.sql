-- ============================================================================
-- Color de acento de marca (white-label) — extiende company_branding (plat:P20)
-- ============================================================================
-- Banda de migración P20 (accent): 20260604300000.
--
-- #407 añadió primary_color; esto añade accent_color para completar el par de
-- colores de marca (la app usa --at-primary y --at-accent ampliamente). Mismo
-- patrón/CHECK que primary_color. Idempotente.
-- ============================================================================

ALTER TABLE public.company_branding
  ADD COLUMN IF NOT EXISTS accent_color text;

DO $$
BEGIN
  ALTER TABLE public.company_branding
    ADD CONSTRAINT company_branding_accent_hex
    CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9A-Fa-f]{6}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
