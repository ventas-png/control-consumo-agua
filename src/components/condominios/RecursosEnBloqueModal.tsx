// Recursos EN BLOQUE del catálogo de actividades: agregar o quitar insumos, herramientas y equipo
// a varias actividades seleccionadas de una vez.
//
// La escritura es UNA llamada atómica al servidor (`plantillas_recursos_en_bloque`): o se aplica a
// todas las actividades o a ninguna. Al AGREGAR, los vínculos que ya existían no se tocan (ni su
// cantidad ni su «obligatoria»); al QUITAR, los que no estaban simplemente no cuentan. El servidor
// devuelve los conteos y la pantalla los muestra.
import { useMemo, useRef, useState } from 'react'
import { EditModal } from '../shared'
import { confirm, notify } from '../shared/Dialog'
import { aplicarRecursosEnBloque, resumenBloque, type AccionBloque, MAX_RECURSOS_BLOQUE } from '../../domain/condominios/plantillasRecursos'
import type { ItemInventario, PlantillaTareaCargo, SuministroCondominio } from '../../types'
import { btnPrimario, btnSecundario, input } from '../contabilidad/ui'

interface Props {
  proyectoId: string
  /** Actividades seleccionadas (ya filtradas por la pantalla). */
  plantillas: PlantillaTareaCargo[]
  suministros: SuministroCondominio[]
  inventario: ItemInventario[]
  onClose: () => void
  /** Se llama tras aplicar (para recargar los recursos de las tarjetas). */
  onAplicado: () => void
}

type Pestana = 'insumos' | 'herramientas' | 'equipo'
interface Elegido { cantidad: string; obligatoria: boolean }

const PESTANAS: { key: Pestana; label: string }[] = [
  { key: 'insumos', label: '🧴 Insumos' },
  { key: 'herramientas', label: '🔧 Herramientas' },
  { key: 'equipo', label: '⚙️ Equipo' },
]

