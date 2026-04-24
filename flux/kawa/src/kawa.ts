/**
 * Kawa — Conversational coding agent accessible through SimpleX Chat.
 *
 * Kawa uses pi's AgentSession API as her coding engine and the
 * simplex-chat npm SDK for SimpleX Chat communication.
 *
 * Architecture:
 * - SimpleXProcess: spawns & monitors the simplex-chat CLI
 * - ChatClient: SDK connection to the CLI
 * - SessionManager: per-contact AgentSession mapping
 * - MessageSender: live message streaming state machine
 * - EventFormatter: formats agent events into chat text
 * - CommandHandler: slash commands (/help, /new, /compact, /status)
 */

import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageContent } from "@mariozechner/pi-ai";
import { type AgentSessionEvent, createAgentSession } from "@mariozechner/pi-coding-agent";
import type * as T from "@simplex-chat/types";
// ChatPeerType is a CJS enum that needs a value import for runtime use
import { ChatPeerType } from "@simplex-chat/types/dist/types.js";
import { ChatClient } from "simplex-chat";
import { createSendFileTool, createSendImageTool } from "./agent-tools.js";
import { CommandHandler } from "./commands.js";
import { type KawaConfig, defaultConfig, parsePositiveInt } from "./config.js";
import { EventFormatter, extractTextFromContent } from "./event-formatter.js";
import { FileReceiver } from "./file-receiver.js";
import { LiveMessageThrottler } from "./live-message-throttler.js";
import { MessageSender } from "./message-sender.js";
import { type ContactContext, SessionManager } from "./session-manager.js";
import { SimpleXProcess } from "./simplex-process.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve the agent directory (where .pi/ lives) */
const KAWA_DIR = join(__dirname, "..");
const AGENT_DIR = join(KAWA_DIR, ".pi");

/** Module-level storage for the connection address (exposed by HTTP API) */
let kawaAddress: string | null = null;

/** Module-level reference to the active ChatClient (for /connect endpoint) */
let activeChatClient: ChatClient | null = null;

/**
 * Create the address and connect HTTP server.
 */
function createApiServer(port: number) {
	const server = createServer(async (req, res) => {
		if (req.method === "GET" && req.url === "/address") {
			if (kawaAddress) {
				res.writeHead(200, { "Content-Type": "text/plain" });
				res.end(kawaAddress);
			} else {
				res.writeHead(503, { "Content-Type": "text/plain" });
				res.end("Kawa is not ready yet");
			}
			return;
		}

		if (req.method === "POST" && req.url === "/connect") {
			if (!activeChatClient) {
				res.writeHead(503, { "Content-Type": "text/plain" });
				res.end("Kawa is not connected to SimpleX yet");
				return;
			}
			let body = "";
			for await (const chunk of req) body += chunk;
			const connLink = body.trim();
			if (!connLink) {
				res.writeHead(400, { "Content-Type": "text/plain" });
				res.end("Missing connection link in request body");
				return;
			}
			try {
				console.log(`[kawa] Connecting to ${connLink.slice(0, 40)}...`);
				await activeChatClient.apiConnectActiveUser(connLink);
				res.writeHead(200, { "Content-Type": "text/plain" });
				res.end("Connection initiated");
			} catch (err) {
				console.error("[kawa] Connect failed:", err);
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.end(`Connection failed: ${err}`);
			}
			return;
		}

		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not Found");
	});

	server.listen(port, () => {
		console.log(`[kawa] Address API listening on port ${port}`);
	});
}

/**
 * Detect if simplex-chat CLI is available.
 */
function detectSimplexBin(config: KawaConfig): string {
	try {
		execSync(`${config.simplexBin} --version`, { stdio: "pipe" });
		return config.simplexBin;
	} catch {
		console.error(
			`❌ simplex-chat CLI not found at "${config.simplexBin}".\n   Please install it: https://github.com/simplex-chat/simplex-chat\n   Or set the KAWA_SIMPLEX_BIN environment variable.`,
		);
		process.exit(1);
	}
}

/** Module-level flag indicating whether ffmpeg is available for video frame extraction. */
export let ffmpegAvailable = false;

