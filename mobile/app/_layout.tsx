import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { LogBox, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { handleIncomingUrl } from '../src/auth/googleFlow';
import { api } from '../src/data/client';
import { usePendingNameSync, useOnboarded } from '../src/nav/onboarding';
import { tabTitle } from '../src/nav/rules';
import { HeaderRule } from '../src/nav/chrome';
import { useNotificationResponseRouting } from '../src/push/push';
import { colors } from '../src/theme';

/**
 * A deep link lands with the tabs underneath it, so back from a session opened by a push or a
 * pasted link goes to the app rather than nowhere (the skill's navigation law 5).
 */
export const unstable_settings = { anchor: '(tabs)' };

// expo-av's SDK 54 deprecation is known (it records the social voice note; the move is to
// expo-audio). Its dev toast sat over the tab bar in every simulator screenshot. Only that one
// message is hidden, only from the on-device toast: Metro still prints it.
if (__DEV__) LogBox.ignoreLogs(['[expo-av]: Expo AV has been deprecated']);

/**
 * Dark by default and not (yet) switchable.
 *
 * The strip's identity colour is an amber that was tuned against a dark ground; a light
 * scheme needs its own pass on those tokens rather than an automatic inversion, and
 * shipping a half-tuned light mode would make the product's one recognisable asset look
 * wrong on half the devices.
 *
 * The route tree, the gate and every deep link are written down in `src/nav/DEEPLINKS.md`.
 */
export default function RootLayout() {
  const c = colors('dark');
  // null until the flag is read. Nothing is navigable until then: a cold start must not
  // flash onboarding at someone who finished it, or the tabs at someone who has not.
  const onboarded = useOnboarded();

  // A tapped "Session finished" / "Agent run finished" push opens that session's recap.
  // At the root for the same reason the Google redirect is: the tap that launched the
  // app happened before any screen existed.
  useNotificationResponseRouting();

  // A name typed in onboarding while signed out reaches the account at the first chance.
  usePendingNameSync();

  // Google sign-in comes back through the app scheme (`builder://auth/google#id_token=…`).
  // It is handled here, at the root, rather than in Settings: the redirect can arrive at
  // a cold start, before any screen has mounted. `+native-intent.ts` keeps the router from
  // treating the same URL as a route.
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleIncomingUrl(url, api);
    });
    void Linking.getInitialURL().then((url) => {
      if (url) void handleIncomingUrl(url, api);
    });
    return () => sub.remove();
  }, []);

  // GestureHandlerRootView has to sit above every screen or `Gesture.*` handlers never
  // receive touches; it is a plain View, so it gets the canvas colour and flex 1 to avoid a
  // white frame behind the stack on cold start. KeyboardProvider sits inside it so
  // keyboard tracking (`useReanimatedKeyboardAnimation`, `KeyboardStickyView`) works on
  // any screen that asks for it and costs nothing on the ones that do not.
  return (
    <GestureHandlerRootView style={[styles.root, { backgroundColor: c.bg }]}>
      <KeyboardProvider>
        <StatusBar style="light" />
        {onboarded !== null && (
          <Stack
            screenOptions={{
              // The bar is the canvas with one warm hairline under it, the same rule the tab
              // roots draw (src/nav/chrome.tsx). UIKit's own shadow is the system separator,
              // a cool grey the palette does not have, and with no rule at all a scrolled
              // line of text was cut off at an edge nobody could see.
              headerBackground: () => <HeaderRule />,
              headerTintColor: c.text,
              headerTitleStyle: { fontWeight: '600' },
              contentStyle: { backgroundColor: c.bg },
            }}
          >
            {/* The app. Every screen is listed so none of them exists before onboarding:
                an unlisted route would be added to the stack whatever the guard says. The
                first one is where the stack lands when the gate opens. */}
            <Stack.Protected guard={onboarded}>
              <Stack.Screen
                name="(tabs)"
                options={({ route }) => ({
                  headerShown: false,
                  animation: 'fade',
                  // The back label on everything pushed over the tabs: the tab it came from.
                  title: tabTitle(getFocusedRouteNameFromRoute(route)),
                })}
              />
              <Stack.Screen name="session/[id]" options={{ title: '' }} />
              <Stack.Screen name="live" options={{ title: 'Mission control' }} />
              <Stack.Screen
                name="wrapped"
                options={{ presentation: 'fullScreenModal', headerShown: false }}
              />
              <Stack.Screen name="you/dimensions" options={{ title: 'Dimensions' }} />
              <Stack.Screen name="you/money" options={{ title: 'Money' }} />
              <Stack.Screen name="you/stack" options={{ title: 'Your stack' }} />
              <Stack.Screen name="you/glossary" options={{ title: 'Glossary' }} />
              <Stack.Screen name="you/map/[id]" options={{ title: 'Codebase map' }} />
              <Stack.Screen name="you/timelapse/[id]" options={{ title: 'Time lapse' }} />
              <Stack.Screen name="settings" options={{ title: 'Settings' }} />
              <Stack.Screen name="pair" options={{ title: 'Connect your Mac' }} />
              <Stack.Screen name="icon" options={{ title: 'Your creature' }} />
              {/* Social: out of scope for now (brief). The routes stay so old links and the
                  session screen's post flow still resolve; no tab or row leads here. */}
              <Stack.Screen name="feed" options={{ title: 'Feed' }} />
              <Stack.Screen name="post/[id]" options={{ title: 'Post' }} />
              <Stack.Screen name="factions" options={{ title: 'Factions' }} />
              <Stack.Screen name="u/[handle]" options={{ title: '' }} />
            </Stack.Protected>

            {/* Onboarding, until it is finished. Finishing flips the guard: this group leaves
                the stack in the same render the tabs arrive, which is the one-way door. */}
            <Stack.Protected guard={!onboarded}>
              <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade' }} />
            </Stack.Protected>

            {/* Dev tools, reachable in either state and absent from release builds. */}
            <Stack.Protected guard={__DEV__}>
              <Stack.Screen
                name="dev-auth"
                options={{ title: 'Dev auth', headerShown: false, animation: 'none', gestureEnabled: false }}
              />
              <Stack.Screen name="dev-gallery" options={{ title: 'Kit gallery' }} />
            </Stack.Protected>
          </Stack>
        )}
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
