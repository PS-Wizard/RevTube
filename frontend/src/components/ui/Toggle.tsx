import React from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  label?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

/**
 * Enterprise Toggle switch component with design tokens.
 *
 * Structure: the `<label>` is only the field wrapper — the switch itself
 * (input + track) lives in the inner `.rt-toggle` div so track selectors
 * never depend on the label content around it.
 */
export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  ariaLabel,
  label,
  className,
  disabled = false,
}) => {
  const rootClass = ['rt-toggle-field', disabled && 'rt-toggle--disabled', className].filter(Boolean).join(' ');

  return (
    <label className={rootClass}>
      <div className="rt-toggle">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
        />
        <span className="rt-toggle__track" aria-hidden="true" />
      </div>
      {label && <span className="rt-toggle__label">{label}</span>}
    </label>
  );
};

export default Toggle;
