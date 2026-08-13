// Carga masiva del catálogo de cuentas.
//
// Lo específico de esta importación (frente a las demás del sistema) es el
// DESTINO: la contabilidad no es una sola, hay una por ledger — la de la
// empresa y la de cada proyecto — y cada una lleva su propio catálogo. Por eso
// el modal deja marcar varias contabilidades y aplica el mismo archivo a todas,
// resolviendo en cada una los códigos padre contra SU catálogo.
import { useMemo, useState, type CSSProperties } from 'react'
import { ImportModal, type ImportColumn } from '../shared'
import { StatusBadge } from '../shared/StatusBadge'
import { notify } from '../shared/Dialog'
import { useImportarCuentasMutation } from '../../domain/contabilidad/mutations'
import { validarFilaCuenta, type CuentaImportFila } from '../../domain/contabilidad/importCuentas'
import type { Proyecto } from '../../types/plataforma'
import { btnSecundario } from './ui'

/** Clave del ledger en la UI: '' = empresa, uuid = proyecto. */
const EMPRESA = ''

const COLUMNS: ImportColumn[] = [
  { key: 'codigo',       width: 14, exampleValues: ['1102-03', '5201', '5201-01'] },
  { key: 'nombre',       width: 30, exampleValues: ['Banco Promerica USD', 'Servicios básicos', 'Energía eléctrica'] },
  { key: 'tipo',         width: 12, exampleValues: ['activo', 'gasto', 'gasto'] },
  { key: 'naturaleza',   width: 12, exampleValues: ['deudora', '', ''] },
  { key: 'padre_codigo', width: 14, exampleValues: ['1102', '52', '5201'] },
  { key: 'es_detalle',   width: 12, exampleValues: ['sí', 'no', 'sí'] },
  { key: 'moneda',       width: 10, exampleValues: ['USD', '', ''] },
  { key: 'descripcion',  width: 34, exampleValues: ['Cuenta monetaria en dólares', '', ''] },
]

interface Props {
  companyId: string
  /** Ledger activo al abrir el modal (null = empresa): viene premarcado. */
  projectId: string | null
  proyectos: Proyecto[]
  onClose: () => void
  onImportado: () => void
}

