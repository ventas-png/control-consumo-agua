// Contenido legal de AdministraTodo (administratodo.com), transcrito fielmente de los
// documentos oficiales VFinal-2026. El CONTENIDO vive aquí (front público); el catálogo
// versionado + el rastro de aceptación viven en la BD (legal_documents / legal_acceptances).
//
// Bilingüe (es/en). El español es la versión VINCULANTE (jurisdicción LATAM); el inglés es
// una traducción DE CORTESÍA (la nota la añade LegalPage cuando lang === 'en'). El idioma se
// resuelve por el query param ?lang (default es) — ver App.tsx y LegalPage.

import type { ReactElement } from 'react'
import type { Lang } from '../landing/i18n'

export type LegalDocType = 'privacy' | 'tos' | 'dpa'

/** Rutas públicas canónicas de cada documento (footer, click-wrap, sitemap, enlaces cruzados). */
export const LEGAL_PATHS: Record<LegalDocType, string> = {
  privacy: '/politica-privacidad',
  tos: '/terminos-servicio',
  dpa: '/acuerdo-dpa-cookies',
}

/** Enlace interno preservando el idioma (los enlaces EN llevan ?lang=en). */
export function legalHref(doc: LegalDocType, lang: Lang): string {
  return lang === 'en' ? `${LEGAL_PATHS[doc]}?lang=en` : LEGAL_PATHS[doc]
}

export interface LegalDocMeta {
  title: string
  metaTitle: string
  metaDescription: string
  updated: string
}

export const LEGAL_META: Record<Lang, Record<LegalDocType, LegalDocMeta>> = {
  es: {
    privacy: {
      title: 'Política de Privacidad',
      metaTitle: 'Política de Privacidad | AdministraTodo',
      metaDescription:
        'Política de Privacidad de administratodo.com: cómo recopilamos, tratamos y protegemos tus datos personales conforme al RGPD, la CCPA/CPRA y las normativas de protección de datos de América Latina.',
      updated: 'Última actualización: 7 de agosto de 2026',
    },
    tos: {
      title: 'Términos de Servicio',
      metaTitle: 'Términos de Servicio | AdministraTodo',
      metaDescription:
        'Términos de Servicio de administratodo.com: condiciones del software SaaS multiempresa y multiproyecto, suscripciones, pagos recurrentes, propiedad de los datos y resolución de disputas en LATAM.',
      updated: 'Última actualización: 4 de junio de 2026',
    },
    dpa: {
      title: 'Anexo DPA y Política de Cookies',
      metaTitle: 'Anexo DPA y Política de Cookies | AdministraTodo',
      metaDescription:
        'Anexo de Procesamiento de Datos (DPA) y Política de Cookies de administratodo.com: roles de responsable y encargado del tratamiento, subprocesadores, medidas de seguridad y gestión de cookies conforme al RGPD.',
      updated: 'Última actualización: 7 de agosto de 2026',
    },
  },
  en: {
    privacy: {
      title: 'Privacy Policy',
      metaTitle: 'Privacy Policy | AdministraTodo',
      metaDescription:
        'administratodo.com Privacy Policy: how we collect, process and protect your personal data in line with the GDPR, the CCPA/CPRA and Latin American data-protection laws.',
      updated: 'Last updated: August 7, 2026',
    },
    tos: {
      title: 'Terms of Service',
      metaTitle: 'Terms of Service | AdministraTodo',
      metaDescription:
        'administratodo.com Terms of Service: terms of the multi-company, multi-project SaaS, subscriptions, recurring payments, data ownership and dispute resolution in LATAM.',
      updated: 'Last updated: June 4, 2026',
    },
    dpa: {
      title: 'DPA & Cookie Policy',
      metaTitle: 'DPA & Cookie Policy | AdministraTodo',
      metaDescription:
        'administratodo.com Data Processing Addendum (DPA) and Cookie Policy: controller/processor roles, sub-processors, security measures and cookie management under the GDPR.',
      updated: 'Last updated: August 7, 2026',
    },
  },
}

const SUPPORT_EMAIL = 'soporte@administratodo.com'

function Mail() {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
}

// ════════════════════════════════════════════════════════════════════════════
// ESPAÑOL (versión vinculante)
// ════════════════════════════════════════════════════════════════════════════

