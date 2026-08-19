import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS del bucket de evidencias y del acuse (20260831000000).
//
// ALCANCE Y LÍMITE. Esto lee el SQL del repo; la verificación CONDUCTUAL —quién
// puede leer, sustituir y borrar la firma de acuse del vecino— vive en
// scripts/rls-evidencias-sandbox.sh y corre contra un Postgres real. Lo de aquí
// es lo que aquello no puede ver: que la regla siga ESCRITA como debe y que
// nadie devuelva las evidencias al bucket permisivo del que salieron.

const MIGRATIONS_DIR = resolve('supabase/migrations')
const MIGRACION = '20260831000000_recepcion_evidencias_y_acuse.sql'
const BUCKET = 'recepcion-evidencias'
const sql = readFileSync(join(MIGRATIONS_DIR, MIGRACION), 'utf8')

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
function soloCodigo(texto: string): string {
  return texto.replace(/--[^\n]*/g, '')
}

/** Cuerpo de una policy de storage.objects por nombre, o null si no existe. */
function policy(nombre: string): string | null {
  const re = new RegExp(
    `CREATE\\s+POLICY\\s+"${nombre}"\\s+ON\\s+storage\\.objects([\\s\\S]*?);\\s*\\n`, 'i',
  )
  return sql.match(re)?.[1] ?? null
}

describe('bucket de evidencias de recepción', () => {
  it('es privado y solo acepta imágenes', () => {
    const codigo = soloCodigo(sql)
    expect(codigo).toMatch(new RegExp(`INSERT INTO storage\\.buckets[\\s\\S]*'${BUCKET}'`))
    // `public` en false tanto al crear como al re-aplicar: un bucket público
    // haría irrelevantes las cuatro policies de abajo.
    expect(codigo).toMatch(/'recepcion-evidencias',\s*false/)
    expect(codigo).toMatch(/ON CONFLICT \(id\) DO UPDATE[\s\S]*SET public = false/)
    expect(codigo).toMatch(/allowed_mime_types[\s\S]*image\/jpeg/)
  })

  it('las evidencias NO se quedan en condominios-media', () => {
    // El bucket viejo autoriza por proyecto (20260603220000 / 20260822020000):
    // allí cualquier residente del condominio podía leer y borrar la firma de
    // acuse de su vecino. Si alguien vuelve a apuntar el uploader ahí, esto lo
    // dice.
    const tab = readFileSync(resolve('src/components/condominios/tabs/CorrespondenciaCondTab.tsx'), 'utf8')
    expect(tab).toContain('BUCKET_EVIDENCIAS')
    expect(tab).not.toMatch(/uploadCondominiosMedia/)
    const portal = readFileSync(resolve('src/components/condominios/tabs/PortalCorrespondenciaTab.tsx'), 'utf8')
    expect(portal).toContain('BUCKET_EVIDENCIAS')
  })

  it('esta migración NO toca la de storage ya fusionada', () => {
    // 20260822020000 es historia: reescribirla no la re-aplicaría en el preview
    // (el bot solo empuja archivos nuevos) y sí rompería el histórico.
    expect(soloCodigo(sql)).not.toMatch(/cond_media_(select|insert|update|delete)/)
  })
})

