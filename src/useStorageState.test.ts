import { renderHook, act, waitFor } from '@testing-library/react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { useStorageState } from './useStorageState';

// Mock SecureStore
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

// Mock localStorage for web
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value }),
    removeItem: jest.fn((key: string) => { delete store[key] }),
    clear: jest.fn(() => { store = {} }),
  };
})();

describe('useStorageState', () => {
  const originalPlatform = Platform.OS;
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('on native platforms', () => {
    beforeEach(() => {
      Platform.OS = 'ios';
    });

    it('should initialize with isLoading state, load stored value, and allow setting new values', async () => {
      const { result } = renderHook(() => useStorageState('testKey', { useSecure: true }));

      const [state, setValue] = result.current;
      expect(state.isLoading).toBe(true);
      expect(state.value).toBe(null);
      expect(state.error).toBe(null);

      // Wait for the async effect to complete
      await waitFor(() => {
        const [state] = result.current;
        expect(state.isLoading).toBe(false);
        expect(state.value).toBe(null);
      });

      act(() => {
        setValue('newValue');
      });

      const [afterUpdateState] = result.current;
      expect(afterUpdateState.isLoading).toBe(false);
      expect(afterUpdateState.value).toBe('newValue');

      act(() => {
        setValue(null);
      });

      const [afterDeleteState] = result.current;
      expect(afterDeleteState.isLoading).toBe(false);
      expect(afterDeleteState.value).toBe(null);
  
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith('testKey');
      expect(AsyncStorage.getItem).not.toHaveBeenCalled();

      const { result: result2 } = renderHook(() => useStorageState('testAnotherKey', { useSecure: true }));
      const [state2] = result2.current;
      expect(state2.isLoading).toBe(true);
      expect(state2.value).toBe(null);

      // Wait for the async effect to complete
      await waitFor(() => {
        const [state2] = result2.current;
        expect(state2.isLoading).toBe(false);
        expect(state2.value).toBe(null);
      });
  
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith('testAnotherKey');
      expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    });
  });

  describe('on web platform', () => {
    beforeEach(() => {
      Platform.OS = 'web';
      
      // Mock localStorage
      Object.defineProperty(window, 'localStorage', { value: localStorageMock });
      localStorageMock.clear();
    });

    it('should initialize with isLoading state, load stored value, and allow setting new values', async () => {
      const { result } = renderHook(() => useStorageState('testKey'));

      const [state, setValue] = result.current;
      expect(state.isLoading).toBe(true);
      expect(state.value).toBe(null);
      expect(state.error).toBe(null);
      // Wait for the async effect to complete
      await waitFor(() => {
        const [state] = result.current;
      expect(state.isLoading).toBe(false);
      expect(state.value).toBe(null);
      });

      act(() => {
        setValue('newValue');
      });

      const [afterUpdateState] = result.current;
      expect(afterUpdateState.isLoading).toBe(false);
      expect(afterUpdateState.value).toBe('newValue');

      act(() => {
        setValue(null);
      });

      const [afterDeleteState] = result.current;
      expect(afterDeleteState.isLoading).toBe(false);
      expect(afterDeleteState.value).toBe(null);

      const { result: result2 } = renderHook(() => useStorageState('testAnotherKey'));
      const [state2] = result2.current;
      expect(state2.isLoading).toBe(true);
      expect(state2.value).toBe(null);

      // Wait for the async effect to complete
      await waitFor(() => {
      const [state2] = result2.current;
      expect(state2.isLoading).toBe(false);
      expect(state2.value).toBe(null);
      });
    });
  });

  // Restore platform
  afterAll(() => {
    Platform.OS = originalPlatform;
  });
}); 
