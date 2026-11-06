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
- **Nueva / editar** en ventana, en cuatro pasos (`minutas/MinutaWizard.tsx`):
  1. **Participantes** — título, fecha, objetivo; quien la abre entra como
     gestor (★) —como miembro del **equipo del proyecto**, con su cuenta y su
     rol— y se puede cambiar con «Hacer gestor». Se agregan desde cinco
     listas: **equipo del proyecto** (las cuentas activas de la empresa con
     acceso al proyecto, por el RPC `minutas_equipo_proyecto`; ver abajo),
     **empleados** (`personal` activo, con el nombre del cargo del
     catálogo RRHH), **propietarios/inquilinos** (`unidad_residentes` del
     proyecto con su rol, más el dueño registrado en la unidad y el arrendatario
     del contrato vigente cuando la unidad no los tiene como residentes),
     **proveedores** (catálogo compartido de la empresa, sin vetados, más los
     contratos de proveedor del condominio) y **otro** por nombre.
  2. **Puntos** — los temas a abordar, numerados, con detalle opcional.
  3. **Acuerdos** — por cada punto, *acuerdos* (lo decidido) y *compromisos*
     (responsable entre los participantes y fecha límite). Cierre: categoría,
     prioridad, próximo seguimiento y fijar.
  4. **Firmas** — cada participante firma que acepta los acuerdos y
     compromisos: ve lo que firma, marca la declaración de aceptación y firma
     en el recuadro. Es opcional: quien no esté firma después desde el detalle.

  En el paso 3 también se adjuntan **fotos** (hasta 10: hoja de asistencia,
  pizarrón, lo revisado en sitio) y **documentos** (hasta 10: PDF, Word o
  Excel, como la cotización o el contrato que se revisó).

  Cada paso valida lo suyo antes de avanzar (título, fecha, al menos un
  participante y un gestor; al menos un punto; fechas válidas). La lógica está
  en `src/domain/condominios/minutas.ts`.

## Guardar el avance y retomar (20261121000000)

Una reunión se captura en varias sentadas, o se interrumpe. Por eso cada paso
del asistente tiene **«💾 Guardar avance»**, además de «Siguiente»:

- Guarda lo que hay con `notas_admin.borrador_paso` = el paso actual (1–4). La
  primera vez **crea la fila** (`createCondominioRowReturning`, para quedarse con
  el id) y el asistente **sigue abierto sobre esa fila**: desde entonces edita,
  no crea, y «Cancelar» pasa a decir «Cerrar» (lo guardado no se pierde).
- Lo mínimo para guardar el avance (`validarAvanceMinuta`) es lo del paso 1
  —título, fecha, un participante y un gestor— y que ninguna fecha tecleada sea
  inválida. **No exige puntos ni acuerdos**: una reunión recién convocada ya se
  guarda. Si falta algo, el asistente salta al paso donde falta y lo dice.
- **«✅ Guardar minuta» / «Guardar cambios»** exigen los cuatro pasos como
  siempre y dejan `borrador_paso = null`: la minuta terminó el asistente.
- La fila recuerda el paso: la tarjeta de la lista y el detalle muestran
  **«✎ En curso · paso N de 4»** (`minutaEnCurso` / `pasoBorradorDe`; un valor
  fuera de 1–4 o una minuta cerrada no cuentan como en curso), la lista tiene el
  filtro «En curso», el botón del detalle pasa de «Editar» a **«▶ Continuar»**
  y el asistente («Retomar minuta») abre **en ese paso**. Cerrar una minuta en
  curso avisa de que la captura quedó a medias; la impresión lo marca.
- Archivos: tras un «Guardar avance», lo subido después y no guardado se borra
  al cerrar, y lo guardado no (`guardadoRef` toma la lista de cada guardado;
  `originales` sigue siendo lo que la fila tenía al abrir, que es lo que
  `archivosPorBorrar` necesita para borrar lo que se quitó antes del avance).
  Las listas de fotos, documentos y firmas sólo viajan si cambiaron **desde el
  último guardado** (`guardado`), no desde que se abrió.

## El equipo del proyecto (20261121000000)

La administración misma —las cuentas de la empresa asignadas al proyecto— no
salía de ninguna lista. `app_users_select` sólo deja enumerar la empresa a
company_owner/admin, así que, como en Personal y Rutas, la lista es un RPC:

- `minutas_equipo_proyecto(p_project_id)` → `(id, full_name, role)`: cuentas
  **activas** de la empresa del proyecto que lo ven (`usuario_acceso_a_proyecto`:
  rol exento, `project_id` legacy o asignación explícita), sin `cliente`. Exige
  empresa del proyecto, la clave de visibilidad del tab
  (`condominios.tab.notas_admin`) y acceso del llamador al proyecto;
  SECURITY DEFINER, `search_path = ''`, EXECUTE sólo a `authenticated`.
- En la minuta el participante lleva `tipo: 'equipo'`, `ref_id` =
  `app_users.id` y como `detalle` la etiqueta del rol (`etiquetaRolEquipo`: las
  mismas del chip del encabezado, «Admin Empresa», «Administrador»…). `yaParticipa`
  lo reconoce por cuenta aunque el nombre haya cambiado. Un cliente viejo que no
  conozca el tipo lo lee como «otro» (`participantesDe`).
- Si el RPC falla, la lista lo dice (`role="alert"`) sin ocultar las demás; si
  nadie tiene acceso, manda a Empresa › Usuarios › Asignar proyectos.

## Forma de los JSON

