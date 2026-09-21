function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function primaryModifierLabel(): string {
  return isMac() ? "⌘" : "Ctrl";
}

export function shortcutLabel(key: string, options?: { shift?: boolean }): string {
  const modifier = primaryModifierLabel();
  const parts = [modifier];
  if (options?.shift) parts.push(isMac() ? "⇧" : "Shift");
  parts.push(key);
  return isMac() ? parts.join("") : parts.join("+");
}
