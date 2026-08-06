import UIKit
import Capacitor

// Ciclo de vida por UIScene. Xcode avisa en consola desde iOS 26:
//
//     UIScene lifecycle will soon be required. Failure to adopt will result in
//     an assert in the future.
//
// O sea: hoy es un warning, en una iOS futura es un crash al arrancar. La
// plantilla de Capacitor 8 todavía trae solo AppDelegate (su código Swift no
// menciona UIScene por ningún lado), así que la adaptación va a mano aquí.
//
// Qué cambia. Con UIApplicationSceneManifest en Info.plist, UIKit deja de llamar
// los callbacks de ventana del AppDelegate y pasa a usar los de esta clase. La
// window y el CAPBridgeViewController los sigue creando Main.storyboard —va
// declarado en el manifest como UISceneStoryboardFile—, así que aquí NO se
// instancia nada: UIKit entrega `window` ya montada.
//
// Lo único que hay que re-cablear son las aperturas por URL. En el ciclo viejo
// entraban por application(_:open:) y application(_:continue:) del AppDelegate;
// con escenas entran por aquí. Se reenvían al mismo ApplicationDelegateProxy de
// Capacitor, que se limita a publicar notificaciones (capacitorOpenURL /
// capacitorOpenUniversalLink) para el plugin App — le da igual quién lo llame.
//
// Esto NO es cosmético: `com.administratodo.app://` es el retorno del login con
// Google (ver src/lib/nativeAuth.ts, que escucha `appUrlOpen`). Si este puente
// se rompe, el OAuth nativo se queda colgado en el navegador.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        // Arranque EN FRÍO abierto por un enlace: en ese caso los dos callbacks de
        // abajo no se disparan y la info viene en connectionOptions. Sin esto, el
        // retorno de OAuth se perdería justo cuando la app no estaba viva — que es
        // el caso más común, porque el navegador la mandó a segundo plano y iOS
        // pudo haberla matado mientras el usuario tecleaba su contraseña.
        connectionOptions.urlContexts.forEach { forwardToCapacitor($0) }
        connectionOptions.userActivities.forEach { forwardToCapacitor($0) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        URLContexts.forEach { forwardToCapacitor($0) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        forwardToCapacitor(userActivity)
    }

    // MARK: - Puente con Capacitor

    private func forwardToCapacitor(_ urlContext: UIOpenURLContext) {
        // Solo se traducen las dos opciones que el plugin App llega a leer
        // (iosSourceApplication / iosOpenInPlace). `annotation` se omite a
        // propósito: nadie la consume y está en vías de deprecación.
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        // Desenvuelto a mano: asignar un String? a un diccionario de Any compila
        // pero con warning de coerción implícita.
        if let sourceApplication = urlContext.options.sourceApplication {
            options[.sourceApplication] = sourceApplication
        }
        options[.openInPlace] = urlContext.options.openInPlace

        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            open: urlContext.url,
            options: options
        )
    }

    private func forwardToCapacitor(_ userActivity: NSUserActivity) {
        // Universal links. Hoy no hay Associated Domains configurado (no existe
        // App.entitlements), así que en la práctica no entra nada por aquí; queda
        // cableado para que activarlos sea solo tocar el entitlement.
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }
}
