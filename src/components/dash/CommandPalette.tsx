import {
  IconBolt,
  IconCode,
  IconCornerDownLeft,
  IconDatabase,
  IconEraser,
  IconFileText,
  IconHistory,
  IconPlus,
  IconSearch,
  IconSettings,
  IconStar,
  IconTable,
  IconTerminal2,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { type ComponentType, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { shortcutLabel } from "../../lib/platform";
import { backdropV, commandV } from "../../lib/motion";
import { useStore } from "../../state/store";

type Icon = ComponentType<{ size?: number; stroke?: number }>;
type CmdGroup = "actions" | "navigate" | "connections" | "tables" | "scripts" | "starred";
type Cmd = { id: string; group: CmdGroup; label: string; hint?: string; Icon: Icon; run: () => void };

const GROUPS: CmdGroup[] = ["actions", "navigate", "connections", "tables", "scripts", "starred"];

export function CommandPalette({ onAddServer }: { onAddServer: () => void }) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const connections = useStore((s) => s.connections);
  const tables = useStore((s) => s.schema.tables);
  const activeId = useStore((s) => s.activeConnectionId);
  const scripts = useStore((s) => s.scripts);
  const favorites = useStore((s) => s.favorites);
  const setTopView = useStore((s) => s.setTopView);
  const setView = useStore((s) => s.setView);
  const setSql = useStore((s) => s.setSql);
  const loadSql = useStore((s) => s.loadSql);
  const newEditor = useStore((s) => s.newEditor);
  const run = useStore((s) => s.run);
  const openAndIntrospect = useStore((s) => s.openAndIntrospect);
  const openTableData = useStore((s) => s.openTableData);
  const runShortcut = shortcutLabel("Enter");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onEvt = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("orbitodb:cmdk", onEvt);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("orbitodb:cmdk", onEvt);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const close = () => setOpen(false);
  const act = (fn: () => void) => () => {
    fn();
    close();
  };

  const cmds: Cmd[] = useMemo(() => {
    const editor = () => {
      setTopView("data");
      setView("sql");
    };
    const list: Cmd[] = [
      { id: "a-query", group: "actions", label: t("cmd.newQuery"), hint: "SQL", Icon: IconBolt, run: act(newEditor) },
      { id: "a-conn", group: "actions", label: t("cmd.newConnection"), Icon: IconPlus, run: act(onAddServer) },
      {
        id: "a-run",
        group: "actions",
        label: t("cmd.runCurrent"),
        hint: runShortcut,
        Icon: IconCode,
        run: act(() => {
          editor();
          if (activeId) void run();
        }),
      },
      { id: "a-clear", group: "actions", label: t("cmd.clearEditor"), Icon: IconEraser, run: act(() => setSql("")) },
      { id: "n-editor", group: "navigate", label: t("cmd.queryEditor"), Icon: IconTerminal2, run: act(editor) },
      {
        id: "n-data",
        group: "navigate",
        label: t("cmd.dataBrowser"),
        Icon: IconTable,
        run: act(() => {
          setTopView("data");
          setView("data");
        }),
      },
      {
        id: "n-history",
        group: "navigate",
        label: t("cmd.history"),
        Icon: IconHistory,
        run: act(() => {
          setTopView("data");
          setView("history");
        }),
      },
      { id: "n-schema", group: "navigate", label: t("cmd.schemaTools"), Icon: IconDatabase, run: act(() => setTopView("design")) },
      { id: "n-utils", group: "navigate", label: t("cmd.utilities"), Icon: IconBolt, run: act(() => setTopView("automation")) },
      {
        id: "a-cross-search",
        group: "actions",
        label: t("cmd.crossSearch"),
        Icon: IconSearch,
        run: act(() => window.dispatchEvent(new Event("orbitodb:cross-table-search"))),
      },
      { id: "n-settings", group: "navigate", label: t("cmd.settings"), Icon: IconSettings, run: act(() => setTopView("settings")) },
    ];
    for (const c of connections) {
      list.push({
        id: `c-${c.id}`,
        group: "connections",
        label: t("cmd.connectTo", { name: c.name }),
        hint: c.engine,
        Icon: IconDatabase,
        run: act(() => void openAndIntrospect(c.id)),
      });
    }
    for (const table of tables) {
      list.push({
        id: `t-${table.name}`,
        group: "tables",
        label: t("cmd.openTable", { name: table.name }),
        Icon: IconTable,
        run: act(() => void openTableData(table.name)),
      });
    }
    for (const script of scripts) {
      list.push({ id: `s-${script.id}`, group: "scripts", label: script.name, Icon: IconFileText, run: act(() => loadSql(script.sql)) });
    }
    for (const favorite of favorites) {
      list.push({ id: `fav-${favorite.id}`, group: "starred", label: favorite.name, Icon: IconStar, run: act(() => loadSql(favorite.sql)) });
    }
    return list;
    // Locale intentionally invalidates command labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, tables, scripts, favorites, activeId, locale]);

  const ql = q.trim().toLocaleLowerCase(locale);
  const filtered = ql ? cmds.filter((c) => c.label.toLocaleLowerCase(locale).includes(ql)) : cmds;
  const clampedSel = Math.min(sel, Math.max(0, filtered.length - 1));

  const groupLabel = (group: CmdGroup) => {
    const key = {
      actions: "cmd.actions",
      navigate: "cmd.navigate",
      connections: "cmd.connections",
      tables: "cmd.tables",
      scripts: "cmd.scripts",
      starred: "cmd.starred",
    } as const;
    return t(key[group]);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[clampedSel]?.run();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="cmdk-backdrop"
          variants={backdropV}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={close}
        >
          <motion.div
            className="cmdk"
            role="dialog"
            aria-modal="true"
            aria-label={t("top.commandPalette", { shortcut: shortcutLabel("K") })}
            variants={commandV}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cmdk-input">
              <IconSearch size={16} stroke={1.8} />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSel(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={t("cmd.placeholder")}
                spellCheck={false}
              />
            </div>
            <div className="cmdk-list">
              {filtered.length === 0 && <div className="cmdk-empty">{t("cmd.noMatches")}</div>}
              {GROUPS.map((group) => {
                const items = filtered.filter((c) => c.group === group);
                if (!items.length) return null;
                return (
                  <div className="cmdk-group" key={group}>
                    <div className="cmdk-group-h">{groupLabel(group)}</div>
                    {items.map((c) => {
                      const idx = filtered.indexOf(c);
                      return (
                        <button
                          key={c.id}
                          className={`cmdk-item ${idx === clampedSel ? "on" : ""}`}
                          onMouseEnter={() => setSel(idx)}
                          onClick={c.run}
                        >
                          <c.Icon size={16} stroke={1.7} />
                          <span className="cmdk-label">{c.label}</span>
                          {c.hint && <span className="cmdk-hint">{c.hint}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="cmdk-foot">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> {t("cmd.navigateHint")}
              </span>
              <span>
                <kbd><IconCornerDownLeft size={11} stroke={2} /></kbd> {t("cmd.selectHint")}
              </span>
              <span>
                <kbd>esc</kbd> {t("cmd.closeHint")}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
