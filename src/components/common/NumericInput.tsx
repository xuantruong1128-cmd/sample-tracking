import React, { useState, useEffect, useRef } from 'react';

export interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number | string | null | undefined;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  defaultValueOnBlur?: number;
  type?: string;
  /**
   * Optional custom test identifier
   */
  'data-testid'?: string;
}

/**
 * NumericInput: Usability-enhanced numeric input designed for desktop and mobile (R1-03).
 *
 * Key features:
 * 1. Mobile numeric keypad: type="tel", inputMode="numeric", pattern="[0-9]*"
 * 2. On focus: selects all existing text so new typing replaces the existing value immediately.
 * 3. Editing freedom: supports temporary empty input ("") while backspacing or typing without forcing zero.
 * 4. Normalization: on blur, empty input or leading zeros are normalized to valid numbers.
 * 5. Parent synchronization: propagates numeric values to parent without losing focus or cursor jumping.
 */
export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  (
    {
      value,
      onChange,
      min = 0,
      max,
      defaultValueOnBlur = 0,
      className,
      disabled,
      type = 'tel',
      onFocus,
      onBlur,
      onKeyDown,
      ...restProps
    },
    forwardedRef
  ) => {
    const internalRef = useRef<HTMLInputElement>(null);
    const inputRef = (forwardedRef as React.RefObject<HTMLInputElement>) || internalRef;

    const [isFocused, setIsFocused] = useState(false);
    const [textValue, setTextValue] = useState<string>(() => {
      if (value === null || value === undefined || value === '') return '0';
      return String(value);
    });

    // Sync external value when not actively focused
    useEffect(() => {
      if (!isFocused) {
        if (value === null || value === undefined || value === '') {
          setTextValue('0');
        } else {
          setTextValue(String(value));
        }
      }
    }, [value, isFocused]);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      // Auto-select entire text on focus (desktop and touch mobile)
      e.target.select();
      // Android Chrome / iOS Safari helper: re-trigger select after tick in case touch deselects
      requestAnimationFrame(() => {
        if (inputRef && 'current' in inputRef && inputRef.current) {
          inputRef.current.select();
        }
      });

      if (onFocus) {
        onFocus(e);
      }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;

      // Allow clearing input completely while editing
      if (raw === '') {
        setTextValue('');
        // Notify parent with 0 for real-time recalculations (e.g. NG details total), but keep input visually empty
        onChange(0);
        return;
      }

      // Filter non-digits
      const digitsOnly = raw.replace(/[^\d]/g, '');
      if (digitsOnly === '') {
        setTextValue('');
        onChange(0);
        return;
      }

      let parsed = parseInt(digitsOnly, 10);
      if (isNaN(parsed)) parsed = 0;

      // Enforce max if specified
      if (max !== undefined && parsed > max) {
        parsed = max;
      }

      // If user typed without clearing (e.g. replacing), update display text
      setTextValue(digitsOnly);
      onChange(parsed);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);

      let finalValue: number;
      if (textValue === '' || textValue.trim() === '') {
        finalValue = defaultValueOnBlur ?? min ?? 0;
      } else {
        const parsed = parseInt(textValue, 10);
        if (isNaN(parsed)) {
          finalValue = defaultValueOnBlur ?? min ?? 0;
        } else {
          finalValue = parsed;
        }
      }

      // Clamp to min / max
      if (min !== undefined && finalValue < min) {
        finalValue = min;
      }
      if (max !== undefined && finalValue > max) {
        finalValue = max;
      }

      setTextValue(String(finalValue));
      onChange(finalValue);

      if (onBlur) {
        onBlur(e);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        // 1. Prevent default form submission and bubbling (R3 FIX 05)
        e.preventDefault();
        e.stopPropagation();

        // 2. Preserve exact window scroll position
        const currentScrollY = typeof window !== 'undefined' ? window.scrollY : 0;

        // 3. Commit normalized value & blur input to unfocus cursor
        handleBlur(e as any);
        if (inputRef && 'current' in inputRef && inputRef.current) {
          inputRef.current.blur();
        } else {
          (e.target as HTMLInputElement)?.blur();
        }

        // 4. Ensure scroll position is strictly maintained
        if (typeof window !== 'undefined') {
          window.scrollTo({ top: currentScrollY, behavior: 'instant' });
          requestAnimationFrame(() => {
            window.scrollTo({ top: currentScrollY, behavior: 'instant' });
          });
        }
      }

      if (onKeyDown) {
        onKeyDown(e);
      }
    };

    return (
      <input
        ref={inputRef}
        type={type}
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={disabled}
        value={textValue}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={className}
        {...restProps}
      />
    );
  }
);

NumericInput.displayName = 'NumericInput';
