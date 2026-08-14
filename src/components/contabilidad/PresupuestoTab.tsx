import { useEffect, useMemo, useState } from 'react'
import { DataTable, type DataTableColumn } from '../shared'
import { EditModal } from '../shared'
import { FilterChips } from '../shared/FilterChips'
import { StatusBadge } from '../shared/StatusBadge'
import { confirm, notify } from '../shared/Dialog'
import { useCuentasQuery } from '../../domain/contabilidad/queries'
import { usePartidasQuery, usePresupuestosQuery, usePresupuestoVsRealQuery } from '../../domain/presupuesto/queries'
import {
  useCambiarEstadoPresupuestoMutation,
  useCrearPresupuestoMutation,
  useEliminarPresupuestoMutation,
  useGuardarPartidasMutation,
} from '../../domain/presupuesto/mutations'
import { distribuirAnual, presupuestoFormSchema, totalFila, type PartidaInput } from '../../domain/presupuesto/schemas'
import { proyeccionPresupuesto } from '../../domain/presupuesto/proyeccion'
import { PresupuestoVsRealChart } from './PresupuestoVsRealChart'
import { ImportPartidasModal, type ModoCarga } from './ImportPartidasModal'
import type { PartidaResuelta } from '../../domain/presupuesto/importPartidas'
import { formatCurrency, formatPercent } from '../../lib/format'
import {
  ESTADO_PRESUPUESTO_LABELS,
  MESES_CORTOS,
  periodosDelAnio,
  type PresupuestoConPartidas,
} from '../../types/presupuesto'
import type { Proyecto } from '../../types'
import { Campo, btnLink, btnPrimario, btnSecundario, input, usePermisosContabilidad } from './ui'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  proyectos: Proyecto[]
  monedaBase: string
}

type Vista = 'presupuestos' | 'comparativo'

const TONO_ESTADO = { borrador: 'info', propuesto: 'warning', aprobado: 'success', archivado: 'neutral' } as const

