import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';

import { SettingsButton, TabHeader, TabIcon } from '../../src/nav/chrome';
import { tabTitle } from '../../src/nav/rules';
import { nav } from '../../src/nav/Skeleton';

/**
 * The three peers: what is running (Now), what finished (Sessions), and who you are (You).
 *
 * Tabs are the platform's and nothing more (DESIGN-DIRECTION 3.5, the frequency gate): no
 * slide between them, no haptic, no bounce. Detail screens (a session, mission control,
 * Wrapped, the You pages, Settings) live in the root stack above this navigator, so they push
 * over the bar rather than inside a tab.
 *
 * Social screens (feed, post, factions, u/[handle]) still exist as routes and open by link, but
 * nothing here or on any tab leads to them: the brief puts the social layer out of scope.
 */
export default function TabsLayout() {
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
        // The active tab is the filled glyph in amber (the accent is spent on the active state)
        // over a label in `text`. The label is 10pt, and amber text stops at 13pt semibold
        // (DESIGN-DIRECTION 3.1): a 10pt amber word is the one place the rule broke on every
        // screen. TabIcon paints the amber itself.
        tabBarActiveTintColor: nav.text,
        tabBarInactiveTintColor: nav.textDim,
        tabBarStyle: {
          backgroundColor: nav.bg,
          borderTopColor: nav.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '500', letterSpacing: 0.1 },
        animation: 'none',
      }}
    >
      <Tabs.Screen
        name="now"
        options={{
          title: tabTitle('now'),
          tabBarIcon: ({ focused, color }) => <TabIcon tab="now" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: tabTitle('sessions'),
          tabBarIcon: ({ focused, color }) => <TabIcon tab="sessions" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: tabTitle('you'),
          headerRight: () => <SettingsButton />,
          tabBarIcon: ({ focused, color }) => <TabIcon tab="you" focused={focused} color={color} />,
        }}
      />
    </Tabs>
  );
}