/**
 * Detect if ffmpeg is available for video frame extraction.
 * Sets the module-level `ffmpegAvailable` flag. Logs a warning if not found.
 */
function detectFfmpegBin(config: KawaConfig): void {
	try {
		execSync(`${config.ffmpegBin} -version`, { stdio: "pipe" });
		ffmpegAvailable = true;
		console.log(`[kawa] ffmpeg found at: ${config.ffmpegBin}`);
	} catch {
		ffmpegAvailable = false;
		console.warn(
			`⚠️ ffmpeg not found at "${config.ffmpegBin}". Video frame extraction will be disabled.\n   Install ffmpeg or set the KAWA_FFMPEG_BIN environment variable.`,
		);
	}
}

/**
 * Create an AgentSession for a contact using Kawa's .pi config.
 */
async function createSessionForContact(
	contactId: number,
	sessions: SessionManager,
	sender: MessageSender,
	config: KawaConfig,
): Promise<ContactContext | undefined> {
	const sendImageTool = createSendImageTool(sender, config, () => {
		const ctx = sessions.getByContactId(contactId);
		return ctx?.contactId;
	});
	const sendFileTool = createSendFileTool(sender, config, () => {
		const ctx = sessions.getByContactId(contactId);
		return ctx?.contactId;
	});

	try {
		const { session } = await createAgentSession({
			agentDir: AGENT_DIR,
			cwd: process.cwd(),
			customTools: [sendImageTool, sendFileTool],
		});

		const ctx: ContactContext = {
			contactId,
			session,
			liveMessageItemId: null,
			accumulatedText: "",
			liveMessageState: "IDLE",
			unsubscribe: null,
			generation: 0,
			throttleTimer: null,
			lastSentText: "",
		};

		const added = sessions.add(ctx);
		if (!added) {
			console.warn(`[kawa] Max sessions reached, cannot create session for contact ${contactId}`);
			return undefined;
		}

		return ctx;
	} catch (err) {
		console.error(`[kawa] Failed to create AgentSession for contact ${contactId}:`, err);
		return undefined;
	}
}

/**
 * Wire up agent session events to SimpleX live messages.
 */
function wireSessionEvents(
	ctx: ContactContext,
	sender: MessageSender,
	formatter: EventFormatter,
	throttler: LiveMessageThrottler,
): void {
	const listener = (event: AgentSessionEvent) => {
		const gen = ctx.generation;
		handleAgentEvent(ctx, event, sender, formatter, throttler).catch((err) => {
			console.error(`[kawa] Error handling agent event for contact ${ctx.contactId}:`, err);
			// Only reset state if this error belongs to the current generation
			// Otherwise a stale error from a prior prompt could corrupt the new session's state
			if (ctx.generation !== gen) return;
			ctx.liveMessageState = "IDLE";
			ctx.liveMessageItemId = null;
			ctx.accumulatedText = "";
			ctx.lastSentText = "";
			throttler.cancel(ctx);
		});
	};

	ctx.unsubscribe = ctx.session.subscribe(listener);
}

/**
 * Handle an agent event and update the live message.
 */
