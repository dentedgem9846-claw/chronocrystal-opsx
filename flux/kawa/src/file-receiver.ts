import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { AChatItem, ChatItem } from "@simplex-chat/types/dist/types.js";
import type { ChatClient } from "simplex-chat";
import type { KawaConfig } from "./config.js";
import { imageFileToImageContent } from "./image-resize.js";
import { extractFrames } from "./video-frame-extractor.js";

/** Pending file transfer state */
interface PendingFile {
	/** Contact ID that sent the file */
	contactId: number;
	/** Text caption from the message */
	text: string;
	/** Type of the message content (image, video, file) */
	msgContentType: string;
	/** Timestamp when the file was first detected */
	timestamp: number;
	/** Timeout timer */
	timeout: ReturnType<typeof setTimeout>;
	/** File name from CIFile */
	fileName: string;
}

/**
 * Callback type for when a buffered message (text + file) is ready to prompt the agent.
 * @param contactId - The contact that sent the message
 * @param text - The text portion of the message
 * @param images - Optional image content (for images and video frames)
 * @param filePath - Optional file path reference (for generic files)
 */
export type FileReadyCallback = (
	contactId: number,
	text: string,
	images?: ImageContent[],
	filePath?: string,
) => Promise<void>;

/**
 * Handles incoming file transfer lifecycle — detects CIFile attachments on chat items,
 * auto-accepts via apiReceiveFile(), buffers text until transfer completes, saves files
 * to split storage (images/, videos/, files/), and routes to the agent.
 */
export class FileReceiver {
	/** Pending file transfers indexed by fileId */
	private pendingFiles = new Map<number, PendingFile>();

	constructor(
		private chatClient: ChatClient,
		private config: KawaConfig,
		private onFileReady: FileReadyCallback,
	) {}

	/**
	 * Handle a new chat item that may contain a file attachment.
	 * Detects CIFile on chat items, auto-accepts the transfer, and buffers the message.
	 */
	async handleNewChatItem(chatItem: ChatItem, contactId: number): Promise<void> {
		const file = chatItem.file;
		if (!file) return;

		const content = chatItem.content;
		if (content.type !== "rcvMsgContent" || !content.msgContent) return;

		// Only handle image, video, and file content types
		const msgType = content.msgContent.type;
		if (msgType !== "image" && msgType !== "video" && msgType !== "file") {
			console.log(`[file-receiver] Skipping ${msgType} content type`);
			return;
		}

		// Extract text from the message content
		const text = this.extractTextFromContent(content.msgContent);

		// Auto-accept the file transfer if it's an invitation
		if (file.fileStatus.type === "rcvInvitation") {
			console.log(
				`[file-receiver] Auto-accepting file transfer: fileId=${file.fileId}, fileName=${file.fileName}, type=${msgType}`,
			);
			try {
				await this.chatClient.apiReceiveFile(file.fileId);
			} catch (err) {
				console.error(`[file-receiver] Failed to accept file transfer fileId=${file.fileId}:`, err);
				return;
			}
		}

		// Buffer the message until file transfer completes
		const timeout = setTimeout(() => {
			this.handleBufferTimeout(file.fileId);
		}, this.config.fileBufferTimeoutMs);

		this.pendingFiles.set(file.fileId, {
			contactId,
			text: text || "",
			msgContentType: msgType,
			timestamp: Date.now(),
			timeout,
			fileName: file.fileName,
		});

		console.log(
			`[file-receiver] Buffering message with file attachment: fileId=${file.fileId}, type=${msgType}`,
		);
	}

	/**
	 * Handle rcvFileStart event.
	 */
	handleRcvFileStart(fileId: number): void {
		console.log(`[file-receiver] File transfer started: fileId=${fileId}`);
	}

	/**
	 * Handle rcvFileComplete event. Resolve the buffer and route the file.
	 */
	async handleRcvFileComplete(chatItem: AChatItem): Promise<void> {
		const file = chatItem.chatItem.file;
		const fileId = file?.fileId ?? null;
		if (fileId === null) return;

		const pending = this.pendingFiles.get(fileId);
		if (!pending) {
			console.log(`[file-receiver] No pending buffer for fileId=${fileId}, ignoring`);
			return;
		}

		// Clear the timeout
		clearTimeout(pending.timeout);
		this.pendingFiles.delete(fileId);

		// Determine the file path — use fileSource.filePath if available,
		// otherwise construct from fileName in the files dir
		const filesDir = this.config.filesDir;
		const filePath = file?.fileSource?.filePath ?? join(filesDir, pending.fileName);

		console.log(
			`[file-receiver] File transfer complete: fileId=${fileId}, type=${pending.msgContentType}, path=${filePath}`,
		);

		// Route based on content type
		try {
			if (pending.msgContentType === "image") {
				await this.routeImage(pending, filePath);
			} else if (pending.msgContentType === "video") {
				await this.routeVideo(pending, filePath);
			} else {
				// Generic file — path reference
				const text = this.appendFileInfo(pending.text, pending.fileName, filePath);
				await this.onFileReady(pending.contactId, text, undefined, filePath);
			}
		} catch (err) {
			console.error(`[file-receiver] Error routing file fileId=${fileId}:`, err);
			// Fall back to text-only prompt
			const text = `${pending.text} [Error processing file: ${err}]`;
			await this.onFileReady(pending.contactId, text);
		}
	}

