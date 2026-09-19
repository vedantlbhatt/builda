/**
 * A section's list, kept beside whatever it opened: the Sessions list beside a session, the wall
 * beside a drop, the projects beside a project. The SAME screens the phone's tabs show, mounted
 * once and kept (scrolling a list, opening three sessions and coming back finds it where it was),
 * each told its own column's width through `PaneSize`.
 *
 * The phone opens a detail by pushing it over the list; the desktop leaves the list where it is
 * and the router's stack draws the detail in the pane to its right. Nothing in the screens knows:
 * a row still calls `router.push('/session/<id>')`.
 */
import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import DropsScreen from '../../app/(tabs)/drops';
import { nav } from '../nav/Skeleton';
import { tabTitle } from '../nav/rules';
import { ProjectsScreen } from '../projects/ProjectsScreen';
import { SessionsScreen } from '../session/SessionsScreen';
import { layout } from '../theme';
import { T } from '../ui/Text';
import { PaneSize } from '../web/useWindowDimensions.web';
import { desktopBridge } from './bridge';
import { dragRegion } from './Sidebar';

export type MasterName = 'sessions' | 'drops' | 'projects';

/** The column's title row; the wall draws its own head (the count and the search line). */
const TITLE_ROW = 52;

export function MasterColumn({ which, visible, width, height, x }: { which: MasterName; visible: boolean; width: number; height: number; x: number }) {
  // A list that is not on show keeps its last width, off the window's edge, rather than going to
  // display:none: it stays laid out, so coming back finds it drawn where it was, not re-measuring.
  const last = useRef(width || 400);
  if (visible && width > 0) last.current = width;
  const titled = which !== 'drops';
  const mac = desktopBridge()?.platform === 'darwin';
  const top = titled ? TITLE_ROW : mac ? 28 : 0;
  return (
    <View
      style={[styles.column, visible ? { width } : [styles.away, { width: last.current }]]}
      accessibilityLabel={tabTitle(which)}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <View style={[styles.head, { height: top }]} {...dragRegion()}>
        {titled ? (
          <T role="title" style={{ color: nav.text }} numberOfLines={1}>
            {tabTitle(which)}
          </T>
        ) : null}
      </View>
      <View style={styles.body}>
        <PaneSize size={{ width: last.current, height: height - top, x }}>
          {which === 'sessions' ? <SessionsScreen /> : which === 'projects' ? <ProjectsScreen /> : <DropsScreen />}
        </PaneSize>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { backgroundColor: nav.bg, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: nav.border },
  away: { position: 'absolute', left: -20000, top: 0, bottom: 0 },
  head: { justifyContent: 'flex-end', paddingHorizontal: layout.gutter, paddingBottom: 6 },
  body: { flex: 1, overflow: 'hidden' },
});
