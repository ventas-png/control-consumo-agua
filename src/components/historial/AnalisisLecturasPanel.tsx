// Historial → «Análisis gráfico». Grafica las lecturas que la sección ya tiene
// en memoria (y el historial importado del proyecto elegido) para que nadie
// tenga que bajar el Excel y armar la gráfica a mano.
//
// Se filtra por proyecto, y dentro de él por unidades o por contadores; la
// ventana es de 1, 3, 6, 9, 12, 18 o 24 meses calendario que terminan en el
// mes actual. Las cuentas viven en lib/analisisLecturas.ts (puro, con tests).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Registro, Cliente, Unidad, Proyecto, Contador } from '../../types'
import { Chart } from '../../lib/chartjs'
import type { ChartConfiguration, ChartConfigurationCustomTypesPerDataset, ChartType, TooltipItem } from 'chart.js'
import { fetchHistorialLecturasProyectoResultado, type HistorialLectura } from '../../domain/agua/historialLecturas'
import {
  PERIODOS_MESES, contadoresEnAlcance, etiquetaMes, filtrarPuntos, kpisAnalisis,
  lecturasDelMedidor, mesesDelPeriodo, puntosDeAnalisis, rankingConsumo,
  resumenPorMes, seriesPorGrupo, type FiltroAnalisis, type PeriodoMeses, type PuntoAnalisis,
} from '../../lib/analisisLecturas'
import { formatDateShort, formatNumber } from '../../lib/format'
import { tint } from '../shared/statusTone'

type Alcance = 'proyecto' | 'unidades' | 'contadores'
type VistaConsumo = 'total' | 'comparar'

/** Más líneas que esto en una misma gráfica ya no se distinguen. */
const MAX_COMPARAR = 8
const TOP_RANKING = 10

interface Props {
  registros: Registro[]
  contadores: Contador[]
  unidades: Unidad[]
  clientes: Cliente[]
  proyectos: Proyecto[]
  /** Etiquetas de los tipos de agua (potable → «Agua Potable»…). */
  tiposAgua: Record<string, string>
}

