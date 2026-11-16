import { useMemo } from 'react'
import type { ArticuloInventarioRenta, ContratoRenta, PropiedadRenta, Proyecto, ReservaUnificada } from '../../../types'
import {
  DIAS_AVISO_VENCIMIENTO, OCUPACION_LABEL, TIPO_RENTA_ICONO, TIPO_RENTA_LABEL, TIPOS_RENTA,
  diasParaVencer, ocupacionDePropiedad, resumenCartera,
} from '../../../domain/rentas/logica'
import { formatCurrency, formatFechaCalendario } from '../../../lib/format'
import { StatTile } from '../../shared/StatTile'
import { StatusBadge } from '../../shared/StatusBadge'
import { EmptyState } from '../../shared/EmptyState'
import { Button } from '../../shared/Button'
import type { PermisosModulo } from '../RentasSection'
import type { RentasTab } from '../rentasTabs'
import { TONO_OCUPACION, fila, rejillaTiles, td, tenue, th, thead } from '../ui'

interface Props {
  propiedades: PropiedadRenta[]
  reservas: ReservaUnificada[]
  contratos: ContratoRenta[]
  inventario: ArticuloInventarioRenta[]
  proyectos: Proyecto[]
  moneda: string
  hoy: string
  permisos: Record<'propiedades' | 'reservas' | 'contratos' | 'inventario', PermisosModulo>
  onIr: (tab: RentasTab) => void
  cargando: boolean
}

