import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { fetchHorasPersonal } from '../../../domain/condominios/tabQueries'
import { formatHoras } from '../../../domain/condominios/turnos'
import { MESES, moverMes, rangoMes } from '../../../lib/calendario'
import { hoyLocalISO } from '../../../lib/format'
import { EmptyState } from '../../shared'
import { ExportButton } from '../../shared/ExportButton'
import { Skeleton } from '../../shared/Skeleton'
import type { HorasPersonal } from '../../../types'

interface Props {
  proyectoId: string
  proyectoNombre?: string
}

const th: CSSProperties = {
  textAlign: 'right', padding: '8px 10px', fontSize: 11, fontWeight: 700,
  color: 'var(--at-ink-3)', borderBottom: '1px solid var(--at-line-strong)', whiteSpace: 'nowrap',
}
const td: CSSProperties = {
  textAlign: 'right', padding: '8px 10px', fontSize: 12.5,
  color: 'var(--at-ink-2)', borderBottom: '1px solid var(--at-table-row-border)', whiteSpace: 'nowrap',
}

/**
 * Horario normal y horas extras laboradas y computadas.
 *
 * Cruza lo PLANIFICADO (`bloques_turno`) con lo MARCADO (`presencia_personal`),
 * y aplica el calendario laboral y las ausencias. El cálculo vive en la RPC
 * `calcular_horas_personal` (20260820000300) y NO se persiste: se recalcula del
 * marcaje vigente, para que corregir una hora de salida mal tecleada corrija
 * también el total. Eso significa que este tab siempre dice la verdad de hoy,
 * no la de cuando alguien pulsó un botón.
 *
 * Criterio de extra, por día y contra la jornada asignada:
 *   ordinarias = min(trabajadas, planificadas)
 *   extra      = max(0, trabajadas − planificadas)
 */
