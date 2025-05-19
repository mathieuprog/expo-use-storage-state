# expo-use-storage-state

A React hook for syncing JSON-serializable state with Expo’s `SecureStore` or `localStorage` (web).

## Installation

```bash
npm install expo-use-storage-state
# or
yarn add expo-use-storage-state
```

## Usage

### 1. Import the hook in your component:

```ts
import { useStorageState } from 'expo-use-storage-state';
```

### 2. Call it inside any React component:

```ts
interface AppSettings {
  darkMode: boolean;
  fontSize: number;
}

function MyComponent() {
  const [{ loading, error, value }, setValue] = useStorageState<AppSettings>('app-settings');

  // …
}
```

### 3. Handle the async setter:

```ts
try {
  await setValue(newValue);
} catch (err) {
  // err is a StorageWriteError or StorageStringifyError
}
```

### 4. Optionally pass a custom logger or onError callback:

```ts
useStorageState('myKey', {
  logger: customLogger,
  onError: (err) => {
    Toast.show({ type: 'error', text1: err.operation + ' failed', text2: err.message });
    // send the error to your monitoring service
  },
});
```

Make sure you also have these peer dependencies installed in your project:

```bash
npm install react react-native expo-secure-store
```
