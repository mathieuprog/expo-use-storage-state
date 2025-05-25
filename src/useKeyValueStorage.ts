import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Publisher, { type Subscriber } from './Publisher';

const isWeb = Platform.OS === 'web';

type Operation = 'read' | 'write' | 'delete' | 'parse' | 'stringify';
type StorageOpts = ErrorOptions & { key?: string; operation?: Operation };

export class StorageError extends Error {
  readonly key?: string;
  readonly operation?: Operation;

  constructor(message: string, opts: StorageOpts = {}) {
    super(message, { cause: opts.cause });
    if (Error.captureStackTrace) Error.captureStackTrace(this, StorageError);
    this.key = opts.key;
    this.operation = opts.operation;
  }
}

export class StorageReadError extends StorageError {
  constructor(message: string, opts: Omit<StorageOpts, 'operation'> = {}) {
    super(message, { ...opts, operation: 'read' });
  }
}

export class StorageWriteError extends StorageError {
  constructor(message: string, opts: Omit<StorageOpts, 'operation'> = {}) {
    super(message, { ...opts, operation: 'write' });
  }
}

export class StorageDeleteError extends StorageError {
  constructor(message: string, opts: Omit<StorageOpts, 'operation'> = {}) {
    super(message, { ...opts, operation: 'delete' });
  }
}

export class StorageParseError extends StorageError {
  constructor(message: string, opts: Omit<StorageOpts, 'operation'> = {}) {
    super(message, { ...opts, operation: 'parse' });
  }
}

export class StorageStringifyError extends StorageError {
  constructor(message: string, opts: Omit<StorageOpts, 'operation'> = {}) {
    super(message, { ...opts, operation: 'stringify' });
  }
}

const toStorageError = (e: unknown, key: string): StorageError =>
  e instanceof StorageError
    ? e
    : e instanceof Error
        ? new StorageError(e.message, { cause: e, key })
        : new StorageError(String(e), { cause: e, key });

interface Backend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, rawValue: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const withStorageErrorHandling = (backend: Backend): Backend => ({
  getItem: async (k) => {
    try {
      return await backend.getItem(k);
    } catch (cause) {
      throw new StorageReadError(`Failed to read ${k}`, { cause, key: k });
    }
  },
  setItem: async (k, v) => {
    try {
      return await backend.setItem(k, v);
    } catch (cause) {
      throw new StorageWriteError(`Failed to write ${k}`, { cause, key: k });
    }
  },
  removeItem: async (k) => {
    try {
      return await backend.removeItem(k);
    } catch (cause) {
      throw new StorageDeleteError(`Failed to delete ${k}`, { cause, key: k });
    }
  },
});

const localStorageBackend_: Backend = {
  getItem: (k: string) => Promise.resolve(localStorage.getItem(k)),
  setItem: (k: string, v: string) => { localStorage.setItem(k, v); return Promise.resolve(); },
  removeItem: (k: string) => { localStorage.removeItem(k); return Promise.resolve(); },
};

const secureStoreBackend_: Backend = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

const asyncStorageBackend_: Backend = {
  getItem: AsyncStorage.getItem,
  setItem: AsyncStorage.setItem,
  removeItem: AsyncStorage.removeItem,
};

const localStorageBackend = withStorageErrorHandling(localStorageBackend_);
const secureStoreBackend = withStorageErrorHandling(secureStoreBackend_);
const asyncStorageBackend = withStorageErrorHandling(asyncStorageBackend_);

function pickBackend(useSecure: boolean): Backend {
  if (isWeb) return localStorageBackend;
  return useSecure ? secureStoreBackend : asyncStorageBackend;
}

const storageChangePublisher = new Publisher();

export const secureKeyValueStorage = {
  get: (key: string) =>
    pickBackend(true).getItem(key),

  set: async (key: string, rawValue: string) => {
    storageChangePublisher.notifySubscribers(key, rawValue);
    await pickBackend(true).setItem(key, rawValue);
  },

  remove: async (key: string) => {
    storageChangePublisher.notifySubscribers(key, null);
    await pickBackend(true).removeItem(key);
  },
};