export function PresupuestoTab({ companyId, projectId, proyectos, monedaBase }: Props) {
  const { puedeCrear, puedeEditar, puedeCambiarEstado, puedeAutorizar, puedeEliminar } = usePermisosContabilidad()
  const [vista, setVista] = useState<Vista>('presupuestos')
  const [nuevo, setNuevo] = useState(false)
  const [editorId, setEditorId] = useState<string | null>(null)

  const { data: todosPresupuestos = [], isLoading } = usePresupuestosQuery(companyId)
  // Solo los presupuestos del LEDGER activo (empresa o el proyecto).
  const presupuestos = useMemo(
    () => todosPresupuestos.filter((p) => (p.project_id ?? null) === projectId),
    [todosPresupuestos, projectId],
  )
  const cambiarEstado = useCambiarEstadoPresupuestoMutation(companyId)
  const eliminar = useEliminarPresupuestoMutation(companyId)

  const editor = presupuestos.find((p) => p.id === editorId) ?? null

  async function accion(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn()
      notify({ variant: 'success', title: 'Listo', text: ok })
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo completar la acción.' })
    }
  }

  const columns: DataTableColumn<PresupuestoConPartidas>[] = [
    { key: 'anio', header: 'Año', accessor: (p) => p.anio, sortable: true, width: 70 },
    { key: 'nombre', header: 'Presupuesto', accessor: (p) => p.nombre, sortable: true },
    {
      key: 'ambito',
      header: 'Ámbito',
      accessor: (p) => p.project_id ?? '',
      render: (p) => (p.project_id ? proyectos.find((x) => x.id === p.project_id)?.nombre ?? 'Proyecto' : 'Empresa'),
      width: 140,
      hideOnMobile: true,
    },
    {
      key: 'total',
      header: `Total anual (${monedaBase})`,
      accessor: (p) => p.presupuesto_partidas.reduce((s, x) => s + x.monto, 0),
      render: (p) => formatCurrency(p.presupuesto_partidas.reduce((s, x) => s + x.monto, 0), monedaBase),
      numeric: true,
      width: 150,
    },
    {
      key: 'estado',
      header: 'Estado',
      accessor: (p) => p.estado,
      render: (p) => <StatusBadge tone={TONO_ESTADO[p.estado]}>{ESTADO_PRESUPUESTO_LABELS[p.estado]}</StatusBadge>,
      width: 100,
    },
    {
      key: 'acciones',
      header: '',
      render: (p) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {(p.estado === 'borrador' || p.estado === 'propuesto') && puedeEditar && (
            <button onClick={(e) => { e.stopPropagation(); setEditorId(p.id) }} style={btnLink}>Partidas</button>
          )}
          {p.estado === 'borrador' && puedeCambiarEstado && (
            <button onClick={(e) => { e.stopPropagation(); void accion(() => cambiarEstado.mutateAsync({ presupuestoId: p.id, estado: 'propuesto' }), 'Presupuesto propuesto para aprobación.') }} style={btnLink}>
              Proponer
            </button>
          )}
          {p.estado === 'propuesto' && puedeAutorizar && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void (async () => {
                  const { isConfirmed } = await confirm({
                    title: '¿Aprobar presupuesto?',
                    text: 'Quedará vigente para su año y ámbito (la versión aprobada anterior se archiva). Después de aprobar, las partidas son de solo lectura.',
                    confirmText: 'Aprobar',
                  })
                  if (isConfirmed) void accion(() => cambiarEstado.mutateAsync({ presupuestoId: p.id, estado: 'aprobado' }), 'Presupuesto aprobado y vigente.')
                })()
              }}
              style={btnLink}
            >
              Aprobar
            </button>
          )}
          {p.estado === 'aprobado' && (
            <button onClick={(e) => { e.stopPropagation(); setVista('comparativo') }} style={btnLink}>Comparativo</button>
          )}
          {(p.estado === 'borrador' || p.estado === 'propuesto') && puedeEliminar && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void (async () => {
                  const partidas = p.presupuesto_partidas.length
                  const { isConfirmed } = await confirm({
                    title: `¿Eliminar "${p.nombre}"?`,
                    text: partidas > 0
                      ? `Se borran también sus ${partidas} partida${partidas === 1 ? '' : 's'} mensuales. Esta acción no se puede deshacer.`
                      : 'Esta acción no se puede deshacer.',
                    confirmText: 'Eliminar',
                    variant: 'danger',
                  })
                  if (isConfirmed) void accion(() => eliminar.mutateAsync(p.id), 'Presupuesto eliminado.')
                })()
              }}
              style={{ ...btnLink, color: 'var(--at-danger)' }}
            >
              Eliminar
            </button>
          )}
        </div>
      ),
      width: 200,
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <FilterChips<Vista>
        options={[
          { value: 'presupuestos', label: 'Presupuestos' },
          { value: 'comparativo', label: 'Presupuesto vs real' },
        ]}
        value={vista}
        onChange={setVista}
        ariaLabel="Vista de presupuesto"
      />

      {vista === 'presupuestos' && (
        <DataTable<PresupuestoConPartidas>
          data={presupuestos}
          columns={columns}
          rowKey="id"
          isLoading={isLoading}
          searchableKeys={['nombre']}
          defaultSort={{ key: 'anio', direction: 'desc' }}
          toolbar={puedeCrear
            ? <button onClick={() => setNuevo(true)} style={btnPrimario}>+ Nuevo presupuesto</button>
            : undefined}
          emptyState={{
            title: 'Sin presupuestos',
            description: 'Crea el presupuesto anual con partidas mensuales ligadas a cuentas contables; el comparativo contra lo real sale de la contabilidad.',
          }}
        />
      )}

      {vista === 'comparativo' && (
        <ComparativoView companyId={companyId} presupuestos={presupuestos} proyectos={proyectos} monedaBase={monedaBase} />
      )}

      {nuevo && (
        <NuevoPresupuestoModal companyId={companyId} projectId={projectId} onClose={() => setNuevo(false)} onCreado={(id) => { setNuevo(false); setEditorId(id) }} />
      )}
      {editor && (
        <PartidasEditorModal companyId={companyId} presupuesto={editor} monedaBase={monedaBase} onClose={() => setEditorId(null)} />
      )}
    </div>
  )
}

// ── Modal: crear presupuesto ────────────────────────────────────────────────

function NuevoPresupuestoModal({ companyId, projectId, onClose, onCreado }: {
  companyId: string
  projectId: string | null
  onClose: () => void
  onCreado: (id: string) => void
}) {
  const crear = useCrearPresupuestoMutation(companyId)
  const anioActual = new Date().getFullYear()
  const [f, setF] = useState({ anio: String(anioActual + (new Date().getMonth() >= 9 ? 1 : 0)), nombre: '', notas: '' })

  async function guardar() {
    const anio = parseInt(f.anio, 10)
    const parsed = presupuestoFormSchema.safeParse({
      anio,
      nombre: f.nombre.trim() || `Presupuesto ${anio}`,
      project_id: projectId,
      notas: f.notas.trim() || null,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    try {
      const p = await crear.mutateAsync(parsed.data)
      notify({ variant: 'success', title: 'Creado', text: 'Presupuesto creado; captura sus partidas.' })
      onCreado(p.id)
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo crear.' })
    }
  }

  return (
    <EditModal title="Nuevo presupuesto" onClose={onClose} size="sm"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void guardar()} disabled={crear.isPending} style={btnPrimario}>Crear</button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10 }}>
          <Campo label="Año">
            <input type="number" min="2000" max="2100" value={f.anio} onChange={(e) => setF({ ...f, anio: e.target.value })} style={input} />
          </Campo>
          <Campo label="Nombre">
            <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} style={input} placeholder={`Presupuesto ${f.anio}`} />
          </Campo>
        </div>

        <Campo label="Notas">
          <textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} style={{ ...input, minHeight: 50 }} />
        </Campo>
      </div>
    </EditModal>
  )
}

