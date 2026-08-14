-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD · borrar cuentas del catálogo (individual y por selección)
--
-- El catálogo solo permitía DESACTIVAR. Con la carga masiva eso se volvió un
-- problema real: un archivo mal armado deja decenas de cuentas que nadie quiere
-- ni desactivadas, y desactivar no libera el código (la unicidad es por ledger,
-- así que el código sigue ocupado y no se puede volver a cargar bien).
--
-- Borrar una cuenta es seguro SOLO si nada la referencia. Ya lo garantizan las
-- FK con ON DELETE RESTRICT (movimientos, mapeos, presupuesto, bancos, compras,
-- cuentas hijas), pero el error de Postgres que llega a la UI es ilegible
-- («violates foreign key constraint "..."») y, peor, llega DESPUÉS de intentar
-- el borrado: en una selección de 30 cuentas, una sola referencia aborta la
-- transacción entera y no se borra ninguna.
--
-- Esta migración agrega las dos piezas que faltaban:
--
--   1. `conta_cuentas_en_uso(uuid[])` — dice, ANTES de borrar, qué cuentas
--      están referenciadas y por quién. NO enumera las tablas a mano: las
--      descubre en `pg_constraint`, así que una FK nueva hacia conta_cuentas
--      (como las que trajo Compras) queda cubierta sola, sin tocar este SQL.
--
--   2. `conta_cuenta_proteger_borrado` — las cuentas del seed (`es_sistema`)
--      no se borran. Son el esqueleto que los asientos automáticos y el seed de
--      mapeos dan por hecho, y varias no tienen todavía ninguna referencia que
--      las proteja por FK: 1103 Caja chica sin movimientos se borraba sin que
--      nada se quejara, y el siguiente pago en efectivo fallaba.
--
-- Idempotente. RLS intacta.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Quién referencia a estas cuentas ─────────────────────────────────────
-- SECURITY DEFINER a propósito: una línea de póliza que la RLS del llamante no
-- deja ver IGUAL bloquea el borrado por FK. Si esto corriera con los permisos
-- del usuario, una cuenta "libre" a sus ojos fallaría al borrarse, que es
-- justamente lo que la función viene a evitar. El scope se valida a mano.
CREATE OR REPLACE FUNCTION public.conta_cuentas_en_uso(p_ids uuid[])
RETURNS TABLE (cuenta_id uuid, referencia text, usos bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Guard de alcance: solo cuentas de la empresa del llamante.
  IF NOT public.is_super_admin() THEN
    IF EXISTS (
      SELECT 1 FROM public.conta_cuentas c
      WHERE c.id = ANY(p_ids)
        AND c.company_id IS DISTINCT FROM public.get_my_company_id()
    ) THEN
      RAISE EXCEPTION 'FUERA_DE_ALCANCE: hay cuentas de otra empresa en la consulta.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- FKs que APUNTAN a conta_cuentas y bloquean el borrado. 'r' = RESTRICT,
  -- 'a' = NO ACTION (ambas rechazan); se dejan fuera CASCADE y SET NULL/DEFAULT,
  -- que resuelven solos y no impiden borrar.
  FOR r IN
    SELECT con.conrelid::regclass::text AS tabla, att.attname AS columna
    FROM pg_constraint con
    JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    WHERE con.confrelid = 'public.conta_cuentas'::regclass
      AND con.contype = 'f'
      AND con.confdeltype IN ('r', 'a')
  LOOP
    RETURN QUERY EXECUTE format(
      'SELECT t.%I::uuid, %L::text, count(*)::bigint
         FROM %s t
        WHERE t.%I = ANY($1)
        GROUP BY t.%I',
      r.columna, r.tabla, r.tabla, r.columna, r.columna
    ) USING p_ids;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuentas_en_uso(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.conta_cuentas_en_uso(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.conta_cuentas_en_uso(uuid[]) IS
  'Por cada cuenta, qué tablas la referencian con FK bloqueante (RESTRICT/NO ACTION) y cuántas veces. Las FK se descubren de pg_constraint: una tabla nueva que apunte a conta_cuentas queda cubierta sin editar esta función.';

-- ── 2. Las cuentas del seed no se borran ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_cuenta_proteger_borrado()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('conta.allow_system_write', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF OLD.es_sistema THEN
    RAISE EXCEPTION
      'CUENTA_DE_SISTEMA: "% — %" viene del catálogo base y no se borra; si no la usas, desactívala.',
      OLD.codigo, OLD.nombre
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_cuenta_proteger_borrado ON public.conta_cuentas;
CREATE TRIGGER trg_conta_cuenta_proteger_borrado
  BEFORE DELETE ON public.conta_cuentas
  FOR EACH ROW EXECUTE FUNCTION public.conta_cuenta_proteger_borrado();

COMMENT ON FUNCTION public.conta_cuenta_proteger_borrado() IS
  'Bloquea el DELETE de cuentas del seed (es_sistema). Las cuentas creadas por el usuario sí se borran, siempre que ninguna FK las referencie.';
