import { IconAlertTriangle, IconCheck, IconInfoCircle, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { toastV } from "../../lib/motion";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../state/toast";

export function ToastHost() {
  const { t } = useI18n();
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  return (
    <div className="bud-toasts">
      <AnimatePresence initial={false}>
        {toasts.map((item) => (
          <motion.div
            key={item.id}
            layout
            className={`bud-toast ${item.kind}`}
            variants={toastV}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <span className="bud-toast-ic">
              {item.kind === "success" ? (
                <IconCheck size={15} stroke={2} />
              ) : item.kind === "error" ? (
                <IconAlertTriangle size={15} stroke={1.8} />
              ) : (
                <IconInfoCircle size={15} stroke={1.8} />
              )}
            </span>
            <span className="bud-toast-msg">{item.message}</span>
            <button className="bud-toast-x" onClick={() => dismiss(item.id)} title={t("toast.dismiss")} aria-label={t("toast.dismiss")}>
              <IconX size={13} stroke={1.9} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
