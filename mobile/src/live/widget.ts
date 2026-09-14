import { Platform } from 'react-native';

import type { WidgetSnapshot } from './surface';

/**
 * Hand the Home Screen widget its snapshot: a JSON string in the App Group the app and the
 * widget extension share, then a reload. `buildWidgetSnapshot` in `surface.ts` decides what is
 * in it (at most four sessions, mission control order); this only writes it.
 *
 * Reloads while the app is in the foreground do not count against the widget's daily budget
 * (Apple, "Keeping a widget up to date"), which is when this runs.
 *
 * A string, not an object: `ExtensionStorage.set(key, object)` is typed for a flat record and
 * would carry the nested `sessions` array through the bridge untyped. The widget reads either
 * form (`WidgetSnapshot.load` in HomeWidgetViews.swift).
 */

/** Also in app.config.ts (`ios.entitlements`) and HomeWidgetViews.swift (`WidgetSnapshot.appGroup`). */
export const APP_GROUP = 'group.com.vedantlbhatt.Builder';
export const WIDGET_KEY = 'widgetSnapshot';
/** `BuilderHomeWidget.kind` in targets/widget/BuilderHomeWidget.swift. */
export const WIDGET_KIND = 'BuilderHomeWidget';

type ExtensionStorageModule = typeof import('@bacons/apple-targets');

/**
 * Required lazily and only on iOS: the package reads a global `expo` object as it loads, which
 * is there in the iOS runtime and not guaranteed on web.
 */
function storage(): ExtensionStorageModule['ExtensionStorage'] | null {
  if (Platform.OS !== 'ios') return null;
  try {
    return (require('@bacons/apple-targets') as ExtensionStorageModule).ExtensionStorage;
  } catch {
    return null;
  }
}

/** True when the snapshot was handed over. Without the native module (a build from before prebuild) it is a no-op. */
export function writeWidgetSnapshot(snapshot: WidgetSnapshot): boolean {
  const Storage = storage();
  if (!Storage) return false;
  try {
    new Storage(APP_GROUP).set(WIDGET_KEY, JSON.stringify(snapshot));
    Storage.reloadWidget(WIDGET_KIND);
    return true;
  } catch {
    return false;
  }
}

/** Empty the widget (sign out): it falls back to its idle layout. */
export function clearWidgetSnapshot(): void {
  const Storage = storage();
  if (!Storage) return;
  try {
    new Storage(APP_GROUP).remove(WIDGET_KEY);
    Storage.reloadWidget(WIDGET_KIND);
  } catch {
    // nothing to clear
  }
}