async function handleAgentEvent(
	ctx: ContactContext,
	event: AgentSessionEvent,
	sender: MessageSender,
	formatter: EventFormatter,
	throttler: LiveMessageThrottler,
): Promise<void> {
	// Capture generation before any await to detect stale events after cross-path resets
	const gen = ctx.generation;

	switch (event.type) {
		case "message_update": {
			// Extract text from the assistant message
			const text = formatter.extractMessageText(event.message);
			if (text) {
				ctx.accumulatedText = text;
				if (ctx.liveMessageState === "IDLE") {
					// IDLE → STREAMING: start a live message with liveMessage: true
					// Set state synchronously BEFORE the await to prevent race conditions
					ctx.liveMessageState = "STREAMING";
					const result = await sender.startLiveMessage(ctx, ctx.accumulatedText);
					if (ctx.generation !== gen) return; // stale event, discard silently
					if (result) {
						ctx.liveMessageItemId = result.itemId;
						ctx.lastSentText = ctx.accumulatedText;
					}
				} else {
					// STREAMING: throttle the update
					throttler.scheduleUpdate(ctx);
				}
			}
			break;
		}

		case "tool_execution_start": {
			const append = formatter.formatEventAppend(event);
			if (append) {
				// Flush any throttled update before appending tool marker
				await throttler.flush(ctx);
				if (ctx.generation !== gen) return; // stale event, discard silently
				// Append synchronously BEFORE the await to prevent race conditions
				ctx.accumulatedText += append;
				await sender.updateLiveMessage(ctx, ctx.accumulatedText);
				if (ctx.generation !== gen) return; // stale event, discard silently
				ctx.lastSentText = ctx.accumulatedText;
			}
			break;
		}

		case "tool_execution_end": {
			const append = formatter.formatEventAppend(event);
			if (append) {
				// Flush any throttled update before appending tool marker
				await throttler.flush(ctx);
				if (ctx.generation !== gen) return; // stale event, discard silently
				// Append synchronously BEFORE the await to prevent race conditions
				ctx.accumulatedText += append;
				await sender.updateLiveMessage(ctx, ctx.accumulatedText);
				if (ctx.generation !== gen) return; // stale event, discard silently
				ctx.lastSentText = ctx.accumulatedText;
			}
			break;
		}

		case "agent_end": {
			// Check generation BEFORE side effects to prevent stale I/O
			if (ctx.generation !== gen) return; // stale event, discard silently
			// Flush any throttled update before finalizing
			await throttler.flush(ctx);
			if (ctx.generation !== gen) return; // stale event, discard silently
			// Finalize the live message
			if (ctx.liveMessageState === "IDLE" && !ctx.accumulatedText) {
				// Agent ended without producing any output — send a fallback message
				await sender.sendTextMessage(ctx.contactId, "(Agent finished with no output)");
				if (ctx.generation !== gen) return; // stale after await, discard silently
			} else {
				await sender.finalizeLiveMessage(ctx);
				if (ctx.generation !== gen) return; // stale after await, discard silently
			}
			break;
		}

		case "compaction_end":
		case "auto_retry_start":
		case "auto_retry_end":
		case "queue_update":
			// These events don't produce visible output in chat
			break;
	}
}

/**
 * Main entry point.
 */
