import { IconDots, IconEraser, IconPlus, IconX } from "@tabler/icons-react";
import { confirmDialog } from "../../state/dialog";
import { useStore } from "../../state/store";
import "./tab-actions.css";

function closeMenu(event: React.MouseEvent<HTMLButtonElement>) {
  event.currentTarget.closest("details")?.removeAttribute("open");
}

export function QueryTabActions() {
  const editors = useStore((state) => state.editors);
  const activeEditorId = useStore((state) => state.activeEditorId);
  const newEditor = useStore((state) => state.newEditor);
  const closeEditors = useStore((state) => state.closeEditors);

  const emptyIds = editors.filter((editor) => !editor.sql.trim()).map((editor) => editor.id);
  const closableEmptyIds = emptyIds.length === editors.length
    ? emptyIds.filter((id) => id !== activeEditorId)
    : emptyIds;
  const otherIds = editors.filter((editor) => editor.id !== activeEditorId).map((editor) => editor.id);
  const canReset = editors.length > 1 || !!editors[0]?.sql.trim();

  const requestClose = async (ids: string[], title: string, actionLabel: string) => {
    if (!ids.length) return;
    const withContent = editors.filter((editor) => ids.includes(editor.id) && editor.sql.trim());
    if (
      withContent.length > 0 &&
      !(await confirmDialog({
        title,
        message: `${withContent.length} ${withContent.length === 1 ? "query contains" : "queries contain"} SQL. Closing ${withContent.length === 1 ? "it" : "them"} removes the restored workspace copy.`,
        confirmLabel: actionLabel,
        danger: true,
      }))
    ) return;
    closeEditors(ids);
  };

  return (
    <div className="odb-tabbar-actions">
      <button className="bud-qtab-new" aria-label="New SQL editor" title="New SQL editor" onClick={newEditor}>
        <IconPlus size={15} stroke={2} />
      </button>
      <details className="odb-tab-actions">
        <summary aria-label="Manage query tabs" title="Manage query tabs">
          <IconDots size={16} stroke={1.8} />
        </summary>
        <div className="odb-tab-actions-menu" role="menu">
          <button
            role="menuitem"
            disabled={closableEmptyIds.length === 0}
            onClick={(event) => {
              closeMenu(event);
              closeEditors(closableEmptyIds);
            }}
          >
            <IconEraser size={14} stroke={1.7} />
            Close empty queries
            {closableEmptyIds.length > 0 && <span>{closableEmptyIds.length}</span>}
          </button>
          <button
            role="menuitem"
            disabled={otherIds.length === 0}
            onClick={(event) => {
              closeMenu(event);
              void requestClose(otherIds, "Close other query tabs?", "Close tabs");
            }}
          >
            <IconX size={14} stroke={1.8} />
            Close other queries
            {otherIds.length > 0 && <span>{otherIds.length}</span>}
          </button>
          <div className="odb-tab-actions-separator" />
          <button
            className="danger"
            role="menuitem"
            disabled={!canReset}
            onClick={(event) => {
              closeMenu(event);
              void requestClose(editors.map((editor) => editor.id), "Reset query tabs?", "Reset tabs");
            }}
          >
            <IconEraser size={14} stroke={1.7} />
            Reset query tabs
          </button>
        </div>
      </details>
    </div>
  );
}