export function AnalisisLecturasPanel({ registros, contadores, unidades, clientes, proyectos, tiposAgua }: Props) {
  const [proyectoId, setProyectoId] = useState(proyectos.length === 1 ? proyectos[0].id : '')
  const [alcance, setAlcance] = useState<Alcance>('proyecto')
  const [unidadIds, setUnidadIds] = useState<string[]>([])
  const [contadorIds, setContadorIds] = useState<string[]>([])
  const [tipoAgua, setTipoAgua] = useState('')
  const [periodo, setPeriodo] = useState<PeriodoMeses>(12)
  const [incluirHistorial, setIncluirHistorial] = useState(true)
  const [vistaConsumo, setVistaConsumo] = useState<VistaConsumo>('total')

  const contadoresById = useMemo(() => new Map(contadores.map(c => [c.id, c])), [contadores])
  const unidadesById = useMemo(() => new Map(unidades.map(u => [u.id, u])), [unidades])
  const clientesById = useMemo(() => new Map(clientes.map(c => [c.id, c])), [clientes])
  const proyectosById = useMemo(() => new Map(proyectos.map(p => [p.id, p])), [proyectos])

  // ── Historial importado del proyecto (se trae por proyecto: puede ser mucho) ──
  const proyectoHistorial = incluirHistorial ? proyectoId : ''
  const [historial, setHistorial] = useState<{ proyecto: string; filas: HistorialLectura[]; error: boolean } | null>(null)
  useEffect(() => {
    if (!proyectoHistorial) return
    let vigente = true
    void fetchHistorialLecturasProyectoResultado(proyectoHistorial).then(r => {
      if (vigente) setHistorial({ proyecto: proyectoHistorial, filas: r.filas, error: r.error })
    })
    return () => { vigente = false }
  }, [proyectoHistorial])
  const historialVigente = proyectoHistorial && historial?.proyecto === proyectoHistorial ? historial : null
  const cargandoHistorial = !!proyectoHistorial && !historialVigente
  const filasHistorial = useMemo(() => historialVigente?.filas ?? [], [historialVigente])

  // ── Opciones de los filtros ──────────────────────────────────────────────
  const contadoresDelProyecto = useMemo(
    () => contadores.filter(c => !proyectoId || c.project_id === proyectoId),
    [contadores, proyectoId],
  )
  const tiposDisponibles = useMemo(
    () => [...new Set(contadoresDelProyecto.map(c => c.tipo_agua).filter(Boolean))],
    [contadoresDelProyecto],
  )
  // Sólo las unidades que tienen contador: las demás no tienen lecturas que mostrar.
  const opcionesUnidad = useMemo<OpcionLista[]>(() => {
    const conContador = new Set(contadoresDelProyecto.map(c => c.unidad_id).filter(Boolean))
    return unidades
      .filter(u => conContador.has(u.id))
      .map(u => ({
        id: u.id,
        label: u.nombre,
        detalle: [clientesById.get(u.cliente_id ?? '')?.nombre, !proyectoId ? proyectosById.get(u.project_id)?.nombre : null]
          .filter(Boolean).join(' · '),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }))
  }, [unidades, contadoresDelProyecto, clientesById, proyectosById, proyectoId])
  const opcionesContador = useMemo<OpcionLista[]>(() => contadoresDelProyecto
    .filter(c => !tipoAgua || c.tipo_agua === tipoAgua)
    .map(c => ({
      id: c.id,
      label: c.numero_serie,
      detalle: [
        unidadesById.get(c.unidad_id ?? '')?.nombre,
        tiposAgua[c.tipo_agua] ?? c.tipo_agua,
        c.activo ? null : 'inactivo',
      ].filter(Boolean).join(' · '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true })),
  [contadoresDelProyecto, tipoAgua, unidadesById, tiposAgua])

  // ── Datos ───────────────────────────────────────────────────────────────
  const filtro: FiltroAnalisis = useMemo(() => ({
    proyectoId,
    unidadIds: alcance === 'unidades' ? unidadIds : [],
    contadorIds: alcance === 'contadores' ? contadorIds : [],
    tipoAgua,
  }), [proyectoId, alcance, unidadIds, contadorIds, tipoAgua])

  const todos = useMemo(
    () => puntosDeAnalisis(registros, filasHistorial, contadoresById),
    [registros, filasHistorial, contadoresById],
  )
  const enAlcance = useMemo(() => contadoresEnAlcance(contadores, filtro), [contadores, filtro])
  const puntos = useMemo(() => filtrarPuntos(todos, filtro, enAlcance), [todos, filtro, enAlcance])
  const meses = useMemo(() => mesesDelPeriodo(periodo), [periodo])
  const resumen = useMemo(() => resumenPorMes(puntos, meses), [puntos, meses])
  const kpis = useMemo(() => kpisAnalisis(puntos, meses), [puntos, meses])
  const hayHistorial = resumen.some(m => m.lecturasHistorial > 0)

  // Agrupar por unidad cuando se analiza por unidades; si no, por contador.
  const porUnidad = alcance === 'unidades'
  const grupoDe = useMemo(() => (p: PuntoAnalisis): string | null => {
    if (!p.contadorId) return null
    return porUnidad ? contadoresById.get(p.contadorId)?.unidad_id ?? null : p.contadorId
  }, [porUnidad, contadoresById])
  const nombreGrupo = useMemo(() => (clave: string): string => porUnidad
    ? unidadesById.get(clave)?.nombre ?? 'Unidad'
    : contadoresById.get(clave)?.numero_serie ?? 'Contador', [porUnidad, unidadesById, contadoresById])

  const seleccion = useMemo(
    () => (alcance === 'unidades' ? unidadIds : alcance === 'contadores' ? contadorIds : []),
    [alcance, unidadIds, contadorIds],
  )
  const puedeComparar = seleccion.length >= 2 && seleccion.length <= MAX_COMPARAR
  const comparando = vistaConsumo === 'comparar' && puedeComparar
  const series = useMemo(
    () => (comparando ? seriesPorGrupo(puntos, meses, grupoDe) : null),
    [comparando, puntos, meses, grupoDe],
  )
  const ranking = useMemo(
    () => rankingConsumo(puntos, meses, grupoDe, TOP_RANKING),
    [puntos, meses, grupoDe],
  )
  const medidorUnico = enAlcance.length === 1 ? enAlcance[0] : null
  const lecturasMedidor = useMemo(
    () => (medidorUnico ? lecturasDelMedidor(puntos, medidorUnico.id, meses) : []),
    [medidorUnico, puntos, meses],
  )

  // ── Gráficas ────────────────────────────────────────────────────────────
  const etiquetas = useMemo(() => meses.map(etiquetaMes), [meses])

  const graficaConsumo = useMemo<ConstructorGrafica>(() => t => {
    if (series) {
      return {
        type: 'line',
        data: {
          labels: etiquetas,
          datasets: seleccion.map((id, i) => ({
            label: nombreGrupo(id),
            // Mes sin lectura = hueco en la línea (null), no una caída a cero.
            data: series.get(id) ?? meses.map(() => null),
            borderColor: t.serie[i % t.serie.length],
            backgroundColor: t.serie[i % t.serie.length],
            // «monotone»: la curva no se inventa valores bajo cero entre dos puntos.
            cubicInterpolationMode: 'monotone', pointRadius: 3, borderWidth: 2,
          })),
        },
        options: opcionesBase(t, { unidad: 'm³' }),
      }
    }
    const datasets: DatasetGrafica[] = hayHistorial
      ? [
          { type: 'bar', label: 'Lecturas del sistema', data: resumen.map(m => redondear(m.consumo - m.consumoHistorial)), backgroundColor: t.sistema, borderRadius: 4, pointStyle: 'rect', stack: 'consumo', order: 2 },
          { type: 'bar', label: 'Historial importado', data: resumen.map(m => m.consumoHistorial), backgroundColor: t.historial, borderRadius: 4, pointStyle: 'rect', stack: 'consumo', order: 2 },
        ]
      : [{ type: 'bar', label: 'Consumo', data: resumen.map(m => m.consumo), backgroundColor: t.sistema, borderRadius: 4, pointStyle: 'rect', stack: 'consumo', order: 2 }]
    if (meses.length > 1) {
      datasets.push({
        type: 'line', label: 'Promedio mensual', data: meses.map(() => kpis.promedioMensual),
        borderColor: t.acento, backgroundColor: t.acento, borderDash: [6, 4], borderWidth: 2,
        pointRadius: 0, pointStyle: 'line', stack: 'promedio', order: 1,
      })
    }
    return { data: { labels: etiquetas, datasets }, options: opcionesBase(t, { unidad: 'm³', apilado: true }) }
  }, [series, seleccion, nombreGrupo, meses, etiquetas, resumen, hayHistorial, kpis.promedioMensual])

  const graficaLecturas = useMemo<ConstructorGrafica>(() => t => ({
    type: 'bar',
    data: {
      labels: etiquetas,
      datasets: hayHistorial
        ? [
            { label: 'Del sistema', data: resumen.map(m => m.lecturas - m.lecturasHistorial), backgroundColor: t.sistema, borderRadius: 4, pointStyle: 'rect', stack: 'l' },
            { label: 'Historial importado', data: resumen.map(m => m.lecturasHistorial), backgroundColor: t.historial, borderRadius: 4, pointStyle: 'rect', stack: 'l' },
          ]
        : [{ label: 'Lecturas', data: resumen.map(m => m.lecturas), backgroundColor: t.sistema, borderRadius: 4, pointStyle: 'rect', stack: 'l' }],
    },
    options: opcionesBase(t, { unidad: 'lecturas', apilado: true, enteros: true, leyenda: hayHistorial }),
  }), [etiquetas, resumen, hayHistorial])

  const graficaRanking = useMemo<ConstructorGrafica>(() => t => ({
    type: 'bar',
    data: {
      labels: ranking.map(r => recortar(nombreGrupo(r.clave), 28)),
      datasets: [{ label: 'Consumo', data: ranking.map(r => r.consumo), backgroundColor: t.acento, borderRadius: 4 }],
    },
    options: { ...opcionesBase(t, { unidad: 'm³', horizontal: true, leyenda: false }), indexAxis: 'y' },
  }), [ranking, nombreGrupo])

  const graficaMedidor = useMemo<ConstructorGrafica>(() => t => ({
    type: 'line',
    data: {
      labels: lecturasMedidor.map(l => formatDateShort(l.dia)),
      datasets: [{
        label: 'Lectura del medidor',
        data: lecturasMedidor.map(l => l.lectura),
        borderColor: t.sistema,
        backgroundColor: t.sistema,
        pointBackgroundColor: lecturasMedidor.map(l => (l.origen === 'historial' ? t.historial : t.sistema)),
        pointRadius: 4, tension: 0.2, borderWidth: 2,
      }],
    },
    options: opcionesBase(t, { unidad: 'm³', desdeCero: false, leyenda: false }),
  }), [lecturasMedidor])

  // ── Acciones de filtro ──────────────────────────────────────────────────
  function cambiarProyecto(id: string) {
    setProyectoId(id)
    setUnidadIds([]); setContadorIds([]); setTipoAgua('')
  }
  function cambiarAlcance(a: Alcance) {
    setAlcance(a)
    setVistaConsumo('total')
  }

  const rango = meses.length === 1
    ? etiquetaMes(meses[0])
    : `${etiquetaMes(meses[0])} – ${etiquetaMes(meses[meses.length - 1])}`
  const sinLecturas = kpis.lecturas === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Filtros ─────────────────────────────────────────────────────── */}
      <section aria-label="Filtros del análisis" style={panelFiltros}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
          {proyectos.length > 1 && (
            <Campo etiqueta="Proyecto" htmlFor="analisis-proyecto">
              <select id="analisis-proyecto" value={proyectoId} onChange={e => cambiarProyecto(e.target.value)} style={campo}>
                <option value="">Todos los proyectos</option>
                {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Campo>
          )}
          {tiposDisponibles.length > 1 && (
            <Campo etiqueta="Tipo de agua" htmlFor="analisis-tipo">
              <select id="analisis-tipo" value={tipoAgua} onChange={e => { setTipoAgua(e.target.value); setContadorIds([]) }} style={campo}>
                <option value="">Todos los tipos</option>
                {tiposDisponibles.map(t => <option key={t} value={t}>{tiposAgua[t] ?? t}</option>)}
              </select>
            </Campo>
          )}
          <Campo etiqueta="Analizar">
            <Segmentado
              etiqueta="Qué analizar"
              valor={alcance}
              onChange={cambiarAlcance}
              opciones={[
                { valor: 'proyecto', texto: proyectoId ? 'Todo el proyecto' : 'Todo' },
                { valor: 'unidades', texto: 'Unidades' },
                { valor: 'contadores', texto: 'Contadores' },
              ]}
            />
          </Campo>
        </div>

        <Campo etiqueta="Período">
          <Segmentado
            etiqueta="Período a analizar"
            valor={String(periodo)}
            onChange={v => setPeriodo(Number(v) as PeriodoMeses)}
            opciones={PERIODOS_MESES.map(n => ({ valor: String(n), texto: n === 1 ? '1 mes' : `${n} meses` }))}
          />
        </Campo>

        {alcance === 'unidades' && (
          <SelectorLista
            titulo="Unidades"
            opciones={opcionesUnidad}
            seleccion={unidadIds}
            onChange={setUnidadIds}
            buscar="Buscar unidad o cliente…"
            vacio={proyectoId ? 'Este proyecto no tiene unidades con contador.' : 'No hay unidades con contador.'}
          />
        )}
        {alcance === 'contadores' && (
          <SelectorLista
            titulo="Contadores"
            opciones={opcionesContador}
            seleccion={contadorIds}
            onChange={setContadorIds}
            buscar="Buscar # de contador o unidad…"
            vacio="No hay contadores con estos filtros."
          />
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', fontSize: 13, color: 'var(--at-ink-2)' }}>
          <span><strong style={{ color: 'var(--at-ink)' }}>Período:</strong> {rango}</span>
          {(proyectoId || proyectos.length <= 1) ? (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={incluirHistorial} onChange={e => setIncluirHistorial(e.target.checked)} />
              Incluir historial importado
            </label>
          ) : (
            <span>🗂️ Elija un proyecto para incluir su historial importado.</span>
          )}
        </div>
      </section>

      {(cargandoHistorial || historialVigente?.error) && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: historialVigente?.error ? 'var(--at-danger-strong)' : 'var(--at-ink-2)' }}>
          {historialVigente?.error
            ? '⚠️ No se pudo cargar el historial importado de este proyecto; se grafican sólo las lecturas del sistema.'
            : '🗂️ Cargando el historial importado…'}
        </p>
      )}

      {/* ── Indicadores ─────────────────────────────────────────────────── */}
      {/* Cinco por fila en escritorio y dos en el teléfono (uno por fila eran
          cinco tarjetas altas antes de la primera gráfica). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(max(140px, 18%), 1fr))', gap: 'clamp(8px, 2vw, 12px)' }}>
        <Indicador
          titulo="Consumo del período"
          valor={`${formatNumber(kpis.consumoTotal)} m³`}
          color="var(--at-primary)"
          nota={kpis.variacion === null
            ? 'Sin consumo en el período anterior para comparar'
            : `${kpis.variacion >= 0 ? '▲' : '▼'} ${formatNumber(Math.abs(kpis.variacion) * 100, 1)} % vs. ${periodo === 1 ? 'el mes anterior' : `los ${periodo} meses anteriores`}`}
        />
        <Indicador titulo="Promedio mensual" valor={`${formatNumber(kpis.promedioMensual)} m³`} color="var(--at-accent-2)" nota={`En ${meses.length} ${meses.length === 1 ? 'mes' : 'meses'}`} />
        <Indicador
          titulo="Lecturas realizadas"
          valor={formatNumber(kpis.lecturas, 0)}
          color="var(--at-info)"
          nota={hayHistorial ? `${formatNumber(resumen.reduce((s, m) => s + m.lecturasHistorial, 0), 0)} del historial importado` : undefined}
        />
        <Indicador titulo="Contadores con lectura" valor={`${formatNumber(kpis.contadoresLeidos, 0)} de ${formatNumber(enAlcance.length, 0)}`} color="var(--at-accent)" />
        <Indicador
          titulo="Mes de mayor consumo"
          valor={kpis.mesPico ? etiquetaMes(kpis.mesPico.mes) : '—'}
          color="var(--at-warning)"
          nota={kpis.mesPico ? `${formatNumber(kpis.mesPico.consumo)} m³` : undefined}
        />
      </div>

      {sinLecturas ? (
        <div role="status" style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--at-ink-3)', background: 'var(--at-surface-2)', borderRadius: 12, border: '1px dashed var(--at-line-strong)' }}>
          📭 No hay lecturas entre {rango} para esta selección.
          <div style={{ fontSize: 13, marginTop: 6 }}>Pruebe con un período más largo o con otro proyecto, unidad o contador.</div>
        </div>
      ) : (
        <>
          <Tarjeta
            titulo="💧 Consumo mensual (m³)"
            accion={(alcance !== 'proyecto') && (
              <Segmentado
                etiqueta="Forma de la gráfica de consumo"
                valor={comparando ? 'comparar' : 'total'}
                onChange={v => setVistaConsumo(v as VistaConsumo)}
                opciones={[
                  { valor: 'total', texto: 'Total' },
                  { valor: 'comparar', texto: 'Comparar', deshabilitado: !puedeComparar },
                ]}
              />
            )}
            nota={alcance !== 'proyecto' && !puedeComparar
              ? `Para comparar, marque entre 2 y ${MAX_COMPARAR} ${alcance === 'unidades' ? 'unidades' : 'contadores'}.`
              : undefined}
          >
            <Grafica construir={graficaConsumo} alto={300} etiqueta={`Consumo mensual en metros cúbicos, ${rango}`} />
          </Tarjeta>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16 }}>
            <Tarjeta titulo="🧾 Lecturas realizadas por mes">
              <Grafica construir={graficaLecturas} alto={260} etiqueta={`Lecturas realizadas por mes, ${rango}`} />
            </Tarjeta>
            {ranking.length > 1 && (
              <Tarjeta titulo={`🏆 Mayor consumo por ${porUnidad ? 'unidad' : 'contador'}${ranking.length === TOP_RANKING ? ` (top ${TOP_RANKING})` : ''}`}>
                <Grafica construir={graficaRanking} alto={Math.max(180, 40 + ranking.length * 26)} etiqueta={`${porUnidad ? 'Unidades' : 'Contadores'} con mayor consumo, ${rango}`} />
              </Tarjeta>
            )}
            {medidorUnico && lecturasMedidor.length > 0 && (
              <Tarjeta titulo={`📈 Lecturas del medidor ${medidorUnico.numero_serie}`}>
                <Grafica construir={graficaMedidor} alto={260} etiqueta={`Lecturas del medidor ${medidorUnico.numero_serie}, ${rango}`} />
              </Tarjeta>
            )}
          </div>

          <Tarjeta titulo="📅 Detalle por mes">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr>
                    <th scope="col" style={th}>Mes</th>
                    <th scope="col" style={{ ...th, textAlign: 'right' }}>Lecturas</th>
                    <th scope="col" style={{ ...th, textAlign: 'right' }}>Contadores</th>
                    <th scope="col" style={{ ...th, textAlign: 'right' }}>Consumo (m³)</th>
                    <th scope="col" style={{ ...th, textAlign: 'right' }}>Promedio por lectura (m³)</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.map(m => (
                    <tr key={m.mes}>
                      <th scope="row" style={{ ...td, fontWeight: 600, textAlign: 'left' }}>{etiquetaMes(m.mes)}</th>
                      <td style={tdNum}>{formatNumber(m.lecturas, 0)}</td>
                      <td style={tdNum}>{formatNumber(m.contadores, 0)}</td>
                      <td style={tdNum}>{formatNumber(m.consumo)}</td>
                      <td style={tdNum}>{m.lecturas ? formatNumber(m.consumo / m.lecturas) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" style={{ ...td, fontWeight: 700, textAlign: 'left', borderTop: '2px solid var(--at-line)' }}>Total</th>
                    <td style={{ ...tdNum, fontWeight: 700, borderTop: '2px solid var(--at-line)' }}>{formatNumber(kpis.lecturas, 0)}</td>
                    <td style={{ ...tdNum, fontWeight: 700, borderTop: '2px solid var(--at-line)' }}>{formatNumber(kpis.contadoresLeidos, 0)}</td>
                    <td style={{ ...tdNum, fontWeight: 700, borderTop: '2px solid var(--at-line)' }}>{formatNumber(kpis.consumoTotal)}</td>
                    <td style={{ ...tdNum, fontWeight: 700, borderTop: '2px solid var(--at-line)' }}>{kpis.lecturas ? formatNumber(kpis.consumoTotal / kpis.lecturas) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {hayHistorial && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--at-ink-3)' }}>
                🗂️ Incluye lecturas del historial importado (referencia: no generan cobro). De cada contador sólo cuentan los meses anteriores a su primera lectura en el sistema.
              </p>
            )}
          </Tarjeta>
        </>
      )}
    </div>
  )
}

// ── Gráfica (Chart.js) ──────────────────────────────────────────────────────

type ConfigGrafica = ChartConfiguration | ChartConfigurationCustomTypesPerDataset
type ConstructorGrafica = (t: Tema) => ConfigGrafica
// Dataset de la gráfica mixta de consumo (barras + línea de promedio).
type DatasetGrafica = Record<string, unknown> & { type: 'bar' | 'line'; label: string; data: number[] }

interface Tema {
  texto: string
  rejilla: string
  sistema: string
  historial: string
  acento: string
  serie: string[]
}

/**
 * Colores del tema leídos en tiempo de ejecución: el canvas no resuelve
 * variables CSS (ver Sparkline). Se vuelve a leer al cambiar claro/oscuro.
 */
function leerTema(): Tema {
  const css = getComputedStyle(document.documentElement)
  const v = (nombre: string, alterno: string) => css.getPropertyValue(nombre).trim() || alterno
  const primary = v('--at-primary', '#1B3B36')
  const accent = v('--at-accent', '#B96A3F')
  return {
    texto: v('--at-ink-2', '#4A5D54'),
    rejilla: v('--at-line', '#E1DDD0'),
    sistema: primary,
    historial: v('--at-ink-3', '#7E9389'),
    acento: accent,
    serie: [
      primary, accent, v('--at-info', '#2563eb'), v('--at-warning', '#d97706'),
      v('--at-accent-2', '#577B69'), v('--at-danger', '#ef4444'), v('--at-success', '#16a34a'), v('--at-ink-3', '#7E9389'),
    ],
  }
}

function Grafica({ construir, alto, etiqueta }: { construir: ConstructorGrafica; alto: number; etiqueta: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let chart: Chart | null = null
    const dibujar = () => {
      chart?.destroy()
      chart = new Chart(canvas, construir(leerTema()))
    }
    dibujar()
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener?.('change', dibujar)
    const observer = new MutationObserver(dibujar)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mq?.removeEventListener?.('change', dibujar)
      observer.disconnect()
      chart?.destroy()
    }
  }, [construir])
  return (
    <div style={{ position: 'relative', height: alto }}>
      <canvas ref={canvasRef} role="img" aria-label={etiqueta} />
    </div>
  )
}

