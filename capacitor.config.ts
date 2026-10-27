import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.beardify.app',
  appName: 'Beardify',
  webDir: 'dist',
  backgroundColor: '#0d0d0f',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};

export default config;
