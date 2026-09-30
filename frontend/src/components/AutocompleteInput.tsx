import { useState, useRef, useEffect } from 'react';
import './AutocompleteInput.css';

interface AutocompleteItem {
  id: string;
  value: string;
  label: string;
  sublabel?: string;
}

interface AutocompleteInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  suggestions: AutocompleteItem[];
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  onSelect?: (item: AutocompleteItem) => void;
  onSubmit?: (value: string) => void;
}

export const AutocompleteInput = ({
  id,
  value,
  onChange,
  placeholder,
  suggestions,
  disabled,
  className,
  'aria-label': ariaLabel,
  onSelect,
  onSubmit,
}: AutocompleteInputProps) => {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Filter suggestions based on input value
  const filteredSuggestions = suggestions.filter(item =>
    item.label.toLowerCase().includes(value.toLowerCase()) ||
    item.value.toLowerCase().includes(value.toLowerCase())
  );

  // Show all suggestions when focused and empty, or show filtered when typing
  const displaySuggestions = value.trim() === '' 
    ? suggestions.slice(0, 5) // Show top 5 recent when empty
    : filteredSuggestions.slice(0, 5);

  // Reset focused index when suggestions change
  useEffect(() => {
    if (focusedIndex >= displaySuggestions.length) {
      setFocusedIndex(-1);
    }
  }, [displaySuggestions.length, focusedIndex]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSuggestionClick = (item: AutocompleteItem) => {
    onChange(item.value);
    if (onSelect) {
      onSelect(item);
    }
    setShowSuggestions(false);
    setFocusedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      setFocusedIndex(-1);
      return;
    }

    if (e.key === 'Enter') {
      // If a suggestion is highlighted, select it
      if (showSuggestions && focusedIndex >= 0 && focusedIndex < displaySuggestions.length) {
        e.preventDefault();
        const selectedItem = displaySuggestions[focusedIndex];
        if (selectedItem) {
          handleSuggestionClick(selectedItem);
        }
        return;
      }
      // Otherwise, submit the current typed value directly
      if (value.trim()) {
        e.preventDefault();
        setShowSuggestions(false);
        onSubmit?.(value);
      }
      return;
    }

    if (!showSuggestions || displaySuggestions.length === 0) {
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(prev => 
        prev < displaySuggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(prev => (prev > 0 ? prev - 1 : -1));
    }
  };

  return (
    <div className="autocomplete-wrapper" ref={wrapperRef}>
      <input
        id={id}
        type="text"
        className={className || 'form-input'}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setShowSuggestions(true)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        autoComplete="off"
        aria-label={ariaLabel}
      />
      
      {showSuggestions && displaySuggestions.length > 0 && (
        <div className="autocomplete-dropdown">
          {displaySuggestions.map((item, index) => (
            <div
              key={item.id}
              className={`autocomplete-item ${index === focusedIndex ? 'focused' : ''}`}
              onClick={() => handleSuggestionClick(item)}
              onMouseEnter={() => setFocusedIndex(index)}
            >
              <div className="autocomplete-item-label">{item.label}</div>
              {item.sublabel && (
                <div className="autocomplete-item-sublabel">{item.sublabel}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

