/**
 * Converts standard/CommonMark markdown to SimpleX Chat's markdown dialect.
 *
 * SimpleX uses a different syntax than standard markdown:
 * - Bold: *text* (single asterisk, not double)
 * - Italic: _text_ (underscore, not single asterisk)
 * - Strikethrough: ~text~ (single tilde, not double)
 * - `# heading` → plain text (# is for Secrets in SimpleX, not headings)
 * - Code blocks, inline code, and link URLs pass through unchanged
 */

// Placeholder markers for protecting formatting during conversion
// Using unambiguous string tokens that won't appear in normal text
const BOLD_OPEN = "\x01";
const BOLD_CLOSE = "\x02";

// NUL character as placeholder delimiter (used in string replacement, not regex)
const PLACEHOLDER = "\x00";

/**
 * Create a regex-safe version of a placeholder string.
 * Avoids using control characters directly in regex literals (biome lint).
 */
function placeholderRegex(prefix: string): RegExp {
	return new RegExp(`${escapeRegex(PLACEHOLDER)}${prefix}(\\d+)${escapeRegex(PLACEHOLDER)}`, "g");
}

/**
 * Convert standard/CommonMark markdown to SimpleX Chat's markdown dialect.
 */
export function convertMarkdownToSimplex(text: string): string {
	// Step 0: Protect code blocks, inline code, and link URLs from conversion
	const codeBlocks: string[] = [];
	const inlineCodes: string[] = [];
	const linkUrls: string[] = [];

	// Protect fenced code blocks (``` ... ```)
	let result = text.replace(/```[\s\S]*?```/g, (match) => {
		codeBlocks.push(match);
		return `${PLACEHOLDER}CODEBLOCK${codeBlocks.length - 1}${PLACEHOLDER}`;
	});

	// Protect inline code (`code`)
	result = result.replace(/`[^`]+`/g, (match) => {
		inlineCodes.push(match);
		return `${PLACEHOLDER}INLINECODE${inlineCodes.length - 1}${PLACEHOLDER}`;
	});

	// Protect link URLs: [text](url) → [text]PLACEHOLDERLINKURL_NPLACEHOLDER
	// The [text] part remains for format conversion, the (url) part is protected
	result = result.replace(
		/\[([^\]]*)\]\(([^)]*)\)/g,
		(_match, linkText: string, linkUrl: string) => {
			linkUrls.push(linkUrl);
			return `[${linkText}]${PLACEHOLDER}LINKURL${linkUrls.length - 1}${PLACEHOLDER}`;
		},
	);

	// Step 1: Convert triple-asterisk bold-italic ***bold italic*** → _*bold italic*_
	// Use placeholders for the inner * so it's not re-matched
	result = result.replace(/\*\*\*(.+?)\*\*\*/g, `_${BOLD_OPEN}$1${BOLD_CLOSE}_`);

	// Step 2: Convert double-asterisk bold **text** → *text* (using placeholders)
	result = result.replace(/\*\*(.+?)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);

	// Step 3: Convert double-underscore bold __text__ → _text_
	// SimpleX has no bold-from-underscores, so __ becomes italic _
	result = result.replace(/__(.+?)__/g, "_$1_");

	// Step 4: Convert single-asterisk italic *text* → _text_
	// After step 2, remaining single * pairs are italic (bold is in placeholders)
	result = result.replace(/\*(.+?)\*/g, "_$1_");

	// Step 5: Convert double-tilde strikethrough ~~text~~ → ~text~
	result = result.replace(/~~(.+?)~~/g, "~$1~");

	// Step 6: Strip heading markers (# at start of line)
	// # is Secret text in SimpleX, not a heading
	result = result.replace(/^#{1,6}\s+/gm, "");

	// Step 7: Restore bold placeholders → *text* (SimpleX bold)
	result = result.replace(
		new RegExp(`${escapeRegex(BOLD_OPEN)}(.+?)${escapeRegex(BOLD_CLOSE)}`, "g"),
		"*$1*",
	);

	// Step 8: Restore protected content in reverse order
	// Link URLs: [text]PLACEHOLDERLINKURL_NPLACEHOLDER → [text](url)
	result = result.replace(placeholderRegex("LINKURL"), (_, idx) => `(${linkUrls[Number(idx)]})`);
	// Inline code
	result = result.replace(placeholderRegex("INLINECODE"), (_, idx) => inlineCodes[Number(idx)]);
	// Code blocks
	result = result.replace(placeholderRegex("CODEBLOCK"), (_, idx) => codeBlocks[Number(idx)]);

	return result;
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
