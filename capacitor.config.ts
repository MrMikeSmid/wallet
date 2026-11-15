import type { CapacitorConfig } from '@capacitor/cli';

// Native app (Android/iOS). Eerst `npx cap add android` / `npx cap add ios`, daarna `npm run cap:sync`.
const config: CapacitorConfig = {
  appId: 'nl.smid.wallet',
  appName: 'Wallet',
  webDir: 'dist',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: {
    // Screenshots alleen blokkeren waar nodig (seed-schermen); de app zet dit zelf aan en uit.
    PrivacyScreen: { enable: false },
  },
};

export default config;
