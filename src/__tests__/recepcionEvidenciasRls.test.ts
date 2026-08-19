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
// El estado FINAL lo declara la de integridad: el preview ya tenía aplicadas
// versiones anteriores de las otras dos, y el bot solo empuja archivos nuevos.
// Los guards de policies y RPC miran ESTA, que es la que manda al final.
const FINAL = '20260901000000_recepcion_integridad_final.sql'
const BUCKET = 'recepcion-evidencias'
const sql = readFileSync(join(MIGRATIONS_DIR, FINAL), 'utf8')
const sqlEvidencias = readFileSync(join(MIGRATIONS_DIR, MIGRACION), 'utf8')

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

  it('ninguna de las dos toca la migración de storage ya fusionada', () => {
    // 20260822020000 es historia: reescribirla no la re-aplicaría en el preview
    // (el bot solo empuja archivos nuevos) y sí rompería el histórico.
    expect(soloCodigo(sql)).not.toMatch(/cond_media_(select|insert|update|delete)/)
    expect(soloCodigo(sqlEvidencias)).not.toMatch(/cond_media_(select|insert|update|delete)/)
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
    // El huérfano propio (nada lo referencia todavía) es la única excepción, y
    // está acotada al dueño del objeto.
    expect(cuerpo).toMatch(/owner = \(SELECT auth\.uid\(\)\)/)
    expect(cuerpo).toMatch(/NOT public\.recepcion_evidencia_referenciada\(name\)/)
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

  it('la firma se verifica contra storage.objects, no se cree el texto', () => {
    const cuerpo = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.correspondencia_registrar_acuse'))
    expect(cuerpo).toMatch(/FROM storage\.objects o/)
    expect(cuerpo).toMatch(/o\.bucket_id = 'recepcion-evidencias'/)
    // Ruta exacta proyecto/pieza/archivo, con los ids de ESTA pieza.
    expect(cuerpo).toMatch(/array_length\(v_partes, 1\) IS DISTINCT FROM 3/)
    expect(cuerpo).toMatch(/v_partes\[1\] IS DISTINCT FROM v_pieza\.project_id::text/)
    expect(cuerpo).toMatch(/v_partes\[2\] IS DISTINCT FROM p_pieza_id::text/)
    // La subió quien firma, y es una imagen.
    expect(cuerpo).toMatch(/o\.owner = auth\.uid\(\)/)
    expect(cuerpo).toMatch(/mimetype[\s\S]{0,40}image\//)
    expect(cuerpo).toMatch(/png\|jpg\|jpeg\|webp/)
  })

  it('la vía siempre es presencial: portal rechazado y sellado en el servidor', () => {
    const cuerpo = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.correspondencia_registrar_acuse'))
    expect(cuerpo).toMatch(/p_via IS DISTINCT FROM 'porteria'/)
    // No se guarda p_via: se guarda la constante.
    expect(cuerpo).toMatch(/entregado_via\s*=\s*'porteria'/)
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
    // El preview ya aplicó versiones anteriores de 20260829 y 20260831; el bot
    // solo empuja archivos NUEVOS, así que el estado final tiene que declararse
    // en el último, no editando aquellos.
    expect(versiones[versiones.length - 1]).toBe('20260901000000')
  })
})

// ── El FK contradictorio ────────────────────────────────────────────────────
describe('unidad con historial de recepción', () => {
  it('el FK pasa a RESTRICT y los dos CHECK NO se relajan', () => {
    const codigo = soloCodigo(sql)
    expect(codigo).toMatch(/ADD CONSTRAINT paquetes_recibidos_unidad_id_fkey[\s\S]*ON DELETE RESTRICT/)
    expect(codigo).not.toMatch(/paquetes_recibidos_unidad_id_fkey[\s\S]{0,200}ON DELETE SET NULL/)
    // Relajarlos permitiría crear paquetes sin unidad: peor que el problema.
    expect(codigo).toMatch(/paquetes_unidad_por_clase_chk[\s\S]*clase <> 'paquete' OR unidad_id IS NOT NULL/)
    expect(codigo).toMatch(/paquetes_destinatario_unidad_chk[\s\S]*destinatario_tipo <> 'unidad' OR unidad_id IS NOT NULL/)
    expect(codigo).not.toMatch(/DROP CONSTRAINT IF EXISTS paquetes_unidad_por_clase_chk/)
  })

  it('la UI traduce el rechazo del FK en vez de enseñar el SQL', () => {
    const mut = readFileSync(resolve('src/domain/unidades/mutations.ts'), 'utf8')
    expect(mut).toContain('mensajeBorradoUnidad')
    expect(mut).toMatch(/historial de recepción/)
    expect(mut).toMatch(/[Dd]esactívala/)
  })
})

// ── La RPC como única puerta ────────────────────────────────────────────────
describe('el acuse no se puede escribir a mano', () => {
  const guard = () => sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.correspondencia_acuse_guard'),
    sql.indexOf('DROP TRIGGER IF EXISTS correspondencia_acuse_guard_trg'),
  )

  it('hay un trigger BEFORE UPDATE que lo vigila', () => {
    expect(soloCodigo(sql)).toMatch(
      /CREATE TRIGGER correspondencia_acuse_guard_trg\s+BEFORE UPDATE ON public\.paquetes_recibidos/)
  })

  it('NO usa un GUC como autorización: el cliente podría ponerlo', () => {
    // `set_config`/`current_setting` sobre una clave propia es un dato que el
    // llamante controla. Lo que no puede falsificar es su ROL.
    expect(soloCodigo(sql)).not.toMatch(/set_config\s*\(/)
    expect(guard()).not.toMatch(/current_setting/)
    expect(soloCodigo(sql)).toMatch(/current_user IN \('authenticated', 'anon'\)/)
  })

  it('el guard es SECURITY INVOKER: uno DEFINER vería siempre a su propio dueño', () => {
    expect(guard()).not.toMatch(/SECURITY DEFINER/)
    // Y el helper que mira `current_user`, igual: si fuera DEFINER devolvería
    // siempre el rol de SU dueño y dejaría pasar cualquier UPDATE del cliente.
    const desde = sql.indexOf('CREATE OR REPLACE FUNCTION public.recepcion_llamada_de_cliente')
    // soloCodigo: la propia declaración lleva un comentario que dice
    // "NO SECURITY DEFINER", y no queremos que el guard se dispare con él.
    const helper = soloCodigo(sql.slice(desde, sql.indexOf('$$;', desde)))
    expect(helper).not.toMatch(/SECURITY DEFINER/)
  })

  it('bloquea la transición y la reapertura, y sella los seis campos', () => {
    const cuerpo = guard()
    expect(cuerpo).toMatch(/NEW\.estado = 'atendido' AND public\.recepcion_llamada_de_cliente\(\)/)
    expect(cuerpo).toMatch(/OLD\.estado = 'atendido'/)
    for (const col of ['estado', 'entregado_a_nombre', 'entregado_por',
                       'entregado_via', 'hora_entrega', 'firma_path']) {
      expect(cuerpo, `${col} tiene que quedar sellado`).toMatch(new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM OLD\\.${col}`))
    }
  })

  it('paquetería, devolución y archivado siguen pasando', () => {
    const cuerpo = guard()
    // Sale temprano para la otra clase…
    expect(cuerpo).toMatch(/COALESCE\(NEW\.clase, OLD\.clase\) <> 'correspondencia'[\s\S]{0,60}RETURN NEW/)
    // …y la rama que bloquea campos en pieza abierta NO incluye los tres que
    // sella la devolución.
    const abierta = soloCodigo(cuerpo.slice(cuerpo.indexOf('-- (c)')))
    expect(abierta).toMatch(/entregado_a_nombre/)
    expect(abierta).toMatch(/firma_path/)
    expect(abierta).not.toMatch(/hora_entrega/)
    expect(abierta).not.toMatch(/entregado_via/)
  })
})

// ── El aviso: claim con lease ───────────────────────────────────────────────
describe('carrera de notificado_at', () => {
  it('hay un claim atómico con lease, y solo lo usa service_role', () => {
    const codigo = soloCodigo(sql)
    expect(codigo).toMatch(/ADD COLUMN IF NOT EXISTS notificacion_claim_at timestamptz/)
    expect(codigo).toMatch(/FUNCTION public\.paquete_reclamar_aviso/)
    // Un solo UPDATE condicional: el row lock serializa las dos llamadas.
    expect(codigo).toMatch(/UPDATE public\.paquetes_recibidos[\s\S]*notificado_at IS NULL[\s\S]*notificacion_claim_at < now\(\) - make_interval/)
    expect(codigo).toMatch(/REVOKE ALL ON FUNCTION public\.paquete_reclamar_aviso\(uuid, integer\) FROM authenticated/)
    expect(codigo).toMatch(/GRANT EXECUTE ON FUNCTION public\.paquete_reclamar_aviso\(uuid, integer\) TO service_role/)
  })

  it('un fallo transitorio NO se sella como notificado', () => {
    const cuerpo = sql.slice(sql.indexOf('FUNCTION public.paquete_finalizar_aviso'))
    expect(cuerpo).toMatch(/CASE WHEN p_entregado THEN COALESCE\(notificado_at, now\(\)\)/)
    expect(cuerpo).toMatch(/ELSE notificado_at END/)
  })

  it('la edge function reclama, comprueba el cierre y documenta los reintentos', () => {
    const fn = readFileSync(resolve('supabase/functions/notify-package/index.ts'), 'utf8')
    expect(fn).toContain("rpc('paquete_reclamar_aviso'")
    expect(fn).toContain("rpc('paquete_finalizar_aviso'")
    // El resultado del cierre ya no se ignora.
    expect(fn).toMatch(/errFin \|\| finalizado !== true/)
    // Y no se promete exactly-once, que el proveedor externo no da.
    expect(fn).toMatch(/at-least-once/)
  })
})

// ── RBAC del aviso ──────────────────────────────────────────────────────────
describe('notify-package exige más que la empresa', () => {
  it('comprueba proyecto y permiso de la clase, con la identidad del JWT', () => {
    const fn = readFileSync(resolve('supabase/functions/notify-package/index.ts'), 'utf8')
    expect(fn).toContain('puedeNotificar')
    expect(fn).toContain('admin.auth.getUser(token)')
    expect(fn).toContain('user_project_assignments')
    expect(fn).toContain('role_permissions')
    // El gate viejo, que solo miraba company_id, ya no decide nada.
    expect(fn).not.toMatch(/autorizadoParaEmpresa\(\{ internal/)
  })
})
