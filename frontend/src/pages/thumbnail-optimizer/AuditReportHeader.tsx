// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer -- Report summary bar with unified download dropdown
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { Button, Menu, MenuItem, ListItemIcon, ListItemText } from '../../components/ui';
import { Download, FileText, FileSpreadsheet, FileType } from 'lucide-react';
import { downloadPDF, downloadExcel, downloadCSV } from '../../services/thumbnailOptimizerExport';
import type { ThumbnailAudit } from '../../types/thumbnailOptimizer';

interface AuditReportHeaderProps {
  audits: ThumbnailAudit[];
}

export const AuditReportHeader: React.FC<AuditReportHeaderProps> = ({
  audits,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  // Anchor element held in state (not a ref) so it is safe to read during render.
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

  const handleClose = () => {
    setMenuOpen(false);
    setAnchorEl(null);
  };

  const handlePDF = () => {
    handleClose();
    if (audits.length === 0) return;
    downloadPDF(audits);
  };

  const handleExcel = () => {
    handleClose();
    if (audits.length === 0) return;
    downloadExcel(audits);
  };

  const handleCSV = () => {
    handleClose();
    if (audits.length === 0) return;
    downloadCSV(audits);
  };

  return (
    <div className="rtis-report-bar">
      <div className="rtis-report-info">
        <h2>RevTube Visual Intelligence Report</h2>
        <p>
          Comprehensive batch audit complete &mdash; {audits.length} video
          {audits.length !== 1 ? 's' : ''} analyzed.
        </p>
      </div>

      <Button
        variant="contained"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        startIcon={<Download size={16} />}
        endIcon={<span style={{ fontSize: 10 }}>▾</span>}
        sx={{
          fontWeight: 'var(--rt-weight-bold)',
          fontSize: 'var(--rt-text-sm)',
          px: 3,
          py: 1,
          backgroundColor: 'var(--rt-color-btn-primary)',
          color: 'var(--rt-color-on-primary)',
          borderRadius: 'var(--rt-radius-md)',
          textTransform: 'none',
          boxShadow: 'none',
          whiteSpace: 'nowrap',
          '&:hover': {
            backgroundColor: 'var(--rt-color-btn-primary-hover)',
            boxShadow: 'none',
          },
        }}
      >
        Download
      </Button>

      <Menu
        open={menuOpen}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{
          '& .MuiPaper-root': {
            borderRadius: 'var(--rt-radius-md)',
            border: '1px solid var(--rt-color-border)',
            boxShadow: 'var(--rt-shadow-lg)',
            minWidth: 200,
            mt: 0.5,
          },
        }}
      >
        <MenuItem onClick={handlePDF} dense>
          <ListItemIcon>
            <FileText size={16} />
          </ListItemIcon>
          <ListItemText>
            <span style={{ fontSize: 'var(--rt-text-sm)', fontWeight: 'var(--rt-weight-semibold)' }}>
              PDF
            </span>
            <span style={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-tertiary)', marginLeft: 6 }}>
              Full Report
            </span>
          </ListItemText>
        </MenuItem>

        <MenuItem onClick={handleExcel} dense>
          <ListItemIcon>
            <FileSpreadsheet size={16} />
          </ListItemIcon>
          <ListItemText>
            <span style={{ fontSize: 'var(--rt-text-sm)', fontWeight: 'var(--rt-weight-semibold)' }}>
              Excel
            </span>
            <span style={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-tertiary)', marginLeft: 6 }}>
              .xlsx Workbook
            </span>
          </ListItemText>
        </MenuItem>

        <MenuItem onClick={handleCSV} dense>
          <ListItemIcon>
            <FileType size={16} />
          </ListItemIcon>
          <ListItemText>
            <span style={{ fontSize: 'var(--rt-text-sm)', fontWeight: 'var(--rt-weight-semibold)' }}>
              CSV
            </span>
            <span style={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-tertiary)', marginLeft: 6 }}>
              .csv Spreadsheet
            </span>
          </ListItemText>
        </MenuItem>
      </Menu>
    </div>
  );
};
