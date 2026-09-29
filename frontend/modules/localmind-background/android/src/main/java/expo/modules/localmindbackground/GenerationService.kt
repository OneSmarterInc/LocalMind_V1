package expo.modules.localmindbackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Foreground service shown while LocalMind writes lessons and quizzes on the
 * phone. It does no work itself: its notification tells Android that the
 * person started this work, so the app keeps running in the background. A
 * partial wake lock keeps the processor awake; it is released when generation
 * ends, and it expires after six hours in any case.
 */
class GenerationService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    title = intent?.getStringExtra(EXTRA_TITLE) ?: title
    text = intent?.getStringExtra(EXTRA_TEXT) ?: text
    progress = -1
    val notification = build(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    running = true
    if (wakeLock == null) {
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LocalMind:generation").apply {
        setReferenceCounted(false)
        acquire(SIX_HOURS)
      }
    }
    // If Android ever stops the service, generation stops with the app; do not
    // restart an empty notification.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL_ID = "localmind-generation"
    private const val NOTIFICATION_ID = 4107
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"
    private const val SIX_HOURS = 6L * 60 * 60 * 1000

    @Volatile private var running = false
    @Volatile private var title = "LocalMind is generating"
    @Volatile private var text = ""
    @Volatile private var progress = -1

    fun startIntent(context: Context, title: String, text: String): Intent =
      Intent(context, GenerationService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_TEXT, text)

    fun update(context: Context, fraction: Double, subtitle: String) {
      if (!running) return
      text = subtitle
      progress = (fraction.coerceIn(0.0, 1.0) * 1000).toInt()
      val manager = NotificationManagerCompat.from(context)
      if (!manager.areNotificationsEnabled()) return
      try {
        manager.notify(NOTIFICATION_ID, build(context))
      } catch (error: SecurityException) {
        // Notification permission withdrawn: the service keeps running.
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, GenerationService::class.java))
    }

    private fun build(context: Context): Notification {
      ensureChannel(context)
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val open = launch?.let {
        PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      val builder = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setProgress(1000, progress.coerceAtLeast(0), progress < 0)
      if (open != null) builder.setContentIntent(open)
      return builder.build()
    }

    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) != null) return
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Generation progress", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while LocalMind writes lessons and quizzes on this phone."
          setShowBadge(false)
        }
      )
    }
  }
}
