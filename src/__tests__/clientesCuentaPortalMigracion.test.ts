// Guard ESTÁTICO de 20261123000000: la RPC que le devuelve al staff qué clientes
// tienen cuenta del portal. Lo que no puede perderse en un CREATE OR REPLACE
// descuidado: que sea SECURITY DEFINER con el PUBLIC revocado, que sólo responda
// al staff (nunca a un cliente), que acote por la empresa del llamador y por el
// permiso de ver Clientes, y que no devuelva más que «existe» y «activa».
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ARCHIVO = '20261123000000_clientes_cuenta_portal_visible_para_staff.sql'
const sql = readFileSync(resolve('supabase/migrations', ARCHIVO), 'utf8')
const sinComentarios = sql.replace(/^[ \t]*--.*$/gm, '')
const fn = sinComentarios.slice(
  sinComentarios.indexOf('CREATE OR REPLACE FUNCTION public.clientes_con_cuenta_portal('),
  sinComentarios.indexOf('\n$$;'),
)

describe('20261123000000 — clientes_con_cuenta_portal', () => {
  it('es SECURITY DEFINER con search_path vacío, revoca PUBLIC y anon, y la concede a authenticated', () => {
    expect(fn).toContain('SECURITY DEFINER')
    expect(fn).toMatch(/SET search_path = ''/)
    expect(sinComentarios).toContain('REVOKE EXECUTE ON FUNCTION public.clientes_con_cuenta_portal(uuid[]) FROM PUBLIC, anon;')
    expect(sinComentarios).toContain('GRANT  EXECUTE ON FUNCTION public.clientes_con_cuenta_portal(uuid[]) TO authenticated;')
  })

  it('exige sesión, rechaza a las cuentas de cliente y limita el tamaño de la consulta', () => {
    expect(fn).toContain('IF auth.uid() IS NULL THEN')
    expect(fn).toMatch(/IF public\.current_user_role\(\) = 'cliente' THEN\s+RAISE EXCEPTION/)
    expect(fn).toContain("USING ERRCODE = 'insufficient_privilege'")
    expect(fn).toContain('> 5000 THEN')
  })

  it('acota por la empresa del llamador (company_clientes) y el permiso de ver Clientes; super_admin ve todo', () => {
    expect(fn).toContain("public.user_has_permission('platform.clientes.view')")
    expect(fn).toMatch(/cc\.company_id = public\.get_my_company_id\(\)/)
    expect(fn).toContain('public.is_super_admin()')
    expect(fn).toContain("u.role = 'cliente'")
  })

  it('sólo devuelve cliente_id y activo: ningún otro dato de la cuenta', () => {
    expect(fn).toMatch(/RETURNS TABLE \(cliente_id uuid, activo boolean\)/)
    expect(fn).toMatch(/SELECT u\.cliente_id, u\.activo\s+FROM public\.app_users u/)
    expect(fn).not.toMatch(/full_name|email/)
  })

  it('el navegador consulta la RPC y ya no lee app_users para esto', () => {
    const queries = readFileSync(resolve('src/domain/clientes/queries.ts'), 'utf8')
    expect(queries).toContain("supabase.rpc('clientes_con_cuenta_portal', { p_cliente_ids: clienteIds })")
    expect(queries).not.toMatch(/from\('app_users'\)/)
    const tipos = readFileSync(resolve('src/types/database.types.ts'), 'utf8')
    expect(tipos).toContain('      clientes_con_cuenta_portal: {')
  })
})
