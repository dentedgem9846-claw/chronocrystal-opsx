import { type ChildProcess, spawn } from "node:child_process";
import { Socket } from "node:net";
import type { KawaConfig } from "./config.js";

/**
 * Manages the simplex-chat CLI process lifecycle.
 * Spawns, monitors, and restarts it on failure.
 */
export class SimpleXProcess {
	private process: ChildProcess | null = null;
	private restarting = false;
	private currentBackoffMs: number;
	private shutdown = false;

	constructor(
		private config: KawaConfig,
		private onReady: () => void,
		private onError: (error: Error) => void,
	) {
		this.currentBackoffMs = config.restartBackoff.initialMs;
	}

	/**
	 * Start the simplex-chat CLI process.
	 */
	start(): void {
		this.shutdown = false;
		this.spawnProcess();
	}

	/**
	 * Stop the simplex-chat CLI process gracefully.
	 */
	stop(): void {
		this.shutdown = true;
		if (this.process && !this.process.killed) {
			this.process.kill("SIGTERM");
		}
	}

	/**
	 * Check if the simplex-chat process is running.
	 */
	get isRunning(): boolean {
		return this.process !== null && !this.process.killed;
	}

	/**
	 * Wait for the WebSocket port to become available by polling.
	 */
	private waitForPort(port: number, maxAttempts = 20, intervalMs = 500): Promise<void> {
		return new Promise((resolve, reject) => {
			let attempts = 0;
			const tryConnect = () => {
				attempts++;
				const socket = new Socket();
				socket.setTimeout(intervalMs);
				socket.on("connect", () => {
					socket.destroy();
					resolve();
				});
				socket.on("error", () => {
					socket.destroy();
					if (attempts >= maxAttempts) {
						reject(
							new Error(
								`SimpleX CLI WebSocket port ${port} not available after ${maxAttempts} attempts`,
							),
						);
					} else {
						setTimeout(tryConnect, intervalMs);
					}
				});
				socket.on("timeout", () => {
					socket.destroy();
					if (attempts >= maxAttempts) {
						reject(
							new Error(
								`SimpleX CLI WebSocket port ${port} not available after ${maxAttempts} attempts`,
							),
						);
					} else {
						setTimeout(tryConnect, intervalMs);
					}
				});
				socket.connect(port, "localhost");
			};
			tryConnect();
		});
	}

	private spawnProcess(): void {
		if (this.shutdown) return;

		console.log(`[simplex] Spawning simplex-chat -p ${this.config.simplexPort}`);
		const args = [
			"-p",
			String(this.config.simplexPort),
			"--create-bot-display-name",
			this.config.botDisplayName,
		];
		if (this.config.simplexDataDir) {
			args.push("-d", this.config.simplexDataDir);
		}
		this.process = spawn(this.config.simplexBin, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.process.stdout?.on("data", (data: Buffer) => {
			const line = data.toString().trim();
			if (line) {
				console.log(`[simplex:out] ${line}`);
			}
		});

		this.process.stderr?.on("data", (data: Buffer) => {
			const line = data.toString().trim();
			if (line) {
				console.log(`[simplex:err] ${line}`);
			}
		});

		this.process.on("error", (err: Error) => {
			console.error(`[simplex] Process error: ${err.message}`);
			this.onError(err);
			this.scheduleRestart();
		});

		this.process.on("exit", (code, signal) => {
			console.error(`[simplex] Process exited with code=${code} signal=${signal}`);
			this.process = null;
			if (!this.shutdown) {
				this.scheduleRestart();
			}
		});

		// Wait for the WebSocket port to become available before signaling ready
		this.waitForPort(this.config.simplexPort)
			.then(() => {
				if (!this.shutdown) {
					console.log("[simplex] WebSocket port is ready");
					this.onReady();
				}
			})
			.catch((err: Error) => {
				console.error(`[simplex] Port check failed: ${err.message}`);
				this.onError(err);
			});
	}

	private scheduleRestart(): void {
		if (this.shutdown || this.restarting) return;
		this.restarting = true;

		const delay = this.currentBackoffMs;
		console.log(`[simplex] Restarting in ${delay}ms (backoff)`);

		setTimeout(() => {
			this.restarting = false;
			this.currentBackoffMs = Math.min(
				this.currentBackoffMs * this.config.restartBackoff.multiplier,
				this.config.restartBackoff.maxMs,
			);
			this.spawnProcess();
		}, delay);
	}

	/**
	 * Reset backoff after a successful connection.
	 */
	resetBackoff(): void {
		this.currentBackoffMs = this.config.restartBackoff.initialMs;
	}
}
