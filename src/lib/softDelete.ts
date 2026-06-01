import { supabase } from './supabase'

// Tablas con columnas deleted_at + deleted_by agregadas en la migracion
// 20260528000001_soft_delete_critical_tables.sql. Si extends soft delete a
// otra tabla, sumala aqui y a los SELECT consumidores agregales .is('deleted_at', null).
export type SoftDeletableTable =
  | 'pagos'
  | 'cuotas_condominio'
  | 'fondo_reserva_condominio'
  | 'tickets_mantenimiento'

// Marca una fila como eliminada en lugar de hacer DELETE fisico. Reemplazo de
// supabase.from(t).delete().match(...) para las tablas de SoftDeletableTable.
// El trigger audit_log_generic captura el UPDATE en audit_log.
//
// Idempotente: si la fila ya esta soft-deleted, el UPDATE no toca el row
// (preserva el timestamp original de borrado) porque .is('deleted_at', null)
// filtra los rows ya inactivos.
//
// deleted_by se toma del usuario autenticado; si no hay sesion (jobs/sistema)
// queda null.
export async function softDelete(
  table: SoftDeletableTable,
  match: { id: string | number } & Record<string, string | number | boolean | null>,
) {
  const { data: { user } } = await supabase.auth.getUser()
  return supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
    .match(match)
    .is('deleted_at', null)
}
