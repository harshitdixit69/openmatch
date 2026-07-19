module.exports = {
  preset: 'jest-expo',
  transform: {
    '^.+\\.(js|ts|tsx)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverage: true,
  collectCoverageFrom: [
    'src/lib/activityStatsApi.ts',
    'src/lib/conciergeApi.ts',
    'src/lib/shortlistApi.ts',
    'src/lib/profileViewsApi.ts',
    'src/lib/voiceIntroApi.ts',
    'src/lib/partnerPreferencesApi.ts',
    'src/lib/notificationsApi.ts',
    'src/screens/ConciergeHubScreen.tsx',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['@testing-library/react-native/extend-expect'],
};
