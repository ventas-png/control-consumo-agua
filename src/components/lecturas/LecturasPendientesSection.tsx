import { useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Cliente, Contador, Proyecto, Registro, Ruta, Unidad } from '../../types'
import { aguaKeys } from '../../domain/agua/keys'
import { queryClient } from '../../domain/queryClient'
import {
  BUCKET_OMISIONES,
  MOTIVOS_OMISION,
  descartarLecturaOmitida,
  diasPendiente,
  etiquetaMotivo,
  fetchLecturasOmitidas,
  rutaDePendientes,
  type EstadoOmision,
  type LecturaOmitida,
} from '../../domain/agua/lecturasOmitidas'
import { FilterChips } from '../shared/FilterChips'
import { EmptyState } from '../shared/EmptyState'
import { SecureImage } from '../shared/SecureImage'
import { ModalPortal } from '../shared/ModalPortal'
import { notify } from '../shared/Dialog'
import { openTextPrompt } from '../shared/PromptDialog'

interface Props {
  unidades: Unidad[]
  contadores: Contador[]
  clientes: Cliente[]
  rutas: Ruta[]
  proyectos: Proyecto[]
  registros: Registro[]
  /** Arranca Nueva Lectura recorriendo las pendientes elegidas. */
  onRecorrer: (ruta: Ruta) => void
  /** agua.lecturas.create: tomar la lectura. */
  canTomar: boolean
  /** agua.rutas.edit: descartar una pendiente que ya no se va a leer. */
  canDescartar: boolean
}

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' })

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })

/**
 * Lecturas que no se pudieron tomar en ruta, con su motivo y evidencia, y
 * desde dónde se retoman. Una pendiente se cierra sola cuando entra una
 * lectura de su contador (trigger en la base), o a mano con «Descartar».
 */
