// Release signing from Gradle properties (FA_STORE_FILE, FA_STORE_PASSWORD, FA_KEY_ALIAS, FA_KEY_PASSWORD), e.g. in
// ~/.gradle/gradle.properties — never committed. Without them the release build falls back to the debug key.
const { withAppBuildGradle } = require('expo/config-plugins');
module.exports = (config) => withAppBuildGradle(config, (c) => {
  let g = c.modResults.contents;
  if (g.includes('FA_STORE_FILE')) return c;
  g = g.replace(/signingConfigs\s*\{/, `signingConfigs {
        release {
            if (project.hasProperty('FA_STORE_FILE')) {
                storeFile file(FA_STORE_FILE)
                storePassword FA_STORE_PASSWORD
                keyAlias FA_KEY_ALIAS
                keyPassword FA_KEY_PASSWORD
            }
        }`);
  g = g.replace(/(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/, `$1signingConfig project.hasProperty('FA_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`);
  c.modResults.contents = g; return c;
});
