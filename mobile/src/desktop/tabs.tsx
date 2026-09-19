/**
 * What the tab navigator does differently on a desktop, as props to spread onto `<Tabs>`.
 * Nothing at all on a phone: `desktopTabs(false)` is an empty object, so the phone's navigator
 * gets exactly the props it had.
 *
 * On a desktop the sidebar (`Sidebar.tsx`) is the tab bar, so the bar itself draws nothing; and
 * the three tabs whose screen is a list (Sessions, Drops, Projects) draw nothing either, because
 * that list lives in the master column beside the detail (`Master.tsx`), mounted once. Without
 * this the navigator would keep a second, hidden copy of each list syncing behind the first.
 */
import React from 'react';

const MASTER_TABS: ReadonlySet<string> = new Set(['sessions', 'drops', 'projects']);

const noBar = () => null;
const listsLiveBeside = ({ route, children }: { route: { name: string }; children: React.ReactElement }) =>
  MASTER_TABS.has(route.name) ? <></> : children;

export function desktopTabs(desktop: boolean): { tabBar?: () => null; screenLayout?: typeof listsLiveBeside } {
  return desktop ? { tabBar: noBar, screenLayout: listsLiveBeside } : {};
}