export function LecturasPendientesSection({
  unidades, contadores, clientes, rutas, proyectos, registros,
  onRecorrer, canTomar, canDescartar,
}: Props) {
  const [estado, setEstado] = useState<EstadoOmision>('pendiente')
  const [proyectoId, setProyectoId] = useState('')
  const [rutaId, setRutaId] = useState('')
  const [fotoAbierta, setFotoAbierta] = useState<string | null>(null)

  const query = useQuery({
    queryKey: aguaKeys.lecturasOmitidas(estado),
    queryFn: async () => {
      const r = await fetchLecturasOmitidas(estado)
      if (r.error) throw new Error(r.error)
      return r.data
    },
  })
  // El conteo de pendientes se ve desde cualquier pestaña.
  const pendientesQuery = useQuery({
    queryKey: aguaKeys.lecturasOmitidas('pendiente'),
    queryFn: async () => (await fetchLecturasOmitidas('pendiente')).data,
    enabled: estado !== 'pendiente',
  })
  const totalPendientes = estado === 'pendiente' ? query.data?.length : pendientesQuery.data?.length

  const unidadPorId = useMemo(() => new Map(unidades.map(u => [u.id, u])), [unidades])
  const contadorPorId = useMemo(() => new Map(contadores.map(c => [c.id, c])), [contadores])
  const clientePorId = useMemo(() => new Map(clientes.map(c => [c.id, c])), [clientes])
  const rutaPorId = useMemo(() => new Map(rutas.map(r => [r.id, r])), [rutas])
  const proyectoPorId = useMemo(() => new Map(proyectos.map(p => [p.id, p])), [proyectos])
  const registroPorId = useMemo(() => new Map(registros.map(r => [r.id, r])), [registros])

  const filas = useMemo(() => query.data ?? [], [query.data])
  const filtradas = useMemo(() => {
    const nombreUnidad = (o: LecturaOmitida) => unidadPorId.get(o.unidad_id)?.nombre ?? ''
    return filas
      .filter(o => !proyectoId || o.project_id === proyectoId)
      .filter(o => !rutaId || (rutaId === '_sin' ? !o.ruta_id : o.ruta_id === rutaId))
      // Para recorrer en campo conviene ir por proyecto y por unidad, no por fecha.
      .sort((a, b) =>
        estado === 'pendiente'
          ? (proyectoPorId.get(a.project_id)?.nombre ?? '').localeCompare(proyectoPorId.get(b.project_id)?.nombre ?? '') ||
            nombreUnidad(a).localeCompare(nombreUnidad(b), 'es', { numeric: true })
          : (b.cerrada_at ?? b.omitida_at).localeCompare(a.cerrada_at ?? a.omitida_at),
      )
  }, [filas, proyectoId, rutaId, estado, unidadPorId, proyectoPorId])

  const proyectosConFilas = useMemo(
    () => [...new Set(filas.map(o => o.project_id))].map(id => proyectoPorId.get(id)).filter((p): p is Proyecto => !!p),
    [filas, proyectoPorId],
  )
  const rutasConFilas = useMemo(
    () => [...new Set(filas.map(o => o.ruta_id).filter((id): id is string => !!id))]
      .map(id => rutaPorId.get(id)).filter((r): r is Ruta => !!r),
    [filas, rutaPorId],
  )
  const haySinRuta = filas.some(o => !o.ruta_id)
  const recorribles = estado === 'pendiente' ? filtradas.filter(o => o.contador_id && contadorPorId.has(o.contador_id)) : []

  function recorrer(lista: LecturaOmitida[], nombre: string) {
    const ruta = rutaDePendientes(lista, nombre)
    if (ruta) onRecorrer(ruta)
  }

  async function descartar(o: LecturaOmitida) {
    const nota = await openTextPrompt({
      title: 'Descartar lectura pendiente',
      description: 'Ya no se va a tomar esta lectura (contador retirado, unidad deshabitada…). Queda registrado quién la descartó y por qué.',
      label: 'Motivo del descarte',
      placeholder: 'Ej.: contador retirado por la administración',
      required: true,
      validate: v => (v.trim().length < 5 ? 'Escriba el motivo (mínimo 5 caracteres).' : null),
    })
    if (!nota) return
    const { error } = await descartarLecturaOmitida(o.id, nota.trim())
    if (error) {
      notify({ variant: 'error', title: 'No se pudo descartar', text: error })
      return
    }
    notify({ variant: 'success', title: 'Descartada', text: 'La lectura pendiente quedó cerrada.', duration: 2200 })
    void queryClient.invalidateQueries({ queryKey: aguaKeys.lecturasOmitidas() })
  }

  const selectStyle: CSSProperties = { padding: '8px 12px', border: '2px solid var(--at-line)', borderRadius: '10px', fontSize: '14px', background: 'var(--at-surface)', color: 'var(--at-ink)', maxWidth: '100%' }
  const botonPrimario: CSSProperties = { padding: '10px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', fontSize: '14px' }
  const botonSecundario: CSSProperties = { padding: '10px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', display: 'grid', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px' }}>Lecturas pendientes</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)', maxWidth: '640px' }}>
              Paradas que no se pudieron leer en ruta. Cada una se cierra sola cuando se registra la lectura de su contador.
            </p>
          </div>
          {canTomar && recorribles.length > 0 && (
            <button type="button" style={botonPrimario} onClick={() => recorrer(recorribles, 'Lecturas pendientes')}>
              ▶️ Recorrer pendientes ({recorribles.length})
            </button>
          )}
        </div>

        <FilterChips<EstadoOmision>
          ariaLabel="Estado"
          value={estado}
          onChange={v => { setEstado(v); setRutaId('') }}
          options={[
            { value: 'pendiente', label: 'Pendientes', count: totalPendientes },
            { value: 'resuelta', label: 'Resueltas' },
            { value: 'descartada', label: 'Descartadas' },
          ]}
        />

        {(proyectosConFilas.length > 1 || rutasConFilas.length > 0) && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {proyectosConFilas.length > 1 && (
              <select aria-label="Proyecto" value={proyectoId} onChange={e => setProyectoId(e.target.value)} style={selectStyle}>
                <option value="">Todos los proyectos</option>
                {proyectosConFilas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            )}
            {rutasConFilas.length > 0 && (
              <select aria-label="Ruta" value={rutaId} onChange={e => setRutaId(e.target.value)} style={selectStyle}>
                <option value="">Todas las rutas</option>
                {rutasConFilas.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                {haySinRuta && <option value="_sin">Sin ruta</option>}
              </select>
            )}
          </div>
        )}
      </div>

      {query.isLoading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--at-ink-3)' }}>Cargando…</div>
      ) : query.error ? (
        <EmptyState icon="⚠️" title="No se pudieron cargar las lecturas pendientes" description={(query.error as Error).message} />
      ) : filtradas.length === 0 ? (
        <EmptyState
          icon={estado === 'pendiente' ? '✅' : '📋'}
          title={estado === 'pendiente' ? 'No hay lecturas pendientes' : estado === 'resuelta' ? 'Sin lecturas resueltas' : 'Sin lecturas descartadas'}
          description={estado === 'pendiente' ? 'Cuando en una ruta se salte una unidad, aparecerá aquí con su motivo y su foto.' : undefined}
        />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '12px' }}>
          {filtradas.map(o => {
            const unidad = unidadPorId.get(o.unidad_id)
            const contador = o.contador_id ? contadorPorId.get(o.contador_id) : undefined
            const cliente = unidad?.cliente_id ? clientePorId.get(unidad.cliente_id) : undefined
            const ruta = o.ruta_id ? rutaPorId.get(o.ruta_id) : undefined
            const registro = o.registro_id ? registroPorId.get(o.registro_id) : undefined
            const dias = diasPendiente(o.omitida_at)
            return (
              <li key={o.id} data-testid="lectura-pendiente" style={{ background: 'var(--at-surface)', borderRadius: '14px', padding: '16px', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', border: '1px solid var(--at-line)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                {o.foto_path && (
                  <button
                    type="button"
                    onClick={() => setFotoAbierta(o.foto_path)}
                    aria-label="Ver foto de evidencia"
                    style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', flexShrink: 0 }}
                  >
                    <SecureImage
                      src={o.foto_path}
                      bucket={BUCKET_OMISIONES}
                      alt="Evidencia"
                      style={{ width: '96px', height: '96px', objectFit: 'cover', borderRadius: '10px', display: 'block' }}
                      placeholder={<div style={{ width: '96px', height: '96px', borderRadius: '10px', background: 'var(--at-surface-2)' }} />}
                    />
                  </button>
                )}
                <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: '4px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '15px' }}>{unidad?.nombre ?? 'Unidad'}</strong>
                    {cliente && <span style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>— {cliente.nombre}</span>}
                    <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 10px', borderRadius: '999px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: '1px solid var(--at-warning-border)' }}>
                      {etiquetaMotivo(o.motivo)}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', fontFamily: contador ? 'monospace' : undefined }}>
                    {contador ? `${contador.numero_serie} (${contador.tipo_agua})` : 'Sin contador: la unidad no tenía contadores activos'}
                  </div>
                  {o.detalle && <div style={{ fontSize: '13px' }}>“{o.detalle}”</div>}
                  <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                    {o.omitida_por_nombre ?? 'Lecturista'} · {fechaCorta(o.omitida_at)} {hora(o.omitida_at)}
                    {estado === 'pendiente' && dias > 0 && <strong style={{ color: dias >= 7 ? 'var(--at-danger)' : 'var(--at-ink-2)' }}> · hace {dias} día{dias === 1 ? '' : 's'}</strong>}
                    {ruta && <> · Ruta {ruta.nombre}</>}
                    {proyectosConFilas.length > 1 && <> · {proyectoPorId.get(o.project_id)?.nombre}</>}
                    {o.gps && (
                      <> · <a href={`https://www.google.com/maps?q=${o.gps.lat},${o.gps.lng}`} target="_blank" rel="noreferrer">ubicación</a></>
                    )}
                  </div>
                  {o.estado === 'resuelta' && o.cerrada_at && (
                    <div style={{ fontSize: '13px', color: 'var(--at-success-strong)' }}>
                      ✅ Leída el {fechaCorta(o.cerrada_at)}{registro?.lectura_actual != null ? ` · lectura ${registro.lectura_actual}` : ''}
                    </div>
                  )}
                  {o.estado === 'descartada' && o.cerrada_at && (
                    <div style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>
                      🗑️ Descartada el {fechaCorta(o.cerrada_at)}{o.nota_cierre ? `: ${o.nota_cierre}` : ''}
                    </div>
                  )}
                </div>
                {o.estado === 'pendiente' && (canTomar || canDescartar) && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {canTomar && contador && (
                      <button type="button" style={botonPrimario} onClick={() => recorrer([o], `Pendiente: ${unidad?.nombre ?? contador.numero_serie}`)}>
                        📝 Tomar lectura
                      </button>
                    )}
                    {canDescartar && (
                      <button type="button" style={botonSecundario} onClick={() => void descartar(o)}>
                        Descartar
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {estado === 'pendiente' && filtradas.length > 0 && (
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>
          Motivos: {MOTIVOS_OMISION.map(m => {
            const n = filtradas.filter(o => o.motivo === m.value).length
            return n ? `${m.label} ${n}` : null
          }).filter(Boolean).join(' · ')}
        </p>
      )}

      {fotoAbierta && (
        <ModalPortal>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Foto de evidencia"
            onClick={() => setFotoAbierta(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', cursor: 'zoom-out' }}
          >
            <SecureImage src={fotoAbierta} bucket={BUCKET_OMISIONES} alt="Evidencia" style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: '10px' }} />
          </div>
        </ModalPortal>
      )}
    </div>
  )
}
