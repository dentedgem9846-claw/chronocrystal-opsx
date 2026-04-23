/**
 * A positive integer (> 0) used for throttle intervals.
 * Prevents misconfiguration like interval=0 which causes
 * race conditions (setTimeout(fn, 0) fires before startLiveMessage
 * sets liveMessageItemId) and command flooding.
 *
 * Use `parsePositiveInt` to safely construct from env vars.
 */
export type PositiveInt = number & { __brand: "PositiveInt" };

/**
 * Parse a value as a PositiveInt, throwing if <= 0 or NaN.
 */
export function parsePositiveInt(value: number, name: string): PositiveInt {
	if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
		throw new Error(
			`${name} must be a positive integer, got: ${value}. A value of 0 or negative would disable throttling and cause command flooding.`,
		);
	}
	return value as PositiveInt;
}

/**
 * Configuration for Kawa.
 */
export interface KawaConfig {
	/** Port for the simplex-chat CLI WebSocket server */
	simplexPort: number;
	/** Path to the simplex-chat CLI binary */
	simplexBin: string;
	/** Display name for the bot profile on SimpleX */
	botDisplayName: string;
	/** Data directory for the simplex-chat CLI (passed as -d flag). If empty, uses simplex-chat default. */
	simplexDataDir: string;
	/** Path to the Kawa agent directory (.pi/) */
	agentDir: string;
	/** Working directory for agent sessions */
	cwd: string;
	/** Maximum concurrent agent sessions */
	maxSessions: number;
	/** Port for the address HTTP API */
	addressApiPort: number;
	/** Tool output truncation line limit */
	toolTruncationLines: number;
	/** Throttle interval for live message updates (ms). Must be > 0. Reduces SimpleX command volume by batching updates. */
	liveMessageUpdateIntervalMs: PositiveInt;
	/** Backoff settings for SimpleX CLI restart */
	restartBackoff: {
		initialMs: number;
		maxMs: number;
		multiplier: number;
	};
}

export const defaultConfig: KawaConfig = {
	simplexPort: 5225,
	simplexBin: "simplex-chat",
	botDisplayName: "Kawa",
	simplexDataDir: "",
	agentDir: "", // Will be set relative to project root
	cwd: "", // Will be set to process.cwd()
	maxSessions: 3,
	addressApiPort: 8080,
	toolTruncationLines: 5,
	liveMessageUpdateIntervalMs: parsePositiveInt(200, "liveMessageUpdateIntervalMs default"),
	restartBackoff: {
		initialMs: 1000,
		maxMs: 30000,
		multiplier: 2,
	},
};
