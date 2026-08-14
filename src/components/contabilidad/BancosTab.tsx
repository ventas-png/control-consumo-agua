import { useMemo, useState } from 'react'
import { DataTable, type DataTableColumn, ImportModal, type RowValidationResult } from '../shared'
import { EditModal } from '../shared'
import { FilterChips } from '../shared/FilterChips'
import { StatusBadge } from '../shared/StatusBadge'
import { confirm, notify } from '../shared/Dialog'
import { useCuentasQuery } from '../../domain/contabilidad/queries'
import {
  useCuentasBancariasQuery,
  useEstadoConciliacionQuery,
  useMovimientosBancoQuery,
  useSugerenciasQuery,
} from '../../domain/bancos/queries'
import {
  useAjusteConciliacionMutation,
  useConciliarMutation,
  useDescartarMovimientoMutation,
  useDesconciliarMutation,
  useGuardarCuentaBancariaMutation,
  useImportarMovimientosMutation,
} from '../../domain/bancos/mutations'
import { cuentaBancariaFormSchema, validarFilaExtracto, type MovimientoImportado } from '../../domain/bancos/schemas'
import { formatCurrency, formatDateShort, mesLocalISO } from '../../lib/format'
import {
  ESTADO_MOVIMIENTO_LABELS,
  MATCH_TIPO_LABELS,
  type BancoMovimiento,
  type CuentaBancaria,
  type SugerenciaConciliacion,
} from '../../types/bancos'
import { Campo, btnLink, btnPrimario, btnSecundario, input , usePermisosContabilidad } from './ui'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  monedaBase: string
}

type FiltroEstado = 'pendiente' | 'conciliado' | 'descartado' | 'todos'

const TONO_ESTADO = { pendiente: 'warning', conciliado: 'success', descartado: 'neutral' } as const

function periodoActual(): string {
  return mesLocalISO()
}

