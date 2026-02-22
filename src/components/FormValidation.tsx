import { type ReactNode } from 'react';
import { AlertCircle, CheckCircle } from 'lucide-react';
import {
  FormValidationContext,
  useFormValidationState,
  type ValidationError,
} from '../hooks/useFormValidation';

// Re-export hook and validators from their dedicated files
// eslint-disable-next-line react-refresh/only-export-components
export { useFormValidation } from '../hooks/useFormValidation';
export type { ValidationError, ValidationState, ValidationRule, ValidationRules } from '../hooks/useFormValidation';
// eslint-disable-next-line react-refresh/only-export-components
export { validators } from '../constants/validators';

// Form validation provider
export function FormValidationProvider({ children }: { children: ReactNode }) {
  const validationState = useFormValidationState();

  return (
    <FormValidationContext.Provider value={validationState}>
      {children}
    </FormValidationContext.Provider>
  );
}

// Field-level validation feedback component
interface FieldFeedbackProps {
  name: string;
  error?: string;
  success?: boolean;
  hint?: string;
  className?: string;
}

export function FieldFeedback({ error, success, hint, className = '' }: FieldFeedbackProps) {
  if (error) {
    return (
      <div className={`flex items-center gap-1.5 mt-1.5 text-red-400 ${className}`} role="alert">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span className="text-xs sequel-45">{error}</span>
      </div>
    );
  }

  if (success) {
    return (
      <div className={`flex items-center gap-1.5 mt-1.5 text-green-400 ${className}`}>
        <CheckCircle className="w-3.5 h-3.5 shrink-0" />
        <span className="text-xs sequel-45">Looks good!</span>
      </div>
    );
  }

  if (hint) {
    return (
      <p className={`text-xs text-white/50 sequel-45 mt-1.5 ${className}`}>
        {hint}
      </p>
    );
  }

  return null;
}

// Styled input wrapper with validation feedback
interface ValidatedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  success?: boolean;
  hint?: string;
}

export function ValidatedInput({
  label,
  error,
  success,
  hint,
  className = '',
  ...props
}: ValidatedInputProps) {
  const inputId = props.id || props.name;
  const hasError = Boolean(error);
  const hasSuccess = success && !hasError;

  const borderClass = hasError
    ? 'border-red-500 focus:border-red-400'
    : hasSuccess
    ? 'border-green-500 focus:border-green-400'
    : 'border-white/20 focus:border-[#DDE404]';

  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm text-white/70 sequel-45"
        >
          {label}
          {props.required && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}
      <input
        {...props}
        id={inputId}
        aria-invalid={hasError}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={`w-full px-4 py-2.5 bg-[#262626] border ${borderClass} rounded-lg text-white sequel-45 text-sm placeholder:text-white/30 focus:outline-none transition-colors ${className}`}
      />
      <FieldFeedback
        name={props.name || ''}
        error={error}
        success={hasSuccess}
        hint={hint}
      />
    </div>
  );
}

// Form-level error summary
interface FormErrorSummaryProps {
  errors: ValidationError[];
  title?: string;
}

export function FormErrorSummary({ errors, title = 'Please fix the following errors:' }: FormErrorSummaryProps) {
  if (errors.length === 0) return null;

  return (
    <div
      className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-red-400 sequel-75 text-sm">{title}</p>
          <ul className="mt-2 space-y-1">
            {errors.map((error) => (
              <li key={error.field} className="text-red-400/80 text-xs sequel-45">
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
