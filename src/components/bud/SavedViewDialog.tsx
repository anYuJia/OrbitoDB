import { IconBookmarkPlus, IconFilter, IconX } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { backdropV, centeredModalV } from "../../lib/motion";
import type { FilterOp, ViewFilter } from "../../state/store";
import { useStore } from "../../state/store";

const OPERATORS: Array<{ value: FilterOp; label: string }> = [
  { value: "=", label: "is exactly" },
  { value: "!=", label: "is not" },
  { value: "contains", label: "contains" },
  { value: ">", label: "is greater than" },
  { value: "<", label: "is less than" },
];

export function SavedViewDialog({
  table,
  columns,
  initialFilter,
  onClose,
}: {
  table: string;
  columns: Array<{ name: string; dataType?: string }>;
  initialFilter?: ViewFilter | null;
  onClose: () => void;
}) {
  const addView = useStore((state) => state.addView);
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [column, setColumn] = useState(
    initialFilter?.column && columns.some((item) => item.name === initialFilter.column)
      ? initialFilter.column
      : columns[0]?.name ?? "",
  );
  const [op, setOp] = useState<FilterOp>(initialFilter?.op ?? "contains");
  const [value, setValue] = useState(initialFilter?.value ?? "");

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const form = formRef.current;
    const focusable = () => Array.from(
      form?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const frame = window.requestAnimationFrame(() => {
      (form?.querySelector<HTMLElement>("[data-autofocus]") ?? focusable()[0])?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  const save = () => {
    if (!name.trim() || !column) return;
    if (addView(table, name, { column, op, value })) onClose();
  };
  const operatorLabel = OPERATORS.find((operator) => operator.value === op)?.label ?? op;

  return (
    <>
      <motion.div
        className="bud-modal-backdrop"
        variants={backdropV}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={onClose}
      />
      <motion.form
        ref={formRef}
        className="bud-modal bud-view-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-view-title"
        aria-describedby="saved-view-description"
        variants={centeredModalV}
        initial="hidden"
        animate="show"
        exit="exit"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bud-modal-head">
          <div>
            <span className="bud-modal-eyebrow">Table view</span>
            <h2 id="saved-view-title">Save a filtered view</h2>
            <p id="saved-view-description">The filter runs in the database and remains available after restart.</p>
          </div>
          <button type="button" className="bud-modal-close" onClick={onClose} aria-label="Close saved view dialog">
            <IconX size={18} stroke={1.7} />
          </button>
        </div>

        <div className="bud-modal-body">
          <label className="bud-field">
            <span>View name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Active customers"
              autoComplete="off"
              data-autofocus
            />
          </label>

          <fieldset className="bud-view-rule">
            <legend>Filter rule</legend>
            <label className="bud-field">
              <span>Column</span>
              <select value={column} onChange={(event) => setColumn(event.target.value)}>
                {columns.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}{item.dataType ? ` · ${item.dataType}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="bud-field">
              <span>Operator</span>
              <select value={op} onChange={(event) => setOp(event.target.value as FilterOp)}>
                {OPERATORS.map((operator) => (
                  <option key={operator.value} value={operator.value}>{operator.label}</option>
                ))}
              </select>
            </label>
            <label className="bud-field bud-view-rule-value">
              <span>Value</span>
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="Value to match"
                autoComplete="off"
              />
            </label>
          </fieldset>

          <div className="bud-view-preview" aria-label="Filter summary">
            <IconFilter size={15} stroke={1.8} />
            <span>Show rows where</span>
            <code>{column || "column"}</code>
            <span>{operatorLabel}</span>
            <code>{value || "…"}</code>
          </div>
        </div>

        <div className="bud-modal-actions">
          <button type="button" className="bud-modal-cancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="bud-modal-save" disabled={!name.trim() || !column}>
            <IconBookmarkPlus size={15} stroke={1.8} /> Save view
          </button>
        </div>
      </motion.form>
    </>
  );
}