export function BancosTab({ companyId, projectId, monedaBase }: Props) {
  const { puedeCrear, puedeEditar, puedeCambiarEstado } = usePermisosContabilidad()
  const { data: cuentasBancarias = [], isLoading: cargandoCuentas } = useCuentasBancariasQuery(companyId, projectId)
  const [cuentaId, setCuentaId] = useState('')
  const [filtro, setFiltro] = useState<FiltroEstado>('pendiente')
  const [periodo, setPeriodo] = useState(periodoActual())
  const [formCuenta, setFormCuenta] = useState<CuentaBancaria | 'nueva' | null>(null)
  const [importando, setImportando] = useState(false)

  const cuentaActiva = cuentasBancarias.find((c) => c.id === cuentaId) ?? cuentasBancarias[0] ?? null
  const cuentaActivaId = cuentaActiva?.id
  const monedaCuenta = cuentaActiva?.moneda ?? monedaBase

  const { data: movimientos = [], isLoading } = useMovimientosBancoQuery(
    cuentaActivaId,
    filtro === 'todos' ? undefined : filtro,
  )
  const { data: sugerencias = [] } = useSugerenciasQuery(cuentaActivaId)
  const { data: estado } = useEstadoConciliacionQuery(cuentaActivaId, periodo)

  const importar = useImportarMovimientosMutation(companyId, projectId)
  const conciliar = useConciliarMutation()
  const desconciliar = useDesconciliarMutation()
  const ajuste = useAjusteConciliacionMutation()
  const descartar = useDescartarMovimientoMutation()

  const sugerenciasPorMovimiento = useMemo(() => {
    const m = new Map<string, SugerenciaConciliacion[]>()
    for (const s of sugerencias) {
      const arr = m.get(s.movimiento_id) ?? []
      arr.push(s)
      m.set(s.movimiento_id, arr)
    }
    return m
  }, [sugerencias])

  async function accion(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn()
      notify({ variant: 'success', title: 'Listo', text: ok })
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo completar la acción.' })
    }
  }

  const columns: DataTableColumn<BancoMovimiento>[] = [
    { key: 'fecha', header: 'Fecha', accessor: (m) => m.fecha, render: (m) => formatDateShort(m.fecha), sortable: true, width: 100 },
    { key: 'descripcion', header: 'Descripción', accessor: (m) => m.descripcion ?? '', render: (m) => m.descripcion ?? '—' },
    { key: 'referencia', header: 'Ref.', accessor: (m) => m.referencia ?? '', render: (m) => m.referencia ?? '—', width: 110, hideOnMobile: true },
    {
      key: 'monto',
      header: `Monto (${monedaCuenta})`,
      accessor: (m) => m.monto,
      render: (m) => (
        <span style={{ color: m.monto < 0 ? 'var(--at-danger)' : 'var(--at-success)', fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(m.monto, monedaCuenta)}
        </span>
      ),
      numeric: true,
      width: 130,
    },
    {
      key: 'estado',
      header: 'Estado',
      accessor: (m) => m.estado,
      render: (m) => (
        <StatusBadge tone={TONO_ESTADO[m.estado]}>
          {m.estado === 'conciliado' && m.match_tipo
            ? MATCH_TIPO_LABELS[m.match_tipo]
            : ESTADO_MOVIMIENTO_LABELS[m.estado]}
        </StatusBadge>
      ),
      width: 130,
    },
    {
      key: 'acciones',
      header: '',
      render: (m) => {
        const sugs = sugerenciasPorMovimiento.get(m.id) ?? []
        return (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {m.estado === 'pendiente' && puedeCambiarEstado && sugs.slice(0, 1).map((s) => (
              <button
                key={s.candidato_id}
                onClick={() => void accion(
                  () => conciliar.mutateAsync({ movimientoId: m.id, matchTipo: s.candidato_tipo, matchId: s.candidato_id }),
                  'Movimiento conciliado.',
                )}
                style={{ ...btnLink, color: s.confianza === 'exacta' ? 'var(--at-success)' : 'var(--at-warning-strong)' }}
                title={`${s.candidato_descripcion ?? ''} (${formatDateShort(s.candidato_fecha)})${s.confianza === 'aproximada' ? ` — match aproximado: ${formatCurrency(s.candidato_monto, monedaBase)}` : ''}`}
              >
                {s.confianza === 'exacta' ? '✓' : '≈'} Conciliar con {MATCH_TIPO_LABELS[s.candidato_tipo].toLowerCase()}
              </button>
            ))}
            {m.estado === 'pendiente' && puedeCambiarEstado && (
              <>
                <button
                  onClick={() => {
                    void (async () => {
                      const { isConfirmed } = await confirm({
                        title: m.monto < 0 ? '¿Registrar como comisión bancaria?' : '¿Registrar como intereses?',
                        text: 'Se generará la póliza contable contra la cuenta del banco y el movimiento quedará conciliado.',
                        confirmText: 'Registrar ajuste',
                      })
                      if (isConfirmed) void accion(() => ajuste.mutateAsync({ movimientoId: m.id }), 'Ajuste contabilizado y conciliado.')
                    })()
                  }}
                  style={btnLink}
                >
                  Ajuste
                </button>
                <button onClick={() => void accion(() => descartar.mutateAsync({ movimientoId: m.id, descartar: true }), 'Movimiento descartado.')} style={{ ...btnLink, color: 'var(--at-ink-soft)' }}>
                  Descartar
                </button>
              </>
            )}
            {m.estado === 'conciliado' && m.match_tipo !== 'ajuste' && puedeCambiarEstado && (
              <button onClick={() => void accion(() => desconciliar.mutateAsync(m.id), 'Conciliación revertida.')} style={{ ...btnLink, color: 'var(--at-warning)' }}>
                Desconciliar
              </button>
            )}
            {m.estado === 'descartado' && puedeCambiarEstado && (
              <button onClick={() => void accion(() => descartar.mutateAsync({ movimientoId: m.id, descartar: false }), 'Movimiento restaurado.')} style={btnLink}>
                Restaurar
              </button>
            )}
          </div>
        )
      },
      width: 260,
    },
  ]

  const diferencia = estado ? Math.round((estado.saldo_banco - (estado.saldo_libro_origen ?? estado.saldo_libro)) * 100) / 100 : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={cuentaActivaId ?? ''}
          onChange={(e) => setCuentaId(e.target.value)}
          style={{ ...input, minWidth: 240 }}
          aria-label="Cuenta bancaria"
          disabled={cuentasBancarias.length === 0}
        >
          {cuentasBancarias.length === 0 && <option value="">Sin cuentas bancarias</option>}
          {cuentasBancarias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} · {c.banco}{c.numero_mascara ? ` ····${c.numero_mascara}` : ''}{c.moneda ? ` (${c.moneda})` : ''}
            </option>
          ))}
        </select>
        <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ ...input, width: 150 }} aria-label="Periodo" />
        <span style={{ flex: 1 }} />
        {cuentaActiva && (
          <>
            {puedeCrear && (
              <button onClick={() => setImportando(true)} style={btnSecundario}>Importar extracto</button>
            )}
            {puedeEditar && (
              <button onClick={() => setFormCuenta(cuentaActiva)} style={btnSecundario}>Editar cuenta</button>
            )}
          </>
        )}
        {puedeCrear && (
          <button onClick={() => setFormCuenta('nueva')} style={btnPrimario}>+ Cuenta bancaria</button>
        )}
      </div>

      {cuentaActiva && estado && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Tarjeta titulo={`Saldo libro (${monedaBase})`} valor={formatCurrency(estado.saldo_libro, monedaBase)} />
          {estado.saldo_libro_origen !== null && (
            <Tarjeta titulo={`Saldo libro (${monedaCuenta})`} valor={formatCurrency(estado.saldo_libro_origen, monedaCuenta)} />
          )}
          <Tarjeta titulo={`Saldo extracto (${monedaCuenta})`} valor={formatCurrency(estado.saldo_banco, monedaCuenta)} />
          <Tarjeta
            titulo="Diferencia"
            valor={formatCurrency(diferencia, monedaCuenta)}
            tono={diferencia === 0 ? 'var(--at-success)' : 'var(--at-warning)'}
          />
          <Tarjeta
            titulo="Pendientes"
            valor={`${estado.pendientes} · ${formatCurrency(estado.monto_pendiente, monedaCuenta)}`}
            tono={estado.pendientes === 0 ? 'var(--at-success)' : 'var(--at-warning)'}
          />
        </div>
      )}

      {cuentaActiva ? (
        <>
          <FilterChips<FiltroEstado>
            options={[
              { value: 'pendiente', label: 'Pendientes', color: 'var(--at-warning)' },
              { value: 'conciliado', label: 'Conciliados', color: 'var(--at-success)' },
              { value: 'descartado', label: 'Descartados' },
              { value: 'todos', label: 'Todos' },
            ]}
            value={filtro}
            onChange={setFiltro}
            ariaLabel="Filtrar movimientos"
          />
          <DataTable<BancoMovimiento>
            data={movimientos}
            columns={columns}
            rowKey="id"
            isLoading={isLoading}
            searchableKeys={[(m) => m.descripcion ?? '', (m) => m.referencia ?? '']}
            searchPlaceholder="Buscar movimiento…"
            defaultSort={{ key: 'fecha', direction: 'desc' }}
            emptyState={{
              title: 'Sin movimientos',
              description: 'Importa el extracto bancario (XLSX con columnas fecha, descripcion, referencia, monto — el monto con signo: + depósito, − retiro).',
            }}
          />
        </>
      ) : !cargandoCuentas ? (
        <p style={{ color: 'var(--at-ink-soft)', fontSize: 13 }}>
          Registra tu primera cuenta bancaria (alias, banco y su cuenta contable, ej. 1102-01) para importar extractos y conciliar.
        </p>
      ) : null}

      {formCuenta && (
        <CuentaBancariaModal
          companyId={companyId}
          projectId={projectId}
          monedaBase={monedaBase}
          cuenta={formCuenta === 'nueva' ? null : formCuenta}
          onClose={() => setFormCuenta(null)}
        />
      )}

      {importando && cuentaActiva && (
        <ImportModal<MovimientoImportado>
          entityLabel="movimiento"
          entityLabelPlural="movimientos del extracto"
          columns={[
            { key: 'fecha', width: 12, exampleValues: ['2026-06-01', '02/06/2026'] },
            { key: 'descripcion', width: 32, exampleValues: ['DEPOSITO TRANSFERENCIA', 'COMISION MANEJO CTA'] },
            { key: 'referencia', width: 14, exampleValues: ['TRF-001', ''] },
            { key: 'monto', width: 12, exampleValues: [350.0, -15.0] },
          ]}
          validateRow={(row): RowValidationResult<MovimientoImportado> => validarFilaExtracto(row)}
          onInsertBatch={async (batch) => {
            try {
              const ok = await importar.mutateAsync({ cuenta: cuentaActiva, movimientos: batch })
              return { ok }
            } catch (e) {
              return { ok: 0, error: e instanceof Error ? e.message : 'Error al insertar.' }
            }
          }}
          onClose={() => setImportando(false)}
          onImportado={(count) => {
            setImportando(false)
            notify({ variant: 'success', title: 'Extracto importado', text: `${count} movimientos nuevos (los repetidos con referencia se omiten).` })
          }}
        />
      )}
    </div>
  )
}

