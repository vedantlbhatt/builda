/**
 * The share extension: what comes up when you hit share on a reel and pick Builda.
 *
 * CommonJS, like targets/widget, because @bacons/apple-targets 4.0.7 does not load ESM or
 * TypeScript target configs. It shares the app's App Group, which is the whole mechanism: the
 * extension writes the link there (`BuilderDropsInbox`) and the app drains it on the next
 * foreground. The extension never talks to the API, for the reason BuilderDropsModule.swift
 * gives: the account's tokens are behind the app's keychain access group, and an extension that
 * could post would be a second client of the API with a second set of rules.
 *
 * `BuilderDropsInbox.swift` here is a SYMLINK to the copy in modules/builder-drops/ios. The
 * extension and the app both need the queue's key, its cap and its shape, and they are compiled
 * into two different binaries, so the choice was a symlink or a second copy. A second copy of
 * "what a queued drop looks like" is how a share silently stops arriving one release after
 * somebody edits one of them.
 *
 * After touching this file or targets/, prebuild with `--clean` (apple-targets issue 201).
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'share',
  name: 'BuilderShare',
  displayName: 'Builda',
  bundleIdentifier: '.share',
  // 16.0: the sheet is SwiftUI with `presentationDetents`, which is 16.
  deploymentTarget: '16.0',
  frameworks: ['SwiftUI', 'UniformTypeIdentifiers'],
  colors: {
    $accent: '#FFB300',
  },
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
