/** Runs in the remote page, including focused fields and same-origin frames. */
export function selectedText(): string {
  let doc = document;
  let active = doc.activeElement;
  while (active?.tagName === "IFRAME") {
    try {
      const frameDoc = (active as HTMLIFrameElement).contentDocument;
      if (!frameDoc) break;
      doc = frameDoc;
      active = doc.activeElement;
    } catch { break; }
  }
  if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") {
    const field = active as HTMLInputElement | HTMLTextAreaElement;
    if (field.selectionStart !== null && field.selectionEnd !== null) {
      return field.value.slice(field.selectionStart, field.selectionEnd);
    }
  }
  return doc.getSelection()?.toString() || "";
}
