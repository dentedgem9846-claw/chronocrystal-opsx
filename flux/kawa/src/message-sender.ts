import * as T from "@simplex-chat/types";
import { ChatType } from "@simplex-chat/types/dist/types.js";
import type { ChatClient } from "simplex-chat";
import type { KawaConfig } from "./config.js";
import type { ContactContext } from "./session-manager.js";

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
			await this.chatClient.apiSendTextMessage(ChatType.Direct as ChatType, contactId, text);
		} catch (err) {
			console.error(`[msg] Failed to send text message to contact ${contactId}:`, err);
		}
	}

	/**
	 * Start a new live message or update an existing one.
	 * Handles the IDLE → STREAMING transition by creating a new live message.
	 * Handles STREAMING updates by updating in place.
	 */
	async sendOrUpdateLiveMessage(ctx: ContactContext, text: string): Promise<ContactContext> {
		if (ctx.liveMessageState === "IDLE") {
			// IDLE → STREAMING: create a new live message
			try {
				const chatItems = await this.chatClient.apiSendMessages(
					ChatType.Direct as ChatType,
					ctx.contactId,
					[{ msgContent: { type: "text" as const, text }, mentions: {} }],
				);
				if (chatItems.length > 0) {
					ctx.liveMessageItemId = chatItems[0].chatItem.meta.itemId;
				}
				ctx.liveMessageState = "STREAMING";
				ctx.accumulatedText = text;
			} catch (err) {
				console.error(`[msg] Failed to create live message for contact ${ctx.contactId}:`, err);
				// Fallback: send as regular message
				await this.sendTextMessage(ctx.contactId, text);
			}
		} else {
			// STREAMING: update existing live message
			ctx.accumulatedText = text;
			await this.updateLiveMessage(ctx);
		}
		return ctx;
	}

	/**
	 * Start a live message using sendChatCmd (allows liveMessage: true).
	 */
	async startLiveMessage(contactId: number, text: string): Promise<{ itemId: number } | null> {
		try {
			const response = await this.chatClient.sendChatCmd(
				T.CC.APISendMessages.cmdString({
					sendRef: { chatType: ChatType.Direct as ChatType, chatId: contactId },
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
			console.error(`[msg] Failed to start live message for contact ${contactId}:`, err);
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
					chatRef: { chatType: ChatType.Direct as ChatType, chatId: contactId },
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
	async finalizeLiveMessage(ctx: ContactContext): Promise<ContactContext> {
		if (ctx.liveMessageState === "STREAMING" && ctx.liveMessageItemId !== null) {
			await this.updateLiveMessageCmd(
				ctx.contactId,
				ctx.liveMessageItemId,
				ctx.accumulatedText,
				false,
			);
			ctx.liveMessageState = "IDLE";
			ctx.liveMessageItemId = null;
			ctx.accumulatedText = "";
		}
		return ctx;
	}

	/**
	 * Update a live message in place (STREAMING state, liveMessage: true).
	 */
	private async updateLiveMessage(ctx: ContactContext): Promise<void> {
		if (ctx.liveMessageItemId === null) {
			console.warn(`[msg] No live message item ID for contact ${ctx.contactId}, skipping update`);
			return;
		}
		await this.updateLiveMessageCmd(
			ctx.contactId,
			ctx.liveMessageItemId,
			ctx.accumulatedText,
			true,
		);
	}
}
