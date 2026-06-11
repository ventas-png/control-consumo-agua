# Smoke local del módulo contable (ledger)

Valida las migraciones `conta_*` contra un PostgreSQL 16 local ANTES de subirlas,
sin tocar Supabase. Es el harness usado para validar las fases 1–5 del ERP y la
serie ledger (`20260612*`).

## Uso

```bash
sudo service postgresql start
sudo -u postgres createdb conta_test
sudo -u postgres psql -d conta_test -f scripts/conta-smoke/stubs.sql
# aplicar las migraciones contables en orden (2 veces: prueba de idempotencia)
for f in supabase/migrations/2026061{1,2}*.sql; do
  sudo -u postgres psql -d conta_test -v ON_ERROR_STOP=1 -f "$f"
done
```

Los stubs simulan lo mínimo del schema de la app (companies, projects, clientes,
pagos, gastos_condominio, cierres_mensuales, auth.uid()/role(), helpers RLS…)
para que las migraciones corran aisladas. Para los RPCs con guard de tenant,
redefine los helpers en tu sesión de prueba:

```sql
CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT '<company-uuid>'::uuid $$;
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT 'company_owner'::text $$;
```

## Qué smoke correr tras un cambio

- **Asientos**: trigger de negocio (insertar gasto pagado) → asiento publicado
  balanceado en el ledger del documento, en SU moneda, con SU folio.
- **Ledger**: publicar un asiento con una cuenta de otra contabilidad debe
  RECHAZARSE; la balanza con `p_project_id` NULL muestra SOLO la empresa.
- **Idempotencia**: re-aplicar la migración y re-disparar el trigger no duplica.
