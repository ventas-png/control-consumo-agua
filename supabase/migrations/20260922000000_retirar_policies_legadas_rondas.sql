-- ════════════════════════════════════════════════════════════════════════════
-- Retirar las dos policies legadas que anulaban el gate RBAC de las rondas
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ PASA. `20260424000059` creó, junto con las tablas, dos policies que
-- NINGUNA migración posterior eliminó:
--
--   company_rw_puntos_control  ON puntos_control_ruta
--   company_rw_visitas_control ON visitas_control
--
-- Ninguna lleva cláusula `FOR`, así que son **FOR ALL**; ninguna lleva `TO`,
-- así que son **TO PUBLIC**; y son **PERMISSIVE**, que es el default. Una
-- policy permisiva se une con OR a las demás del mismo comando.
--
-- POR QUÉ IMPORTA. `20260519000002` declaró para estas dos tablas el gate RBAC
-- real —select/insert/update exigen `user_has_permission('condominios.tab.
-- rutas_ronda')`, y delete exige company_owner o admin—, pero las legadas
-- siguieron ahí, y su condición es SÓLO la pertenencia a la empresa. El OR las
-- vuelve la puerta ancha por la que se entra sin pasar por la estrecha:
--
--   · leer y escribir paradas y visitas SIN el permiso del tab;
--   · BORRARLAS sin ser company_owner ni admin.
--
-- POR QUÉ EL LOOP NO LAS AGARRÓ. El bloque que retira policies viejas en
-- `20260519000002` recorre las tablas del "Grupo A" y dropea por nombre
-- `<tabla>_select`, `<tabla>_insert`… Estas dos tablas están en el "Grupo C"
-- (las que no tienen company_id propio y derivan el inquilino del padre) y sus
-- policies legadas se llaman distinto, así que sobrevivieron al barrido.
--
-- ES EXACTAMENTE EL MISMO CASO, POR TERCERA VEZ. Ya pasó con
-- `company_rw_areas` (retirada en 20260904000100) y con
-- `company_rw_plantillas_cargo` (retirada en 20260904000200), las dos con este
-- mismo argumento. Esta migración cierra las dos que quedaban.
--
-- QUÉ LADO GANA, Y POR QUÉ NO SE PRESUME
-- Producción NO tiene estas policies: allá viven sólo las cuatro de RBAC, con
-- sus puertas intactas (medido contra el catálogo real). O sea que el riesgo no
-- está vivo en producción — está en lo que el REPOSITORIO describe, y eso
-- importa igual: todo lo que se verifica contra el repositorio (los arneses de
-- RLS, las reconstrucciones del auditor) estaba midiendo un mundo más laxo que
-- el real. Gana producción, que además es el lado estricto.
--
-- Con esto, `tabla:puntos_control_ruta/policies` y `tabla:visitas_control/
-- policies` pasan a coincidir con producción y salen de `drift-conocido.json`,
-- que baja de 87 a 85 grupos.
--
-- NO-OP SOBRE PRODUCCIÓN: las policies no existen allá, y `DROP POLICY IF
-- EXISTS` no escribe nada. Lo que cambia es la reconstrucción.
--
-- NO TOCA LAS CUATRO POLICIES DE RBAC. No se redeclaran: ya están bien en los
-- dos lados, y recrearlas sólo agregaría superficie para equivocarse.
--
-- REVERSA (reabriría el agujero; sólo por completitud):
--   CREATE POLICY "company_rw_puntos_control" ON public.puntos_control_ruta
--     USING (EXISTS (SELECT 1 FROM public.rutas_ronda r
--                     WHERE r.id = ruta_id AND r.company_id = public.get_my_company_id()))
--     WITH CHECK (…lo mismo…);
--   CREATE POLICY "company_rw_visitas_control" ON public.visitas_control
--     USING (EXISTS (SELECT 1 FROM public.rondas_seguridad rs
--                     WHERE rs.id = ronda_id AND rs.company_id = public.get_my_company_id()))
--     WITH CHECK (…lo mismo…);
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "company_rw_puntos_control"  ON public.puntos_control_ruta;
DROP POLICY IF EXISTS "company_rw_visitas_control" ON public.visitas_control;

-- ────────────────────────────────────────────────────────────────────────────
-- Postcondición: quedan exactamente las cuatro de RBAC, y ninguna permisiva de
-- más
-- ────────────────────────────────────────────────────────────────────────────
-- Un DROP que no encuentra la policy no es error para Postgres, así que sin
-- esta guarda un renombre aguas arriba pasaría en verde dejando el agujero
-- abierto. Y se comprueba el RESULTADO —qué policies quedan— y no sólo que las
-- dos se hayan ido: es lo que de verdad decide quién puede hacer qué.
DO $$
DECLARE
  r        record;
  sobrante text;
  faltante text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('puntos_control_ruta'), ('visitas_control')
    ) AS t(tabla)
  LOOP
    SELECT string_agg(p.policyname, ', ' ORDER BY p.policyname) INTO sobrante
    FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = r.tabla
      AND p.policyname NOT IN (r.tabla || '_select', r.tabla || '_insert',
                               r.tabla || '_update', r.tabla || '_delete');

    IF sobrante IS NOT NULL THEN
      RAISE EXCEPTION
        'POLICIES_RONDAS: % conserva policies fuera del gate RBAC: %. '
        'Una permisiva de más se une con OR y vuelve opcional el permiso del tab.',
        r.tabla, sobrante;
    END IF;

    SELECT string_agg(esperada, ', ' ORDER BY esperada) INTO faltante
    FROM unnest(ARRAY[r.tabla || '_select', r.tabla || '_insert',
                      r.tabla || '_update', r.tabla || '_delete']) AS esperada
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = r.tabla
        AND p.policyname = esperada
    );

    IF faltante IS NOT NULL THEN
      RAISE EXCEPTION
        'POLICIES_RONDAS: a % le faltan policies del gate RBAC: %. '
        'Retirar la legada sin que el gate esté puesto deja la tabla sin lectura ni escritura.',
        r.tabla, faltante;
    END IF;
  END LOOP;

  RAISE NOTICE
    'POLICIES_RONDAS: las dos policies legadas ya no están; quedan las 4 de RBAC por tabla.';
END;
$$;
