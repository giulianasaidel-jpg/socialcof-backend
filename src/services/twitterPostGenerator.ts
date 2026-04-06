import OpenAI from 'openai';
import https from 'https';
import http from 'http';
import { env } from '../config/env';
import type { DisplayMode } from '../models/TwitterLikePost';
import type { ImagePostBandStyle, ImagePostOverlayFont, ImageStyle } from '../models/ImagePost';

function getClient(): OpenAI {
  if (!env.GPT_KEY) throw new Error('GPT_KEY is not configured');
  return new OpenAI({ apiKey: env.GPT_KEY });
}

function normalizeSourceKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, '');
}

const MEDCOF_NEWS_SOURCE_COMPETITOR_KEYS = [
  'medway',
  'medgrupo',
  'hardworkmedicina',
  'hardwork',
  'estrategiamed',
  'sanarmed',
  'jaleko',
];

export function isMedCofCompetitorNewsSource(source: string): boolean {
  const key = normalizeSourceKey(source.trim());
  if (!key) return false;
  return MEDCOF_NEWS_SOURCE_COMPETITOR_KEYS.some((c) => key.includes(c));
}

export interface TwitterSlideInput {
  texts: string[];
  mode: DisplayMode;
  bodyFontSize?: number;
  profileName?: string;
  profileHandle?: string;
  profileImageUrl?: string;
  brandingProfilePicUrl?: string;
}

export interface GeneratedSlides {
  slides: string[];
  caption: string;
}

export type EnrichSocialSourceResult = {
  transcript: string;
  caption: string;
  enriched: boolean;
};

function combinedSourceLength(transcript: string, caption: string): { chars: number; words: number; combined: string } {
  const combined = [caption.trim(), transcript.trim()].filter(Boolean).join('\n\n');
  const words = combined.split(/\s+/).filter((w) => w.length > 0).length;
  return { chars: combined.length, words, combined };
}

function sourceNeedsModelEnrichment(chars: number, words: number): boolean {
  if (chars < 320 || words < 45) return true;
  if (chars < 750 && words < 85) return true;
  return false;
}

