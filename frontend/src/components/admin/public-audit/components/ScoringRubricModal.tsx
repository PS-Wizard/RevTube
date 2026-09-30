// ─────────────────────────────────────────────────────────────────────────────
// ScoringRubricModal — "how every score is calculated" help dialog.
// Shared shadcn Modal + VideoAuditCriteriaList + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import { HelpCircle } from 'lucide-react';
import { Modal, Spinner, Typography } from '../../../ui';
import { VideoAuditCriteriaList } from '../../../../pages/video-audit/VideoAuditCriteriaList';
import type { VideoAuditCriterion } from '../../../../services/videoAuditService';

export function ScoringRubricModal({
  open,
  onClose,
  criteria,
  loadingCriteria,
}: {
  open: boolean;
  onClose: () => void;
  criteria: VideoAuditCriterion[] | null;
  loadingCriteria: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Public Audit Scoring System"
      description="How every video and channel score is calculated."
      icon={<HelpCircle size={20} className="text-[var(--rt-color-accent)]" />}
      secondaryAction={{ label: 'Close', onClick: onClose }}
      guide
    >
      <div className="flex flex-col gap-3">
        <Typography variant="body2" className="text-[var(--rt-color-text-secondary)]">
          Public audits evaluate live public channel data. Each video is
          evaluated per element (Title, Description, Tags, Keywords,
          Thumbnail, Captions) and rolled into discoverability, content
          quality, and visual hook categories.
        </Typography>
        {loadingCriteria ? (
          <div className="py-4 flex justify-center">
            <Spinner size="sm" />
          </div>
        ) : !criteria || criteria.length === 0 ? (
          <Typography variant="body2" className="text-[var(--rt-color-text-tertiary)]">
            Scoring criteria are not available right now. Please try again later.
          </Typography>
        ) : (
          <VideoAuditCriteriaList criteria={criteria} />
        )}
      </div>
    </Modal>
  );
}
