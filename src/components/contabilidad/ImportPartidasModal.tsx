// Carga masiva de partidas presupuestarias.
//
// A diferencia de las demás importaciones del sistema, esta NO escribe en la
// base: vuelca las filas en el editor de partidas, donde el usuario las revisa
// junto a lo ya capturado y guarda con el botón de siempre. Así la carga masiva
// pasa por el mismo camino de escritura —y por la misma guarda de BD que impide
// tocar un presupuesto aprobado— en vez de abrir un segundo camino en paralelo.
import { useMemo, useState, type CSSProperties } from 'react'
import { ImportModal, type ImportColumn } from '../shared'
import { notify } from '../shared/Dialog'
import {
  COLUMNAS_MES,
  resolverPartidas,
  validarFilaPartida,
  type CuentaPresupuestable,
  type PartidaImportFila,
  type PartidaResuelta,
} from '../../domain/presupuesto/importPartidas'

export type ModoCarga = 'combinar' | 'reemplazar'

/** Ejemplos: una cuenta con desglose mensual y otra con total anual repartido. */
const COLUMNS: ImportColumn[] = [
  { key: 'codigo_cuenta', width: 16, exampleValues: ['5201-01', '5201-02'] },
  { key: 'nombre_cuenta', width: 30, exampleValues: ['Energía eléctrica', 'Agua potable'] },
  { key: 'total_anual',   width: 14, exampleValues: ['', 24000] },
  ...COLUMNAS_MES.map((mes, i): ImportColumn => ({
    key: mes,
    width: 10,
    // Enero–marzo con monto y el resto vacío: la plantilla muestra que se
    // capturan los meses que hagan falta, no que sean obligatorios los 12.
    exampleValues: [i < 3 ? 4500 : '', ''],
  })),
]

interface Props {
  /** Catálogo del ledger del presupuesto (la cuenta se resuelve por código). */
  cuentas: CuentaPresupuestable[]
  anio: number
  monedaBase: string
  onAplicar: (partidas: PartidaResuelta[], modo: ModoCarga) => void
  onClose: () => void
}

export function ImportPartidasModal({ cuentas, anio, monedaBase, onAplicar, onClose }: Props) {
  const [modo, setModo] = useState<ModoCarga>('combinar')
  const presupuestables = useMemo(
    () => cuentas.filter((c) => c.activa && c.es_detalle && (c.tipo === 'gasto' || c.tipo === 'ingreso')),
    [cuentas],
  )

  const panelOpciones = (
    <fieldset style={panelStyle}>
      <legend style={legendStyle}>Cómo se cargan las partidas</legend>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={filaStyle}>
          <input type="radio" name="modo-carga" checked={modo === 'combinar'} onChange={() => setModo('combinar')} />
          <span>
            <strong>Combinar</strong> — las cuentas del archivo pisan su renglón;
            las que ya tenías capturadas y no vienen en el archivo se conservan.
          </span>
        </label>
        <label style={filaStyle}>
          <input type="radio" name="modo-carga" checked={modo === 'reemplazar'} onChange={() => setModo('reemplazar')} />
          <span>
            <strong>Reemplazar</strong> — el presupuesto queda solo con las
            cuentas del archivo.
          </span>
        </label>
      </div>

      <div style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--at-ink-3)', lineHeight: 1.6 }}>
        Una fila por cuenta, montos de <strong>{anio}</strong> en {monedaBase}. La
        cuenta se busca por <code>codigo_cuenta</code> en el catálogo de esta
        contabilidad ({presupuestables.length} cuentas de ingreso/gasto
        presupuestables); <code>nombre_cuenta</code> es solo para leer el archivo.
        <div style={{ marginTop: 6 }}>
          Llena <strong>los meses</strong> cuando el gasto tenga estacionalidad, o
          solo <strong>total_anual</strong> para repartirlo en 12 (la última cuota
          absorbe el residuo del redondeo). Si mandas las dos cosas y no cuadran,
          la fila se rechaza en vez de adivinar. Un código repetido en varias
          filas se <strong>suma</strong>: sirve para desglosar por concepto.
        </div>
        <div style={{ marginTop: 6 }}>
          Nada se guarda todavía: las partidas caen en el editor y quedan
          grabadas cuando presiones <strong>Guardar partidas</strong>.
        </div>
      </div>
    </fieldset>
  )

  return (
    <ImportModal<PartidaImportFila>
      entityLabel="partida"
      entityLabelPlural="partidas"
      sheetName="Partidas"
      templateFilename={`plantilla_presupuesto_${anio}`}
      columns={COLUMNS}
      validateRow={validarFilaPartida}
      optionsPanel={panelOpciones}
      // El archivo completo llega en una sola pasada: la resolución de cuentas
      // y la suma de códigos repetidos necesitan verlo entero.
      batchSize={5000}
      onInsertBatch={async (batch) => {
        const plan = resolverPartidas(batch, cuentas)
        if (plan.omitidas.length > 0) {
          const muestra = plan.omitidas.slice(0, 4).map((o) => `${o.codigo}: ${o.motivo}`).join(' · ')
          notify({
            variant: 'warning',
            title: `${plan.omitidas.length} cuenta${plan.omitidas.length === 1 ? '' : 's'} sin cargar`,
            text: plan.omitidas.length > 4 ? `${muestra} …` : muestra,
          })
        }
        if (plan.sumadas.length > 0) {
          notify({
            variant: 'info',
            title: 'Códigos repetidos sumados',
            text: `Se sumaron las filas de: ${plan.sumadas.join(', ')}.`,
          })
        }
        if (plan.aplicar.length === 0) {
          return { ok: 0, error: 'Ninguna fila del archivo corresponde a una cuenta presupuestable de esta contabilidad.' }
        }
        onAplicar(plan.aplicar, modo)
        return { ok: plan.aplicar.length }
      }}
      onClose={onClose}
      onImportado={() => undefined}
    />
  )
}

const panelStyle: CSSProperties = {
  border: '1px solid var(--at-line)',
  borderRadius: 10,
  padding: '14px 16px',
  margin: 0,
  background: 'var(--at-surface-2)',
}

const legendStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--at-ink-2)',
  padding: '0 6px',
}

const filaStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 13,
  color: 'var(--at-ink)',
  cursor: 'pointer',
  lineHeight: 1.5,
}