export async function enrichSocialSourceIfThin(input: {
  transcript?: string;
  caption?: string;
}): Promise<EnrichSocialSourceResult> {
  const caption = (input.caption ?? '').trim();
  const transcript = (input.transcript ?? '').trim();
  const { chars, words, combined } = combinedSourceLength(transcript, caption);

  if (!combined || !env.GPT_KEY || !sourceNeedsModelEnrichment(chars, words)) {
    return { transcript, caption, enriched: false };
  }

  const system = `Você é editor médico sênior apoiando redação de conteúdo educativo para médicos residentes e estudantes de medicina no Brasil.

A fonte abaixo é CURTA ou INSUFICIENTE para gerar posts assertivos. Sua tarefa: produzir um BRIEFING de apoio em português que o próximo passo (outro modelo) usará para escrever slides ou stories.

REGRAS:
- Use seu conhecimento médico geral, consenso de diretrizes amplamente aceitas e prática clínica típica; não invente nomes de estudos, revistas, autores, números de pacientes ou dados que não decorram de consenso razoável.
- Se o tema for ambíguo, apresente 2–3 leituras possíveis em uma linha cada e desenvolva a mais provável.
- Estruture com: (1) tema em uma frase (2) pontos-chave clínicos (3) armadilhas ou alertas (4) o que residente costuma confundir — quando aplicável.
- Limite: até ~900 palavras, texto corrido ou tópicos curtos.
- Não escreva legenda de rede social nem hashtags; só contexto clínico-educativo.
- Não cite concorrentes de cursinho (Medway, MedGrupo, etc.).`;

  try {
    const client = getClient();
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.35,
      max_tokens: 1400,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Título ou contexto:\n"${caption.slice(0, 800)}"\n\nTexto-fonte:\n"${transcript.slice(0, 3500)}"`,
        },
      ],
    });
    const briefing = res.choices[0]?.message?.content?.trim() ?? '';
    if (!briefing) return { transcript, caption, enriched: false };

    const mergedTranscript = transcript
      ? `${transcript}\n\n--- Contexto ampliado (IA; priorize o texto original em caso de divergência) ---\n\n${briefing}`
      : briefing;

    return { transcript: mergedTranscript, caption, enriched: true };
  } catch {
    return { transcript, caption, enriched: false };
  }
}

/**
 * Calls GPT to generate tweet-style slide texts (no hashtags) and a separate
 * Instagram caption with hashtags, tailored for the medical residency persona.
 */
export async function generateSlidesFromSource(input: {
  transcript?: string;
  caption?: string;
  imageUrls?: string[];
  slideCount?: number;
  tone?: string;
  newsAttribution?: { sourceLabel: string; mentionInCopy: boolean };
}): Promise<GeneratedSlides> {
  const client = getClient();
  const slideCount = input.slideCount ?? 5;

  const attributionBlock = (() => {
    const a = input.newsAttribution;
    if (!a?.sourceLabel.trim()) return '';
    if (a.mentionInCopy) {
      return `

ATRIBUIÇÃO (notícia):
- Nos slides e na legenda, cite de forma natural a fonte da notícia pelo menos uma vez (ex.: "Fonte: ${a.sourceLabel}", "segundo ${a.sourceLabel}", "dados de ${a.sourceLabel}").
- Não precisa repetir em todos os slides; basta ficar claro de onde veio a informação.`;
    }
    return `

ATRIBUIÇÃO (notícia):
- A matéria origina-se de veículo concorrente direto da MedCOF: não cite nome da fonte, marca ou site nos slides nem na legenda; transmita só o conteúdo factual.`;
  })();

  const firstLastRules =
    slideCount <= 1
      ? `- Slide único: abra com **headline-gancho** forte no começo; no mesmo texto, traga o núcleo útil e feche com **CTA** curto pedindo comentário ou opinião`
      : `- **Primeiro slide:** abra com **headline-gancho** — curta, que prenda atenção (pergunta incisiva, dado surpreendente, contraste, tensão clínica). Quando fizer sentido, pode ser levemente **provocativo** (inteligente, nunca sensacionalista nem antiético). Evite aberturas genéricas, óbvias ou "blazé"
- **Último slide:** encerre com **CTA** variado pedindo comentário ou opinião (ex.: concordância, o que fariam no caso, experiência pessoal, debate civil). Tom profissional; não soar vazio`;

  const system = `Você é um especialista em conteúdo para médicos residentes e estudantes de medicina brasileiros.
Sua missão é transformar um conteúdo bruto em um carrossel estilo Twitter/X de alto valor educativo.
Quando o transcript ou resumo de notícia estiver disponível, essa é a fonte principal — use-a como base. A legenda/título complementar é apenas apoio.

ENRIQUECIMENTO DE CONTEÚDO:
- Não se limite ao que está na fonte: use seu conhecimento médico para acrescentar contexto clínico relevante
- Adicione dados concretos, estatísticas, referências a guidelines (SBP, SBEM, AHA, ESC, UpToDate, etc.) ou evidências que complementem e fortaleçam o conteúdo
- Inclua pearls clínicos, armadilhas diagnósticas ou nuances práticas que o texto-fonte não aborda mas que são pertinentes ao tema
- O objetivo é que o post entregue mais valor do que apenas rephrasar o que foi enviado — que quem leia aprenda algo além do óbvio

REGRAS DOS SLIDES:
- Gere exatamente ${slideCount} slides
- Cada slide deve ser autônomo, informativo e diretamente útil para quem estuda para residência médica
- Inclua dados concretos, estatísticas, protocolos, dicas práticas ou insights clínicos sempre que possível
- Linguagem direta, sem enrolação — como uma dica de colega sênior para calouro
- Máximo de 260 caracteres por slide
- PROIBIDO usar hashtags nos slides
- Emojis: use só quando fizer sentido (clareza, alerta, tom); evite enfeite vazio — no máximo 2 por slide quando couber naturalmente
- Negrito: pode destacar termos-chave com **assim** (markdown só com ** para negrito, sem _itálico_ nem links)
${firstLastRules}
- Opcional no primeiro slide: uma linha estilo thread ("Segue o fio", "Thread rápida") só se combinar bem com o gancho — não é obrigatório
- Cada slide deve entregar valor real — sem frases genéricas como "é muito importante saber disso"
- PROIBIDO mencionar concorrentes da MedCOF: Medway, MedGrupo, Hardwork Medicina ou qualquer outra empresa de preparação para residência médica
${attributionBlock}

LEGENDA DO POST (campo "caption"):
- Texto para publicar no Instagram acompanhando o carrossel
- 3 a 5 linhas, tom envolvente, começa com gancho forte
- Inclua 8 a 12 hashtags relevantes para medicina, residência médica e a especialidade do conteúdo
- Separe as hashtags em um bloco ao final da legenda

Retorne APENAS JSON válido (cada string em "slides" pode incluir **negrito** e emojis conforme as regras):
{
  "slides": ["texto slide 1", "texto slide 2", ...],
  "caption": "legenda completa com hashtags ao final"
}`;

  const textParts = [
    input.transcript ? `FONTE PRINCIPAL — Transcript ou resumo:\n"${input.transcript.slice(0, 2500)}"` : '',
    input.caption ? `Informação complementar — Legenda ou título:\n"${input.caption.slice(0, 600)}"` : '',
    `Tom: ${input.tone ?? 'educativo, direto e confiante'}`,
  ].filter(Boolean);

  const images = (input.imageUrls ?? []).filter(Boolean).slice(0, 6);

  const userContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'low' } }> = [
    { type: 'text' as const, text: textParts.join('\n\n') },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url, detail: 'low' as const } })),
  ];

  if (images.length) {
    userContent.push({
      type: 'text' as const,
      text: 'MÍDIA FONTE — Analise as imagens acima em busca de textos visíveis, gráficos, dados, diagramas ou elementos visuais relevantes. Use qualquer informação útil para enriquecer os slides.',
    });
  }

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.75,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  });

  const raw = JSON.parse(response.choices[0].message.content ?? '{}') as {
    slides?: string[];
    caption?: string;
  };

  return {
    slides: raw.slides ?? [],
    caption: raw.caption ?? '',
  };
}

const COLORS = {
  dark: {
    bg: '#000000',
    card: '#15202B',
    border: '#2F3336',
    text: '#E7E9EA',
    subtext: '#71767B',
    link: '#1D9BF0',
    icon: '#71767B',
    verified: '#1D9BF0',
  },
  light: {
    bg: '#F7F9F9',
    card: '#FFFFFF',
    border: '#EFF3F4',
    text: '#0F1419',
    subtext: '#536471',
    link: '#1D9BF0',
    icon: '#536471',
    verified: '#1D9BF0',
  },
};

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slideLineToHtml(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  const escaped = escapeHtml(trimmed);
  return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function mockEngagement() {
  const replies = randomInt(12, 980);
  const reposts = randomInt(50, 4200);
  const likes = randomInt(reposts, reposts * 8);
  const views = randomInt(likes * 3, likes * 20);
  return { replies, reposts, likes, views };
}

/**
 * Fetches a remote image URL and returns a base64 data URI.
 * Falls back to empty string if fetch fails (avatar will be replaced by initial).
 */
async function toBase64DataUri(url: string): Promise<string> {
  return new Promise((resolve) => {
    if (!url) return resolve('');
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) return resolve('');
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const mime = res.headers['content-type'] ?? 'image/jpeg';
        resolve(`data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`);
      });
      res.on('error', () => resolve(''));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(8000, () => { req.destroy(); resolve(''); });
  });
}

/**
 * Builds a self-contained HTML card for a single tweet-style slide.
 * Sized as a 1:1 Instagram square (1080×1080 logical units, rendered at 560px).
 */
function buildSlideHtml(
  text: string,
  mode: DisplayMode,
  profileName: string,
  profileHandle: string,
  profileImageUrl: string,
  slideIndex: number,
  total: number,
  bodyFontSize: number = 20,
): string {
  const c = COLORS[mode];

  const avatar = profileImageUrl
    ? `<img src="${profileImageUrl}" alt="avatar" style="width:52px;height:52px;border-radius:50%;object-fit:cover;flex-shrink:0;" crossorigin="anonymous"/>`
    : `<div style="width:52px;height:52px;border-radius:50%;background:${c.link};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;flex-shrink:0;">${(profileName || 'U')[0].toUpperCase()}</div>`;

  const handle = profileHandle ? `@${profileHandle.replace(/^@/, '')}` : '';
  const name = profileName || 'Perfil';

  const paragraphs = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `<p style="margin:0 0 14px 0;line-height:1.6;">${slideLineToHtml(l)}</p>`)
    .join('');

  const counter = total > 1
    ? `<div style="position:absolute;top:20px;right:24px;font-size:13px;color:${c.subtext};">${slideIndex + 1} / ${total}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=560,initial-scale=1.0"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{
    width:560px;height:560px;overflow:hidden;
    background:${c.card};
  }
  body{
    display:flex;
    align-items:center;
    justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  }
  .card{
    position:relative;
    background:${c.card};
    padding:28px 28px 22px;
    width:560px;
    height:560px;
    display:flex;
    flex-direction:column;
  }
  .header{display:flex;align-items:center;gap:14px;margin-bottom:16px;overflow:hidden;}
  .profile-info{flex:1;min-width:0;overflow:hidden;}
  .name{
    font-weight:700;
    font-size:16px;
    color:${c.text};
    display:flex;
    align-items:center;
    gap:5px;
    min-width:0;
  }
  .name-text{
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
    min-width:0;
  }
  .verified{
    width:18px;height:18px;border-radius:50%;
    background:${c.verified};
    color:#fff;
    font-size:11px;
    display:inline-flex;align-items:center;justify-content:center;
    flex-shrink:0;
  }
  .handle{font-size:14px;color:${c.subtext};margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .body{
    flex:1;
    font-size:${bodyFontSize}px;
    color:${c.text};
    line-height:1.6;
    overflow:hidden;
  }
  .body strong{font-weight:700;}
  .divider{border:none;border-top:1px solid ${c.border};margin:14px 0;}
</style>
</head>
<body>
<div class="card">
  ${counter}
  <div class="header">
    ${avatar}
    <div class="profile-info">
      <div class="name"><span class="name-text">${name}</span><span class="verified">✓</span></div>
      <div class="handle">${handle}</div>
    </div>
  </div>

  <div class="body">${paragraphs}</div>

  <hr class="divider"/>
</div>
</body>
</html>`;
}

/**
 * Generates all slide HTMLs for a twitter-like carousel post.
 */
/**
 * Generates all slide HTMLs for a twitter-like carousel post.
 * Fetches the avatar and embeds it as base64 so the HTML is fully self-contained
 * and can be exported as an image without CORS issues.
 */
export async function buildCarouselHtmls(input: TwitterSlideInput): Promise<string[]> {
  const {
    texts,
    mode,
    bodyFontSize = 20,
    profileName = '',
    profileHandle = '',
    profileImageUrl = '',
    brandingProfilePicUrl = '',
  } = input;

  const rawAvatarUrl = profileImageUrl || brandingProfilePicUrl;
  const avatarDataUri = await toBase64DataUri(rawAvatarUrl);

  return texts.map((text, i) =>
    buildSlideHtml(text, mode, profileName, profileHandle, avatarDataUri, i, texts.length, bodyFontSize),
  );
}

export interface GeneratedStoryReply {
  question: string;
  answer: string;
  caption: string;
}

export async function generateStoryReply(input: {
  transcript?: string;
  caption?: string;
  imageUrls?: string[];
  tone?: string;
}): Promise<GeneratedStoryReply> {
  const client = getClient();

  const system = `Você cria conteúdo lo-fi para médicos residentes e estudantes de medicina no Instagram Stories.
Estilo: casual, direto, como se um colega de residência tivesse respondendo no celular mesmo.

PERGUNTA:
- Escreva como um seguidor digitando rápido — sem formalidade, sem ponto final obrigatório
- Dúvida clínica real, curta, derivada do conteúdo. Máximo 100 caracteres
- Ex: "qual dose de ataque da amio na PCR mesmo?"

RESPOSTA:
- Escreva como quem responde no Stories, sem enrolação
- Frases curtas. Máximo 320 caracteres
- Marque 2 a 4 termos clínicos-chave com ~til~ (ex: ~150mg IV~, ~10 minutos~) — esses ficam em laranja na tela
- SEM asteriscos, SEM negrito, SEM markdown de formatação
- Um emoji no máximo, só se ficar natural. Não tenha tom infantil ou infantilizante.
- Escolha ser mais técnico e sóbrio
- PROIBIDO mencionar: Medway, MedGrupo, Hardwork, Estratégia MED, Sanar, Jaleko

LEGENDA:
- 2 linhas convidando a mandar mais dúvidas, tom de conversa
- 5 a 7 hashtags ao final

Retorne APENAS JSON válido:
{
  "question": "texto da pergunta",
  "answer": "texto da resposta com ~termos~ marcados",
  "caption": "legenda completa com hashtags"
}`;

  const textParts = [
    input.transcript ? `FONTE — Transcript ou resumo:\n"${input.transcript.slice(0, 2500)}"` : '',
    input.caption ? `Contexto — Legenda ou título:\n"${input.caption.slice(0, 600)}"` : '',
    `Tom: ${input.tone ?? 'didático e acessível'}`,
  ].filter(Boolean);

  const images = (input.imageUrls ?? []).filter(Boolean).slice(0, 4);

  const userContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'low' } }> = [
    { type: 'text' as const, text: textParts.join('\n\n') },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url, detail: 'low' as const } })),
  ];

  if (images.length) {
    userContent.push({ type: 'text' as const, text: 'Analise as imagens acima em busca de dados clínicos, textos ou diagramas para formular a dúvida e resposta.' });
  }

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  });

  const raw = JSON.parse(response.choices[0].message.content ?? '{}') as {
    question?: string;
    answer?: string;
    caption?: string;
  };

  return {
    question: raw.question ?? '',
    answer: raw.answer ?? '',
    caption: raw.caption ?? '',
  };
}

import type { StoryFont } from '../models/StoryReply';

const FONT_MAP: Record<StoryFont, { query: string; family: string }> = {
  classic:    { query: 'Inter:wght@400;500',                  family: "'Inter', sans-serif" },
  modern:     { query: 'Playfair+Display:wght@400',           family: "'Playfair Display', serif" },
  strong:     { query: 'Oswald:wght@600;700',                 family: "'Oswald', sans-serif" },
  typewriter: { query: 'Courier+Prime',                       family: "'Courier Prime', monospace" },
  editor:     { query: 'DM+Serif+Display',                    family: "'DM Serif Display', serif" },
  poster:     { query: 'Anton',                               family: "'Anton', sans-serif" },
  literature: { query: 'Lora:ital,wght@0,400;0,500',          family: "'Lora', serif" },
};

const INTER_TAG = `<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap" rel="stylesheet"/>`;

function fontTag(font: StoryFont): string {
  if (font === 'classic') return INTER_TAG;
  const f = FONT_MAP[font];
  return `${INTER_TAG}<link href="https://fonts.googleapis.com/css2?family=${f.query}&display=swap" rel="stylesheet"/>`;
}

function highlightTilde(text: string, color: string): string {
  return escapeHtml(text).replace(/~([^~]+)~/g, `<span style="color:${color};">$1</span>`);
}

function buildCaixinhaSticker(question: string, compact = false, stickerFontSize?: number): string {
  const defaultSize = compact ? 36 : 42;
  const bodySize = stickerFontSize ?? defaultSize;
  const bodyPad = compact ? '22px 28px' : '28px 32px';
  return `<div class="sticker${compact ? ' compact' : ''}">
  <div class="sticker-header">pergunte aqui</div>
  <div class="sticker-body" style="padding:${bodyPad};font-size:${bodySize}px;">${escapeHtml(question)}</div>
</div>`;
}

const STICKER_CSS = `
.sticker{width:fit-content;min-width:380px;max-width:700px;border-radius:18px;overflow:hidden;font-family:'Inter',sans-serif;display:flex;flex-direction:column;}
.sticker-header{background:#1c1c1e;padding:16px 26px;font-size:23px;color:#8e8e93;text-align:center;font-weight:400;letter-spacing:0.3px;flex-shrink:0;}
.sticker-body{background:#fff;font-weight:400;color:#000;line-height:1.4;flex:1;display:flex;align-items:flex-start;}`;

function buildStoryBgLayers(backgroundUrl?: string, overlayColor?: string): string {
  if (!backgroundUrl) return '';
  const ov = overlayColor || 'rgba(0,0,0,0.65)';
  return `<div style="position:absolute;inset:0;background:url('${backgroundUrl}') center/cover no-repeat;z-index:0;"></div><div style="position:absolute;inset:0;background:${ov};z-index:1;"></div>`;
}

export type StoryDragLayoutPct = {
  stickerCenterX: number;
  stickerCenterY: number;
  answerCenterX: number;
  answerCenterY: number;
};

function storyStickerWrapStyle(x: number, y: number): string {
  return `position:absolute;left:${x}%;top:${y}%;transform:translate(-50%,-50%);z-index:3;max-width:92%;width:max-content;`;
}

export function buildStoryQuestionHtml(
  question: string,
  _mode: DisplayMode,
  _profileName: string,
  _brandColors: string[],
  _font: StoryFont = 'classic',
  _textColor = '#ffffff',
  _highlightColor = '#FF6B2B',
  stickerFontSize?: number,
  bgOptions?: { backgroundUrl?: string; overlayColor?: string },
  layout?: Partial<Pick<StoryDragLayoutPct, 'stickerCenterX' | 'stickerCenterY'>>,
): string {
  const sx = layout?.stickerCenterX ?? 50;
  const sy = layout?.stickerCenterY ?? 18;
  const hasBg = Boolean(bgOptions?.backgroundUrl);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=1080,initial-scale=1.0"/>
${INTER_TAG}
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:1080px;height:1920px;overflow:hidden;background:#000;position:relative;}
.content{position:absolute;inset:0;z-index:2;pointer-events:none;}
${STICKER_CSS}
</style></head>
<body>
${hasBg ? buildStoryBgLayers(bgOptions!.backgroundUrl, bgOptions!.overlayColor) : ''}
<div class="content">
<div style="${storyStickerWrapStyle(sx, sy)}">${buildCaixinhaSticker(question, false, stickerFontSize)}</div>
</div>
</body></html>`;
}

export function buildStoryAnswerHtml(
  question: string,
  answer: string,
  _mode: DisplayMode,
  _profileName: string,
  _brandColors: string[],
  font: StoryFont = 'classic',
  textColor = '#ffffff',
  highlightColor = '#FF6B2B',
  stickerFontSize?: number,
  answerFontSize?: number,
  bgOptions?: { backgroundUrl?: string; overlayColor?: string },
  answerLineHeight?: number,
  answerFillPadding?: number,
  layout?: Partial<StoryDragLayoutPct>,
): string {
  const ff = FONT_MAP[font].family;
  const resolvedAnswerSize = answerFontSize ?? 44;
  const resolvedLineHeight = answerLineHeight ?? 1.46;
  const resolvedFillPadding = answerFillPadding ?? 0;
  const sx = layout?.stickerCenterX ?? 50;
  const sy = layout?.stickerCenterY ?? 18;
  const ax = layout?.answerCenterX ?? 50;
  const ay = layout?.answerCenterY ?? 52;
  const hasBg = Boolean(bgOptions?.backgroundUrl);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=1080,initial-scale=1.0"/>
${fontTag(font)}
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:1080px;height:1920px;overflow:hidden;background:#000;position:relative;}
.content{position:absolute;inset:0;z-index:2;pointer-events:none;}
${STICKER_CSS}
.answer-wrap{max-width:920px;width:max-content;}
.answer{font-family:${ff};font-size:${resolvedAnswerSize}px;font-weight:400;line-height:${resolvedLineHeight};width:100%;text-align:left;}
.answer-text{
  color:${textColor};
  background:rgba(28,28,30,0.82);
  -webkit-box-decoration-break:clone;
  box-decoration-break:clone;
  padding:${resolvedFillPadding}px 18px;
  border-radius:7px;
  display:inline;
}
.answer-text span{color:${highlightColor};}
</style></head>
<body>
${hasBg ? buildStoryBgLayers(bgOptions!.backgroundUrl, bgOptions!.overlayColor) : ''}
<div class="content">
<div style="${storyStickerWrapStyle(sx, sy)}">${buildCaixinhaSticker(question, true, stickerFontSize)}</div>
<div class="answer-wrap" style="position:absolute;left:${ax}%;top:${ay}%;transform:translate(-50%,-50%);z-index:4;max-width:92%;">
<div class="answer"><span class="answer-text">${escapeHtml(answer).replace(/~([^~]+)~/g, `<span>$1</span>`)}</span></div>
</div>
</div>
</body></html>`;
}

export interface GeneratedImageSlide {
  text: string;
  caption: string;
}

export async function generateImagePostContent(input: {
  transcript?: string;
  caption?: string;
  imageUrls?: string[];
  slideCount?: number;
  tone?: string;
}): Promise<{ slides: string[]; caption: string }> {
  const client = getClient();
  const slideCount = input.slideCount ?? 1;

  const system = `Você é um especialista em conteúdo visual para médicos residentes e estudantes de medicina brasileiros.
Sua missão: gerar textos curtos e impactantes para sobreposição em imagens de fundo — posts estáticos ou carrossel do Instagram.

ENRIQUECIMENTO DE CONTEÚDO:
- Use o conteúdo-fonte como ponto de partida, mas enriqueça com seu conhecimento médico
- Adicione dados concretos, estatísticas, referências a guidelines ou evidências que fortaleçam o tema — mesmo que não estejam na fonte fornecida
- Prefira um pearl clínico, dado surpreendente ou nuance prática que quem leia não esperaria — entregue mais do que apenas rephrasar o texto recebido

REGRAS DOS TEXTOS:
- Gere exatamente ${slideCount} texto(s)
- Cada texto será exibido SOBRE uma imagem de fundo, então deve ser curto e legível
- Máximo 200 caracteres por texto
- Use **negrito** para termos-chave
- Headline forte, dado concreto ou insight clínico — sem enrolação
- PROIBIDO mencionar concorrentes: Medway, MedGrupo, Hardwork, Estratégia MED, Sanar, Jaleko
- Tom: confiante, educativo, direto

LEGENDA:
- 3 a 5 linhas, tom envolvente
- 8 a 12 hashtags ao final

Retorne APENAS JSON válido:
{
  "slides": ["texto slide 1", ...],
  "caption": "legenda completa"
}`;

  const textParts = [
    input.transcript ? `FONTE — Transcript ou resumo:\n"${input.transcript.slice(0, 2500)}"` : '',
    input.caption ? `Contexto — Título:\n"${input.caption.slice(0, 600)}"` : '',
    `Tom: ${input.tone ?? 'educativo e confiante'}`,
  ].filter(Boolean);

  const images = (input.imageUrls ?? []).filter(Boolean).slice(0, 4);

  const userContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'low' } }> = [
    { type: 'text' as const, text: textParts.join('\n\n') },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url, detail: 'low' as const } })),
  ];

  if (images.length) {
    userContent.push({ type: 'text' as const, text: 'Analise as imagens para extrair dados, textos visíveis e informações relevantes.' });
  }

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  });

  const raw = JSON.parse(response.choices[0].message.content ?? '{}') as { slides?: string[]; caption?: string };
  return { slides: raw.slides ?? [], caption: raw.caption ?? '' };
}