function Tarjeta({ titulo, valor, tono }: { titulo: string; valor: string; tono?: string }) {
  return (
    <div style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: '10px 14px', background: 'var(--at-surface)' }}>
      <div style={{ fontSize: 11, color: 'var(--at-ink-soft)', fontWeight: 600 }}>{titulo}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: tono ?? 'var(--at-ink)', fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
    </div>
  )
}

// ── Modal: alta/edición de cuenta bancaria ──────────────────────────────────

function CuentaBancariaModal({ companyId, projectId, monedaBase, cuenta, onClose }: {
  companyId: string
  projectId: string | null
  monedaBase: string
  cuenta: CuentaBancaria | null
  onClose: () => void
}) {
  const { data: cuentasContables = [] } = useCuentasQuery(companyId, projectId)
  const guardar = useGuardarCuentaBancariaMutation(companyId, projectId)
  const [f, setF] = useState({
    nombre: cuenta?.nombre ?? '',
    banco: cuenta?.banco ?? '',
    numero_mascara: cuenta?.numero_mascara ?? '',
    moneda: cuenta?.moneda ?? '',
    cuenta_contable_id: cuenta?.cuenta_contable_id ?? '',
    notas: cuenta?.notas ?? '',
  })

  const elegibles = useMemo(
    () => cuentasContables.filter((c) => c.es_detalle && c.activa && c.tipo === 'activo'),
    [cuentasContables],
  )

  async function onGuardar() {
    const parsed = cuentaBancariaFormSchema.safeParse({
      nombre: f.nombre,
      banco: f.banco,
      numero_mascara: f.numero_mascara.trim() ? f.numero_mascara.trim().slice(-4) : null,
      moneda: f.moneda.trim() || null,
      cuenta_contable_id: f.cuenta_contable_id,
      notas: f.notas.trim() || null,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    try {
      await guardar.mutateAsync({ id: cuenta?.id, input: parsed.data })
      notify({ variant: 'success', title: 'Listo', text: cuenta ? 'Cuenta actualizada.' : 'Cuenta bancaria creada.' })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo guardar.' })
    }
  }

  return (
    <EditModal title={cuenta ? 'Editar cuenta bancaria' : 'Nueva cuenta bancaria'} onClose={onClose} size="sm"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void onGuardar()} disabled={guardar.isPending} style={btnPrimario}>Guardar</button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Campo label="Alias *">
            <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} style={input} placeholder="BI monetaria GTQ" />
          </Campo>
          <Campo label="Banco *">
            <input value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} style={input} placeholder="Banco Industrial" />
          </Campo>
          <Campo label="Últimos 4 dígitos">
            <input value={f.numero_mascara} onChange={(e) => setF({ ...f, numero_mascara: e.target.value })} style={input} maxLength={8} placeholder="4321" />
          </Campo>
          <Campo label={`Moneda (vacío = ${monedaBase})`}>
            <input value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value.toUpperCase() })} style={input} maxLength={3} placeholder="USD" />
          </Campo>
        </div>
        <Campo label="Cuenta contable del banco *">
          <select value={f.cuenta_contable_id} onChange={(e) => setF({ ...f, cuenta_contable_id: e.target.value })} style={input}>
            <option value="">Selecciona…</option>
            {elegibles.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}{c.moneda ? ` (${c.moneda})` : ''}</option>)}
          </select>
        </Campo>
        <Campo label="Notas">
          <textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} style={{ ...input, minHeight: 50 }} />
        </Campo>
      </div>
    </EditModal>
  )
}