function PrivacyBodyEs(): ReactElement {
  return (
    <>
      <p>
        En administratodo.com (en adelante, «la Plataforma», «el SaaS» o «Nosotros»), nos comprometemos
        firmemente a proteger la privacidad, confidencialidad y seguridad de los datos personales de
        nuestros usuarios. Esta Política de Privacidad constituye un todo integrado con nuestros{' '}
        <a href={LEGAL_PATHS.tos}>Términos de Servicio</a> y el{' '}
        <a href={LEGAL_PATHS.dpa}>Anexo de Procesamiento de Datos (DPA)</a>, diseñados bajo los
        estándares internacionales más exigentes, incluyendo el Reglamento General de Protección de
        Datos (RGPD), la Ley de Privacidad del Consumidor de California (CCPA/CPRA) y las normativas de
        protección de datos vigentes en América Latina.
      </p>
      <p>
        Este documento es una pieza fundamental para la transparencia operativa y los procesos de
        verificación de plataformas globales de terceros, incluyendo la autorización de aplicaciones de
        Google.
      </p>

      <h2>1. Flujo de aceptación expresa y vinculación jurídica (Click-wrap)</h2>
      <p>
        Esta Política de Privacidad no es un documento de lectura pasiva. Al registrar una cuenta, dar de
        alta una organización o utilizar los Servicios, el Administrador Principal y cada Usuario
        Autorizado deben aceptar de forma afirmativa este documento mediante una casilla de verificación
        desmarcada por defecto (mecanismo Click-wrap).
      </p>
      <p>
        La Plataforma registrará de forma automatizada e inalterable en sus bases de datos la dirección
        IP de origen, la fecha, la hora exacta y la versión del documento aceptado. Dicho registro
        constituirá prueba legal plena de consentimiento ante entidades bancarias, disputas de
        contracargos, auditorías fiscales y procesos de certificación de tiendas de aplicaciones de
        terceros.
      </p>

      <h2>2. Información que recopilamos</h2>
      <p>
        Para prestar los servicios SaaS multiempresa de manera óptima, recopilamos las siguientes
        categorías de información:
      </p>
      <h3>A. Información proporcionada directamente por el Usuario</h3>
      <ul>
        <li><strong>Datos de registro y cuenta:</strong> nombre, apellidos, dirección de correo electrónico, número de teléfono y credenciales de acceso encriptadas.</li>
        <li><strong>Datos fiscales de facturación local:</strong> razón social, identificaciones fiscales gubernamentales (por ejemplo, NIT en Guatemala, RTU, RUC, RFC o el equivalente en la jurisdicción de LATAM correspondiente) y dirección física de facturación.</li>
        <li><strong>Comunicaciones:</strong> datos enviados a través de formularios de contacto, tickets de soporte técnico o correos electrónicos dirigidos a <Mail />.</li>
      </ul>
      <h3>B. Información recopilada automáticamente</h3>
      <ul>
        <li><strong>Datos de conexión y dispositivo:</strong> dirección IP, tipo de navegador, sistema operativo, identificadores únicos de dispositivos de acceso, configuración de idioma y zona horaria.</li>
        <li><strong>Datos de uso de la infraestructura:</strong> páginas y módulos visitados dentro de la Plataforma, tiempo de permanencia, clics, flujos de navegación e interacciones entre empresas y proyectos.</li>
        <li><strong>Cookies y tecnologías de rastreo:</strong> datos recopilados mediante cookies esenciales, analíticas y funcionales de conformidad con nuestra <a href={LEGAL_PATHS.dpa}>Política de Cookies</a>.</li>
        <li><strong>Métricas de entrega y apertura de correos:</strong> cuando la Plataforma envía correos transaccionales o de difusión en nombre de una empresa administradora, registramos si el mensaje fue entregado, si fue abierto y la fecha y hora de esa apertura. La detección de apertura se realiza mediante una imagen de seguimiento de 1×1 píxel incluida en el cuerpo del mensaje; al cargarla, el cliente de correo del destinatario transmite su dirección IP y los datos técnicos de la petición. Estas métricas se asocian al destinatario del envío. La apertura es una estimación por exceso: algunos proveedores de correo precargan las imágenes automáticamente, lo que puede registrar aperturas que el destinatario no realizó. Si el destinatario configura su cliente de correo para no cargar imágenes, no se registra apertura alguna y la entrega del mensaje no se ve afectada.</li>
      </ul>

      <h2>3. Finalidades y base legal del tratamiento de datos</h2>
      <p>
        Tratamos los datos personales únicamente cuando contamos con una base legal válida de acuerdo con
        los estándares internacionales de privacidad, detallados a continuación:
      </p>
      <div className="legal-table-wrap">
        <table>
          <thead>
            <tr><th>Finalidad del tratamiento</th><th>Descripción detallada</th><th>Base legal aplicable</th></tr>
          </thead>
          <tbody>
            <tr><td>Prestación del Servicio SaaS</td><td>Gestionar las cuentas de usuario, permitir el funcionamiento del entorno multiempresa y multiproyecto, proveer soporte técnico y procesar las transacciones financieras recurrentes.</td><td>Ejecución de un contrato</td></tr>
            <tr><td>Cumplimiento tributario en LATAM</td><td>Procesar la información fiscal requerida para la emisión de facturas electrónicas (Régimen FEL, CFDI o equivalentes regionales) por los cobros de la suscripción.</td><td>Obligación legal</td></tr>
            <tr><td>Mejora de la infraestructura</td><td>Analizar estadísticas agregadas de uso para optimizar el rendimiento de la Plataforma, corregir errores y desarrollar nuevas herramientas administrativas.</td><td>Interés legítimo</td></tr>
            <tr><td>Seguridad de la Plataforma</td><td>Prevenir fraudes informáticos, mitigar ataques cibernéticos, detectar disputas financieras maliciosas y garantizar la integridad de las bases de datos.</td><td>Interés legítimo / Obligación legal</td></tr>
            <tr><td>Comunicaciones de servicio</td><td>Enviar notificaciones técnicas sobre el estado del sistema, alertas del dunning process por transacciones declinadas y actualizaciones legales de la Plataforma.</td><td>Ejecución de un contrato</td></tr>
          </tbody>
        </table>
      </div>

      <h2>4. Uso de servicios de terceros y autorización de Google</h2>
      <p>
        Para ofrecer un entorno de software de alta disponibilidad, la Plataforma integra componentes y
        APIs de proveedores tecnológicos líderes a nivel mundial y regional, lo que implica
        transferencias internacionales y procesamiento por parte de terceros:
      </p>
      <h3>A. Integración con ecosistemas y APIs de Google</h3>
      <ul>
        <li><strong>Google Workspace / Gmail API:</strong> utilizado estrictamente para la gestión, sincronización y envío automatizado de correos electrónicos transaccionales, alertas de facturación y notificaciones de flujos de trabajo generadas por el usuario. El uso de la información recibida a través de las APIs de Google se apegará estrictamente a la Política de Datos de Usuario de los Servicios de API de Google, incluyendo los requisitos de Uso Limitado (Limited Use).</li>
        <li><strong>Google Analytics:</strong> herramienta de análisis web para evaluar el uso de la interfaz, generar métricas de rendimiento del software y comprender el comportamiento de los usuarios de forma agregada y anonimizada.</li>
        <li><strong>Google Maps API:</strong> utilizado para funciones geográficas, localización de proyectos y validación cartográfica de direcciones dentro de los módulos de administración.</li>
      </ul>
      <p>
        <strong>Uso Compartido, Transferencia y Divulgación de Datos de Google:</strong> administratodo.com no
        vende, alquila, transfiere ni comparte los datos de los usuarios obtenidos a través de las APIs de Google
        con terceras empresas u organizaciones con fines comerciales, publicitarios o de marketing. La información
        de los usuarios de Google se utiliza única y exclusivamente para habilitar las funciones internas
        contratadas por el propio Cliente (como la sincronización de comunicaciones del Administrador). Dichos datos
        no serán divulgados a ningún tercero, a excepción de: (i) El propio Cliente corporativo que autorizó el
        acceso para su gestión interna, y (ii) Cuando sea estrictamente requerido por una orden judicial, un juez
        competente o una institución gubernamental amparada bajo la legislación local aplicable.
      </p>
      <h3>B. Pasarelas de pago y adquirencia segura (PCI-DSS)</h3>
      <p>
        Con el fin de garantizar la seguridad transaccional, administratodo.com utiliza proveedores
        externos especializados. La Plataforma no almacena ni procesa datos completos de tarjetas de
        crédito o débito en sus servidores. Toda la información financiera viaja cifrada directamente a:
      </p>
      <ul>
        <li><strong>Stripe y PayPal:</strong> procesadores globales bajo certificación PCI-DSS, cuyos servidores pueden estar ubicados en Estados Unidos y Europa.</li>
        <li><strong>QPayPro, NeoNet (VisaNet Guatemala) y BAC Credomatic:</strong> pasarelas adquirentes regionales que gestionan los cobros locales en Centroamérica y LATAM, procesando los flujos de cobro recurrente bajo las regulaciones bancarias de cada país.</li>
      </ul>

      <h2>5. Descargo de responsabilidad para contenido general del usuario (Data Ownership)</h2>
      <p>
        administratodo.com opera exclusivamente como una plataforma de infraestructura en la nube para la
        gestión administrativa. El Cliente actúa como dueño y «Responsable» absoluto de cualquier
        información, archivo, documento digital, factura, contrato o dato personal de terceros
        (empleados, proveedores o sus propios clientes) que ingrese o aloje en sus módulos multiempresa y
        multiproyecto.
      </p>
      <p>
        La Plataforma funciona únicamente como «Encargado del Tratamiento» técnico de dichos datos. En
        consecuencia, administratodo.com queda totalmente exonerado de cualquier responsabilidad legal,
        civil, penal o administrativa derivada de la licitud, veracidad, propiedad intelectual o
        violaciones a la privacidad de los documentos y datos cargados por los usuarios en su entorno
        corporativo. El Cliente se obliga a mantener indemne a la Plataforma frente a cualquier
        reclamación de terceros.
      </p>

      <h2>6. Período de retención de los datos</h2>
      <p>Conservaremos los datos personales únicamente durante el tiempo estrictamente necesario para cumplir con las finalidades contractuales y las obligaciones legales aplicables:</p>
      <ul>
        <li>Los datos de la cuenta activa se mantendrán vigentes mientras el Cliente no solicite la baja voluntaria del servicio o la rescisión del Acuerdo Principal.</li>
        <li>Los datos contenidos en entornos suspendidos por impago serán resguardados por un plazo máximo de treinta (30) días calendario para garantizar la portabilidad del Cliente, procediendo luego a su eliminación definitiva de los servidores de producción.</li>
        <li>Los registros contables y de facturación fiscal electrónica emitidos se conservarán durante los plazos mínimos obligatorios exigidos por las administraciones tributarias locales de LATAM (generalmente entre 5 y 10 años).</li>
      </ul>

      <h2>7. Derechos del usuario (Derechos ARCO)</h2>
      <p>
        Independientemente de su ubicación en LATAM, garantizamos a los titulares de los datos el
        ejercicio de sus derechos de Acceso, Rectificación, Cancelación y Oposición (ARCO). El usuario
        podrá solicitar la ejecución de estos derechos configurando directamente su perfil de usuario o
        enviando un correo electrónico formal a <Mail /> adjuntando una identificación que valide su
        identidad como titular.
      </p>

      <h2>8. Modificaciones a esta Política</h2>
      <p>
        Nos reservamos el derecho de actualizar esta Política de Privacidad en cualquier momento para
        adaptarla a mejoras técnicas en el SaaS o a cambios legislativos en la región de Latinoamérica.
        Cualquier modificación será publicada en esta sección y notificada al Administrador Principal por
        los canales internos del sistema.
      </p>
    </>
  )
}

