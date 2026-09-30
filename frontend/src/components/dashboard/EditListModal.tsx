import { useState } from 'react';
import type { SavedList } from '../../services/savedListService';
import { DEFAULT_LIST_COLOR, LIST_PRESET_COLORS } from '../../utils/chartTheme';
import { Modal } from '../ui/Modal';
import { Button } from '../ui';
import { Pencil } from 'lucide-react';

export const EditListModal = ({
  isOpen,
  onClose,
  list,
  onSave,
  videoTitleMap = {},
  playlistTitleMap = {},
}: {
  isOpen: boolean;
  onClose: () => void;
  list: SavedList | null;
  onSave: (updatedList: SavedList) => void;
  videoTitleMap?: Record<string, string>;
  playlistTitleMap?: Record<string, string>;
}) => {
  const [annotations, setAnnotations] = useState<{ date: string; title: string }[]>([]);
  const [newDate, setNewDate] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [listColor, setListColor] = useState<string>(DEFAULT_LIST_COLOR);
  const [listName, setListName] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);

  // Reset local state synchronously during render when the modal (re)opens for a list,
  // instead of syncing in an effect (avoids cascading renders).
  const getInitialState = (l: SavedList) => {
    let initialAnnotations = [...(l.annotations || [])];
    if (l.trackDate && !initialAnnotations.find(a => a.date === l.trackDate)) {
      initialAnnotations = [{ date: l.trackDate, title: 'Optimization' }, ...initialAnnotations];
    }
    return {
      annotations: initialAnnotations,
      color: l.color || DEFAULT_LIST_COLOR,
      name: l.name,
    };
  };

  const stateKey = list ? `${list.id}:${isOpen}` : null;
  const [prevStateKey, setPrevStateKey] = useState(stateKey);

  if (stateKey !== prevStateKey) {
    setPrevStateKey(stateKey);
    if (list) {
      const next = getInitialState(list);
      setAnnotations(next.annotations);
      setListColor(next.color);
      setListName(next.name);
    }
    setCopySuccess(false);
  }

  if (!list) return null;

  const isPlaylistList = list.listType === 'playlist';
  const ids: string[] = isPlaylistList ? (list.playlistIds ?? []) : (list.videoIds ?? []);
  const getUrl = (id: string) =>
    isPlaylistList
      ? `https://www.youtube.com/playlist?list=${id}`
      : `https://www.youtube.com/watch?v=${id}`;

  const handleAddAnnotation = () => {
    if (newDate && newTitle) {
      const next = [...annotations, { date: newDate, title: newTitle }].sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      setAnnotations(next);
      setNewDate('');
      setNewTitle('');
    }
  };

  const handleRemoveAnnotation = (index: number) => {
    setAnnotations(annotations.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    onSave({ ...list, annotations, color: listColor, name: listName });
    onClose();
  };

  const handleCopyLinks = async () => {
    if (ids.length === 0) return;
    const text = ids.map(getUrl).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleDownloadList = () => {
    if (ids.length === 0) return;

    const headers = ['#', 'Title', 'YouTube URL'];
    const rows = ids.map((id, idx) => {
      const title = isPlaylistList
        ? (playlistTitleMap[id] ?? id)
        : (videoTitleMap[id] ?? id);
      const url = getUrl(id);
      const escapedTitle = `"${title.replace(/"/g, '""')}"`;
      return `${idx + 1},${escapedTitle},${url}`;
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const safeListName = listName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'list';

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    link.href = url;
    link.download = `${safeListName}_${timestamp}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Edit List"
      description={`Editing ${isPlaylistList ? 'playlist' : 'video'} list -- rename, change color, or manage annotations.`}
      icon={<Pencil size={20} style={{ color: 'var(--rt-color-accent)' }} />}
      maxWidth="md"
      primaryAction={{
        label: 'Save changes',
        onClick: handleSave,
        variant: 'primary',
      }}
      secondaryAction={{
        label: 'Cancel',
        onClick: onClose,
        variant: 'ghost',
      }}
    >
      <div className="elm">
        {/* Name + Color row */}
        <div className="elm__identity">
          <div className="elm__field">
            <label className="elm__label">Name</label>
            <input
              className="elm__input"
              type="text"
              value={listName}
              onChange={e => setListName(e.target.value)}
              placeholder="List name"
            />
          </div>
          <div className="elm__field elm__field--color">
            <label className="elm__label">Chart color</label>
            <div className="elm__color-row">
              {LIST_PRESET_COLORS.map(c => (
                <Button bare
                  key={c}
                  type="button"
                  className={`elm__color-swatch ${listColor === c ? 'active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setListColor(c)}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Contents */}
        <div className="elm__section">
          <div className="elm__section-head">
            <span className="elm__section-title">
              {isPlaylistList ? 'Playlists' : 'Videos'}
              {ids.length > 0 && <span className="elm__badge">{ids.length}</span>}
            </span>
            {ids.length > 0 && (
              <div className="elm__section-actions">
                <Button bare
                  type="button"
                  className={`elm__copy-btn ${copySuccess ? 'success' : ''}`}
                  onClick={handleCopyLinks}
                >
                  {copySuccess ? (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                      </svg>
                      Copy links
                    </>
                  )}
                </Button>
                <Button variant="secondary" bare
                  type="button"
                 
                  onClick={handleDownloadList}
                  title="Download list as CSV"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download CSV
                </Button>
              </div>
            )}
          </div>

          <div className="elm__items">
            {ids.length === 0 ? (
              <p className="elm__empty">No {isPlaylistList ? 'playlists' : 'videos'} added yet</p>
            ) : (
              ids.map((id, idx) => {
                const title = isPlaylistList
                  ? (playlistTitleMap[id] ?? id)
                  : (videoTitleMap[id] ?? id);
                return (
                  <div key={id} className="elm__item">
                    <span className="elm__item-num">{idx + 1}</span>
                    <span className="elm__item-title" title={`${title}\n${id}`}>{title}</span>
                    <a
                      href={getUrl(id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="elm__item-link"
                      title="Open on YouTube"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </a>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Annotations */}
        <div className="elm__section">
          <div className="elm__section-head">
            <span className="elm__section-title">
              Annotations
              {annotations.length > 0 && <span className="elm__badge">{annotations.length}</span>}
            </span>
          </div>

          {annotations.length > 0 && (
            <div className="elm__items elm__items--ann">
              {annotations.map((ann, idx) => (
                <div key={idx} className="elm__ann-row">
                  <span className="elm__ann-dot" style={{ backgroundColor: listColor }} />
                  <span className="elm__ann-date">{ann.date}</span>
                  <span className="elm__ann-label">{ann.title}</span>
                  <Button variant="danger" bare
                   
                    onClick={() => handleRemoveAnnotation(idx)}
                    aria-label="Remove annotation"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add annotation inline */}
          <div className="elm__ann-add">
            <input
              type="date"
              className="elm__input elm__input--date"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
            />
            <input
              type="text"
              className="elm__input elm__input--grow"
              placeholder="Label (e.g. Upload, Campaign)"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddAnnotation()}
            />
            <Button variant="primary" bare
              type="button"
             
              onClick={handleAddAnnotation}
              disabled={!newDate || !newTitle}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