describe('policies del bucket', () => {
  it('SELECT resuelve el permiso por la PIEZA, no por el proyecto', () => {
    const cuerpo = policy('recepcion_evidencias_select')
    expect(cuerpo, 'falta la policy de SELECT').toBeTruthy()
    // Se ancla a paquetes_recibidos por la segunda carpeta de la ruta.
    expect(cuerpo!).toMatch(/FROM public\.paquetes_recibidos p/)
    expect(cuerpo!).toMatch(/p\.id::text = \(storage\.foldername\(name\)\)\[2\]/)
    // Personal: empresa + proyecto + permiso DE LA CLASE.
    expect(cuerpo!).toMatch(/p\.company_id = public\.get_my_company_id\(\)/)
    expect(cuerpo!).toMatch(/public\.can_access_project\(p\.project_id\)/)
    expect(cuerpo!).toMatch(/CASE p\.clase[\s\S]*condominios\.tab\.correspondencia/)
    expect(cuerpo!).toMatch(/condominios\.tab\.paqueteria/)
  })

  it('el residente solo ve lo dirigido a UNA DE SUS unidades', () => {
    const cuerpo = policy('recepcion_evidencias_select')!
    expect(cuerpo).toMatch(/p\.destinatario_tipo = 'unidad'/)
    expect(cuerpo).toMatch(/p\.unidad_id IN \(SELECT public\.mis_unidades_ids\(\)\)/)
    // Y nunca por proyecto a secas, que era justo el agujero del bucket viejo.
    expect(cuerpo).not.toMatch(/mis_proyectos_ids/)
  })

  it('subir exige el permiso y un proyecto de la propia empresa', () => {
    const cuerpo = policy('recepcion_evidencias_insert')!
    expect(cuerpo).toMatch(/public\.user_has_permission\('condominios\.tab\.correspondencia'\)/)
    expect(cuerpo).toMatch(/FROM public\.projects pr[\s\S]*pr\.company_id = public\.get_my_company_id\(\)/)
    // Y que el id de pieza de la ruta no sea de otro tenant.
    expect(cuerpo).toMatch(/NOT public\.recepcion_pieza_es_ajena\(/)
  })

  it('NO existe policy de UPDATE: una firma no se sustituye', () => {
    // Deliberado. Si alguien añade una, este test lo obliga a justificarlo.
    expect(policy('recepcion_evidencias_update')).toBeNull()
    expect(soloCodigo(sql)).not.toMatch(/CREATE POLICY "recepcion_evidencias_update"/)
  })

  it('DELETE reparte igual que la pieza: correspondencia solo company_owner', () => {
    const cuerpo = policy('recepcion_evidencias_delete')!
    expect(cuerpo).toMatch(/WHEN 'correspondencia' THEN public\.current_user_role\(\) = 'company_owner'/)
    expect(cuerpo).toMatch(/ELSE public\.current_user_role\(\) = ANY\(ARRAY\['company_owner','admin'\]\)/)
    // El borrador propio (pieza aún inexistente) es la única excepción, y está
    // acotada al dueño del objeto.
    expect(cuerpo).toMatch(/owner = \(SELECT auth\.uid\(\)\)/)
    expect(cuerpo).toMatch(/NOT public\.recepcion_pieza_existe\(/)
    // El residente no entra por ninguna rama.
    expect(cuerpo).not.toMatch(/mis_unidades_ids/)
  })
})

describe('acuse de entrega', () => {
  it('una correspondencia no queda entregada sin nombre ni hora', () => {
    const codigo = soloCodigo(sql)
    expect(codigo).toMatch(/ADD CONSTRAINT paquetes_correspondencia_acuse_chk CHECK/)
    expect(codigo).toMatch(/entregado_a_nombre IS NOT NULL/)
    expect(codigo).toMatch(/btrim\(entregado_a_nombre\) <> ''/)
    expect(codigo).toMatch(/hora_entrega IS NOT NULL/)
    // VALIDADA, no NOT VALID: una constraint sin validar no protegería de un
    // UPDATE sobre una fila vieja, que es justo el caso que hay que cerrar.
    expect(codigo).not.toMatch(/paquetes_correspondencia_acuse_chk[\s\S]{0,400}NOT VALID/)
  })

  it('las filas históricas se rellenan ANTES de añadir la constraint', () => {
    const posBackfill = sql.indexOf("SET entregado_a_nombre = COALESCE(")
    const posConstraint = sql.indexOf('ADD CONSTRAINT paquetes_correspondencia_acuse_chk')
    expect(posBackfill).toBeGreaterThan(-1)
    expect(posConstraint).toBeGreaterThan(posBackfill)
    // Y se marcan como lo que son, sin inventarle un receptor a nadie.
    expect(sql).toMatch(/No registrado \(acuse anterior a 2026-08-31\)/)
  })

  it('la RPC valida clase, estado, autorización y nombre', () => {
    const cuerpo = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.correspondencia_registrar_acuse'))
    expect(cuerpo).toMatch(/El nombre de quien recibe es obligatorio/)
    expect(cuerpo).toMatch(/v_pieza\.clase <> 'correspondencia'/)
    expect(cuerpo).toMatch(/v_pieza\.estado <> 'pendiente'/)
    expect(cuerpo).toMatch(/user_has_permission\('condominios\.tab\.correspondencia'\)/)
    expect(cuerpo).toMatch(/can_access_project\(v_pieza\.project_id\)/)
    // FOR UPDATE: dos operadores entregando a la vez se serializan.
    expect(cuerpo).toMatch(/FOR UPDATE/)
    expect(cuerpo).toMatch(/entregado_por\s*=\s*auth\.uid\(\)/)
  })

  it('la UI ya no cierra la custodia con un UPDATE pelado', () => {
    const tab = readFileSync(resolve('src/components/condominios/tabs/CorrespondenciaCondTab.tsx'), 'utf8')
    expect(tab).toContain('registrarAcuseCorrespondencia')
    // 'atendido' no puede aparecer en ningún patch de la pestaña.
    expect(tab).not.toMatch(/estado:\s*'atendido'/)
  })
})

describe('funciones nuevas: SECURITY DEFINER cerradas', () => {
  const nuevas = [
    'recepcion_pieza_existe(text)',
    'recepcion_pieza_es_ajena(text, text)',
    'correspondencia_registrar_acuse(uuid, text, text, text)',
  ]
  // CREATE FUNCTION concede EXECUTE a PUBLIC por defecto (#765): sin el REVOKE
  // quedan ejecutables por `anon`. migrations-guard.mjs también lo exige; esto
  // nombra las tres firmas para que un rename no se lleve el guard por delante.
  for (const firma of nuevas) {
    it(`${firma} revoca PUBLIC y concede solo a authenticated`, () => {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${firma} FROM PUBLIC`)
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${firma} TO authenticated`)
    })
  }
})

describe('la migración es nueva, no una edición', () => {
  it('su versión es posterior a todo lo ya aplicado en el preview', () => {
    const versiones = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .map(f => f.slice(0, 14))
      .sort()
    // El preview ya aplicó hasta 20260830000000; el bot solo empuja archivos
    // NUEVOS, así que cualquier corrección de BD tiene que ir en uno nuevo.
    expect(versiones[versiones.length - 1]).toBe('20260831000000')
  })
})