function TosBodyEs(): ReactElement {
  return (
    <>
      <p>
        Bienvenido a administratodo.com (en adelante, «la Plataforma», «el SaaS» o «Nosotros»). Estos
        Términos de Servicio (en adelante, los «Términos») constituyen un acuerdo legal, vinculante y
        exigible entre administratodo.com y la persona física o jurídica que contrata, accede o utiliza
        nuestros servicios de software bajo demanda (en adelante, el «Cliente» o el «Usuario»).
      </p>
      <p>
        Al registrarse, activar una cuenta corporativa o utilizar la Plataforma, usted acepta cumplir y
        estar sujeto a estos Términos en su totalidad. Si está celebrando este acuerdo en nombre de una
        empresa u otra entidad legal, usted declara tener la autoridad legal para vincular a dicha entidad
        a estos Términos.
      </p>

      <h2>1. Naturaleza del servicio SaaS y licencia de uso</h2>
      <p>administratodo.com opera exclusivamente como un software de distribución en la nube (Software as a Service - SaaS). Sujeto al cumplimiento estricto de estos Términos y al pago puntual de las tarifas correspondientes, otorgamos al Cliente una licencia limitada, no exclusiva, no transferible, revocable y global para acceder y utilizar la Plataforma para sus operaciones comerciales internas.</p>
      <p>Esta licencia no constituye una venta del software. El Cliente no adquiere ningún derecho de propiedad intelectual sobre el código fuente, la arquitectura, el diseño, los algoritmos o las marcas de la Plataforma.</p>

      <h2>2. Arquitectura de cuentas: entorno multiempresa y multiproyecto</h2>
      <p>La Plataforma cuenta con una estructura técnica avanzada diseñada para la gestión consolidada de múltiples unidades de negocio independientes. El Cliente comprende y acepta las siguientes reglas operativas sobre este ecosistema:</p>
      <ul>
        <li><strong>Cuenta del Administrador Principal (Tenant):</strong> es el titular legal del contrato y de la suscripción de pago. Tiene el control total del entorno contratado y es el único responsable legal de todas las actividades realizadas dentro del mismo.</li>
        <li><strong>Módulos Multiempresa:</strong> el Cliente puede dar de alta diferentes razones sociales, filiales, sucursales o marcas (cada una denominada «Empresa») bajo una misma cuenta centralizada, según los límites de su plan contratado. El Cliente es responsable de segregar correctamente los accesos y asegurar que cada Empresa cumpla con la normativa contable, comercial y fiscal de su respectiva jurisdicción.</li>
        <li><strong>Gestión de Multiproyectos:</strong> dentro de cada Empresa, la Plataforma permite estructurar flujos de trabajo, presupuestos, inventarios y cronogramas segregados por proyectos (cada uno denominado «Proyecto»). La eliminación, archivo o alteración de datos de un Proyecto específico es responsabilidad exclusiva del Usuario asignado.</li>
      </ul>

      <h2>3. Control de accesos, usuarios autorizados y roles</h2>
      <p>El Administrador Principal puede invitar a terceros (empleados, contadores externos, asesores, socios comerciales) a formar parte de su entorno como «Usuarios Autorizados».</p>
      <ul>
        <li><strong>Asignación de roles y permisos:</strong> es responsabilidad exclusiva del Cliente configurar, auditar y restringir los roles (ej. Administrador, Editor, Lector, Auditor) para cada Usuario Autorizado dentro de cada Empresa o Proyecto específico. administratodo.com no se hace responsable por fugas de información, borrado de datos o transacciones erróneas derivadas de una mala asignación de permisos por parte del Cliente o sus administradores.</li>
        <li><strong>Confidencialidad de credenciales:</strong> cada cuenta de usuario es personal e intransferible. Queda prohibido compartir credenciales entre colaboradores. El Cliente debe notificar inmediatamente a <Mail /> cualquier sospecha de violación de seguridad o acceso no autorizado.</li>
      </ul>

      <h2>4. Modelos de suscripción, planes y regulación de precios</h2>
      <p>El acceso a la Plataforma se rige por planes de suscripción basados en la recurrencia y la escalabilidad del negocio del Cliente.</p>
      <h3>A. Métricas de facturación (tarificación por consumo o capacidad)</h3>
      <p>Los precios de los planes se estructuran de forma modular según las siguientes variables del entorno SaaS:</p>
      <ul>
        <li>Número total de Empresas dadas de alta en el sistema.</li>
        <li>Número de Proyectos concurrentes o archivados.</li>
        <li>Volumen de Usuarios Autorizados interactuando en el sistema.</li>
        <li>Capacidad de almacenamiento en la nube consumida.</li>
      </ul>
      <h3>B. Ajustes de precios e inflación en mercados de LATAM</h3>
      <p>Siguiendo estándares internacionales de plataformas multinacionales, administratodo.com se reserva el derecho de ajustar las tarifas de sus planes de suscripción para adaptarlas a las fluctuaciones cambiarias de las monedas locales, inflación regional en América Latina, o mejoras sustanciales en la infraestructura tecnológica. Todo cambio de precio será notificado por correo electrónico al Administrador Principal con un mínimo de treinta (30) días calendario de anticipación. Si el Cliente no acepta el reajuste, tendrá derecho a cancelar su suscripción antes de la próxima fecha de facturación sin penalización alguna.</p>

      <h2>5. Condiciones de pago, recurrencia y adquirencia local (QPayPro / VisaNet / NeoNet / BAC)</h2>
      <p>El procesamiento financiero de los Servicios de administratodo.com se rige bajo estrictas normativas internacionales y de adquirencia local.</p>
      <h3>A. Autorización expresa de cargo recurrente</h3>
      <p>Al registrar una tarjeta de crédito o débito (Visa, Mastercard, American Express, entre otras) en nuestra Plataforma, el Cliente otorga su consentimiento y autorización expresa para que se realicen cargos automáticos y recurrentes en su cuenta bancaria. Los cargos se efectuarán al inicio de cada ciclo de facturación (mensual o anual) por el monto correspondiente al plan contratado y los módulos multiempresa/multiproyecto activos.</p>
      <h3>B. Canales de procesamiento seguro y PCI-DSS</h3>
      <p>Los pagos se procesan de forma externa y segura a través de pasarelas de pago integradas autorizadas: Stripe y PayPal para transacciones internacionales; y QPayPro, NeoNet (VisaNet Guatemala) o BAC Credomatic para el procesamiento financiero local en Centroamérica y LATAM. administratodo.com no recopila, procesa ni almacena datos de tarjetas en servidores propios; toda la información viaja cifrada directamente a los procesadores bajo certificación estándar de seguridad financiera PCI-DSS.</p>
      <h3>C. Política anti-contracargos (chargebacks) y disputas maliciosas</h3>
      <p>Dado que las pasarelas locales (como QPayPro o VisaNet) exigen transparencia absoluta, cualquier intento por parte del Cliente de iniciar un contracargo ante su banco emisor alegando desconocimiento de un cobro recurrente debidamente autorizado será considerado una violación grave a estos Términos. En caso de detectarse una disputa de pago injustificada, administratodo.com procederá a la suspensión inmediata y definitiva de todas las empresas y proyectos asociados a la cuenta, y se reserva el derecho de trasladar al Cliente los costos por penalización aplicados por el banco adquirente.</p>

      <h2>6. Protocolo ante transacciones declinadas y fallos de cobro</h2>
      <p>Para garantizar la estabilidad operativa del SaaS y proteger los datos del Cliente ante problemas imprevistos con sus tarjetas de crédito o débito, se establece el siguiente protocolo automatizado de mitigación:</p>
      <h3>A. Causas de fallo en el cobro</h3>
      <p>El Cliente reconoce que una transacción de cargo recurrente puede ser rechazada o declinada por las pasarelas (QPayPro, VisaNet, Stripe, etc.) debido a:</p>
      <ul>
        <li>Fondos insuficientes en la cuenta de origen.</li>
        <li>Tarjeta de crédito o débito vencida, bloqueada o reportada.</li>
        <li>Restricciones de seguridad por prevención de fraude del banco emisor (bloqueo de transacciones por internet o cargos internacionales).</li>
        <li>Interrupciones técnicas en las redes de comunicación de los bancos adquirentes locales.</li>
      </ul>
      <p>administratodo.com queda eximido de cualquier responsabilidad si las pasarelas de pago no logran procesar el cobro automático debido a las causas antes mencionadas.</p>
      <h3>B. Proceso de reintentos graduales (Dunning Process)</h3>
      <p>En caso de que un cargo recurrente sea declinado, el sistema activará un cronograma de mitigación financiera:</p>
      <ul>
        <li><strong>Día 1 (primer fallo):</strong> se enviará una notificación electrónica inmediata al Administrador Principal indicando el rechazo de la transacción y solicitando la revisión de su método de pago.</li>
        <li><strong>Días 3 y 5:</strong> el sistema realizará reintentos automáticos de cobro a través de las pasarelas integradas. Se enviarán recordatorios adicionales de saldo pendiente.</li>
      </ul>
      <h3>C. Estado de «Solo Lectura» y periodo de gracia</h3>
      <p>Durante un periodo de gracia de siete (7) días calendario contados a partir del primer fallo de cobro, el entorno multiempresa del Cliente permanecerá activo pero se restringirá automáticamente a un Modo de Solo Lectura.</p>
      <p>Bajo este estado, el Cliente y sus Usuarios Autorizados podrán visualizar la información existente de sus proyectos y empresas, pero no podrán realizar modificaciones, registrar nuevas transacciones, emitir documentos fiscales, dar de alta nuevas empresas o proyectos, ni agregar nuevos usuarios.</p>
      <h3>D. Suspensión total y costos de reactivación</h3>
      <p>Transcurrido el período de gracia de siete (7) días sin que se haya podido procesar el cobro con éxito o sin que el Cliente haya registrado una tarjeta válida con fondos, el entorno SaaS será suspendido por completo.</p>
      <p>Para restablecer el servicio, el Cliente deberá liquidar el saldo vencido. administratodo.com se reserva el derecho de aplicar una tarifa administrativa por concepto de reactivación de cuentas suspendidas para cubrir los costos de reindexación en la nube de la infraestructura de sus empresas.</p>
      <h3>E. Exoneración de responsabilidad por pérdidas operativas debido a suspensión</h3>
      <p>El Cliente acepta que la suspensión legítima de la cuenta por falta de pago o transacciones declinadas es su total responsabilidad. administratodo.com no será responsable bajo ninguna circunstancia por daños, perjuicios, pérdidas financieras, multas fiscales de entidades gubernamentales de LATAM, o retrasos en proyectos que sufra el Cliente, sus Empresas afiliadas o sus propios clientes finales a causa de la pérdida de acceso al software provocada por la suspensión del servicio.</p>

      <h2>7. Tratamiento fiscal, impuestos y facturación electrónica en LATAM</h2>
      <p>Al operar en mercados de Latinoamérica bajo entornos multiempresa, los aspectos fiscales se rigen por las siguientes estipulaciones:</p>
      <ul>
        <li><strong>Territorialidad e impuestos:</strong> las tarifas publicadas en la Plataforma pueden estar sujetas a impuestos locales (como el Impuesto al Valor Agregado - IVA) dependiendo del país de residencia legal declarado por el Cliente o la configuración fiscal de la Empresa Principal. administratodo.com desglosará dichos impuestos de acuerdo con las leyes tributarias aplicables.</li>
        <li><strong>Emisión de facturas electrónicas:</strong> una vez procesado el pago con éxito a través de QPayPro, VisaNet o Stripe, administratodo.com emitirá el documento fiscal digital correspondiente (ej. Régimen FEL en Guatemala, CFDI en México o el equivalente legal en el país correspondiente) a la razón social indicada por el Administrador Principal. El Cliente es responsable de proveer datos fiscales válidos y actualizados.</li>
        <li><strong>Retenciones de impuestos locales:</strong> en caso de que el Cliente actúe como agente de retención según las leyes de su país, deberá notificarlo previamente a administratodo.com para coordinar los flujos de cobro correspondientes; de lo contrario, el cargo automático se realizará por el valor total de la factura.</li>
      </ul>

      <h2>8. Propiedad, custodia y protección de datos del Cliente (Data Ownership)</h2>
      <p>El Cliente retiene la propiedad absoluta y exclusiva de todos los datos, archivos, registros financieros, presupuestos o información comercial que ingrese, procese o genere en los entornos multiempresa y multiproyecto de la Plataforma («Datos del Cliente»).</p>
      <ul>
        <li><strong>Rol de administratodo.com:</strong> actuamos únicamente como «Encargados del Tratamiento» de dichos datos, procesándolos estrictamente para la ejecución del servicio técnico, bajo las directrices de nuestra <a href={LEGAL_PATHS.privacy}>Política de Privacidad</a> y estándares internacionales (como el RGPD).</li>
        <li><strong>Garantía de indemnidad por datos de terceros:</strong> el Cliente declara y garantiza que posee todos los derechos, consentimientos y bases legales requeridas para registrar en la Plataforma información confidencial o datos personales pertenecientes a sus propios clientes, empleados, proveedores o subcontratistas. El Cliente indemnizará y mantendrá indemne a administratodo.com frente a cualquier demanda o sanción derivada de infracciones a la privacidad cometidas por el uso indebido de los Datos del Cliente dentro de la Plataforma.</li>
        <li><strong>Portabilidad y eliminación definitiva:</strong> el Cliente podrá exportar la información de sus Empresas y Proyectos en formatos estándar (como CSV o Excel) en cualquier momento mientras su suscripción esté activa o durante el periodo de gracia de solo lectura. Tras la suspensión total por falta de pago o la cancelación voluntaria de la cuenta, administratodo.com conservará los datos en sus servidores por un plazo máximo de treinta (30) días calendario para permitir una última descarga de respaldo. Pasado ese tiempo, toda la información será eliminada permanentemente de nuestros servidores de producción por motivos de seguridad informática.</li>
      </ul>

      <h2>9. Limitación de responsabilidad comercial</h2>
      <p>administratodo.com provee una herramienta tecnológica avanzada de apoyo a la gestión administrativa. El SaaS no toma decisiones de negocio por el Cliente, no sustituye el criterio de contadores, auditores o administradores profesionales, ni garantiza resultados comerciales específicos. Nuestra responsabilidad civil total acumulada ante cualquier reclamación demostrada derivada de estos Términos estará limitada estrictamente al monto equivalente pagado por el Cliente por su suscripción durante los últimos tres (3) meses anteriores al evento que originó la disputa.</p>

      <h2>10. Resolución de disputas multipaís y jurisdicción (mecanismo escalado)</h2>
      <p>Considerando la naturaleza del mercado en Latinoamérica, donde el Cliente y el SaaS pueden operar en jurisdicciones distintas, las partes se someten a un proceso escalonado de solución de controversias:</p>
      <ul>
        <li><strong>Negociación directa:</strong> las partes intentarán resolver cualquier disputa de forma amistosa mediante reuniones virtuales en un plazo máximo de treinta (30) días hábiles escribiendo a <Mail />.</li>
        <li><strong>Arbitraje comercial obligatorio:</strong> de no alcanzarse un acuerdo en la fase directa, la disputa se resolverá de manera definitiva mediante arbitraje de derecho, administrado de forma virtual por un centro de arbitraje de prestigio internacional de común acuerdo o, en su defecto, en la sede jurídica principal donde se encuentre constituida la empresa matriz operadora de administratodo.com. El idioma del arbitraje será el español y el laudo arbitral será definitivo, vinculante e inapelable para ambas partes.</li>
      </ul>

      <h2>11. Modificaciones y contacto</h2>
      <p>Podemos modificar estos Términos en cualquier momento para reflejar actualizaciones técnicas en nuestra arquitectura multiempresa o cambios legislativos en LATAM. El uso continuo del SaaS tras la publicación de los Términos modificados constituirá la aceptación de los mismos.</p>
      <p>Para cualquier consulta legal sobre este acuerdo, puede comunicarse con nuestro departamento de cumplimiento a través del correo: <Mail />.</p>
    </>
  )
}

