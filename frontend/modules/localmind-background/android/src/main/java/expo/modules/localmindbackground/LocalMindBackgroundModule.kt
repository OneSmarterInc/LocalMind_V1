package expo.modules.localmindbackground

import android.content.Context
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Keeps on-device generation running while the person uses other apps: a
 * foreground service shows a "LocalMind is generating" notification with
 * progress, and Android does not stop or slow a process that shows one.
 * The GPU keeps working in the background on Android, so the speed is unchanged.
 */
class LocalMindBackgroundModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("LocalMindBackground")
    Events("onExpired")

    Function("isSupported") { true }

    Function("gpuInBackground") { true }

    AsyncFunction("begin") { title: String, subtitle: String ->
      try {
        ContextCompat.startForegroundService(context, GenerationService.startIntent(context, title, subtitle))
        true
      } catch (error: Exception) {
        // Android 12+ refuses to start one from the background; generation
        // still runs, without the notification's protection.
        false
      }
    }

    Function("update") { fraction: Double, subtitle: String ->
      GenerationService.update(context, fraction, subtitle)
    }

    Function("end") { _: Boolean ->
      GenerationService.stop(context)
    }
  }
}
