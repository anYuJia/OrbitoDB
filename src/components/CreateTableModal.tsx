import { IconKey, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { ColumnDef, Engine } from "../ipc/types";
import { backdropV, centeredModalV, MotionButton } from "../lib/motion";
import { useI18n } from "../lib/i18n";
import { useStore } from "../state/store";

const TYPES: Record<Engine, string[]> = {
  sqlite: ["INTEGER", "TEXT", "REAL", "BLOB", "NUMERIC"],
  postgres: ["BIGSERIAL", "INTEGER", "BIGINT", "TEXT", "VARCHAR(255)", "BOOLEAN", "TIMESTAMP", "DATE", "NUMERIC", "JSONB"],
  mysql: ["BIGINT", "INT", "VARCHAR(255)", "TEXT", "BOOLEAN", "DATETIME", "DATE", "DECIMAL(10,2)", "JSON"],
};

export function CreateTableModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const createTable = useStore((s) => s.createTable);
  const conn = useStore((s) => s.connections.find((c) => c.id === s.activeConnectionId));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [cols, setCols] = useState<ColumnDef[]>([
    { name: "id", dataType: conn?.engine === "postgres" ? "BIGSERIAL" : "INTEGER", nullable: false, primaryKey: true },
    { name: "", dataType: "TEXT", nullable: true, primaryKey: false },
  ]);

  const types = useMemo(() => TYPES[conn?.engine ?? "sqlite"], [conn?.engine]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const update = (i: number, patch: Partial<ColumnDef>) => {
    setCols((current) =>
      current.map((column, index) => {
        if (patch.primaryKey === true) {
          if (index === i) return { ...column, ...patch, nullable: false, primaryKey: true };
          return { ...column, primaryKey: false };
        }
        if (index !== i) return column;
        return { ...column, ...patch };
      }),
    );
  };

  const addCol = () =>
    setCols((current) => [
      ...current,
      { name: "", dataType: types.includes("TEXT") ? "TEXT" : types[0], nullable: true, primaryKey: false },
    ]);

  const removeCol = (i: number) => {
    if (cols.length <= 1) return;
    setCols((current) => current.filter((_, index) => index !== i));
  };

  const submit = async () => {
    const table = name.trim();
    const valid = cols
      .map((column) => ({ ...column, name: column.name.trim(), dataType: column.dataType.trim() }))
      .filter((column) => column.name);
    if (!table || valid.length === 0 || busy) return;
    setBusy(true);
    try {
      await createTable(table, valid);
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const canCreate = !!name.trim() && cols.some((column) => column.name.trim()) && !busy;

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
      <motion.div
        className="odb-create-table-modal"
        variants={centeredModalV}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="odb-create-table-head">
          <div>
            <span>{t("createTable.eyebrow")}</span>
            <h2>{t("createTable.title")}</h2>
            <p>{conn ? conn.name + " · " + conn.database : t("createTable.activeConnection")}</p>
          </div>
          <button onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>
            <IconX size={16} stroke={1.8} />
          </button>
        </header>

        <div className="odb-create-table-body">
          <label className="odb-form-field odb-table-name-field">
            <span>{t("createTable.tableName")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="users"
              autoFocus
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
              }}
            />
          </label>

          <div className="odb-create-columns">
            <div className="odb-create-column-row header">
              <span>#</span>
              <span>{t("createTable.name")}</span>
              <span>{t("createTable.sqlType")}</span>
              <span>{t("createTable.null")}</span>
              <span>{t("createTable.primaryKey")}</span>
              <span />
            </div>
            {cols.map((column, index) => (
              <div className="odb-create-column-row" key={index}>
                <span className="index">{index + 1}</span>
                <input
                  value={column.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                  placeholder={index === 0 ? "id" : "column_name"}
                  aria-label={t("createTable.columnNameAria", { index: index + 1 })}
                />
                <select
                  value={column.dataType}
                  onChange={(e) => update(index, { dataType: e.target.value })}
                  aria-label={t("createTable.columnTypeAria", { index: index + 1 })}
                >
                  {!types.includes(column.dataType) && <option value={column.dataType}>{column.dataType}</option>}
                  {types.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <label className="odb-check-cell" title={t("createTable.allowNull")}>
                  <input
                    type="checkbox"
                    checked={column.nullable}
                    disabled={column.primaryKey}
                    onChange={(e) => update(index, { nullable: e.target.checked })}
                  />
                </label>
                <label className="odb-check-cell pk" title={t("createTable.primaryKeyTitle")}>
                  <input
                    type="checkbox"
                    checked={column.primaryKey}
                    onChange={(e) => update(index, { primaryKey: e.target.checked })}
                  />
                  {column.primaryKey && <IconKey size={11} stroke={2} />}
                </label>
                <button
                  className="odb-remove-column"
                  title={t("createTable.removeColumn")} aria-label={t("createTable.removeColumn")}
                  onClick={() => removeCol(index)}
                  disabled={cols.length <= 1}
                >
                  <IconTrash size={13} stroke={1.8} />
                </button>
              </div>
            ))}
          </div>

          <button className="odb-add-column" onClick={addCol}>
            <IconPlus size={14} stroke={2} />
            {t("createTable.addColumn")}
          </button>
        </div>

        <footer className="odb-create-table-footer">
          <span>{t("createTable.shortcut")}</span>
          <div>
            <MotionButton className="odb-modal-secondary" onClick={onClose}>{t("common.cancel")}</MotionButton>
            <MotionButton className="odb-modal-primary" onClick={() => void submit()} disabled={!canCreate}>
              {busy ? t("createTable.creating") : t("createTable.title")}
            </MotionButton>
          </div>
        </footer>
      </motion.div>
    </>
  );
}
