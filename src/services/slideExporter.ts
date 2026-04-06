import archiver from 'archiver';
import puppeteer from 'puppeteer';
import type { Response } from 'express';

const DEFAULT_CSS_W = 1080;
const DEFAULT_CSS_H = 1080;

async function renderSlides(htmls: string[], cssW = DEFAULT_CSS_W, cssH = DEFAULT_CSS_H): Promise<Buffer[]> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const results: Buffer[] = [];

    for (const html of htmls) {
      const page = await browser.newPage();
      await page.setViewport({ width: cssW, height: cssH, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const screenshot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: cssW, height: cssH },
      });
      await page.close();
      results.push(Buffer.from(screenshot));
    }

    return results;
  } finally {
    await browser.close();
  }
}

export async function streamSlidesAsZip(
  slideHtmls: string[],
  filename: string,
  res: Response,
  cssW?: number,
  cssH?: number,
): Promise<void> {
  const pngs = await renderSlides(slideHtmls, cssW, cssH);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  pngs.forEach((png, i) => {
    archive.append(png, { name: `slide-${i + 1}.png` });
  });

  await archive.finalize();
}

export async function streamSlideAsPng(
  html: string,
  filename: string,
  res: Response,
  cssW?: number,
  cssH?: number,
): Promise<void> {
  const [png] = await renderSlides([html], cssW, cssH);

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.png"`);
  res.end(png);
}