export type ImageOverlayVisualInput = {
  fontId?: ImagePostOverlayFont;
  bandStyle?: ImagePostBandStyle;
  bandColor?: string;
  bandTextColor?: string;
  overlayBodyColor?: string;
  overlayStrongColor?: string;
  previewImageOnly?: boolean;
};

const OVERLAY_FONT_LINK: Record<ImagePostOverlayFont, string> = {
  inter: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
  montserrat: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap",
  playfair: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap",
  'dm-sans': "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap",
  lora: "https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&display=swap",
  oswald: "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&display=swap",
};

const OVERLAY_FONT_FAMILY: Record<ImagePostOverlayFont, string> = {
  inter: "'Inter',sans-serif",
  montserrat: "'Montserrat',sans-serif",
  playfair: "'Playfair Display',serif",
  'dm-sans': "'DM Sans',sans-serif",
  lora: "'Lora',serif",
  oswald: "'Oswald',sans-serif",
};

function overlayFontLinkHref(fontId: ImagePostOverlayFont): string {
  return OVERLAY_FONT_LINK[fontId] ?? OVERLAY_FONT_LINK.inter;
}

function overlayFontFamilyCss(fontId: ImagePostOverlayFont): string {
  return OVERLAY_FONT_FAMILY[fontId] ?? OVERLAY_FONT_FAMILY.inter;
}

