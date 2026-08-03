import UIKit
import Capacitor

// `@main` en vez del `@UIApplicationMain` que traía la plantilla de Capacitor:
// aquel está deprecado desde Swift 5.3 y es otro resto del arranque pre-escenas.
// Hacen exactamente lo mismo (UIKit sintetiza el `main()` del delegate).
@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    // Sin `var window`: con el ciclo de vida por escenas la ventana la posee
    // SceneDelegate. El plugin de splash-screen la busca primero en el app
    // delegate y cae a UIApplication.shared.connectedScenes cuando no está —
    // que es justo lo que pasa ahora (ver SplashScreen.updateSplashImageBounds).

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    // MARK: - UIScene

    // El ciclo de vida vive ahora en SceneDelegate (ver ese archivo para el
    // porqué). Los callbacks de ventana del AppDelegate —applicationDidBecomeActive
    // y compañía, y también application(_:open:) / application(_:continue:)— ya NO
    // se llaman en una app con escenas: se quitaron en vez de dejarlos como código
    // muerto que aparenta seguir vivo.
    //
    // Lo que NO cambia: las notificaciones a nivel de app (didBecomeActive,
    // didEnterBackground…) se siguen publicando en NotificationCenter, así que
    // @capacitor/app sigue emitiendo appStateChange sin tocar nada. Y el registro
    // de push tampoco pasa por aquí: ese plugin hace swizzling del delegate.
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        // El nombre debe coincidir con el del UIApplicationSceneManifest.
        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

}
