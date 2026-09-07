import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards ESTÁTICOS del marcaje de turno por el propio empleado (20260908000000).
//
// ALCANCE Y LÍMITE. Esto lee el SQL del repositorio; la verificación CONDUCTUAL
// —que el doble marcaje se rechace, que una foto ajena no se acepte, que la
// salida cierre el turno nocturno de ayer— corre contra un Postgres real al
// reconstruir el esquema. Lo de aquí es lo que aquello no puede ver: que la
// regla siga ESCRITA como debe, y sobre todo que nadie le agregue a la RPC el
// parámetro que la vaciaría de sentido.
const MIGRACION = resolve('supabase/migrations/20260908000000_presencia_marcaje_autoservicio.sql')
const sql = readFileSync(MIGRACION, 'utf8')

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
function soloCodigo(texto: string): string {
  return texto.replace(/--[^\n]*/g, '')
}
const codigo = soloCodigo(sql)

/** Cuerpo de una policy de storage.objects por nombre, o null si no existe. */
function policy(nombre: string): string | null {
  const re = new RegExp(`CREATE\\s+POLICY\\s+"${nombre}"\\s+ON\\s+storage\\.objects([\\s\\S]*?);\\s*\\n`, 'i')
  return codigo.match(re)?.[1] ?? null
}

describe('la hora la pone el servidor', () => {
  it('presencia_marcar no acepta ningún parámetro de hora ni de fecha', () => {
    const firma = codigo.match(/CREATE OR REPLACE FUNCTION public\.presencia_marcar\(([\s\S]*?)\)\s*RETURNS/)?.[1]
    expect(firma).toBeTruthy()
    const params = firma!.split(',').map(p => p.trim().split(/\s+/)[0])
    expect(params).toEqual(['p_project_id', 'p_tipo', 'p_foto', 'p_gps', 'p_observaciones'])
    // Si algún día aparece un p_hora/p_fecha, el marcaje vuelve a valer lo que
    // el dispositivo diga que vale.
    expect(firma).not.toMatch(/p_(hora|fecha|timestamp|now)/i)
  })

  it('la hora sale de now() en la zona del tenant, no de un parámetro', () => {
    expect(codigo).toMatch(/v_local\s*:=\s*\(now\(\) AT TIME ZONE v_tz\)/)
    expect(codigo).toMatch(/v_hora\s*:=\s*date_trunc\('second', v_local\)::time/)
    expect(codigo).toMatch(/presencia_zona_horaria/)
  })

  it('el doble marcaje de entrada se rechaza en vez de sobrescribirse', () => {
    expect(codigo).toMatch(/Ya marcaste tu entrada hoy/)
    // Y la carrera de dos toques simultáneos la cierra el índice, no el IF.
    expect(codigo).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS presencia_autoservicio_una_por_dia[\s\S]*?WHERE origen = 'autoservicio'/)
  })

  it('la salida busca la entrada abierta de ayer: el turno nocturno cruza medianoche', () => {
    expect(codigo).toMatch(/pp\.fecha\s*>=\s*v_fecha - 1/)
  })
})

describe('quién puede marcar', () => {
  it('marcar exige SER el empleado, no administrar la presencia de todos', () => {
    const cuerpo = codigo.slice(codigo.indexOf('FUNCTION public.presencia_marcar'))
    expect(cuerpo).toMatch(/presencia_ficha_de_usuario\(p_project_id\)/)
    // Pedir el permiso del tab aquí dejaría fuera justo a quien tiene que
    // marcar (el conserje no administra la asistencia de nadie).
    expect(cuerpo.slice(0, cuerpo.indexOf('$$;'))).not.toMatch(/user_has_permission\('condominios\.tab\.presencia'\)/)
  })

  it('el expediente se resuelve por el vínculo cuenta→ficha del proyecto', () => {
    expect(codigo).toMatch(/pc\.user_id = \(SELECT auth\.uid\(\)\)/)
    expect(codigo).toMatch(/pc\.project_id = p_project_id/)
    expect(codigo).toMatch(/COALESCE\(pc\.estado, ''\) <> 'inactivo'/)
  })

  it('ni las RPC ni los helpers quedan expuestos a anon', () => {
    for (const fn of [
      'public.presencia_marcar(uuid, text, text, jsonb, text)',
      'public.presencia_mi_ficha(uuid)',
      'public.presencia_ficha_de_usuario(uuid)',
      'public.presencia_ficha_es_propia(text, text)',
      'public.presencia_zona_horaria(uuid)',
    ]) {
      const escapado = fn.replace(/[().*+?^${}|[\]\\]/g, '\\$&')
      expect(codigo).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${escapado} FROM PUBLIC, anon`))
    }
  })

  it('a `authenticated` solo se le concede lo que de verdad invoca', () => {
    // Las dos RPC que llama el navegador, y el helper que se evalúa DENTRO de
    // las policies de storage (donde corre con el rol invocante).
    for (const fn of [
      'public.presencia_marcar(uuid, text, text, jsonb, text)',
      'public.presencia_mi_ficha(uuid)',
      'public.presencia_ficha_es_propia(text, text)',
    ]) {
      const escapado = fn.replace(/[().*+?^${}|[\]\\]/g, '\\$&')
      expect(codigo).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${escapado} TO authenticated`))
    }
    // Los dos helpers internos NO: sus llamadores son cuerpos SECURITY DEFINER
    // que corren como el dueño. Es el remedio que prescribe el propio
    // migrations-guard.allowlist.json para esta clase de función.
    for (const fn of ['public.presencia_ficha_de_usuario(uuid)', 'public.presencia_zona_horaria(uuid)']) {
      const escapado = fn.replace(/[().*+?^${}|[\]\\]/g, '\\$&')
      expect(codigo).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${escapado} FROM PUBLIC, anon, authenticated`))
      expect(codigo).not.toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${escapado} TO authenticated`))
    }
  })

  it('no toca la RLS de presencia_personal: el formulario manual sigue como estaba', () => {
    expect(codigo).not.toMatch(/POLICY\s+"?presencia_personal_/)
  })
})