export function buildStaticImagePreviewHtml(backgroundUrl: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=1080,initial-scale=1.0"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:1080px;height:1080px;overflow:hidden;}
.bg{width:1080px;height:1080px;background:url('${backgroundUrl}') center/cover no-repeat;}
</style></head>
<body><div class="bg"></div></body></html>`;
}

function buildPanoramicBgScript(backgroundUrl: string, totalWidth: number, offsetX: number): string {
  return `<script>(function(){
  var bg=document.querySelector('.bg');
  var img=new Image();
  img.onload=function(){
    var tw=${totalWidth},sh=1080,ox=${offsetX};
    var sw=this.naturalWidth,ih=this.naturalHeight;
    var scaledH=ih*(tw/sw);
    if(scaledH>=sh){
      var top=(scaledH-sh)/2;
      bg.style.backgroundSize=tw+'px '+scaledH+'px';
      bg.style.backgroundPosition='-'+ox+'px -'+top+'px';
    }else{
      var scaledW=sw*(sh/ih);
      var left=ox+(scaledW-tw)/2;
      bg.style.backgroundSize=scaledW+'px '+sh+'px';
      bg.style.backgroundPosition='-'+left+'px 0px';
    }
  };
  img.src='${backgroundUrl}';
})();<\/script>`;
}

export function buildPanoramicImagePreviewHtml(
  backgroundUrl: string,
  slideIndex: number,
  total: number,
): string {
  const totalWidth = total * 1080;
  const offsetX = slideIndex * 1080;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=1080,initial-scale=1.0"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:1080px;height:1080px;overflow:hidden;}
.bg{width:1080px;height:1080px;background:url('${backgroundUrl}') -${offsetX}px 50% / ${totalWidth}px auto no-repeat;}
</style></head>
<body>
<div class="bg"></div>
${buildPanoramicBgScript(backgroundUrl, totalWidth, offsetX)}
</body></html>`;
}

