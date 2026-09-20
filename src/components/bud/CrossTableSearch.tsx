import { IconSearch, IconX } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { getBackend } from "../../ipc/backend";
import type { ColumnInfo } from "../../ipc/types";
import {
  CROSS_TABLE_MAX_COLUMNS,
  CROSS_TABLE_CROSS_TABLE_MAX_RESULTS,
  CROSS_TABLE_CROSS_TABLE_MAX_TABLES,
  buildCrossTableSearchSql,
  isCrossTableSearchable,
} from "../../lib/crossTableSearch";
import { backdropV, centeredModalV } from "../../lib/motion";
import { useStore } from "../../state/store";

interface SearchHit {
  table: string;
  column: string;
  value: string;
}

export function CrossTableSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const searchToken = useRef(0);

  const activeId = useStore((s) => s.activeConnectionId);
  const connection = useStore((s) => s.connections.find((c) => c.id === s.activeConnectionId));
  const tables = useStore((s) => s.schema.tables);
  const columnsByTable = useStore((s) => s.schema.columnsByTable);
  const openTableData = useStore((s) => s.openTableData);
  const setPendingColFilter = useStore((s) => s.setPendingColFilter);

  const searchableTables = useMemo(
    () => tables.filter((table) => table.kind !== "view").slice(0, CROSS_TABLE_MAX_TABLES),
    [tables],
  );

  useEffect(() => {
    const show = () => {
      searchToken.current += 1;
      setOpen(true);
      setHits([]);
      setScanned(0);
      setError(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        searchToken.current += 1;
        setOpen(false);
      }
    };
    window.addEventListener("orbitodb:cross-table-search", show);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("orbitodb:cross-table-search", show);
      window.removeEventListener("keydown", key);
    };
  }, []);

  const search = async () => {
    const term = query.trim();
    if (!activeId || !connection || term.length < 2 || busy) return;

    setBusy(true);
    setError(null);
    setHits([]);
    setScanned(0);

    const backend = getBackend();
    const next: SearchHit[] = [];
    const token = ++searchToken.current;

    try {
      for (const table of searchableTables) {
        if (token !== searchToken.current || next.length >= CROSS_TABLE_MAX_RESULTS) break;

        let columns = columnsByTable[table.name] ?? [];
        if (!columns.length) {
          try {
            columns = await backend.listColumns(activeId, table.name);
          } catch {
            setScanned((count) => count + 1);
            continue;
          }
        }

        const searchable = columns.filter(isCrossTableSearchable).slice(0, CROSS_TABLE_MAX_COLUMNS);
        if (!searchable.length) {
          setScanned((count) => count + 1);
          continue;
        }

        try {
          const result = await backend.runQuerySilent(
            activeId,
            buildCrossTableSearchSql(connection.engine, table.name, searchable, term),
          );
          const lower = term.toLowerCase();

          for (const row of result.rows) {
            result.columns.forEach((column, index) => {
              if (next.length >= CROSS_TABLE_MAX_RESULTS) return;
              const value = row[index];
              if (value == null) return;
              const text = String(value);
              if (!text.toLowerCase().includes(lower)) return;
              next.push({ table: table.name, column: column.name, value: text });
            });
            if (next.length >= CROSS_TABLE_MAX_RESULTS) break;
          }
        } catch {
          // One unsupported cast or table permission must not stop the whole search.
        }

        if (token !== searchToken.current) break;
        setScanned((count) => count + 1);
      }

      if (token === searchToken.current) setHits(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (token === searchToken.current) setBusy(false);
    }
  };

  const openHit = async (hit: SearchHit) => {
    setPendingColFilter({ column: hit.column, value: hit.value });
    await openTableData(hit.table);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <>
      <motion.div
        className="bud-modal-backdrop"
        variants={backdropV}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={() => { searchToken.current += 1; setBusy(false); setOpen(false); }}
      />
      <motion.div
        className="odb-search-modal"
        variants={centeredModalV}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="odb-search-modal-head">
          <div>
            <span>Database utility</span>
            <h2>Cross-table search</h2>
            <p>Search visible values across up to {CROSS_TABLE_MAX_TABLES} tables in the active connection.</p>
          </div>
          <button className="odb-modal-close" onClick={() => { searchToken.current += 1; setBusy(false); setOpen(false); }} title="Close">
            <IconX size={16} stroke={1.8} />
          </button>
        </header>

        <div className="odb-search-modal-query">
          <IconSearch size={15} stroke={1.8} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a value…"
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
          />
          <button onClick={() => void search()} disabled={busy || query.trim().length < 2 || !activeId}>
            {busy ? "Searching…" : "Search"}
          </button>
        </div>

        <div className="odb-search-modal-meta">
          <span>{connection ? connection.name : "No active connection"}</span>
          <span>·</span>
          <span>{scanned}/{searchableTables.length} tables scanned</span>
          {hits.length > 0 && (
            <>
              <span>·</span>
              <span>{hits.length}{hits.length >= CROSS_TABLE_MAX_RESULTS ? "+" : ""} matches</span>
            </>
          )}
        </div>

        <div className="odb-search-results">
          {error ? (
            <div className="odb-search-state error">{error}</div>
          ) : busy && hits.length === 0 ? (
            <div className="odb-search-state">Searching database metadata and rows…</div>
          ) : hits.length === 0 ? (
            <div className="odb-search-state">
              {query.trim().length >= 2 ? "No matches yet." : "Enter at least two characters to search."}
            </div>
          ) : (
            hits.map((hit, index) => (
              <button
                key={`${hit.table}-${hit.column}-${index}`}
                className="odb-search-hit"
                onClick={() => void openHit(hit)}
              >
                <span className="odb-search-hit-context">
                  <b>{hit.table}</b>
                  <code>{hit.column}</code>
                </span>
                <span className="odb-search-hit-value">{hit.value}</span>
              </button>
            ))
          )}
        </div>

        <footer className="odb-search-modal-foot">
          <span>Binary columns are skipped. Search is capped to protect large databases.</span>
          <span>{CROSS_TABLE_MAX_RESULTS} result limit</span>
        </footer>
      </motion.div>
    </>
  );
}
