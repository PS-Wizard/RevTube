import React from "react";

export type PageShellWidth = "full" | "wide" | "narrow";

export interface PageShellProps {
  /** Convenience title band. Omit when passing a custom `header` (e.g. sticky dashboard header). */
  title?: string;
  /** One-line description under the title. */
  description?: string;
  /** Right-side actions inside the title band. */
  actions?: React.ReactNode;
  /** Custom header node (takes precedence over title/description/actions). */
  header?: React.ReactNode;
  /** Alert/error banners below the header. */
  alerts?: React.ReactNode;
  /** Filter/fetch toolbar row below alerts. */
  toolbar?: React.ReactNode;
  /** Page width variant. Defaults to full-bleed fluid. */
  width?: PageShellWidth;
  /** Extra classes on the shell root. */
  className?: string;
  /** Extra classes on the content slot. */
  contentClassName?: string;
  children: React.ReactNode;
}

/**
 * Centralized responsive page layout — the single configurable shell every
 * page composes from. Header / alerts / toolbar / content slots stack on
 * phones and align horizontally from `md` up (see `styles/layout.css`).
 *
 * Do NOT wrap pages in ad-hoc `max-width` containers or per-page `@media`
 * shell rules — use `width` + these slots instead.
 */
export const PageShell: React.FC<PageShellProps> = ({
  title,
  description,
  actions,
  header,
  alerts,
  toolbar,
  width = "full",
  className = "",
  contentClassName = "",
  children,
}) => {
  const hasTitleBand = !header && (title || actions);

  return (
    <div className={`rt-page rt-page--${width} ${className}`.trim()}>
      {header && <div className="rt-page__header">{header}</div>}

      {hasTitleBand && (
        <div
          className={`rt-page__titleband${actions ? " rt-page__titleband--split" : ""}`}
        >
          <div>
            {title && <h1>{title}</h1>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="rt-page__actions">{actions}</div>}
        </div>
      )}

      {alerts && <div className="rt-page__alerts">{alerts}</div>}
      {toolbar && <div className="rt-page__toolbar">{toolbar}</div>}

      <div className={`rt-page__content ${contentClassName}`.trim()}>
        {children}
      </div>
    </div>
  );
};

export default PageShell;