const IMAGE_STYLE_SYSTEM: Record<Exclude<ImageStyle, 'brand'>, { system: string; dalleStyle: 'natural' | 'vivid' }> = {
  'lo-fi': {
    dalleStyle: 'natural',
    system: `You create DALL-E 3 prompts for Instagram post backgrounds about medical/health topics.
Goal: casual candid photo — like a Brazilian resident took it on their phone.
Rules:
- Casual smartphone feel, slightly grainy, natural indoor/hospital light, imperfect composition
- Subjects: notes on a desk, stethoscope, coffee next to a textbook, hospital hallway, resident in scrubs
- NO text, charts, labels, watermarks
- NOT cinematic, NOT studio lighting, NOT editorial
- Output ONLY the English prompt (max 150 words)`,
  },
  'realistic': {
    dalleStyle: 'natural',
    system: `You create DALL-E 3 prompts for Instagram post backgrounds about medical/health topics.
Goal: high-quality realistic photograph, professional feel but not stock-photo generic.
Rules:
- Style: sharp DSLR photograph, natural or soft studio lighting, clean composition
- Subjects: medical professionals in action, clinical environments, labs, anatomy, healthcare settings
- NO text, charts, labels, watermarks
- Output ONLY the English prompt (max 150 words)`,
  },
  'illustration-3d': {
    dalleStyle: 'vivid',
    system: `You create DALL-E 3 prompts for 3D illustration Instagram post backgrounds about medical/health topics.
Goal: modern 3D rendered illustration, Blender/Cinema4D aesthetic.
Rules:
- Style: 3D render, soft studio lighting, clean pastel or vivid color palette, smooth surfaces, subtle depth of field
- Subjects: stylized medical objects (stethoscope, heart, DNA, pills, brain), abstract health metaphors, clean backgrounds
- NO text, labels, watermarks
- NOT photorealistic — clearly a 3D illustration
- Output ONLY the English prompt (max 150 words)`,
  },
  'illustration-2d': {
    dalleStyle: 'vivid',
    system: `You create DALL-E 3 prompts for 2D flat illustration Instagram post backgrounds about medical/health topics.
Goal: modern flat vector illustration, clean and graphic.
Rules:
- Style: flat design, geometric shapes, bold outlines or no outlines, limited color palette, minimal gradients, editorial illustration feel
- Subjects: stylized medical icons, body silhouettes, abstract health concepts, clean colorful backgrounds
- NO text, labels, watermarks
- NOT photorealistic — clearly a 2D illustration
- Output ONLY the English prompt (max 150 words)`,
  },
};