function opcionesBase(t: Tema, o: {
  unidad: string; apilado?: boolean; enteros?: boolean; horizontal?: boolean; desdeCero?: boolean
  /** Con una sola serie la leyenda no dice nada que no diga el título. */
  leyenda?: boolean
}) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const valor = (v: number) => (o.enteros ? formatNumber(v, 0) : formatNumber(v))
  // En el eje, «450» y no «450.00»: los decimales sólo cuando el paso los tiene.
  const marca = (v: number) => formatNumber(v, Number.isInteger(v) ? 0 : 1)
  const ejeValor = {
    beginAtZero: o.desdeCero ?? true,
    stacked: o.apilado,
    ticks: { color: t.texto, precision: o.enteros ? 0 : undefined, callback: (v: string | number) => marca(Number(v)) },
    grid: { color: t.rejilla },
    title: { display: true, text: o.unidad, color: t.texto },
  }
  const ejeCategoria = { stacked: o.apilado, ticks: { color: t.texto, autoSkip: true, maxRotation: 45 }, grid: { display: false } }
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduceMotion ? (false as const) : { duration: 300 },
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: {
        display: o.leyenda ?? true,
        position: 'bottom' as const,
        labels: { color: t.texto, boxWidth: 12, font: { size: 11 }, usePointStyle: true },
      },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<ChartType>) => {
            const p = ctx.parsed as { x?: number | null; y?: number | null }
            const n = o.horizontal ? p.x : p.y
            return `${ctx.dataset.label ?? ''}: ${valor(Number(n) || 0)} ${o.unidad}`
          },
        },
      },
    },
    scales: o.horizontal ? { x: ejeValor, y: ejeCategoria } : { x: ejeCategoria, y: ejeValor },
  }
}

