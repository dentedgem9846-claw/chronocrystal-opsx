import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { KawaConfig } from "./config.js";
import { convertMarkdownToSimplex } from "./markdown-to-simplex.js";
import type { ContactContext } from "./session-manager.js";

/**
 * Formats agent events into text suitable for a SimpleX live message.
 * Handles tool call visibility with 🔧 prefix and truncation.
 */
export class EventFormatter {
	constructor(private config: KawaConfig) {}

	/**
	 * Process an AgentEvent and return the formatted text fragment to append.
	 * Returns null if the event doesn't produce visible output.
	 */
	formatEventAppend(event: AgentSessionEvent): string | null {
		switch (event.type) {
			case "tool_execution_start": {
				return this.formatToolStart(event.toolName, event.args);
			}
			case "tool_execution_end": {
				return this.formatToolEnd(event.isError, event.result);
			}
			default:
				return null;
		}
	}

	/**
	 * Format a tool execution start event.
	 * Returns something like: `\n🔧 bash: ls -la`
	 */
	private formatToolStart(toolName: string, args: unknown): string {
		const argStr = this.formatToolArgs(toolName, args);
		return `\n🔧 ${toolName}: ${argStr}`;
	}

	/**
	 * Format a tool execution end event.
	 * Appends ✓ or ✗ with error summary.
	 * If the result is a string, includes truncated output.
	 */
	private formatToolEnd(isError: boolean, result: unknown): string {
		if (isError) {
			const errorSummary = this.truncateOutput(
				typeof result === "string" ? result : JSON.stringify(result),
			);
			return ` ✗ ${errorSummary}`;
		}
		// Success — just append checkmark
		return " ✓";
	}

	/**
	 * Format tool arguments for display.
	 */
	private formatToolArgs(toolName: string, args: unknown): string {
		if (typeof args !== "object" || args === null) {
			return String(args);
		}
		const a = args as Record<string, unknown>;

		switch (toolName) {
			case "bash":
				return String(a.command ?? a.cmd ?? JSON.stringify(args));
			case "read":
				return String(a.file_path ?? a.path ?? JSON.stringify(args));
			case "edit":
				return String(a.file_path ?? a.path ?? JSON.stringify(args));
			case "write":
				return String(a.file_path ?? a.path ?? JSON.stringify(args));
			default:
				return JSON.stringify(args);
		}
	}

	/**
	 * Truncate output to the configured line limit.
	 */
	truncateOutput(output: string): string {
		const lines = output.split("\n");
		const limit = this.config.toolTruncationLines;
		if (lines.length <= limit) return output;
		return `${lines.slice(0, limit).join("\n")}\n... and ${lines.length - limit} more lines`;
	}

	/**
	 * Extract text content from an AgentMessage.
	 * AgentMessage is a union type; we extract text from assistant messages.
	 *
	 * Handles three content formats:
	 * 1. String content — some models/APIs return plain text strings
	 * 2. Array of content blocks — structured format with typed blocks (text, thinking)
	 * 3. Thinking-only content — fallback to reasoning blocks when text is empty
	 */
	extractMessageText(message: unknown): string {
		if (!message || typeof message !== "object") return "";
		const msg = message as Record<string, unknown>;

		if (msg.role !== "assistant") return "";

		const content = msg.content;

		// Handle string content directly
		if (typeof content === "string" && content) {
			return convertMarkdownToSimplex(content);
		}

		// Handle array of content blocks
		if (Array.isArray(content)) {
			const textParts: string[] = [];
			const thinkingParts: string[] = [];
			for (const block of content as Array<Record<string, unknown>>) {
				if (block.type === "text" && typeof block.text === "string") {
					textParts.push(block.text);
				} else if (block.type === "thinking" && typeof block.thinking === "string") {
					thinkingParts.push(block.thinking);
				}
			}
			const text = textParts.join("");
			if (text) return convertMarkdownToSimplex(text);
			return thinkingParts.join("");
		}

		return "";
	}
}

/**
 * Extract text from a SimpleX chat item content.
 * Used to parse incoming messages from SimpleX contacts.
 * Returns text for all content types that carry text (including captions on images/videos/files).
 * Returns undefined only for content types with no meaningful text.
 */
export function extractTextFromContent(content: {
	type: string;
	msgContent?: { type: string; text?: string };
}): string | undefined {
	if (content.type === "rcvMsgContent" && content.msgContent) {
		const msgContent = content.msgContent;
		switch (msgContent.type) {
			case "text":
				return msgContent.text || undefined;
			case "image":
				return msgContent.text || undefined;
			case "video":
				return msgContent.text || undefined;
			case "file":
				return msgContent.text || undefined;
			case "link":
				return msgContent.text || undefined;
		}
	}
	return undefined;
}
