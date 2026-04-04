import OpenAI from 'openai';
import https from 'https';
import http from 'http';
import { env } from '../config/env';
import type { DisplayMode } from '../models/TwitterLikePost';

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

/**
 * Calls GPT to generate tweet-style slide texts (no hashtags) and a separate
 * Instagram caption with hashtags, tailored for the medical residency persona.
 */
export async function generateSlidesFromSource(input: {
  transcript?: string;
  caption?: string;
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

  const system = `Você é um especialista em conteúdo para médicos residentes e estudantes de medicina brasileiros.
Sua missão é transformar um conteúdo bruto em um carrossel estilo Twitter/X de alto valor educativo.
Quando o transcript ou resumo de notícia estiver disponível, essa é a fonte principal — use-a como base. A legenda/título complementar é apenas apoio.

REGRAS DOS SLIDES:
- Gere exatamente ${slideCount} slides
- Cada slide deve ser autônomo, informativo e diretamente útil para quem estuda para residência médica
- Inclua dados concretos, estatísticas, protocolos, dicas práticas ou insights clínicos sempre que possível
- Linguagem direta, sem enrolação — como uma dica de colega sênior para calouro
- Máximo de 260 caracteres por slide
- PROIBIDO usar hashtags nos slides
- PROIBIDO usar emojis em excesso (máximo 1 por slide, opcional)
- Cada slide deve entregar valor real — sem frases genéricas como "é muito importante saber disso"
- PROIBIDO mencionar concorrentes da MedCOF: Medway, MedGrupo, Hardwork Medicina ou qualquer outra empresa de preparação para residência médica
${attributionBlock}

LEGENDA DO POST (campo "caption"):
- Texto para publicar no Instagram acompanhando o carrossel
- 3 a 5 linhas, tom envolvente, começa com gancho forte
- Inclua 8 a 12 hashtags relevantes para medicina, residência médica e a especialidade do conteúdo
- Separe as hashtags em um bloco ao final da legenda

Retorne APENAS JSON válido:
{
  "slides": ["texto slide 1", "texto slide 2", ...],
  "caption": "legenda completa com hashtags ao final"
}`;

  const userMessage = [
    input.transcript ? `FONTE PRINCIPAL — Transcript ou resumo:\n"${input.transcript.slice(0, 2500)}"` : '',
    input.caption ? `Informação complementar — Legenda ou título:\n"${input.caption.slice(0, 600)}"` : '',
    `Tom: ${input.tone ?? 'educativo, direto e confiante'}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.75,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage },
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
  const eng = mockEngagement();

  const avatar = profileImageUrl
    ? `<img src="${profileImageUrl}" alt="avatar" style="width:52px;height:52px;border-radius:50%;object-fit:cover;flex-shrink:0;" crossorigin="anonymous"/>`
    : `<div style="width:52px;height:52px;border-radius:50%;background:${c.link};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;flex-shrink:0;">${(profileName || 'U')[0].toUpperCase()}</div>`;

  const handle = profileHandle ? `@${profileHandle.replace(/^@/, '')}` : '';
  const name = profileName || 'Perfil';

  const paragraphs = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `<p style="margin:0 0 14px 0;line-height:1.6;">${l.trim()}</p>`)
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
  .divider{border:none;border-top:1px solid ${c.border};margin:14px 0;}
  .stats{display:flex;gap:6px;margin-bottom:14px;font-size:13px;color:${c.subtext};}
  .stats b{color:${c.text};}
  .footer{display:flex;justify-content:space-between;color:${c.icon};font-size:22px;}
  .footer button{
    background:none;border:none;cursor:pointer;
    color:${c.icon};font-size:14px;
    display:flex;align-items:center;gap:6px;padding:0;
  }
  .footer button:hover{color:${c.link};}
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

  <div class="stats">
    <span><b>${formatCount(eng.reposts)}</b> Reposts</span>
    <span style="margin:0 4px;">·</span>
    <span><b>${formatCount(eng.likes)}</b> Curtidas</span>
    <span style="margin:0 4px;">·</span>
    <span><b>${formatCount(eng.views)}</b> Visualizações</span>
  </div>

  <div class="footer">
    <button>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      ${formatCount(eng.replies)}
    </button>
    <button>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
      ${formatCount(eng.reposts)}
    </button>
    <button>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      ${formatCount(eng.likes)}
    </button>
    <button>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      ${formatCount(eng.views)}
    </button>
    <button>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
    </button>
  </div>
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
