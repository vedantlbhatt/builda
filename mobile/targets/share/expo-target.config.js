/**
 * The share extension: what comes up when you hit share on a reel and pick Builda.
 *
 * CommonJS, like targets/widget, because @bacons/apple-targets 4.0.7 does not load ESM or
 * TypeScript target configs. It shares the app's App Group, which is the whole mechanism: the
 * extension writes the link there (`BuilderDropsInbox`) and the app drains it on the next
 * foreground. Since docs/drop-island.md it may ALSO call one route, `POST /v1/drops`, with the
 * copy of the app's fifteen minute access token the app keeps in the App Group's keychain
 * (`BuilderDropsCredential`; never the refresh token), so the Mac reads a reel while you are
 * still in Instagram and the Dynamic Island carries the answer. Any failure falls back to the
 * queue, which is unchanged. The App Group entitlement is also what grants that keychain item:
 * an item in an App Group's access group is readable by the targets holding the group and by
 * nothing else, so no keychain sharing entitlement is added.
 *
 * `BuilderDropsCredential.swift`, `BuilderDropsURL.swift` and `BuilderDropsShare.swift` are
 * symlinks into modules/builder-drops/ios as well, for the reason given below.
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
