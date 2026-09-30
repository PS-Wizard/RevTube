import React from 'react';
import './BrandLoader.css';

export type BrandLoaderVariant = 'fullscreen' | 'page' | 'inline' | 'overlay';
export type BrandLoaderSize = 'sm' | 'md' | 'lg';

export interface BrandLoaderProps {
  variant?: BrandLoaderVariant;
  size?: BrandLoaderSize;
  message?: string;
  subMessage?: string;
  className?: string;
  logoSrc?: string;
}

export const BrandLoader: React.FC<BrandLoaderProps> = ({
  variant = 'page',
  size = 'md',
  message,
  subMessage,
  className = '',
  logoSrc = '/logo.png',
}) => {
  const title = message ?? 'Loading';
  const subtitle = subMessage ?? 'Please wait…';

  return (
    <div
      className={`rt-brand-loader rt-brand-loader--${variant} rt-brand-loader--${size} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={title}
    >
      <div className="rt-brand-loader__stack">
        <div className="rt-brand-loader__mark" aria-hidden="true">
          <span className="rt-brand-loader__glow" />
          <span className="rt-brand-loader__ring" />
          <span className="rt-brand-loader__ring rt-brand-loader__ring--inner" />
          <img
            src={logoSrc}
            alt=""
            className="rt-brand-loader__logo"
            width={64}
            height={64}
            decoding="async"
          />
        </div>

        <div className="rt-brand-loader__copy">
          <p className="rt-brand-loader__title">{title}</p>
          {subtitle ? <p className="rt-brand-loader__subtitle">{subtitle}</p> : null}
        </div>

        <div className="rt-brand-loader__shimmer" aria-hidden="true">
          <span className="rt-brand-loader__shimmer-bar" />
        </div>
      </div>
    </div>
  );
};

export default BrandLoader;
