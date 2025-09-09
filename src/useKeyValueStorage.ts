import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Publisher, { type Subscriber } from './Publisher';

const isWeb = Platform.OS === 'web';

/** ---------- Logging ---------- */
export type StorageLogger = {
  debug: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

const noopLogger: StorageLogger = { debug: () => {}, error: () => {} };
let globalLogger: StorageLogger = noopLogger;

export function setStorageLogger(logger: StorageLogger) {
  globalLogger = logger ?? noopLogger;
}

/** ---------- Errors ---------- */
type Operation = 'read' | 'write' | 'delete' | 'parse' | 'stringify';
type ErrorOptionsCompat = { cause?: unknown };
type StorageOpts = ErrorOptionsCompat & { key?: string; operation?: Operation };

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

/** ---------- Backends ---------- */
interface Backend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, rawValue: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Wrap a backend so all errors are converted to our typed errors
 * (and include the underlying `cause`).
 * Note: we *don't* log here to avoid double-logging. The hook
 * and convenience APIs log at the call site with better context.
 */
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

/** ---------- Pub/Sub for cross-hook sync ---------- */
const storageChangePublisher = new Publisher();

/** Convenience APIs (non-hook) */
export const secureKeyValueStorage = {
  get: async (key: string) => {
    try {
      const v = await pickBackend(true).getItem(key);
      globalLogger.debug(`secure get "${key}"`);
      return v;
    } catch (e) {
      const err = toStorageError(e, key);
      globalLogger.error(`secure get failed for "${key}": ${err.message}`, (err as any).cause ?? err);
      throw err;
    }
  },
  set: async (key: string, rawValue: string) => {
    try {
      await pickBackend(true).setItem(key, rawValue);
      storageChangePublisher.notifySubscribers(key, rawValue);
      globalLogger.debug(`secure set "${key}"`);
    } catch (e) {
      const err = toStorageError(e, key);
      globalLogger.error(`secure set failed for "${key}": ${err.message}`, (err as any).cause ?? err);
      throw err;
    }
  },
  remove: async (key: string) => {
    try {
      await pickBackend(true).removeItem(key);
      storageChangePublisher.notifySubscribers(key, null);
      globalLogger.debug(`secure remove "${key}"`);
    } catch (e) {
      const err = toStorageError(e, key);
      globalLogger.error(`secure remove failed for "${key}": ${err.message}`, (err as any).cause ?? err);
      throw err;
    }
  },
};

export const keyValueStorage = {
  get: async (key: string) => {
    try {
      const v = await pickBackend(false).getItem(key);
      globalLogger.debug(`get "${key}"`);
      return v;
    } catch (e) {
      const err = toStorageError(e, key);
      globalLogger.error(`get failed for "${key}": ${err.message}`, (err as any).cause ?? err);
      throw err;
    }
  },
  set: async (key: string, rawValue: string) => {
    try {
      await pickBackend(false).setItem(key, rawValue);
      storageChangePublisher.notifySubscribers(key, rawValue);
      globalLogger.debug(`set "${key}"`);
    } catch (e) {
      const err = toStorageError(e, key);
      globalLogger.error(`set failed for "${key}": ${err.message}`, (err as any).cause ?? err);
      throw err;
    }
  },
  remove: async (key: string) => {
    try {
      await pickBackend(false).removeItem(key);
      storageChangePublisher.notifySubscribers(key, null);
      globalLogger.debug(`remove "${key}"`);
    } catch (e) {
      const err = toStorageError(e, key);
      globalLogger.error(`remove failed for "${key}": ${err.message}`, (err as any).cause ?? err);
      throw err;
    }
  },
};

/** ---------- Hook ---------- */
export type StorageState<T> = {
  isLoading: boolean;
  error: StorageError | null;
  value: T | null;
};

export type UseStorageStateHook<T> = [StorageState<T>, (v: T | null) => Promise<void>];

export interface StorageHookOptions {
  /**
   * Per-hook logger. If omitted, uses the global logger set via setStorageLogger().
   * Default is a no-op logger.
   */
  logger?: StorageLogger;
  /**
   * Called whenever an error is caught by the hook (after it’s logged).
   */
  onError?: (err: StorageError) => void;
  /**
   * On mobile (non-web), use SecureStore if true, otherwise AsyncStorage.
   * Web always uses localStorage.
   */
  useSecure?: boolean;
}

export function useSecureKeyValueStorage<T>(key: string, opts: StorageHookOptions = {}): UseStorageStateHook<T> {
  return useKeyValueStorage<T>(key, { ...opts, useSecure: true });
}

export function useKeyValueStorage<T>(key: string, opts: StorageHookOptions = {}): UseStorageStateHook<T> {
  const log = opts.logger ?? globalLogger;
  const useSecure = opts.useSecure ?? false;

  const logError = useCallback(
    (e: StorageError) => {
      // Include operation, key, message AND the underlying cause
      const op = e.operation ?? 'error';
      const k = e.key ?? key;
      const cause = (e as any)?.cause;
      log.error(`storage ${op} for "${k}": ${e.message}`, cause ?? e);
      opts.onError?.(e);
    },
    [log, opts, key]
  );

  const backend = useMemo(() => {
    const b = pickBackend(useSecure);
    log.debug(`storage backend for "${key}": ${isWeb ? 'localStorage' : useSecure ? 'SecureStore' : 'AsyncStorage'}`);
    return b;
  }, [useSecure, key, log]);

  const [state, setState] = useState<StorageState<T>>({
    isLoading: true,
    error: null,
    value: null,
  });

  const prevRef = useRef<T | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const opRef = useRef(0); // operation counter for concurrency-safe rollback

  useEffect(() => { prevRef.current = state.value; }, [state.value]);

  useEffect(() => {
    // 1) Subscribe first to reflect external writes/removes immediately
    const listener: Subscriber = (changedKey: string, rawValue: string | null) => {
      if (changedKey !== key) return;
      if (rawValue === null) {
        log.debug(`event: remove "${key}"`);
        setState({ isLoading: false, error: null, value: null });
      } else {
        try {
          const parsed = JSON.parse(rawValue) as T;
          log.debug(`event: set "${key}"`);
          setState({ isLoading: false, error: null, value: parsed });
        } catch (cause) {
          const err = new StorageParseError('Invalid JSON', { cause, key });
          logError(err);
          setState({ isLoading: false, error: err, value: null });
        }
      }
    };
    storageChangePublisher.subscribe(key, listener);

    // 2) Initial load
    let mounted = true;
    (async () => {
      log.debug(`initial load "${key}"`);
      let raw: string | null = null;
      try {
        raw = await backend.getItem(key);
      } catch (error_) {
        const err = toStorageError(error_, key);
        logError(err);
        if (mounted) setState({ isLoading: false, error: err, value: null });
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
        const err = new StorageParseError('Invalid JSON', { cause, key });
        logError(err);
        if (mounted) setState({ isLoading: false, error: err, value: null });
        backend.removeItem(key).catch(() => {}); // best-effort cleanup
      }
    })();

    return () => {
      mounted = false;
      storageChangePublisher.unsubscribe(key, listener);
    };
  }, [key, backend, log, logError]);

  const setValue = useCallback(async (value: T | null) => {
    const prev = prevRef.current;
    const myOp = ++opRef.current; // unique id for this call
    setState({ isLoading: false, error: null, value }); // optimistic

    const task = async () => {
      try {
        if (value === null) {
          log.debug(`remove "${key}" (begin)`);
          await backend.removeItem(key);
          storageChangePublisher.notifySubscribers(key, null);
          log.debug(`remove "${key}" (commit)`);
        } else {
          let str: string;
          try {
            str = JSON.stringify(value);
          } catch (cause) {
            throw new StorageStringifyError('Could not stringify', { cause, key });
          }
          log.debug(`set "${key}" (begin)`);
          await backend.setItem(key, str);
          storageChangePublisher.notifySubscribers(key, str);
          log.debug(`set "${key}" (commit)`);
        }
      } catch (error_) {
        const err = toStorageError(error_, key);
        logError(err);
        // Only roll back if no newer setValue call was made since this one started.
        if (opRef.current === myOp) {
          setState({ isLoading: false, error: err, value: prev });
        } else {
          // A newer optimistic value exists; don’t clobber it — just surface the error.
          setState((s) => ({ ...s, error: err }));
        }
        throw err;
      }
    };

    queueRef.current = queueRef.current.then(task, task);
    return queueRef.current;
  }, [key, backend, log, logError]);

  return [state, setValue];
}