	/**
	 * Handle rcvFileCancelled event.
	 */
	handleRcvFileCancelled(chatItem: AChatItem): Promise<void> {
		const fileId = this.extractFileId(chatItem);
		if (fileId === null) return Promise.resolve();

		const pending = this.pendingFiles.get(fileId);
		if (!pending) return Promise.resolve();

		clearTimeout(pending.timeout);
		this.pendingFiles.delete(fileId);

		console.log(`[file-receiver] File transfer cancelled: fileId=${fileId}`);

		// Prompt with text only, noting the cancellation
		const text = `${pending.text} [File transfer was cancelled]`;
		return this.onFileReady(pending.contactId, text);
	}

	/**
	 * Handle buffer timeout — prompt with text only.
	 */
	private handleBufferTimeout(fileId: number): void {
		const pending = this.pendingFiles.get(fileId);
		if (!pending) return;

		this.pendingFiles.delete(fileId);
		console.log(`[file-receiver] Buffer timeout for fileId=${fileId}, prompting with text only`);

		const text = `${pending.text} [1 file attached, still downloading]`;
		this.onFileReady(pending.contactId, text).catch((err) => {
			console.error(`[file-receiver] Error in timeout callback for fileId=${fileId}:`, err);
		});
	}

	/**
	 * Route an image file to the agent.
	 */
	private async routeImage(pending: PendingFile, filePath: string): Promise<void> {
		const imageContent = await imageFileToImageContent(filePath, this.config.imageMaxDimension);
		await this.onFileReady(pending.contactId, pending.text, [imageContent]);
	}

	/**
	 * Route a video file to the agent via frame extraction.
	 */
	private async routeVideo(pending: PendingFile, filePath: string): Promise<void> {
		const { extractFrames } = await import("./video-frame-extractor.js");
		const framePaths = await extractFrames(filePath, this.config);

		if (framePaths.length === 0) {
			// No frames extracted — prompt with text only
			const text = `${pending.text} [Video received but frame extraction failed or unavailable]`;
			await this.onFileReady(pending.contactId, text);
			return;
		}

		// Convert frames to ImageContent
		const images: ImageContent[] = [];
		for (const framePath of framePaths) {
			try {
				const content = await imageFileToImageContent(framePath, this.config.imageMaxDimension);
				images.push(content);
			} catch (err) {
				console.error(`[file-receiver] Error loading frame ${framePath}:`, err);
			}
		}

		if (images.length === 0) {
			const text = `${pending.text} [Video received but frame processing failed]`;
			await this.onFileReady(pending.contactId, text);
			return;
		}

		await this.onFileReady(pending.contactId, pending.text, images);
	}

	/**
	 * Extract the fileId from an AChatItem's CIFile.
	 */
	private extractFileId(chatItem: AChatItem): number | null {
		const file = chatItem.chatItem.file;
		if (!file) return null;
		return file.fileId;
	}

	/**
	 * Get the subdirectory name for a content type.
	 */
	/**
	 * Extract text from a MsgContent that may carry a caption.
	 * Note: MsgContent.Image, .Video, .File all carry a `text` field at runtime
	 * (from the outer type definitions), even though the inner namespace
	 * definitions don't include it. We access it via runtime property check.
	 */
	private extractTextFromContent(msgContent: { type: string; text?: string }): string | undefined {
		switch (msgContent.type) {
			case "text":
			case "image":
			case "video":
			case "file":
			case "link":
				return msgContent.text || undefined;
			default:
				return undefined;
		}
	}

	/**
	 * Append a file info note to the text prompt.
	 */
	private appendFileInfo(text: string, fileName: string, filePath: string): string {
		const suffix = `📎 Attached: ${fileName} at ${filePath}`;
		return text ? `${text}\n${suffix}` : suffix;
	}
}
