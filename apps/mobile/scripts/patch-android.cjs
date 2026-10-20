// Applies the crash-safe startup to the generated android/ project (android/ is not in git; re-run after `expo prebuild`).
const fs = require('fs'); const path = require('path');
const app = path.join(__dirname, '../android/app/src/main');
const pkg = path.join(app, 'java/ge/financial/analytics');
fs.copyFileSync(path.join(__dirname, '../native/CrashActivity.kt'), path.join(pkg, 'CrashActivity.kt'));
const mf = path.join(app, 'AndroidManifest.xml'); let m = fs.readFileSync(mf, 'utf8');
if (!m.includes('.CrashActivity')) m = m.replace('<activity android:name=".MainActivity"', '<activity android:name=".CrashActivity" android:process=":crash" android:exported="false" android:theme="@android:style/Theme.Material.Light.NoActionBar"/>\n    <activity android:name=".MainActivity"');
fs.writeFileSync(mf, m);
const ma = path.join(pkg, 'MainApplication.kt'); let a = fs.readFileSync(ma, 'utf8');
if (!a.includes('CrashLog.install')) {
  a = a.replace('  override fun onCreate() {\n    super.onCreate()\n', '  override fun onCreate() {\n    super.onCreate()\n    CrashLog.install(this)\n    if (CrashLog.isCrashProcess()) return\n    try {\n');
  a = a.replace('    ApplicationLifecycleDispatcher.onApplicationCreate(this)\n  }', '    ApplicationLifecycleDispatcher.onApplicationCreate(this)\n    } catch (e: Throwable) { CrashLog.show(this, e, "startup (Application.onCreate)") }\n  }');
  fs.writeFileSync(ma, a);
}
const act = path.join(pkg, 'MainActivity.kt'); let b = fs.readFileSync(act, 'utf8');
if (!b.includes('CrashLog.show')) {
  b = b.replace('    setTheme(R.style.AppTheme);\n    super.onCreate(null)', '    setTheme(R.style.AppTheme);\n    try { super.onCreate(null) } catch (e: Throwable) { CrashLog.show(this, e, "startup (MainActivity.onCreate)") }');
  fs.writeFileSync(act, b);
}
console.log('android patched: crash screen + safe startup');
