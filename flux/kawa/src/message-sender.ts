import * as T from "@simplex-chat/types";
import { ChatType } from "@simplex-chat/types/dist/types.js";
import type { ChatClient } from "simplex-chat";
import type { KawaConfig } from "./config.js";
import type { ContactContext } from "./session-manager.js";

/** Single constant for the repeated ChatType.Direct cast */
const DIRECT_CHAT_TYPE = ChatType.Direct as ChatType;

/**
 * Handles sending messages and live message updates to SimpleX contacts.
 * Encapsulates the live message state machine (IDLE → STREAMING → IDLE).
 */
export class MessageSender {
	constructor(
		private chatClient: ChatClient,
		private config: KawaConfig,
	) {}

	/**
	 * Send a plain text message to a contact (not a live message).
	 */
	async sendTextMessage(contactId: number, text: string): Promise<void> {
		try {
			await this.chatClient.apiSendTextMessage(DIRECT_CHAT_TYPE, contactId, text);
		} catch (err) {
			console.error(`[msg] Failed to send text message to contact ${contactId}:`, err);
		}
	}

	/**
	 * Update an existing live message (STREAMING state only).
	 * The IDLE → STREAMING transition is handled by startLiveMessage.
	 */
	async updateLiveMessage(ctx: ContactContext, text: string): Promise<void> {
		// Caller owns synchronous state mutation (per D1: write-before-yield).
		// accumulatedText is already set by the caller before this method is called.
		if (ctx.liveMessageItemId === null) {
			console.warn(`[msg] No live message item ID for contact ${ctx.contactId}, skipping update`);
			return;
		}
		await this.updateLiveMessageCmd(ctx.contactId, ctx.liveMessageItemId, text, true);
	}

	/**
	 * Start a live message using sendChatCmd (allows liveMessage: true).
	 * Includes a dedup guard: if the contact is already streaming with a valid itemId,
	 * the existing message is updated instead of creating a duplicate.
	 */
	async startLiveMessage(ctx: ContactContext, text: string): Promise<{ itemId: number } | null> {
		// Belt-and-suspenders dedup guard: if already streaming, update instead
		if (ctx.liveMessageState === "STREAMING" && ctx.liveMessageItemId !== null) {
			console.warn(`[msg] Already streaming for contact ${ctx.contactId}, updating instead`);
			await this.updateLiveMessage(ctx, text);
			return { itemId: ctx.liveMessageItemId };
		}

		try {
			const response = await this.chatClient.sendChatCmd(
				T.CC.APISendMessages.cmdString({
					sendRef: { chatType: DIRECT_CHAT_TYPE, chatId: ctx.contactId },
					liveMessage: true,
					composedMessages: [{ msgContent: { type: "text" as const, text }, mentions: {} }],
				}),
			);
			if (
				response &&
				typeof response === "object" &&
				"type" in response &&
				response.type === "newChatItems"
			) {
				const items = (response as T.CR.NewChatItems).chatItems;
				if (items.length > 0) {
					return { itemId: items[0].chatItem.meta.itemId };
				}
			}
			return null;
		} catch (err) {
			console.error(`[msg] Failed to start live message for contact ${ctx.contactId}:`, err);
			return null;
		}
	}

	/**
	 * Update a live message using sendChatCmd (allows liveMessage: true/false).
	 */
	async updateLiveMessageCmd(
		contactId: number,
		chatItemId: number,
		text: string,
		liveMessage: boolean,
	): Promise<void> {
		try {
			await this.chatClient.sendChatCmd(
				T.CC.APIUpdateChatItem.cmdString({
					chatRef: { chatType: DIRECT_CHAT_TYPE, chatId: contactId },
					chatItemId,
					liveMessage,
					updatedMessage: { msgContent: { type: "text" as const, text }, mentions: {} },
				}),
			);
		} catch (err) {
			console.error(`[msg] Failed to update live message for contact ${contactId}:`, err);
		}
	}

	/**
	 * Finalize the current live message (STREAMING → IDLE).
	 */
	async finalizeLiveMessage(ctx: ContactContext): Promise<void> {
		if (ctx.liveMessageState === "STREAMING") {
			if (ctx.liveMessageItemId !== null) {
				await this.updateLiveMessageCmd(
					ctx.contactId,
					ctx.liveMessageItemId,
					ctx.accumulatedText,
					false,
				);
			}
			ctx.liveMessageState = "IDLE";
			ctx.liveMessageItemId = null;
			ctx.accumulatedText = "";
		}
	}
}
