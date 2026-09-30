import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SpinnerPresetSize = 'xs' | 'sm' | 'md' | 'lg';

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: SpinnerPresetSize | number;
  sx?: Record<string, any>;
}

const sizeMap: Record<SpinnerPresetSize, number> = {
  xs: 14,
  sm: 18,
  md: 24,
  lg: 36,
};

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  className = '',
  style,
  sx,
  ...props
}) => {
  const pixelSize = typeof size === 'number' ? size : sizeMap[size as SpinnerPresetSize] ?? 24;

  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn('inline-flex items-center justify-center', className)}
      style={{ ...(style || {}), ...(sx || {}) }}
      {...props}
    >
      <Loader2
        className="animate-spin text-primary"
        style={{ width: pixelSize, height: pixelSize }}
      />
    </div>
  );
};

export default Spinner;