import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsButton, TabHeader, TabIcon } from '../../src/nav/chrome';
import { isTabSelected, TAB_BAR_GROUND, TAB_BAR_HEIGHT, TAB_LABEL, tabTint } from '../../src/nav/chromeRules';
import { tabTitle, type TabName } from '../../src/nav/rules';
import { nav } from '../../src/nav/Skeleton';
import { useAccent } from '../../src/theme/accent';

/**
 * The four peers: what is running (Now), what finished (Sessions), where the hours go project by
 * project (Projects), and who you are (You).
 *
 * The bar is the app's theme where it is seen most (design-refs/HOUSE-STYLE.md, "the theme is
 * your creature's colour"): the warm near black ground with one hairline on top, the selected
 * tab's glyph and label in the builder's creature's hue, the rest in the warm grey, and You drawn
 * as the builder's own pixel creature. It repaints the moment the creature changes
 * (`useAccent()`). Every measurement and where it came from is in `src/nav/chromeRules.ts`.
 *
 * Tabs stay the platform's (the Appllama navigation law 5, the frequency gate): no slide between
 * them and no haptic. Selecting one gives its glyph a single small bounce (`TabIcon`). Detail
 * screens (a session, mission control, Wrapped, the analysis, the You pages, Settings) live in
 * the root stack above this navigator, so they push over the bar rather than inside a tab.
 *
 * Social screens (feed, post, factions, u/[handle]) still exist as routes and open by link, but
 * nothing here or on any tab leads to them: the brief puts the social layer out of scope.
 */
export default function TabsLayout() {
  const accent = useAccent();
  const insets = useSafeAreaInsets();
  const tint = tabTint(accent);
  return (
    <Tabs
      screenOptions={{
        // Each tab root wears the platform's large title, left aligned (src/nav/chrome.tsx),
        // not the tab navigator's centred 17pt one.
        header: ({ options }) => (
          <TabHeader
            title={typeof options.title === 'string' ? options.title : ''}
            right={options.headerRight?.({ canGoBack: false, tintColor: nav.text })}
          />
        ),
        sceneStyle: { backgroundColor: nav.bg },
        tabBarActiveTintColor: tint.label,
        tabBarInactiveTintColor: tint.rest,
        tabBarStyle: {
          backgroundColor: TAB_BAR_GROUND.bg,
          borderTopColor: TAB_BAR_GROUND.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: TAB_BAR_HEIGHT + insets.bottom,
        },
        // The glyph and its label, centred in the taller bar rather than hung from its top edge.
        tabBarItemStyle: { justifyContent: 'center' },
        tabBarLabelStyle: TAB_LABEL,
        tabBarAllowFontScaling: false,
        animation: 'none',
      }}
    >
      <Tabs.Screen name="now" options={tab('now')} />
      <Tabs.Screen name="sessions" options={tab('sessions')} />
      <Tabs.Screen name="projects" options={tab('projects')} />
      <Tabs.Screen name="you" options={tab('you', () => <SettingsButton />)} />
    </Tabs>
  );
}

/**
 * A tab's title and glyph. Options are a function so the glyph learns whether its tab is the one
 * showing, from the navigator's own state (`isTabSelected`): the bar draws every glyph twice and
 * its `focused` only says which copy is which, so it cannot tell a selection from a render.
 */
function tab(name: TabName, headerRight?: () => React.ReactNode) {
  return ({ route, navigation }: { route: { key: string }; navigation: { getState(): { index: number; routes: { key: string }[] } } }) => {
    const selected = isTabSelected(navigation.getState(), route.key);
    return {
      title: tabTitle(name),
      ...(headerRight ? { headerRight } : null),
      tabBarIcon: ({ focused, color }: { focused: boolean; color: string }) => (
        <TabIcon tab={name} copy={focused ? 'active' : 'rest'} selected={selected} color={color} />
      ),
    };
  };
}