// ── Modal: editor de partidas (cuentas × 12 meses) ──────────────────────────

function PartidasEditorModal({ companyId, presupuesto, monedaBase, onClose }: {
  companyId: string
  presupuesto: PresupuestoConPartidas
  monedaBase: string
  onClose: () => void
}) {
  // Cuentas del LEDGER del presupuesto (la BD valida partida↔cuenta del mismo ledger).
  const { data: cuentas = [] } = useCuentasQuery(companyId, presupuesto.project_id ?? null)
  const { data: partidas = [], isLoading } = usePartidasQuery(presupuesto.id)
  const guardar = useGuardarPartidasMutation(companyId)

  const periodos = useMemo(() => periodosDelAnio(presupuesto.anio), [presupuesto.anio])
  // Presupuestables: cuentas de detalle de resultados (ingresos y gastos).
  const elegibles = useMemo(
    () => cuentas.filter((c) => c.es_detalle && c.activa && (c.tipo === 'gasto' || c.tipo === 'ingreso')),
    [cuentas],
  )

  // grid: cuenta_id → 12 montos (índice = mes-1)
  const [grid, setGrid] = useState<Record<string, number[]>>({})
  const [cuentaNueva, setCuentaNueva] = useState('')
  const [importando, setImportando] = useState(false)

  useEffect(() => {
    const g: Record<string, number[]> = {}
    for (const p of partidas) {
      const mes = parseInt(p.periodo.slice(5), 10) - 1
      if (!g[p.cuenta_id]) g[p.cuenta_id] = Array(12).fill(0)
      g[p.cuenta_id][mes] = p.monto
    }
    setGrid(g)
  }, [partidas])

  const filas = useMemo(
    () => Object.keys(grid)
      .map((id) => ({ cuenta: cuentas.find((c) => c.id === id), meses: grid[id] }))
      .filter((f): f is { cuenta: NonNullable<typeof f.cuenta>; meses: number[] } => !!f.cuenta)
      .sort((a, b) => a.cuenta.codigo.localeCompare(b.cuenta.codigo, 'es')),
    [grid, cuentas],
  )

  const totalAnual = useMemo(() => totalFila(filas.flatMap((f) => f.meses)), [filas])

  function setMonto(cuentaId: string, mes: number, valor: string) {
    setGrid((g) => {
      const meses = [...(g[cuentaId] ?? Array(12).fill(0))]
      meses[mes] = parseFloat(valor) || 0
      return { ...g, [cuentaId]: meses }
    })
  }

  /**
   * Vuelca las partidas del archivo en el grid. No guarda: el usuario revisa y
   * usa "Guardar partidas", que es el único camino de escritura (y el que la BD
   * bloquea si el presupuesto ya está aprobado).
   */
  function aplicarImportacion(partidas: PartidaResuelta[], modo: ModoCarga) {
    setGrid((g) => {
      const base: Record<string, number[]> = modo === 'reemplazar' ? {} : { ...g }
      for (const p of partidas) base[p.cuenta_id] = [...p.meses]
      return base
    })
    setImportando(false)
    notify({
      variant: 'success',
      title: 'Partidas cargadas',
      text: `${partidas.length} cuenta${partidas.length === 1 ? '' : 's'} en el editor. Revisa los montos y presiona "Guardar partidas".`,
    })
  }

  function repartir(cuentaId: string) {
    const anualStr = window.prompt('Monto anual a repartir en 12 meses:')
    const anual = parseFloat(anualStr ?? '')
    if (!Number.isFinite(anual) || anual <= 0) return
    setGrid((g) => ({ ...g, [cuentaId]: distribuirAnual(anual) }))
  }

  async function onGuardar() {
    const lista: PartidaInput[] = []
    for (const f of filas) {
      f.meses.forEach((monto, i) => {
        if (monto > 0) lista.push({ cuenta_id: f.cuenta.id, periodo: periodos[i], monto })
      })
    }
    try {
      await guardar.mutateAsync({ presupuestoId: presupuesto.id, partidas: lista })
      notify({ variant: 'success', title: 'Guardado', text: 'Partidas actualizadas.' })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudieron guardar las partidas.' })
    }
  }

  return (
    <EditModal
      title={`Partidas — ${presupuesto.nombre}`}
      subtitle={`Montos mensuales en ${monedaBase} por cuenta contable de resultados (ingresos y gastos)`}
      onClose={onClose}
      size="full"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Total anual: {formatCurrency(totalAnual, monedaBase)}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btnSecundario}>Cancelar</button>
            <button onClick={() => void onGuardar()} disabled={guardar.isPending} style={btnPrimario}>Guardar partidas</button>
          </div>
        </div>
      }
    >
      {isLoading ? (
        <p style={{ color: 'var(--at-ink-soft)' }}>Cargando…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={cuentaNueva} onChange={(e) => setCuentaNueva(e.target.value)} style={{ ...input, minWidth: 280 }} aria-label="Agregar cuenta">
              <option value="">Agregar cuenta…</option>
              {elegibles.filter((c) => !grid[c.id]).map((c) => (
                <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
              ))}
            </select>
            <button
              onClick={() => {
                if (!cuentaNueva) return
                setGrid((g) => ({ ...g, [cuentaNueva]: Array(12).fill(0) }))
                setCuentaNueva('')
              }}
              style={btnSecundario}
            >
              Agregar
            </button>
            <button onClick={() => setImportando(true)} style={btnSecundario}>📥 Carga masiva</button>
          </div>

          {importando && (
            <ImportPartidasModal
              cuentas={elegibles}
              anio={presupuesto.anio}
              monedaBase={monedaBase}
              onAplicar={aplicarImportacion}
              onClose={() => setImportando(false)}
            />
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--at-ink-soft)', fontSize: 11, textAlign: 'right' }}>
                  <th style={{ padding: 4, textAlign: 'left', minWidth: 220 }}>Cuenta</th>
                  {MESES_CORTOS.map((m) => <th key={m} style={{ padding: 4, minWidth: 78 }}>{m}</th>)}
                  <th style={{ padding: 4, minWidth: 100 }}>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 && (
                  <tr><td colSpan={15} style={{ padding: 16, color: 'var(--at-ink-soft)' }}>Agrega cuentas de ingreso/gasto para presupuestar.</td></tr>
                )}
                {filas.map((f) => (
                  <tr key={f.cuenta.id} style={{ borderBottom: '1px solid var(--at-line)' }}>
                    <td style={{ padding: 4, fontFamily: 'var(--at-mono, monospace)', whiteSpace: 'nowrap' }}>
                      {f.cuenta.codigo} — {f.cuenta.nombre}
                    </td>
                    {f.meses.map((m, i) => (
                      <td key={i} style={{ padding: 2 }}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={m === 0 ? '' : m}
                          onChange={(e) => setMonto(f.cuenta.id, i, e.target.value)}
                          style={{ ...input, width: 74, padding: '4px 6px', textAlign: 'right', fontSize: 12 }}
                          aria-label={`${f.cuenta.codigo} ${MESES_CORTOS[i]}`}
                        />
                      </td>
                    ))}
                    <td style={{ padding: 4, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(totalFila(f.meses), monedaBase)}
                    </td>
                    <td style={{ padding: 4, whiteSpace: 'nowrap' }}>
                      <button onClick={() => repartir(f.cuenta.id)} style={btnLink}>Repartir anual</button>{' '}
                      <button
                        onClick={() => setGrid((g) => { const { [f.cuenta.id]: _omit, ...resto } = g; return resto })}
                        style={{ ...btnLink, color: 'var(--at-danger)' }}
                        aria-label={`Quitar ${f.cuenta.codigo}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </EditModal>
  )
}

// ── Comparativo presupuesto vs real ─────────────────────────────────────────

function ComparativoView({ companyId, presupuestos, proyectos, monedaBase }: {
  companyId: string
  presupuestos: PresupuestoConPartidas[]
  proyectos: Proyecto[]
  monedaBase: string
}) {
  void companyId
  const candidatos = presupuestos.filter((p) => p.estado === 'aprobado' || p.estado === 'archivado')
  const [presupuestoId, setPresupuestoId] = useState(candidatos.find((p) => p.estado === 'aprobado')?.id ?? '')
  const [mes, setMes] = useState('')

  const { data: filas = [], isLoading } = usePresupuestoVsRealQuery(presupuestoId || undefined)

  const visibles = useMemo(
    () => (mes ? filas.filter((f) => f.periodo === mes) : filas),
    [filas, mes],
  )

  // Agregado por cuenta (suma de los periodos visibles).
  const porCuenta = useMemo(() => {
    const m = new Map<string, { codigo: string; nombre: string; presupuestado: number; ejecutado: number }>()
    for (const f of visibles) {
      const cur = m.get(f.cuenta_id) ?? { codigo: f.codigo, nombre: f.nombre, presupuestado: 0, ejecutado: 0 }
      cur.presupuestado += f.presupuestado
      cur.ejecutado += f.ejecutado
      m.set(f.cuenta_id, cur)
    }
    return [...m.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'))
  }, [visibles])

  const totales = useMemo(() => ({
    presupuestado: porCuenta.reduce((s, c) => s + c.presupuestado, 0),
    ejecutado: porCuenta.reduce((s, c) => s + c.ejecutado, 0),
  }), [porCuenta])

  const presupuesto = presupuestos.find((p) => p.id === presupuestoId)
  const meses = presupuesto ? periodosDelAnio(presupuesto.anio) : []

  // D1 — proyección de cierre de año (run-rate) sobre TODO el año, ignorando el
  // filtro de mes (la gráfica siempre muestra el año completo con la proyección).
  const proyeccion = useMemo(
    () => (presupuesto ? proyeccionPresupuesto(filas, presupuesto.anio) : null),
    [filas, presupuesto],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={presupuestoId} onChange={(e) => setPresupuestoId(e.target.value)} style={{ ...input, minWidth: 260 }} aria-label="Presupuesto">
          <option value="">Selecciona presupuesto…</option>
          {candidatos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.anio} · {p.nombre} ({p.project_id ? proyectos.find((x) => x.id === p.project_id)?.nombre ?? 'proyecto' : 'empresa'})
            </option>
          ))}
        </select>
        <select value={mes} onChange={(e) => setMes(e.target.value)} style={{ ...input, width: 150 }} aria-label="Mes">
          <option value="">Todo el año</option>
          {meses.map((p, i) => <option key={p} value={p}>{MESES_CORTOS[i]} {presupuesto?.anio}</option>)}
        </select>
      </div>

      {!presupuestoId ? (
        <p style={{ color: 'var(--at-ink-soft)', fontSize: 13 }}>
          El comparativo usa presupuestos aprobados; el real sale de las pólizas publicadas de la contabilidad.
        </p>
      ) : isLoading ? (
        <p style={{ color: 'var(--at-ink-soft)' }}>Cargando comparativo…</p>
      ) : (
        <>
        {proyeccion && filas.length > 0 && (
          <PresupuestoVsRealChart proyeccion={proyeccion} anio={presupuesto?.anio ?? 0} moneda={monedaBase} />
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'right', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                <th style={{ padding: 6, textAlign: 'left' }}>Cuenta</th>
                <th style={{ padding: 6 }}>Presupuestado</th>
                <th style={{ padding: 6 }}>Real</th>
                <th style={{ padding: 6 }}>Variación</th>
                <th style={{ padding: 6 }}>% ejecución</th>
              </tr>
            </thead>
            <tbody>
              {porCuenta.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--at-ink-soft)' }}>Sin partidas en el periodo seleccionado.</td></tr>
              )}
              {porCuenta.map((c) => {
                const variacion = c.ejecutado - c.presupuestado
                const excedido = variacion > 0
                return (
                  <tr key={c.codigo} style={{ borderBottom: '1px solid var(--at-line)' }}>
                    <td style={{ padding: 6, fontFamily: 'var(--at-mono, monospace)' }}>{c.codigo} — {c.nombre}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(c.presupuestado, monedaBase)}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(c.ejecutado, monedaBase)}</td>
                    <td style={{ padding: 6, textAlign: 'right', color: excedido ? 'var(--at-danger)' : 'var(--at-success)', fontWeight: excedido ? 700 : 400 }}>
                      {formatCurrency(variacion, monedaBase)}
                    </td>
                    <td style={{ padding: 6, textAlign: 'right' }}>
                      {c.presupuestado > 0 ? formatPercent(c.ejecutado / c.presupuestado) : '—'}
                      {excedido && <StatusBadge tone="danger" style={{ marginLeft: 6 }}>excedido</StatusBadge>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {porCuenta.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--at-line)' }}>
                  <td style={{ padding: 6 }}>Total</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(totales.presupuestado, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(totales.ejecutado, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(totales.ejecutado - totales.presupuestado, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    {totales.presupuestado > 0 ? formatPercent(totales.ejecutado / totales.presupuestado) : '—'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        </>
      )}
    </div>
  )
}
