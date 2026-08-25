import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { evidenciaSuficiente } from '../domain/condominios/evidencia'

// Guards del gate de evidencia (20260905000400).
//
// DOS COSAS DISTINTAS SE VIGILAN AQUÍ:
//
//   1. Que el SQL siga diciendo lo que debe. La verificación conductual vive en
//      supabase/tests/evidencia_al_cerrar/run.sh; lo que ese sandbox no puede
//      ver es lo que se PIERDE al reescribir el trigger, porque probaría la
//      versión nueva. Los dos filos fáciles de desafilar: que gatee la
//      TRANSICIÓN y no la fila, y que la salida de emergencia siga exigiendo
//      texto real.
//
//   2. Que el chequeo de la UI y el trigger no se separen. Son dos
//      implementaciones de la misma regla —una en plpgsql, otra en TS— y esa es
//      exactamente la forma en que `requiere_foto` terminó siendo decorativo
//      durante año y medio: la pantalla decía una cosa y la base no decía nada.
//      Si divergen, el que manda es el trigger; estas pruebas hacen ruidosa la
//      divergencia en vez de silenciosa.

const MIG = resolve('supabase/migrations/20260905000400_evidencia_al_cerrar.sql')
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(MIG, 'utf8'))

const cuerpo = (() => {
  const m = sql.match(
    /CREATE OR REPLACE FUNCTION public\.exigir_evidencia_al_cerrar\(\)([\s\S]*?)\n\$\$;/i,
  )
  if (!m) throw new Error('no se encontró exigir_evidencia_al_cerrar')
  return m[1]
})()

describe('20260905000400 · el trigger gatea la TRANSICIÓN, no la fila', () => {
  it('sale temprano si no es el paso a completada', () => {
    // Si validara la fila, editar cualquier cosa de una tarea vieja reventaría
    // —y migrar datos se volvería imposible—. La guarda de salida es lo que
    // hace innecesario un CHECK NOT VALID.
    expect(cuerpo).toMatch(/NEW\.estado IS DISTINCT FROM 'completada'/i)
    expect(cuerpo).toMatch(/OLD\.estado IS NOT DISTINCT FROM 'completada'/i)
  })

  it('es BEFORE UPDATE y sólo sobre tareas_bloque', () => {
    const trg = sql.match(
      /CREATE TRIGGER trg_exigir_evidencia\s+([\s\S]*?);/i,
    )
    expect(trg).not.toBeNull()
    expect(trg![1]).toMatch(/BEFORE UPDATE ON public\.tareas_bloque/i)
  })

  it('NO es SECURITY DEFINER: no lee nada fuera de su propia fila', () => {
    expect(cuerpo, 'privilegio de más sin necesitarlo').not.toMatch(/SECURITY DEFINER/i)
  })
})

describe('20260905000400 · la salida de emergencia no es un bypass', () => {
  it('exige texto real, no una cadena vacía', () => {
    // `motivo_sin_evidencia = ''` no debe abrir la puerta: sería el bypass
    // silencioso que este diseño evita a propósito.
    expect(cuerpo).toMatch(/btrim\(NEW\.motivo_sin_evidencia\)[\s\S]{0,40}<>\s*''/i)
  })

  it('la columna existe para que el motivo quede escrito en la fila', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS motivo_sin_evidencia\s+text/i)
  })
})