function DpaBodyEs(): ReactElement {
  return (
    <>
      <p>
        Este Acuerdo de Procesamiento de Datos (en adelante, el «DPA») complementa los{' '}
        <a href={LEGAL_PATHS.tos}>Términos de Servicio</a> de administratodo.com (en adelante, el «Acuerdo
        Principal») y regula el tratamiento de datos personales realizado en el marco de la prestación de
        los servicios SaaS multiempresa y multiproyecto.
      </p>

      <h2>1. Objeto y definiciones</h2>
      <p>Este DPA se aplica cuando administratodo.com procesa Datos Personales en calidad de «Encargado del Tratamiento» en nombre del Cliente, quien actúa como «Responsable del Tratamiento».</p>
      <ul>
        <li><strong>Responsable del Tratamiento (Cliente):</strong> la entidad o persona que determina los fines y medios del tratamiento de datos de sus empresas y proyectos.</li>
        <li><strong>Encargado del Tratamiento (la Plataforma):</strong> administratodo.com, que procesa los datos únicamente bajo las instrucciones del Responsable.</li>
        <li><strong>Datos Personales del Cliente:</strong> cualquier información cargada en el SaaS que identifique de forma directa o indirecta a empleados, proveedores, clientes o colaboradores del Responsable.</li>
      </ul>

      <h2>2. Instrucciones del tratamiento</h2>
      <p>La Plataforma se compromete a tratar los Datos Personales única y exclusivamente siguiendo las instrucciones por escrito del Cliente, reflejadas en el Acuerdo Principal, este DPA y la configuración que el Cliente realice en el panel de administración multiproyecto.</p>

      <h2>3. Obligaciones de administratodo.com</h2>
      <p>En su rol de Encargado, la Plataforma se obliga a:</p>
      <ul>
        <li><strong>Seguridad:</strong> implementar medidas de seguridad técnicas y organizativas adecuadas, incluyendo cifrado de datos en tránsito (SSL/TLS) y en reposo, para mitigar riesgos de acceso no autorizado o pérdida.</li>
        <li><strong>Confidencialidad:</strong> garantizar que todo el personal autorizado para procesar los datos esté sujeto a estrictos acuerdos de confidencialidad de la información.</li>
        <li><strong>Subprocesadores:</strong> el Cliente autoriza la integración de herramientas indispensables de terceros (tales como Google Cloud, Stripe, PayPal, QPayPro, NeoNet y BAC Credomatic). La Plataforma exigirá a estos subprocesadores el mismo nivel de protección de datos estipulado en este DPA.</li>
        <li><strong>Asistencia al Responsable:</strong> colaborar con el Cliente, en la medida de lo técnicamente viable, para que este pueda responder a las solicitudes de los titulares de datos que ejerzan sus derechos de Acceso, Rectificación, Supresión u Oposición (Derechos ARCO / RGPD).</li>
        <li><strong>Notificación de incidentes:</strong> informar al Cliente sin dilación indebida, y a más tardar dentro de las 48 horas siguientes, tras confirmar cualquier brecha de seguridad que afecte la integridad de sus Datos Personales.</li>
      </ul>

      <h2>4. Destino de los datos al término del servicio</h2>
      <p>A la terminación de los Servicios SaaS, y conforme a los plazos previstos en los Términos de Servicio, la Plataforma conservará los datos por un periodo máximo de treinta (30) días calendario para permitir su portabilidad y exportación. Transcurrido dicho plazo, administratodo.com procederá a la eliminación segura y definitiva de toda la información de sus servidores activos, salvo por aquellos registros cuya retención sea exigida por legislaciones fiscales o contables locales aplicables en Latinoamérica.</p>

      <h2 className="legal-divider">Política de Cookies</h2>
      <p className="legal-subtle">Última actualización: 7 de agosto de 2026</p>
      <p>En administratodo.com utilizamos cookies y tecnologías similares de seguimiento para mejorar el rendimiento de la plataforma, optimizar la experiencia multiempresa del usuario y garantizar la seguridad transaccional en nuestros procesamientos de pago.</p>

      <h3>1. ¿Qué es una cookie?</h3>
      <p>Una cookie es un pequeño archivo de texto que un sitio web almacena en el navegador o dispositivo del usuario. Permite recordar información sobre su visita, como su idioma preferido, sesiones de cuenta activas y otras configuraciones operativas.</p>

      <h3>2. Tipos de cookies que utiliza esta Plataforma</h3>
      <p>Clasificamos las cookies que implementamos en las siguientes categorías:</p>
      <div className="legal-table-wrap">
        <table>
          <thead><tr><th>Categoría de cookie</th><th>Finalidad específica</th><th>Terceros involucrados</th></tr></thead>
          <tbody>
            <tr><td>Esenciales o técnicas</td><td>Obligatorias para el correcto funcionamiento de la interfaz, mantenimiento de sesiones abiertas y prevención de fraudes.</td><td>Propias de la plataforma, Stripe, PayPal.</td></tr>
            <tr><td>De rendimiento y analítica</td><td>Recopilan datos anónimos y agregados sobre los patrones de navegación y uso multiproyecto del software para optimizar la infraestructura.</td><td>Google Analytics.</td></tr>
            <tr><td>Funcionales y preferencias</td><td>Permiten recordar selecciones del usuario, tales como la moneda de facturación local o la segregación visual de empresas en el panel.</td><td>Propias de la plataforma, Google Maps API.</td></tr>
            <tr><td>Seguimiento en correos electrónicos</td><td>Imagen de 1×1 píxel incluida en los correos que la Plataforma envía, que registra si el mensaje fue abierto y cuándo. No es una cookie ni se almacena en el dispositivo: se activa al cargar la imagen desde el cliente de correo del destinatario.</td><td>Propias de la plataforma.</td></tr>
          </tbody>
        </table>
      </div>

      <h3>3. Alcance: seguimiento fuera del navegador</h3>
      <p>Las cookies descritas arriba operan dentro del navegador cuando el usuario visita la Plataforma. El seguimiento de apertura de correos, en cambio, se produce <strong>fuera del navegador</strong>: se activa en el cliente de correo del destinatario al cargar las imágenes del mensaje, sin que medie una visita a la Plataforma y, por tanto, sin que el panel de configuración de cookies descrito en el apartado siguiente llegue a mostrarse.</p>
      <p>Esta distinción es relevante porque los destinatarios de estos correos <strong>no son necesariamente usuarios registrados</strong> de la Plataforma: pueden ser residentes, clientes o terceros a quienes una empresa administradora dirige una comunicación. En esos casos, la empresa administradora que ordena el envío actúa como responsable del tratamiento y administratodo.com como encargado, en los términos del Acuerdo de Tratamiento de Datos anterior.</p>
      <p>El destinatario puede impedir este seguimiento en cualquier momento configurando su cliente de correo para no cargar imágenes automáticamente —opción disponible en Gmail, Outlook, Apple Mail y la mayoría de clientes—. Hacerlo no afecta a la entrega ni al contenido del mensaje.</p>

      <h3>3. Gestión y revocación del consentimiento</h3>
      <p>De conformidad con las directrices del RGPD y los estándares internacionales de privacidad, el usuario puede modificar sus preferencias o revocar su consentimiento en cualquier momento a través del Panel de Configuración de Cookies integrado en nuestro banner informativo, o ajustando directamente la configuración de privacidad de su navegador web.</p>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ENGLISH (courtesy translation — the binding version is the Spanish one)
// ════════════════════════════════════════════════════════════════════════════

function PrivacyBodyEn(): ReactElement {
  return (
    <>
      <p>
        At administratodo.com (hereinafter, "the Platform", "the SaaS" or "We"), we are firmly committed
        to protecting the privacy, confidentiality and security of our users' personal data. This Privacy
        Policy forms an integrated whole together with our{' '}
        <a href={legalHref('tos', 'en')}>Terms of Service</a> and the{' '}
        <a href={legalHref('dpa', 'en')}>Data Processing Addendum (DPA)</a>, designed under the most
        demanding international standards, including the General Data Protection Regulation (GDPR), the
        California Consumer Privacy Act (CCPA/CPRA) and the data-protection regulations in force across
        Latin America.
      </p>
      <p>This document is a cornerstone of operational transparency and of the verification processes run by global third-party platforms, including Google application authorization.</p>

      <h2>1. Express acceptance flow and legal binding (Click-wrap)</h2>
      <p>This Privacy Policy is not a passive read. When registering an account, creating an organization or using the Services, the Primary Administrator and each Authorized User must affirmatively accept this document through a checkbox unchecked by default (Click-wrap mechanism).</p>
      <p>The Platform will record, in an automated and tamper-evident manner in its databases, the originating IP address, the date, the exact time and the version of the accepted document. That record will constitute full legal proof of consent before banking entities, chargeback disputes, tax audits and third-party app-store certification processes.</p>

      <h2>2. Information we collect</h2>
      <p>To optimally provide the multi-company SaaS services, we collect the following categories of information:</p>
      <h3>A. Information provided directly by the User</h3>
      <ul>
        <li><strong>Registration and account data:</strong> first name, last name, email address, phone number and encrypted access credentials.</li>
        <li><strong>Local tax and billing data:</strong> legal/company name, government tax IDs (for example, NIT in Guatemala, RTU, RUC, RFC or the equivalent in the relevant LATAM jurisdiction) and physical billing address.</li>
        <li><strong>Communications:</strong> data sent through contact forms, technical support tickets or emails addressed to <Mail />.</li>
      </ul>
      <h3>B. Information collected automatically</h3>
      <ul>
        <li><strong>Connection and device data:</strong> IP address, browser type, operating system, unique identifiers of access devices, language settings and time zone.</li>
        <li><strong>Infrastructure usage data:</strong> pages and modules visited within the Platform, dwell time, clicks, navigation flows and interactions across companies and projects.</li>
        <li><strong>Cookies and tracking technologies:</strong> data collected through essential, analytics and functional cookies in accordance with our <a href={legalHref('dpa', 'en')}>Cookie Policy</a>.</li>
        <li><strong>Email delivery and open metrics:</strong> when the Platform sends transactional or broadcast emails on behalf of a managing company, we record whether the message was delivered, whether it was opened, and the date and time of that opening. Open detection uses a 1×1 pixel tracking image embedded in the message body; on loading it, the recipient's email client transmits its IP address and the technical data of the request. These metrics are associated with the recipient of the message. Opens are an upper-bound estimate: some email providers preload images automatically, which may record opens the recipient did not perform. If the recipient configures their email client not to load images, no open is recorded and message delivery is unaffected.</li>
      </ul>

      <h2>3. Purposes and legal basis for processing</h2>
      <p>We process personal data only where we have a valid legal basis under international privacy standards, as detailed below:</p>
      <div className="legal-table-wrap">
        <table>
          <thead><tr><th>Purpose of processing</th><th>Detailed description</th><th>Applicable legal basis</th></tr></thead>
          <tbody>
            <tr><td>Provision of the SaaS Service</td><td>Manage user accounts, enable the multi-company and multi-project environment, provide technical support and process recurring financial transactions.</td><td>Performance of a contract</td></tr>
            <tr><td>Tax compliance in LATAM</td><td>Process the tax information required to issue electronic invoices (FEL regime, CFDI or regional equivalents) for subscription charges.</td><td>Legal obligation</td></tr>
            <tr><td>Infrastructure improvement</td><td>Analyze aggregated usage statistics to optimize the Platform's performance, fix errors and develop new administrative tools.</td><td>Legitimate interest</td></tr>
            <tr><td>Platform security</td><td>Prevent computer fraud, mitigate cyberattacks, detect malicious financial disputes and ensure database integrity.</td><td>Legitimate interest / Legal obligation</td></tr>
            <tr><td>Service communications</td><td>Send technical notifications about system status, dunning-process alerts for declined transactions and legal updates to the Platform.</td><td>Performance of a contract</td></tr>
          </tbody>
        </table>
      </div>

      <h2>4. Use of third-party services and Google authorization</h2>
      <p>To offer a high-availability software environment, the Platform integrates components and APIs from leading global and regional technology providers, which involves international transfers and processing by third parties:</p>
      <h3>A. Integration with Google ecosystems and APIs</h3>
      <ul>
        <li><strong>Google Workspace / Gmail API:</strong> used strictly for the management, synchronization and automated sending of transactional emails, billing alerts and workflow notifications generated by the user. The use of information received through Google APIs will strictly adhere to the Google API Services User Data Policy, including the Limited Use requirements.</li>
        <li><strong>Google Analytics:</strong> a web-analytics tool to evaluate interface usage, generate software performance metrics and understand user behavior in an aggregated and anonymized way.</li>
        <li><strong>Google Maps API:</strong> used for geographic features, project localization and cartographic validation of addresses within the administration modules.</li>
      </ul>
      <p>
        <strong>Sharing, Transfer and Disclosure of Google Data:</strong> administratodo.com does not sell, rent,
        transfer or share user data obtained through Google APIs with third-party companies or organizations for
        commercial, advertising or marketing purposes. Google user information is used solely and exclusively to
        enable the internal functions contracted by the Client itself (such as the synchronization of the
        Administrator's communications). Such data will not be disclosed to any third party, except for: (i) The
        corporate Client itself who authorized the access for its internal management, and (ii) When strictly
        required by a court order, a competent judge or a governmental institution under applicable local
        legislation.
      </p>
      <h3>B. Payment gateways and secure acquiring (PCI-DSS)</h3>
      <p>To guarantee transactional security, administratodo.com uses specialized external providers. The Platform does not store or process full credit- or debit-card data on its servers. All financial information travels encrypted directly to:</p>
      <ul>
        <li><strong>Stripe and PayPal:</strong> global processors under PCI-DSS certification, whose servers may be located in the United States and Europe.</li>
        <li><strong>QPayPro, NeoNet (VisaNet Guatemala) and BAC Credomatic:</strong> regional acquiring gateways that handle local charges in Central America and LATAM, processing recurring charge flows under each country's banking regulations.</li>
      </ul>

      <h2>5. Disclaimer for general user content (Data Ownership)</h2>
      <p>administratodo.com operates exclusively as a cloud-infrastructure platform for administrative management. The Client acts as the absolute owner and "Controller" of any information, file, digital document, invoice, contract or third-party personal data (employees, suppliers or its own customers) that it enters or hosts in its multi-company and multi-project modules.</p>
      <p>The Platform acts solely as the technical "Processor" of such data. Consequently, administratodo.com is fully released from any legal, civil, criminal or administrative liability arising from the lawfulness, accuracy, intellectual property or privacy violations of the documents and data uploaded by users in their corporate environment. The Client undertakes to hold the Platform harmless against any third-party claim.</p>

      <h2>6. Data retention period</h2>
      <p>We will retain personal data only for as long as strictly necessary to fulfill the contractual purposes and applicable legal obligations:</p>
      <ul>
        <li>Active account data will remain in force as long as the Client does not request voluntary termination of the service or rescission of the Main Agreement.</li>
        <li>Data contained in environments suspended for non-payment will be safeguarded for a maximum of thirty (30) calendar days to guarantee the Client's portability, after which it will be permanently deleted from production servers.</li>
        <li>Accounting records and issued electronic tax invoices will be retained for the minimum mandatory periods required by local LATAM tax authorities (generally between 5 and 10 years).</li>
      </ul>

      <h2>7. User rights (ARCO rights)</h2>
      <p>Regardless of their location in LATAM, we guarantee data subjects the exercise of their rights of Access, Rectification, Cancellation and Objection (ARCO). The user may request the execution of these rights by configuring their user profile directly or by sending a formal email to <Mail /> attaching identification that validates their identity as the data subject.</p>

      <h2>8. Changes to this Policy</h2>
      <p>We reserve the right to update this Privacy Policy at any time to adapt it to technical improvements in the SaaS or to legislative changes in the Latin American region. Any modification will be published in this section and notified to the Primary Administrator through the system's internal channels.</p>
    </>
  )
}

function TosBodyEn(): ReactElement {
  return (
    <>
      <p>Welcome to administratodo.com (hereinafter, "the Platform", "the SaaS" or "We"). These Terms of Service (hereinafter, the "Terms") constitute a legal, binding and enforceable agreement between administratodo.com and the natural or legal person who contracts, accesses or uses our software-on-demand services (hereinafter, the "Client" or the "User").</p>
      <p>By registering, activating a corporate account or using the Platform, you agree to comply with and be bound by these Terms in full. If you are entering into this agreement on behalf of a company or other legal entity, you represent that you have the legal authority to bind that entity to these Terms.</p>

      <h2>1. Nature of the SaaS service and license to use</h2>
      <p>administratodo.com operates exclusively as cloud-distributed software (Software as a Service - SaaS). Subject to strict compliance with these Terms and timely payment of the applicable fees, we grant the Client a limited, non-exclusive, non-transferable, revocable and global license to access and use the Platform for its internal business operations.</p>
      <p>This license does not constitute a sale of the software. The Client acquires no intellectual property right over the source code, architecture, design, algorithms or trademarks of the Platform.</p>

      <h2>2. Account architecture: multi-company and multi-project environment</h2>
      <p>The Platform has an advanced technical structure designed for the consolidated management of multiple independent business units. The Client understands and accepts the following operating rules for this ecosystem:</p>
      <ul>
        <li><strong>Primary Administrator account (Tenant):</strong> the legal holder of the contract and of the paid subscription. It has full control of the contracted environment and is the sole party legally responsible for all activities carried out within it.</li>
        <li><strong>Multi-company modules:</strong> the Client may register different legal entities, subsidiaries, branches or brands (each a "Company") under a single centralized account, subject to the limits of its contracted plan. The Client is responsible for correctly segregating access and ensuring each Company complies with the accounting, commercial and tax regulations of its respective jurisdiction.</li>
        <li><strong>Multi-project management:</strong> within each Company, the Platform allows structuring workflows, budgets, inventories and schedules segregated by projects (each a "Project"). Deleting, archiving or altering the data of a specific Project is the sole responsibility of the assigned User.</li>
      </ul>

      <h2>3. Access control, authorized users and roles</h2>
      <p>The Primary Administrator may invite third parties (employees, external accountants, advisors, business partners) to be part of its environment as "Authorized Users".</p>
      <ul>
        <li><strong>Role and permission assignment:</strong> it is the Client's sole responsibility to configure, audit and restrict the roles (e.g. Administrator, Editor, Reader, Auditor) for each Authorized User within each specific Company or Project. administratodo.com is not responsible for information leaks, data deletion or erroneous transactions arising from a poor assignment of permissions by the Client or its administrators.</li>
        <li><strong>Confidentiality of credentials:</strong> each user account is personal and non-transferable. Sharing credentials among collaborators is prohibited. The Client must immediately notify <Mail /> of any suspicion of a security breach or unauthorized access.</li>
      </ul>

      <h2>4. Subscription models, plans and pricing</h2>
      <p>Access to the Platform is governed by subscription plans based on the recurrence and scalability of the Client's business.</p>
      <h3>A. Billing metrics (usage- or capacity-based pricing)</h3>
      <p>Plan prices are structured modularly according to the following SaaS-environment variables:</p>
      <ul>
        <li>Total number of Companies registered in the system.</li>
        <li>Number of concurrent or archived Projects.</li>
        <li>Volume of Authorized Users interacting in the system.</li>
        <li>Cloud storage capacity consumed.</li>
      </ul>
      <h3>B. Price adjustments and inflation in LATAM markets</h3>
      <p>Following international standards of multinational platforms, administratodo.com reserves the right to adjust the fees of its subscription plans to adapt them to exchange-rate fluctuations of local currencies, regional inflation in Latin America, or substantial improvements in technological infrastructure. Any price change will be notified by email to the Primary Administrator at least thirty (30) calendar days in advance. If the Client does not accept the adjustment, it will be entitled to cancel its subscription before the next billing date without any penalty.</p>

      <h2>5. Payment terms, recurrence and local acquiring (QPayPro / VisaNet / NeoNet / BAC)</h2>
      <p>The financial processing of administratodo.com's Services is governed by strict international and local-acquiring regulations.</p>
      <h3>A. Express authorization of recurring charges</h3>
      <p>By registering a credit or debit card (Visa, Mastercard, American Express, among others) on our Platform, the Client grants its consent and express authorization for automatic and recurring charges to be made to its bank account. Charges will be made at the start of each billing cycle (monthly or annual) for the amount corresponding to the contracted plan and the active multi-company/multi-project modules.</p>
      <h3>B. Secure processing channels and PCI-DSS</h3>
      <p>Payments are processed externally and securely through authorized integrated payment gateways: Stripe and PayPal for international transactions; and QPayPro, NeoNet (VisaNet Guatemala) or BAC Credomatic for local financial processing in Central America and LATAM. administratodo.com does not collect, process or store card data on its own servers; all information travels encrypted directly to the processors under the PCI-DSS financial-security standard.</p>
      <h3>C. Anti-chargeback and malicious-dispute policy</h3>
      <p>Since local gateways (such as QPayPro or VisaNet) require absolute transparency, any attempt by the Client to initiate a chargeback with its issuing bank claiming ignorance of a duly authorized recurring charge will be considered a serious breach of these Terms. If an unjustified payment dispute is detected, administratodo.com will proceed to the immediate and definitive suspension of all companies and projects associated with the account, and reserves the right to pass on to the Client the penalty costs applied by the acquiring bank.</p>

      <h2>6. Protocol for declined transactions and charge failures</h2>
      <p>To guarantee the operational stability of the SaaS and protect the Client's data against unforeseen problems with its credit or debit cards, the following automated mitigation protocol is established:</p>
      <h3>A. Causes of charge failure</h3>
      <p>The Client acknowledges that a recurring charge transaction may be rejected or declined by the gateways (QPayPro, VisaNet, Stripe, etc.) due to:</p>
      <ul>
        <li>Insufficient funds in the source account.</li>
        <li>Expired, blocked or reported credit or debit card.</li>
        <li>Security restrictions due to fraud prevention by the issuing bank (blocking of internet or international transactions).</li>
        <li>Technical interruptions in the communication networks of local acquiring banks.</li>
      </ul>
      <p>administratodo.com is released from any liability if the payment gateways fail to process the automatic charge due to the aforementioned causes.</p>
      <h3>B. Gradual retry process (Dunning Process)</h3>
      <p>If a recurring charge is declined, the system will activate a financial-mitigation schedule:</p>
      <ul>
        <li><strong>Day 1 (first failure):</strong> an immediate electronic notification will be sent to the Primary Administrator indicating the rejection of the transaction and requesting a review of its payment method.</li>
        <li><strong>Days 3 and 5:</strong> the system will make automatic retry attempts through the integrated gateways. Additional reminders of the outstanding balance will be sent.</li>
      </ul>
      <h3>C. "Read-Only" status and grace period</h3>
      <p>During a grace period of seven (7) calendar days counted from the first charge failure, the Client's multi-company environment will remain active but will be automatically restricted to a Read-Only Mode.</p>
      <p>Under this status, the Client and its Authorized Users will be able to view the existing information of their projects and companies, but will not be able to make modifications, record new transactions, issue tax documents, register new companies or projects, or add new users.</p>
      <h3>D. Full suspension and reactivation costs</h3>
      <p>After the seven (7) day grace period has elapsed without the charge having been successfully processed or without the Client having registered a valid card with funds, the SaaS environment will be fully suspended.</p>
      <p>To restore the service, the Client must settle the overdue balance. administratodo.com reserves the right to apply an administrative fee for reactivating suspended accounts to cover the costs of cloud re-indexing of its companies' infrastructure.</p>
      <h3>E. Release of liability for operating losses due to suspension</h3>
      <p>The Client accepts that the legitimate suspension of the account for non-payment or declined transactions is entirely its responsibility. administratodo.com will not be liable under any circumstances for damages, losses, financial losses, tax fines from LATAM government entities, or project delays suffered by the Client, its affiliated Companies or its own end customers due to the loss of access to the software caused by the suspension of the service.</p>

      <h2>7. Tax treatment, taxes and electronic invoicing in LATAM</h2>
      <p>When operating in Latin American markets under multi-company environments, tax matters are governed by the following provisions:</p>
      <ul>
        <li><strong>Territoriality and taxes:</strong> the fees published on the Platform may be subject to local taxes (such as Value Added Tax - VAT) depending on the Client's declared country of legal residence or the tax configuration of the Main Company. administratodo.com will break down such taxes in accordance with applicable tax laws.</li>
        <li><strong>Issuance of electronic invoices:</strong> once payment has been successfully processed through QPayPro, VisaNet or Stripe, administratodo.com will issue the corresponding digital tax document (e.g. FEL regime in Guatemala, CFDI in Mexico or the legal equivalent in the relevant country) to the legal name indicated by the Primary Administrator. The Client is responsible for providing valid and up-to-date tax data.</li>
        <li><strong>Local tax withholdings:</strong> if the Client acts as a withholding agent under the laws of its country, it must notify administratodo.com in advance to coordinate the corresponding charge flows; otherwise, the automatic charge will be made for the full amount of the invoice.</li>
      </ul>

      <h2>8. Ownership, custody and protection of Client data (Data Ownership)</h2>
      <p>The Client retains absolute and exclusive ownership of all data, files, financial records, budgets or commercial information that it enters, processes or generates in the multi-company and multi-project environments of the Platform ("Client Data").</p>
      <ul>
        <li><strong>administratodo.com's role:</strong> we act solely as "Processors" of such data, processing it strictly for the execution of the technical service, under the guidelines of our <a href={legalHref('privacy', 'en')}>Privacy Policy</a> and international standards (such as the GDPR).</li>
        <li><strong>Indemnity guarantee for third-party data:</strong> the Client declares and warrants that it holds all rights, consents and legal bases required to register on the Platform confidential information or personal data belonging to its own customers, employees, suppliers or subcontractors. The Client will indemnify and hold administratodo.com harmless against any claim or sanction arising from privacy infringements committed through the misuse of Client Data within the Platform.</li>
        <li><strong>Portability and definitive deletion:</strong> the Client may export the information of its Companies and Projects in standard formats (such as CSV or Excel) at any time while its subscription is active or during the read-only grace period. After full suspension for non-payment or voluntary cancellation of the account, administratodo.com will retain the data on its servers for a maximum of thirty (30) calendar days to allow a final backup download. After that time, all information will be permanently deleted from our production servers for information-security reasons.</li>
      </ul>

      <h2>9. Limitation of commercial liability</h2>
      <p>administratodo.com provides an advanced technological tool to support administrative management. The SaaS does not make business decisions for the Client, does not replace the judgment of accountants, auditors or professional administrators, nor does it guarantee specific commercial results. Our total accumulated civil liability for any proven claim arising from these Terms will be strictly limited to the amount paid by the Client for its subscription during the three (3) months prior to the event that gave rise to the dispute.</p>

      <h2>10. Multi-country dispute resolution and jurisdiction (escalated mechanism)</h2>
      <p>Considering the nature of the Latin American market, where the Client and the SaaS may operate in different jurisdictions, the parties submit to a staged dispute-resolution process:</p>
      <ul>
        <li><strong>Direct negotiation:</strong> the parties will attempt to resolve any dispute amicably through virtual meetings within a maximum of thirty (30) business days by writing to <Mail />.</li>
        <li><strong>Mandatory commercial arbitration:</strong> if no agreement is reached in the direct phase, the dispute will be definitively resolved through arbitration at law, administered virtually by an internationally renowned arbitration center by mutual agreement or, failing that, at the main legal seat where the parent company operating administratodo.com is incorporated. The language of the arbitration will be Spanish and the arbitral award will be final, binding and non-appealable for both parties.</li>
      </ul>

      <h2>11. Changes and contact</h2>
      <p>We may modify these Terms at any time to reflect technical updates to our multi-company architecture or legislative changes in LATAM. Continued use of the SaaS after the publication of the modified Terms will constitute acceptance thereof.</p>
      <p>For any legal inquiry about this agreement, you may contact our compliance department at: <Mail />.</p>
    </>
  )
}

function DpaBodyEn(): ReactElement {
  return (
    <>
      <p>This Data Processing Addendum (hereinafter, the "DPA") supplements the{' '}
        <a href={legalHref('tos', 'en')}>Terms of Service</a> of administratodo.com (hereinafter, the
        "Main Agreement") and governs the processing of personal data carried out within the framework of
        providing the multi-company and multi-project SaaS services.</p>

      <h2>1. Subject matter and definitions</h2>
      <p>This DPA applies when administratodo.com processes Personal Data as a "Processor" on behalf of the Client, who acts as the "Controller".</p>
      <ul>
        <li><strong>Controller (Client):</strong> the entity or person that determines the purposes and means of processing the data of its companies and projects.</li>
        <li><strong>Processor (the Platform):</strong> administratodo.com, which processes the data solely under the Controller's instructions.</li>
        <li><strong>Client Personal Data:</strong> any information uploaded to the SaaS that directly or indirectly identifies employees, suppliers, customers or collaborators of the Controller.</li>
      </ul>

      <h2>2. Processing instructions</h2>
      <p>The Platform undertakes to process Personal Data solely and exclusively following the Client's written instructions, reflected in the Main Agreement, this DPA and the configuration the Client makes in the multi-project administration panel.</p>

      <h2>3. administratodo.com's obligations</h2>
      <p>In its role as Processor, the Platform undertakes to:</p>
      <ul>
        <li><strong>Security:</strong> implement appropriate technical and organizational security measures, including encryption of data in transit (SSL/TLS) and at rest, to mitigate risks of unauthorized access or loss.</li>
        <li><strong>Confidentiality:</strong> ensure that all personnel authorized to process the data are subject to strict information-confidentiality agreements.</li>
        <li><strong>Sub-processors:</strong> the Client authorizes the integration of indispensable third-party tools (such as Google Cloud, Stripe, PayPal, QPayPro, NeoNet and BAC Credomatic). The Platform will require these sub-processors to maintain the same level of data protection stipulated in this DPA.</li>
        <li><strong>Assistance to the Controller:</strong> collaborate with the Client, to the extent technically feasible, so that it can respond to requests from data subjects exercising their rights of Access, Rectification, Erasure or Objection (ARCO rights / GDPR).</li>
        <li><strong>Incident notification:</strong> inform the Client without undue delay, and no later than within the following 48 hours, after confirming any security breach affecting the integrity of its Personal Data.</li>
      </ul>

      <h2>4. Fate of the data upon termination of the service</h2>
      <p>Upon termination of the SaaS Services, and in accordance with the periods set out in the Terms of Service, the Platform will retain the data for a maximum period of thirty (30) calendar days to allow its portability and export. After that period, administratodo.com will proceed with the secure and definitive deletion of all information from its active servers, except for those records whose retention is required by applicable local tax or accounting legislation in Latin America.</p>

      <h2 className="legal-divider">Cookie Policy</h2>
      <p className="legal-subtle">Last updated: August 7, 2026</p>
      <p>At administratodo.com we use cookies and similar tracking technologies to improve the platform's performance, optimize the user's multi-company experience and ensure transactional security in our payment processing.</p>

      <h3>1. What is a cookie?</h3>
      <p>A cookie is a small text file that a website stores in the user's browser or device. It allows remembering information about your visit, such as your preferred language, active account sessions and other operating settings.</p>

      <h3>2. Types of cookies this Platform uses</h3>
      <p>We classify the cookies we implement into the following categories:</p>
      <div className="legal-table-wrap">
        <table>
          <thead><tr><th>Cookie category</th><th>Specific purpose</th><th>Third parties involved</th></tr></thead>
          <tbody>
            <tr><td>Essential or technical</td><td>Mandatory for the correct functioning of the interface, maintenance of open sessions and fraud prevention.</td><td>First-party, Stripe, PayPal.</td></tr>
            <tr><td>Performance and analytics</td><td>Collect anonymous, aggregated data on navigation patterns and multi-project usage of the software to optimize the infrastructure.</td><td>Google Analytics.</td></tr>
            <tr><td>Functional and preferences</td><td>Allow remembering user selections, such as the local billing currency or the visual segregation of companies in the panel.</td><td>First-party, Google Maps API.</td></tr>
            <tr><td>Email tracking</td><td>1×1 pixel image embedded in the emails the Platform sends, which records whether the message was opened and when. It is not a cookie and is not stored on the device: it is triggered when the image loads in the recipient's email client.</td><td>First-party.</td></tr>
          </tbody>
        </table>
      </div>

      <h3>3. Scope: tracking outside the browser</h3>
      <p>The cookies described above operate within the browser when the user visits the Platform. Email open tracking, by contrast, occurs <strong>outside the browser</strong>: it is triggered in the recipient's email client when the message images load, without any visit to the Platform and therefore without the cookie settings panel described in the following section ever being shown.</p>
      <p>This distinction matters because the recipients of these emails <strong>are not necessarily registered users</strong> of the Platform: they may be residents, customers or third parties to whom a managing company addresses a communication. In those cases, the managing company ordering the send acts as data controller and administratodo.com as processor, under the terms of the Data Processing Agreement above.</p>
      <p>Recipients may prevent this tracking at any time by configuring their email client not to load images automatically — an option available in Gmail, Outlook, Apple Mail and most clients. Doing so affects neither the delivery nor the content of the message.</p>

      <h3>3. Consent management and withdrawal</h3>
      <p>In accordance with GDPR guidelines and international privacy standards, the user may modify their preferences or withdraw their consent at any time through the Cookie Settings panel integrated into our information banner, or by adjusting the privacy settings of their web browser directly.</p>
    </>
  )
}

export const LEGAL_BODIES: Record<Lang, Record<LegalDocType, () => ReactElement>> = {
  es: { privacy: PrivacyBodyEs, tos: TosBodyEs, dpa: DpaBodyEs },
  en: { privacy: PrivacyBodyEn, tos: TosBodyEn, dpa: DpaBodyEn },
}
