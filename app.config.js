export default {
  expo: {
    name: 'Prowl',
    slug: 'prowl',
    version: '1.0.0',
    newArchEnabled: false,
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    backgroundColor: '#160F1F',
    icon: './assets/icon.png',
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.prowl.app',
      infoPlist: {
        // Lets Linking.canOpenURL('whatsapp://…') work for adoption contacts.
        LSApplicationQueriesSchemes: ['whatsapp'],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#160F1F',
      },
      package: 'com.prowl.app',
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY,
        },
      },
      // RECORD_AUDIO deliberately absent: expo-camera declares it for video
      // capture, which Prowl does not use, and it would force a microphone
      // disclosure in Play's Data Safety form. Also stripped from the native
      // manifest via tools:node="remove" — this list alone only affects a fresh
      // `expo prebuild`, and android/ is committed.
      permissions: [
        'android.permission.CAMERA',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
      ],
    },
    plugins: [
      ['expo-camera', { cameraPermission: 'Allow Prowl to use your camera to log pet sightings.' }],
      ['expo-image-picker', { photosPermission: 'Allow Prowl to access your photos to attach to sightings.' }],
      ['expo-location', { locationWhenInUsePermission: 'Allow Prowl to use your location to find nearby pets and log sightings.' }],
      'expo-font',
      // Only read by a fresh `expo prebuild` — android/ is committed, so the
      // same colour and image are also set in its res/ directly.
      ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 180, backgroundColor: '#160F1F' }],
    ],
    extra: {
      eas: {
        projectId: 'acbfaf63-f2cd-4045-a3c4-635d22886750',
      },
    },
  },
};
