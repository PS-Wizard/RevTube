import React from 'react';
import { PageHeader } from '../PageHeader';

export interface DataExplorerShellProps {
  /** Page title, e.g. "Videos", "Channel", "Playlist". */
  title: string;
  /** One-line description under the title. */
  description: string;
  /** Accent leading icon in the title band (sized ~20 by the caller). */
  icon?: React.ReactNode;
  /** Right-side header actions (e.g. Export buttons, CTA). */
  actions?: React.ReactNode;
  /** Optional (?) help tooltip content, rendered ahead of actions. */
  helpText?: React.ReactNode;
  /** Optional alert or error banners placed directly below header. */
  alerts?: React.ReactNode;
  /** Optional usage limit banner. */
  usageLimit?: React.ReactNode;
  /** Input and filter toolbar (rendered inside .form-section). */
  toolbar?: React.ReactNode;
  /** Optional extra classes on the container. */
  className?: string;
  children: React.ReactNode;
}

/**
 * Standard page shell for Data Explorer & Lookup screens
 * (Videos, Channel, Playlist, Specific Videos, Compare).
 *
 * Title band is the shared Goals-style `PageHeader`; alert/usage banners,
 * toolbar, and content follow. Tailwind + shared primitives only.
 */
export const DataExplorerShell: React.FC<DataExplorerShellProps> = ({
  title,
  description,
  icon,
  actions,
  helpText,
  alerts,
  usageLimit,
  toolbar,
  className = '',
  children,
}) => {
  return (
    <div className={`page-container data-explorer-page ${className}`.trim()}>
      <PageHeader
        icon={icon}
        title={title}
        subtitle={description}
        actions={actions}
        helpText={helpText}
        className="mb-4 sm:mb-5"
      />

      {alerts && <div className="data-explorer-alerts">{alerts}</div>}
      {usageLimit && <div className="data-explorer-usage">{usageLimit}</div>}

      {toolbar && <div className="form-section">{toolbar}</div>}

      {children}
    </div>
  );
};

export default DataExplorerShell;
