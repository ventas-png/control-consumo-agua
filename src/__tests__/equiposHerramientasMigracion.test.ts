// Guard ESTÁTICO de 20261122000000 (Equipos junto a Suministros; las herramientas
// de las actividades salen de equipos_comunes). Lo ejecutable vive en
// supabase/tests/equipos_herramientas; aquí se comprueba lo que un CREATE OR
// REPLACE descuidado puede perder: la firma retirada antes de la nueva, los
// REVOKE, que el bucle de herramientas ya no mire Inventario, y que los tipos
// del cliente describan lo mismo.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ARCHIVO = '20261122000000_equipos_operativos_y_herramientas_desde_equipos.sql'
const sql = readFileSync(resolve('supabase/migrations', ARCHIVO), 'utf8')
const sinComentarios = sql.replace(/^[ \t]*--.*$/gm, '')

/** Cuerpo de una función: desde su CREATE hasta el `$$;` que la cierra. */
function cuerpo(nombre: string): string {
  const i = sinComentarios.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}(`)
  expect(i, `falta CREATE OR REPLACE FUNCTION public.${nombre}`).toBeGreaterThanOrEqual(0)
  const j = sinComentarios.indexOf('\n$$;', i)
  return sinComentarios.slice(i, j)
}

describe('20261122000000 — equipos_comunes', () => {
  it('agrega cantidad (entero ≥ 0, defecto 1) y foto_url, y el ancla UNIQUE para la FK compuesta', () => {
    expect(sinComentarios).toMatch(/ALTER TABLE public\.equipos_comunes\s+ADD COLUMN IF NOT EXISTS cantidad int NOT NULL DEFAULT 1;/)
    expect(sinComentarios).toMatch(/ALTER TABLE public\.equipos_comunes\s+ADD COLUMN IF NOT EXISTS foto_url text;/)
    expect(sinComentarios).toContain('ADD CONSTRAINT equipos_comunes_cantidad_check CHECK (cantidad >= 0)')
    expect(sinComentarios).toContain('ADD CONSTRAINT equipos_id_tenant_uq UNIQUE (id, company_id, project_id)')
  })
  it('las columnas se agregan con SQL literal (el guard de tipos no lee ALTER dinámicos)', () => {
    expect(/add\s+column\s+(if\s+not\s+exists\s+)?%[IsL]/i.test(sql)).toBe(false)
  })
})

describe('20261122000000 — plantilla_tarea_herramientas', () => {
  it('equipo_id con FK compuesta RESTRICT a equipos_comunes; inventario_id admite NULL; exactamente uno de los dos', () => {
    expect(sinComentarios).toMatch(/ALTER TABLE public\.plantilla_tarea_herramientas\s+ADD COLUMN IF NOT EXISTS equipo_id uuid;/)
    expect(sinComentarios).toMatch(/ALTER TABLE public\.plantilla_tarea_herramientas\s+ALTER COLUMN inventario_id DROP NOT NULL;/)
    expect(sinComentarios).toContain('ADD CONSTRAINT pt_herramienta_recurso_check CHECK ((inventario_id IS NULL) <> (equipo_id IS NULL))')
    expect(sinComentarios).toMatch(/ADD CONSTRAINT pt_herramienta_equipo_fk\s+FOREIGN KEY \(equipo_id, company_id, project_id\)\s+REFERENCES public\.equipos_comunes\(id, company_id, project_id\) ON DELETE RESTRICT/)
  })
  it('índice único PARCIAL (plantilla, equipo) para el ON CONFLICT del bloque, e índice por equipo', () => {
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS pt_herramienta_equipo_unica\s+ON public\.plantilla_tarea_herramientas \(plantilla_tarea_id, equipo_id\)\s+WHERE equipo_id IS NOT NULL;/)
    expect(sinComentarios).toContain('CREATE INDEX IF NOT EXISTS idx_pt_herramientas_equipo')
  })
  it('el trigger de coherencia es propio, SECURITY DEFINER con REVOKE a PUBLIC/anon/authenticated, y vigila equipo_id', () => {
    const fn = cuerpo('plantilla_herramienta_coherente')
    expect(fn).toContain('SECURITY DEFINER')
    expect(fn).toMatch(/SET search_path = public, pg_temp/)
    expect(fn).toContain('FROM public.equipos_comunes e WHERE e.id = NEW.equipo_id')
    expect(fn).toContain('FROM public.inventario_condominio i WHERE i.id = NEW.inventario_id')
    expect(sinComentarios).toContain('REVOKE EXECUTE ON FUNCTION public.plantilla_herramienta_coherente() FROM PUBLIC, anon, authenticated;')
    expect(sinComentarios).toContain('DROP TRIGGER IF EXISTS trg_pt_her_coherente ON public.plantilla_tarea_herramientas;')
    expect(sinComentarios).toMatch(/CREATE TRIGGER trg_pt_her_coherente\s+BEFORE INSERT OR UPDATE OF plantilla_tarea_id, inventario_id, equipo_id, company_id, project_id\s+ON public\.plantilla_tarea_herramientas\s+FOR EACH ROW EXECUTE FUNCTION public\.plantilla_herramienta_coherente\(\);/)
  })
})

describe('20261122000000 — las RPC de plantillas miran Equipos, no Inventario', () => {
  it('plantillas_import_evaluar resuelve herramientas/equipo contra equipos_comunes (no de baja), exige ver Equipos y devuelve recursos.equipos', () => {
    const fn = cuerpo('plantillas_import_evaluar')
    expect(fn).toContain("FROM public.equipos_comunes e")
    expect(fn).toContain("e.estado <> 'baja'")
    expect(fn).toContain("user_has_permission('condominios.tab.equipos')")
    expect(fn).toContain("'recursos', jsonb_build_object('suministros', v_sum, 'equipos', v_eq)")
    expect(fn).not.toContain('inventario_condominio')
    expect(fn).not.toContain('condominios.tab.inventario')
    // sigue leyendo los cargos del catálogo RRHH (20261031000300): el cuerpo no retrocedió
    expect(fn).toContain('FROM public.rrhh_cargos c')
    expect(sinComentarios).toContain('REVOKE EXECUTE ON FUNCTION public.plantillas_import_evaluar(uuid, uuid, jsonb, int) FROM PUBLIC, anon;')
  })
  it('plantillas_importar_aplicar inserta equipo_id desde recursos.equipos y conserva sus compuertas', () => {
    const fn = cuerpo('plantillas_importar_aplicar')
    expect(fn).toContain("jsonb_array_elements(COALESCE(d->'recursos'->'equipos', '[]'::jsonb))")
    expect(fn).toContain('INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, equipo_id, cantidad, obligatoria)')
    expect(fn).not.toContain('inventario_id')
    for (const compuerta of ['IF NOT public.plantillas_import_puede_crear() THEN', 'IF v_errs > 0 OR v_dup > 0 THEN', 'PLANTILLAS_IMPORT_DUPLICADO']) {
      expect(fn).toContain(compuerta)
    }
  })
  it('plantillas_recursos_en_bloque: se retira la firma anterior ANTES de crear la nueva (p_equipos), y se vuelve a conceder', () => {
    const drop = sinComentarios.indexOf('DROP FUNCTION IF EXISTS public.plantillas_recursos_en_bloque(uuid, uuid[], text, jsonb, jsonb);')
    const create = sinComentarios.indexOf('CREATE OR REPLACE FUNCTION public.plantillas_recursos_en_bloque(')
    expect(drop).toBeGreaterThanOrEqual(0)
    expect(create).toBeGreaterThan(drop)
    const fn = cuerpo('plantillas_recursos_en_bloque')
    expect(fn).toMatch(/p_suministros jsonb DEFAULT '\[\]'::jsonb, p_equipos jsonb DEFAULT '\[\]'::jsonb/)
    expect(fn).not.toContain('p_inventario')
    expect(fn).toContain("user_has_permission('condominios.tab.equipos')")
    expect(fn).toContain("(p_accion = 'quitar' OR e.estado <> 'baja')")
    expect(fn).toContain('ON CONFLICT (plantilla_tarea_id, equipo_id) WHERE equipo_id IS NOT NULL DO NOTHING;')
    expect(fn).toContain('AND equipo_id IN (SELECT (x->>\'id\')::uuid FROM jsonb_array_elements(v_eq) x);')
    expect(fn).not.toContain('inventario_condominio')
    const revoke = sinComentarios.indexOf('REVOKE EXECUTE ON FUNCTION public.plantillas_recursos_en_bloque(uuid, uuid[], text, jsonb, jsonb) FROM PUBLIC, anon;')
    const grant = sinComentarios.indexOf('GRANT  EXECUTE ON FUNCTION public.plantillas_recursos_en_bloque(uuid, uuid[], text, jsonb, jsonb) TO authenticated;')
    expect(revoke).toBeGreaterThan(create)
    expect(grant).toBeGreaterThan(revoke)
  })
  it('el permiso del tab y sus acciones pasan a la categoría operaciones', () => {
    expect(sinComentarios).toMatch(/UPDATE public\.permissions\s+SET category = 'operaciones'\s+WHERE \(key = 'condominios\.tab\.equipos' OR key LIKE 'condominios\.tab\.equipos\.%'\)/)
  })
})

describe('el cliente describe lo mismo que la migración', () => {
  const tipos = readFileSync(resolve('src/types/database.types.ts'), 'utf8')
  it('database.types.ts: equipo_id e inventario_id anulable en la puente; cantidad y foto_url en equipos; p_equipos en la RPC', () => {
    const puente = tipos.slice(tipos.indexOf('      plantilla_tarea_herramientas: {'), tipos.indexOf('      plantilla_tarea_suministros: {'))
    expect(puente).toContain('equipo_id: string | null')
    expect(puente).toContain('inventario_id: string | null')
    expect(puente).toContain('foreignKeyName: "pt_herramienta_equipo_fk"')
    const equipos = tipos.slice(tipos.indexOf('      equipos_comunes: {'), tipos.indexOf('      equipos_comunes: {') + 2500)
    expect(equipos).toContain('cantidad: number')
    expect(equipos).toContain('foto_url: string | null')
    expect(tipos).toContain("p_suministros?: Json; p_equipos?: Json }")
    expect(tipos).not.toContain('p_inventario?: Json')
  })
  it('el navegador manda p_equipos, inserta equipo_id y lee recursos.equipos', () => {
    expect(readFileSync(resolve('src/domain/condominios/plantillasRecursos.ts'), 'utf8')).toContain('p_equipos:')
    expect(readFileSync(resolve('src/components/condominios/ActividadesCatalog.tsx'), 'utf8')).toContain('equipo_id: herSel')
    expect(readFileSync(resolve('src/types/condominios/operaciones.ts'), 'utf8')).toMatch(/equipos: \{ id: string; nombre: string; categoria: string; cantidad: number; obligatoria: boolean \}\[\]/)
  })
})
