// Minutas de reunión (antes «Notas Admin»; misma tabla y permisos notas_admin).
//
// La lista va en tarjetas: quiénes participaron, cuántos puntos, el avance de
// los compromisos y el próximo seguimiento. El detalle y el formulario abren
// en ventana; el formulario es un asistente de tres pasos (participantes →
// puntos → acuerdos), ver minutas/MinutaWizard.
import { useMemo, useState, type CSSProperties } from 'react'
import { Button } from '../../shared/Button'
import { EmptyState } from '../../shared/EmptyState'
import { FilterChips } from '../../shared/FilterChips'
import { tint } from '../../shared/statusTone'
import {
  fechaDeMinuta, gestorDe, participantesDe, plazoSeguimiento, puntosDe, resumenCompromisos,
} from '../../../domain/condominios/minutas'
import { diasHastaFechaCalendario, formatFechaCalendario } from '../../../lib/format'
import { normalizarNombre } from '../../../domain/proveedores/identidad'
import type { CargoCatalogo, CategoriaNota, ContratoArrendamiento, ContratoProveedor, NotaAdmin, PersonalCondominio, Unidad } from '../../../types'
import { AvataresApilados, BarraAvance, CATEGORIAS, categoriaInfo, inp, prioridadInfo } from './minutas/comun'
import { MinutaDetalle } from './minutas/MinutaDetalle'
import { MinutaWizard } from './minutas/MinutaWizard'
import './minutas/minutas.css'

