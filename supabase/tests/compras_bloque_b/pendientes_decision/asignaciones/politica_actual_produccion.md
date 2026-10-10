# Política ACTUAL de `public.user_project_assignments` en producción (`nnsqmeigtgewatameexo`)

Consulta de SOLO LECTURA ejecutada el 2026-10-10 con `mcp__Supabase__execute_sql` (un `SELECT` sobre `pg_policy`; nada se escribió):

```sql
select polname, polcmd, polroles::regrole[]::text as roles,
       pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr
  from pg_policy where polrelid = 'public.user_project_assignments'::regclass order by polname;
```

Resultado (4 políticas, todas `TO authenticated`; `polcmd`: r = SELECT, a = INSERT, w = UPDATE, d = DELETE):

| polname | cmd | USING | WITH CHECK |
|---|---|---|---|
| `user_project_assignments_select` | r | **E** | — |
| `user_project_assignments_insert` | a | — | **E** |
| `user_project_assignments_update` | w | **E** | **E** |
| `user_project_assignments_delete` | d | **E** | — |

donde **E** es la MISMA expresión en las cuatro:

```sql
is_super_admin()
OR ((current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))
    AND (project_id IN (SELECT projects.id FROM projects WHERE (projects.company_id = get_my_company_id()))))
OR (user_id = (SELECT auth.uid() AS uid))          -- <== EL HUECO en INSERT / UPDATE / DELETE
```

Es exactamente la de `supabase/migrations/20260417000013_consolidate_rls_policies_part2.sql` (líneas 539-580): producción = repo. La última línea es razonable en SELECT (cada persona lee las suyas) pero en
INSERT / UPDATE / DELETE permite que CUALQUIER usuario autenticado, de cualquier rol, escriba filas propias sobre CUALQUIER proyecto (también de otra empresa: el `project_id` no se acota) y borre las suyas.
Como `can_access_project()` y `user_is_project_exempt()` leen esta tabla, el alcance de proyecto de todo el circuito de compras (y las políticas SELECT por proyecto) deja de ser un límite real.
