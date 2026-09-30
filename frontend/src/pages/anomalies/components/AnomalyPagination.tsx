import React from 'react';
import {
  Flex,
  NativeSelect,
  ShadcnPagination as Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Typography,
} from '@/components/ui';
import { ANOMALY_PAGE_SIZES, pageWindow } from '../anomaliesUtils';

/**
 * Numbered pagination + per-page selector for the anomaly list, built on the
 * shared pagination primitives. Page numbers are 1-based; `onPage` receives
 * the 1-based page to show.
 */
export function AnomalyPagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}): React.ReactElement {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <Flex gap={1.5} alignItems="center" sx={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
      <Typography variant="caption">
        {from}–{to} of {total}
      </Typography>
      <Flex gap={1.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        {totalPages > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => { e.preventDefault(); if (page > 1) onPage(page - 1); }}
                  aria-disabled={page <= 1}
                  className={page <= 1 ? 'pointer-events-none opacity-50' : undefined}
                />
              </PaginationItem>
              {pageWindow(page, totalPages).map((p, i) => (
                <PaginationItem key={p === '…' ? `gap-${i}` : p}>
                  {p === '…' ? (
                    <PaginationEllipsis />
                  ) : (
                    <PaginationLink
                      href="#"
                      isActive={p === page}
                      onClick={(e) => { e.preventDefault(); onPage(p); }}
                    >
                      {p}
                    </PaginationLink>
                  )}
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => { e.preventDefault(); if (page < totalPages) onPage(page + 1); }}
                  aria-disabled={page >= totalPages}
                  className={page >= totalPages ? 'pointer-events-none opacity-50' : undefined}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
        <NativeSelect
          compact
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          aria-label="Anomalies per page"
        >
          {ANOMALY_PAGE_SIZES.map((n) => (
            <option key={n} value={n}>{n} per page</option>
          ))}
        </NativeSelect>
      </Flex>
    </Flex>
  );
}
