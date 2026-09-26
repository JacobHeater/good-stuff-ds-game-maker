/** The text as the DS's font can show it: one line of printable ASCII (a line break becomes a space, anything else the font hasn't got a question mark). */
export function fontSafeText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/[^ -~]/g, "?");
}

/** A C string literal for plain ASCII text (quotes, backslashes and question marks, which could start a trigraph, are escaped). */
export function cString(text: string): string {
  return `"${text.replace(/[\\"?]/g, (c) => "\\" + c)}"`;
}
