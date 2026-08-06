// Columnas y celdas de la tabla de contadores (P1 #3, extraídas de
// ContadoresSection con el JSX intacto). La sección memoiza el resultado de
// buildContadoresColumns con sus dependencias.
import type { CSSProperties } from 'react'
import type { Contador } from '../../types'
import type { DataTableColumn } from '../shared'
import { formatDate, formatNumber } from '../../lib/format'
import { getEditedTagInfo } from '../../lib/timeUtils'
import type { ContadoresCtx } from './ctx'
import { TIPO_COLORES, tipoLabel } from './ui'

export function buildContadoresColumns(ctx: ContadoresCtx): DataTableColumn<Contador>[] {
  const { tarifas, unidades, canEdit, canDelete, startEdit, handleEliminar, handleToggleActivo } = ctx

  const tarifaNombre = (id: string | null | undefined) =>
    id ? (tarifas.find(t => t.id === id)?.nombre ?? 'Tarifa desconocida') : null

  const unidadNombre = (id: string | null | undefined) =>
    id ? (unidades.find(u => u.id === id)?.nombre ?? 'Unidad desconocida') : null

  const cols: DataTableColumn<Contador>[] = [
    {
      key: 'serie', header: 'N° Serie', sortable: true,
      accessor: c => c.numero_serie,
      render: c => <SerieCell contador={c} />,
    },
    {
      key: 'tipo', header: 'Tipología', sortable: true,
      accessor: c => c.tipo_agua,
      render: c => {
        const col = TIPO_COLORES[c.tipo_agua]
        return (
          <span style={{
            padding: '3px 10px', borderRadius: 12,
            background: col.bg, color: col.color,
            fontSize: 12, fontWeight: 600,
          }}>
            {tipoLabel(c.tipo_agua)}
          </span>
        )
      },
    },
    {
      key: 'marcaModelo', header: 'Marca / Modelo',
      accessor: c => `${c.marca ?? ''} ${c.modelo ?? ''}`.trim(),
      render: c => {
        if (!c.marca && !c.modelo) return <span style={{ color: 'var(--at-line-strong)' }}>—</span>
        return (
          <span style={{ color: 'var(--at-ink-2)' }}>
            {c.marca && <span style={{ fontWeight: 500 }}>{c.marca}</span>}
            {c.marca && c.modelo && ' / '}
            {c.modelo && <span style={{ color: 'var(--at-ink-3)' }}>{c.modelo}</span>}
          </span>
        )
      },
    },
    {
      key: 'caracteristicas', header: 'Características', hideOnMobile: true,
      render: c => <CaracteristicasCell contador={c} />,
    },
    {
      key: 'lecturaInicial', header: 'Lect. Inicial', sortable: true, align: 'right',
      accessor: c => Number(c.lectura_inicial),
      render: c => (
        <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>
          {formatNumber(Number(c.lectura_inicial), 4)}
        </span>
      ),
    },
    {
      key: 'unidad', header: 'Unidad',
      accessor: c => unidadNombre(c.unidad_id) ?? '',
      render: c => {
        const nombre = unidadNombre(c.unidad_id)
        return nombre
          ? (
            <span style={{
              padding: '3px 10px', borderRadius: 12,
              background: 'var(--at-success-tint)', color: 'var(--at-success-strong)',
              fontSize: 12, fontWeight: 600,
            }}>
              🏠 {nombre}
            </span>
          )
          : <span style={{ color: 'var(--at-line-strong)', fontSize: 13 }}>Sin unidad</span>
      },
    },
    {
      key: 'tarifa', header: 'Tarifa',
      accessor: c => tarifaNombre(c.tarifa_id) ?? '',
      render: c => {
        const nombre = tarifaNombre(c.tarifa_id)
        return nombre
          ? (
            <span style={{
              padding: '3px 10px', borderRadius: 12,
              background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)',
              fontSize: 12, fontWeight: 600,
            }}>
              {nombre}
            </span>
          )
          : <span style={{ color: 'var(--at-line-strong)', fontSize: 13 }}>Sin tarifa</span>
      },
    },
    {
      key: 'estado', header: 'Estado', sortable: true, align: 'center',
      accessor: c => c.activo ? 1 : 0,
      render: c => {
        const baseStyle: CSSProperties = {
          padding: '4px 14px', borderRadius: 20, fontWeight: 600, fontSize: 12,
          background: c.activo ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
          color: c.activo ? 'var(--at-success-strong)' : 'var(--at-danger-strong)',
        }
        if (canEdit) {
          return (
            <button
              onClick={() => handleToggleActivo(c)}
              title="Clic para cambiar estado"
              style={{ ...baseStyle, border: 'none', cursor: 'pointer' }}
            >
              {c.activo ? 'Activo' : 'Inactivo'}
            </button>
          )
        }
        return <span style={baseStyle}>{c.activo ? 'Activo' : 'Inactivo'}</span>
      },
    },
  ]
  if (canEdit) {
    cols.push({
      key: 'acciones', header: 'Acciones', align: 'center',
      render: c => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          <button
            onClick={() => startEdit(c)}
            style={{
              padding: '5px 12px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
            }}
          >Editar</button>
          {canDelete && (
            <button
              onClick={() => handleEliminar(c)}
              style={{
                padding: '5px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}
            >Eliminar</button>
          )}
        </div>
      ),
    })
  }
  return cols
}

