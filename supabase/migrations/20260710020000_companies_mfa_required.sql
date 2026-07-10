-- P0 #10 (auditoría 2026-07-10) — MFA exigible por empresa.
--
-- El TOTP existe pero es opt-in puro: nada obliga a enrolarlo, así que un
-- company_owner con acceso a cobros (o cualquier staff) puede operar solo con
-- contraseña. Este flag permite EXIGIR 2FA a nivel empresa: cuando está en true,
-- el front bloquea el shell hasta que el usuario enrole+verifique TOTP.
--
-- Off por default → cero impacto en las empresas que no lo activen. Lo lee
-- buildSessionFromSupabase (junto a servicio_agua/condominios) y lo expone en
-- UserSession.mfa_required; el enforcement vive en el cliente (MfaGate).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.mfa_required IS
  'Si true, todos los usuarios de la empresa deben tener 2FA (TOTP) verificado para operar; el front bloquea el shell hasta enrolar (P0 #10).';
