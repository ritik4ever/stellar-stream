import { useState, useEffect } from "react";

/**
 * useDraftAutosave
 * 
 * Intercepts component state to persist it to localStorage.
 * If the current value deep-equals the initial value, the draft is cleared.
 */
export function useDraftAutosave<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        return JSON.parse(item);
      }
    } catch (error) {
      console.warn(`Failed to read draft "${key}" from localStorage:`, error);
    }
    return initialValue;
  });

  const [hasDraft, setHasDraft] = useState<boolean>(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item && item !== JSON.stringify(initialValue)) {
        return true;
      }
    } catch (error) {
      // Ignore
    }
    return false;
  });

  useEffect(() => {
    try {
      const stringified = JSON.stringify(value);
      if (stringified === JSON.stringify(initialValue)) {
        window.localStorage.removeItem(key);
        setHasDraft(false);
      } else {
        window.localStorage.setItem(key, stringified);
        setHasDraft(true);
      }
    } catch (error) {
      console.warn(`Failed to save draft "${key}" to localStorage:`, error);
    }
  }, [key, value, initialValue]);

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // Ignore
    }
    setValue(initialValue);
    setHasDraft(false);
  };

  const overrideValue = (newValue: React.SetStateAction<T>) => {
    setValue(newValue);
  };

  return [value, overrideValue, hasDraft, clearDraft] as const;
}