describe('el bucket de las fotos de fichaje', () => {
  it('es privado y solo acepta imágenes', () => {
    expect(codigo).toMatch(/INSERT INTO storage\.buckets[\s\S]*'presencia-evidencias'/)
    expect(codigo).toMatch(/'presencia-evidencias',\s*false/)
    expect(codigo).toMatch(/ON CONFLICT \(id\) DO UPDATE[\s\S]*?SET public = false/)
    expect(codigo).toMatch(/allowed_mime_types[\s\S]*?image\/jpeg/)
  })

  it('NO son fotos de condominios-media, que autoriza por proyecto', () => {
    // Ahí cualquier residente del condominio podría descargar la serie de fotos
    // de la cara y la ubicación de cada trabajador.
    expect(codigo).not.toMatch(/condominios-media/)
    const dominio = readFileSync(resolve('src/domain/condominios/presenciaAutoservicio.ts'), 'utf8')
    expect(dominio).toContain('BUCKET_PRESENCIA')
    expect(dominio).not.toMatch(/uploadCondominiosMedia/)
  })

  it('la foto no se puede sustituir: no hay policy de UPDATE', () => {
    expect(policy('presencia_evidencias_update')).toBeNull()
    expect(policy('presencia_evidencias_select')).toBeTruthy()
    expect(policy('presencia_evidencias_insert')).toBeTruthy()
    expect(policy('presencia_evidencias_delete')).toBeTruthy()
  })

  it('leer una foto es ser su dueño o administrar la asistencia — nunca «estar en el proyecto»', () => {
    const p = policy('presencia_evidencias_select')!
    expect(p).toMatch(/presencia_ficha_es_propia/)
    expect(p).toMatch(/user_has_permission\('condominios\.tab\.presencia'\)/)
    expect(p).not.toMatch(/mis_proyectos_ids/)
  })

  it('subir bajo el expediente de otro exige el permiso de escribir asistencia', () => {
    const p = policy('presencia_evidencias_insert')!
    expect(p).toMatch(/array_length\(storage\.foldername\(name\), 1\) = 2/)
    expect(p).toMatch(/presencia_ficha_es_propia/)
    expect(p).toMatch(/user_has_permission\('condominios\.tab\.presencia\.create'\)/)
  })

  it('borrar la evidencia es cosa de la empresa, no de quien fichó', () => {
    const p = policy('presencia_evidencias_delete')!
    expect(p).toMatch(/current_user_role\(\)\) = ANY\(ARRAY\['company_owner','admin'\]\)/)
    expect(p).not.toMatch(/presencia_ficha_es_propia/)
  })

  it('la RPC comprueba que la foto sea del expediente propio y que exista', () => {
    expect(codigo).toMatch(/La foto no corresponde a tu expediente/)
    expect(codigo).toMatch(/FROM storage\.objects o[\s\S]*?bucket_id = 'presencia-evidencias'/)
    expect(codigo).toMatch(/La foto no llegó a subirse/)
  })
})

describe('la ubicación', () => {
  it('se guarda normalizada o no se guarda', () => {
    expect(codigo).toMatch(/v_lat BETWEEN -90 AND 90 AND v_lng BETWEEN -180 AND 180/)
    expect(codigo).toMatch(/jsonb_build_object\('lat', v_lat, 'lng', v_lng, 'exactitud_m', v_exactitud\)/)
    // Una coordenada ilegible es NULL, no ruido que después se lea como dato.
    expect(codigo).toMatch(/EXCEPTION WHEN OTHERS THEN\s*\n\s*v_gps := NULL/)
  })
})

describe('la tardanza', () => {
  it('usa la tolerancia que ya existía en la plantilla de horario', () => {
    expect(codigo).toMatch(/COALESCE\(ph\.tolerancia_entrada_min, 10\)/)
    expect(codigo).toMatch(/v_retraso > v_tolerancia AND v_retraso <= 240/)
  })
})
