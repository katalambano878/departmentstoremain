'use client';

import { useEffect } from 'react';

/**
 * On phones, every data table in the dashboard is shown as a stack of cards:
 * one card per row, each cell on its own line with its column name. Without
 * this, a phone showed only the first two columns and the rest (price, stock,
 * status, the edit and delete buttons) sat off-screen.
 *
 * This component labels the cells: it copies each column heading into the
 * `data-label` of the cells below it and marks the table with `data-cards`.
 * The layout itself is CSS (`table[data-cards]` in app/globals.css) and only
 * applies below 768px, so the desktop table is unchanged.
 *
 * A table opts out with `data-no-cards` (for example a receipt or a layout
 * table). Tables with fewer than three columns are left as they are.
 */
export default function ResponsiveTables({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;

    const label = () => {
      root.querySelectorAll<HTMLTableElement>('table:not([data-no-cards])').forEach((table) => {
        const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
        if (!headRow) return;
        // Heading text per column position, following colspan.
        const headings: string[] = [];
        Array.from(headRow.cells).forEach((cell) => {
          const text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
          const isSelectAll = !!cell.querySelector('input[type="checkbox"]');
          for (let i = 0; i < Math.max(1, cell.colSpan); i++) headings.push(isSelectAll ? '' : text);
        });
        if (headings.length < 3) return;
        if (!table.hasAttribute('data-cards')) table.setAttribute('data-cards', '');

        Array.from(table.tBodies).forEach((body) => {
          Array.from(body.rows).forEach((row) => {
            if (row.dataset.cardsDone === String(row.cells.length)) return;
            let column = 0;
            let primaryMarked = false;
            Array.from(row.cells).forEach((cell) => {
              const span = Math.max(1, cell.colSpan);
              if (span >= headings.length - 1) {
                // A row that spans the table: an empty state or a section heading.
                cell.setAttribute('data-full', '');
              } else {
                const isSelect =
                  !!cell.querySelector('input[type="checkbox"]') &&
                  (cell.textContent || '').trim() === '' &&
                  cell.querySelectorAll('button, a, select').length === 0;
                if (isSelect) cell.setAttribute('data-select', '');
                else if (!primaryMarked) {
                  cell.setAttribute('data-primary', '');
                  primaryMarked = true;
                }
                if (!cell.hasAttribute('data-label')) cell.setAttribute('data-label', headings[column] || '');
              }
              column += span;
            });
            row.dataset.cardsDone = String(row.cells.length);
          });
        });

        // A totals row: the first cell is its title, the others get their column names.
        Array.from(table.tFoot?.rows || []).forEach((row) => {
          if (row.dataset.cardsDone === String(row.cells.length)) return;
          let column = 0;
          Array.from(row.cells).forEach((cell, index) => {
            if (index === 0) cell.setAttribute('data-primary', '');
            else if (!cell.hasAttribute('data-label')) cell.setAttribute('data-label', headings[column] || '');
            column += Math.max(1, cell.colSpan);
          });
          row.dataset.cardsDone = String(row.cells.length);
        });
      });
    };

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        label();
      });
    };
    label();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [rootId]);

  return null;
}
