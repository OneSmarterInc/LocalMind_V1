package expo.modules.localmindbackground

import android.content.Context
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Keeps on-device generation running while the person uses other apps: a
 * foreground service shows a notification naming the work ("Writing lessons —
 * Chapter 4") with its progress, and Android does not stop or slow a process
 * that shows one. When the work ends, a "ready" notification can replace it.
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

    // fraction < 0: busy bar. The title follows the job that is running.
    Function("update") { fraction: Double, subtitle: String, title: String ->
      GenerationService.update(context, fraction, subtitle, title)
    }

    // readyTitle non-empty: say the lessons or quizzes are ready.
    Function("end") { _: Boolean, readyTitle: String, readyText: String ->
      GenerationService.stop(context)
      if (readyTitle.isNotEmpty()) GenerationService.ready(context, readyTitle, readyText)
    }
  }
}
