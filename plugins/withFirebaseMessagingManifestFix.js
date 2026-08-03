const { withAndroidManifest } = require("@expo/config-plugins");

const DEFAULT_NOTIFICATION_COLOR =
  "com.google.firebase.messaging.default_notification_color";

module.exports = function withFirebaseMessagingManifestFix(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";

    const application = manifest.application?.[0];
    const metadata = application?.["meta-data"] || [];
    const notificationColor = metadata.find(
      (entry) => entry.$?.["android:name"] === DEFAULT_NOTIFICATION_COLOR,
    );

    if (notificationColor?.$) {
      notificationColor.$["tools:replace"] = "android:resource";
    }

    return configWithManifest;
  });
};
