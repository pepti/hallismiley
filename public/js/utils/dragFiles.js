// Drag-time file checks for a drop zone. Ported from icelandicstore #193
// (d4fb5cca, the order builder), generalised to take the zone's MIME pattern.
//
// A drop zone should say yes or no while the file is still in the air: an
// unsupported type turns the outline red and the cursor to "no drop" instead
// of being accepted and apologised for afterwards.
//
// The check has to be MIME-based. While a drag is in flight the spec withholds
// file NAMES (only the drop reveals them), so extension tests are unavailable
// and DataTransferItem.type is all there is to go on. Two deliberate passes:
//   - an item the OS left untyped ('') is let through — indistinguishable from
//     an unsupported one at drag time, and the drop handler re-checks every
//     file anyway (it stays the authority);
//   - a browser that exposes no items until the drop is let through too.

/** Does this drag carry files at all (not selected text or a link)? */
export function dragHasFiles(e) {
  return Array.from(e?.dataTransfer?.types || []).includes('Files');
}

/** Could at least one dragged file be one the zone takes (mime: RegExp)? */
export function dragHasUsableFile(dt, mime) {
  const files = Array.from(dt?.items || []).filter((i) => i.kind === 'file');
  if (!files.length) return true;
  return files.some((i) => !i.type || mime.test(i.type));
}
