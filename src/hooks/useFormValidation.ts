/**
 * Form Validation Hook
 *
 * This hook is separated from FormValidation.tsx to avoid React Fast Refresh issues.
 */

import { useContext, createContext, useState, useCallback } from 'react';

// Validation types
export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationState {
  errors: ValidationError[];
  touched: Set<string>;
  isValid: boolean;
}

export type ValidationRule = {
  required?: boolean | string;
  minLength?: { value: number; message: string };
  maxLength?: { value: number; message: string };
  pattern?: { value: RegExp; message: string };
  custom?: (value: unknown) => string | undefined;
};

export type ValidationRules = Record<string, ValidationRule>;

export interface FormValidationContextType {
  state: ValidationState;
  setError: (field: string, message: string) => void;
  clearError: (field: string) => void;
  setTouched: (field: string) => void;
  getFieldError: (field: string) => string | undefined;
  isFieldValid: (field: string) => boolean;
  reset: () => void;
  validate: (rules: ValidationRules) => boolean;
}

export const FormValidationContext = createContext<FormValidationContextType | null>(null);

// Hook to use form validation
export function useFormValidation() {
  const context = useContext(FormValidationContext);
  if (!context) {
    throw new Error('useFormValidation must be used within a FormValidationProvider');
  }
  return context;
}

// Custom hook for creating form validation state
export function useFormValidationState() {
  const [state, setState] = useState<ValidationState>({
    errors: [],
    touched: new Set(),
    isValid: true,
  });

  const setError = useCallback((field: string, message: string) => {
    setState((prev) => ({
      ...prev,
      errors: [...prev.errors.filter((e) => e.field !== field), { field, message }],
      isValid: false,
    }));
  }, []);

  const clearError = useCallback((field: string) => {
    setState((prev) => {
      const newErrors = prev.errors.filter((e) => e.field !== field);
      return {
        ...prev,
        errors: newErrors,
        isValid: newErrors.length === 0,
      };
    });
  }, []);

  const setTouched = useCallback((field: string) => {
    setState((prev) => {
      const newTouched = new Set(prev.touched);
      newTouched.add(field);
      return { ...prev, touched: newTouched };
    });
  }, []);

  const getFieldError = useCallback(
    (field: string) => {
      const error = state.errors.find((e) => e.field === field);
      return state.touched.has(field) ? error?.message : undefined;
    },
    [state.errors, state.touched]
  );

  const isFieldValid = useCallback(
    (field: string) => {
      return !state.errors.some((e) => e.field === field);
    },
    [state.errors]
  );

  const reset = useCallback(() => {
    setState({
      errors: [],
      touched: new Set(),
      isValid: true,
    });
  }, []);

  const validate = useCallback((_rules: ValidationRules) => {
    // This is a simplified validate - full implementation would need form values
    return state.errors.length === 0;
  }, [state.errors]);

  return {
    state,
    setError,
    clearError,
    setTouched,
    getFieldError,
    isFieldValid,
    reset,
    validate,
  };
}
