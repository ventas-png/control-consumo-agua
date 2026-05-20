import { useState, useMemo } from 'react'
import {
  CuotaCondominio, TicketMantenimiento, PolizaSeguro,
  ContratoProveedor, InspeccionNormativa, VencimientoExtra,
  SugerenciaCondominio,
} from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  polizas: PolizaSeguro[]
  contratosProveedores: ContratoProveedor[]
  inspecciones: InspeccionNormativa[]
  vencimientosExtra: VencimientoExtra[]
  sugerencias: SugerenciaCondominio[]
  moneda: string
}

type Severidad = 'critica' | 'alta' | 'media' | 'baja'
type Categoria = 'cobranza' | 'mantenimiento' | 'contratos' | 'seguridad' | 'sugerencias'

interface Alerta {
  id: string
  severidad: Severidad
  categoria: Categoria
  titulo: string
  detalle: string
  fecha?: string
  monto?: number
}

const SEV_CFG: Record<Severidad, { color: string; bg: string; border: string; icon: string; label: string; order: number }> = {
  critica: { color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', icon: '🚨', label: 'Crítica', order: 0 },
  alta:    { color: '#ea580c', bg: '#fff7ed', border: '#fdba74', icon: '⚠️', label: 'Alta',    order: 1 },
  media:   { color: '#d97706', bg: '#fef3c7', border: '#fde68a', icon: '🔔', label: 'Media',   order: 2 },
  baja:    { color: '#1B3B36', bg: '#EEF2EC', border: '#C2D2CA', icon: 'ℹ️', label: 'Baja',    order: 3 },
}

const CAT_CFG: Record<Categoria, { icon: string; label: string }> = {
  cobranza:     { icon: '💳', label: 'Cobranza' },
  mantenimiento:{ icon: '🔧', label: 'Mantenimiento' },
  contratos:    { icon: '📄', label: 'Contratos' },
  seguridad:    { icon: '🛡️', label: 'Seguridad' },
  sugerencias:  { icon: '💡', label: 'Sugerencias' },
}

function diasHasta(fecha: string): number {
  return Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000)
}

function diasDesde(fecha: string): number {
  return Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)
}

