# Suministros: editar la ficha y declarar el rendimiento

Operaciones → Condominios → **Suministros**. Hasta aquí la ficha de un insumo
sólo se creaba, se le movía stock y se desactivaba: no había cómo corregir el
nombre, el mínimo, el proveedor o el costo, ni dónde anotar cuánto rinde.

## Editar

En el detalle, **✏️ Editar** abre la misma ficha del alta con sus valores. Lo
que se guarda es lo que la persona cambió: nombre, categoría, unidad de medida,
stock mínimo, ubicación, proveedor (del catálogo compartido), costo unitario,
rendimiento y notas. Exige la acción `suministros.edit` (la misma del botón
«+ Movimiento»): la policy `suministros_condominio_update` la verifica en el
servidor (20261104000600).

**El stock actual no se edita.** Lo recalcula la base con cada movimiento
(`suministros_tg_stock`, 20260821000200) y un UPDATE directo lo ignora en
silencio; la ficha lo muestra en sólo lectura con la indicación de que se
cambia con un movimiento de **ajuste**, que fija el stock al valor que se
indique.

El detalle sigue a la fila recargada: tras guardar, mover stock o desactivar,
lo que se ve es la ficha nueva (antes el panel conservaba una copia de la fila
en el momento de pulsarla).

## Rendimiento

Dos columnas nuevas en `suministros_condominio` (20261109000000):

| Columna | Qué guarda |
|---|---|
| `rendimiento` | cuántos **usos** da **una** `unidad_medida` (numeric > 0; NULL = no declarado) |
| `rendimiento_unidad` | en qué se mide ese uso: aplicaciones, limpiezas, m², días… (texto libre; sólo viaja con `rendimiento`) |

Ejemplo: alcohol etílico, unidad `litro`, rendimiento `40`, unidad
`aplicaciones` → «1 litro rinde 40 aplicaciones».

Con eso, el detalle y la lista traducen la ficha (`src/lib/suministros.ts`,
nada se persiste):

- **Usos disponibles** = stock actual × rendimiento (en rojo cuando queda por
  debajo de stock mínimo × rendimiento).
- **Costo por uso** = costo unitario ÷ rendimiento.
- **Consumo observado**: suma de las *salidas* de los últimos 30 días, el
  promedio por día y cuántos días alcanza el stock a ese ritmo. Entradas y
  ajustes no cuentan como consumo.

La carga masiva admite las columnas opcionales `rendimiento` y
`rendimiento_unidad` con las mismas reglas (número > 0; la unidad sin número se
rechaza).

## Pruebas

- `src/lib/__tests__/suministros.test.ts`: derivados, ventana de consumo y
  aritmética de fechas.
- `src/components/condominios/tabs/__tests__/SuministrosTab.editar.test.tsx`:
  detalle con rendimiento, edición (qué viaja y qué no), validación, alta con
  rendimiento, carga masiva y que registrar un movimiento sigue sin tocar el
  stock desde el cliente.
