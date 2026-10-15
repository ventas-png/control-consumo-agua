\set ON_ERROR_STOP on
-- ============================================================================
-- INSTANTÁNEA del estado observable de las asignaciones: la tabla y, por persona, lo que las políticas y las funciones de alcance
-- devuelven. Se toma ANTES de aplicar la migración (psql -v tag=antes) y DESPUÉS (-v tag=despues) y assert_datos_produccion.sql
-- las compara. Sólo LEE: no cambia ninguna fila.
-- ============================================================================
CREATE TABLE IF NOT EXISTS asgt.snap_tabla (
  tag text PRIMARY KEY, filas bigint, usuarios bigint, huerfanas bigint, usuarios_huerfanos bigint,
  tipos text, por_rol text, huella_total text, huella_contrato text);
CREATE TABLE IF NOT EXISTS asgt.snap_personas (
  tag text, alias text, exento boolean, alcance text, visibles bigint, PRIMARY KEY (tag, alias));

-- filas que la persona lee a través de la política SELECT (sesión simulada, RLS aplicada)
CREATE OR REPLACE FUNCTION asgt.visibles(p_alias text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  PERFORM asgt.poner_actor(p_alias);
  SELECT count(*) INTO v FROM public.user_project_assignments;
  PERFORM asgt.poner_actor('SISTEMA');
  RETURN v;
END $$;

INSERT INTO asgt.snap_tabla
SELECT :'tag',
       (SELECT count(*) FROM public.user_project_assignments),
       (SELECT count(DISTINCT user_id) FROM public.user_project_assignments),
       (SELECT count(*) FROM public.user_project_assignments u WHERE NOT EXISTS (SELECT 1 FROM public.app_users a WHERE a.id = u.user_id)),
       (SELECT count(DISTINCT user_id) FROM public.user_project_assignments u WHERE NOT EXISTS (SELECT 1 FROM public.app_users a WHERE a.id = u.user_id)),
       (SELECT string_agg(DISTINCT permission_type, ',') FROM public.user_project_assignments),
       (SELECT string_agg(rol || ':' || filas || '/' || personas, ', ' ORDER BY rol)
          FROM (SELECT COALESCE(a.role, 'huérfana') AS rol, count(*) AS filas, count(DISTINCT u.user_id) AS personas
                  FROM public.user_project_assignments u LEFT JOIN public.app_users a ON a.id = u.user_id GROUP BY 1) t),
       asgt.huella_total(), asgt.huella_contrato();

INSERT INTO asgt.snap_personas
SELECT :'tag', i.alias, asgt.exento(i.id), asgt.alcance(i.id), asgt.visibles(i.alias)
  FROM asgt.ids i WHERE i.tipo IN ('persona', 'huerfana');
