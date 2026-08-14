import { hoyLocalISO } from '../../../lib/format'
import { useMemo } from 'react'
import {
  CuotaCondominio, TicketMantenimiento, ReservaAmenidad, PolizaSeguro,
  SugerenciaCondominio, VencimientoExtra, InspeccionNormativa,
  ContratoArrendamiento, Unidad, MensajePortal, SolicitudResidente,
  SolicitudConcierge, SolicitudCertificado, SolicitudRentaUnidad,
  SolicitudMudanzaUnidad, ComunicadoCondominio,
} from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  reservas: ReservaAmenidad[]
  polizas: PolizaSeguro[]
  sugerencias: SugerenciaCondominio[]
  vencimientosExtra: VencimientoExtra[]
  inspecciones: InspeccionNormativa[]
  contratos: ContratoArrendamiento[]
  unidades: Unidad[]
  moneda: string
  // Actividad entrante: lo que llega del residente y lo que sale hacia él. Es
  // la mitad que faltaba en este panel — cubría vencimientos y cobros, pero no
  // el mensaje ni la solicitud que alguien acaba de meter.
  mensajesPortal: MensajePortal[]
  solicitudes: SolicitudResidente[]
  solicitudesConcierge: SolicitudConcierge[]
  certificados: SolicitudCertificado[]
  solicitudesRenta: SolicitudRentaUnidad[]
  solicitudesMudanza: SolicitudMudanzaUnidad[]
  comunicados: ComunicadoCondominio[]
}

type Urgencia = 'critico' | 'alto' | 'medio' | 'info'
type CategoriaNotif = 'finanzas' | 'mantenimiento' | 'normativa' | 'comunidad' | 'residentes' | 'comunicacion'

interface Notificacion {
  id: string
  urgencia: Urgencia
  categoria: CategoriaNotif
  titulo: string
  detalle: string
  accion?: string
  conteo?: number
}

