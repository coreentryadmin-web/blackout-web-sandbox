/** Center a row inside an overflow scroll container (matrix spot ladder). */
export function scrollRowIntoViewCenter(scrollEl: HTMLElement, rowEl: HTMLElement): void {
  const scrollRect = scrollEl.getBoundingClientRect();
  const rowRect = rowEl.getBoundingClientRect();
  const target =
    scrollEl.scrollTop +
    (rowRect.top - scrollRect.top - (scrollRect.height - rowRect.height) / 2);
  const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
  scrollEl.scrollTop = Math.max(0, Math.min(target, max));
}
