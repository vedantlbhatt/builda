/**
 * The widget extension: the Home Screen widget and the Live Activity (Lock Screen + Dynamic
 * Island) in one target. CommonJS on purpose: @bacons/apple-targets 4.0.7 does not load ESM or
 * TypeScript target configs. Everything under targets/widget/ is compiled into the extension;
 * _shared/ also goes into the main app (the ActivityAttributes and the debug renderer).
 *
 * Only the two colours the SYSTEM reads by name are here: the widget gallery's tint and the
 * configuration background. The plugin writes colorsets as display-p3 from sRGB hex, so every
 * colour the views draw is an sRGB literal in _shared/Palette.swift instead. The creature
 * images in Assets.xcassets come from scripts/gen_widget_creatures.py.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'widget',
  name: 'BuilderWidgets',
  displayName: 'Builder',
  bundleIdentifier: '.widgets',
  // 17.0, not the plugin's 18.0 default: containerBackground and #Preview for widgets are 17.
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
  colors: {
    $accent: '#FFB300',
    $widgetBackground: { light: '#FBF9F5', dark: '#141210' },
  },
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