export default function GestorAlertasTab({ cuotas, tickets, polizas, contratosProveedores, inspecciones, vencimientosExtra, sugerencias, moneda }: Props) {
  const [filtroSev, setFiltroSev] = useState<Severidad | ''>('')
  const [filtroCat, setFiltroCat] = useState<Categoria | ''>('')

  const alertas: Alerta[] = useMemo(() => {
    const list: Alerta[] = []
    const hoy = new Date().toISOString().slice(0, 10)

    // Cuotas morosas / vencidas
    cuotas
      .filter(c => c.estado === 'moroso' || (c.estado === 'pendiente' && c.fecha_vencimiento && c.fecha_vencimiento < hoy))
      .forEach(c => {
        const dias = c.fecha_vencimiento ? diasDesde(c.fecha_vencimiento) : 0
        list.push({
          id: `cuota-${c.id}`,
          severidad: dias > 90 ? 'critica' : dias > 60 ? 'alta' : dias > 30 ? 'media' : 'baja',
          categoria: 'cobranza',
          titulo: `Cuota vencida — ${c.unidad_nombre ?? c.unidad_id ?? ''}`,
          detalle: `${c.concepto} · Período ${c.periodo} · ${dias} días vencida`,
          fecha: c.fecha_vencimiento ?? undefined,
          monto: c.monto,
        })
      })

    // Tickets urgentes/altos sin resolver
    tickets
      .filter(t => t.estado !== 'cerrado' && t.estado !== 'resuelto' && (t.prioridad === 'urgente' || t.prioridad === 'alta'))
      .forEach(t => {
        const dias = diasDesde(t.created_at)
        list.push({
          id: `ticket-${t.id}`,
          severidad: t.prioridad === 'urgente' ? 'critica' : dias > 7 ? 'alta' : 'media',
          categoria: 'mantenimiento',
          titulo: `Ticket ${t.prioridad} — ${t.titulo}`,
          detalle: `${t.tipo} · Estado: ${t.estado.replace('_', ' ')} · ${dias} días abierto`,
          fecha: t.fecha_limite ?? undefined,
        })
      })

    // Pólizas próximas a vencer (<60 días)
    polizas
      .filter(p => p.estado === 'vigente' && p.fecha_vencimiento)
      .forEach(p => {
        const dias = diasHasta(p.fecha_vencimiento!)
        if (dias <= 60) {
          list.push({
            id: `poliza-${p.id}`,
            severidad: dias <= 15 ? 'critica' : dias <= 30 ? 'alta' : 'media',
            categoria: 'contratos',
            titulo: `Póliza próxima a vencer — ${String(p.tipo)}`,
            detalle: `Aseguradora: ${p.aseguradora} · Vence en ${dias} días`,
            fecha: p.fecha_vencimiento!,
            monto: p.prima_anual ?? undefined,
          })
        }
      })

    // Contratos próximos a vencer (<90 días)
    contratosProveedores
      .filter(c => c.estado === 'activo' && c.fecha_fin)
      .forEach(c => {
        const dias = diasHasta(c.fecha_fin!)
        if (dias <= 90) {
          list.push({
            id: `contrato-${c.id}`,
            severidad: dias <= 30 ? 'alta' : 'media',
            categoria: 'contratos',
            titulo: `Contrato por vencer — ${c.proveedor_nombre}`,
            detalle: `${c.servicio} · Vence en ${dias} días`,
            fecha: c.fecha_fin!,
            monto: c.monto_mensual ?? undefined,
          })
        }
      })

    // Inspecciones con resultado negativo pendientes de corrección
    inspecciones
      .filter(i => i.resultado === 'reprobado' || i.resultado === 'aprobado_con_observaciones')
      .forEach(i => {
        list.push({
          id: `insp-${i.id}`,
          severidad: i.resultado === 'reprobado' ? 'critica' : 'alta',
          categoria: 'seguridad',
          titulo: `Inspección ${i.resultado === 'reprobado' ? 'reprobada' : 'con observaciones'}`,
          detalle: `${String(i.tipo)} · ${i.entidad_inspectora ?? ''} · ${i.fecha}`,
          fecha: i.fecha,
        })
      })

    // Vencimientos extra próximos (<45 días)
    vencimientosExtra
      .filter(v => !v.renovado)
      .forEach(v => {
        const dias = diasHasta(v.fecha_vencimiento)
        if (dias <= 45) {
          list.push({
            id: `venc-${v.id}`,
            severidad: dias <= 0 ? 'critica' : dias <= 15 ? 'alta' : 'media',
            categoria: 'contratos',
            titulo: `Vencimiento — ${v.titulo}`,
            detalle: `${String(v.categoria)} · ${dias <= 0 ? `Vencido hace ${-dias} días` : `Vence en ${dias} días`}`,
            fecha: v.fecha_vencimiento,
            monto: v.monto ?? undefined,
          })
        }
      })

    // Sugerencias pendientes de respuesta
    sugerencias
      .filter(s => s.estado === 'pendiente')
      .slice(0, 10)
      .forEach(s => {
        const dias = diasDesde(s.created_at)
        list.push({
          id: `sug-${s.id}`,
          severidad: dias > 14 ? 'media' : 'baja',
          categoria: 'sugerencias',
          titulo: `Sugerencia sin responder — ${String(s.categoria)}`,
          detalle: `${s.titulo} · ${dias} días sin respuesta`,
          fecha: s.created_at.slice(0, 10),
        })
      })

    return list.sort((a, b) =>
      SEV_CFG[a.severidad].order - SEV_CFG[b.severidad].order || (a.fecha ?? '').localeCompare(b.fecha ?? '')
    )
  }, [cuotas, tickets, polizas, contratosProveedores, inspecciones, vencimientosExtra, sugerencias])

  const alertasFiltradas = useMemo(() =>
    alertas.filter(a =>
      (!filtroSev || a.severidad === filtroSev) &&
      (!filtroCat || a.categoria === filtroCat)
    )
  , [alertas, filtroSev, filtroCat])

  const conteoSev = useMemo(() =>
    (Object.keys(SEV_CFG) as Severidad[]).reduce((acc, s) => {
      acc[s] = alertas.filter(a => a.severidad === s).length
      return acc
    }, {} as Record<Severidad, number>)
  , [alertas])

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: '#15291F', marginBottom: 2 }}>Centro de Alertas</div>
      <div style={{ fontSize: 12, color: '#7E9389', marginBottom: 14 }}>
        {alertas.length} alerta{alertas.length !== 1 ? 's' : ''} activa{alertas.length !== 1 ? 's' : ''} — actualizado al abrir esta sección
      </div>

      {/* KPIs por severidad */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {(Object.entries(SEV_CFG) as [Severidad, typeof SEV_CFG[Severidad]][]).map(([sev, cfg]) => (
          <button key={sev} onClick={() => setFiltroSev(filtroSev === sev ? '' : sev)}
            style={{ flex: '1 1 100px', background: filtroSev === sev ? cfg.bg : '#FAF7EF',
              border: `1.5px solid ${filtroSev === sev ? cfg.border : '#E1DDD0'}`,
              borderRadius: 10, padding: '10px 14px', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ fontSize: 10, color: '#7E9389' }}>{cfg.icon} {cfg.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: cfg.color, marginTop: 2 }}>{conteoSev[sev]}</div>
          </button>
        ))}
      </div>

      {/* Filtros de categoría */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={() => setFiltroCat('')}
          style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid var(--at-line-strong)', fontSize: 11, cursor: 'pointer',
            background: filtroCat === '' ? '#15291F' : '#fff', color: filtroCat === '' ? '#fff' : '#3E5A4C', fontWeight: 600 }}>
          Todas
        </button>
        {(Object.entries(CAT_CFG) as [Categoria, typeof CAT_CFG[Categoria]][]).map(([cat, cfg]) => {
          const count = alertas.filter(a => a.categoria === cat).length
          return count > 0 ? (
            <button key={cat} onClick={() => setFiltroCat(filtroCat === cat ? '' : cat)}
              style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid var(--at-line-strong)', fontSize: 11, cursor: 'pointer',
                background: filtroCat === cat ? '#15291F' : '#fff', color: filtroCat === cat ? '#fff' : '#3E5A4C', fontWeight: 600 }}>
              {cfg.icon} {cfg.label} ({count})
            </button>
          ) : null
        })}
      </div>

      {/* Lista de alertas */}
      {alertasFiltradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#7E9389', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          {alertas.length === 0 ? 'No hay alertas activas. ¡Todo en orden!' : 'Ninguna alerta coincide con el filtro'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alertasFiltradas.map(a => {
            const sev = SEV_CFG[a.severidad]
            const cat = CAT_CFG[a.categoria]
            return (
              <div key={a.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start',
                padding: '12px 16px', background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 10 }}>
                <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{sev.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: sev.color }}>{a.titulo}</div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.7)', color: sev.color, fontWeight: 700 }}>{sev.label}</span>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.7)', color: '#3E5A4C' }}>{cat.icon} {cat.label}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#3E5A4C', marginTop: 3 }}>{a.detalle}</div>
                  {a.monto !== undefined && (
                    <div style={{ fontSize: 11, color: sev.color, fontWeight: 600, marginTop: 4 }}>
                      {moneda} {a.monto.toLocaleString('es', { minimumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
