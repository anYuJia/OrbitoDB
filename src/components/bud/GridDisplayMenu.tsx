import { IconColumns3, IconSearch, IconSpacingVertical, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GridDensity } from "../../lib/gridPreferences";
import "./grid-display-menu.css";

export interface GridDisplayAnchor {
  bottom: number;
  right: number;
}

interface GridDisplayMenuProps {
  anchor: GridDisplayAnchor;
  columns: string[];
  hiddenColumns: string[];
  density: GridDensity;
  onChangeHidden: (columns: string[]) => void;
  onChangeDensity: (density: GridDensity) => void;
  onClose: () => void;
}

export function GridDisplayMenu({
  anchor,
  columns,
  hiddenColumns,
  density,
  onChangeHidden,
  onChangeDensity,
  onClose,
}: GridDisplayMenuProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const hidden = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const visibleCount = columns.length - hiddenColumns.length;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? columns.filter((column) => column.toLowerCase().includes(needle)) : columns;
  }, [columns, query]);
  const panelTop = Math.min(anchor.bottom + 6, Math.max(8, window.innerHeight - 500));
  const panelRight = Math.max(8, window.innerWidth - anchor.right);

  useEffect(() => {
    searchRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const toggle = (column: string) => {
    const next = new Set(hiddenColumns);
    if (next.has(column)) next.delete(column);
    else if (visibleCount > 1) next.add(column);
    onChangeHidden([...next]);
  };

  return (
    <>
      <button className="bud-grid-display-backdrop" aria-label="Close display options" onClick={onClose} />
      <section
        className="bud-grid-display-menu"
        role="dialog"
        aria-label="Grid display options"
        style={{ top: panelTop, right: panelRight }}
      >
        <header>
          <span className="bud-grid-display-icon"><IconColumns3 size={16} stroke={1.8} /></span>
          <span><strong>Display</strong><small>{visibleCount} of {columns.length} columns shown</small></span>
          <button className="bud-grid-display-close" aria-label="Close display options" onClick={onClose}>
            <IconX size={14} stroke={2} />
          </button>
        </header>

        <div className="bud-grid-display-section">
          <span className="bud-grid-display-label"><IconSpacingVertical size={14} stroke={1.8} /> Row density</span>
          <div className="bud-grid-density" role="group" aria-label="Row density">
            <button aria-pressed={density === "comfortable"} onClick={() => onChangeDensity("comfortable")}>Comfortable</button>
            <button aria-pressed={density === "compact"} onClick={() => onChangeDensity("compact")}>Compact</button>
          </div>
        </div>

        <div className="bud-grid-display-columns-head">
          <span>Columns</span>
          <button disabled={hiddenColumns.length === 0} onClick={() => onChangeHidden([])}>Show all</button>
        </div>
        <label className="bud-grid-column-search">
          <IconSearch size={13} stroke={1.8} />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a column…" />
          {query && <button aria-label="Clear column search" onClick={() => setQuery("")}><IconX size={12} /></button>}
        </label>
        <div className="bud-grid-column-list">
          {shown.length === 0 ? (
            <span className="bud-grid-column-empty">No matching columns</span>
          ) : shown.map((column) => {
            const checked = !hidden.has(column);
            const lastVisible = checked && visibleCount === 1;
            return (
              <label key={column} title={lastVisible ? "At least one column must remain visible" : undefined}>
                <input type="checkbox" checked={checked} disabled={lastVisible} onChange={() => toggle(column)} />
                <span>{column}</span>
              </label>
            );
          })}
        </div>
        <footer>Hidden columns stay included in exports.</footer>
      </section>
    </>
  );
}
