import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { isMacPlatform, primaryModifierLabel } from "../../lib/platform";
import { backdropV, listItemV, listV, panelV } from "../../lib/motion";

export function ShortcutsOverlay() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const shortcuts = useMemo(() => {
    const primary = primaryModifierLabel();
    const shift = isMacPlatform() ? "⇧" : "Shift";
    const enter = isMacPlatform() ? "↵" : "Enter";
    return [
      { keys: [primary, "K"], label: t("shortcuts.commandPalette") },
      { keys: [primary, enter], label: t("shortcuts.execute") },
      { keys: [primary, "/"], label: t("shortcuts.comment") },
      { keys: [primary, shift, "F"], label: t("shortcuts.format") },
      { keys: [primary, "D"], label: t("shortcuts.duplicate") },
      { keys: ["Alt", "↑", "↓"], label: t("shortcuts.moveLine") },
      { keys: ["Tab", `${shift}Tab`], label: t("shortcuts.indent") },
      { keys: ["(", "[", "\"", "…"], label: t("shortcuts.wrap") },
      { keys: ["Alt", "1-9"], label: t("shortcuts.switchTab") },
      { keys: [primary, "Space"], label: t("shortcuts.autocomplete") },
      { keys: ["↑", "↓"], label: t("shortcuts.navigate") },
      { keys: [primary, "C"], label: t("shortcuts.copyCell") },
      { keys: ["Esc"], label: t("shortcuts.closePopup") },
      { keys: ["?"], label: t("shortcuts.showHelp") },
      { keys: ["Right-click"], label: t("shortcuts.contextMenu") },
      { keys: ["Click / Dbl-click"], label: t("shortcuts.editCell") },
    ];
  }, [t]);

  useEffect(() => {
    const onEvt = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "?" && !typing) {
        e.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("orbitodb:shortcuts", onEvt);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("orbitodb:shortcuts", onEvt);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="bud-sc-backdrop"
          variants={backdropV}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="bud-sc"
            role="dialog"
            aria-modal="true"
            aria-label={t("shortcuts.title")}
            variants={panelV}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bud-sc-head">{t("shortcuts.title")}</div>
            <motion.div className="bud-sc-list" variants={listV} initial="hidden" animate="show">
              {shortcuts.map((item) => (
                <motion.div className="bud-sc-row" key={item.label} variants={listItemV}>
                  <span className="bud-sc-label">{item.label}</span>
                  <span className="bud-sc-keys">
                    {item.keys.map((key, index) => (
                      <kbd key={index}>{key}</kbd>
                    ))}
                  </span>
                </motion.div>
              ))}
            </motion.div>
            <div className="bud-sc-foot">
              {t("shortcuts.closeHint")}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
