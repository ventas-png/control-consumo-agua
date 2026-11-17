// Carga masiva de lecturas desde Excel: las lecturas REALES del periodo, las
// que se cobran. Es «Nueva Lectura» repetida N veces: cada fila entra por la
// RPC `registrar_lectura`, que decide lectura anterior, consumo, tarifa e
// importe bajo el bloqueo del contador. Nada de eso viaja desde aquí.
//
// Antes de mandar nada, el preview dice cómo quedaría cada lectura (consumo,
// importe estimado, aviso si se dispara contra el promedio del contador,
// historial importado incluido) y qué va a rechazar el servidor. Al final, el
// resultado fila por fila y un Excel con las que no entraron, para corregirlas
// y volver a subirlas (lo que ya entró vuelve como «ya estaba», no se duplica).
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ImportModal, type ImportColumn } from '../shared'
import type { Contador, Proyecto, Registro, Tarifa } from '../../types'
import { registrarLectura } from '../../domain/agua/mutations'
import { fetchHistorialLecturasProyecto, type HistorialLectura } from '../../domain/agua/historialLecturas'
import { nuevaClaveIdempotencia } from '../../lib/lecturasOutbox'
import { formatCurrency, formatFechaCalendario, formatNumber, hoyLocalISO } from '../../lib/format'
import { estadisticasConsumo, serieConsumo } from '../../lib/historialConsumo'
import { proyectoDestinoInicial } from '../../lib/proyectoDestino'
import { writeXlsx } from '../../lib/xlsx'
import {
  ejecutarCargaMasiva,
  lecturasExistentes,
  planCargaMasiva,
  resumenCarga,
  ultimasLecturas,
  validarFilaCargaMasiva,
  type FilaCargaMasiva,
  type PlanCargaMasiva,
  type ResultadoFila,
} from '../../lib/cargaMasivaLecturas'

const COLUMNS: ImportColumn[] = [
  { key: 'contador', width: 18, exampleValues: ['21B-001', '21B-002', '21B-003'] },
  { key: 'fecha',    width: 14, exampleValues: ['2026-11-15', '15/11/2026', ''] },
  { key: 'lectura',  width: 12, exampleValues: [1548, 932.5, 410] },
  { key: 'notas',    width: 28, exampleValues: ['', 'Medidor empañado', ''] },
]

const ETIQUETA_ESTADO: Record<ResultadoFila['estado'], string> = {
  registrada: 'Registrada',
  ya_estaba: 'Ya estaba registrada',
  rechazada: 'Rechazada',
  omitida: 'No se intentó',
}

interface Props {
  proyectos: Proyecto[]
  contadores: Contador[]
  tarifas: Tarifa[]
  registros: Registro[]
  moneda?: string
  /** Proyecto filtrado en la pantalla; se propone como destino. */
  proyectoInicial?: string
  onClose: () => void
  /** Cada lectura que entra, para que la pantalla la muestre sin recargar. */
  onRegistroAdded: (registro: Registro) => void
}

