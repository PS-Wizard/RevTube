import React from 'react';

interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children?: React.ReactNode;
  compact?: boolean;
}

/**
 * Middleware native `<select>` with `.rt-select-native` styling (option children).
 * For compact native selects in toolbars / pagination; use `Select` (MUI dropdown)
 * when a MenuItem-based picker is required.
 */
export const NativeSelect: React.FC<NativeSelectProps> = ({
  compact = false,
  className = '',
  ...props
}) => {
  const classes = ['rt-select-native', compact && 'rt-select-native--toolbar', className]
    .filter(Boolean)
    .join(' ');
  return <select className={classes} {...props} />;
};

export default NativeSelect;