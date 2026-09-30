import dayjs, { Dayjs } from "dayjs";
import React, { useEffect, useId, useRef, useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { VscCalendar } from "react-icons/vsc";
import { MdClose } from "react-icons/md";
import { Button, Dialog, Popover } from "../ui";
import "./DateRangeSelector.css";

interface DateRangeSelectorProps {
  startDate: Dayjs | null;
  endDate: Dayjs | null;
  latestDataDate: Dayjs | null;
  onRangeChange: (startDate: Dayjs | null, endDate: Dayjs | null) => void;
  onClear: () => void;
}

export const DateRangeSelector: React.FC<DateRangeSelectorProps> = ({
  startDate,
  endDate,
  latestDataDate,
  onRangeChange,
  onClear,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [draftStart, setDraftStart] = useState<Dayjs | null>(startDate);
  const [draftEnd, setDraftEnd] = useState<Dayjs | null>(endDate);
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [activeShortcut, setActiveShortcut] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setDraftStart(startDate);
    setDraftEnd(endDate);
    setStartInput(startDate ? startDate.format("YYYY-MM-DD") : "");
    setEndInput(endDate ? endDate.format("YYYY-MM-DD") : "");
    setActiveShortcut(null);
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const selectedRange: DateRange | undefined =
    draftStart && draftEnd
      ? { from: draftStart.toDate(), to: draftEnd.toDate() }
      : draftStart
        ? { from: draftStart.toDate(), to: undefined }
        : undefined;

  const handleSelect = (range: DateRange | undefined) => {
    if (range?.from && range?.to) {
      setDraftStart(dayjs(range.from));
      setDraftEnd(dayjs(range.to));
      setActiveShortcut("custom");
    } else if (range?.from) {
      setDraftStart(dayjs(range.from));
      setDraftEnd(null);
      setActiveShortcut("custom");
    } else {
      setDraftStart(null);
      setDraftEnd(null);
      setActiveShortcut(null);
    }
  };

  const open = Boolean(anchorEl);
  const maxAllowedDate = latestDataDate || dayjs();

  const formattedRange =
    startDate && endDate
      ? `${startDate.format("MMM D")} – ${endDate.format("MMM D, YYYY")}`
      : "Custom Range";

  const isActive = startDate !== null && endDate !== null;

  const shortcuts = [
    {
      id: "7d",
      label: "Last 7 days",
      getValue: () => {
        const end = latestDataDate || dayjs();
        return [end.subtract(6, "day"), end];
      },
    },
    {
      id: "30d",
      label: "Last 30 days",
      getValue: () => {
        const end = latestDataDate || dayjs();
        return [end.subtract(29, "day"), end];
      },
    },
    {
      id: "90d",
      label: "Last 90 days",
      getValue: () => {
        const end = latestDataDate || dayjs();
        return [end.subtract(89, "day"), end];
      },
    },
    {
      id: "this-month",
      label: "This month",
      getValue: () => {
        const end = latestDataDate || dayjs();
        return [end.startOf("month"), end];
      },
    },
    {
      id: "last-month",
      label: "Last month",
      getValue: () => {
        const ref = latestDataDate || dayjs();
        const lastMonth = ref.subtract(1, "month");
        return [lastMonth.startOf("month"), lastMonth.endOf("month")];
      },
    },
    {
      id: "all-time",
      label: "All time",
      getValue: () => {
        const end = latestDataDate || dayjs();
        return [dayjs("2005-01-01"), end];
      },
    },
  ];

  const canApply = Boolean(draftStart && draftEnd);

  const parseManualDate = (value: string): Dayjs | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = dayjs(trimmed, "YYYY-MM-DD", true);
    return parsed.isValid() ? parsed : null;
  };

  const applyInputValue = (field: "start" | "end", rawValue: string) => {
    const parsed = parseManualDate(rawValue);
    if (!parsed) {
      setStartInput(draftStart ? draftStart.format("YYYY-MM-DD") : "");
      setEndInput(draftEnd ? draftEnd.format("YYYY-MM-DD") : "");
      return;
    }

    const normalized = parsed.isAfter(maxAllowedDate, "day")
      ? maxAllowedDate.startOf("day")
      : parsed.startOf("day");
    if (field === "start") {
      const nextStart =
        draftEnd && normalized.isAfter(draftEnd) ? draftEnd : normalized;
      setDraftStart(nextStart);
      setStartInput(nextStart.format("YYYY-MM-DD"));
    } else {
      const nextEnd =
        draftStart && normalized.isBefore(draftStart) ? draftStart : normalized;
      setDraftEnd(nextEnd);
      setEndInput(nextEnd.format("YYYY-MM-DD"));
    }
    setActiveShortcut("custom");
  };

  useEffect(() => {
    if (!open) return;
    setStartInput(draftStart ? draftStart.format("YYYY-MM-DD") : "");
    setEndInput(draftEnd ? draftEnd.format("YYYY-MM-DD") : "");
  }, [draftStart, draftEnd, open]);

  useEffect(() => {
    const mq = globalThis.window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        type="button"
        className="date-range-trigger"
        onClick={handleClick}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Custom date range: ${formattedRange}. Open calendar`}
      >
        <VscCalendar className="date-range-trigger-icon" aria-hidden />
        <span className="date-range-trigger-label">{formattedRange}</span>
        <svg
          className="date-range-trigger-chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          width="14"
          height="14"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </Button>
      {isActive && (
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          title="Clear custom range"
          aria-label="Clear custom date range"
        >
          <span className="seo-period-clear-icon" aria-hidden>
            ×
          </span>
          <span className="seo-period-clear-text">Clear</span>
        </Button>
      )}

      {isMobile ? (
        <Dialog
          open={open}
          onClose={handleClose}
          closeOnBackdrop
          closeOnEscape
          fullWidth
          className="date-range-dialog-mobile"
        >
          <div className="date-range-dialog-header">
            <span className="date-range-dialog-title">Select Date Range</span>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={handleClose}
              aria-label="Close date range dialog"
            >
              <MdClose size={18} aria-hidden />
            </Button>
          </div>
          <div className="date-range-picker-container">
            <div className="date-range-top-row">
              <div className="date-range-shortcuts">
                {shortcuts.map((s) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    key={s.id}
                    className={`shortcut-btn ${activeShortcut === s.id ? "active" : ""}`}
                    onClick={() => {
                      const [start, end] = s.getValue();
                      setDraftStart(start.startOf("day"));
                      setDraftEnd(end.startOf("day"));
                      setActiveShortcut(s.id);
                    }}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
              <div className="date-range-main">
                <div className="date-range-calendar">
                  <DayPicker
                    mode="range"
                    selected={selectedRange}
                    onSelect={handleSelect}
                    numberOfMonths={1}
                    disabled={{ after: maxAllowedDate.toDate() }}
                  />
                </div>
              </div>
            </div>
            <div className="date-range-footer">
              <div className="date-range-inputs">
                <div className="date-range-input">
                  <label
                    className="date-range-input-label"
                    htmlFor={`${menuId}-start`}
                  >
                    Start
                  </label>
                  <input
                    id={`${menuId}-start`}
                    className="date-range-input-value"
                    value={startInput}
                    onChange={(e) => setStartInput(e.target.value)}
                    onBlur={() => applyInputValue("start", startInput)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyInputValue("start", startInput);
                      }
                    }}
                    placeholder="yyyy-MM-dd"
                    autoComplete="off"
                  />
                </div>
                <div className="date-range-input">
                  <label
                    className="date-range-input-label"
                    htmlFor={`${menuId}-end`}
                  >
                    End
                  </label>
                  <input
                    id={`${menuId}-end`}
                    className="date-range-input-value"
                    value={endInput}
                    onChange={(e) => setEndInput(e.target.value)}
                    onBlur={() => applyInputValue("end", endInput)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyInputValue("end", endInput);
                      }
                    }}
                    placeholder="yyyy-MM-dd"
                    autoComplete="off"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  className="date-range-apply"
                  disabled={!canApply}
                  onClick={() => {
                    if (!draftStart || !draftEnd) return;
                    onRangeChange(
                      draftStart.startOf("day"),
                      draftEnd.startOf("day"),
                    );
                    handleClose();
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </Dialog>
      ) : (
        <Popover
          id={menuId}
          open={open}
          anchorEl={anchorEl}
          onClose={handleClose}
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={16}
          style={{ width: 'auto', maxWidth: 'calc(100vw - 24px)' }}
        >
          <div className="date-range-picker-container">
            <div className="date-range-top-row">
              <div className="date-range-shortcuts">
                {shortcuts.map((s) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    key={s.id}
                    className={`shortcut-btn ${activeShortcut === s.id ? "active" : ""}`}
                    onClick={() => {
                      const [start, end] = s.getValue();
                      setDraftStart(start.startOf("day"));
                      setDraftEnd(end.startOf("day"));
                      setActiveShortcut(s.id);
                    }}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
              <div className="date-range-main">
                <div className="date-range-calendar">
                  <DayPicker
                    mode="range"
                    selected={selectedRange}
                    onSelect={handleSelect}
                    numberOfMonths={1}
                    disabled={{ after: maxAllowedDate.toDate() }}
                  />
                </div>
              </div>
            </div>
            <div className="date-range-footer">
              <div className="date-range-inputs">
                <div className="date-range-input">
                  <label
                    className="date-range-input-label"
                    htmlFor={`${menuId}-start`}
                  >
                    Start
                  </label>
                  <input
                    id={`${menuId}-start`}
                    className="date-range-input-value"
                    value={startInput}
                    onChange={(e) => setStartInput(e.target.value)}
                    onBlur={() => applyInputValue("start", startInput)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyInputValue("start", startInput);
                      }
                    }}
                    placeholder="yyyy-MM-dd"
                    autoComplete="off"
                  />
                </div>
                <div className="date-range-input">
                  <label
                    className="date-range-input-label"
                    htmlFor={`${menuId}-end`}
                  >
                    End
                  </label>
                  <input
                    id={`${menuId}-end`}
                    className="date-range-input-value"
                    value={endInput}
                    onChange={(e) => setEndInput(e.target.value)}
                    onBlur={() => applyInputValue("end", endInput)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyInputValue("end", endInput);
                      }
                    }}
                    placeholder="yyyy-MM-dd"
                    autoComplete="off"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  className="date-range-apply"
                  disabled={!canApply}
                  onClick={() => {
                    if (!draftStart || !draftEnd) return;
                    onRangeChange(
                      draftStart.startOf("day"),
                      draftEnd.startOf("day"),
                    );
                    handleClose();
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </Popover>
      )}
    </>
  );
};
