import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui';

export const TrueDeltaHelpButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="true-delta-help-container" ref={containerRef}>
      <Button bare
        type="button"
        className={`true-delta-help-btn ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(prev => !prev)}
        aria-label="True Delta help information"
        title="What is True Delta?"
        aria-expanded={isOpen}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="13"
          height="13"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </Button>

      {isOpen && (
        <div className="true-delta-help-popover" role="tooltip">
          <div className="true-delta-help-header">
            <span className="true-delta-help-title">True Delta</span>
            <Button variant="ghost" bare
              type="button"
             
              onClick={() => setIsOpen(false)}
              aria-label="Close help"
            >
              ×
            </Button>
          </div>
          <div className="true-delta-help-body">
            <p>
              Shows <strong>non-overlapping</strong> period changes by excluding smaller timeframes from larger ones:
            </p>
            <ul className="true-delta-help-list">
              <li>
                <span className="true-delta-tag">7d</span>
                <span>Days 0–7 (recent week)</span>
              </li>
              <li>
                <span className="true-delta-tag">30d</span>
                <span>Days 8–37 (prior 30 days, excluding 7d)</span>
              </li>
              <li>
                <span className="true-delta-tag">90d</span>
                <span>Days 38–127 (older 90 days, excluding 30d)</span>
              </li>
            </ul>
            <p className="true-delta-help-footer">
              Standard mode overlaps (0–7d, 0–30d, 0–90d), which can dilute or mask recent trend shifts.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
