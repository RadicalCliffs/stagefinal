/**
 * Form Validators
 *
 * These validators are separated from components to avoid React Fast Refresh issues.
 * Use these helper functions for form field validation.
 */

export const validators = {
  required: (value: unknown, message = 'This field is required'): string | undefined => {
    if (value === undefined || value === null || value === '') {
      return message;
    }
    return undefined;
  },

  email: (value: string, message = 'Please enter a valid email'): string | undefined => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (value && !emailRegex.test(value)) {
      return message;
    }
    return undefined;
  },

  minLength: (value: string, min: number, message?: string): string | undefined => {
    if (value && value.length < min) {
      return message || `Must be at least ${min} characters`;
    }
    return undefined;
  },

  maxLength: (value: string, max: number, message?: string): string | undefined => {
    if (value && value.length > max) {
      return message || `Must be no more than ${max} characters`;
    }
    return undefined;
  },

  pattern: (value: string, pattern: RegExp, message = 'Invalid format'): string | undefined => {
    if (value && !pattern.test(value)) {
      return message;
    }
    return undefined;
  },

  walletAddress: (value: string, message = 'Please enter a valid wallet address'): string | undefined => {
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (value && !ethAddressRegex.test(value)) {
      return message;
    }
    return undefined;
  },

  positiveNumber: (value: number | string, message = 'Must be a positive number'): string | undefined => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num) || num <= 0) {
      return message;
    }
    return undefined;
  },
};
