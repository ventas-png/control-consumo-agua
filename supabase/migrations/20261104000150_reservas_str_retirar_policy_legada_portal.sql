-- ════════════════════════════════════════════════════════════════════════════
-- Retirar la policy legada `str_cliente_portal` de reservas_str
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ PASA. `20260514000004` reemplazó la policy FOR ALL `str_cliente_portal`
-- por cuatro policies por comando (str_cliente_portal_select/insert/update/
-- delete). Dos migraciones después, `20260514000006` la volvió a crear con el
-- mismo nombre y FOR ALL. `20260519000003` consolidó la rama del residente
-- dentro de reservas_str_select/insert/update/delete y retiró las cuatro por
-- comando, pero no la FOR ALL, que sobrevivió.
--
-- POR QUÉ IMPORTA. Su WITH CHECK compara las columnas sin calificar:
--
--     WHERE s.cliente_id = get_my_cliente_id()
--       AND s.unidad_id  = unidad_id      -- se resuelve a s.unidad_id
--       AND s.company_id = company_id     -- se resuelve a s.company_id
--
-- Dentro del subquery, `unidad_id` y `company_id` son columnas de
-- solicitud_renta_unidad, así que Postgres guarda `s.unidad_id = s.unidad_id`:
-- una tautología. Para un INSERT la policy pide sólo que el cliente tenga
-- ALGUNA renta corta aprobada, en cualquier unidad. Como es permisiva, se une
-- con OR a reservas_str_insert: un residente con una renta corta aprobada da
-- de alta reservas en la unidad de otra empresa. (Mover la suya allí con un
-- UPDATE no pasa: la fila nueva tiene que verse por las policies de SELECT, y
-- ésas sí califican la unidad.)
--
-- QUÉ LADO GANA. Producción NO tiene esta policy: allá viven las cuatro de
-- 20260519000003 (la reconstrucción sin ella hashea b1726f22…:4, que es
-- exactamente lo que registra huella-produccion.json). El riesgo no está vivo
-- en producción, sino en lo que el REPOSITORIO describe: los arneses de RLS,
-- los previews y las reconstrucciones del auditor miden una tabla más laxa que
-- la real. Gana producción, que además es el lado estricto. Es el mismo caso
-- que `20260922000000` (rondas).
--
-- Con esto, `tabla:reservas_str/policies` coincide con producción y sale de
-- drift-conocido.json. También es el paso previo para que la sección de
-- «escribir exige la ACCIÓN del tab» reescriba estas policies: con el drift
-- declarado, el auditor lo marcaría como CAMBIO AMBIGUO.
--
-- NO QUITA NADA LEGÍTIMO. Todo lo que la FOR ALL permitía al residente sobre
-- SU unidad (ver, crear, editar y borrar sus reservas) ya lo dan las ramas
-- `cliente` de reservas_str_select/insert/update/delete, con la unidad bien
-- calificada (`s.unidad_id = reservas_str.unidad_id`). Lo prueba
-- supabase/tests/reservas_str_portal/run.mjs, contra la cadena completa.
--
-- NO-OP SOBRE PRODUCCIÓN: `DROP POLICY IF EXISTS` no escribe nada si la policy
-- no existe. No se redeclaran las otras cuatro: están bien en los dos lados.
--
-- REVERSA (reabriría el agujero; sólo por completitud): el CREATE POLICY
-- "str_cliente_portal" de 20260514000006.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "str_cliente_portal" ON public.reservas_str;

-- ────────────────────────────────────────────────────────────────────────────
-- Postcondición: quedan exactamente las cuatro por comando, y ninguna de más
-- ────────────────────────────────────────────────────────────────────────────
-- Un DROP que no encuentra la policy no es error para Postgres. Se comprueba el
-- RESULTADO: ni una permisiva de más (reabriría el OR), ni una de menos (la
-- tabla quedaría sin lectura o sin escritura).
DO $$
DECLARE
  sobrante text;
  faltante text;
BEGIN
  SELECT string_agg(p.policyname, ', ' ORDER BY p.policyname) INTO sobrante
  FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename = 'reservas_str'
    AND p.policyname NOT IN ('reservas_str_select', 'reservas_str_insert',
                             'reservas_str_update', 'reservas_str_delete');
  IF sobrante IS NOT NULL THEN
    RAISE EXCEPTION
      'RESERVAS_STR: conserva policies fuera de las cuatro por comando: %. '
      'Una permisiva de más se une con OR a las demás.', sobrante;
  END IF;

  SELECT string_agg(esperada, ', ' ORDER BY esperada) INTO faltante
  FROM unnest(ARRAY['reservas_str_select', 'reservas_str_insert',
                    'reservas_str_update', 'reservas_str_delete']) AS esperada
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'reservas_str'
      AND p.policyname = esperada
  );
  IF faltante IS NOT NULL THEN
    RAISE EXCEPTION
      'RESERVAS_STR: faltan policies por comando: %. Retirar la legada sin '
      'ellas deja la tabla sin lectura o sin escritura.', faltante;
  END IF;
END;
$$;
