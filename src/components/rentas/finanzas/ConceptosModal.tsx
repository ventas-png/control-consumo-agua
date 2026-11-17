import { useState } from 'react'
import type { BloqueConceptoRenta, ConceptoRenta } from '../../../types'
import { BLOQUE_LABEL, BLOQUES, codigoDeConcepto, conceptosDeBloque } from '../../../domain/rentas/finanzas'
import { mensajeErrorRentas } from '../../../domain/rentas/logica'
import { useConceptosRentaMutations } from '../../../domain/rentas/mutations'
import { notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { campo, tenue } from '../ui'

interface Props {
  conceptos: ConceptoRenta[]
  companyId: string
  onClose: () => void
}

/**
 * Las columnas del desglose de cobro, por bloque: renombrar, decidir si suman
 * o restan, si entran en la base de la comisión, reordenar, desactivar y
 * agregar propias. No se eliminan: las reservas ya capturadas las usan.
 */
export function ConceptosModal({ conceptos, companyId, onClose }: Props) {
  const { crear, actualizar } = useConceptosRentaMutations(companyId)
  const [nuevo, setNuevo] = useState<Record<BloqueConceptoRenta, string>>({ huesped: '', anfitrion: '' })
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const ocupado = crear.isPending || actualizar.isPending

  const cambiar = async (c: ConceptoRenta, patch: Partial<Pick<ConceptoRenta, 'nombre' | 'signo' | 'comisionable' | 'activo' | 'orden'>>) => {
    try {
      await actualizar.mutateAsync({ id: c.id, patch })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo guardar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }
  const renombrar = (c: ConceptoRenta) => {
    const nombre = (nombres[c.id] ?? c.nombre).trim()
    if (nombre === '' || nombre === c.nombre) { setNombres(p => ({ ...p, [c.id]: c.nombre })); return }
    void cambiar(c, { nombre })
  }
  /** Intercambia el orden con el vecino (los sembrados van de 10 en 10; los empates se resuelven renumerando). */
  const mover = async (lista: ConceptoRenta[], i: number, delta: -1 | 1) => {
    const j = i + delta
    if (j < 0 || j >= lista.length) return
    const reordenada = [...lista]
    ;[reordenada[i], reordenada[j]] = [reordenada[j], reordenada[i]]
    try {
      for (const [k, c] of reordenada.entries()) {
        const orden = (k + 1) * 10
        if (c.orden !== orden) await actualizar.mutateAsync({ id: c.id, patch: { orden } })
      }
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo reordenar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }
  const agregar = async (bloque: BloqueConceptoRenta) => {
    const nombre = nuevo[bloque].trim()
    if (!nombre) return
    const delBloque = conceptos.filter(c => c.bloque === bloque)
    try {
      await crear.mutateAsync({
        company_id: companyId, bloque, nombre, signo: 1, comisionable: bloque === 'anfitrion', activo: true,
        codigo: codigoDeConcepto(nombre, new Set(delBloque.map(c => c.codigo))),
        orden: Math.max(0, ...delBloque.map(c => c.orden)) + 10,
      })
      setNuevo(p => ({ ...p, [bloque]: '' }))
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo agregar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  return (
    <EditModal title="Conceptos del desglose de cobro" onClose={onClose} size="lg" fullScreenOnMobile
      footer={<Button onClick={onClose}>Listo</Button>}>
      <p style={{ ...tenue, margin: '0 0 1rem', fontSize: '13px' }}>
        Son las columnas que se capturan en cada reserva. «Resta» descuenta del total del bloque (descuentos, comisión de la plataforma).
        «Comisión» indica si el concepto entra en la base sobre la que la administradora cobra su porcentaje.
      </p>
      <div style={{ display: 'grid', gap: '1.25rem' }}>
        {BLOQUES.map(bloque => {
          const lista = conceptosDeBloque(conceptos, bloque)
          return (
            <section key={bloque} aria-label={BLOQUE_LABEL[bloque]}>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '15px' }}>{BLOQUE_LABEL[bloque]}</h3>
              <div style={{ display: 'grid', gap: '0.4rem' }}>
                {lista.map((c, i) => (
                  <div key={c.id} style={{
                    display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', padding: '0.4rem 0.5rem',
                    border: '1px solid var(--at-line)', borderRadius: '8px', opacity: c.activo ? 1 : 0.6,
                  }}>
                    <input type="text" aria-label={`Nombre del concepto ${c.nombre}`} value={nombres[c.id] ?? c.nombre} maxLength={80}
                      onChange={e => setNombres(p => ({ ...p, [c.id]: e.target.value }))} onBlur={() => renombrar(c)}
                      style={{ ...campo, flex: '1 1 200px', width: 'auto' }} />
                    <select aria-label={`${c.nombre}: suma o resta`} value={c.signo} disabled={ocupado}
                      onChange={e => void cambiar(c, { signo: Number(e.target.value) === -1 ? -1 : 1 })} style={{ ...campo, width: 'auto' }}>
                      <option value={1}>Suma</option>
                      <option value={-1}>Resta</option>
                    </select>
                    {bloque === 'anfitrion' && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '13px' }}>
                        <input type="checkbox" checked={c.comisionable} disabled={ocupado} onChange={e => void cambiar(c, { comisionable: e.target.checked })} />
                        Comisión
                      </label>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '13px' }}>
                      <input type="checkbox" checked={c.activo} disabled={ocupado} onChange={e => void cambiar(c, { activo: e.target.checked })} />
                      Activo
                    </label>
                    <span style={{ display: 'flex', gap: '0.25rem' }}>
                      <Button size="sm" variant="secondary" disabled={ocupado || i === 0} onClick={() => void mover(lista, i, -1)} aria-label={`Subir ${c.nombre}`}>↑</Button>
                      <Button size="sm" variant="secondary" disabled={ocupado || i === lista.length - 1} onClick={() => void mover(lista, i, 1)} aria-label={`Bajar ${c.nombre}`}>↓</Button>
                    </span>
                  </div>
                ))}
              </div>
              <form onSubmit={e => { e.preventDefault(); void agregar(bloque) }} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <input type="text" aria-label={`Nuevo concepto en ${BLOQUE_LABEL[bloque]}`} placeholder="Agregar concepto…" maxLength={80}
                  value={nuevo[bloque]} onChange={e => setNuevo(p => ({ ...p, [bloque]: e.target.value }))} style={{ ...campo, flex: 1 }} />
                <Button type="submit" variant="secondary" disabled={ocupado || nuevo[bloque].trim() === ''}>Agregar</Button>
              </form>
            </section>
          )
        })}
      </div>
    </EditModal>
  )
}
