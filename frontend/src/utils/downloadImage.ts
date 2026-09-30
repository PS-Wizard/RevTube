import html2canvas from 'html2canvas';

/**
 * Preload all images in an element to ensure they're cached before capture
 */
async function preloadImages(element: HTMLElement): Promise<void> {
  const images = element.querySelectorAll('img');
  const promises = Array.from(images).map((img) => {
    return new Promise<void>((resolve) => {
      if (img.complete) {
        resolve();
      } else {
        img.onload = () => resolve();
        img.onerror = () => resolve(); // Resolve even on error to not block
      }
    });
  });
  await Promise.all(promises);
}

/**
 * Capture a DOM element and download it as a PNG image
 */
export async function downloadElementAsPNG(
  element: HTMLElement,
  filename: string,
  options?: {
    backgroundColor?: string;
    scale?: number;
  }
): Promise<void> {
  try {
    // Preload all images first
    await preloadImages(element);
    
    // Small delay to ensure rendering is complete
    await new Promise(resolve => setTimeout(resolve, 100));

    const canvas = await html2canvas(element, {
      backgroundColor: options?.backgroundColor ?? '#ffffff',
      scale: options?.scale ?? 2, // 2x for retina quality
      logging: false,
      useCORS: true, // Enable CORS for external images
      allowTaint: false, // Don't allow tainted canvas
      imageTimeout: 15000, // Wait up to 15s for images to load
    });

    // Convert canvas to blob
    canvas.toBlob((blob) => {
      if (!blob) {
        console.error('Failed to create blob from canvas');
        return;
      }

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename.endsWith('.png') ? filename : `${filename}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 'image/png');
  } catch (error) {
    console.error('Failed to download image:', error);
    throw error;
  }
}