export function CargaMasivaLecturasModal({
  proyectos, contadores, tarifas, registros, moneda = 'Q', proyectoInicial, onClose, onRegistroAdded,
}: Props) {
  const [destinoId, setDestinoId] = useState(() => proyectoDestinoInicial(proyectos, proyectoInicial))
  const [fechaDefecto, setFechaDefecto] = useState(() => hoyLocalISO())
  const [historial, setHistorial] = useState<HistorialLectura[]>([])
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null)
  const [resultados, setResultados] = useState<ResultadoFila[] | null>(null)

  const destino = proyectos.find(p => p.id === destinoId) ?? null
  const hoy = hoyLocalISO()

  // El historial importado del proyecto entra en el promedio contra el que se
  // avisa del consumo alto, igual que en «Nueva Lectura».
  useEffect(() => {
    let vigente = true
    setHistorial([])
    if (destinoId) void fetchHistorialLecturasProyecto(destinoId).then(h => { if (vigente) setHistorial(h) })
    return () => { vigente = false }
  }, [destinoId])

  const ultimas = useMemo(() => ultimasLecturas(registros), [registros])
  const existentes = useMemo(() => lecturasExistentes(registros), [registros])

  const promedio = useMemo(() => {
    const hist = new Map<string, HistorialLectura[]>()
    for (const h of historial) hist.set(h.contador_id, [...(hist.get(h.contador_id) ?? []), h])
    const sist = new Map<string, Registro[]>()
    for (const r of registros) if (r.contador_id) sist.set(r.contador_id, [...(sist.get(r.contador_id) ?? []), r])
    const series = new Map<string, ReturnType<typeof serieConsumo>>()
    return (contadorId: string, fecha: string) => {
      let serie = series.get(contadorId)
      if (!serie) {
        serie = serieConsumo(hist.get(contadorId) ?? [], sist.get(contadorId) ?? [])
        series.set(contadorId, serie)
      }
      return estadisticasConsumo(serie, fecha).promedioReciente
    }
  }, [historial, registros])

  const plan = (filas: FilaCargaMasiva[]) => planCargaMasiva(filas, { contadores, tarifas, ultimas, promedio })

  const panel = (
    <div style={{ display: 'grid', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        {proyectos.length > 1 ? (
          <div>
            <label htmlFor="carga-masiva-proyecto" style={labelStyle}>Proyecto *</label>
            <select id="carga-masiva-proyecto" value={destinoId} onChange={e => setDestinoId(e.target.value)} style={inputStyle}>
              <option value="">— Elegir proyecto —</option>
              {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
        ) : destino ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)', alignSelf: 'end' }}>
            Proyecto: <strong>{destino.nombre}</strong>
          </p>
        ) : null}
        <div>
          <label htmlFor="carga-masiva-fecha" style={labelStyle}>Fecha de lectura (filas sin fecha)</label>
          <input
            id="carga-masiva-fecha"
            type="date"
            value={fechaDefecto}
            max={hoy}
            onChange={e => setFechaDefecto(e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>
      <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)', lineHeight: 1.5 }}>
        Cada fila es una <strong>lectura real</strong>: se registra igual que en Nueva Lectura, <strong>genera su cobro</strong> con
        la tarifa del contador y aparece en el Historial de Lecturas. El sistema calcula la lectura anterior, el consumo y el
        importe. Columnas: <strong>contador</strong> (el número como aparece en Contadores), <strong>fecha</strong> (AAAA-MM-DD o
        DD/MM/AAAA; si va vacía se usa la de arriba), <strong>lectura</strong> y <strong>notas</strong>. Los cambios de medidor y las
        lecturas con fecha anterior a la última registrada se capturan desde Nueva Lectura. Para cargar lecturas viejas sólo
        como referencia, use «Importar historial».
      </p>
    </div>
  )

  return (
    <ImportModal<FilaCargaMasiva>
      entityLabel="lectura"
      entityLabelPlural="lecturas"
      sheetName="Lecturas"
      templateFilename="plantilla_carga_masiva_lecturas"
      columns={COLUMNS}
      validateRow={(row, n) => validarFilaCargaMasiva(row, n, {
        contadores, tarifas, projectId: destinoId, fechaDefecto, ultimas, existentes, hoy,
      })}
      revalidarCon={`${destinoId}|${fechaDefecto}|${registros.length}`}
      renderValidas={filas => <VistaPrevia plan={plan(filas)} moneda={moneda} />}
      // Todas en una sola llamada: hay que ordenarlas por contador y fecha
      // antes de mandar, y una fila puede depender de otra lejos en la hoja.
      batchSize={Number.MAX_SAFE_INTEGER}
      optionsPanel={panel}
      importDisabled={!destinoId}
      importDisabledReason="Elija el proyecto."
      onInsertBatch={async (batch) => {
        setResultados(null)
        setProgreso({ hechas: 0, total: batch.length })
        const res = await ejecutarCargaMasiva(
          batch,
          f => registrarLectura({
            contadorId: f.contadorId,
            lecturaActual: f.lectura,
            fecha: f.fecha,
            idempotencyKey: nuevaClaveIdempotencia(),
            notas: f.notas,
          }),
          { concurrencia: 4, onProgreso: (hechas, total) => setProgreso({ hechas, total }) },
        )
        for (const r of res) if (r.estado === 'registrada' && r.registro) onRegistroAdded(r.registro)
        setResultados(res)
        setProgreso(null)
        return { ok: res.filter(r => r.estado === 'registrada').length }
      }}
      progreso={progreso && (
        <p role="status" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--at-ink-2)' }}>
          {progreso.hechas} de {progreso.total}
        </p>
      )}
      resultado={resultados && <ResultadoCarga resultados={resultados} moneda={moneda} />}
      onClose={onClose}
      onImportado={() => {}}
    />
  )
}