async function main() {
	const config: KawaConfig = {
		...defaultConfig,
		agentDir: AGENT_DIR,
		cwd: process.cwd(),
		simplexPort: Number(process.env.KAWA_SIMPLEX_PORT ?? defaultConfig.simplexPort),
		simplexBin: process.env.KAWA_SIMPLEX_BIN ?? defaultConfig.simplexBin,
		simplexDataDir: process.env.KAWA_SIMPLEX_DATA_DIR ?? defaultConfig.simplexDataDir,
		botDisplayName: process.env.KAWA_BOT_DISPLAY_NAME ?? defaultConfig.botDisplayName,
		maxSessions: Number(process.env.KAWA_MAX_SESSIONS ?? defaultConfig.maxSessions),
		addressApiPort: Number(process.env.KAWA_ADDRESS_PORT ?? defaultConfig.addressApiPort),
		toolTruncationLines: Number(
			process.env.KAWA_TOOL_TRUNCATION_LINES ?? defaultConfig.toolTruncationLines,
		),
		liveMessageUpdateIntervalMs: parsePositiveInt(
			Number(
				process.env.KAWA_LIVE_MSG_UPDATE_INTERVAL_MS ?? defaultConfig.liveMessageUpdateIntervalMs,
			),
			"KAWA_LIVE_MSG_UPDATE_INTERVAL_MS",
		),
		filesDir: process.env.KAWA_FILES_DIR ?? join(process.cwd(), "kawa-files"),
		ffmpegBin: process.env.KAWA_FFMPEG_BIN ?? defaultConfig.ffmpegBin,
		imageMaxDimension: Number(
			process.env.KAWA_IMAGE_MAX_DIMENSION ?? defaultConfig.imageMaxDimension,
		),
		fileBufferTimeoutMs: Number(
			process.env.KAWA_FILE_BUFFER_TIMEOUT_MS ?? defaultConfig.fileBufferTimeoutMs,
		),
	};

	console.log("[kawa] Starting Kawa agent...");
	console.log(`[kawa] Agent directory: ${config.agentDir}`);
	console.log(`[kawa] Working directory: ${config.cwd}`);

	// Start the API server early (503 until address is set)
	createApiServer(config.addressApiPort);

	// Task 9.2: Detect missing simplex-chat CLI
	detectSimplexBin(config);

	// Detect ffmpeg for video frame extraction
	detectFfmpegBin(config);

	// Create file storage directories
	for (const subdir of ["images", "videos", "files"]) {
		const dir = join(config.filesDir, subdir);
		mkdirSync(dir, { recursive: true });
		console.log(`[kawa] Files directory ready: ${dir}`);
	}

	// Task 9.3: Setup logging for lifecycle events
	const sessions = new SessionManager(config.maxSessions);
	const formatter = new EventFormatter(config);

	// Helper function to create and wire a session for a contact
	async function runSessionLoop(
		_chatClient: ChatClient,
		_messageSender: MessageSender,
		_commandHandler: CommandHandler,
		_throttler: LiveMessageThrottler,
		_fileReceiver: FileReceiver,
	): Promise<void> {
		// Task 4.1-4.3: Bot profile setup
		await setupBotProfile(_chatClient, config);

		// Configure SimpleX to store received files in KAWA_FILES_DIR
		try {
			await _chatClient.sendChatCmd(`/_files_folder ${config.filesDir}`);
			console.log(`[kawa] Set files folder to: ${config.filesDir}`);
		} catch (err) {
			console.warn("[kawa] Failed to set files folder:", err);
		}

		console.log("[kawa] Kawa is online! Waiting for messages...");

		// Task 3.3: Main event loop
		await processEvents(
			_chatClient,
			sessions,
			_messageSender,
			_commandHandler,
			formatter,
			_throttler,
			config,
			_fileReceiver,
		);
	}

	// Task 2.1-2.3: Start SimpleX CLI process
	const simplexProcess = new SimpleXProcess(
		config,
		// onReady: CLI process is up, connect ChatClient
		async () => {
			try {
				const connectedClient = await ChatClient.create(`ws://localhost:${config.simplexPort}`);
				activeChatClient = connectedClient;
				const sender = new MessageSender(connectedClient, config);
				const throttler = new LiveMessageThrottler(sender, config.liveMessageUpdateIntervalMs);
				sessions.setThrottler(throttler);
				const cmdHandler = new CommandHandler(
					sessions,
					sender,
					config,
					(contactId) =>
						createAndWireSessionForHandler(
							contactId,
							sessions,
							sender,
							formatter,
							throttler,
							config,
						),
					throttler,
				);
				const fileReceiver = new FileReceiver(
					connectedClient,
					config,
					async (contactId, text, images, filePath) => {
						// Callback for when a buffered message with file is ready to prompt the agent
						await handleIncomingMessage(
							contactId,
							text,
							sessions,
							sender,
							cmdHandler,
							formatter,
							throttler,
							config,
							images,
							filePath,
						);
					},
				);

				simplexProcess.resetBackoff();

				await runSessionLoop(connectedClient, sender, cmdHandler, throttler, fileReceiver);
			} catch (err) {
				console.error("[kawa] Failed to connect to SimpleX:", err);
			}
		},
		// onError
		(err: Error) => {
			console.error("[kawa] SimpleX process error:", err);
		},
	);

	// Task 2.4: Graceful shutdown
	const shutdown = async () => {
		console.log("[kawa] Shutting down...");
		await sessions.closeAll();
		if (activeChatClient) {
			await activeChatClient.disconnect();
		}
		simplexProcess.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// Start the SimpleX CLI
	simplexProcess.start();
}

/**
 * Setup bot profile: create user if needed, enable auto-accept, register slash commands.
 */
async function setupBotProfile(chatClient: ChatClient, config: KawaConfig): Promise<void> {
	// Task 4.1: Check for existing user or create bot profile
	let user = await chatClient.apiGetActiveUser();
	if (!user) {
		console.log("[kawa] No active user found, creating bot profile...");
		user = await chatClient.apiCreateActiveUser({
			displayName: config.botDisplayName,
			fullName: `${config.botDisplayName} Agent`,
			peerType: ChatPeerType.Bot,
		});
		console.log(`[kawa] Created user: ${user.localDisplayName}`);
	}

	// Task 4.2: Create address for sharing
	const address = await chatClient.apiCreateLink(user.userId);
	kawaAddress = address;
	console.log(`[kawa] Share this address to connect: ${address}`);

	// Task 4.3: Enable auto-accept on address (best-effort; bots may auto-accept by default)
	try {
		await chatClient.enableAddressAutoAccept(user.userId, undefined, true);
		console.log("[kawa] Auto-accept enabled on address");
	} catch (err) {
		console.warn(
			"[kawa] enableAddressAutoAccept failed (bot address may auto-accept by default):",
			err,
		);
	}

	// Note: Slash commands in SimpleX bots are handled in-process in the event loop
	// The SDK doesn't have a direct API for registering bot commands yet.
}

/**
 * Helper to extract file ID from an AChatItem.
 */
function aChatItemFileId(
	chatItem: import("@simplex-chat/types/dist/types.js").AChatItem,
): number | null {
	return chatItem.chatItem.file?.fileId ?? null;
}

/**
 * Main event loop: process incoming SimpleX events.
 */
async function processEvents(
	chatClient: ChatClient,
	sessions: SessionManager,
	sender: MessageSender,
	commandHandler: CommandHandler,
	formatter: EventFormatter,
	throttler: LiveMessageThrottler,
	config: KawaConfig,
	fileReceiver: FileReceiver,
): Promise<void> {
	try {
		for await (const event of chatClient.msgQ) {
			await handleSimpleXEvent(
				event,
				chatClient,
				sessions,
				sender,
				commandHandler,
				formatter,
				throttler,
				config,
				fileReceiver,
			);
		}
	} catch (err) {
		console.error("[kawa] Event loop error:", err);
	}
}

/**
 * Route incoming SimpleX events.
 */
async function handleSimpleXEvent(
	event: T.ChatEvent,
	_chatClient: ChatClient,
	sessions: SessionManager,
	sender: MessageSender,
	commandHandler: CommandHandler,
	formatter: EventFormatter,
	throttler: LiveMessageThrottler,
	config: KawaConfig,
	fileReceiver: FileReceiver,
): Promise<void> {
	switch (event.type) {
		// Task 5.3: New contact connected
		case "contactConnected": {
			const contactId = event.contact.contactId;
			console.log(`[kawa] Contact connected: ${contactId}`);

			const ctx = await createAndWireSessionForHandler(
				contactId,
				sessions,
				sender,
				formatter,
				throttler,
				config,
			);
			if (ctx) {
				await sender.sendTextMessage(
					contactId,
					`👋 Hi! I'm ${config.botDisplayName}, your coding agent. Send me a message and I'll help you with coding tasks. Type /help for commands.`,
				);
			} else {
				await sender.sendTextMessage(contactId, "❌ Sorry, Kawa is at capacity. Try again later.");
			}
			break;
		}

		// Task 5.4: Contact deleted
		case "contactDeletedByContact": {
			const contactId = event.contact.contactId;
			console.log(`[kawa] Contact deleted: ${contactId}`);
			sessions.removeByContactId(contactId);
			break;
		}

		// Task 5.2/5.5: Incoming messages
		case "newChatItems": {
			for (const aChatItem of event.chatItems) {
				// Only handle direct messages
				if (aChatItem.chatInfo.type !== "direct") continue;

				const contactId = aChatItem.chatInfo.contact.contactId;
				if (contactId === undefined) continue;

				// Check for file attachments (image, video, file)
				const chatItem = aChatItem.chatItem;
				if (chatItem.file && chatItem.content.type === "rcvMsgContent") {
					const msgContent = chatItem.content.msgContent;
					if (
						msgContent &&
						(msgContent.type === "image" ||
							msgContent.type === "video" ||
							msgContent.type === "file")
					) {
						// Delegate file-attached messages to FileReceiver
						await fileReceiver.handleNewChatItem(chatItem, contactId);
						continue;
					}
				}

				// Extract text content
				const text = extractTextFromContent(chatItem.content);
				if (!text) continue;

				await handleIncomingMessage(
					contactId,
					text,
					sessions,
					sender,
					commandHandler,
					formatter,
					throttler,
					config,
				);
			}
			break;
		}

		// File transfer events
		case "rcvFileStart": {
			const fileId = aChatItemFileId(event.chatItem);
			if (fileId !== null) {
				fileReceiver.handleRcvFileStart(fileId);
			}
			break;
		}

		case "rcvFileComplete": {
			await fileReceiver.handleRcvFileComplete(event.chatItem);
			break;
		}

		case "rcvFileSndCancelled": {
			await fileReceiver.handleRcvFileCancelled(event.chatItem);
			break;
		}
	}
}

/**
 * Helper to create a session during event handling.
 */
async function createAndWireSessionForHandler(
	contactId: number,
	sessions: SessionManager,
	sender: MessageSender,
	formatter: EventFormatter,
	throttler: LiveMessageThrottler,
	config: KawaConfig,
): Promise<ContactContext | undefined> {
	const ctx = await createSessionForContact(contactId, sessions, sender, config);
	if (!ctx) return undefined;
	wireSessionEvents(ctx, sender, formatter, throttler);
	return ctx;
}

/**
 * Handle an incoming text message from a SimpleX contact.
 */
async function handleIncomingMessage(
	contactId: number,
	text: string,
	sessions: SessionManager,
	sender: MessageSender,
	commandHandler: CommandHandler,
	formatter: EventFormatter,
	throttler: LiveMessageThrottler,
	config: KawaConfig,
	images?: ImageContent[],
	filePath?: string,
): Promise<void> {
	// Task 8.5: Check for slash commands first
	const isCommand = await commandHandler.handle(contactId, text);
	if (isCommand) return;

	// Get or create session for contact
	let ctx = sessions.getByContactId(contactId);

	// Task 5.5: Auto-create session for unknown contacts
	if (!ctx) {
		// Note: createAndWireSessionForHandler needs config from the caller scope
		// This is passed via closure from main()
		ctx = await createAndWireSessionForHandler(
			contactId,
			sessions,
			sender,
			formatter,
			throttler,
			config,
		);
		if (!ctx) {
			await sender.sendTextMessage(contactId, "❌ Kawa is at capacity. Try again later.");
			return;
		}
	}

	// Append file path reference for generic files
	let promptText = text;
	if (filePath) {
		const suffix = `📎 Attached: ${filePath}`;
		promptText = text ? `${text}\n${suffix}` : suffix;
	}

	// Increment generation to invalidate any in-flight agent events from prior prompts.
	// Only increment for new prompts — followUp does NOT reset the context,
	// it queues a message on the current stream, so in-flight events remain valid.
	try {
		if (ctx.session.state.isStreaming) {
			await ctx.session.followUp(promptText, images);
		} else {
			ctx.generation++;
			ctx.liveMessageState = "IDLE";
			ctx.accumulatedText = "";
			ctx.liveMessageItemId = null;
			ctx.lastSentText = "";
			throttler.cancel(ctx);
			if (images && images.length > 0) {
				await ctx.session.prompt(promptText, { images });
			} else {
				await ctx.session.prompt(promptText);
			}
		}
	} catch (err) {
		console.error(`[kawa] Error prompting session for contact ${contactId}:`, err);
		// Finalize any in-flight live message
		const currentState: string = ctx.liveMessageState;
		if (currentState === "STREAMING") {
			await sender.finalizeLiveMessage(ctx);
		}
		await sender.sendTextMessage(contactId, `❌ LLM Error: ${err}`);
	}
}

// Run the main function
main().catch((err) => {
	console.error("[kawa] Fatal error:", err);
	process.exit(1);
});
