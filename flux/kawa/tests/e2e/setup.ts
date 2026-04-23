import { execSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { ChatClient } from "simplex-chat";

const SIMPLEX_BIN = `${homedir()}/.local/bin/simplex-chat`;

export const KAWA_ADDRESS_PORT = 18080;
export const KAWA_SIMPLEX_PORT = 15225;
export const ALICE_SIMPLEX_PORT = 16225;

const KAWA_SIMPLEX_DIR = "/tmp/kawa-e2e-simplex";
const ALICE_SIMPLEX_DIR = "/tmp/alice-e2e-simplex";
const ALICE_WRAPPER = "/tmp/alice-e2e-simplex-chat";

// Globals used across the test suite
export let aliceClient: ChatClient | null = null;
export let kawaContactId: number;

/** History of messages received by Alice from Kawa */
export const aliceHistory: Array<{ contactId: number; text: string; ts: number; itemId?: number }> =
	[];

/** Tracks chatItemUpdated event counts per itemId — proxy for updateLiveMessage command count */
export const updateCounts: Map<number, number> = new Map();
let historyStarted = false;

function cleanup(dir: string) {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {}
	mkdirSync(dir, { recursive: true });
}

/**
 * Check that required CLI tools are available. Fail loudly so AIs can fix the environment.
 */
function checkPrerequisites(): void {
	const missing: string[] = [];

	try {
		execSync(`${SIMPLEX_BIN} --version`, { stdio: "pipe" });
	} catch {
		missing.push(
			`simplex-chat CLI not found at "${SIMPLEX_BIN}". Install it: https://github.com/simplex-chat/simplex-chat or set KAWA_SIMPLEX_BIN.`,
		);
	}

	try {
		execSync("ollama list", { stdio: "pipe" });
	} catch {
		missing.push("Ollama is not running or not in PATH. Start it with: ollama serve");
	}

	if (missing.length > 0) {
		throw new Error(`E2E prerequisites missing:\n${missing.map((m) => `  - ${m}`).join("\n")}`);
	}
}

async function waitForPort(port: number, timeout = 20000) {
	const net = await import("node:net");
	return new Promise<void>((resolve, reject) => {
		const deadline = Date.now() + timeout;
		const tryConnect = () => {
			const s = new net.Socket();
			s.setTimeout(300);
			s.on("connect", () => {
				s.destroy();
				resolve();
			});
			s.on("error", () => {
				s.destroy();
				if (Date.now() > deadline) reject(new Error(`Port ${port} never open`));
				else setTimeout(tryConnect, 300);
			});
			s.connect(port, "localhost");
		};
		tryConnect();
	});
}

async function pollKawaAddress(timeout = 60000): Promise<string> {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`http://localhost:${KAWA_ADDRESS_PORT}/address`);
			if (r.status === 200) return (await r.text()).trim();
		} catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error("Kawa address API never ready");
}

function startHistoryCollector(client: ChatClient) {
	if (historyStarted) return;
	historyStarted = true;
	(async () => {
		for await (const ev of client.msgQ) {
			if (ev.type === "newChatItems") {
				for (const item of ev.chatItems) {
					if (item.chatInfo.type !== "direct") continue;
					const content = item.chatItem.content;
					if (content?.type !== "rcvMsgContent" || !content.msgContent) continue;
					if (content.msgContent.type !== "text" || !content.msgContent.text) continue;
					aliceHistory.push({
						contactId: item.chatInfo.contact.contactId,
						text: content.msgContent.text,
						ts: Date.now(),
						itemId: item.chatItem.meta.itemId,
					});
				}
			} else if (ev.type === "chatItemUpdated") {
				// Live message updates: replace the existing history entry
				// so waitForMessage always sees the latest (finalized) content
				const item = ev.chatItem;
				const chatInfo = item.chatInfo;
				if (chatInfo?.type !== "direct") continue;
				const content = item.chatItem.content;
				if (content?.type !== "rcvMsgContent" || !content.msgContent) continue;
				if (content.msgContent.type !== "text" || !content.msgContent.text) continue;
				const itemId = item.chatItem.meta.itemId;

				// Track update count per message (proxy for updateLiveMessage commands)
				updateCounts.set(itemId, (updateCounts.get(itemId) ?? 0) + 1);

				const idx = aliceHistory.findIndex(
					(m) => m.contactId === chatInfo.contact.contactId && m.itemId === itemId,
				);
				if (idx !== -1) {
					// Update existing entry with finalized content
					aliceHistory[idx].text = content.msgContent.text;
					aliceHistory[idx].ts = Date.now();
				} else {
					// New update for an item we haven't seen yet (e.g. live message
					// created before history collector started, or initial create
					// event was missed)
					aliceHistory.push({
						contactId: chatInfo.contact.contactId,
						text: content.msgContent.text,
						ts: Date.now(),
						itemId,
					});
				}
			}
		}
	})();
}

