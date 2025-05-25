# expo-use-storage-state

A React hook for syncing JSON state with AsyncStorage or SecureStore (mobile) and localStorage (web).

## Installation

```bash
npm install expo-use-storage-state
# or
yarn add expo-use-storage-state
```

## Usage

### React Hooks

#### 1. Import the hook in your component:

```ts
import { useKeyValueStorage, useSecureKeyValueStorage } from 'expo-use-storage-state';
```

#### 2. Call it inside any React component:

```ts
interface AppSettings {
  darkMode: boolean;
  fontSize: number;
}

function MyComponent() {
  const [{ isLoading, error, value }, setValue] =
    useKeyValueStorage<AppSettings>('app-settings', { useSecure: false });

  // …
}
```

#### useSecureKeyValueStorage

For convenience, you can use `useSecureKeyValueStorage` which automatically sets `useSecure: true`:

```ts
function MyComponent() {
  const [{ isLoading, error, value }, setValue] =
    useSecureKeyValueStorage<AppSettings>('secure-settings');

  // This is equivalent to:
  // useKeyValueStorage<AppSettings>('secure-settings', { useSecure: true });
}
```

#### useSecure?: boolean

On mobile platforms (iOS/Android), set this to true to back your state with Expo's SecureStore instead of AsyncStorage. Defaults to false.

#### 3. Handle the async setter:

```ts
try {
  await setValue(newValue);
} catch (err) {
  // err is a StorageWriteError or StorageStringifyError
}
```

#### 4. Optionally pass a custom logger or onError callback:

```ts
useKeyValueStorage('myKey', {
  logger: customLogger,
  onError: (err) => {
    Toast.show({ type: 'error', text1: err.operation + ' failed', text2: err.message });
    // send the error to your monitoring service
  },
  // on native, use SecureStore instead of AsyncStorage
  useSecure: true,
});
```

### Outside React Context

When you need to access storage outside of React components (e.g., in utility functions, API calls, or other non-React code), you can use the standalone storage objects:

```ts
import { keyValueStorage, secureKeyValueStorage } from 'expo-use-storage-state';

// For regular storage (AsyncStorage on mobile, localStorage on web)
await keyValueStorage.set('myKey', 'myValue');
const value = await keyValueStorage.get('myKey');
await keyValueStorage.remove('myKey');

// For secure storage (SecureStore on mobile, localStorage on web)
await secureKeyValueStorage.set('sensitiveKey', 'sensitiveValue');
const sensitiveValue = await secureKeyValueStorage.get('sensitiveKey');
await secureKeyValueStorage.remove('sensitiveKey');
```

These standalone objects provide the same storage backend selection logic as the hooks but can be used anywhere in your application.

## Dependencies

Make sure you also have these peer dependencies installed in your project:

```bash
npm install react react-native expo-secure-store @react-native-async-storage/async-storage
```