export default function HorasExtraTab({ proyectoId, proyectoNombre }: Props) {
  const hoy = hoyLocalISO()
  const [cursor, setCursor] = useState(() => {
    const [y, m] = hoy.split('-').map(Number)
    return { year: y, month: m - 1 }
  })
  const [filas, setFilas] = useState<HorasPersonal[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const rango = useMemo(() => rangoMes(cursor.year, cursor.month), [cursor])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setFilas(await fetchHorasPersonal(proyectoId, rango.desde, rango.hasta))
    } catch (e) {
      // La RPC exige el permiso del tab además de la empresa: un 42501 aquí es
      // "no tenés acceso", no "no hay datos". Distinguirlo evita que alguien
      // concluya que el mes está vacío.
      setError(e instanceof Error ? e.message : 'No se pudieron calcular las horas')
      setFilas([])
    } finally {
      setCargando(false)
    }
  }, [proyectoId, rango.desde, rango.hasta])

  useEffect(() => { void cargar() }, [cargar])

  const totales = useMemo(() => filas.reduce((acc, f) => ({
    ordinarias: acc.ordinarias + Number(f.horas_ordinarias || 0),
    extra: acc.extra + Number(f.horas_extra || 0),
    nocturnas: acc.nocturnas + Number(f.horas_nocturnas || 0),
    asueto: acc.asueto + Number(f.horas_asueto || 0),
    planificadas: acc.planificadas + Number(f.horas_planificadas || 0),
    trabajadas: acc.trabajadas + Number(f.horas_trabajadas || 0),
  }), { ordinarias: 0, extra: 0, nocturnas: 0, asueto: 0, planificadas: 0, trabajadas: 0 }), [filas])

  const periodo = `${MESES[cursor.month]} ${cursor.year}`

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setCursor(c => moverMes(c.year, c.month, -1))}
            aria-label="Mes anterior"
            style={{ padding: '6px 12px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', color: 'var(--at-ink)' }}
          >‹</button>
          <div style={{ fontWeight: 700, fontSize: 15, minWidth: 160, textAlign: 'center', color: 'var(--at-ink)' }}>{periodo}</div>
          <button
            onClick={() => setCursor(c => moverMes(c.year, c.month, 1))}
            aria-label="Mes siguiente"
            style={{ padding: '6px 12px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', color: 'var(--at-ink)' }}
          >›</button>
        </div>
        {filas.length > 0 && (
          <ExportButton
            data={filas}
            columns={[
              { header: 'Empleado', accessor: 'nombre' },
              { header: 'Cargo', accessor: 'cargo' },
              { header: 'Días programados', accessor: 'dias_planificados', align: 'right' },
              { header: 'Días trabajados', accessor: 'dias_trabajados', align: 'right' },
              { header: 'Días de ausencia', accessor: 'dias_ausencia', align: 'right' },
              { header: 'Tardanzas', accessor: 'tardanzas', align: 'right' },
              { header: 'Horas programadas', accessor: 'horas_planificadas', align: 'right' },
              { header: 'Horas trabajadas', accessor: 'horas_trabajadas', align: 'right' },
              { header: 'Horas ordinarias', accessor: 'horas_ordinarias', align: 'right' },
              { header: 'Horas extra', accessor: 'horas_extra', align: 'right' },
              { header: 'Horas nocturnas', accessor: 'horas_nocturnas', align: 'right' },
              { header: 'Horas en asueto', accessor: 'horas_asueto', align: 'right' },
              { header: 'Asueto ponderado', accessor: 'horas_asueto_ponderadas', align: 'right' },
            ]}
            filename={`horas-${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`}
            title={`Horas y extras — ${periodo}`}
            subtitle={proyectoNombre}
          />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Horas ordinarias', val: formatHoras(totales.ordinarias), color: 'var(--at-primary)' },
          { label: 'Horas extra', val: formatHoras(totales.extra), color: totales.extra > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)' },
          { label: 'Horas nocturnas', val: formatHoras(totales.nocturnas), color: 'var(--at-info)' },
          { label: 'Horas en asueto', val: formatHoras(totales.asueto), color: totales.asueto > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' },
          { label: 'Programado vs real', val: `${formatHoras(totales.planificadas)} / ${formatHoras(totales.trabajadas)}`, color: 'var(--at-ink-2)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface-2)', borderRadius: 10, padding: '10px 12px', textAlign: 'center', border: '1px solid var(--at-line)' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {cargando ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {[0, 1, 2, 3].map(i => <Skeleton key={i} height={38} />)}
        </div>
      ) : error ? (
        <EmptyState
          icon="🔒"
          title="No se pudieron calcular las horas"
          description={error}
        />
      ) : filas.length === 0 ? (
        <EmptyState
          icon="⏱️"
          title={`Sin jornada registrada en ${periodo}`}
          description="Aquí se cruzan los turnos asignados con la asistencia marcada. Necesita al menos una de las dos cosas: turnos generados en Asignación de turnos, o entradas y salidas en Presencia."
        />
      ) : (
        <div className="table-scroll-wrapper" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Empleado</th>
                <th style={th}>Días prog.</th>
                <th style={th}>Días trab.</th>
                <th style={th}>Ausencia</th>
                <th style={th}>Tardanzas</th>
                <th style={th}>Programadas</th>
                <th style={th}>Trabajadas</th>
                <th style={th}>Ordinarias</th>
                <th style={th}>Extra</th>
                <th style={th}>Nocturnas</th>
                <th style={th}>Asueto</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.personal_id}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{f.nombre}</div>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{f.cargo}</div>
                  </td>
                  <td style={td}>{f.dias_planificados}</td>
                  <td style={td}>{f.dias_trabajados}</td>
                  <td style={{ ...td, color: f.dias_ausencia > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>{f.dias_ausencia}</td>
                  <td style={{ ...td, color: f.tardanzas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{f.tardanzas}</td>
                  <td style={td}>{formatHoras(f.horas_planificadas)}</td>
                  <td style={td}>{formatHoras(f.horas_trabajadas)}</td>
                  <td style={{ ...td, fontWeight: 600, color: 'var(--at-ink)' }}>{formatHoras(f.horas_ordinarias)}</td>
                  <td style={{ ...td, fontWeight: 700, color: Number(f.horas_extra) > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>
                    {formatHoras(f.horas_extra)}
                  </td>
                  <td style={td}>{formatHoras(f.horas_nocturnas)}</td>
                  <td style={td}>
                    {formatHoras(f.horas_asueto)}
                    {Number(f.horas_asueto) > 0 && (
                      <span style={{ color: 'var(--at-danger)', fontSize: 11 }}> → {formatHoras(f.horas_asueto_ponderadas)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 11, color: 'var(--at-ink-3)', lineHeight: 1.6 }}>
        <div>· <strong>Extra</strong> = lo trabajado por encima del turno asignado ese día. Sin turno asignado se compara contra una jornada de 8 h, no se cuenta todo como extra.</div>
        <div>· <strong>Nocturnas</strong> = horas dentro de la franja 20:00–06:00. Se informan aparte; el recargo depende del contrato.</div>
        <div>· <strong>Asueto</strong> → la segunda cifra es lo mismo ya multiplicado por el factor del día no laborable.</div>
        <div>· Solo entra el marcaje de asistencia vinculado a un empleado del expediente.</div>
      </div>
    </div>
  )
}
