'use strict';
/*
 * Config electron-builder.
 * Firma Developer ID + notarizzazione Apple SOLO se i secret sono presenti in CI:
 * certificato nel portachiavi preparato dal workflow (MAC_FIRMATA=1, CSC_NAME, CSC_KEYCHAIN), team (APPLE_TEAM_ID) e chiave API App Store Connect
 * (APPLE_API_KEY = percorso del file .p8, APPLE_API_KEY_ID, APPLE_API_ISSUER).
 * In quel caso l'app mac esce firmata e notarizzata (nessun avviso Gatekeeper).
 * Senza secret: build ad-hoc, apribile con clic destro -> Apri.
 */
const signed = !!(
  process.env.MAC_FIRMATA === '1' &&
  process.env.APPLE_TEAM_ID &&
  process.env.APPLE_API_KEY &&
  process.env.APPLE_API_KEY_ID &&
  process.env.APPLE_API_ISSUER
);

const macExtra = signed
  ? {
      hardenedRuntime: true,
      entitlements: 'resources/entitlements.mac.plist',
      entitlementsInherit: 'resources/entitlements.mac.plist',
      notarize: { teamId: process.env.APPLE_TEAM_ID }
    }
  : { hardenedRuntime: false };

module.exports = {
  appId: 'it.simonescaffidi.yondesk',
  productName: 'Yondesk',
  npmRebuild: false,
  publish: [{ provider: 'github', owner: 'simonescaffidi', repo: 'yondesk' }],
  directories: { output: 'dist', buildResources: 'resources' },
  icon: 'src/assets/icon.png', // 512x512: electron-builder genera .ico/.icns/icone Linux
  files: ['src/**/*', 'package.json'],
  asarUnpack: ['**/node_modules/@nut-tree-fork/**'],
  // Due formati Windows: 'portable' (gira senza installare, zero admin/collegamenti,
  // aggira l'errore del collegamento) e 'nsis' (installer classico, per-macchina).
  win: { target: ['portable', 'nsis'] },
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
      gatekeeperAssess: false,
      extendInfo: {
        NSScreenCaptureUsageDescription: 'Yondesk mostra il tuo schermo all\'operatore solo durante le sessioni di assistenza che accetti.'
      }
    },
    macExtra
  ),
  linux: {
    target: ['AppImage', 'deb'],
    artifactName: 'Yondesk.${ext}',
    category: 'Utility',
    executableName: 'yondesk',
    synopsis: 'Assistenza e controllo remoto',
    maintainer: 'Simone Scaffidi <info@simonescaffidi.it>'
  }
};