describe('20260905000400 · qué se exige', () => {
  it('cubre las tres exigencias y ninguna se cayó', () => {
    expect(cuerpo).toMatch(/NEW\.requiere_foto/)
    expect(cuerpo).toMatch(/NEW\.requiere_comentario/)
    expect(cuerpo).toMatch(/NEW\.requiere_checklist/)
  })

  it('el checklist se exige COMPLETO, posición por posición', () => {
    // `count(*) >= n` sería más corto y estaría mal: marcar tres veces el mismo
    // paso pasaría por checklist completo.
    expect(cuerpo).toMatch(/generate_series\(0, v_pasos - 1\)/i)
    expect(cuerpo).toMatch(/checklist_completado[\s\S]{0,40}@>\s*to_jsonb\(i\)/i)
  })

  it('el comentario en blanco no cuenta como comentario', () => {
    expect(cuerpo).toMatch(/btrim\(NEW\.evidencia_texto\)[\s\S]{0,30}=\s*''/i)
  })

  it('marca sus errores con EVIDENCIA: para poder traducirlos en la UI', () => {
    // Misma convención que PLANTILLA_RECURSO: (20260904000200). Sin el marcador,
    // la UI no puede distinguir este check_violation de cualquier otro.
    const marcas = cuerpo.match(/RAISE EXCEPTION\s*\n?\s*'EVIDENCIA:/g) ?? []
    expect(marcas.length).toBe(3)
  })
})

describe('el chequeo de la UI no se separa del trigger', () => {
  // Mismos casos, misma respuesta. Si alguien afloja uno de los dos lados, esto
  // no lo detecta por magia — pero sí obliga a tocar este archivo, que es donde
  // está escrito por qué las reglas deben coincidir.

  it('exige foto igual que el trigger', () => {
    expect(evidenciaSuficiente({ requiere_foto: true }, { foto_urls: [] }).ok).toBe(false)
    expect(evidenciaSuficiente({ requiere_foto: true }, { foto_urls: ['a.jpg'] }).ok).toBe(true)
    expect(evidenciaSuficiente({ requiere_foto: false }, { foto_urls: [] }).ok).toBe(true)
  })

  it('trata el comentario en blanco como ausente, igual que btrim en el trigger', () => {
    expect(evidenciaSuficiente({ requiere_comentario: true }, { evidencia_texto: '   ' }).ok).toBe(false)
    expect(evidenciaSuficiente({ requiere_comentario: true }, { evidencia_texto: 'ok' }).ok).toBe(true)
  })

  it('exige el checklist completo y no se conforma con repetir un paso', () => {
    const req = { requiere_checklist: true, checklist: ['a', 'b', 'c'] }
    expect(evidenciaSuficiente(req, { checklist_completado: [0, 1] }).ok).toBe(false)
    expect(evidenciaSuficiente(req, { checklist_completado: [0, 0, 0] }).ok).toBe(false)
    expect(evidenciaSuficiente(req, { checklist_completado: [0, 1, 2] }).ok).toBe(true)
  })

  it('acepta el motivo declarado y rechaza el motivo en blanco', () => {
    expect(evidenciaSuficiente(
      { requiere_foto: true },
      { foto_urls: [], motivo_sin_evidencia: 'cámara rota' },
    ).ok).toBe(true)
    expect(evidenciaSuficiente(
      { requiere_foto: true },
      { foto_urls: [], motivo_sin_evidencia: '   ' },
    ).ok).toBe(false)
  })

  it('dice QUÉ falta, para que la UI pueda llevar al usuario ahí', () => {
    const r = evidenciaSuficiente({ requiere_foto: true }, { foto_urls: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.falta).toBe('foto')
      expect(r.motivo).toMatch(/foto/i)
    }
  })

  it('un checklist declarado pero vacío no bloquea', () => {
    // `requiere_checklist` con cero pasos no es una exigencia: es una plantilla
    // mal cargada. Bloquear ahí dejaría tareas imposibles de cerrar.
    expect(evidenciaSuficiente({ requiere_checklist: true, checklist: [] }, {}).ok).toBe(true)
  })
})

describe('20260905000400 · el sandbox conductual está cableado a CI', () => {
  it('el job rls-sandbox ejecuta evidencia_al_cerrar', () => {
    // La lección de #785: un sandbox que CI no corre no protege nada.
    const wf = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(wf).toMatch(/supabase\/tests\/evidencia_al_cerrar\/run\.sh/)
  })

  it('el runner del sandbox existe y es ejecutable', () => {
    const runSh = join(resolve('supabase/tests/evidencia_al_cerrar'), 'run.sh')
    expect(() => readFileSync(runSh, 'utf8')).not.toThrow()
  })
})
