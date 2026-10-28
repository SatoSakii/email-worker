import jsQR from "jsqr";

const MAX_SIDE = 1600;

export async function readQr(file: Blob): Promise<string | null>
{
	let bitmap: ImageBitmap;
	try
	{
		bitmap = await createImageBitmap(file);
	}
	catch
	{
		return null;
	}

	const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;

	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context)
	{
		bitmap.close();
		return null;
	}

	context.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();

	const pixels = context.getImageData(0, 0, width, height);
	return jsQR(pixels.data, width, height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}
