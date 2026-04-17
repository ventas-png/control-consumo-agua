-- Fix 4 Security Advisor warnings:
-- 1. fn_set_recipient_company_id: set search_path = '' + schema-qualify tables
-- 2. company-logos bucket: restrict listing
-- 3. project-logos bucket: restrict listing
-- (Leaked Password Protection must be enabled from Auth settings)

-- 1. Fix function search_path
CREATE OR REPLACE FUNCTION public.fn_set_recipient_company_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id
    FROM public.broadcasts WHERE id = NEW.broadcast_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 2 & 3. Replace broad listing policies on logo buckets with restricted ones.
-- Public buckets serve files via CDN; RLS SELECT is only needed for
-- authenticated listing — we remove it so unauthenticated enumeration is blocked.

-- Drop any existing broad SELECT policies on storage.objects for logo buckets
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname ILIKE '%logo%'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END;
$$;

-- Allow only authenticated users to list within logo buckets
-- (CDN public access is unaffected — this only restricts Storage API listing)
CREATE POLICY "logos_authenticated_select" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id IN ('company-logos', 'project-logos'));
