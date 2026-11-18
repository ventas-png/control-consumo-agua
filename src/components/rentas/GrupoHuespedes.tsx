import { useState } from 'react'
import { personaVacia, type PersonaGrupo } from '../../domain/rentas/grupo'
import { notify } from '../shared/Dialog'
import { Button } from '../shared/Button'
import { ImageUploader } from '../shared/ImageUploader'
import { campo, etiqueta, rejilla, tenue } from './ui'

interface Props {
  /** Personas adicionales al huésped principal. */
  personas: PersonaGrupo[]
  onChange: (personas: PersonaGrupo[]) => void
  /** Nombre del huésped principal (encabeza la lista). */
  principal: string
  /** Cuántas adicionales caben: adultos + niños − 1. */
  maximo: number
  onSubiendo?: (subiendo: boolean) => void
}

/**
 * Personas del grupo de una reserva, como en la pestaña STR de Condominios:
 * el huésped principal y los adicionales pre-registrados, cada uno con su
 * documento y fotos opcionales. Quien ya registró su ingreso no se quita.
 */
export function GrupoHuespedes({ personas, onChange, principal, maximo, onSubiendo }: Props) {
  const [nueva, setNueva] = useState<PersonaGrupo | null>(null)

  const agregar = () => {
    if (!nueva) return
    if (!nueva.nombre.trim()) { notify({ variant: 'error', title: 'Ingresa el nombre de la persona' }); return }
    onChange([...personas, { ...nueva, nombre: nueva.nombre.trim() }])
    setNueva(null)
  }
  const quitar = (i: number) => {
    if (personas[i]?.visitante_id) {
      notify({ variant: 'info', title: 'No permitido', text: 'Esta persona ya registró su ingreso y no puede quitarse.' })
      return
    }
    onChange(personas.filter((_, k) => k !== i))
  }
  const renglon = { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.75rem', border: '1px solid var(--at-line)', borderRadius: '8px' } as const

  return (
    <section aria-label="Personas del grupo">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 600, fontSize: '14px' }}>
          Personas del grupo <span style={{ ...tenue, fontWeight: 400 }}>(principal + {personas.length}/{Math.max(0, maximo)} adicionales pre-registradas)</span>
        </span>
        {!nueva && personas.length < maximo && (
          <Button size="sm" variant="secondary" onClick={() => setNueva(personaVacia())}>+ Agregar persona</Button>
        )}
      </div>
      <div style={{ display: 'grid', gap: '0.4rem' }}>
        <div style={renglon}>
          <strong>{principal.trim() || 'Huésped principal'}</strong>
          <span style={{ ...tenue, marginLeft: 'auto' }}>Principal</span>
        </div>
        {personas.map((h, i) => (
          <div key={h.id ?? `n${i}`} style={renglon}>
            <div style={{ minWidth: 0 }}>
              <div>{h.nombre}</div>
              <div style={tenue}>
                {[h.identificacion, h.es_menor ? 'Menor' : null, h.foto_documento_url ? 'con documento' : null, h.visitante_id ? 'ya ingresó' : null].filter(Boolean).join(' · ')}
              </div>
            </div>
            <span style={{ marginLeft: 'auto' }}>
              <Button size="sm" variant="secondary" onClick={() => quitar(i)} aria-label={`Quitar a ${h.nombre}`}>Quitar</Button>
            </span>
          </div>
        ))}
      </div>
      {maximo <= 0 && personas.length === 0 && (
        <p style={{ ...tenue, margin: '0.4rem 0 0' }}>Aumenta los adultos o niños de la reserva para pre-registrar más personas.</p>
      )}

      {nueva && (
        <div style={{ marginTop: '0.6rem', padding: '0.75rem', border: '1px dashed var(--at-line-strong, var(--at-line))', borderRadius: '8px', display: 'grid', gap: '0.75rem' }}>
          <div style={rejilla(180)}>
            <div>
              <label htmlFor="rgp-nombre" style={etiqueta}>Nombre *</label>
              <input id="rgp-nombre" type="text" value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} style={campo} maxLength={150} />
            </div>
            <div>
              <label htmlFor="rgp-doc" style={etiqueta}>Identificación</label>
              <input id="rgp-doc" type="text" value={nueva.identificacion} onChange={e => setNueva({ ...nueva, identificacion: e.target.value })} style={campo} maxLength={60} />
            </div>
            <div>
              <label style={{ ...etiqueta, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input type="checkbox" checked={nueva.es_menor} onChange={e => setNueva({ ...nueva, es_menor: e.target.checked })} />
                Es menor de edad
              </label>
              {nueva.es_menor && (
                <input type="date" aria-label="Fecha de nacimiento" value={nueva.fecha_nacimiento}
                  onChange={e => setNueva({ ...nueva, fecha_nacimiento: e.target.value })} style={campo} />
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 200px))', gap: '0.75rem' }}>
            <ImageUploader value={nueva.foto_url} onChange={v => setNueva({ ...nueva, foto_url: v })} folder="str_guests" label="Foto" capture onSubiendo={onSubiendo} />
            <ImageUploader value={nueva.foto_documento_url} onChange={v => setNueva({ ...nueva, foto_documento_url: v })} folder="str_guests" label="Documento" capture onSubiendo={onSubiendo} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button size="sm" variant="secondary" onClick={() => setNueva(null)}>Cancelar</Button>
            <Button size="sm" onClick={agregar}>Agregar</Button>
          </div>
        </div>
      )}
    </section>
  )
}
