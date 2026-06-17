const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 1200;
const JPEG_QUALITY = 0.8;

export async function fileToBase64Image(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件。');
  }

  if (file.size <= MAX_IMAGE_BYTES) {
    return readFileAsDataUrl(file);
  }

  return compressImage(file);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败。'));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_IMAGE_WIDTH / image.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);

  const context = canvas.getContext('2d');
  if (!context) {
    return dataUrl;
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
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
