import { ListPlus } from "lucide-react";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { DEFAULT_LIST_COLOR, LIST_PRESET_COLORS } from "../utils/chartTheme";
import { Button } from "./ui";
import { Modal } from "./ui/Modal";

const AddListModal = ({
  isOpen,
  onClose,
  onSave,
  listType = "video",
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    ids: string[],
    metadata: {
      name: string;
      date: string;
      color: string;
      annotationTitle: string;
    },
  ) => void;
  listType?: "video" | "playlist";
}) => {
  const isPlaylistList = listType === "playlist";
  const itemLabel = isPlaylistList ? "playlist" : "video";
  const itemLabelPlural = isPlaylistList ? "playlists" : "videos";
  const [inputText, setInputText] = useState("");
  const [listName, setListName] = useState("");
  const [annotationTitle, setAnnotationTitle] = useState("");
  const [trackDate, setTrackDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [selectedColor, setSelectedColor] =
    useState<string>(DEFAULT_LIST_COLOR);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const extractId = useCallback(
    (input: string): string | null => {
      const trimmed = input.trim();
      if (!trimmed) return null;

      if (isPlaylistList) {
        const playlistPatterns = [
          /[?&]list=([0-9A-Za-z_-]{18,34})/,
          /^([0-9A-Za-z_-]{18,34})$/,
        ];
        for (const pattern of playlistPatterns) {
          const match = trimmed.match(pattern);
          if (match && match[1]) return match[1];
        }
      } else {
        const patterns = [
          /(?:v=|\/v\/|embed\/|shorts\/|youtu\.be\/|\/v=|\/watch\?v=|\/watch\?.+&v=|)([0-9A-Za-z_-]{11})(?:[&?]|$)/,
          /^[0-9A-Za-z_-]{11}$/,
        ];
        for (const pattern of patterns) {
          const match = trimmed.match(pattern);
          if (match && match[1]) return match[1];
        }
      }
      return null;
    },
    [isPlaylistList],
  );

  const parsedIds = useMemo(() => {
    const lines = inputText.split(/[\n,;]+/).filter(Boolean);
    return Array.from(
      new Set(lines.map(extractId).filter((id): id is string => !!id)),
    );
  }, [extractId, inputText]);

  const handleSave = () => {
    if (parsedIds.length > 0 && listName.trim()) {
      onSave(parsedIds, {
        name: listName.trim(),
        date: trackDate,
        color: selectedColor,
        annotationTitle: annotationTitle.trim() || "Optimization",
      });
      setInputText("");
      setListName("");
      setAnnotationTitle("");
      onClose();
    }
  };

  const processFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (!content) return;
        const lines = content.split(/\r?\n/).filter(Boolean);
        const allExtractedIds: string[] = [];
        lines.forEach((line) => {
          const cells = line.split(/[,\t;]/);
          cells.forEach((cell) => {
            const id = extractId(cell);
            if (id) allExtractedIds.push(id);
          });
        });
        setInputText(
          (prev: string) =>
            prev + (prev.trim() ? "\n" : "") + allExtractedIds.join("\n"),
        );
      };
      reader.readAsText(file);
    },
    [extractId],
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const canSave = parsedIds.length > 0 && listName.trim().length > 0;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={`New ${isPlaylistList ? "Playlist" : "Video"} List`}
      description={`Add ${itemLabelPlural} by pasting URLs or uploading a CSV/TXT file.`}
      icon={<ListPlus size={20} style={{ color: "var(--rt-color-accent)" }} />}
      maxWidth="md"
      primaryAction={{
        label: "Create List",
        onClick: handleSave,
        disabled: !canSave,
        variant: "primary",
      }}
      secondaryAction={{
        label: "Cancel",
        onClick: onClose,
        variant: "ghost",
      }}
    >
      <div className="alm">
        {/* Identity: name + color */}
        <div className="alm__section alm__section--identity">
          <div className="alm__field alm__field--grow">
            <label className="alm__label">List Name</label>
            <input
              className="alm__input"
              type="text"
              placeholder="e.g., Q1 Performance Optimization"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSave && handleSave()}
              autoFocus
            />
          </div>
          <div className="alm__field alm__field--color">
            <label className="alm__label">Chart Color</label>
            <div className="alm__color-row">
              {LIST_PRESET_COLORS.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant="ghost"
                  style={{ backgroundColor: c }}
                  onClick={() => setSelectedColor(c)}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Annotation: label + date */}
        <div className="alm__section alm__section--ann">
          <div className="alm__field alm__field--grow">
            <label className="alm__label">Initial Annotation Label</label>
            <input
              className="alm__input"
              type="text"
              placeholder="e.g., Optimization, Upload, Campaign"
              value={annotationTitle}
              onChange={(e) => setAnnotationTitle(e.target.value)}
            />
          </div>
          <div className="alm__field alm__field--date">
            <label className="alm__label">Annotation Date</label>
            <input
              className="alm__input alm__input--date"
              type="date"
              value={trackDate}
              onChange={(e) => setTrackDate(e.target.value)}
            />
          </div>
        </div>

        {/* Links textarea */}
        <div className="alm__section alm__section--links">
          <div className="alm__section-head">
            <span className="alm__section-title">
              {isPlaylistList ? "Playlist Links" : "Video Links"}
            </span>
            {parsedIds.length > 0 && (
              <span className="alm__detected-badge">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  width="10"
                  height="10"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {parsedIds.length} {itemLabelPlural} detected
              </span>
            )}
          </div>
          <textarea
            className="alm__textarea"
            placeholder={
              isPlaylistList
                ? "https://www.youtube.com/playlist?list=PLxxxxxx\nPLxxxxxx"
                : "https://www.youtube.com/watch?v=xxxxxxxxxxx\nxxxxxxxxxxx"
            }
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />
          <p className="alm__helper">
            {isPlaylistList
              ? "Paste YouTube playlist URLs or playlist IDs -- one per line, comma or semicolon separated."
              : "Paste YouTube video URLs, Shorts links, or video IDs -- one per line, comma or semicolon separated."}
          </p>
        </div>

        {/* Upload drop zone */}
        <div className="alm__section alm__section--upload">
          <div
            className={`alm__dropzone ${isDragging ? "dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              style={{ display: "none" }}
              accept=".csv,.txt"
            />
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              width="22"
              height="22"
              className="alm__dropzone-icon"
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="alm__dropzone-label">
              {isDragging ? "Drop file here" : "Upload CSV or TXT"}
            </span>
            <span className="alm__dropzone-sub">
              File containing {itemLabel} links or IDs &mdash; click or drag
              &amp; drop
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default AddListModal;
