import { type ReactNode, useEffect, useRef, useState } from "react";

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Render a separator line; other fields are ignored. */
  divider?: boolean;
}

export interface CtxAnchor {
  x: number;
  y: number;
  items: MenuItem[];
}

/** A right-click context menu positioned at the cursor and clamped to the viewport. */
export function ContextMenu({ anchor, onClose }: { anchor: CtxAnchor; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.min(anchor.x, window.innerWidth - width - 8),
      top: Math.min(anchor.y, window.innerHeight - height - 8),
    });
    const frame = window.requestAnimationFrame(() =>
      el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const moveFocus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if (items.length === 0) return;
    e.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home"
      ? 0
      : e.key === "End"
        ? items.length - 1
        : current < 0
          ? 0
          : (current + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  return (
    <>
      <div
        className="bud-menu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="bud-ctx-menu"
        style={{ left: pos.left, top: pos.top }}
        role="menu"
        aria-label="Context actions"
        onKeyDown={moveFocus}
      >
        {anchor.items.map((it, i) =>
          it.divider ? (
            <div key={i} className="bud-ctx-sep" role="separator" />
          ) : (
            <button
              key={i}
              className={`bud-ctx-item ${it.danger ? "danger" : ""}`}
              disabled={it.disabled}
              role="menuitem"
              onClick={() => {
                it.onClick?.();
                onClose();
              }}
            >
              <span className="bud-ctx-ic">{it.icon}</span>
              {it.label}
            </button>
          ),
        )}
      </div>
    </>
  );
}
