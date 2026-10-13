import { isSafeRasterImageMimeType, MAX_ATTACHMENT_BYTES } from './sanitizeContent';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 1200;
const MAX_IMAGE_PIXELS = 20_000_000;
const JPEG_QUALITY = 0.8;

export async function fileToBase64Image(file: File): Promise<string> {
  if (!isSafeRasterImageMimeType(file.type)) {
    throw new Error('仅支持 PNG、JPEG、GIF、WebP、BMP 或 AVIF 图片；不支持 SVG。');
  }
  if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('图片不能为空，且文件大小不能超过 20MB。');
  }
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  validateImageDimensions(image.naturalWidth, image.naturalHeight);
  if (file.size <= MAX_IMAGE_BYTES && Math.max(image.naturalWidth, image.naturalHeight) <= MAX_IMAGE_WIDTH) return dataUrl;
  return compressImage(image, file.type);
}

export function validateImageDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('图片格式无效或无法解码。');
  }
  if (width * height > MAX_IMAGE_PIXELS) throw new Error('图片不能超过 2000 万像素，请先缩小图片。');
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败。'));
    reader.readAsDataURL(file);
  });
}

function compressImage(image: HTMLImageElement, mimeType: string): string {
  const scale = Math.min(1, MAX_IMAGE_WIDTH / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('浏览器无法处理图片，请缩小后重试。');
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  // WebP preserves transparency; forcing every image to JPEG produced black backgrounds.
  return canvas.toDataURL(mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/webp', JPEG_QUALITY);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败。'));
    image.src = src;
  });
}

export function dataUrlMimeType(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;]+);base64,/);
  return match?.[1] || 'application/octet-stream';
}

export function dataUrlSizeBytes(dataUrl: string): number {
  const [, encoded = ''] = dataUrl.split(',');
  if (!encoded) {
    return 0;
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}
