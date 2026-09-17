# Capturas del calendario de asignación de turnos

Las tres son del componente REAL (`src/components/condominios/tabs/TurnosTab.tsx`)
renderizado con `src/index.css`, no maquetas: el HTML se vuelca desde el propio
componente montado y se fotografía con Chromium. Septiembre de 2026, con «hoy»
fijado al 16 para que se vea qué casillas se pueden tocar y cuáles no.

| Archivo | Qué enseña |
|---|---|
| `calendario-escritorio.png` | 1280×900. Cada día bajo su día de la semana: el 1 es martes, el 7 lunes, el 30 miércoles. El 24 de Pedro está quitado a mano (`—`), el 15 choca con Independencia, del 21 al 25 Ana está de vacaciones (🌴) y hoy lleva el anillo de acento. La segunda quincena, sin generar, va en translúcido. |
| `calendario-movil.png` | 390×844. La misma cuadrícula alineada en un teléfono: el mes no cabe y scrollea en horizontal en vez de apretar los días hasta volverlos ilegibles. |
| `calendario-movil-scroll.png` | El mismo teléfono con el mes scrolleado hasta el final. La columna de nombres se queda fija: sin eso, al llegar al domingo ya no se sabe de quién es la fila. |

Por qué existen: el bug que arregló este PR era exclusivamente visual —la fila
de cada empleado era UNA cuadrícula de `150px repeat(7, 1fr)` con el nombre como
primer hijo, así que a partir del día 8 cada semana quedaba corrida una casilla
respecto del encabezado— y no hay prueba unitaria que se lea tan rápido como
mirar la rejilla cuadrada.
