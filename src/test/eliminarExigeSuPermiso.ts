// Helper de las pruebas por sección de «escribir exige la ACCIÓN del tab»
// (supabase/rls-acciones/<sección>.json): Eliminar se ofrece y se ejecuta con
// canDelete —condominios.tab.<tab>.delete, lo mismo que exige la base—, no con
// canEdit.
import { describe, it, expect } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'

/**
 * Las tres verificaciones de una pestaña con Eliminar: editar sin eliminar no
 * lo ofrece, sólo consultar tampoco, y eliminar sin editar sí borra la fila.
 * `borrar` es el mock de la mutación que la pestaña usa para borrar.
 */
export function eliminarExigeSuPermiso(
  nombre: string,
  montar: (p: { canEdit: boolean; canDelete: boolean }) => void,
  boton: RegExp,
  borrar: Mock,
  ...llamada: unknown[]
) {
  describe(`${nombre} — Eliminar exige canDelete`, () => {
    it('editar sin eliminar: no hay botón Eliminar', () => {
      montar({ canEdit: true, canDelete: false })
      expect(screen.queryByRole('button', { name: boton })).toBeNull()
    })
    it('sólo consulta: no hay botón Eliminar', () => {
      montar({ canEdit: false, canDelete: false })
      expect(screen.queryByRole('button', { name: boton })).toBeNull()
    })
    it('eliminar sin editar: el botón borra la fila', async () => {
      montar({ canEdit: false, canDelete: true })
      fireEvent.click(screen.getAllByRole('button', { name: boton })[0])
      await waitFor(() => expect(borrar).toHaveBeenCalledWith(...llamada))
    })
  })
}
