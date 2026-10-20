'use strict';
/*
 * Config electron-builder.
 * Firma Developer ID + notarizzazione Apple SOLO se i secret sono presenti in CI
 * (CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID):
 * in quel caso l'app mac esce firmata e notarizzata (zero avvisi Gatekeeper).
 * Senza secret: build ad-hoc, apribile con clic destro -> Apri (o xattr).
 */
const signed = !!(
  process.env.CSC_LINK &&
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
);

const macExtra = signed
  ? {
      hardenedRuntime: true,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      notarize: { teamId: process.env.APPLE_TEAM_ID }
    }
  : { hardenedRuntime: false };

module.exports = {
  appId: 'it.simonescaffidi.yondesk',
  productName: 'Yondesk',
  npmRebuild: false,
  publish: [{ provider: 'github', owner: 'simonescaffidi', repo: 'yondesk' }],
  directories: { output: 'dist', buildResources: 'build' },
  files: ['src/**/*', 'package.json'],
  asarUnpack: ['**/node_modules/@nut-tree-fork/**'],
  // Due formati Windows: 'portable' (gira senza installare, zero admin/collegamenti,
  // aggira l'errore del collegamento) e 'nsis' (installer classico, per-macchina).
  win: { target: ['portable', 'nsis'], icon: 'build/icon.ico' },
  portable: { artifactName: 'Yondesk-portable.${ext}' },
  nsis: {
    artifactName: 'Yondesk-Setup.${ext}',
    oneClick: false,
    perMachine: true,
    allowElevation: true,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Yondesk',
    deleteAppDataOnUninstall: false
  },
  mac: Object.assign(
    {
      target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
      artifactName: 'Yondesk-mac-${arch}.${ext}',
      category: 'public.app-category.utilities',
      gatekeeperAssess: false
    },
    macExtra
  ),
  linux: {
    target: ['AppImage', 'deb'],
    artifactName: 'Yondesk.${ext}',
    category: 'Utility',
    maintainer: 'www.simonescaffidi.it'
  }
};
