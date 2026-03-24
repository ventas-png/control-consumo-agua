-- Add max_units column to companies
-- Controls the total number of units (apartments, houses, etc.) a company can create across all its projects
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS max_units integer NOT NULL DEFAULT 50;
