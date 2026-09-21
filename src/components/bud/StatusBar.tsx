import { IconLock, IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";
import { useI18n } from "../../lib/i18n";
import { useStore } from "../../state/store";

export function StatusBar() {
  const { locale, t } = useI18n();
  const conn = useStore((s) => s.connections.find((c) => c.id === s.activeConnectionId));
  const result = useStore((s) => s.result);
  const loadingResult = useStore((s) => s.loadingResult);
  const selection = useStore((s) => s.selection);
  const readOnly = useStore((s) => s.readOnlyConns.includes(s.activeConnectionId ?? ""));
  const txnDirty = useStore((s) => s.txnDirty);
  const rollbackTxn = useStore((s) => s.rollbackTxn);
  const commitTxn = useStore((s) => s.commitTxn);

  const rows = result?.rows.length ?? 0;
  const elapsed = result ? `${result.elapsedMs} ms` : t("status.ready");

  return (
    <footer className="bud-statusbar odb-statusbar" aria-live="polite">
      <div className="odb-status-left">
        {conn ? (
          <span className="odb-status-connection">
            <IconPlugConnected size={12} stroke={2} />
            <b>{conn.name}</b>
            <span>{conn.engine}</span>
          </span>
        ) : (
          <span className="odb-status-connection muted">
            <IconPlugConnectedX size={12} stroke={2} />
            {t("status.noActive")}
          </span>
        )}
        {conn?.env && <span className={`odb-env-tag ${conn.env}`}>{conn.env === "prod" ? "PROD" : conn.env.toUpperCase()}</span>}
        {readOnly && (
          <span className="odb-readonly">
            <IconLock size={11} stroke={2} />
            {t("status.readOnly")}
          </span>
        )}
      </div>

      <div className="odb-status-right">
        {txnDirty && (
          <span className="odb-txn">
            <span>{t("status.uncommitted")}</span>
            <button onClick={() => void rollbackTxn()}>{t("common.rollback")}</button>
            <button className="primary" onClick={() => void commitTxn()}>{t("common.commit")}</button>
          </span>
        )}
        {loadingResult && <span>{t("status.running")}</span>}
        {selection.length > 0 && <span>{t("status.selected", { count: selection.length.toLocaleString(locale) })}</span>}
        {rows > 0 && <span>{t("status.rows", { count: rows.toLocaleString(locale) })}</span>}
        <span>{elapsed}</span>
      </div>
    </footer>
  );
}
