// jest.setup.js
//
// `setupFiles: ['@react-native-async-storage/async-storage/jest/async-storage-mock']`
// does not work: that file only *exports* a mock object, it never registers it.
// Listing it in setupFiles evaluates the module and throws the result away, so
// any module importing AsyncStorage still hit the real native module and failed
// with "[@RNC/AsyncStorage]: NativeModule: AsyncStorage is null".
//
// Registering it here fixes it once for every suite, instead of each test file
// repeating a local jest.mock().

jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
