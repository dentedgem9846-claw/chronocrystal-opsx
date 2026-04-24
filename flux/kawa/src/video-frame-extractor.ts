import { execFile } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { KawaConfig } from "./config.js";
import { ffmpegAvailable } from "./kawa.js";

/** Maximum number of frames to extract from a video */
const MAX_FRAMES = 60;

/**
 * Extract key frames from a video file using ffmpeg.
 * Returns an array of file paths to the extracted (resized) frame images.
 *
 * @param videoPath - Path to the video file
 * @param config - KawaConfig for ffmpeg binary path
 * @returns Array of frame image file paths (after resize), or empty array on failure
 */
export async function extractFrames(videoPath: string, config: KawaConfig): Promise<string[]> {
	// Guard: check if ffmpeg is available
	if (!ffmpegAvailable) {
		console.warn("[video-frame-extractor] ffmpeg not available, skipping frame extraction");
		return [];
	}

	// Create output directory for frames
	const videoName = videoPath.replace(/\.[^/.]+$/, "");
	const framesDir = `${videoPath}_frames`;
	mkdirSync(framesDir, { recursive: true });

	const ffmpegBin = config.ffmpegBin;

	return new Promise<string[]>((resolve) => {
		const args = [
			"-i",
			videoPath,
			"-vf",
			"fps=1",
			"-frames:v",
			String(MAX_FRAMES),
			join(framesDir, "%04d.jpg"),
		];

		const child = execFile(ffmpegBin, args, { timeout: 30000 }, (error) => {
			if (error) {
				console.error("[video-frame-extractor] ffmpeg error:", error.message);
				resolve([]);
				return;
			}

			// Collect frame file paths
			try {
				const files = readdirSync(framesDir)
					.filter((f) => f.endsWith(".jpg"))
					.sort()
					.map((f) => join(framesDir, f));

				if (files.length >= MAX_FRAMES) {
					console.warn(
						`[video-frame-extractor] Video produced ${files.length} frames (capped at ${MAX_FRAMES}). Video may be longer than 60 seconds.`,
					);
				}

				console.log(`[video-frame-extractor] Extracted ${files.length} frames from ${videoPath}`);
				resolve(files);
			} catch (err) {
				console.error("[video-frame-extractor] Error reading frames directory:", err);
				resolve([]);
			}
		});

		child.on("error", (err) => {
			console.error("[video-frame-extractor] Failed to spawn ffmpeg:", err);
			resolve([]);
		});
	});
}
