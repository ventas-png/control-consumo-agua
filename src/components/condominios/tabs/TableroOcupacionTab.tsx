import { useMemo } from 'react'
import { Unidad, ContratoArrendamiento, CuotaCondominio } from '../../../types'

interface Props {
  unidades: Unidad[]
  contratos: ContratoArrendamiento[]
  cuotas: CuotaCondominio[]
  moneda: string
}

type EstadoOcupacion = 'propietario' | 'en_renta' | 'libre' | 'inactiva'

const EST_CFG: Record<EstadoOcupacion, { label: string; color: string; bg: string; border: string }> = {
  propietario: { label: 'Propietario',  color: 'var(--at-primary)', bg: 'var(--at-primary-tint)', border: 'var(--at-primary-soft-2)' },
  en_renta:    { label: 'En renta',     color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)', border: 'var(--at-accent-soft)' },
  libre:       { label: 'Libre',        color: '#16a34a', bg: '#dcfce7', border: '#86efac' },
  inactiva:    { label: 'Inactiva',     color: 'var(--at-ink-3)', bg: 'var(--at-surface-2)', border: 'var(--at-line)' },
}

const TIPO_ICON: Record<string, string> = {
  apartamento: '🏠', casa: '🏡', bodega: '📦',
  local_comercial: '🏪', oficina: '💼', parqueadero: '🚗', otro: '📋',
}