interface Props {
  notas: NotaAdmin[]
  proyectoId: string
  companyId: string
  autorNombre: string
  /** Listas para elegir participantes (las carga la sección). */
  personal?: PersonalCondominio[]
  cargos?: CargoCatalogo[]
  unidades?: Unidad[]
  contratos?: ContratoArrendamiento[]
  contratosProveedores?: ContratoProveedor[]
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.notas_admin.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

type FiltroEstado = 'abiertas' | 'vencidas' | 'cerradas' | 'todas'

const SIN_LISTA: never[] = []

export default function NotasAdminTab({
  notas, proyectoId, companyId, autorNombre,
  personal = SIN_LISTA, cargos = SIN_LISTA, unidades = SIN_LISTA, contratos = SIN_LISTA, contratosProveedores = SIN_LISTA,
  canCreate, canEdit, canDelete, onRefresh,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [wizard, setWizard] = useState<{ abierto: boolean; nota: NotaAdmin | null }>({ abierto: false, nota: null })
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('abiertas')
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaNota | ''>('')
  const [busqueda, setBusqueda] = useState('')

  // Lo derivado de cada minuta (participantes, puntos, resumen) se calcula una
  // vez por render de la lista, no por tarjeta y por filtro.
  const filas = useMemo(() => notas.map(n => {
    const participantes = participantesDe(n)
    const puntos = puntosDe(n)
    return { n, participantes, puntos, gestor: gestorDe(participantes), resumen: resumenCompromisos(puntos), fecha: fechaDeMinuta(n) }
  }), [notas])

  const abiertas = filas.filter(f => !f.n.resuelta)
  const totales = {
    abiertas: abiertas.length,
    cerradas: filas.length - abiertas.length,
    pendientes: abiertas.reduce((s, f) => s + f.resumen.pendientes, 0),
    vencidos: abiertas.reduce((s, f) => s + f.resumen.vencidos, 0),
    conVencidos: abiertas.filter(f => f.resumen.vencidos > 0).length,
  }

  const texto = normalizarNombre(busqueda)
  const lista = filas
    .filter(f =>
      (filtroEstado === 'todas' || (filtroEstado === 'cerradas' ? f.n.resuelta : !f.n.resuelta)) &&
      (filtroEstado !== 'vencidas' || f.resumen.vencidos > 0) &&
      (filtroCategoria === '' || f.n.categoria === filtroCategoria) &&
      (!texto || normalizarNombre(f.n.titulo).includes(texto) || f.participantes.some(p => normalizarNombre(p.nombre).includes(texto)) || f.puntos.some(p => normalizarNombre(p.titulo).includes(texto))),
    )
    .sort((a, b) => {
      if (a.n.resuelta !== b.n.resuelta) return a.n.resuelta ? 1 : -1
      if (a.n.fijada !== b.n.fijada) return a.n.fijada ? -1 : 1
      return b.fecha.localeCompare(a.fecha) || b.n.created_at.localeCompare(a.n.created_at)
    })

  const seleccionada = selectedId ? notas.find(n => n.id === selectedId) ?? null : null

  function abrirNueva() { setSelectedId(null); setWizard({ abierto: true, nota: null }) }
  function abrirEdicion(n: NotaAdmin) { setWizard({ abierto: true, nota: n }) }

  const resumenBtn = (activo: boolean, color: string): CSSProperties => ({
    display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', minWidth: 0,
    background: activo ? tint(color, 16) : 'var(--at-surface)', border: `1.5px solid ${activo ? color : 'var(--at-line)'}`, color: 'var(--at-ink)', fontFamily: 'inherit',
  })

  return (
    <div className="minuta-lista-cuerpo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, padding: '4px 0', minWidth: 0 }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--at-ink)' }}>Minutas de reunión</div>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Participantes, puntos abordados y seguimiento de acuerdos y compromisos.</div>
        </div>
        {canCreate && <Button variant="primary" onClick={abrirNueva}>+ Nueva minuta</Button>}
      </div>

      {/* Resumen clicable */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 8 }}>
        <button type="button" aria-pressed={filtroEstado === 'abiertas'} onClick={() => setFiltroEstado('abiertas')} style={resumenBtn(filtroEstado === 'abiertas', 'var(--at-info)')}>
          <span style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600 }}>Abiertas</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--at-info)' }}>{totales.abiertas}</span>
        </button>
        <div style={{ ...resumenBtn(false, 'var(--at-accent)'), cursor: 'default' }}>
          <span style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600 }}>Compromisos pendientes</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--at-accent)' }}>{totales.pendientes}</span>
        </div>
        <button type="button" aria-pressed={filtroEstado === 'vencidas'} onClick={() => setFiltroEstado('vencidas')} style={resumenBtn(filtroEstado === 'vencidas', 'var(--at-danger)')}>
          <span style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600 }}>Compromisos vencidos</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: totales.vencidos > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{totales.vencidos}</span>
        </button>
        <button type="button" aria-pressed={filtroEstado === 'cerradas'} onClick={() => setFiltroEstado('cerradas')} style={resumenBtn(filtroEstado === 'cerradas', 'var(--at-success)')}>
          <span style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600 }}>Cerradas</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--at-success)' }}>{totales.cerradas}</span>
        </button>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <FilterChips ariaLabel="Estado de la minuta" value={filtroEstado} onChange={setFiltroEstado} options={[
          { value: 'abiertas', label: 'Abiertas', count: totales.abiertas, color: 'var(--at-info)' },
          { value: 'vencidas', label: 'Con vencidos', count: totales.conVencidos, color: 'var(--at-danger)' },
          { value: 'cerradas', label: 'Cerradas', count: totales.cerradas, color: 'var(--at-success)' },
          { value: 'todas', label: 'Todas', count: filas.length },
        ]} />
        <select aria-label="Categoría" style={{ ...inp, width: 'auto', minWidth: 170 }} value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaNota | '')}>
          <option value="">Todas las categorías</option>
          {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
        </select>
        <input type="search" aria-label="Buscar minuta" placeholder="Buscar por título, participante o punto…" style={{ ...inp, flex: 1, minWidth: 200 }}
          value={busqueda} onChange={e => setBusqueda(e.target.value)} />
      </div>

      {/* Lista */}
      {lista.length === 0 ? (
        <EmptyState
          icon="🗒️"
          title={filas.length === 0 ? 'Aún no hay minutas' : 'Ninguna minuta coincide'}
          description={filas.length === 0
            ? 'Registra la primera reunión: quiénes participaron, qué se abordó y qué se acordó.'
            : 'Cambia el filtro o la búsqueda para ver otras minutas.'}
          action={canCreate && filas.length === 0 ? <Button variant="primary" onClick={abrirNueva}>+ Nueva minuta</Button> : undefined}
          compact
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
          {lista.map(({ n, participantes, puntos, gestor, resumen, fecha }) => {
            const cat = categoriaInfo(n.categoria)
            const prio = prioridadInfo(n.prioridad)
            const diasSeg = !n.resuelta ? diasHastaFechaCalendario(n.fecha_recordatorio) : null
            return (
              <button key={n.id} type="button" onClick={() => setSelectedId(n.id)}
                style={{
                  textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--at-ink)', display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 14,
                  background: n.fijada && !n.resuelta ? 'var(--at-warning-tint)' : 'var(--at-surface)',
                  border: `1px solid ${n.fijada && !n.resuelta ? 'var(--at-warning-border)' : 'var(--at-line)'}`,
                  opacity: n.resuelta ? 0.8 : 1, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: tint(cat.color, 14), color: cat.color }}>{cat.icon} {cat.label}</span>
                  {prio.value !== 'normal' && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: prio.bg, color: prio.color }}>{prio.label}</span>}
                  {n.fijada && !n.resuelta && <span title="Fijada" aria-label="Fijada" style={{ fontSize: 12 }}>📌</span>}
                  {n.resuelta && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--at-success-tint)', color: 'var(--at-success-strong)' }}>✓ Cerrada</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--at-ink-3)', whiteSpace: 'nowrap' }}>📅 {formatFechaCalendario(fecha, { day: 'numeric', month: 'short', year: 'numeric' }) || '—'}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{n.titulo}</div>
                {gestor && <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>★ Gestiona <span style={{ color: 'var(--at-ink-2)', fontWeight: 600 }}>{gestor.nombre}</span></div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {participantes.length > 0 ? <AvataresApilados participantes={participantes} /> : <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Sin participantes</span>}
                  <span style={{ fontSize: 12, color: 'var(--at-ink-2)' }}>
                    {puntos.length} punto{puntos.length === 1 ? '' : 's'}{resumen.acuerdos > 0 ? ` · ${resumen.acuerdos} acuerdo${resumen.acuerdos === 1 ? '' : 's'}` : ''}
                  </span>
                </div>
                {resumen.total > 0 && (
                  <div style={{ display: 'grid', gap: 4 }}>
                    <BarraAvance cumplidos={resumen.cumplidos} total={resumen.total} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--at-ink-3)' }}>
                      <span>{resumen.cumplidos}/{resumen.total} compromisos cumplidos</span>
                      {resumen.vencidos > 0 && !n.resuelta && <span style={{ color: 'var(--at-danger)', fontWeight: 700 }}>⚠ {resumen.vencidos} vencido{resumen.vencidos === 1 ? '' : 's'}</span>}
                    </div>
                  </div>
                )}
                {diasSeg !== null && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: diasSeg < 0 ? 'var(--at-danger)' : diasSeg === 0 ? 'var(--at-warning-strong)' : 'var(--at-ink-3)' }}>
                    ⏰ Seguimiento {plazoSeguimiento(diasSeg)}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {seleccionada && !wizard.abierto && (
        <MinutaDetalle nota={seleccionada} canEdit={canEdit} canDelete={canDelete}
          onClose={() => setSelectedId(null)} onEditar={() => abrirEdicion(seleccionada)} onRefresh={onRefresh} />
      )}

      {wizard.abierto && (
        <MinutaWizard nota={wizard.nota} proyectoId={proyectoId} companyId={companyId} autorNombre={autorNombre}
          personal={personal} cargos={cargos} unidades={unidades} contratos={contratos} contratosProveedores={contratosProveedores}
          onClose={() => setWizard({ abierto: false, nota: null })}
          onGuardado={() => { setWizard({ abierto: false, nota: null }); onRefresh() }} />
      )}
    </div>
  )
}