let kawaProc: ReturnType<typeof spawn> | null = null;
let aliceProc: ReturnType<typeof spawn> | null = null;

export async function setupShared(): Promise<void> {
	// 0. Check prerequisites — loudly fail if missing so AIs can fix them
	checkPrerequisites();

	aliceHistory.length = 0;
	updateCounts.clear();

	// 1. Clean dirs
	cleanup(KAWA_SIMPLEX_DIR);
	cleanup(ALICE_SIMPLEX_DIR);

	// 2. Start Kawa — black box: env vars only, no wrapper script
	// KAWA_LIVE_MSG_UPDATE_INTERVAL_MS controls the throttle interval (default 50ms in e2e).
	// Set to 0 for unthrottled comparison runs.
	const throttleMs = process.env.KAWA_LIVE_MSG_UPDATE_INTERVAL_MS ?? "50";
	console.log(`[e2e] Throttle interval: ${throttleMs}ms`);
	const cwd = new URL("../..", import.meta.url).pathname;
	kawaProc = spawn("node", ["dist/kawa.js"], {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			KAWA_SIMPLEX_PORT: String(KAWA_SIMPLEX_PORT),
			KAWA_ADDRESS_PORT: String(KAWA_ADDRESS_PORT),
			KAWA_SIMPLEX_DATA_DIR: KAWA_SIMPLEX_DIR,
			KAWA_LIVE_MSG_UPDATE_INTERVAL_MS: throttleMs,
		},
	});
	kawaProc.stdout?.on("data", (d: Buffer) => {
		const line = d.toString().trim();
		if (line) console.log("[kawa]", line.slice(0, 200));
	});
	kawaProc.stderr?.on("data", (d: Buffer) => {
		const line = d.toString().trim();
		if (line) console.error("[kawa:err]", line.slice(0, 200));
	});

	// 3. Wait for address API
	console.log("[e2e] Waiting for Kawa...");
	const address = await pollKawaAddress();
	console.log("[e2e] Kawa address:", `${address.slice(0, 40)}...`);

	// 4. Start Alice simplex-chat (test infrastructure, not SUT — wrapper is fine)
	writeFileSync(
		ALICE_WRAPPER,
		`#!/bin/bash\nexec "${SIMPLEX_BIN}" -d "${ALICE_SIMPLEX_DIR}" --create-bot-display-name Alice "$@"\n`,
	);
	chmodSync(ALICE_WRAPPER, 0o755);
	aliceProc = spawn(ALICE_WRAPPER, ["-p", String(ALICE_SIMPLEX_PORT)], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	aliceProc.stdout?.on("data", (d: Buffer) => {
		const line = d.toString().trim();
		if (line) console.log("[alice:sx]", line.slice(0, 200));
	});
	aliceProc.stderr?.on("data", (d: Buffer) => {
		const line = d.toString().trim();
		if (line) console.error("[alice:sx:err]", line.slice(0, 200));
	});

	await waitForPort(ALICE_SIMPLEX_PORT);
	console.log("[e2e] Alice simplex-chat ready");

	// 5. Create Alice ChatClient
	aliceClient = await ChatClient.create(`ws://localhost:${ALICE_SIMPLEX_PORT}`);
	console.log("[e2e] Alice ChatClient ready");
	startHistoryCollector(aliceClient);

	// 6. Connect Alice → Kawa
	console.log("[e2e] Connecting Alice to Kawa...");
	try {
		await aliceClient.apiConnectActiveUser(address);
	} catch (e) {
		console.error("[e2e] Connect failed:", e);
		throw e;
	}

	// 7. Wait for greeting (proves both connection + Kawa response)
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		const greeting = aliceHistory.find(
			(m) => m.text.includes("👋") && m.text.includes("coding agent"),
		);
		if (greeting) {
			kawaContactId = greeting.contactId;
			console.log("[e2e] Got greeting, contactId:", kawaContactId);
			return;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error("Alice never received greeting from Kawa");
}

export async function teardownShared(): Promise<void> {
	console.log("[e2e] Tearing down...");
	if (aliceClient) {
		try {
			await aliceClient.disconnect();
		} catch {}
		aliceClient = null;
	}
	if (aliceProc) {
		aliceProc.kill("SIGTERM");
		aliceProc = null;
	}
	if (kawaProc) {
		kawaProc.kill("SIGTERM");
		kawaProc = null;
	}
	await new Promise((r) => setTimeout(r, 1000));
	// Clean up temp directories
	for (const dir of [KAWA_SIMPLEX_DIR, ALICE_SIMPLEX_DIR, ALICE_WRAPPER]) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
}
