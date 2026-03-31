-- Enforce uniqueness of cui_dui to prevent duplicate cliente records.
-- The CUI/DPI is a national ID — one person, one record.
--
-- Step 1: Delete known orphaned duplicate (no linked data, puede_crear_cuenta=false)
DELETE FROM clientes WHERE id = 'dca91973-9016-42e7-8d4e-01a8f8a985c6';

-- Step 2: Partial unique index — applies only to non-null cui_dui values,
-- allowing clients that haven't provided their ID yet.
CREATE UNIQUE INDEX IF NOT EXISTS clientes_cui_dui_unique
  ON clientes (cui_dui)
  WHERE cui_dui IS NOT NULL;
