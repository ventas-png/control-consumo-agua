import { useMemo, useState } from 'react'
import { Unidad, ContratoArrendamiento, Mascota, VehiculoResidente } from '../../../types'

interface Props {
  unidades: Unidad[]
  contratos: ContratoArrendamiento[]
  mascotas: Mascota[]
  vehiculos: VehiculoResidente[]
}

type FiltroDirect = 'todos' | 'con_propietario' | 'en_renta' | 'libre' | 'inactiva'

const TIPO_ICON: Record<string, string> = {
  apartamento: '🏠', casa: '🏡', bodega: '📦',
  local_comercial: '🏪', oficina: '💼', parqueadero: '🚗', otro: '📋',
}

const ESPECIE_ICON: Record<string, string> = { perro: '🐕', gato: '🐈', ave: '🐦', otro: '🐾' }

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`
  return v
}

export default function DirectorioComunidadTab({ unidades, contratos, mascotas, vehiculos }: Props) {
  const [filtro, setFiltro] = useState<FiltroDirect>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [expandida, setExpandida] = useState<string | null>(null)

  const contratosActivos = useMemo(() => contratos.filter(c => c.estado === 'activo'), [contratos])

  const directorio = useMemo(() => {
    return unidades.map(u => {
      const contrato = contratosActivos.find(c => c.unidad_id === u.id)
      const mascotasU = mascotas.filter(m => m.unidad_id === u.id && m.activo)
      const vehiculosU = vehiculos.filter(v => v.unidad_id === u.id && v.activo)

      let estado: FiltroDirect
      if (!u.activo) estado = 'inactiva'
      else if (contrato) estado = 'en_renta'
      else if (u.propietario_nombre) estado = 'con_propietario'
      else estado = 'libre'

      return { u, contrato, mascotasU, vehiculosU, estado }
    })
  }, [unidades, contratosActivos, mascotas, vehiculos])

  const filtrado = useMemo(() => {
    let r = filtro === 'todos' ? directorio : directorio.filter(d => d.estado === filtro)
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      r = r.filter(d =>
        d.u.nombre.toLowerCase().includes(q) ||
        (d.u.propietario_nombre ?? '').toLowerCase().includes(q) ||
        (d.u.propietario_email ?? '').toLowerCase().includes(q) ||
        (d.u.propietario_telefono ?? '').toLowerCase().includes(q) ||
        (d.contrato?.arrendatario_nombre ?? '').toLowerCase().includes(q)
      )
    }
    return r.sort((a, b) => a.u.nombre.localeCompare(b.u.nombre))
  }, [directorio, filtro, busqueda])

  const resumen = useMemo(() => ({
    total: directorio.length,
    conPropietario: directorio.filter(d => d.estado === 'con_propietario').length,
    enRenta: directorio.filter(d => d.estado === 'en_renta').length,
    libre: directorio.filter(d => d.estado === 'libre').length,
    inactiva: directorio.filter(d => d.estado === 'inactiva').length,
    totalMascotas: mascotas.filter(m => m.activo).length,
    totalVehiculos: vehiculos.filter(v => v.activo).length,
  }), [directorio, mascotas, vehiculos])

  function exportarCSV() {
    const headers = ['Unidad', 'Tipo', 'Piso', 'Estado', 'Propietario', 'Tel. Propietario', 'Email Propietario', 'Arrendatario', 'Tel. Arrendatario', 'Mascotas', 'Vehículos']
    const rows = filtrado.map(d => [
      d.u.nombre, d.u.tipo ?? '', String(d.u.piso ?? ''),
      d.estado.replace('_', ' '),
      d.u.propietario_nombre ?? '',
      d.u.propietario_telefono ?? '',
      d.u.propietario_email ?? '',
      d.contrato?.arrendatario_nombre ?? '',
      d.contrato?.arrendatario_telefono ?? '',
      d.mascotasU.map(m => `${m.nombre}(${m.especie})`).join('; '),
      d.vehiculosU.map(v => `${v.placa} ${v.marca ?? ''}`).join('; '),
    ].map(csvEscape))
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `directorio_comunidad_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const FILTRO_CFG: Record<FiltroDirect, { label: string; color: string; bg: string }> = {
    todos:          { label: `Todos (${resumen.total})`,                color: '#3E5A4C', bg: '#FAF7EF' },
    con_propietario:{ label: `Propietario (${resumen.conPropietario})`, color: '#1B3B36', bg: '#EEF2EC' },
    en_renta:       { label: `En renta (${resumen.enRenta})`,          color: '#9C5733', bg: '#FAF1EA' },
    libre:          { label: `Libre (${resumen.libre})`,               color: '#16a34a', bg: '#dcfce7' },
    inactiva:       { label: `Inactiva (${resumen.inactiva})`,         color: '#7E9389', bg: '#FAF7EF' },
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#15291F' }}>Directorio de la Comunidad</div>
        <button onClick={exportarCSV}
          style={{ padding: '6px 14px', background: '#15291F', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
          📥 Exportar CSV
        </button>
      </div>
      <div style={{ fontSize: 12, color: '#7E9389', marginBottom: 14 }}>
        {resumen.total} unidades · {resumen.totalMascotas} mascotas · {resumen.totalVehiculos} vehículos registrados
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { label: 'Propietarios',   val: String(resumen.conPropietario), color: '#1B3B36', bg: '#EEF2EC' },
          { label: 'Arrendatarios',  val: String(resumen.enRenta),        color: '#9C5733', bg: '#FAF1EA' },
          { label: 'Libres',         val: String(resumen.libre),          color: '#16a34a', bg: '#dcfce7' },
          { label: 'Mascotas',       val: String(resumen.totalMascotas),  color: '#f59e0b', bg: '#fffbeb' },
          { label: 'Vehículos',      val: String(resumen.totalVehiculos), color: '#3E5A4C', bg: '#FAF7EF' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 90px', background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: '#7E9389' }}>{k.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: k.color, marginTop: 1 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {(Object.keys(FILTRO_CFG) as FiltroDirect[]).map(f => {
          const cfg = FILTRO_CFG[f]
          const activo = filtro === f
          return (
            <button key={f} onClick={() => setFiltro(f)}
              style={{ padding: '4px 12px', borderRadius: 20, border: `1px solid ${cfg.color}44`, fontSize: 11, cursor: 'pointer',
                background: activo ? cfg.color : cfg.bg, color: activo ? '#fff' : cfg.color, fontWeight: activo ? 700 : 400 }}>
              {cfg.label}
            </button>
          )
        })}
      </div>

      <div style={{ marginBottom: 12 }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, propietario, arrendatario, email, teléfono..."
          style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
      </div>

      {/* Tabla */}
      <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '8px 14px', background: '#FAF7EF', fontSize: 11, color: '#7E9389', fontWeight: 600, display: 'flex', gap: 8 }}>
          <span style={{ width: 90 }}>Unidad</span>
          <span style={{ width: 70 }}>Estado</span>
          <span style={{ flex: 1 }}>Propietario</span>
          <span style={{ flex: 1 }}>Arrendatario</span>
          <span style={{ width: 80, textAlign: 'center' }}>Mascotas</span>
          <span style={{ width: 80, textAlign: 'center' }}>Vehículos</span>
        </div>

        {filtrado.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#7E9389', fontSize: 12 }}>Sin unidades en este filtro.</div>
        ) : filtrado.map((d, i) => {
          const abierta = expandida === d.u.id
          const estadoColor = d.estado === 'en_renta' ? '#9C5733' : d.estado === 'con_propietario' ? '#1B3B36' : d.estado === 'libre' ? '#16a34a' : '#7E9389'
          return (
            <div key={d.u.id}>
              <div onClick={() => setExpandida(abierta ? null : d.u.id)}
                style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px',
                  borderTop: i > 0 ? '1px solid var(--at-chip)' : undefined, cursor: 'pointer',
                  background: abierta ? '#fafbff' : undefined }}>
                <div style={{ width: 90 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#15291F' }}>
                    {(TIPO_ICON as Record<string, string>)[d.u.tipo] ?? '📋'} {d.u.nombre}
                  </div>
                  {d.u.piso != null && <div style={{ fontSize: 9, color: '#7E9389' }}>Piso {d.u.piso}</div>}
                </div>
                <div style={{ width: 70 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: estadoColor, background: `${estadoColor}15`,
                    padding: '2px 6px', borderRadius: 8 }}>{d.estado.replace('_', ' ')}</span>
                </div>
                <div style={{ flex: 1 }}>
                  {d.u.propietario_nombre
                    ? <div style={{ fontSize: 12, color: '#15291F' }}>{d.u.propietario_nombre}
                        {d.u.propietario_telefono && <span style={{ fontSize: 10, color: '#7E9389' }}> · {d.u.propietario_telefono}</span>}
                      </div>
                    : <span style={{ fontSize: 11, color: '#C7C2B0' }}>—</span>}
                </div>
                <div style={{ flex: 1 }}>
                  {d.contrato
                    ? <div style={{ fontSize: 12, color: '#15291F' }}>{d.contrato.arrendatario_nombre}
                        {d.contrato.arrendatario_telefono && <span style={{ fontSize: 10, color: '#7E9389' }}> · {d.contrato.arrendatario_telefono}</span>}
                      </div>
                    : <span style={{ fontSize: 11, color: '#C7C2B0' }}>—</span>}
                </div>
                <div style={{ width: 80, textAlign: 'center', fontSize: 12 }}>
                  {d.mascotasU.length > 0 ? d.mascotasU.map(m => ESPECIE_ICON[m.especie] ?? '🐾').join('') : '—'}
                </div>
                <div style={{ width: 80, textAlign: 'center', fontSize: 11, color: '#3E5A4C', fontWeight: 600 }}>
                  {d.vehiculosU.length > 0 ? `🚗 ${d.vehiculosU.length}` : '—'}
                </div>
              </div>

              {/* Detalle expandido */}
              {abierta && (
                <div style={{ background: '#FAF7EF', borderTop: '1px solid var(--at-line)', padding: '10px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  {/* Propietario */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#7E9389', marginBottom: 4 }}>👤 PROPIETARIO</div>
                    {d.u.propietario_nombre ? (
                      <>
                        <div style={{ fontSize: 12, color: '#15291F', fontWeight: 600 }}>{d.u.propietario_nombre}</div>
                        {d.u.propietario_telefono && <div style={{ fontSize: 11, color: '#7E9389' }}>📞 {d.u.propietario_telefono}</div>}
                        {d.u.propietario_email && <div style={{ fontSize: 11, color: '#7E9389' }}>✉ {d.u.propietario_email}</div>}
                      </>
                    ) : <div style={{ fontSize: 11, color: '#7E9389', fontStyle: 'italic' }}>Sin propietario registrado</div>}
                  </div>

                  {/* Arrendatario */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#7E9389', marginBottom: 4 }}>🏠 ARRENDATARIO</div>
                    {d.contrato ? (
                      <>
                        <div style={{ fontSize: 12, color: '#15291F', fontWeight: 600 }}>{d.contrato.arrendatario_nombre}</div>
                        {d.contrato.arrendatario_telefono && <div style={{ fontSize: 11, color: '#7E9389' }}>📞 {d.contrato.arrendatario_telefono}</div>}
                        {d.contrato.arrendatario_email && <div style={{ fontSize: 11, color: '#7E9389' }}>✉ {d.contrato.arrendatario_email}</div>}
                        <div style={{ fontSize: 10, color: '#7E9389', marginTop: 2 }}>Contrato: {d.contrato.fecha_inicio} — {d.contrato.fecha_fin ?? 'indefinido'}</div>
                      </>
                    ) : <div style={{ fontSize: 11, color: '#7E9389', fontStyle: 'italic' }}>Sin arrendatario</div>}
                  </div>

                  {/* Mascotas y vehículos */}
                  <div>
                    {d.mascotasU.length > 0 && (
                      <>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#7E9389', marginBottom: 4 }}>🐾 MASCOTAS</div>
                        {d.mascotasU.map(m => (
                          <div key={m.id} style={{ fontSize: 11, color: '#3E5A4C', marginBottom: 1 }}>
                            {ESPECIE_ICON[m.especie] ?? '🐾'} {m.nombre} ({m.especie}{m.raza ? `, ${m.raza}` : ''})
                          </div>
                        ))}
                      </>
                    )}
                    {d.vehiculosU.length > 0 && (
                      <>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#7E9389', marginBottom: 4, marginTop: d.mascotasU.length > 0 ? 8 : 0 }}>🚗 VEHÍCULOS</div>
                        {d.vehiculosU.map(v => (
                          <div key={v.id} style={{ fontSize: 11, color: '#3E5A4C', marginBottom: 1 }}>
                            {v.placa} {v.marca ? `· ${v.marca}` : ''} {v.modelo ? v.modelo : ''} {v.color ? `(${v.color})` : ''}
                          </div>
                        ))}
                      </>
                    )}
                    {d.mascotasU.length === 0 && d.vehiculosU.length === 0 && (
                      <div style={{ fontSize: 11, color: '#7E9389', fontStyle: 'italic' }}>Sin mascotas ni vehículos</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: '#7E9389', textAlign: 'right' }}>
        Mostrando {filtrado.length} de {directorio.length} unidades · Haz clic en una fila para ver detalles
      </div>
    </div>
  )
}