// ── Piezas de la interfaz ───────────────────────────────────────────────────

function Campo({ etiqueta, htmlFor, children }: { etiqueta: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {htmlFor
        ? <label htmlFor={htmlFor} style={etiquetaCampo}>{etiqueta}</label>
        : <span style={etiquetaCampo}>{etiqueta}</span>}
      {children}
    </div>
  )
}

function Segmentado<T extends string>({ etiqueta, valor, onChange, opciones }: {
  etiqueta: string
  valor: T
  onChange: (v: T) => void
  opciones: Array<{ valor: T; texto: string; deshabilitado?: boolean }>
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {opciones.map(o => {
        const activo = o.valor === valor
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={activo}
            disabled={o.deshabilitado}
            onClick={() => onChange(o.valor)}
            style={{
              padding: '8px 14px', minHeight: 36, borderRadius: 999, fontSize: 13, whiteSpace: 'nowrap',
              fontWeight: activo ? 700 : 500,
              border: `1px solid ${activo ? 'var(--at-primary)' : 'var(--at-line-strong)'}`,
              background: activo ? 'var(--at-primary)' : 'var(--at-surface)',
              color: activo ? 'white' : 'var(--at-ink-2)',
              cursor: o.deshabilitado ? 'not-allowed' : 'pointer',
              opacity: o.deshabilitado ? 0.5 : 1,
            }}
          >{o.texto}</button>
        )
      })}
    </div>
  )
}

