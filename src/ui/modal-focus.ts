// Shared a11y helper for modals.
//
// Every modal in this app follows the W1.11 pattern:
//
//   1. On open, stash `document.activeElement` into a module-scope
//      variable `_previouslyFocused`.
//   2. Move focus into the modal (close button, or the most useful
//      initial field).
//   3. On close, restore focus to `_previouslyFocused`.
//
// Step 3 is fragile when the stored element lives inside a panel that
// can re-render while the modal is open (e.g., the schema panel — its
// workbook subscriber fires on any workbook tick). After a re-render
// the stored ref points at a detached node; `.focus()` on it silently
// falls back to `document.body`, defeating the a11y goal.
//
// This helper restores focus with a fallback: if the stored element is
// no longer in the live DOM, look up the trigger via its `data-action`
// attribute and focus the fresh button instead.

export function restoreModalFocus(stored: HTMLElement | null): void {
  if (!stored) return;
  if (stored.isConnected) {
    stored.focus();
    return;
  }
  const action = stored.dataset?.action;
  if (action) {
    document.querySelector<HTMLElement>(`[data-action="${action}"]`)?.focus();
  }
}
