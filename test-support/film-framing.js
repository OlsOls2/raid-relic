// LOCAL rendered-pixel acceptance only; no app state or renderer mutation.
export async function filmPaintedFraming(page, action) {
  await page.evaluate(() => {
    const art = document.querySelector('#film-art');
    const canvas = art.querySelector('canvas.relic3d');
    const image = art.querySelector('img');
    window.__filmPaintedFraming = new Promise((resolve, reject) => {
      const measure = (pixels, width, height, rect, invertY) => {
        // Ignore faint aura/particles and isolated outlines: require a solid,
        // bright run across each row in the central body region.
        let first = height,
          last = -1,
          left = width,
          right = -1;
        for (let y = 0; y < height; y++) {
          let count = 0,
            rowLeft = width,
            rowRight = -1;
          for (let x = Math.floor(width * 0.2); x < width * 0.8; x++) {
            const i = ((invertY ? height - 1 - y : y) * width + x) * 4;
            if (pixels[i + 3] >= 190 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) >= 100) {
              count++;
              rowLeft = Math.min(rowLeft, x);
              rowRight = x;
            }
          }
          if (count >= Math.max(4, width * 0.025)) {
            first = Math.min(first, y);
            last = y;
            left = Math.min(left, rowLeft);
            right = Math.max(right, rowRight);
          }
        }
        if (last < first) throw Error('Missing painted film body');
        const body = {
          left: rect.left + (left / width) * rect.width,
          right: rect.left + ((right + 1) / width) * rect.width,
          top: rect.top + (first / height) * rect.height,
          bottom: rect.top + ((last + 1) / height) * rect.height,
        };
        const badge = art.querySelector('.growth-fallback').getBoundingClientRect();
        const stage = document.querySelector('#film-stage').getBoundingClientRect();
        return {
          paintedHeight: body.bottom - body.top,
          stageHeight: stage.height,
          badgeHeight: badge.height,
          overlap:
            Math.max(0, Math.min(body.right, badge.right) - Math.max(body.left, badge.left)) *
            Math.max(0, Math.min(body.bottom, badge.bottom) - Math.max(body.top, badge.top)),
          rasterWidth: width,
          rasterHeight: height,
        };
      };
      if (canvas) {
        const timer = setTimeout(() => {
          canvas.removeEventListener('relic3d-frame', sample);
          canvas.removeAttribute('data-pixel-probe');
          reject(Error('No genuine film frame'));
        }, 5000);
        const sample = () => {
          clearTimeout(timer);
          canvas.removeAttribute('data-pixel-probe');
          try {
            if (canvas.width > 480 || canvas.height > 480) throw Error('Film raster bound');
            const pixels = new Uint8Array(canvas.width * canvas.height * 4);
            const gl = canvas.getContext('webgl2');
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            resolve(
              measure(pixels, canvas.width, canvas.height, canvas.getBoundingClientRect(), true),
            );
          } catch (error) {
            reject(error);
          }
        };
        canvas.setAttribute('data-pixel-probe', '');
        canvas.addEventListener('relic3d-frame', sample, { once: true });
      } else {
        (async () => {
          await image.decode();
          const raster = document.createElement('canvas');
          raster.width = 240;
          raster.height = 300;
          try {
            const ctx = raster.getContext('2d');
            ctx.drawImage(image, 0, 0, 240, 300);
            const box = image.getBoundingClientRect();
            const scale = Math.min(box.width / 240, box.height / 300);
            const rect = {
              left: box.left + (box.width - 240 * scale) / 2,
              top: box.top + (box.height - 300 * scale) / 2,
              width: 240 * scale,
              height: 300 * scale,
            };
            resolve(measure(ctx.getImageData(0, 0, 240, 300).data, 240, 300, rect, false));
          } finally {
            raster.width = raster.height = 0;
          }
        })().catch(reject);
      }
    });
  });
  await action?.();
  return page.evaluate(() => window.__filmPaintedFraming);
}