export function RecursosEnBloqueModal({ proyectoId, plantillas, suministros, inventario, onClose, onAplicado }: Props) {
  const [pestana, setPestana] = useState<Pestana>('insumos')
  const [busqueda, setBusqueda] = useState('')
  const [accion, setAccion] = useState<AccionBloque>('agregar')
  // id del recurso → cantidad / obligatoria. Los insumos y el inventario tienen ids distintos.
  const [sum, setSum] = useState<Map<string, Elegido>>(new Map())
  const [inv, setInv] = useState<Map<string, Elegido>>(new Map())
  const [guardando, setGuardando] = useState(false)
  const enCurso = useRef(false)

  const n = plantillas.length
  const listaSuministros = useMemo(
    () => suministros.filter((s) => accion === 'quitar' || s.activo).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [suministros, accion],
  )
  const listaInventario = useMemo(
    () => inventario
      .filter((i) => i.categoria === (pestana === 'equipo' ? 'equipo' : 'herramienta'))
      .filter((i) => accion === 'quitar' || i.estado !== 'dado_de_baja')
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [inventario, pestana, accion],
  )
  const q = busqueda.trim().toLowerCase()
  const filtra = <T extends { nombre: string }>(xs: T[]) => (q ? xs.filter((x) => x.nombre.toLowerCase().includes(q)) : xs)

  const totalElegidos = sum.size + inv.size

  function toggle(mapa: 'sum' | 'inv', id: string) {
    const set = mapa === 'sum' ? setSum : setInv
    set((prev) => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id); else next.set(id, { cantidad: '1', obligatoria: false })
      return next
    })
  }
  function cambiar(mapa: 'sum' | 'inv', id: string, cambio: Partial<Elegido>) {
    const set = mapa === 'sum' ? setSum : setInv
    set((prev) => {
      const actual = prev.get(id)
      if (!actual) return prev
      const next = new Map(prev)
      next.set(id, { ...actual, ...cambio })
      return next
    })
  }

  function validar(): string | null {
    if (n === 0) return 'Selecciona al menos una actividad.'
    if (totalElegidos === 0) return 'Elige al menos un insumo, herramienta o equipo.'
    if (totalElegidos > MAX_RECURSOS_BLOQUE) return `Hasta ${MAX_RECURSOS_BLOQUE} recursos por operación.`
    if (accion === 'agregar') {
      for (const [id, e] of sum) {
        const c = Number(e.cantidad)
        if (!Number.isFinite(c) || c <= 0 || Math.round(c * 100) !== c * 100) return `La cantidad de «${suministros.find((s) => s.id === id)?.nombre ?? 'insumo'}» debe ser mayor que cero (hasta 2 decimales).`
      }
      for (const [id, e] of inv) {
        const c = Number(e.cantidad)
        if (!Number.isInteger(c) || c <= 0) return `La cantidad de «${inventario.find((i) => i.id === id)?.nombre ?? 'herramienta'}» debe ser un entero mayor que cero.`
      }
    }
    return null
  }

  async function aplicar() {
    if (enCurso.current) return
    const err = validar()
    if (err) { notify({ variant: 'error', title: 'Revisa la selección', text: err }); return }
    const { isConfirmed } = await confirm({
      title: accion === 'agregar' ? 'Agregar recursos' : 'Quitar recursos',
      text: accion === 'agregar'
        ? `Se vincularán ${totalElegidos} recurso${totalElegidos === 1 ? '' : 's'} a ${n} actividad${n === 1 ? '' : 'es'}. Los que ya estaban no cambian.`
        : `Se quitarán ${totalElegidos} recurso${totalElegidos === 1 ? '' : 's'} de ${n} actividad${n === 1 ? '' : 'es'}. Los que no estaban no cuentan.`,
      confirmText: accion === 'agregar' ? 'Agregar' : 'Quitar',
      variant: accion === 'quitar' ? 'danger' : undefined,
    })
    if (!isConfirmed) return
    enCurso.current = true
    setGuardando(true)
    try {
      const r = await aplicarRecursosEnBloque(proyectoId, plantillas.map((p) => p.id), accion, {
        suministros: [...sum].map(([id, e]) => ({ id, cantidad: Number(e.cantidad) })),
        inventario: [...inv].map(([id, e]) => ({ id, cantidad: Number(e.cantidad), obligatoria: e.obligatoria })),
      })
      notify({ variant: 'success', title: 'Listo', text: resumenBloque(r) })
      onAplicado()
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'No se aplicó nada', text: e instanceof Error ? e.message : 'Error inesperado.' })
    } finally {
      setGuardando(false)
      enCurso.current = false
    }
  }

  const filaEstilo = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 } as const
  const cantidadEstilo = { ...input, width: 74, padding: '4px 8px', fontSize: 12.5 } as const

  return (
    <EditModal
      title={`Recursos en bloque · ${n} actividad${n === 1 ? '' : 'es'}`}
      onClose={onClose}
      size="md"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--at-ink-soft)', marginRight: 'auto' }}>
            {totalElegidos} recurso{totalElegidos === 1 ? '' : 's'} elegido{totalElegidos === 1 ? '' : 's'}
          </span>
          <button onClick={onClose} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void aplicar()} disabled={guardando || totalElegidos === 0} style={btnPrimario}>
            {guardando ? 'Aplicando…' : accion === 'agregar' ? `Agregar a ${n} actividad${n === 1 ? '' : 'es'}` : `Quitar de ${n} actividad${n === 1 ? '' : 'es'}`}
          </button>
        </div>
      }
    >
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
        Actividades: {plantillas.map((p) => p.titulo).slice(0, 6).join(', ')}{n > 6 ? ` y ${n - 6} más` : ''}.
      </p>
      <div role="radiogroup" aria-label="Acción" style={{ display: 'flex', gap: 14, marginBottom: 10, fontSize: 13 }}>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
          <input type="radio" name="accion" checked={accion === 'agregar'} onChange={() => setAccion('agregar')} /> Agregar a las actividades
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
          <input type="radio" name="accion" checked={accion === 'quitar'} onChange={() => setAccion('quitar')} /> Quitar de las actividades
        </label>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
        {accion === 'agregar'
          ? 'Se aplica a todas las actividades a la vez. Los vínculos que ya existían conservan su cantidad y su «obligatoria».'
          : 'Se quita de todas las actividades a la vez. Las actividades que no tenían el recurso no cambian.'}
      </p>

      <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {PESTANAS.map((t) => {
          const cuenta = t.key === 'insumos' ? sum.size : [...inv.keys()].filter((id) => inventario.find((i) => i.id === id)?.categoria === (t.key === 'equipo' ? 'equipo' : 'herramienta')).length
          return (
            <button key={t.key} role="tab" aria-selected={pestana === t.key} onClick={() => { setPestana(t.key); setBusqueda('') }}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--at-line)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                       background: pestana === t.key ? 'var(--at-primary-soft)' : 'var(--at-surface-2)', color: pestana === t.key ? 'var(--at-primary)' : 'var(--at-ink-2)' }}>
              {t.label}{cuenta > 0 ? ` (${cuenta})` : ''}
            </button>
          )
        })}
      </div>
      <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre…" aria-label="Buscar recurso" style={{ ...input, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} />

      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--at-line)', borderRadius: 8, padding: '4px 10px' }}>
        {pestana === 'insumos' ? (
          filtra(listaSuministros).length === 0
            ? <p style={{ fontSize: 12.5, color: 'var(--at-ink-3)', margin: '8px 0' }}>{suministros.length === 0 ? 'No hay insumos activos en el proyecto (o no tienes permiso para ver Suministros).' : 'Nada con ese nombre.'}</p>
            : filtra(listaSuministros).map((s) => {
              const e = sum.get(s.id)
              return (
                <div key={s.id} style={filaEstilo}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!e} onChange={() => toggle('sum', s.id)} aria-label={`Elegir ${s.nombre}`} />
                    <span>{s.nombre} <span style={{ color: 'var(--at-ink-3)' }}>({s.unidad_medida}){!s.activo ? ' · inactivo' : ''}</span></span>
                  </label>
                  {e && accion === 'agregar' && (
                    <input type="number" min={0.01} step="any" value={e.cantidad} onChange={(ev) => cambiar('sum', s.id, { cantidad: ev.target.value })}
                      aria-label={`Cantidad de ${s.nombre}`} style={cantidadEstilo} />
                  )}
                </div>
              )
            })
        ) : (
          filtra(listaInventario).length === 0
            ? <p style={{ fontSize: 12.5, color: 'var(--at-ink-3)', margin: '8px 0' }}>{listaInventario.length === 0 ? `No hay ${pestana === 'equipo' ? 'equipo' : 'herramientas'} en el inventario del proyecto (o no tienes permiso para ver Inventario).` : 'Nada con ese nombre.'}</p>
            : filtra(listaInventario).map((i) => {
              const e = inv.get(i.id)
              return (
                <div key={i.id} style={filaEstilo}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!e} onChange={() => toggle('inv', i.id)} aria-label={`Elegir ${i.nombre}`} />
                    <span>{i.nombre}{i.estado === 'dado_de_baja' ? <span style={{ color: 'var(--at-ink-3)' }}> · dado de baja</span> : null}</span>
                  </label>
                  {e && accion === 'agregar' && (
                    <>
                      <input type="number" min={1} step={1} value={e.cantidad} onChange={(ev) => cambiar('inv', i.id, { cantidad: ev.target.value })}
                        aria-label={`Cantidad de ${i.nombre}`} style={cantidadEstilo} />
                      <label style={{ display: 'flex', gap: 3, alignItems: 'center', fontSize: 11.5, cursor: 'pointer' }} title="La ejecución no debería iniciarse sin este recurso">
                        <input type="checkbox" checked={e.obligatoria} onChange={(ev) => cambiar('inv', i.id, { obligatoria: ev.target.checked })} aria-label={`${i.nombre} obligatoria`} />
                        Obligatoria
                      </label>
                    </>
                  )}
                </div>
              )
            })
        )}
      </div>
    </EditModal>
  )
}
