import { useState, useMemo } from 'react'
import type { PersonalCondominio } from '../../../types'

interface ClienteBirthday {
  id: string
  nombre: string
  fecha_nacimiento: string
  unidad_nombre?: string
}

interface Props {
  personal: PersonalCondominio[]
  clientesBirthday: ClienteBirthday[]
  proyectoNombre?: string
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

const CARGO_LABEL: Record<string, string> = {
  conserje: 'Conserje', guardia: 'Guardia', jardinero: 'Jardinero',
  mantenimiento: 'Mantenimiento', administrador: 'Administrador', otro: 'Personal',
}

const COLOR = {
  residente: { bg: '#EEF2EC', color: '#1B3B36', border: '#C2D2CA', dot: '#1B3B36' },
  personal:  { bg: '#FAF1EA', color: '#9C5733', border: '#EFE0D5', dot: '#9C5733' },
}

interface Cumpleanero {
  id: string
  nombre: string
  tipo: 'residente' | 'personal'
  mesdia: string  // 'MM-DD'
  anioNac: number | null
  subtitulo: string
}

function calcularEdadAnio(anioNac: number | null, diasHasta: number): string {
  if (!anioNac || anioNac < 1920) return ''
  const hoy = new Date()
  const edad = hoy.getFullYear() - anioNac + (diasHasta === 0 ? 0 : 1)
  return `${edad} años`
}

function diasHastaSiguiente(mesdia: string): number {
  const hoy = new Date()
  const [mm, dd] = mesdia.split('-').map(Number)
  const esteAnio = new Date(hoy.getFullYear(), mm - 1, dd)
  if (esteAnio.toDateString() === hoy.toDateString()) return 0
  if (esteAnio > hoy) return Math.ceil((esteAnio.getTime() - hoy.getTime()) / 86400000)
  const proximo = new Date(hoy.getFullYear() + 1, mm - 1, dd)
  return Math.ceil((proximo.getTime() - hoy.getTime()) / 86400000)
}

export function CumpleanosTab({ personal, clientesBirthday, proyectoNombre = 'Condominio' }: Props) {
  const hoy = new Date()
  const [mes, setMes] = useState(hoy.getMonth())
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'residente' | 'personal'>('todos')

  const todos: Cumpleanero[] = useMemo(() => {
    const list: Cumpleanero[] = []
    for (const c of clientesBirthday) {
      if (!c.fecha_nacimiento) continue
      const raw = c.fecha_nacimiento.split('T')[0]
      if (raw.length < 7) continue
      list.push({
        id: `r-${c.id}`, nombre: c.nombre, tipo: 'residente',
        mesdia: raw.slice(5), anioNac: parseInt(raw.slice(0, 4)),
        subtitulo: c.unidad_nombre ?? 'Residente',
      })
    }
    for (const p of personal) {
      if (!p.fecha_nacimiento) continue
      const raw = p.fecha_nacimiento.split('T')[0]
      if (raw.length < 7) continue
      list.push({
        id: `p-${p.id}`, nombre: p.nombre, tipo: 'personal',
        mesdia: raw.slice(5), anioNac: parseInt(raw.slice(0, 4)),
        subtitulo: CARGO_LABEL[p.cargo] ?? 'Personal',
      })
    }
    return list
  }, [clientesBirthday, personal])

  const filtrados = filtroTipo === 'todos' ? todos : todos.filter(c => c.tipo === filtroTipo)

  const hoyStr = `${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
  const cumpleHoy = todos.filter(c => c.mesdia === hoyStr)

  const proximos30 = useMemo(() => (
    todos
      .map(c => ({ ...c, dias: diasHastaSiguiente(c.mesdia) }))
      .filter(c => c.dias <= 30)
      .sort((a, b) => a.dias - b.dias)
  ), [todos])

  const semanaMes = useMemo(() => {
    const inicio = hoy
    const fin7 = new Date(Date.now() + 7 * 86400000)
    return todos.filter(c => {
      const [mm, dd] = c.mesdia.split('-').map(Number)
      const fecha = new Date(hoy.getFullYear(), mm - 1, dd)
      if (fecha < inicio) {
        const proxAnio = new Date(hoy.getFullYear() + 1, mm - 1, dd)
        return proxAnio <= fin7
      }
      return fecha <= fin7
    })
  }, [todos])

  // Calendar grid
  const diasEnMes = new Date(anio, mes + 1, 0).getDate()
  const primerDia = new Date(anio, mes, 1).getDay()

  const cumplesPorDia = useMemo(() => {
    const map: Record<number, Cumpleanero[]> = {}
    for (const c of filtrados) {
      const [mm, dd] = c.mesdia.split('-').map(Number)
      if (mm - 1 === mes) {
        if (!map[dd]) map[dd] = []
        map[dd].push(c)
      }
    }
    return map
  }, [filtrados, mes])

  const cells: (number | null)[] = []
  for (let i = 0; i < primerDia; i++) cells.push(null)
  for (let d = 1; d <= diasEnMes; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const esHoy = (d: number) => anio === hoy.getFullYear() && mes === hoy.getMonth() && d === hoy.getDate()

  function prevMes() { if (mes === 0) { setMes(11); setAnio(a => a - 1) } else setMes(m => m - 1) }
  function nextMes() { if (mes === 11) { setMes(0); setAnio(a => a + 1) } else setMes(m => m + 1) }
  function irHoy() { setMes(hoy.getMonth()); setAnio(hoy.getFullYear()) }

  return (
    <div style={{ padding: '20px 24px', maxWidth: '1100px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#15291F' }}>🎂 Cumpleaños</h2>
          <p style={{ margin: '4px 0 0', color: '#7E9389', fontSize: '13.5px' }}>
            {todos.length} personas con fecha de nacimiento registrada · {proyectoNombre}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['todos', 'residente', 'personal'] as const).map(t => (
            <button key={t} onClick={() => setFiltroTipo(t)}
              style={{ padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid',
                borderColor: filtroTipo === t ? '#1B3B36' : '#E1DDD0',
                background: filtroTipo === t ? '#EEF2EC' : 'white',
                color: filtroTipo === t ? '#1B3B36' : '#7E9389' }}>
              {t === 'todos' ? 'Todos' : t === 'residente' ? '🏠 Residentes' : '👷 Personal'}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Hoy', val: cumpleHoy.length, icon: '🎂', color: cumpleHoy.length > 0 ? '#dc2626' : '#16a34a', bg: cumpleHoy.length > 0 ? '#fef2f2' : '#f0fdf4' },
          { label: 'Esta semana', val: semanaMes.length, icon: '📅', color: '#d97706', bg: '#fef3c7' },
          { label: 'Próximos 30d', val: proximos30.length, icon: '🗓️', color: '#1B3B36', bg: '#D9E2DC' },
          { label: 'Registrados', val: todos.length, icon: '👤', color: '#9C5733', bg: '#FAF1EA' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.color}33`, borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: '11px', color: '#7E9389', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Alerta de hoy */}
      {cumpleHoy.length > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '12px', padding: '14px 18px', marginBottom: '18px', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ fontSize: '28px' }}>🎂</span>
          <div>
            <div style={{ fontWeight: 700, color: '#dc2626', fontSize: '14px', marginBottom: '6px' }}>¡Hoy es el cumpleaños de:</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {cumpleHoy.map(c => {
                const edad = calcularEdadAnio(c.anioNac, 0)
                return (
                  <span key={c.id} style={{ padding: '5px 14px', background: COLOR[c.tipo].bg, color: COLOR[c.tipo].color, border: `1px solid ${COLOR[c.tipo].border}`, borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>
                    {c.nombre}{edad ? ` · ${edad}` : ''}
                    <span style={{ marginLeft: '6px', fontSize: '11px', opacity: 0.7 }}>{c.subtitulo}</span>
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: '20px', alignItems: 'start' }}>

        {/* Calendario mensual */}
        <div style={{ background: 'white', border: '1.5px solid #E1DDD0', borderRadius: '14px', overflow: 'hidden' }}>
          {/* Navegación */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: '#FAF7EF', borderBottom: '1px solid #E1DDD0' }}>
            <button onClick={prevMes} style={{ padding: '6px 14px', background: 'white', border: '1.5px solid #E1DDD0', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '16px', color: '#3E5A4C' }}>‹</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontWeight: 700, fontSize: '15px', color: '#15291F' }}>{MESES[mes]} {anio}</span>
              {(mes !== hoy.getMonth() || anio !== hoy.getFullYear()) && (
                <button onClick={irHoy} style={{ padding: '3px 10px', background: '#EEF2EC', color: '#1B3B36', border: '1px solid #C2D2CA', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Hoy</button>
              )}
            </div>
            <button onClick={nextMes} style={{ padding: '6px 14px', background: 'white', border: '1.5px solid #E1DDD0', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '16px', color: '#3E5A4C' }}>›</button>
          </div>
          {/* Encabezados días */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #E1DDD0' }}>
            {DIAS.map(d => (
              <div key={d} style={{ textAlign: 'center', padding: '8px 2px', fontSize: '11px', fontWeight: 700, color: '#7E9389' }}>{d}</div>
            ))}
          </div>
          {/* Celdas */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {cells.map((d, i) => {
              const lista = d ? (cumplesPorDia[d] ?? []) : []
              const hoyFlag = d ? esHoy(d) : false
              return (
                <div key={i} style={{
                  minHeight: '76px', padding: '5px 4px',
                  borderRight: '1px solid #EAE6D8', borderBottom: '1px solid #EAE6D8',
                  background: hoyFlag ? '#EEF2EC' : lista.length > 0 ? '#FAF7EF' : 'white',
                }}>
                  {d && (
                    <>
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '12px', fontWeight: hoyFlag ? 800 : 400, marginBottom: '3px',
                        color: hoyFlag ? 'white' : lista.length > 0 ? '#15291F' : '#7E9389',
                        background: hoyFlag ? '#1B3B36' : 'transparent',
                      }}>{d}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {lista.slice(0, 3).map(c => (
                          <div key={c.id} title={`${c.nombre} — ${c.subtitulo}`}
                            style={{
                              fontSize: '9px', fontWeight: 600, padding: '1px 4px', borderRadius: '3px',
                              background: COLOR[c.tipo].bg, color: COLOR[c.tipo].color,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '1.4',
                            }}>
                            🎂 {c.nombre.split(' ')[0]}
                          </div>
                        ))}
                        {lista.length > 3 && (
                          <div style={{ fontSize: '9px', color: '#7E9389', fontWeight: 600 }}>+{lista.length - 3} más</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Panel derecho */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Leyenda */}
          <div style={{ background: 'white', border: '1.5px solid #E1DDD0', borderRadius: '12px', padding: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: '12px', color: '#15291F', marginBottom: '8px' }}>Leyenda</div>
            {[
              { tipo: 'residente' as const, label: 'Residente / Propietario' },
              { tipo: 'personal' as const, label: 'Personal / Trabajador' },
            ].map(l => (
              <div key={l.tipo} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <div style={{ width: 12, height: 12, borderRadius: '3px', background: COLOR[l.tipo].bg, border: `2px solid ${COLOR[l.tipo].border}` }} />
                <span style={{ fontSize: '12px', color: '#3E5A4C' }}>{l.label}</span>
              </div>
            ))}
          </div>

          {/* Próximos 30 días */}
          <div style={{ background: 'white', border: '1.5px solid #E1DDD0', borderRadius: '12px', padding: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: '12px', color: '#15291F', marginBottom: '10px' }}>
              📅 Próximos 30 días
              {proximos30.length > 0 && <span style={{ marginLeft: 6, background: '#D9E2DC', color: '#1B3B36', borderRadius: '12px', padding: '1px 8px', fontSize: '11px' }}>{proximos30.length}</span>}
            </div>
            {proximos30.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#7E9389', textAlign: 'center', margin: '16px 0' }}>Sin cumpleaños en los próximos 30 días</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', maxHeight: '420px', overflowY: 'auto' }}>
                {proximos30.map(c => {
                  const edad = calcularEdadAnio(c.anioNac, c.dias)
                  const [mm, dd] = c.mesdia.split('-')
                  return (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px',
                      background: c.dias === 0 ? '#fef2f2' : c.dias <= 7 ? '#fff7ed' : '#FAF7EF',
                      borderRadius: '8px', border: `1px solid ${c.dias === 0 ? '#fca5a5' : c.dias <= 7 ? '#fed7aa' : '#E1DDD0'}`,
                    }}>
                      <span style={{ fontSize: '18px', flexShrink: 0 }}>{c.dias === 0 ? '🎂' : '🎁'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '12.5px', color: '#15291F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.nombre}
                        </div>
                        <div style={{ fontSize: '11px', color: '#7E9389' }}>
                          {dd}/{mm} · {c.subtitulo}{edad ? ` · ${edad}` : ''}
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div style={{ padding: '2px 7px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, background: COLOR[c.tipo].bg, color: COLOR[c.tipo].color, marginBottom: '3px' }}>
                          {c.tipo === 'residente' ? 'Residente' : 'Personal'}
                        </div>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: c.dias === 0 ? '#dc2626' : c.dias <= 7 ? '#ea580c' : '#7E9389' }}>
                          {c.dias === 0 ? '¡Hoy! 🎉' : `en ${c.dias}d`}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
