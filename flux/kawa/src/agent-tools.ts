import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { type AgentToolResult, defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { KawaConfig } from "./config.js";
import type { MessageSender } from "./message-sender.js";
import type { ContactContext } from "./session-manager.js";

/**
 * Error result helper.
 */
function errorResult(message: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: message }],
		details: {},
	};
}

/**
 * Success result helper.
 */
function successResult(message: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: message }],
		details: {},
	};
}

/**
 * Get the active contact ID from the session manager.
 * Returns undefined if no active session.
 */
export type GetActiveContactId = () => number | undefined;

/**
 * Create the `send_image` agent tool.
 * Allows the agent to send an image file from disk to the current contact as an inline SimpleX image.
 */
export function createSendImageTool(
	sender: MessageSender,
	config: KawaConfig,
	getActiveContactId: GetActiveContactId,
) {
	return defineTool({
		name: "send_image",
		label: "Send Image",
		description:
			"Send an image file to the current contact as an inline image in the chat. " +
			"The file path must be within the working directory or the KAWA_FILES_DIR directory. " +
			"Use this when the user asks you to share an image file.",
		parameters: Type.Object({
			path: Type.String({
				description: "Path to the image file to send. Must be within cwd or KAWA_FILES_DIR.",
			}),
			caption: Type.Optional(Type.String({ description: "Optional caption for the image" })),
		}),
		async execute(
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			_ctx,
		): Promise<AgentToolResult<unknown>> {
			const contactId = getActiveContactId();
			if (contactId === undefined) {
				return errorResult("No active contact session");
			}

			const filePath = params.path;
			const resolved = resolve(filePath);
			const cwd = resolve(config.cwd);
			const filesDir = resolve(config.filesDir);

			// Path validation
			if (
				!resolved.startsWith(`${cwd}/`) &&
				!resolved.startsWith(`${filesDir}/`) &&
				resolved !== cwd &&
				resolved !== filesDir
			) {
				return errorResult("Path must be within the working directory or KAWA_FILES_DIR");
			}

			// File existence check
			if (!existsSync(resolved)) {
				return errorResult(`File not found: ${filePath}`);
			}

			try {
				await sender.sendImageMessage(contactId, resolved, params.caption);
				return successResult(`Image sent successfully: ${basename(resolved)}`);
			} catch (err) {
				return errorResult(`Failed to send image: ${err}`);
			}
		},
	});
}

/**
 * Create the `send_file` agent tool.
 * Allows the agent to send a file from disk to the current contact as a SimpleX file attachment.
 */
export function createSendFileTool(
	sender: MessageSender,
	config: KawaConfig,
	getActiveContactId: GetActiveContactId,
) {
	return defineTool({
		name: "send_file",
		label: "Send File",
		description:
			"Send a file to the current contact as a file attachment in the chat. " +
			"The file path must be within the working directory or the KAWA_FILES_DIR directory. " +
			"Use this when the user asks you to share a file.",
		parameters: Type.Object({
			path: Type.String({
				description: "Path to the file to send. Must be within cwd or KAWA_FILES_DIR.",
			}),
			description: Type.Optional(Type.String({ description: "Optional description for the file" })),
		}),
		async execute(
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			_ctx,
		): Promise<AgentToolResult<unknown>> {
			const contactId = getActiveContactId();
			if (contactId === undefined) {
				return errorResult("No active contact session");
			}

			const filePath = params.path;
			const resolved = resolve(filePath);
			const cwd = resolve(config.cwd);
			const filesDir = resolve(config.filesDir);

			// Path validation
			if (
				!resolved.startsWith(`${cwd}/`) &&
				!resolved.startsWith(`${filesDir}/`) &&
				resolved !== cwd &&
				resolved !== filesDir
			) {
				return errorResult("Path must be within the working directory or KAWA_FILES_DIR");
			}

			// File existence check
			if (!existsSync(resolved)) {
				return errorResult(`File not found: ${filePath}`);
			}

			try {
				await sender.sendFileMessage(contactId, resolved, params.description);
				return successResult(`File sent successfully: ${basename(resolved)}`);
			} catch (err) {
				return errorResult(`Failed to send file: ${err}`);
			}
		},
	});
}
