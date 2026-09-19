// @ts-check
'use strict';
/**
 * The application menu: the platform's standard roles (so copy, paste, undo, zoom and full screen
 * behave the way every other app on the machine does), plus the app's own commands, each of which
 * is a message to the page (`bridge.onCommand`), the same commands its keyboard handler runs.
 */
const { Menu, app } = require('electron');

/**
 * @param {{ send: (command: string) => void, pasteLink: () => void, island: { enabled: () => boolean, toggle: () => void }, showMain: () => void }} o
 */
function buildMenu(o) {
  const mac = process.platform === 'darwin';
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const sections = [
    { label: 'Now', accelerator: 'CmdOrCtrl+1', click: () => o.send('tab:now') },
    { label: 'Sessions', accelerator: 'CmdOrCtrl+2', click: () => o.send('tab:sessions') },
    { label: 'Drops', accelerator: 'CmdOrCtrl+3', click: () => o.send('tab:drops') },
    { label: 'Projects', accelerator: 'CmdOrCtrl+4', click: () => o.send('tab:projects') },
    { label: 'You', accelerator: 'CmdOrCtrl+5', click: () => o.send('tab:you') },
  ];
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    ...(mac
      ? [
          /** @type {import('electron').MenuItemConstructorOptions} */ ({
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => o.send('settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          }),
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Drop the Link on the Clipboard', accelerator: 'CmdOrCtrl+Shift+V', click: () => o.pasteLink() },
        { label: 'Go to…', accelerator: 'CmdOrCtrl+K', click: () => o.send('search') },
        { type: 'separator' },
        ...(mac ? [] : [/** @type {import('electron').MenuItemConstructorOptions} */ ({ label: 'Settings', accelerator: 'Ctrl+,', click: () => o.send('settings') }), { type: /** @type {const} */ ('separator') }]),
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...sections,
        { type: 'separator' },
        { label: 'Back', accelerator: mac ? 'Cmd+[' : 'Alt+Left', click: () => o.send('back') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: () => o.send('sidebar') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Builda', accelerator: 'CmdOrCtrl+0', click: () => o.showMain() },
        { label: 'Show the Island', type: 'checkbox', checked: o.island.enabled(), click: () => o.island.toggle() },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        ...(mac ? [/** @type {import('electron').MenuItemConstructorOptions} */ ({ type: 'separator' }), { role: /** @type {const} */ ('front') }] : []),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