```jsonc
// notas_admin.participantes
[
  { "id": "uuid", "tipo": "empleado",   // equipo | empleado | residente | proveedor | otro
    "ref_id": "app_users.id | personal.id | unidad_residentes.id | proveedores.id | null",
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

## Fotos y documentos (20261112000000 · 20261112000100)

- `notas_admin.fotos text[]` y `notas_admin.documentos text[]`, ambas
  `NOT NULL DEFAULT '{}'` con CHECK de máximo 10. Guardan rutas del bucket
  privado `condominios-media` (`<project_id>/minutas/<archivo>`), no URLs
  firmadas: `SecureImage` y `SecureFileLink` las firman al mostrarlas. El bucket
  acepta PDF, Word, Excel y PowerPoint hasta 10 MB.
- Ciclo de vida de los archivos. La regla: **una minuta nunca apunta a un
  archivo borrado**. Los uploaders no borran nada al quitar
  (`borrarAlQuitar={false}`); el asistente lleva la cuenta de toda ruta que pasó
  por las listas en esa edición y decide al desmontarse
  (`archivosPorBorrar`):
  - **Guardada**: se borra lo que estuvo (antes o en esta edición) y ya no está
    en la fila. Al editar se usa `updateCondominioRowAfectando`: si la política
    de filas no deja tocar la fila, no se borra nada.
  - **Sin guardar** (Cancelar, Esc, el fondo, o el «Atrás» del sistema, que
    cambia de pestaña sin pasar por el botón): se borra sólo lo subido en esta
    edición, aunque ya se hubiera quitado de la lista. Lo guardado sigue
    referenciado por la fila.
  - **Subiendo**: mientras haya una subida en curso (`onSubiendo`) no se puede
    guardar ni cerrar. Si una subida termina con el asistente ya desmontado, el
    archivo se borra al llegar.
  - **Eliminar** la minuta borra sus fotos y documentos, sólo si la fila se
    borró de verdad (`deleteCondominioRowAfectando`).
  - Al editar, `fotos` y `documentos` sólo viajan en el UPDATE si cambiaron: una
    pestaña abierta desde antes que sólo corrige el título no revive un archivo
    que otra sesión ya quitó y borró.
- El detalle muestra las fotos en galería (miniaturas con nombre, navegables con
  teclado; Escape cierra sólo la foto) y los documentos como enlaces firmados;
  la tarjeta de la lista cuenta unas (📷) y otros (📎); la versión impresa dice
  cuántas fotos hay y nombra los documentos.

## Firmas (20261120000000)

- `notas_admin.firmas jsonb NOT NULL DEFAULT '[]'` (CHECK de lista), una
  entrada por participante que firmó:

  ```jsonc
  { "participante_id": "<participantes[].id>", "nombre": "Carlos Guardia",
    "path": "<project_id>/minutas-firmas/<archivo>.png",
    "firmado_at": "2026-11-02T15:04:05.000Z", "version": "<huella>" }
  ```

  La firma es un PNG (el `SignaturePad` compartido) en el bucket privado
  `condominios-media`; la fila guarda la ruta, no una URL firmada.
- **Qué se firma.** `version` es `versionAcuerdos(puntos, participantes)`: una
  huella de los puntos con sus acuerdos y compromisos (texto, responsable y
  fecha límite). Marcar un compromiso cumplido no la cambia. Si alguien edita
  lo acordado después, las firmas existentes se muestran como «firmó una versión
  anterior de los acuerdos» —no se borran ni se dan por vigentes— y el detalle
  vuelve a ofrecer firmar. El paso 3 avisa cuando la minuta ya tiene firmas.
- **Dónde se firma.** En el paso 4 del asistente (la firma se guarda con la
  minuta) o en el detalle, para quien falte: ahí se sube y se registra en el
  acto (`registrarFirmaMinuta`, que relee las firmas de la fila para no pisar
  la de otro dispositivo y exige que el UPDATE cambie la fila). Una minuta
  cerrada no ofrece firmar.
- **Editar no pisa firmas ajenas.** Si el asistente cambió las firmas, al
  guardar relee las de la fila y aplica encima sólo lo que esta edición cambió,
  participante por participante (`fusionarFirmas`): una firma registrada desde
  el detalle mientras el asistente estaba abierto se conserva, y una imagen que
  el detalle ya reemplazó no vuelve a citarse.
- **Límite conocido.** Dos firmas registradas desde el detalle en dos
  dispositivos dentro de la misma ida y vuelta de red pueden pisarse (lectura y
  escritura no son atómicas). La pérdida se ve: esa persona vuelve a figurar
  como pendiente.
- **Archivos.** Las imágenes siguen el ciclo de vida de fotos y documentos: una
  firma subida y no guardada se borra al cerrar el asistente; la de un
  participante que se quitó, o la reemplazada al volver a firmar, se borra al
  guardar; eliminar la minuta borra sus firmas; si el registro desde el detalle
  falla, la imagen recién subida se borra. Sólo se borran rutas de la carpeta
  del proyecto de la minuta (`rutasDelProyecto`), también para fotos y
  documentos: una ruta manipulada en la fila no arrastra archivos ajenos.
- El detalle muestra «Firmas (vigentes de total)» con la imagen y la hora de
  cada una; la tarjeta de la lista cuenta «✍ n/m»; cerrar la minuta avisa de
  las firmas pendientes; la impresión trae una sección de firmas con la imagen
  de quien firmó (bajada del bucket e incrustada) y la línea de quien falta.
