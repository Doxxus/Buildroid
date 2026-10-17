import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: process.env.APP_ID ?? 'com.example.wrapper',
  appName: process.env.APP_NAME ?? 'Site Wrapper',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
    cleartext: false,
    // Only the local bundle origin; everything else is opened in the system browser.
    allowNavigation: [],
  },
  android: {
    allowMixedContent: false,
    // Always off here; BundlePointerPlugin enables it only for debuggable builds.
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: { launchAutoHide: false, backgroundColor: '#ffffff', androidScaleType: 'CENTER_CROP' },
  },
};

export default config;