export default function TableroOcupacionTab({ unidades, contratos, cuotas, moneda }: Props) {
  const datos = useMemo(() => {
    const contratosActivos = contratos.filter(c => c.estado === 'activo')

    return unidades.map(u => {
      const contrato = contratosActivos.find(c => c.unidad_id === u.id)
      const cuotasU = cuotas.filter(c => c.unidad_id === u.id)
      const deuda = cuotasU.filter(c => c.estado === 'pendiente' || c.estado === 'moroso').reduce((s, c) => s + c.monto, 0)

      let estado: EstadoOcupacion
      if (!u.activo) estado = 'inactiva'
      else if (contrato) estado = 'en_renta'
      else if (u.propietario_nombre) estado = 'propietario'
      else estado = 'libre'

      return { u, contrato, deuda, estado, tieneDeuda: deuda > 0 }
    })
  }, [unidades, contratos, cuotas])

  const resumen = useMemo(() => {
    const total     = datos.length
    const enRenta   = datos.filter(d => d.estado === 'en_renta').length
    const propiet   = datos.filter(d => d.estado === 'propietario').length
    const libre     = datos.filter(d => d.estado === 'libre').length
    const inactiva  = datos.filter(d => d.estado === 'inactiva').length
    const ocupadas  = enRenta + propiet
    const tasaOcup  = total > 0 ? ocupadas / total : 0
    const conDeuda  = datos.filter(d => d.tieneDeuda).length
    const rentaMensual = contratos.filter(c => c.estado === 'activo').reduce((s, c) => s + c.monto_renta, 0)
    return { total, enRenta, propiet, libre, inactiva, ocupadas, tasaOcup, conDeuda, rentaMensual }
  }, [datos, contratos])

  const porTipo = useMemo(() => {
    const map: Record<string, { total: number; ocupadas: number }> = {}
    datos.forEach(d => {
      const t = d.u.tipo ?? 'otro'
      if (!map[t]) map[t] = { total: 0, ocupadas: 0 }
      map[t].total++
      if (d.estado === 'propietario' || d.estado === 'en_renta') map[t].ocupadas++
    })
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total)
  }, [datos])

  const porPiso = useMemo(() => {
    const map: Record<number, typeof datos> = {}
    datos.forEach(d => {
      const p = d.u.piso ?? 0
      if (!map[p]) map[p] = []
      map[p].push(d)
    })
    return Object.entries(map).map(([p, units]) => ({ piso: Number(p), units }))
      .sort((a, b) => b.piso - a.piso)
  }, [datos])

  const hayPisos = datos.some(d => d.u.piso != null && d.u.piso > 0)

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Tablero de Ocupación</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 14 }}>{resumen.total} unidades registradas</div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Tasa de ocupación', val: `${Math.round(resumen.tasaOcup * 100)}%`, color: resumen.tasaOcup >= 0.9 ? '#16a34a' : resumen.tasaOcup >= 0.7 ? '#d97706' : '#ef4444', bg: resumen.tasaOcup >= 0.9 ? '#dcfce7' : resumen.tasaOcup >= 0.7 ? '#fef3c7' : '#fef2f2' },
          { label: 'Propietarios',  val: String(resumen.propiet),  color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
          { label: 'En renta',      val: String(resumen.enRenta),  color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)' },
          { label: 'Libres',        val: String(resumen.libre),    color: '#16a34a', bg: '#dcfce7' },
          { label: 'Renta mensual', val: `${moneda} ${resumen.rentaMensual.toLocaleString('es')}`, color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)' },
          { label: 'Con deuda',     val: String(resumen.conDeuda), color: resumen.conDeuda > 0 ? '#ef4444' : '#16a34a', bg: resumen.conDeuda > 0 ? '#fef2f2' : '#dcfce7' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 100px', background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Barra de distribución */}
      <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600, marginBottom: 6 }}>Distribución de ocupación</div>
        <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', gap: 1 }}>
          {([['propietario', resumen.propiet], ['en_renta', resumen.enRenta], ['libre', resumen.libre], ['inactiva', resumen.inactiva]] as [EstadoOcupacion, number][]).map(([est, cnt]) =>
            cnt > 0 ? <div key={est} style={{ width: `${(cnt / resumen.total) * 100}%`, background: EST_CFG[est].bg.replace('#', '#'), border: `1px solid ${EST_CFG[est].border}`, borderRadius: 4 }} title={`${EST_CFG[est].label}: ${cnt}`} /> : null
          )}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
          {(Object.entries(EST_CFG) as [EstadoOcupacion, typeof EST_CFG[EstadoOcupacion]][]).map(([est, cfg]) => (
            <span key={est} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: cfg.bg, border: `1px solid ${cfg.border}`, display: 'inline-block' }} />
              <span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: hayPisos ? '1fr 220px' : '1fr', gap: 14 }}>
        {/* Cuadrícula de unidades */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>Unidades</div>
          {hayPisos ? (
            porPiso.map(({ piso, units }) => (
              <div key={piso} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: 6 }}>
                  {piso === 0 ? 'Sin piso asignado' : `Piso ${piso}`}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {units.map(d => (
                    <UnitCard key={d.u.id} d={d} moneda={moneda} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {datos.map(d => <UnitCard key={d.u.id} d={d} moneda={moneda} />)}
            </div>
          )}
        </div>

        {/* Por tipo de unidad */}
        {porTipo.length > 0 && (
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>Por tipo</div>
            {porTipo.map(([tipo, { total, ocupadas }]) => (
              <div key={tipo} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--at-ink-2)' }}>{TIPO_ICON[tipo] ?? '📋'} {tipo.replace('_', ' ')}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--at-ink-2)' }}>{ocupadas}/{total}</span>
                </div>
                <div style={{ height: 8, background: 'var(--at-chip)', borderRadius: 4 }}>
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--at-primary)', width: `${total > 0 ? (ocupadas / total) * 100 : 0}%` }} />
                </div>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginTop: 2 }}>
                  {total > 0 ? `${Math.round((ocupadas / total) * 100)}% ocupado` : '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function UnitCard({ d, moneda }: { d: { u: Unidad; contrato: ContratoArrendamiento | undefined; deuda: number; estado: EstadoOcupacion; tieneDeuda: boolean }; moneda: string }) {
  const cfg = EST_CFG[d.estado]
  return (
    <div title={[
      d.u.nombre,
      d.u.tipo,
      d.u.propietario_nombre ? `Propietario: ${d.u.propietario_nombre}` : '',
      d.contrato ? `Arrendatario: ${d.contrato.arrendatario_nombre}` : '',
      d.tieneDeuda ? `Deuda: ${moneda} ${d.deuda.toFixed(2)}` : '',
    ].filter(Boolean).join('\n')}
      style={{ padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${d.tieneDeuda ? '#fca5a5' : cfg.border}`,
        background: d.tieneDeuda ? '#fef2f2' : cfg.bg, cursor: 'default', minWidth: 72, textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: cfg.color, fontWeight: 700, marginBottom: 2 }}>
        {(TIPO_ICON as Record<string, string>)[d.u.tipo] ?? '📋'}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: d.tieneDeuda ? '#ef4444' : 'var(--at-ink-2)' }}>
        {d.u.nombre.length > 8 ? d.u.nombre.slice(0, 8) + '…' : d.u.nombre}
      </div>
      <div style={{ fontSize: 8, color: cfg.color, fontWeight: 600 }}>{cfg.label}</div>
      {d.tieneDeuda && <div style={{ fontSize: 8, color: '#ef4444', fontWeight: 700 }}>⚠ debe</div>}
    </div>
  )
}
