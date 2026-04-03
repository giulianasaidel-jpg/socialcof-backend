import archiver from 'archiver';
import puppeteer from 'puppeteer';
import type { Response } from 'express';

const SLIDE_SIZE = 560;

/**
 * Launches a single browser, renders each HTML to a PNG sequentially, then closes the browser.
 */
async function renderSlides(htmls: string[]): Promise<Buffer[]> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const results: Buffer[] = [];

    for (const html of htmls) {
      const page = await browser.newPage();
      await page.setViewport({ width: SLIDE_SIZE, height: SLIDE_SIZE, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const screenshot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: SLIDE_SIZE, height: SLIDE_SIZE },
      });
      await page.close();
      results.push(Buffer.from(screenshot));
    }

    return results;
  } finally {
    await browser.close();
  }
}

/**
 * Renders all slideHtmls to PNGs and streams a ZIP archive directly to the HTTP response.
 */
export async function streamSlidesAsZip(
  slideHtmls: string[],
  filename: string,
  res: Response,
): Promise<void> {
  const pngs = await renderSlides(slideHtmls);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  pngs.forEach((png, i) => {
    archive.append(png, { name: `slide-${i + 1}.png` });
  });

  await archive.finalize();
}

/**
 * Renders a single slideHtml to PNG and streams it to the HTTP response.
 */
export async function streamSlideAsPng(
  html: string,
  filename: string,
  res: Response,
): Promise<void> {
  const [png] = await renderSlides([html]);

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.png"`);
  res.end(png);
}
