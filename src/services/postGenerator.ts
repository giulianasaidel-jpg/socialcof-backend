import OpenAI from 'openai';
import { env } from '../config/env';
import type { ISlide, TemplateType } from '../models/Draft';

interface GenerateInput {
  templateType: TemplateType;
  topic: string;
  accountHandle: string;
  tone?: string;
  slideCount?: number;
  referenceCaption?: string;
  sourceContent?: string;
}

export interface GeneratedDraft {
  title: string;
  caption: string;
  hashtags: string[];
  format: 'Post' | 'Carrossel';
  templateType: TemplateType;
  slides: ISlide[];
}

function getClient(): OpenAI {
  if (!env.GPT_KEY) throw new Error('GPT_KEY is not configured');
  return new OpenAI({ apiKey: env.GPT_KEY });
}

function buildSystemPrompt(templateType: TemplateType): string {
  const schemas: Record<TemplateType, string> = {
    'twitter-quote': `
Template: twitter-quote (single static post, quote-card style)
Format: Post (single image)
Slides: exactly 1 slide
Slide schema: { index: 1, type: "quote", layout: "twitter-quote", colorScheme: "dark"|"light", title: "<the quote text>", body: "<attribution or subtitle>" }
Style: Clean, large text, minimal, like a viral quote card. Bold and punchy.`,

    'carousel-tips': `
Template: carousel-tips (numbered tips carousel)
Format: Carrossel
Slides: 1 cover + N content + 1 CTA (slideCount total)
Cover schema: { index: 1, type: "cover", layout: "carousel-cover", colorScheme: "primary", title: "<hook title>", subtitle: "<subtitle>" }
Content schema: { index: N, type: "content", layout: "carousel-tips", colorScheme: "primary", number: "01"-"0N", title: "<tip title>", body: "<explanation 1-2 sentences>" }
CTA schema: { index: last, type: "cta", layout: "carousel-cta", colorScheme: "accent", title: "<action call>", body: "<what to do next>" }`,

    'carousel-numbered': `
Template: carousel-numbered (step-by-step list)
Format: Carrossel
Slides: 1 cover + N steps + 1 CTA (slideCount total)
Cover schema: { index: 1, type: "cover", layout: "carousel-cover", colorScheme: "primary", title: "<hook question or statement>", subtitle: "<subtext>" }
Step schema: { index: N, type: "content", layout: "carousel-numbered", colorScheme: "secondary", number: "Passo 01"-"Passo 0N", title: "<step title>", body: "<step detail>" }
CTA schema: { index: last, type: "cta", layout: "carousel-cta", colorScheme: "accent", title: "<action>", body: "<next step>" }`,

    'carousel-before-after': `
Template: carousel-before-after (before/after contrast slides)
Format: Carrossel
Slides: 1 cover + N contrast pairs + 1 CTA (slideCount total)
Cover schema: { index: 1, type: "cover", layout: "carousel-cover", colorScheme: "dark", title: "<provocative hook>", subtitle: "<context>" }
Contrast schema: { index: N, type: "content", layout: "carousel-before-after", colorScheme: "primary", title: "<topic of contrast>", beforeTitle: "Antes", beforeBody: "<negative state>", afterTitle: "Depois", afterBody: "<positive transformation>" }
CTA schema: { index: last, type: "cta", layout: "carousel-cta", colorScheme: "accent", title: "<action>", body: "<benefit>" }`,

    'carousel-story': `
Template: carousel-story (narrative arc / storytelling)
Format: Carrossel
Slides: 1 hook + N story beats + 1 lesson + 1 CTA (slideCount total)
Hook schema: { index: 1, type: "cover", layout: "carousel-cover", colorScheme: "dark", title: "<cliffhanger or bold statement>", subtitle: "<context>" }
Story schema: { index: N, type: "content", layout: "carousel-story", colorScheme: "secondary", title: "<scene title>", body: "<narrative beat, 1-3 sentences>" }
Lesson schema: { index: second-to-last, type: "content", layout: "carousel-story", colorScheme: "primary", title: "A lição", body: "<key takeaway>" }
CTA schema: { index: last, type: "cta", layout: "carousel-cta", colorScheme: "accent", title: "<action>", body: "<what they gain>" }`,

    'static-announcement': `
Template: static-announcement (single announcement post)
Format: Post (single image)
Slides: exactly 1 slide
Slide schema: { index: 1, type: "cover", layout: "static-announcement", colorScheme: "primary", title: "<main announcement>", subtitle: "<supporting detail>", body: "<call to action short>" }
Style: Bold headline, clear CTA, high contrast.`,
  };

  return `You are a social media content strategist for a Brazilian medical residency preparation brand.
Generate Instagram post content following the EXACT template schema below.
Return ONLY valid JSON with no markdown or explanation.

${schemas[templateType]}

JSON output schema:
{
  "title": "<draft title for internal use>",
  "caption": "<full Instagram caption in Portuguese, engaging, with line breaks>",
  "hashtags": ["#tag1", "#tag2", ...],
  "slides": [ ...slide objects as defined above ]
}

Rules:
- Write in Brazilian Portuguese
- Caption must be engaging and match the template tone
- Use 5-10 relevant hashtags for medical education / residência médica
- Slide titles should be punchy and short (max 8 words)
- Slide body should be concise (max 25 words)
- colorScheme options: primary | secondary | dark | light | accent`;
}

/**
 * Generates a complete draft structure (caption, hashtags, slides) using GPT-4o.
 */
export async function generateDraft(input: GenerateInput): Promise<GeneratedDraft> {
  const client = getClient();

  const slideCount = input.slideCount ?? (input.templateType.startsWith('carousel') ? 5 : 1);
  const isCarousel = input.templateType.startsWith('carousel');

  const userMessage = [
    `Account: @${input.accountHandle}`,
    `Topic: ${input.topic}`,
    `Tone: ${input.tone ?? 'educativo e motivador'}`,
    isCarousel ? `Slide count: ${slideCount} (including cover and CTA)` : '',
    input.referenceCaption ? `Reference post for inspiration:\n"${input.referenceCaption.slice(0, 400)}"` : '',
    input.sourceContent ? `Source content to base the post on:\n---\n${input.sourceContent.slice(0, 3000)}\n---` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt(input.templateType) },
      { role: 'user', content: userMessage },
    ],
  });

  const raw = JSON.parse(response.choices[0].message.content ?? '{}') as {
    title?: string;
    caption?: string;
    hashtags?: string[];
    slides?: ISlide[];
  };

  return {
    title: raw.title ?? input.topic,
    caption: raw.caption ?? '',
    hashtags: raw.hashtags ?? [],
    format: isCarousel ? 'Carrossel' : 'Post',
    templateType: input.templateType,
    slides: raw.slides ?? [],
  };
}