async function buildDallEPrompt(
  transcript: string,
  caption: string,
  slideIndex: number,
  total: number,
  imageStyle: ImageStyle = 'lo-fi',
  brandColors: string[] = [],
  brandImageUrl = '',
  panoramic = false,
): Promise<{ prompt: string; dalleStyle: 'natural' | 'vivid' }> {
  const client = getClient();

  const context = [
    transcript ? `Conteúdo: "${transcript.slice(0, 800)}"` : '',
    caption ? `Título: "${caption.slice(0, 200)}"` : '',
    total > 1 && !panoramic ? `Slide ${slideIndex + 1} of ${total}.` : '',
    panoramic ? 'This image will be used as a wide panoramic carousel — it must flow naturally left to right.' : '',
  ].filter(Boolean).join('\n');

  if (imageStyle === 'brand') {
    const colorList = brandColors.slice(0, 4).join(', ') || 'no specific colors';
    const imageContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'low' } }> = [
      {
        type: 'text',
        text: `Brand colors: ${colorList}\n\nContent to illustrate:\n${context || 'Medical education content'}`,
      },
    ];
    if (brandImageUrl) {
      imageContent.splice(1, 0, { type: 'image_url', image_url: { url: brandImageUrl, detail: 'low' } });
    }

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: `You create DALL-E 3 prompts for Instagram post backgrounds about medical/health topics, tailored to a specific brand.
${brandImageUrl ? 'Analyze the brand profile image provided to understand the visual identity, color palette, style, and mood.' : ''}
Use the brand colors as the dominant tones of the image.
Rules:
- Style: match the brand aesthetic (modern, clean, professional, or illustrative — infer from the profile image and colors)
- Incorporate the brand colors prominently as the main palette
- Subjects related to the content topic and brand identity
- NO text, charts, labels, watermarks
- ${panoramic ? 'Wide horizontal composition that flows naturally left to right.' : 'Square composition (1:1).'}
- Output ONLY the English prompt (max 200 words)`,
        },
        { role: 'user', content: imageContent },
      ],
    });

    const prompt = response.choices[0].message.content?.trim()
      ?? `Professional medical background using colors ${colorList}`;
    return { prompt, dalleStyle: 'natural' };
  }

  const { system, dalleStyle } = IMAGE_STYLE_SYSTEM[imageStyle];
  const panoramicSuffix = panoramic
    ? '\n- Wide horizontal composition, continuous scene flowing left to right, panoramic 16:9 ratio'
    : '';

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      { role: 'system', content: system + panoramicSuffix },
      { role: 'user', content: context || 'Medical education content' },
    ],
  });

  const prompt = response.choices[0].message.content?.trim() ?? 'Medical environment, natural lighting, clean composition';
  return { prompt, dalleStyle };
}