interface OpcionLista { id: string; label: string; detalle?: string }

function SelectorLista({ titulo, opciones, seleccion, onChange, buscar, vacio }: {
  titulo: string
  opciones: OpcionLista[]
  seleccion: string[]
  onChange: (ids: string[]) => void
  buscar: string
  vacio: string
}) {
  const [texto, setTexto] = useState('')
  const marcados = useMemo(() => new Set(seleccion), [seleccion])
  const aguja = texto.trim().toLowerCase()
  const visibles = aguja
    ? opciones.filter(o => `${o.label} ${o.detalle ?? ''}`.toLowerCase().includes(aguja))
    : opciones
  const alternar = (id: string) => onChange(marcados.has(id) ? seleccion.filter(x => x !== id) : [...seleccion, id])
  const marcarVisibles = () => onChange([...new Set([...seleccion, ...visibles.map(o => o.id)])])

  return (
    <fieldset style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: 12, margin: 0, minWidth: 0, background: 'var(--at-surface)' }}>
      <legend style={{ ...etiquetaCampo, padding: '0 6px' }}>
        {titulo} · {seleccion.length === 0 ? 'todas las del filtro' : `${seleccion.length} marcad${titulo === 'Unidades' ? 'as' : 'os'}`}
      </legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <input
          type="search"
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder={buscar}
          aria-label={buscar}
          style={{ ...campo, flex: '1 1 220px' }}
        />
        <button type="button" onClick={marcarVisibles} disabled={visibles.length === 0} style={botonSuave}>Marcar {aguja ? 'resultados' : 'todos'}</button>
        <button type="button" onClick={() => onChange([])} disabled={seleccion.length === 0} style={botonSuave}>Quitar marcas</button>
      </div>
      {opciones.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-3)' }}>{vacio}</p>
      ) : (
        <div role="group" aria-label={titulo} style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', gap: 2 }}>
          {visibles.map(o => (
            <label key={o.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: marcados.has(o.id) ? 'var(--at-primary-tint, var(--at-chip))' : 'transparent' }}>
              <input type="checkbox" checked={marcados.has(o.id)} onChange={() => alternar(o.id)} style={{ marginTop: 2 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--at-ink)', overflowWrap: 'anywhere' }}>{o.label}</span>
                {o.detalle && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--at-ink-3)' }}>{o.detalle}</span>}
              </span>
            </label>
          ))}
          {visibles.length === 0 && <p style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-3)' }}>Nada coincide con «{texto}».</p>}
        </div>
      )}
      {seleccion.length === 0 && opciones.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--at-ink-3)' }}>
          Sin marcas se analizan {titulo === 'Unidades' ? 'todas las unidades' : 'todos los contadores'} del filtro.
        </p>
      )}
    </fieldset>
  )
}

