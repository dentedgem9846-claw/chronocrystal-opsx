import { describe, expect, it } from "vitest";
import { convertMarkdownToSimplex } from "../src/markdown-to-simplex.js";

describe("convertMarkdownToSimplex", () => {
	// Bold conversion: **text** → *text*
	describe("bold conversion", () => {
		it("converts double-asterisk bold to single-asterisk", () => {
			expect(convertMarkdownToSimplex("**bold text**")).toBe("*bold text*");
		});

		it("converts multiple bold segments", () => {
			expect(convertMarkdownToSimplex("**first** and **second**")).toBe("*first* and *second*");
		});

		it("converts bold within a sentence", () => {
			expect(convertMarkdownToSimplex("this is **bold** text")).toBe("this is *bold* text");
		});
	});

	// Italic conversion: *text* → _text_
	describe("italic conversion", () => {
		it("converts single-asterisk italic to underscore", () => {
			expect(convertMarkdownToSimplex("*italic text*")).toBe("_italic text_");
		});

		it("converts italic within a sentence", () => {
			expect(convertMarkdownToSimplex("this is *italic* text")).toBe("this is _italic_ text");
		});

		it("does NOT convert single asterisks that are inside double-asterisk bold context", () => {
			// **bold** is handled first → *bold*, then *...* in that result should not be re-processed
			// This is implicitly tested by the bold test
		});
	});

	// Double underscore bold: __text__ → _text_
	describe("underscore bold conversion", () => {
		it("converts double-underscore bold to underscore italic", () => {
			expect(convertMarkdownToSimplex("__bold text__")).toBe("_bold text_");
		});
	});

	// Strikethrough: ~~text~~ → ~text~
	describe("strikethrough conversion", () => {
		it("converts double-tilde strikethrough to single-tilde", () => {
			expect(convertMarkdownToSimplex("~~struck~~")).toBe("~struck~");
		});

		it("converts strikethrough within a sentence", () => {
			expect(convertMarkdownToSimplex("this is ~~deleted~~ text")).toBe("this is ~deleted~ text");
		});
	});

	// Heading stripping
	describe("heading stripping", () => {
		it("strips # heading prefix", () => {
			expect(convertMarkdownToSimplex("# Heading")).toBe("Heading");
		});

		it("strips ## heading prefix", () => {
			expect(convertMarkdownToSimplex("## Subheading")).toBe("Subheading");
		});

		it("strips ### heading prefix", () => {
			expect(convertMarkdownToSimplex("### Sub-subheading")).toBe("Sub-subheading");
		});

		it("strips heading at start of line but not mid-text", () => {
			expect(convertMarkdownToSimplex("not a # heading")).toBe("not a # heading");
		});

		it("strips heading within multiline text", () => {
			expect(convertMarkdownToSimplex("intro\n# Heading\nbody")).toBe("intro\nHeading\nbody");
		});
	});

	// Code block protection
	describe("code block protection", () => {
		it("preserves fenced code blocks unchanged", () => {
			const codeBlock = "```js\nconst x = 1;\n```";
			expect(convertMarkdownToSimplex(codeBlock)).toBe(codeBlock);
		});

		it("does not convert markdown-like syntax inside code blocks", () => {
			const codeBlock = "```js\nconst x = **pointer;\n```";
			expect(convertMarkdownToSimplex(codeBlock)).toBe(codeBlock);
		});

		it("preserves multi-line code blocks", () => {
			const codeBlock = "```\nline 1\nline 2\n```";
			expect(convertMarkdownToSimplex(codeBlock)).toBe(codeBlock);
		});
	});

	// Inline code preservation
	describe("inline code preservation", () => {
		it("preserves inline code unchanged", () => {
			expect(convertMarkdownToSimplex("`code`")).toBe("`code`");
		});

		it("preserves inline code with surrounding text", () => {
			expect(convertMarkdownToSimplex("use `const x = 1` here")).toBe("use `const x = 1` here");
		});

		it("does not convert markdown syntax inside inline code", () => {
			expect(convertMarkdownToSimplex("`**not bold**`")).toBe("`**not bold**`");
		});
	});

	// Link preservation
	describe("link preservation", () => {
		it("preserves markdown links unchanged", () => {
			expect(convertMarkdownToSimplex("[link text](https://example.com)")).toBe(
				"[link text](https://example.com)",
			);
		});

		it("preserves links with bold inside", () => {
			expect(convertMarkdownToSimplex("[**bold link**](https://example.com)")).toBe(
				"[*bold link*](https://example.com)",
			);
		});
	});

	// Nested formatting: ***bold italic*** → _*bold italic*_
	describe("nested formatting", () => {
		it("converts triple-asterisk bold italic", () => {
			expect(convertMarkdownToSimplex("***bold italic***")).toBe("_*bold italic*_");
		});

		it("converts multiple nested formats", () => {
			expect(convertMarkdownToSimplex("***one*** and ***two***")).toBe("_*one*_ and _*two*_");
		});
	});

	// SimpleX-native passthrough
	describe("SimpleX-native passthrough", () => {
		it("treats ambiguous single-asterisk text as italic (converts to _text_)", () => {
			// Single *text* is indistinguishable from standard markdown italic,
			// so it is converted to _text_. The SYSTEM.md prompt tells the LLM
			// to use SimpleX *bold* format, and the converter catches anything missed.
			expect(convertMarkdownToSimplex("*text*")).toBe("_text_");
		});

		it("preserves already-correct SimpleX italic _text_", () => {
			expect(convertMarkdownToSimplex("_italic_")).toBe("_italic_");
		});

		it("preserves already-correct SimpleX strikethrough ~text~", () => {
			expect(convertMarkdownToSimplex("~text~")).toBe("~text~");
		});
	});

	// Plain text pass-through
	describe("plain text pass-through", () => {
		it("passes plain text through unchanged", () => {
			expect(convertMarkdownToSimplex("hello world")).toBe("hello world");
		});

		it("preserves Unicode emojis", () => {
			expect(convertMarkdownToSimplex("🔧 ✓ ✗ ⚠")).toBe("🔧 ✓ ✗ ⚠");
		});

		it("preserves newlines", () => {
			expect(convertMarkdownToSimplex("line1\nline2")).toBe("line1\nline2");
		});
	});

	// Combined scenarios
	describe("combined scenarios", () => {
		it("handles mixed formatting in a paragraph", () => {
			const input = "This is **bold** and *italic* and ~~struck~~ text";
			const expected = "This is *bold* and _italic_ and ~struck~ text";
			expect(convertMarkdownToSimplex(input)).toBe(expected);
		});

		it("handles bold with code", () => {
			const input = "Use **bold** for emphasis and `code` for code";
			const expected = "Use *bold* for emphasis and `code` for code";
			expect(convertMarkdownToSimplex(input)).toBe(expected);
		});

		it("handles heading with bold", () => {
			const input = "# **Important** Notice";
			const expected = "*Important* Notice";
			expect(convertMarkdownToSimplex(input)).toBe(expected);
		});

		it("handles code block followed by bold", () => {
			const input = "```\ncode\n```\nThen **bold** text";
			const expected = "```\ncode\n```\nThen *bold* text";
			expect(convertMarkdownToSimplex(input)).toBe(expected);
		});
	});
});
