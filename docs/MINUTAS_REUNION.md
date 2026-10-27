# Minutas de reunión (pestaña «Minutas» · tabla `notas_admin`)

La pestaña **Administración › Minutas** (antes «Notas Admin») registra las
reuniones de la administración con empleados, propietarios/inquilinos y
proveedores: quiénes participaron, qué puntos se abordaron y qué se acordó o se
comprometió en cada uno. La tabla, el permiso (`condominios.tab.notas_admin.*`)
y las políticas RLS son los de siempre; la migración `20261110000000` amplía la
fila con la fecha de la reunión y dos columnas JSON.

## Flujo en pantalla

- **Lista** en tarjetas: categoría, fecha, quién gestiona, avatares de los
  participantes, puntos y acuerdos, avance de compromisos (cumplidos / total,
  vencidos) y próximo seguimiento. Filtros por estado (abiertas, con vencidos,
  cerradas, todas), categoría y búsqueda por título, participante o punto.
- **Detalle** en ventana: participantes, puntos con sus acuerdos y
  compromisos. Con permiso de editar se marcan compromisos cumplidos (se sella
  `cumplido_at`), se fija/desfija, se cierra (`resuelta = true`, avisa si
  quedan compromisos) o se reabre; imprimir arma la versión en papel.
- **Nueva / editar** en ventana, en tres pasos (`minutas/MinutaWizard.tsx`):
  1. **Participantes** — título, fecha, objetivo; quien la abre entra como
     gestor (★) y se puede cambiar con «Hacer gestor». Se agregan desde cuatro
     listas: **empleados** (`personal` activo, con el nombre del cargo del
     catálogo RRHH), **propietarios/inquilinos** (`unidad_residentes` del
     proyecto con su rol, más el dueño registrado en la unidad y el arrendatario
     del contrato vigente cuando la unidad no los tiene como residentes),
     **proveedores** (catálogo compartido de la empresa, sin vetados, más los
     contratos de proveedor del condominio) y **otro** por nombre.
  2. **Puntos** — los temas a abordar, numerados, con detalle opcional.
  3. **Acuerdos** — por cada punto, *acuerdos* (lo decidido) y *compromisos*
     (responsable entre los participantes y fecha límite). Cierre: categoría,
     prioridad, próximo seguimiento y fijar.

  En el paso 3 también se adjuntan **fotos de la reunión** (hasta 10): hoja
  de asistencia, pizarrón, lo revisado en sitio.

  Cada paso valida lo suyo antes de avanzar (título, fecha, al menos un
  participante y un gestor; al menos un punto; fechas válidas). La lógica está
  en `src/domain/condominios/minutas.ts`.

## Forma de los JSON

```jsonc
// notas_admin.participantes
[
  { "id": "uuid", "tipo": "empleado",   // empleado | residente | proveedor | otro
    "ref_id": "personal.id | unidad_residentes.id | proveedores.id | null",
    "nombre": "Carlos Guardia", "detalle": "Guardia de seguridad", "gestiona": false }
]

// notas_admin.puntos
[
  { "id": "uuid", "titulo": "Rondas nocturnas", "descripcion": "Se saltan la de las 2 am",
    "acuerdos": [
      { "id": "uuid", "tipo": "acuerdo",    "texto": "Se mantiene el horario", "cumplido": false },
      { "id": "uuid", "tipo": "compromiso", "texto": "Registrar cada ronda",
        "responsable_id": "<participante.id>", "fecha_limite": "2026-11-02",
        "cumplido": true, "cumplido_at": "2026-10-27T15:00:00Z" }
    ] }
]
```

- `ref_id` es informativo (de qué fila salió la persona); la minuta guarda el
  nombre y el detalle tal como estaban al registrarla, igual que un acta.
- `responsable_id` cita el `id` local del participante; si se quita al
  participante, el compromiso queda «sin responsable» al guardar.
- La base exige que ambas columnas sean listas (`jsonb_typeof = 'array'`). La
  pantalla normaliza lo que lee (`participantesDe` / `puntosDe`): descarta
  entradas sin nombre o sin título y completa ids que falten.
- Las notas anteriores a la migración conservan su `contenido` (ahora
  «objetivo») y toman como fecha de reunión el día en que se escribieron.

## Fotos (20261112000000)

- `notas_admin.fotos text[] NOT NULL DEFAULT '{}'`, con CHECK de máximo 10.
  Guarda rutas del bucket privado `condominios-media`
  (`<project_id>/minutas/<archivo>.jpg`), no URLs firmadas: `SecureImage` las
  firma al mostrarlas, igual que en contra incendio.
- Ciclo de vida de los archivos:
  - Al **guardar**, las fotos que salieron de la minuta se borran del bucket.
  - Al **cancelar**, se borran las subidas en esa edición que no se guardaron.
  - Al **editar**, quitar una foto ya guardada no borra el archivo hasta
    guardar (`MultiImageUploader` recibe esas rutas en `conservar`).
- El detalle las muestra en galería; la tarjeta de la lista indica cuántas hay;
  la versión impresa sólo dice cuántas hay adjuntas.
