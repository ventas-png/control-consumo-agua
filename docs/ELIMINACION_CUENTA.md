# Eliminación de cuenta por el propio usuario

Qué pasa cuando una persona borra su cuenta desde la app, qué se conserva y cómo
atiende soporte una solicitud que llega por correo. Exigido por App Store Review
5.1.1 (v) y por la política *Account deletion* de Google Play (ver
`docs/PUBLICACION_TIENDAS.md`, bloqueante #1).

## Dónde está

| Vía | Dónde | Qué hace |
| --- | --- | --- |
| App / web, panel de empresa | **Mi perfil → Eliminar mi cuenta** (`src/components/perfil/EliminarCuenta.tsx` dentro de `PerfilSection`) | Borrado inmediato con confirmación en dos pasos |
| App / web, portal de clientes (agua) | **Mi Perfil → Eliminar mi cuenta**, y en la pantalla «sin servicios» | Igual |
| App / web, portal de residentes (condominios) | Enlace **Eliminar mi cuenta** al pie del portal, y en la pantalla «sin unidades» | Igual |
| Sin la app | <https://administratodo.com/eliminar-cuenta> (pre-renderizada e indexable, ES/EN) | Instrucciones + correo a `soporte@administratodo.com`; es la URL que se declara en Play Console |

## El flujo en la app

1. **Previsualización** (`delete-own-account` con `dry_run: true`): el servidor
   evalúa sus compuertas sin borrar nada. Si responde 409 (único propietario con
   equipo), la app muestra ese mensaje y no pide nada más.
2. **Aviso** con las consecuencias (distinto para staff, residente y único
   propietario).
3. **Formulario**: contraseña actual (sólo cuentas con contraseña; las de Google
   no la tienen) verificada con `signInWithPassword`, y la palabra `ELIMINAR`.
4. **Borrado** (`delete-own-account` con `confirm: 'ELIMINAR'`) y salida: se
   limpia el rastro local (sesión, React Query, caché del SW) y se recarga en `/`.

## Reglas del servidor (`supabase/functions/delete-own-account/validate.ts`)

| Quién | Resultado |
| --- | --- |
| Superadministrador | **403.** Lo elimina otro superadministrador con `delete-user`. |
| Propietario con **otro propietario activo** | Se borra; la empresa sigue. |
| **Único propietario** con más usuarios activos (administradores, operadores…) | **409** con el remedio: desactivar/eliminar a esos usuarios en *Empresa › Usuarios* (entonces la empresa se suspende con él) o pedir a soporte la transferencia de la propiedad. |
| **Único propietario** y solo | Se borra y la empresa queda **suspendida** (`companies.activa=false`, `suspended_at=now`, `suspended_reason` lo dice). Si tiene suscripción Stripe viva se cancela **antes** (sin `STRIPE_PLATFORM_SECRET_KEY` → 503 y no se toca nada). La empresa entra en el periodo de gracia y después el superadministrador la purga con `delete-company` (`docs/PURGA_EMPRESA.md`). |
| Resto del staff | Se borra. |
| Cuenta de portal (`cliente`) | Se borra la cuenta; la fila de `clientes` (el expediente que la empresa tiene del residente) **no**. |
| Sesión sin fila en `app_users` (login huérfano) | Se borra el acceso en `auth`. |

Orden de escritura: Stripe → suspender empresa → `user_roles` → rol de ajustes
(`roles.user_override_for`) → `app_users` → `auth.admin.deleteUser` → auditoría.
Un fallo a medias deja siempre un estado recuperable por el superadministrador
(una empresa suspendida con su propietario vivo se reactiva; lo contrario sería
una empresa sin principal).

## Qué se borra y qué se conserva

- **Se borra**: la identidad en `auth` (y con ella sesiones, `user_notifications`,
  `notification_preferences` y lo que cuelga de `auth.users` con `CASCADE`), la
  fila de `app_users`, `user_roles` y el rol de ajustes individuales.
- **Se conserva, desvinculado**: todo registro de la empresa que apuntaba al
  usuario como autor (`created_by`, `verified_by`, `asignado_a`…) queda con el
  vínculo en `NULL` por FK (`20260522000009_user_hard_delete_fk_set_null.sql`).
  Lecturas, pagos, pólizas, tickets y documentos firmados son de la empresa y se
  conservan por obligación contable y fiscal. Los textos que llevan un nombre
  impreso (actas, acuses, cartas) no se reescriben.
- **Se conserva como evidencia**: `legal_acceptances` (`SET NULL`),
  `permission_audit_log` (`action = 'user_deleted'`, `details.self_service = true`,
  sin `actor_id`) y `security_logs` (`event_type = 'account_deleted'`, con IP y
  user-agent).
- **La fila de `clientes`** es un dato de la empresa (responsable del
  tratamiento). La persona puede pedirle a la empresa su supresión; la página
  pública lo explica.

## Solicitudes por correo (soporte)

1. Verificar que el correo llega **desde la dirección registrada**. Si no,
   pedir que escriban desde ella (o una verificación equivalente). Nunca borrar
   sin esa confirmación.
2. Acusar recibo en ≤ 5 días hábiles; completar en ≤ 30 días (plazos que
   promete la página pública).
3. Si la persona puede entrar, la vía más limpia es que lo haga ella desde
   *Mi perfil*. Si no, el superadministrador elimina al usuario con `delete-user`
   (puede borrar a cualquiera) desde el panel de superadministrador. Para un
   **único propietario**, suspender además la empresa como en la regla de arriba
   (y cancelar su suscripción en Stripe) antes de borrarlo.
4. Confirmar por correo cuando esté hecho.

## Pruebas

- `supabase/functions/delete-own-account/__tests__/validate.test.ts`: compuertas,
  cuerpo, conteo del resto de la empresa, filas de auditoría y paridad con
  `delete-user` / `delete-company`.
- `supabase/functions/delete-own-account/__tests__/handler.test.ts`: el handler
  completo con los dos clientes falsos (orden de escritura, Stripe, fallos a
  medias, `dry_run` sin efectos).
- `src/domain/auth/__tests__/deleteOwnAccount.test.ts` y
  `src/components/perfil/__tests__/EliminarCuenta.test.tsx`: el contrato del
  dominio y el flujo de la pantalla.
