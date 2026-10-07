/**
 * Prepares LeetCode's problem HTML for embedding in Markdown (GitHub renders inline HTML).
 *
 * In Markdown, an HTML block ends at a blank line and indented lines become code blocks, which
 * would break LeetCode's indented <ul>/<li> markup. So outside <pre> blocks, lines are
 * de-indented and blank lines dropped; <pre> blocks (examples) are kept verbatim.
 */
export function statementToMarkdown(html: string): string {
  const parts = html.replace(/\r\n/g, '\n').split(/(<pre[\s\S]*?<\/pre>)/i);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part.replace(/\n{2,}/g, '\n');
      return part
        .replace(/&nbsp;/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}