export default function PanelRentasTab({
  propiedades, reservas, contratos, inventario, proyectos, moneda, hoy, permisos, onIr, cargando,
}: Props) {
  const r = useMemo(
    () => resumenCartera(propiedades, reservas, contratos, inventario, hoy),
    [propiedades, reservas, contratos, inventario, hoy])
  const nombreProyecto = useMemo(() => new Map(proyectos.map(p => [p.id, p.nombre])), [proyectos])
  const nombrePropiedad = useMemo(() => new Map(propiedades.map(p => [p.id, p.nombre])), [propiedades])

  const porVencer = useMemo(() => contratos
    .map(c => ({ c, dias: diasParaVencer(c, hoy) }))
    .filter((x): x is { c: ContratoRenta; dias: number } => x.dias !== null && x.dias <= DIAS_AVISO_VENCIMIENTO)
    .sort((a, b) => a.dias - b.dias), [contratos, hoy])
  const conProblema = useMemo(
    () => inventario.filter(a => a.estado === 'danado' || a.estado === 'faltante'), [inventario])

  if (cargando) return <p style={tenue}>Cargando la cartera…</p>

  if (propiedades.length === 0) {
    return (
      <EmptyState
        icon="🏘️"
        title="Aún no hay propiedades en renta"
        description="Registra las unidades de tus condominios que se rentan y las propiedades que la empresa administra por fuera. Desde ahí llevas sus reservas, contratos e inventario."
        action={permisos.propiedades.crear ? <Button onClick={() => onIr('propiedades')}>Registrar la primera propiedad</Button> : undefined}
      />
    )
  }

  return (
    <div>
      <div style={rejillaTiles}>
        <StatTile label="Propiedades" value={r.propiedades} icon="🏘️"
          hint={TIPOS_RENTA.filter(t => r.porTipo[t] > 0).map(t => `${r.porTipo[t]} ${TIPO_RENTA_LABEL[t].toLowerCase()}`).join(' · ')} />
        <StatTile label="Ocupación hoy" value={r.ocupacionPct === null ? '—' : `${r.ocupacionPct}%`} icon="🔑"
          hint={`${r.ocupadas} ocupadas · ${r.disponibles} disponibles${r.fueraDeServicio ? ` · ${r.fueraDeServicio} fuera de servicio` : ''}`} />
        {permisos.reservas.ver && (
          <StatTile label="Estancias en curso" value={r.reservasEnCurso} icon="🛎️"
            hint={`${r.proximasLlegadas} llegada${r.proximasLlegadas === 1 ? '' : 's'} en 7 días`} />
        )}
        {(permisos.reservas.ver || permisos.contratos.ver) && (
          <StatTile label="Ingreso del mes" value={formatCurrency(r.ingresoMes, moneda)} icon="💰"
            hint="Reservas que entran este mes + rentas de contratos vigentes" />
        )}
        {permisos.contratos.ver && (
          <StatTile label="Contratos vigentes" value={r.contratosVigentes} icon="📝"
            tone={r.contratosVencidos > 0 ? 'danger' : r.contratosPorVencer > 0 ? 'warning' : undefined}
            hint={r.contratosVencidos > 0
              ? `${r.contratosVencidos} vencido${r.contratosVencidos === 1 ? '' : 's'} sin cerrar`
              : `${r.contratosPorVencer} por vencer en ${DIAS_AVISO_VENCIMIENTO} días`} />
        )}
        {permisos.inventario.ver && (
          <StatTile label="Inventario" value={formatCurrency(r.inventario.valor, moneda)} icon="🛋️"
            tone={r.inventario.danados + r.inventario.faltantes > 0 ? 'warning' : undefined}
            hint={`${r.inventario.articulos} artículos · ${r.inventario.danados} dañados · ${r.inventario.faltantes} faltantes`} />
        )}
      </div>

      {(porVencer.length > 0 || conProblema.length > 0) && (
        <section aria-label="Pendientes" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '16px', margin: '0 0 0.5rem' }}>Pendientes</h2>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.35rem', fontSize: '14px' }}>
            {porVencer.slice(0, 6).map(({ c, dias }) => (
              <li key={c.id}>
                <strong>{nombrePropiedad.get(c.propiedad_id) ?? 'Propiedad'}</strong>: el contrato de {c.inquilino_nombre}{' '}
                {dias < 0 ? `venció hace ${-dias} día${dias === -1 ? '' : 's'}` : dias === 0 ? 'vence hoy' : `vence en ${dias} día${dias === 1 ? '' : 's'}`}{' '}
                ({formatFechaCalendario(c.fecha_fin)}).
              </li>
            ))}
            {porVencer.length > 6 && <li style={tenue}>…y {porVencer.length - 6} contrato(s) más.</li>}
            {conProblema.slice(0, 6).map(a => (
              <li key={a.id}>
                <strong>{nombrePropiedad.get(a.propiedad_id) ?? 'Propiedad'}</strong>: {a.nombre}{' '}
                {a.estado === 'faltante' ? 'falta' : 'está dañado'}{a.ambiente ? ` (${a.ambiente})` : ''}.
              </li>
            ))}
            {conProblema.length > 6 && <li style={tenue}>…y {conProblema.length - 6} artículo(s) más.</li>}
          </ul>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            {porVencer.length > 0 && <Button size="sm" variant="secondary" onClick={() => onIr('contratos')}>Ver contratos</Button>}
            {conProblema.length > 0 && <Button size="sm" variant="secondary" onClick={() => onIr('inventario')}>Ver inventario</Button>}
          </div>
        </section>
      )}

      <h2 style={{ fontSize: '16px', margin: '0 0 0.5rem' }}>Cartera</h2>
      <div className="table-scroll-wrapper">
        <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={thead}>
              <th scope="col" style={th}>Propiedad</th>
              <th scope="col" style={th}>Tipo</th>
              <th scope="col" style={th}>Pertenece a</th>
              <th scope="col" style={th}>Hoy</th>
              <th scope="col" style={{ ...th, textAlign: 'right' }}>Tarifa base</th>
            </tr>
          </thead>
          <tbody>
            {propiedades.map(p => {
              const o = ocupacionDePropiedad(p, reservas, contratos, hoy)
              return (
                <tr key={p.id} style={fila}>
                  <td data-label="Propiedad" style={{ ...td, fontWeight: 600 }}>{p.nombre}</td>
                  <td data-label="Tipo" style={td}>{TIPO_RENTA_ICONO[p.tipo_renta]} {p.tipo_renta === 'otro' && p.tipo_detalle ? p.tipo_detalle : TIPO_RENTA_LABEL[p.tipo_renta]}</td>
                  <td data-label="Pertenece a" style={td}>
                    {p.project_id ? (nombreProyecto.get(p.project_id) ?? 'Proyecto') : <span style={tenue}>Independiente</span>}
                  </td>
                  <td data-label="Hoy" style={td}><StatusBadge tone={TONO_OCUPACION[o]}>{OCUPACION_LABEL[o]}</StatusBadge></td>
                  <td data-label="Tarifa base" style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {p.tarifa_base === null ? '—' : `${formatCurrency(p.tarifa_base, moneda)} / ${p.tipo_renta === 'corto_plazo' ? 'noche' : 'mes'}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
