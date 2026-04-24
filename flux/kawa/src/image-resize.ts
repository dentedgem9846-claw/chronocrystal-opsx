import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ImageContent } from "@mariozechner/pi-ai";
import sharp from "sharp";

/**
 * Detect MIME type from file extension.
 */
function detectMimeType(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	switch (ext) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".gif":
			return "image/gif";
		case ".webp":
			return "image/webp";
		case ".bmp":
			return "image/bmp";
		case ".tiff":
		case ".tif":
			return "image/tiff";
		case ".svg":
			return "image/svg+xml";
		default:
			return "image/jpeg"; // fallback
	}
}

/**
 * Resize an image file to fit within maxDimension on the longest side.
 * Returns the resized image as a Buffer.
 */
export async function resizeImageFile(filePath: string, maxDimension: number): Promise<Buffer> {
	return sharp(filePath)
		.resize(maxDimension, maxDimension, {
			fit: "inside",
			withoutEnlargement: true,
		})
		.jpeg({ quality: 85 })
		.toBuffer();
}

/**
 * Read an image file, resize it, base64-encode it, and return as ImageContent
 * suitable for passing to session.prompt(text, { images }).
 *
 * @param filePath - Path to the image file
 * @param maxDimension - Maximum dimension (in pixels) on the longest side
 * @returns ImageContent with base64 data and MIME type
 */
export async function imageFileToImageContent(
	filePath: string,
	maxDimension: number,
): Promise<ImageContent> {
	const resizedBuffer = await resizeImageFile(filePath, maxDimension);
	const base64 = resizedBuffer.toString("base64");
	return {
		type: "image",
		data: base64,
		mimeType: "image/jpeg", // sharp outputs JPEG
	};
}
