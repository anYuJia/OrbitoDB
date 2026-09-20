import { IconArrowRight, IconCode, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { getBackend } from "../../ipc/backend";
import { useStore } from "../../state/store";

type Schema = Record<string, Record<string, string>>; // table -> (column -> dataType)

interface Diff {
  onlyA: string[];
  onlyB: string[];
  changed: {
    table: string;
    onlyA: string[];
    onlyB: string[];
    typeChanged: { col: string; a: string; b: string }[];
  }[];
  identical: number;
}

/** Open + introspect a connection by id into a {table: {col: type}} map. */
async function introspect(id: string): Promise<Schema> {
  const be = getBackend();
  await be.openConnection(id);
  const tables = await be.listTables(id);
  const out: Schema = {};
  for (const t of tables) {
    try {
      const cols = await be.listColumns(id, t.name);
      out[t.name] = Object.fromEntries(cols.map((c) => [c.name, c.dataType]));
    } catch {
      out[t.name] = {};
    }
  }
  return out;
}

function computeDiff(a: Schema, b: Schema): Diff {
  const aT = Object.keys(a);
  const bT = Object.keys(b);
  const bSet = new Set(bT);
  const aSet = new Set(aT);
  const onlyA = aT.filter((t) => !bSet.has(t)).sort();
  const onlyB = bT.filter((t) => !aSet.has(t)).sort();
  const changed: Diff["changed"] = [];
  let identical = 0;
  for (const t of aT.filter((t) => bSet.has(t)).sort()) {
    const ca = a[t];
    const cb = b[t];
    const colsA = Object.keys(ca);
    const colsB = Object.keys(cb);
    const cbSet = new Set(colsB);
    const caSet = new Set(colsA);
    const colOnlyA = colsA.filter((c) => !cbSet.has(c));
    const colOnlyB = colsB.filter((c) => !caSet.has(c));
    const typeChanged = colsA
      .filter((c) => cbSet.has(c) && ca[c] !== cb[c])
      .map((c) => ({ col: c, a: ca[c], b: cb[c] }));
    if (colOnlyA.length || colOnlyB.length || typeChanged.length) {
      changed.push({ table: t, onlyA: colOnlyA, onlyB: colOnlyB, typeChanged });
    } else {
      identical++;
    }
  }
  return { onlyA, onlyB, changed, identical };
}

/** Compare the schemas of two connections. Opened via `orbitodb:schema-diff`. */
export function SchemaDiff() {
  const [open, setOpen] = useState(false);
  const connections = useStore((s) => s.connections);
  const activeId = useStore((s) => s.activeConnectionId);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [diff, setDiff] = useState<Diff | null>(null);
  const [schemaA, setSchemaA] = useState<Schema | null>(null);
  const [schemaB, setSchemaB] = useState<Schema | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEvt = () => {
      setDiff(null);
      setSchemaA(null);
      setSchemaB(null);
      setErr(null);
      setAId(activeId ?? connections[0]?.id ?? "");
      setBId(connections.find((c) => c.id !== (activeId ?? connections[0]?.id))?.id ?? "");
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("orbitodb:schema-diff", onEvt);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("orbitodb:schema-diff", onEvt);
      window.removeEventListener("keydown", onKey);
    };
  }, [activeId, connections]);

  if (!open) return null;

  const nameOf = (id: string) => connections.find((c) => c.id === id)?.name ?? "?";

  const compare = async () => {
    if (!aId || !bId || aId === bId) {
      setErr("Pick two different connections.");
      return;
    }
    setBusy(true);
    setErr(null);
    setDiff(null);
    setSchemaA(null);
    setSchemaB(null);
    try {
      const [a, b] = await Promise.all([introspect(aId), introspect(bId)]);
      setSchemaA(a);
      setSchemaB(b);
      setDiff(computeDiff(a, b));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const quoteIdentifier = (engine: string, value: string) =>
    engine === "mysql"
      ? "`" + value.replace(/`/g, "``") + "`"
      : '"' + value.replace(/"/g, '""') + '"';

  const migrationPreview = async () => {
    if (!diff || !schemaA || !schemaB || !aId || !bId) return;
    const target = connections.find((connection) => connection.id === aId);
    const desired = connections.find((connection) => connection.id === bId);
    if (!target || !desired) return;

    const q = (value: string) => quoteIdentifier(target.engine, value);
    const lines: string[] = [
      "-- OrbitoDB migration preview",
      `-- Target: ${target.name}`,
      `-- Desired schema: ${desired.name}`,
      "-- Review every statement before executing.",
      "-- Destructive removals are commented out by default.",
      "",
    ];

    for (const table of diff.onlyB) {
      const cols = schemaB[table] ?? {};
      const defs = Object.entries(cols).map(([name, type]) => `  ${q(name)} ${type || "TEXT"}`);
      if (defs.length) {
        lines.push(`CREATE TABLE ${q(table)} (`, defs.join(",\n"), ");", "");
      } else {
        lines.push(`-- TODO: CREATE TABLE ${q(table)}; -- column metadata unavailable`, "");
      }
    }

    for (const changed of diff.changed) {
      const desiredCols = schemaB[changed.table] ?? {};
      for (const column of changed.onlyB) {
        lines.push(
          `ALTER TABLE ${q(changed.table)} ADD COLUMN ${q(column)} ${desiredCols[column] || "TEXT"};`,
        );
      }
      for (const change of changed.typeChanged) {
        if (target.engine === "postgres") {
          lines.push(
            `ALTER TABLE ${q(changed.table)} ALTER COLUMN ${q(change.col)} TYPE ${change.b};`,
          );
        } else if (target.engine === "mysql") {
          lines.push(
            `ALTER TABLE ${q(changed.table)} MODIFY COLUMN ${q(change.col)} ${change.b};`,
          );
        } else {
          lines.push(
            `-- SQLite manual rebuild required: ${changed.table}.${change.col} ${change.a} -> ${change.b}`,
          );
        }
      }
      if (changed.onlyB.length || changed.typeChanged.length) lines.push("");
    }

    if (diff.onlyA.length || diff.changed.some((item) => item.onlyA.length)) {
      lines.push("-- Destructive differences (commented out):");
      for (const table of diff.onlyA) {
        lines.push(`-- DROP TABLE ${q(table)};`);
      }
      for (const changed of diff.changed) {
        for (const column of changed.onlyA) {
          if (target.engine === "sqlite") {
            lines.push(`-- SQLite rebuild required to remove ${changed.table}.${column}`);
          } else {
            lines.push(`-- ALTER TABLE ${q(changed.table)} DROP COLUMN ${q(column)};`);
          }
        }
      }
      lines.push("");
    }

    if (lines.filter((line) => line && !line.startsWith("--")).length === 0) {
      lines.push("-- No automatically applicable migration statements were generated.");
    }

    await useStore.getState().openAndIntrospect(aId);
    useStore.getState().openSqlTab(
      `Migration · ${target.name} ← ${desired.name}`,
      lines.join("\n"),
    );
    setOpen(false);
  };

  const inSync = diff && !diff.onlyA.length && !diff.onlyB.length && !diff.changed.length;

  return (
    <div className="bud-erd-backdrop" onClick={() => setOpen(false)}>
      <div className="bud-diff" onClick={(e) => e.stopPropagation()}>
        <div className="bud-erd-head">
          <span className="bud-erd-title">Schema diff</span>
          <button className="bud-erd-close" onClick={() => setOpen(false)} title="Close (Esc)">
            <IconX size={16} stroke={1.8} />
          </button>
        </div>

        <div className="bud-diff-bar">
          <select value={aId} onChange={(e) => setAId(e.target.value)}>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <IconArrowRight size={16} stroke={1.8} />
          <select value={bId} onChange={(e) => setBId(e.target.value)}>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="bud-diff-go" onClick={() => void compare()} disabled={busy || !aId || !bId || aId === bId}>
            {busy ? "Comparing…" : "Compare"}
          </button>
          <button
            className="bud-diff-migrate"
            onClick={() => void migrationPreview()}
            disabled={busy || !diff || !!inSync}
            title="Generate SQL to make the left connection match the right connection"
          >
            <IconCode size={14} stroke={1.8} />
            Migration preview
          </button>
        </div>

        <div className="bud-diff-body">
          {err && <div className="bud-error">⚠ {err}</div>}
          {!diff && !err && !busy && (
            <div className="bud-empty">Pick a target connection on the left and the desired schema on the right, then press Compare.</div>
          )}
          {inSync && <div className="bud-diff-insync">✓ Schemas are identical — {diff.identical} tables match.</div>}
          {diff && !inSync && (
            <>
              <div className="bud-diff-summary">
                {diff.onlyA.length} only in {nameOf(aId)} · {diff.onlyB.length} only in {nameOf(bId)} ·{" "}
                {diff.changed.length} changed · {diff.identical} identical
              </div>
              {diff.onlyA.length > 0 && (
                <div className="bud-diff-sec">
                  <div className="bud-diff-sec-h del">Tables only in {nameOf(aId)}</div>
                  {diff.onlyA.map((t) => (
                    <div className="bud-diff-row del" key={t}>
                      − {t}
                    </div>
                  ))}
                </div>
              )}
              {diff.onlyB.length > 0 && (
                <div className="bud-diff-sec">
                  <div className="bud-diff-sec-h add">Tables only in {nameOf(bId)}</div>
                  {diff.onlyB.map((t) => (
                    <div className="bud-diff-row add" key={t}>
                      + {t}
                    </div>
                  ))}
                </div>
              )}
              {diff.changed.map((c) => (
                <div className="bud-diff-sec" key={c.table}>
                  <div className="bud-diff-sec-h chg">Table “{c.table}” differs</div>
                  {c.onlyA.map((col) => (
                    <div className="bud-diff-row del" key={`a-${col}`}>
                      − column {col} <span className="bud-diff-note">(only in {nameOf(aId)})</span>
                    </div>
                  ))}
                  {c.onlyB.map((col) => (
                    <div className="bud-diff-row add" key={`b-${col}`}>
                      + column {col} <span className="bud-diff-note">(only in {nameOf(bId)})</span>
                    </div>
                  ))}
                  {c.typeChanged.map((tc) => (
                    <div className="bud-diff-row chg" key={`t-${tc.col}`}>
                      ~ {tc.col}: <span className="bud-diff-note">{tc.a}</span> → <span className="bud-diff-note">{tc.b}</span>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
