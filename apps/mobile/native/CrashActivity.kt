package ge.financial.analytics

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File

/** Shown instead of closing when the app crashed: the error text, so it can be copied and reported. Runs in its own process. */
class CrashActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val text = CrashLog.read(this) ?: "No crash details were saved."
    val pad = (16 * resources.displayMetrics.density).toInt()
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad * 2, pad, pad) }
    root.addView(TextView(this).apply { this.text = "Finance app could not start"; textSize = 20f })
    root.addView(TextView(this).apply { this.text = "Please send a screenshot or copy of this text:"; setPadding(0, pad / 2, 0, pad / 2) })
    val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    buttons.addView(Button(this).apply { this.text = "Copy"; setOnClickListener {
      (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("crash", text)) } })
    buttons.addView(Button(this).apply { this.text = "Try again"; setOnClickListener {
      CrashLog.clear(this@CrashActivity)
      startActivity(Intent(this@CrashActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)); finish() } })
    root.addView(buttons)
    root.addView(ScrollView(this).apply { addView(TextView(this@CrashActivity).apply { this.text = text; textSize = 11f; setTextIsSelectable(true) }) })
    setContentView(root)
  }
}

object CrashLog {
  private fun file(c: Context) = File(c.filesDir, "last_crash.txt")
  fun write(c: Context, t: Throwable, where: String) {
    try { file(c).writeText("${java.util.Date()} — $where\nApp ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}), Android ${android.os.Build.VERSION.RELEASE} (SDK ${android.os.Build.VERSION.SDK_INT}), ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}, ABI ${android.os.Build.SUPPORTED_ABIS.joinToString()}\n\n${android.util.Log.getStackTraceString(t)}") } catch (_: Throwable) {}
  }
  fun read(c: Context): String? = try { file(c).takeIf { it.exists() }?.readText() } catch (_: Throwable) { null }
  fun clear(c: Context) { try { file(c).delete() } catch (_: Throwable) {} }
  /** Save the error and open the crash screen in its own process, then end this one. */
  fun show(c: Context, t: Throwable, where: String) {
    write(c, t, where)
    try { c.startActivity(Intent(c, CrashActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)) } catch (_: Throwable) {}
    android.os.Process.killProcess(android.os.Process.myPid()); System.exit(10)
  }
  fun install(app: android.app.Application) {
    if (isCrashProcess()) return
    Thread.setDefaultUncaughtExceptionHandler { th, e -> show(app, e, "uncaught on thread ${th.name}") }
  }
  fun isCrashProcess(): Boolean = try { android.os.Build.VERSION.SDK_INT >= 28 && android.app.Application.getProcessName().endsWith(":crash") } catch (_: Throwable) { false }
}
