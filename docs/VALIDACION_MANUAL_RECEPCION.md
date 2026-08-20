# Validación manual del motor de recepción (preview)

Qué comprobar a mano en el preview de Vercel antes de sacar el PR #776 de draft.

## Por qué existe esta lista

Lo automatizado cubre mucho, pero hay tres huecos que ninguna suite de este
repositorio puede tapar, y conviene tenerlos escritos en vez de asumirlos:

- **E2E es un no-op.** El job `E2E (caminos de dinero/auth)` sale verde sin
  ejecutar nada mientras `E2E_BASE_URL` esté vacío. No hay ningún recorrido de
  navegador verificado sobre este cambio — ni aquí ni en `main`.
- **Los sandboxes de Postgres prueban las reglas, no la pantalla.** Verifican
  policies, RPC y constraints contra un Postgres real, pero no que el formulario
  mande lo que debe ni que la bandeja muestre lo que corresponde.
- **Los canales externos no se tocan en ninguna prueba.** Gmail, Meta y Twilio
  están doblados en todo el árbol de tests.

Cada punto dice qué se espera **y** qué significaría verlo fallar.

---

## 0. Preparación

Necesitás, en el preview:

- dos empresas distintas, cada una con al menos un proyecto y una unidad con
  residente asociado;
- cuatro sesiones de la **misma** empresa: operador con permiso sólo de
  paquetería, operador con permiso sólo de correspondencia, un `admin` y el
  `company_owner`;
- una sesión de la **otra** empresa.

Son los mismos perfiles que siembra `scripts/seed-rls-sandbox.mjs` para el
harness. Si ya corriste el seed contra el sandbox, podés reutilizar esas cuentas
apuntando el preview a ese proyecto.

---

## 1. Registrar un paquete

Como **operador de paquetería**, en Condominios → Paquetería:

- [ ] Se crea con unidad, tipo y descripción, y aparece en la bandeja.
- [ ] Doble clic rápido en «Guardar» crea **una sola** pieza.
      *Si crea dos, el candado de `crearRegistrador()` no está cerrando el
      formulario antes de disparar el aviso.*
- [ ] Una pieza **saliente** no ofrece «avisar» y no aparece como pendiente de
      retiro en el portal del residente.

## 2. Registrar correspondencia

Como **operador de correspondencia**, en Condominios → Correspondencia:

- [ ] Se crea dirigida a una **unidad** y también a la **administración** (esta
      última sin unidad: es el caso que el CHECK permite sólo para esa clase).
- [ ] Una notificación legal admite adjuntar foto del sobre.
- [ ] La bandeja unificada muestra piezas de las dos clases **sólo** si la
      sesión tiene los dos permisos.

## 3. Permisos PAQ / CORR — el punto central

Con las dos sesiones granulares abiertas en paralelo:

- [ ] El de **paquetería no ve** ninguna correspondencia en la bandeja.
- [ ] El de **correspondencia no ve** ningún paquete.
- [ ] Ninguno de los dos puede crear en la clase ajena.
- [ ] Ninguno puede **cambiar la clase** de una pieza existente.
- [ ] El **admin** puede borrar un paquete pero **no** una correspondencia.
      *Es el caso que más importa: mismo tenant, permiso efectivo sobre todo, y
      aun así una notificación legal no la destruye un admin.*
- [ ] El **company_owner** sí puede borrar la correspondencia.

*Cualquier fuga aquí significa que el `CASE clase` de las policies no está
resolviendo por fila.*

## 4. Aviso y reintento

Como operador con el permiso de la clase:

- [ ] «Avisar» sobre una pieza entrante produce el correo / WhatsApp / aviso
      in-app según lo que tenga configurado el residente.
- [ ] Volver a pulsar «Avisar» sobre la misma pieza **no manda un segundo
      aviso**: responde que ya estaba notificada.
- [ ] Si el envío falla (por ejemplo, con el residente sin correo ni teléfono),
      la pieza **no** queda marcada como notificada y el reintento vuelve a
      intentarlo.
      *Sellar un fallo transitorio pierde el aviso para siempre.*
- [ ] Con la sesión de **paquetería**, invocar el aviso de una **correspondencia**
      responde 403.
      *Si respondiera 200, la autorización de `notify-package` no está
      preguntando a la base.*
- [ ] Un aviso lanzado dos veces casi a la vez (dos pestañas) produce **un solo**
      envío.

## 5. Entrega con firma

Como operador de correspondencia, sobre una pieza pendiente:

- [ ] El acuse **exige el nombre de quien recibe**, y no viene prerrellenado con
      el destinatario del sobre.
- [ ] Se puede cerrar **sin** firma (sólo con el nombre) y **con** firma.
- [ ] Pide confirmación antes de cerrar la custodia.
- [ ] Subir como firma un archivo que no sea JPEG/PNG/WebP se rechaza.
- [ ] Una vez entregada, la pieza **no se puede reabrir** ni editar el nombre,
      la hora, la vía ni la firma.
- [ ] Si el acuse falla, la firma subida **no queda huérfana** en el bucket.

## 6. Aislamiento entre empresas

Con la sesión de la **otra empresa**:

- [ ] No ve ninguna pieza de la primera, de ninguna clase.
- [ ] Con el id de una pieza ajena, ni el acuse ni el aviso funcionan.
- [ ] No puede abrir la evidencia (firma o foto) de una pieza ajena por URL
      directa del bucket.

Y con un **residente**:

- [ ] Ve sus propias piezas y **no** las de la unidad vecina.
- [ ] No ve la correspondencia dirigida a la administración.

---

## Qué NO cubre esta lista

- El despliegue a producción. El orden migraciones → funciones lo garantiza la
  compuerta de `deploy-functions.yml`; lo que hay que mirar tras el merge es que
  `apply-migrations-prod` termine en verde **antes** de que arranque el deploy
  de funciones, y que el resumen de la compuerta lo diga.
- Rendimiento de la bandeja con muchos registros.
- Los proveedores externos en condiciones reales de error (rate limit de Meta,
  cuota de Gmail). El código los acota con un plazo de 15 s por llamada, pero eso
  no se ha ejercitado contra los servicios de verdad.
