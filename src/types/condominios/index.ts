// cond:C9 / auditoría P1 — barrel del dominio Condominios.
// El archivo monolítico types/condominios.ts (~2.950 L) se particionó por
// sub-dominio; los imports existentes ('../types/condominios' y '@/types')
// resuelven a este índice sin cambios.
export * from './core'
export * from './seguridad'
export * from './operaciones'
export * from './residentes'
export * from './comercial'
export * from './gobernanza'
export * from './finanzas'
