-- Track T5 — backfill de pagos.project_id (fix de visibilidad de pagos del portal).
--
-- HALLAZGO (descubierto en #340): `PagoManualModal` (portal del residente) inserta `pagos`
-- con `project_id = null`. La RLS `pagos_select` filtra por `project_id`, así que esos pagos
-- quedan invisibles para el gestor de cobros (solo super_admin los ve). Bug de integridad de
-- datos, independiente del storage.
--
-- DERIVACIÓN (verificada en datos): NO se puede usar `clientes.project_id` (null en 65/65) ni
-- solo `registros.project_id` (null en 1951/4751 = 41%). El scoping real del módulo de agua es
-- vía el MEDIDOR: `registros.contador_id → contadores.project_id`. Validado:
--   * contador recupera 1948/1951 de los registros sin project_id (los otros 3 no tienen
--     contador → quedan null, inocuo: igual estaban null);
--   * 0 conflictos entre contador.project_id y registros.project_id cuando ambos existen.
-- Por eso: project_id := coalesce(registro.project_id, contador.project_id).
--
-- IMPLEMENTACIÓN: trigger BEFORE INSERT que rellena project_id cuando viene null (cubre el
-- modal del portal y cualquier otro path; corre incluso para inserts vía service-role). Es
-- SECURITY DEFINER porque el residente no puede leer `contadores` bajo RLS, y necesitamos
-- derivar el project siempre. Se revoca EXECUTE de PUBLIC (el trigger dispara igual) para no
-- exponerlo a anon/authenticated (advisor 0028/0029). search_path fijo (advisor 0011).
--
-- + backfill one-time de filas existentes (idempotente; hoy hay 0 pagos).
-- REVERSA: drop trigger + drop function.

create or replace function public.pagos_backfill_project_id()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.project_id is null and new.registro_id is not null then
    select coalesce(r.project_id, c.project_id)
      into new.project_id
    from public.registros r
    left join public.contadores c on c.id = r.contador_id
    where r.id = new.registro_id;
  end if;
  return new;
end;
$$;

-- El trigger dispara sin necesidad de EXECUTE; revocamos el grant a anon/authenticated/PUBLIC.
-- (Supabase concede EXECUTE a anon/authenticated por DEFAULT PRIVILEGES, no solo vía PUBLIC,
--  así que hay que revocarles explícito) → no se expone una función SECURITY DEFINER a
--  anon/authenticated (advisor 0028/0029). service_role la conserva (ya es de confianza).
revoke execute on function public.pagos_backfill_project_id() from public, anon, authenticated;

drop trigger if exists trg_pagos_backfill_project_id on public.pagos;
create trigger trg_pagos_backfill_project_id
  before insert on public.pagos
  for each row execute function public.pagos_backfill_project_id();

-- Backfill one-time de pagos existentes con project_id null (idempotente).
update public.pagos p
set project_id = sub.pid
from (
  select r.id as rid, coalesce(r.project_id, c.project_id) as pid
  from public.registros r
  left join public.contadores c on c.id = r.contador_id
) sub
where p.registro_id = sub.rid
  and p.project_id is null
  and sub.pid is not null;