const URG: Record<Urgencia, { color: string; bg: string; border: string; label: string; order: number }> = {
  critico: { color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', border: 'var(--at-danger-border)', label: 'Crítico', order: 0 },
  alto:    { color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', border: '#fcd34d', label: 'Alto',    order: 1 },
  medio:   { color: 'var(--at-primary)', bg: 'var(--at-primary-tint)', border: 'var(--at-accent-2)', label: 'Medio',   order: 2 },
  info:    { color: 'var(--at-success)', bg: 'var(--at-success-tint)', border: 'var(--at-success-border)', label: 'Info',    order: 3 },
}

const CAT_ICON: Record<CategoriaNotif, string> = {
  finanzas: '💰', mantenimiento: '🔧', normativa: '📋', comunidad: '🏘️', residentes: '🏠',
  comunicacion: '💬',
}

function diasHasta(fecha: string) {
  return Math.round((new Date(fecha).getTime() - Date.now()) / 86400000)
}

export default function CentroNotificacionesTab({
  cuotas, tickets, reservas, polizas, sugerencias, vencimientosExtra,
  inspecciones, contratos, unidades, moneda,
  mensajesPortal, solicitudes, solicitudesConcierge, certificados,
  solicitudesRenta, solicitudesMudanza, comunicados,
}: Props) {
  // Dentro del render y no a nivel de módulo: este panel se deja abierto, y con
  // la fecha congelada al import "pendientes este mes" seguía contando el mes
  // anterior después de medianoche del día 1.
  const hoy = hoyLocalISO()
  const mesActual = hoy.slice(0, 7)

  const notificaciones = useMemo((): Notificacion[] => {
    const lista: Notificacion[] = []

    // ── Finanzas ──────────────────────────────────────────────────────────────
    const morosas = cuotas.filter(c => c.estado === 'moroso')
    if (morosas.length > 0) lista.push({
      id: 'cuotas-morosas', urgencia: 'critico', categoria: 'finanzas',
      titulo: `${morosas.length} cuota(s) en estado moroso`,
      detalle: `Total pendiente: ${moneda} ${morosas.reduce((s, c) => s + c.monto, 0).toLocaleString('es', { minimumFractionDigits: 2 })}`,
      accion: 'Ver en Finanzas → Cuotas',
      conteo: morosas.length,
    })

    const pendientesMes = cuotas.filter(c => c.estado === 'pendiente' && c.periodo === mesActual)
    if (pendientesMes.length > 0) lista.push({
      id: 'cuotas-pendientes', urgencia: 'alto', categoria: 'finanzas',
      titulo: `${pendientesMes.length} cuota(s) pendientes este mes`,
      detalle: `${moneda} ${pendientesMes.reduce((s, c) => s + c.monto, 0).toLocaleString('es', { minimumFractionDigits: 2 })} por cobrar`,
      conteo: pendientesMes.length,
    })

    // ── Mantenimiento ─────────────────────────────────────────────────────────
    const urgentes = tickets.filter(t => t.estado === 'abierto' && t.prioridad === 'urgente')
    if (urgentes.length > 0) lista.push({
      id: 'tickets-urgentes', urgencia: 'critico', categoria: 'mantenimiento',
      titulo: `${urgentes.length} ticket(s) urgente(s) sin atender`,
      detalle: urgentes.map(t => t.titulo).slice(0, 3).join(' · ') + (urgentes.length > 3 ? '…' : ''),
      accion: 'Ver en Operaciones → Kanban',
      conteo: urgentes.length,
    })

    const abiertosAltos = tickets.filter(t => t.estado === 'abierto' && t.prioridad === 'alta')
    if (abiertosAltos.length > 0) lista.push({
      id: 'tickets-altos', urgencia: 'alto', categoria: 'mantenimiento',
      titulo: `${abiertosAltos.length} ticket(s) de prioridad alta abiertos`,
      detalle: abiertosAltos.map(t => t.titulo).slice(0, 2).join(' · '),
      conteo: abiertosAltos.length,
    })

    const ticketsSinAsignar = tickets.filter(t => t.estado === 'abierto' && !t.asignado_a)
    if (ticketsSinAsignar.length > 0) lista.push({
      id: 'tickets-sin-asignar', urgencia: 'medio', categoria: 'mantenimiento',
      titulo: `${ticketsSinAsignar.length} ticket(s) sin personal asignado`,
      detalle: 'Requieren asignación para avanzar',
      conteo: ticketsSinAsignar.length,
    })

    // ── Normativa ─────────────────────────────────────────────────────────────
    const polizasVencen30 = polizas.filter(p => {
      const d = diasHasta(p.fecha_vencimiento)
      return d >= 0 && d <= 30
    })
    if (polizasVencen30.length > 0) lista.push({
      id: 'polizas-vencen', urgencia: 'critico', categoria: 'normativa',
      titulo: `${polizasVencen30.length} póliza(s) vencen en ≤ 30 días`,
      detalle: polizasVencen30.map(p => `${p.tipo} (${diasHasta(p.fecha_vencimiento)}d)`).join(' · '),
      accion: 'Ver en Administración → Pólizas',
      conteo: polizasVencen30.length,
    })

    const inspeccionesReprobadas = inspecciones.filter(i => i.resultado === 'reprobado')
    if (inspeccionesReprobadas.length > 0) lista.push({
      id: 'inspecciones-reprobadas', urgencia: 'critico', categoria: 'normativa',
      titulo: `${inspeccionesReprobadas.length} inspección(es) reprobada(s)`,
      detalle: inspeccionesReprobadas.map(i => String(i.tipo)).join(' · '),
      conteo: inspeccionesReprobadas.length,
    })

    const vencimientosCriticos = vencimientosExtra.filter(v => {
      const d = diasHasta(v.fecha_vencimiento)
      return !v.renovado && d >= 0 && d <= 15
    })
    if (vencimientosCriticos.length > 0) lista.push({
      id: 'vencimientos-criticos', urgencia: 'alto', categoria: 'normativa',
      titulo: `${vencimientosCriticos.length} vencimiento(s) crítico(s) en ≤ 15 días`,
      detalle: vencimientosCriticos.map(v => `${v.titulo} (${diasHasta(v.fecha_vencimiento)}d)`).join(' · '),
      conteo: vencimientosCriticos.length,
    })

    // ── Comunicación: lo que acaba de entrar ──────────────────────────────────
    const mensajesNuevos = mensajesPortal.filter(m => m.estado === 'nuevo')
    const emergencias = mensajesNuevos.filter(m => m.tipo === 'emergencia')
    if (emergencias.length > 0) lista.push({
      id: 'portal-emergencias', urgencia: 'critico', categoria: 'comunicacion',
      titulo: `${emergencias.length} emergencia(s) reportada(s) desde el portal`,
      detalle: emergencias.map(m => `${m.unidad_nombre ?? 'Unidad'} — ${m.asunto}`).slice(0, 3).join(' · '),
      accion: 'Ver en Residentes → Mensajes del portal',
      conteo: emergencias.length,
    })

    const mensajesNormales = mensajesNuevos.filter(m => m.tipo !== 'emergencia')
    if (mensajesNormales.length > 0) lista.push({
      id: 'portal-mensajes', urgencia: 'alto', categoria: 'comunicacion',
      titulo: `${mensajesNormales.length} mensaje(s) nuevo(s) del portal sin leer`,
      detalle: mensajesNormales.map(m => `${m.unidad_nombre ?? 'Unidad'} — ${m.asunto}`).slice(0, 3).join(' · ')
        + (mensajesNormales.length > 3 ? '…' : ''),
      accion: 'Ver en Residentes → Mensajes del portal',
      conteo: mensajesNormales.length,
    })

    // Un comunicado recién publicado no es una acción pendiente, pero sí lo que
    // el administrador quiere confirmar de un vistazo: que salió.
    const comunicadosRecientes = comunicados.filter(c => {
      const d = diasHasta(c.fecha_envio)
      return d <= 0 && d >= -7
    })
    if (comunicadosRecientes.length > 0) lista.push({
      id: 'comunicados-recientes', urgencia: 'info', categoria: 'comunicacion',
      titulo: `${comunicadosRecientes.length} comunicado(s) publicado(s) en los últimos 7 días`,
      detalle: comunicadosRecientes.map(c => c.titulo).slice(0, 3).join(' · '),
      accion: 'Ver en Comunidad → Comunicados',
      conteo: comunicadosRecientes.length,
    })

    // ── Solicitudes: una tarjeta por cola, para que se vea CUÁL está atascada ──
    const colasSolicitud: { id: string; etiqueta: string; urgencia: Urgencia; pendientes: number; accion: string }[] = [
      {
        id: 'solicitudes-residente', etiqueta: 'solicitud(es) de residente',
        urgencia: 'alto', accion: 'Ver en Residentes → Solicitudes',
        pendientes: solicitudes.filter(s => s.estado === 'pendiente').length,
      },
      {
        id: 'solicitudes-renta', etiqueta: 'autorización(es) de renta',
        urgencia: 'alto', accion: 'Ver en Residentes → Autorizac. Renta',
        pendientes: solicitudesRenta.filter(s => s.estado === 'pendiente').length,
      },
      {
        id: 'solicitudes-mudanza', etiqueta: 'autorización(es) de mudanza',
        urgencia: 'alto', accion: 'Ver en Residentes → Autorizac. Mudanza',
        pendientes: solicitudesMudanza.filter(s => s.estado === 'pendiente').length,
      },
      {
        id: 'solicitudes-certificado', etiqueta: 'solicitud(es) de certificado',
        urgencia: 'medio', accion: 'Ver en Administración → Certificados',
        pendientes: certificados.filter(s => s.estado === 'pendiente').length,
      },
      {
        id: 'solicitudes-concierge', etiqueta: 'pedido(s) de concierge',
        urgencia: 'medio', accion: 'Ver en Servicios → Concierge',
        pendientes: solicitudesConcierge.filter(s => s.estado === 'pendiente').length,
      },
    ]
    for (const cola of colasSolicitud) {
      if (cola.pendientes === 0) continue
      lista.push({
        id: cola.id, urgencia: cola.urgencia, categoria: 'residentes',
        titulo: `${cola.pendientes} ${cola.etiqueta} sin resolver`,
        detalle: 'Esperando respuesta de la administración',
        accion: cola.accion,
        conteo: cola.pendientes,
      })
    }

    // ── Comunidad ─────────────────────────────────────────────────────────────
    const sugerenciasPendientes = sugerencias.filter(s => s.estado === 'pendiente')
    if (sugerenciasPendientes.length > 0) lista.push({
      id: 'sugerencias-pendientes', urgencia: 'medio', categoria: 'comunidad',
      titulo: `${sugerenciasPendientes.length} sugerencia(s)/queja(s) sin responder`,
      detalle: `${sugerencias.filter(s => s.estado === 'en_revision').length} en revisión adicionales`,
      accion: 'Ver en Comunidad → Conflictos',
      conteo: sugerenciasPendientes.length,
    })

    const reservasPendientes = reservas.filter(r => r.estado === 'pendiente')
    if (reservasPendientes.length > 0) lista.push({
      id: 'reservas-pendientes', urgencia: 'medio', categoria: 'comunidad',
      titulo: `${reservasPendientes.length} reserva(s) de amenidades pendientes de confirmar`,
      detalle: reservasPendientes.map(r => `${r.amenidad_nombre ?? 'Amenidad'} — ${r.fecha}`).slice(0, 3).join(' · '),
      accion: 'Ver en Instalaciones → Amenidades',
      conteo: reservasPendientes.length,
    })

    // ── Residentes ────────────────────────────────────────────────────────────
    const contratosVencen30 = contratos.filter(c => {
      if (!c.fecha_fin) return false
      const d = diasHasta(c.fecha_fin)
      return c.estado === 'activo' && d >= 0 && d <= 30
    })
    if (contratosVencen30.length > 0) lista.push({
      id: 'contratos-vencen', urgencia: 'alto', categoria: 'residentes',
      titulo: `${contratosVencen30.length} contrato(s) de arrendamiento vencen en ≤ 30 días`,
      detalle: contratosVencen30.map(c => `${c.arrendatario_nombre} (${diasHasta(c.fecha_fin!)}d)`).join(' · '),
      accion: 'Ver en Residentes → Arrendamientos',
      conteo: contratosVencen30.length,
    })

    const unidadesSinPropietario = unidades.filter(u => u.activo && !u.propietario_nombre)
    if (unidadesSinPropietario.length > 0) lista.push({
      id: 'unidades-sin-propietario', urgencia: 'info', categoria: 'residentes',
      titulo: `${unidadesSinPropietario.length} unidad(es) activa(s) sin propietario registrado`,
      detalle: unidadesSinPropietario.map(u => u.nombre).slice(0, 5).join(', '),
      conteo: unidadesSinPropietario.length,
    })

    // Buenas noticias
    const ticketsResueltosMes = tickets.filter(t => t.estado === 'resuelto' && t.fecha_cierre?.startsWith(mesActual)).length
    if (ticketsResueltosMes > 0) lista.push({
      id: 'tickets-resueltos', urgencia: 'info', categoria: 'mantenimiento',
      titulo: `${ticketsResueltosMes} ticket(s) resuelto(s) este mes`,
      detalle: 'Buen rendimiento del equipo de mantenimiento',
    })

    return lista.sort((a, b) => URG[a.urgencia].order - URG[b.urgencia].order)
  }, [cuotas, tickets, reservas, polizas, sugerencias, vencimientosExtra, inspecciones, contratos,
      unidades, moneda, mensajesPortal, solicitudes, solicitudesConcierge, certificados,
      solicitudesRenta, solicitudesMudanza, comunicados, mesActual])

  const criticos = notificaciones.filter(n => n.urgencia === 'critico').length
  const altos    = notificaciones.filter(n => n.urgencia === 'alto').length
  const medios   = notificaciones.filter(n => n.urgencia === 'medio').length
  const infos    = notificaciones.filter(n => n.urgencia === 'info').length

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Centro de Notificaciones</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 14 }}>
        Acciones pendientes en toda la plataforma · actualizado al {hoy}
      </div>

      {/* Resumen */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {([['critico', criticos], ['alto', altos], ['medio', medios], ['info', infos]] as [Urgencia, number][]).map(([u, cnt]) => (
          <div key={u} style={{ flex: '1 1 100px', background: URG[u].bg, border: `1px solid ${URG[u].border}`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{URG[u].label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: URG[u].color, marginTop: 1 }}>{cnt}</div>
          </div>
        ))}
        <div style={{ flex: '1 1 100px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>Total pendientes</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--at-ink-2)', marginTop: 1 }}>{notificaciones.length}</div>
        </div>
      </div>

      {notificaciones.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', background: 'var(--at-success-tint)', borderRadius: 12, border: '1px solid var(--at-success-border)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 700, color: 'var(--at-success)', fontSize: 15 }}>Todo en orden</div>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4 }}>No hay acciones pendientes en este momento</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notificaciones.map(n => {
            const cfg = URG[n.urgencia]
            return (
              <div key={n.id} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{CAT_ICON[n.categoria]}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{n.titulo}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: cfg.color, background: `${cfg.color}22`,
                      padding: '2px 7px', borderRadius: 10, border: `1px solid ${cfg.border}` }}>
                      {cfg.label}
                    </span>
                    {n.conteo && n.conteo > 1 && (
                      <span style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>({n.conteo})</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-2)' }}>{n.detalle}</div>
                  {n.accion && <div style={{ fontSize: 10, color: cfg.color, marginTop: 4, fontStyle: 'italic' }}>→ {n.accion}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
