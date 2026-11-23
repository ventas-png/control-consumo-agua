// Importar el historial de lecturas que la empresa llevaba a mano (cuaderno,
// Excel) para que las lecturas nuevas se comparen contra él.
//
// Va a su propia tabla (agua_historial_lecturas), NO a `registros`: no genera
// cobros, no se factura, no aparece como deuda ni suma en los totales del
// Historial de Lecturas. La base valida cada lote entero (todo o nada), busca
// el contador por número de serie en el proyecto elegido, y re-importar la
// misma fecha reemplaza la fila.
import { useRef, useState } from 'react'
import { notify } from '../shared/Dialog'
import { ImportModal, type ImportColumn, type RowValidationResult } from '../shared'
import type { Contador, Proyecto } from '../../types'
import {
  importarHistorialLecturas,
  type FilaHistorialImport,
  type ResumenImportHistorial,
} from '../../domain/agua/historialLecturas'
import { claveSerie, leerNumeroHistorial, lotesPorContador, normalizarFechaHistorial } from '../../lib/historialConsumo'
import { proyectoDestinoInicial } from '../../lib/proyectoDestino'

const COLUMNS: ImportColumn[] = [
  { key: 'contador', width: 18, exampleValues: ['21B-001', '21B-001', '21B-002'] },
  { key: 'fecha',    width: 14, exampleValues: ['2025-10-31', '2025-11', '30/11/2025'] },
  { key: 'lectura',  width: 12, exampleValues: [1520, 1548, ''] },
  { key: 'consumo',  width: 12, exampleValues: ['', 28, 14] },
  { key: 'notas',    width: 28, exampleValues: ['Del cuaderno de 2025', '', 'Sólo se anotó el consumo'] },
]

/** Hoy en la zona del navegador, AAAA-MM-DD. */
function hoyLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Valida una fila de la hoja. El contador se busca entre los del proyecto
 * elegido (o, si aún no hay proyecto, entre todos los visibles): la base vuelve
 * a buscarlo en el proyecto al importar, que es la comprobación que manda.
 */
export function validarFilaHistorial(
  row: Record<string, unknown>,
  rowNumber: number,
  contadores: Pick<Contador, 'numero_serie' | 'project_id'>[],
  projectId: string,
  hoy = hoyLocal(),
): RowValidationResult<FilaHistorialImport> {
  const errors: string[] = []
  const serie = String(row['contador'] ?? '').trim()
  if (!serie) {
    errors.push('contador es obligatorio (el número como aparece en Contadores)')
  } else {
    const candidatos = contadores.filter(c =>
      claveSerie(c.numero_serie) === claveSerie(serie) && (!projectId || c.project_id === projectId))
    if (candidatos.length === 0) {
      errors.push(projectId
        ? `el contador «${serie}» no existe en el proyecto elegido`
        : `el contador «${serie}» no existe`)
    } else if (candidatos.length > 1 && projectId) {
      errors.push(`hay ${candidatos.length} contadores «${serie}» en el proyecto: corrija el número repetido`)
    }
  }

  const rawFecha = row['fecha']
  const fecha = normalizarFechaHistorial(rawFecha)
  if (!fecha) {
    errors.push(`fecha inválida «${String(rawFecha ?? '')}» — use AAAA-MM-DD, DD/MM/AAAA o sólo el mes (AAAA-MM)`)
  } else if (fecha > hoy) {
    errors.push(`la fecha ${fecha} está en el futuro`)
  }

  const lectura = leerNumeroHistorial(row['lectura'])
  const consumo = leerNumeroHistorial(row['consumo'])
  if (lectura !== null && (Number.isNaN(lectura) || lectura < 0)) errors.push(`lectura inválida «${String(row['lectura'])}»`)
  if (consumo !== null && (Number.isNaN(consumo) || consumo < 0)) errors.push(`consumo inválido «${String(row['consumo'])}»`)
  if (lectura === null && consumo === null) errors.push('falta la lectura o el consumo')

  if (errors.length) return { ok: false, errors }
  const notas = String(row['notas'] ?? '').trim()
  return {
    ok: true,
    data: { fila: rowNumber, contador: serie, fecha: fecha as string, lectura, consumo, notas: notas || null },
  }
}

/** El aviso del final: cuántas filas y qué pasó con la lectura inicial. */
export function textoResumenHistorial(r: ResumenImportHistorial): string {
  const partes = [
    `${r.insertadas} fila${r.insertadas === 1 ? '' : 's'} nueva${r.insertadas === 1 ? '' : 's'}` +
      (r.actualizadas ? ` y ${r.actualizadas} reemplazada${r.actualizadas === 1 ? '' : 's'}` : '') +
      ` de ${r.contadores} contador${r.contadores === 1 ? '' : 'es'}.`,
  ]
  const li = r.lectura_inicial
  if (li.actualizadas) {
    partes.push(`${li.actualizadas} contador${li.actualizadas === 1 ? '' : 'es'} sin lecturas toma${li.actualizadas === 1 ? '' : 'n'} como lectura inicial la última del historial.`)
  }
  if (li.sin_permiso) {
    partes.push(`${li.sin_permiso} contador${li.sin_permiso === 1 ? '' : 'es'} no cambi${li.sin_permiso === 1 ? 'ó' : 'aron'} su lectura inicial porque su usuario no puede editar contadores.`)
  }
  if (li.anteriores_a_instalacion) {
    partes.push(`${li.anteriores_a_instalacion} contador${li.anteriores_a_instalacion === 1 ? '' : 'es'} conserva${li.anteriores_a_instalacion === 1 ? '' : 'n'} su lectura inicial: el historial es anterior a su fecha de instalación.`)
  }
  if (li.menores) {
    partes.push(`${li.menores} contador${li.menores === 1 ? '' : 'es'} conserva${li.menores === 1 ? '' : 'n'} su lectura inicial: la última del historial es menor.`)
  }
  return partes.join(' ')
}