function Indicador({ titulo, valor, color, nota }: { titulo: string; valor: string; color: string; nota?: string }) {
  return (
    <div style={{
      minWidth: 0, padding: 'clamp(10px, 2.5vw, 14px)', borderRadius: 12,
      // El valor se mide con `cqi` (ancho de la tarjeta) para que quepa con dos por fila.
      containerType: 'inline-size',
      background: `linear-gradient(135deg, ${tint(color, 12)} 0%, ${tint(color, 6)} 100%)`,
      border: `1px solid ${tint(color, 25)}`, borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontSize: 'clamp(15px, 11cqi, 21px)', fontWeight: 700, color, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{valor}</div>
      {nota && <div style={{ fontSize: 11.5, color: 'var(--at-ink-2)', marginTop: 4 }}>{nota}</div>}
    </div>
  )
}

function Tarjeta({ titulo, accion, nota, children }: { titulo: string; accion?: ReactNode; nota?: string; children: ReactNode }) {
  return (
    <section aria-label={titulo.replace(/^\P{L}+/u, '')} style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--at-ink)' }}>{titulo}</h3>
        {accion}
      </div>
      {nota && <p style={{ margin: '-4px 0 10px', fontSize: 12, color: 'var(--at-ink-3)' }}>{nota}</p>}
      {children}
    </section>
  )
}

function recortar(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Estilos ─────────────────────────────────────────────────────────────────

const panelFiltros: CSSProperties = {
  background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 12,
  padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
}

const etiquetaCampo: CSSProperties = {
  fontSize: 12, fontWeight: 700, color: 'var(--at-ink-2)', textTransform: 'uppercase', letterSpacing: '0.03em',
}

const campo: CSSProperties = {
  padding: '10px 12px', border: '1px solid var(--at-line-strong)', borderRadius: 8, fontSize: 14,
  background: 'var(--at-surface)', color: 'var(--at-ink)', minWidth: 0, fontFamily: 'inherit',
}

const botonSuave: CSSProperties = {
  padding: '8px 12px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none',
  borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
}

const th: CSSProperties = {
  padding: '8px 10px', textAlign: 'left', fontSize: 11.5, fontWeight: 700, color: 'var(--at-ink-3)',
  textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '2px solid var(--at-line)', whiteSpace: 'nowrap',
}

const td: CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--at-line)', color: 'var(--at-ink)' }
const tdNum: CSSProperties = { ...td, textAlign: 'right' }
