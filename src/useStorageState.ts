import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';

type Operation = 'read' | 'write' | 'parse' | 'stringify';
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

export type StorageState<T> = {
  isLoading: boolean;
  error: StorageError | null;
  value: T | null;
};

export type UseStorageStateHook<T> = [StorageState<T>, (v: T | null) => Promise<void>];

export interface StorageHookOptions {
  logger?: Pick<Console, 'error'>;
  /**
   * Called on every StorageError caught by the hook
   * (read, write, parse or stringify).
   * Use this to show a toast, send to Sentry, etc.
   */
  onError?: (err: StorageError) => void;
  /**
   * On mobile platforms (non-web), use SecureStore if true, otherwise AsyncStorage.
   * Web always uses localStorage.
   */
  useSecure?: boolean;
}

export function useStorageState<T>(key: string, opts: StorageHookOptions = {}): UseStorageStateHook<T> {
  const log = opts.logger ?? console;
  const handleError = (e: StorageError) => {
    log.error(e);
    opts.onError?.(e);
  };

  const platformBackend = isWeb
    ? {
        getItem: (k: string) => Promise.resolve(localStorage.getItem(k)),
        setItem: (k: string, v: string) => { localStorage.setItem(k,v); return Promise.resolve(); },
        removeItem: (k: string) => { localStorage.removeItem(k); return Promise.resolve(); },
      }
    : opts.useSecure
      ? {
        getItem: SecureStore.getItemAsync,
        setItem: SecureStore.setItemAsync,
        removeItem: SecureStore.deleteItemAsync,
      }
      : {
        getItem: AsyncStorage.getItem,
        setItem: AsyncStorage.setItem,
        removeItem: AsyncStorage.removeItem,
      };

  const backend = {
    getItem: async (k: string) => {
      try {
        return await platformBackend.getItem(k);
      } catch (cause) {
        throw new StorageReadError(`Failed to read ${k}`, { cause, key: k });
      }
    },
    setItem: async (k: string, v: string) => {
      try {
        return await platformBackend.setItem(k, v);
      } catch (cause) {
        throw new StorageWriteError(`Failed to write ${k}`, { cause, key: k });
      }
    },
    removeItem: async (k: string) => {
      try {
        return await platformBackend.removeItem(k);
      } catch (cause) {
        throw new StorageWriteError(`Failed to delete ${k}`, { cause, key: k });
      }
    },
  };

  const [state, setState] = useState<StorageState<T>>({
    isLoading: true,
    error: null,
    value: null,
  });

  const prevRef = useRef<T | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve()); // handle race condition

  useEffect(() => { prevRef.current = state.value; }, [state.value]); // handle rollback

  // load once per key
  useEffect(() => {
    let mounted = true;

    (async () => {
      let raw: string | null = null;
      try {
        raw = await backend.getItem(key);
      } catch (error_) {
        const error = toStorageError(error_, key);
        handleError(error);
        if (mounted) setState({ isLoading: false, error, value: null });
        return;
      }

      if (!mounted) return;

      if (raw === null) {
        setState({ isLoading: false, error: null, value: null });
        return;
      }

      try {
        setState({ isLoading: false, error: null, value: JSON.parse(raw) as T });
      } catch (cause) {
        const error = new StorageParseError('Invalid JSON', { cause, key });
        handleError(error);
        if (mounted) setState({ isLoading: false, error, value: null });
        backend.removeItem(key).catch(handleError);
      }
    })();

    return () => { mounted = false; };
  }, [key]);

  const setValue = useCallback(async (value: T | null) => {
    const prevValue = prevRef.current;
    setState({ isLoading: false, error: null, value }); // optimistic

    const task = async () => {
      try {
        if (value === null) {
          await backend.removeItem(key);
        } else {
          let str: string;
          try {
            str = JSON.stringify(value);
          } catch (cause) {
            throw new StorageStringifyError('Could not stringify', { cause, key });
          }
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
  }, [key]);

  return [state, setValue];
}