interface Props {
  proyectos: Proyecto[]
  contadores: Contador[]
  /** Proyecto filtrado en la pantalla; se propone como destino. */
  proyectoInicial?: string
  onClose: () => void
  /**
   * Tras cada lote que entra: los contadores cuya lectura inicial cambió, para
   * actualizar la pantalla (la primera captura nueva parte de ese valor).
   */
  onLecturaInicialActualizada: (cambios: Array<{ id: string; lectura_inicial: number }>) => void
}

const LOTE = 500

export function ImportHistorialLecturasModal({ proyectos, contadores, proyectoInicial, onClose, onLecturaInicialActualizada }: Props) {
  const [destinoId, setDestinoId] = useState(() => proyectoDestinoInicial(proyectos, proyectoInicial))
  // validateRow corre al leer el archivo: lee el proyecto elegido en ese momento.
  const destinoRef = useRef(destinoId)
  destinoRef.current = destinoId
  const acumulado = useRef<ResumenImportHistorial | null>(null)
  // Contadores distintos de toda la importación. La base cuenta los de CADA
  // lote; los lotes no parten un contador (makeBatches), y esto cubre el caso
  // raro de un contador con más filas que un lote.
  const contadoresVistos = useRef(new Set<string>())
  // Si un lote falla y se reintenta, el resumen vuelve a empezar.
  const fallo = useRef(false)

  const destino = proyectos.find(p => p.id === destinoId) ?? null

  const panel = (
    <div style={{ display: 'grid', gap: '10px' }}>
      {proyectos.length > 1 ? (
        <div>
          <label htmlFor="import-historial-proyecto" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>
            Proyecto *
          </label>
          <select
            id="import-historial-proyecto"
            value={destinoId}
            onChange={e => setDestinoId(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', border: '2px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--at-surface)', color: 'var(--at-ink)' }}
          >
            <option value="">— Elegir proyecto —</option>
            {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
      ) : destino ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)' }}>
          Proyecto: <strong>{destino.nombre}</strong>
        </p>
      ) : null}
      <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)', lineHeight: 1.5 }}>
        El historial sirve para <strong>comparar</strong> las lecturas nuevas (promedio y mismo mes del año anterior):
        no genera cobros. En el Historial de Lecturas aparece marcado como «histórico», fuera de los totales. Cada fila lleva el <strong>número del contador</strong> como
        aparece en Contadores, la <strong>fecha</strong> (AAAA-MM-DD, DD/MM/AAAA o sólo el mes, AAAA-MM) y la{' '}
        <strong>lectura</strong> y/o el <strong>consumo</strong>. Si una fecha ya estaba cargada, se reemplaza.
        Elija el proyecto antes de subir el archivo.
      </p>
    </div>
  )

  return (
    <ImportModal<FilaHistorialImport>
      entityLabel="lectura histórica"
      entityLabelPlural="lecturas históricas"
      sheetName="Historial"
      templateFilename="plantilla_historial_lecturas"
      columns={COLUMNS}
      validateRow={(row, n) => validarFilaHistorial(row, n, contadores, destinoRef.current)}
      // Cada lote es UNA sentencia en la base, con 8 s de tope (statement_timeout).
      batchSize={LOTE}
      // Un contador nunca se reparte entre lotes: la base resume la lectura
      // inicial por lote y el aviso suma esos resúmenes.
      makeBatches={filas => lotesPorContador(filas, f => claveSerie(f.contador), LOTE)}
      optionsPanel={panel}
      importDisabled={!destinoId}
      importDisabledReason="Elija el proyecto."
      onInsertBatch={async (batch) => {
        if (!destinoId) return { ok: 0, error: 'Elija el proyecto.' }
        if (fallo.current) { acumulado.current = null; contadoresVistos.current.clear(); fallo.current = false }
        const { data, error } = await importarHistorialLecturas(destinoId, batch)
        if (error || !data) {
          fallo.current = true
          return { ok: 0, error: error ?? 'No se pudo importar el historial.' }
        }
        if (data.lectura_inicial.contadores.length) onLecturaInicialActualizada(data.lectura_inicial.contadores)
        batch.forEach(f => contadoresVistos.current.add(claveSerie(f.contador)))
        const prev = acumulado.current
        acumulado.current = prev
          ? {
              filas: prev.filas + data.filas,
              insertadas: prev.insertadas + data.insertadas,
              actualizadas: prev.actualizadas + data.actualizadas,
              contadores: prev.contadores + data.contadores,
              lectura_inicial: {
                actualizadas: prev.lectura_inicial.actualizadas + data.lectura_inicial.actualizadas,
                sin_permiso: prev.lectura_inicial.sin_permiso + data.lectura_inicial.sin_permiso,
                con_lecturas: prev.lectura_inicial.con_lecturas + data.lectura_inicial.con_lecturas,
                anteriores_a_instalacion: prev.lectura_inicial.anteriores_a_instalacion + data.lectura_inicial.anteriores_a_instalacion,
                menores: prev.lectura_inicial.menores + data.lectura_inicial.menores,
                contadores: [...prev.lectura_inicial.contadores, ...data.lectura_inicial.contadores],
              },
            }
          : data
        acumulado.current = { ...acumulado.current, contadores: contadoresVistos.current.size }
        return { ok: batch.length }
      }}
      onClose={onClose}
      onImportado={() => {
        const r = acumulado.current
        if (r) notify({ variant: 'success', title: 'Historial importado', text: textoResumenHistorial(r) })
      }}
    />
  )
}