function VistaPrevia({ plan, moneda }: { plan: PlanCargaMasiva; moneda: string }) {
  const entran = plan.filas.length - plan.conError
  const contadoresDistintos = new Set(plan.filas.filter(f => !f.error).map(f => f.contadorId)).size
  return (
    <div data-testid="carga-masiva-preview">
      <p style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--at-ink-2)', lineHeight: 1.5 }}>
        Se registrarán <strong>{entran} lectura{entran === 1 ? '' : 's'}</strong> de {contadoresDistintos} contador
        {contadoresDistintos === 1 ? '' : 'es'}: <strong>{formatNumber(plan.totalConsumo)} m³</strong> y cobros por
        aproximadamente <strong>{formatCurrency(plan.totalImporte, moneda)}</strong> (el importe final lo calcula el sistema con la
        tarifa vigente).
        {plan.conAviso > 0 && <> <strong style={{ color: 'var(--at-warning-strong)' }}>{plan.conAviso} con aviso</strong>: revíselas antes de importar.</>}
        {plan.conError > 0 && <> <strong style={{ color: 'var(--at-danger-strong)' }}>{plan.conError} no entrarán</strong> por cómo encadenan con otra fila del archivo.</>}
      </p>
      <div style={{ maxHeight: '300px', overflow: 'auto', border: '1px solid var(--at-line)', borderRadius: '8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr>
              {['Fila', 'Contador', 'Fecha', 'Anterior', 'Lectura', 'Consumo', 'Importe ≈', ''].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.filas.map(f => (
              <tr key={f.fila} style={{ background: f.error ? 'var(--at-danger-tint)' : f.aviso ? 'var(--at-warning-tint)' : undefined }}>
                <td style={tdStyle}>{f.fila}</td>
                <td style={tdStyle}>{f.contador}</td>
                <td style={tdStyle}>{formatFechaCalendario(f.fecha)}</td>
                <td style={tdNum}>{formatNumber(f.anterior)}</td>
                <td style={tdNum}>{formatNumber(f.lectura)}</td>
                <td style={tdNum}>{f.error ? '—' : `${formatNumber(f.consumo)} m³`}</td>
                <td style={tdNum}>{f.importe === null ? '—' : formatCurrency(f.importe, moneda)}</td>
                <td style={{ ...tdStyle, color: f.error ? 'var(--at-danger-strong)' : 'var(--at-warning-strong)', minWidth: '160px' }}>
                  {f.error ?? f.aviso ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ResultadoCarga({ resultados, moneda }: { resultados: ResultadoFila[]; moneda: string }) {
  const r = resumenCarga(resultados)
  const noEntraron = resultados.filter(x => x.estado === 'rechazada' || x.estado === 'omitida')
  const descargar = () => {
    void writeXlsx('lecturas_no_registradas', [{
      name: 'No registradas',
      rows: [
        ['contador', 'fecha', 'lectura', 'notas', 'motivo_error'],
        ...noEntraron.map(x => [x.contador, x.fecha, x.lectura, x.notas ?? '', x.error ?? '']),
      ],
      colWidths: [18, 14, 12, 28, 60],
    }])
  }
  return (
    <div data-testid="carga-masiva-resultado" style={{ display: 'grid', gap: '12px' }}>
      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '14px', color: 'var(--at-ink-2)', lineHeight: 1.7 }}>
        <li><strong>{r.registradas}</strong> registrada{r.registradas === 1 ? '' : 's'}: {formatNumber(r.consumo)} m³, {formatCurrency(r.importe, moneda)} en cobros.</li>
        {r.yaEstaban > 0 && <li><strong>{r.yaEstaban}</strong> ya estaba{r.yaEstaban === 1 ? '' : 'n'} registrada{r.yaEstaban === 1 ? '' : 's'} (no se duplicaron).</li>}
        {r.rechazadas > 0 && <li style={{ color: 'var(--at-danger-strong)' }}><strong>{r.rechazadas}</strong> rechazada{r.rechazadas === 1 ? '' : 's'} por el sistema.</li>}
        {r.omitidas > 0 && <li style={{ color: 'var(--at-danger-strong)' }}><strong>{r.omitidas}</strong> no se intentaron porque falló una lectura anterior del mismo contador.</li>}
      </ul>
      {noEntraron.length > 0 && (
        <>
          <div style={{ maxHeight: '220px', overflow: 'auto', border: '1px solid var(--at-danger-border)', borderRadius: '8px' }}>
            {noEntraron.map(x => (
              <div key={x.fila} style={{ padding: '8px 12px', borderBottom: '1px solid var(--at-danger-border)', fontSize: '12px', color: 'var(--at-danger-strong)' }}>
                <strong>Fila {x.fila}</strong> · {x.contador} · {formatFechaCalendario(x.fecha)} · {formatNumber(x.lectura)} — {ETIQUETA_ESTADO[x.estado]}: {x.error}
              </div>
            ))}
          </div>
          <button type="button" onClick={descargar} style={{ justifySelf: 'start', padding: '8px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: '8px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
            📥 Descargar las que no entraron
          </button>
        </>
      )}
    </div>
  )
}

const labelStyle: CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }
const inputStyle: CSSProperties = {
  width: '100%', padding: '10px 14px', border: '2px solid var(--at-line)', borderRadius: '8px', fontSize: '14px',
  fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--at-surface)', color: 'var(--at-ink)',
}
const thStyle: CSSProperties = {
  position: 'sticky', top: 0, background: 'var(--at-surface-2)', textAlign: 'left', padding: '8px 10px',
  fontWeight: 600, color: 'var(--at-ink-2)', borderBottom: '1px solid var(--at-line)', whiteSpace: 'nowrap',
}
const tdStyle: CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--at-line)', whiteSpace: 'nowrap' }
const tdNum: CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