export function ImportCuentasModal({ companyId, projectId, proyectos, onClose, onImportado }: Props) {
  const importar = useImportarCuentasMutation(companyId)
  const [destinos, setDestinos] = useState<string[]>([projectId ?? EMPRESA])
  const [actualizarExistentes, setActualizarExistentes] = useState(false)

  const proyectosActivos = useMemo(() => proyectos.filter((p) => p.estado === 'activo'), [proyectos])

  function alternar(clave: string) {
    setDestinos((prev) => (prev.includes(clave) ? prev.filter((d) => d !== clave) : [...prev, clave]))
  }

  const panelDestinos = (
    <fieldset style={panelStyle}>
      <legend style={legendStyle}>Contabilidades destino</legend>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--at-ink-3)' }}>
        El mismo archivo se aplica a cada contabilidad marcada. En cada una los
        códigos padre se resuelven contra su propio catálogo, y los códigos que
        ya existan allí se omiten (o se actualizan, si lo marcas abajo).
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => setDestinos([EMPRESA, ...proyectosActivos.map((p) => p.id)])}
          style={{ ...btnSecundario, fontSize: 12, padding: '6px 10px' }}
        >
          Empresa + proyectos activos
        </button>
        <button
          type="button"
          onClick={() => setDestinos(proyectosActivos.map((p) => p.id))}
          disabled={proyectosActivos.length === 0}
          style={{ ...btnSecundario, fontSize: 12, padding: '6px 10px' }}
        >
          Solo proyectos activos
        </button>
        <button
          type="button"
          onClick={() => setDestinos([])}
          style={{ ...btnSecundario, fontSize: 12, padding: '6px 10px' }}
        >
          Limpiar
        </button>
      </div>

      <div style={listaStyle}>
        <label style={filaStyle}>
          <input type="checkbox" checked={destinos.includes(EMPRESA)} onChange={() => alternar(EMPRESA)} />
          <span style={{ fontWeight: 600 }}>🏢 Empresa</span>
        </label>
        {proyectos.map((p) => (
          <label key={p.id} style={filaStyle}>
            <input type="checkbox" checked={destinos.includes(p.id)} onChange={() => alternar(p.id)} />
            <span style={{ fontWeight: 600 }}>📍 {p.nombre}</span>
            {p.estado !== 'activo' && <StatusBadge tone="neutral">{p.estado}</StatusBadge>}
          </label>
        ))}
        {proyectos.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', padding: '6px 2px' }}>
            Esta empresa aún no tiene proyectos: el catálogo se cargará solo en la contabilidad de la empresa.
          </div>
        )}
      </div>

      <label style={{ ...filaStyle, marginTop: 10, borderTop: '1px solid var(--at-line)', paddingTop: 10 }}>
        <input
          type="checkbox"
          checked={actualizarExistentes}
          onChange={(e) => setActualizarExistentes(e.target.checked)}
        />
        <span style={{ fontSize: 13 }}>
          Actualizar las cuentas cuyo código ya exista (nombre, tipo, naturaleza,
          moneda y descripción). No cambian de rama ni de nivel.
        </span>
      </label>

      <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--at-ink-3)', lineHeight: 1.5 }}>
        La cuenta padre se indica por <strong>código</strong> en la columna
        <code> padre_codigo</code>. Si la dejas vacía se deduce del propio código
        (1102-01 → 1102, 1102 → 11) y, si ese código no existe, la cuenta se crea
        en la raíz. Las cuentas con hijos quedan como agrupadoras (no reciben
        movimientos) y el árbol admite hasta 5 niveles.
      </p>
    </fieldset>
  )

  return (
    <ImportModal<CuentaImportFila>
      entityLabel="cuenta"
      entityLabelPlural="cuentas"
      sheetName="Catálogo"
      templateFilename="plantilla_catalogo_cuentas"
      columns={COLUMNS}
      validateRow={validarFilaCuenta}
      optionsPanel={panelDestinos}
      importDisabled={destinos.length === 0}
      importDisabledReason="Marca al menos una contabilidad destino."
      // Un catálogo completo son decenas de cuentas: el lote grande deja que el
      // plan (padres→hijos) se resuelva de una sola pasada. Si aun así hubiera
      // más de un lote, cada llamada relee el catálogo del ledger, así que los
      // padres creados en el lote anterior siguen resolviendo.
      batchSize={1000}
      onInsertBatch={async (batch) => {
        try {
          const res = await importar.mutateAsync({
            filas: batch,
            ledgers: destinos.map((d) => (d === EMPRESA ? null : d)),
            actualizarExistentes,
          })
          const omitidas = res.porLedger.flatMap((l) => l.omitidas)
          if (omitidas.length > 0) {
            const muestra = omitidas.slice(0, 4).map((o) => `${o.codigo}: ${o.motivo}`).join(' · ')
            notify({
              variant: 'warning',
              title: `${omitidas.length} cuenta${omitidas.length === 1 ? '' : 's'} sin cargar`,
              text: omitidas.length > 4 ? `${muestra} …` : muestra,
            })
          }
          const fallidos = res.porLedger.filter((l) => l.error)
          if (fallidos.length > 0) {
            notify({
              variant: 'error',
              title: 'Contabilidades con fallo',
              text: fallidos.map((l) => `${nombreLedger(l.ledger, proyectos)}: ${l.error}`).join(' · '),
            })
          }
          const detalle = res.porLedger
            .map((l) => `${nombreLedger(l.ledger, proyectos)}: ${l.creadas} nueva${l.creadas === 1 ? '' : 's'}${l.actualizadas > 0 ? `, ${l.actualizadas} actualizada${l.actualizadas === 1 ? '' : 's'}` : ''}`)
            .join(' · ')
          notify({ variant: 'success', title: 'Catálogo cargado', text: detalle })
          return { ok: res.creadas + res.actualizadas }
        } catch (e) {
          return { ok: 0, error: e instanceof Error ? e.message : 'No se pudo cargar el catálogo.' }
        }
      }}
      onClose={onClose}
      onImportado={onImportado}
    />
  )
}

function nombreLedger(ledger: string | null, proyectos: Proyecto[]): string {
  if (!ledger) return 'Empresa'
  return proyectos.find((p) => p.id === ledger)?.nombre ?? 'Proyecto'
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

const listaStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 180,
  overflowY: 'auto',
}

const filaStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: 'var(--at-ink)',
  cursor: 'pointer',
}