export async function generateBackgroundImages(
  transcript: string,
  caption: string,
  count: number,
  imageStyle: ImageStyle = 'lo-fi',
  brandColors: string[] = [],
  brandImageUrl = '',
): Promise<string[]> {
  const client = getClient();
  const urls: string[] = [];

  for (let i = 0; i < count; i++) {
    try {
      const { prompt, dalleStyle } = await buildDallEPrompt(transcript, caption, i, count, imageStyle, brandColors, brandImageUrl);
      const response = await client.images.generate({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        style: dalleStyle,
      });
      const url = response.data?.[0]?.url;
      if (url) urls.push(url);
    } catch {
      // non-fatal per slide
    }
  }

  return urls;
}

export async function generatePanoramicBackground(
  transcript: string,
  caption: string,
  imageStyle: ImageStyle = 'lo-fi',
  brandColors: string[] = [],
  brandImageUrl = '',
): Promise<string | null> {
  const client = getClient();
  try {
    const { prompt, dalleStyle } = await buildDallEPrompt(transcript, caption, 0, 1, imageStyle, brandColors, brandImageUrl, true);
    const response = await client.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1792x1024',
      quality: 'standard',
      style: dalleStyle,
    });
    return response.data?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

function buildBottomBandHtml(
  text: string,
  profileName: string,
  profileImageUrl: string,
  bodyFontSize: number,
  fontFamily: string,
  accent: string,
  bandText: string,
  strongColor: string,
): string {
  const formatted = escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, (_, m: string) => `<strong style="color:${strongColor};">${escapeHtml(m)}</strong>`);

  const initial = (profileName || 'M')[0].toUpperCase();
  const avatarEl = profileImageUrl
    ? `<img src="${profileImageUrl}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;flex-shrink:0;border:3px solid ${accent};display:block;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"/><div style="display:none;width:80px;height:80px;border-radius:50%;background:${accent};align-items:center;justify-content:center;font-size:32px;font-weight:700;color:#fff;flex-shrink:0;border:3px solid ${accent};">${initial}</div>`
    : `<div style="width:80px;height:80px;border-radius:50%;background:${accent};display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:#fff;flex-shrink:0;border:3px solid ${accent};">${initial}</div>`;

  return `<div class="band">
  <div class="band-text">${formatted}</div>
  <div class="band-profile">
    ${avatarEl}
    <span class="band-name">${escapeHtml(profileName)}</span>
  </div>
</div>`;
}