// ── Sub-componentes de celdas para la tabla de contadores ────────────────

function SerieCell({ contador: c }: { contador: Contador }) {
  const tag = getEditedTagInfo(c.updated_at, c.updated_by_name)
  return (
    <div>
      <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{c.numero_serie}</div>
      {c.descripcion && (
        <div style={{ fontSize: 12, color: 'var(--at-ink-3)', fontWeight: 400, marginTop: 2 }}>
          {c.descripcion}
        </div>
      )}
      {c.fecha_instalacion && (
        <div style={{ fontSize: 11, color: 'var(--at-line-strong)', marginTop: 1 }}>
          Inst: {formatDate(c.fecha_instalacion)}
        </div>
      )}
      {tag && (
        <span
          title={tag.tooltip}
          style={{
            display: 'inline-block', marginTop: 4, padding: '2px 8px',
            borderRadius: 10, fontSize: 11, fontWeight: 500,
            color: tag.color, background: tag.bg, cursor: 'default',
          }}
        >
          {tag.label}
        </span>
      )}
    </div>
  )
}

function CaracteristicasCell({ contador: c }: { contador: Contador }) {
  const hasAny = c.medida || c.tipo_contador || c.material || c.valvula_cheque ||
    c.tipo_llave || c.llave_antifraude || c.valvula_aire ||
    c.fecha_reemplazo_sugerida || c.numero_derecho_servicio ||
    c.cantidad_derecho_servicio_m3 != null || c.periodicidad_lectura_dias != null ||
    c.contratista_instalador || c.garantia_instalacion_vence
  if (!hasAny) return <span style={{ color: 'var(--at-line-strong)' }}>—</span>

  const now = new Date()
  const reemplazoVencido = c.fecha_reemplazo_sugerida
    ? new Date(c.fecha_reemplazo_sugerida + 'T12:00:00') <= now
    : false
  const garantiaVencida = c.garantia_instalacion_vence
    ? new Date(c.garantia_instalacion_vence + 'T12:00:00') <= now
    : false

  return (
    <div style={{ fontSize: 12, color: 'var(--at-ink-2)' }}>
      {c.medida && <Field label="Medida" value={c.medida} />}
      {c.tipo_contador && <Field label="Tipo" value={c.tipo_contador} />}
      {c.material && <Field label="Material" value={c.material} />}
      {c.valvula_cheque && <Field label="V. Cheque" value={c.valvula_cheque} />}
      {c.tipo_llave && <Field label="Llave" value={c.tipo_llave} />}
      {c.llave_antifraude && <Field label="Antifraude" value={c.llave_antifraude} />}
      {c.valvula_aire && <Field label="V. Aire" value={c.valvula_aire} />}
      {c.fecha_reemplazo_sugerida && (
        <div style={{ color: reemplazoVencido ? 'var(--at-danger)' : 'var(--at-primary-hover)', fontWeight: 600 }}>
          Reemplazo: {formatDate(c.fecha_reemplazo_sugerida)}
        </div>
      )}
      {c.numero_derecho_servicio && <Field label="Derecho" value={c.numero_derecho_servicio} />}
      {c.cantidad_derecho_servicio_m3 != null && (
        <Field label="Caudal" value={`${Number(c.cantidad_derecho_servicio_m3).toFixed(2)} m³`} />
      )}
      {c.periodicidad_lectura_dias != null && (
        <Field label="Lectura c/" value={`${c.periodicidad_lectura_dias} días`} />
      )}
      {c.contratista_instalador && <Field label="Instalador" value={c.contratista_instalador} />}
      {c.garantia_instalacion_vence && (
        <div style={{ color: garantiaVencida ? 'var(--at-danger)' : 'var(--at-success-strong)', fontWeight: 600 }}>
          Garantía: {formatDate(c.garantia_instalacion_vence)}
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><span style={{ color: 'var(--at-ink-3)' }}>{label}:</span> {value}</div>
}