export const keyValueStorage = {
  get: (key: string) =>
    pickBackend(false).getItem(key),

  set: async (key: string, rawValue: string) => {
    storageChangePublisher.notifySubscribers(key, rawValue);
    await pickBackend(false).setItem(key, rawValue);
  },

  remove: async (key: string) => {
    storageChangePublisher.notifySubscribers(key, null);
    await pickBackend(false).removeItem(key);
  },
};

export type StorageState<T> = {
  isLoading: boolean;
  error: StorageError | null;
  value: T | null;
};

export type UseStorageStateHook<T> = [StorageState<T>, (v: T | null) => Promise<void>];

export interface StorageHookOptions {
  logger?: Pick<Console, 'error'>;
  onError?: (err: StorageError) => void;
  /**
   * On mobile platforms (non-web), use SecureStore if true, otherwise AsyncStorage.
   * Web always uses localStorage.
   */
  useSecure?: boolean;
}

export function useSecureKeyValueStorage<T>(key: string, opts: StorageHookOptions = {}): UseStorageStateHook<T> {
  return useKeyValueStorage(key, { ...opts, useSecure: true });
}

export function useKeyValueStorage<T>(key: string, opts: StorageHookOptions = {}): UseStorageStateHook<T> {
  const log = opts.logger ?? console;
  const useSecure = opts.useSecure ?? false;

  const handleError = useCallback((e: StorageError) => {
    log.error(e);
    opts.onError?.(e);
  }, [log, opts.onError]);

  const backend = useMemo(() => pickBackend(useSecure), [useSecure]);

  const [state, setState] = useState<StorageState<T>>({
    isLoading: true,
    error: null,
    value: null,
  });

  const prevRef = useRef<T | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve()); // handle race condition

  useEffect(() => { prevRef.current = state.value; }, [state.value]); // handle rollback

  useEffect(() => {
    // Set up subscription first
    const listener: Subscriber = (changedKey: string, rawValue: string | null) => {
      if (changedKey !== key) return;
      if (rawValue === null) {
        setState({ isLoading: false, error: null, value: null });
      } else {
        try {
          const parsedValue = JSON.parse(rawValue) as T;
          setState({ isLoading: false, error: null, value: parsedValue });
        } catch (cause) {
          const error = new StorageParseError('Invalid JSON', { cause, key });
          handleError(error);
          setState({ isLoading: false, error, value: null });
        }
      }
    };
    storageChangePublisher.subscribe(key, listener);
    
    // Then do initial load for key
    let mounted = true;

    (async () => {
      let rawValue: string | null = null;
      try {
        rawValue = await backend.getItem(key);
      } catch (error_) {
        const error = toStorageError(error_, key);
        handleError(error);
        if (mounted) setState({ isLoading: false, error, value: null });
        return;
      }

      if (!mounted) return;

      if (rawValue === null) {
        setState({ isLoading: false, error: null, value: null });
        return;
      }

      try {
        setState({ isLoading: false, error: null, value: JSON.parse(rawValue) as T });
      } catch (cause) {
        const error = new StorageParseError('Invalid JSON', { cause, key });
        handleError(error);
        if (mounted) setState({ isLoading: false, error, value: null });
        backend.removeItem(key).catch(handleError);
      }
    })();

    return () => {
      mounted = false;
      storageChangePublisher.unsubscribe(key, listener);
    };
  }, [key, backend, handleError]);

  const setValue = useCallback(async (value: T | null) => {
    const prevValue = prevRef.current;
    setState({ isLoading: false, error: null, value }); // optimistic

    const task = async () => {
      try {
        if (value === null) {
          storageChangePublisher.notifySubscribers(key, null);
          await backend.removeItem(key);
        } else {
          let str: string;
          try {
            str = JSON.stringify(value);
          } catch (cause) {
            throw new StorageStringifyError('Could not stringify', { cause, key });
          }
          storageChangePublisher.notifySubscribers(key, str);
          await backend.setItem(key, str);
        }
      } catch (error_) {
        const error = toStorageError(error_, key);
        handleError(error);
        setState({ isLoading: false, error, value: prevValue }); // rollback
        throw error;
      }
    };

    queueRef.current = queueRef.current.then(task, task);
    return queueRef.current;
  }, [key, backend, handleError]);

  return [state, setValue];
}