function buildBottomBandCss(
  bandStyle: ImagePostBandStyle,
  bandColor: string,
  bandTextColor: string,
  bodyFontSize: number,
  fontFamily: string,
): string {
  const safeColor = bandColor?.trim() || '#ffffff';
  const isGradient = bandStyle === 'gradient';
  const bg = isGradient
    ? `linear-gradient(to bottom, transparent 0%, ${safeColor} 45%)`
    : safeColor;
  const paddingTop = isGradient ? '100px' : '40px';

  return `
.band{position:absolute;bottom:0;left:0;right:0;background:${bg};display:flex;flex-direction:column;justify-content:flex-end;padding:${paddingTop} 52px 48px;}
.band-text{font-size:${bodyFontSize}px;font-weight:600;color:${bandTextColor};line-height:1.45;margin-bottom:32px;font-family:${fontFamily};}
.band-text strong{font-weight:700;}
.band-profile{display:flex;align-items:center;gap:20px;}
.band-name{font-size:28px;font-weight:600;color:${bandTextColor};letter-spacing:-0.2px;font-family:${fontFamily};}`;
}

export function buildPanoramicSlideHtml(
  text: string,
  backgroundUrl: string,
  mode: DisplayMode,
  bodyFontSize: number,
  brandColors: string[],
  slideIndex: number,
  total: number,
  profileName = '',
  profileImageUrl = '',
  visual?: ImageOverlayVisualInput,
): string {
  if (visual?.previewImageOnly) {
    return buildPanoramicImagePreviewHtml(backgroundUrl, slideIndex, total);
  }
  const fontId = visual?.fontId ?? 'montserrat';
  const fontHref = overlayFontLinkHref(fontId);
  const fontFamily = overlayFontFamilyCss(fontId);
  const accent = visual?.overlayStrongColor?.trim() || brandColors[0] || '#6C63FF';
  const bandStyle = visual?.bandStyle ?? 'solid';
  const bandColor = visual?.bandColor ?? '#ffffff';
  const bandText = visual?.bandTextColor ?? '#111111';

  const totalWidth = total * 1080;
  const offsetX = slideIndex * 1080;

  const counter = total > 1
    ? `<div style="position:absolute;top:32px;right:36px;font-size:24px;font-weight:500;color:rgba(255,255,255,0.9);font-family:${fontFamily};text-shadow:0 1px 6px rgba(0,0,0,0.5);">${slideIndex + 1} / ${total}</div>`
    : '';

  const band = buildBottomBandHtml(text, profileName, profileImageUrl, bodyFontSize, fontFamily, accent, bandText, accent);
  const bandCss = buildBottomBandCss(bandStyle, bandColor, bandText, bodyFontSize, fontFamily);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=1080,initial-scale=1.0"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/><link href="${fontHref}" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:1080px;height:1080px;overflow:hidden;}
.bg{width:1080px;height:1080px;background:url('${backgroundUrl}') -${offsetX}px 50% / ${totalWidth}px auto no-repeat;position:relative;}
${bandCss}
</style></head>
<body>
<div class="bg">
  ${counter}
  ${band}
</div>
${buildPanoramicBgScript(backgroundUrl, totalWidth, offsetX)}
</body></html>`;
}

export function buildImageOverlayHtml(
  text: string,
  backgroundUrl: string,
  mode: DisplayMode,
  bodyFontSize: number,
  brandColors: string[],
  slideIndex: number,
  total: number,
  profileName = '',
  profileImageUrl = '',
  visual?: ImageOverlayVisualInput,
): string {
  if (visual?.previewImageOnly) {
    return buildStaticImagePreviewHtml(backgroundUrl);
  }
  const fontId = visual?.fontId ?? 'montserrat';
  const fontHref = overlayFontLinkHref(fontId);
  const fontFamily = overlayFontFamilyCss(fontId);
  const accent = visual?.overlayStrongColor?.trim() || brandColors[0] || '#6C63FF';
  const bandStyle = visual?.bandStyle ?? 'solid';
  const bandColor = visual?.bandColor ?? '#ffffff';
  const bandText = visual?.bandTextColor ?? '#111111';

  const counter = total > 1
    ? `<div style="position:absolute;top:32px;right:36px;font-size:24px;font-weight:500;color:rgba(255,255,255,0.9);font-family:${fontFamily};text-shadow:0 1px 6px rgba(0,0,0,0.5);">${slideIndex + 1} / ${total}</div>`
    : '';

  const band = buildBottomBandHtml(text, profileName, profileImageUrl, bodyFontSize, fontFamily, accent, bandText, accent);
  const bandCss = buildBottomBandCss(bandStyle, bandColor, bandText, bodyFontSize, fontFamily);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=1080,initial-scale=1.0"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/><link href="${fontHref}" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:1080px;height:1080px;overflow:hidden;}
.bg{width:1080px;height:1080px;background:url('${backgroundUrl}') center/cover no-repeat;position:relative;}
${bandCss}
</style></head>
<body>
<div class="bg">
  ${counter}
  ${band}
</div>
</body></html>`;
}
