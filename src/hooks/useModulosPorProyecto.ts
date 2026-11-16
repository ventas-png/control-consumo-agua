// Módulos por proyecto (migración 20261127000000), aplicados a la app autenticada.
//
// La empresa elige en qué módulos opera cada proyecto (Mis Proyectos › Módulos).
// Este hook traduce esa elección a lo que consumen el menú y las rutas:
//   · `aguaModulo`            las colecciones de Manejo Agua acotadas a los
//                             proyectos con Agua (lo que reciben sus secciones);
//   · `proyectosCondominios`  los proyectos que ofrece el selector de condominio;
//   · `sesionMenu`            la sesión con un módulo apagado cuando NINGÚN
//                             proyecto visible opera en él (el menú lo oculta).
// Las secciones compartidas (Clientes, Unidades, Comunicación, Contabilidad,
// Empresa) siguen recibiendo `agua` completo.
//
// Para la empresa que no apagó nada, todo sale idéntico (mismas referencias).
import { useMemo } from 'react'
import type { Proyecto, UserSession } from '../types'
import type { AguaData } from './useAguaData'
import { acotarAguaAlModulo, moduloSinProyectos, proyectosConModulo } from '../lib/modulosProyecto'

export interface ModulosPorProyecto {
  aguaModulo: AguaData
  proyectosCondominios: Proyecto[]
  sesionMenu: UserSession | null
}

export function useModulosPorProyecto(currentUser: UserSession | null, agua: AguaData): ModulosPorProyecto {
  const { proyectos, unidades, contadores, registros, tarifas, rutas, clientes, projectScope } = agua
  // Sólo las colecciones entran al memo: `agua` es un objeto nuevo en cada render.
  const colecciones = useMemo(
    () => acotarAguaAlModulo({ proyectos, unidades, contadores, registros, tarifas, rutas, clientes, projectScope }),
    [proyectos, unidades, contadores, registros, tarifas, rutas, clientes, projectScope],
  )
  const aguaModulo: AguaData = colecciones.proyectos === proyectos ? agua : { ...agua, ...colecciones }

  const proyectosCondominios = useMemo(() => proyectosConModulo(proyectos, 'condominios'), [proyectos])

  const sinAgua = moduloSinProyectos(proyectos, 'agua')
  const sinCondominios = moduloSinProyectos(proyectos, 'condominios')
  const sesionMenu = useMemo(() => {
    if (!currentUser || (!sinAgua && !sinCondominios)) return currentUser
    return {
      ...currentUser,
      ...(sinAgua ? { servicio_agua: false } : {}),
      ...(sinCondominios ? { servicio_condominios: false } : {}),
    }
  }, [currentUser, sinAgua, sinCondominios])

  return { aguaModulo, proyectosCondominios, sesionMenu }
}
