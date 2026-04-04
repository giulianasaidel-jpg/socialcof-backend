import OpenAI from 'openai';
import { env } from '../config/env';

export interface PostAnalysis {
  format: string;
  hook: string;
  contentStrategy: string;
  tone: string;
  callToAction: string | null;
  suggestedImprovements: string[];
  contentPillars: string[];
}

export interface AccountAnalysis {
  overallStrategy: string;
  topContentPillars: string[];
  avgEngagementInsight: string;
  bestPerformingFormats: string[];
  suggestions: string[];
}

function getClient(): OpenAI {
  if (!env.GPT_KEY) throw new Error('GPT_KEY is not configured');
  return new OpenAI({ apiKey: env.GPT_KEY });
}

/**
 * Analyzes a single post caption and returns content strategy insights.
 */
export async function analyzePost(caption: string, likes: number, comments: number): Promise<PostAnalysis> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Você é um especialista em marketing de conteúdo para médicos no Instagram. Analise posts e retorne JSON estruturado.',
      },
      {
        role: 'user',
        content: `Analise este post do Instagram de uma conta médica:

Legenda: "${caption}"
Likes: ${likes}
Comentários: ${comments}

Retorne um JSON com:
- format: formato do conteúdo (educativo, motivacional, caso clínico, dica rápida, etc.)
- hook: o gancho principal da legenda (primeira frase ou ideia)
- contentStrategy: estratégia de conteúdo identificada
- tone: tom da comunicação (formal, didático, empático, direto, etc.)
- callToAction: call to action encontrado ou null
- suggestedImprovements: array com até 3 sugestões de melhoria
- contentPillars: array com os pilares de conteúdo identificados`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  return JSON.parse(response.choices[0].message.content ?? '{}') as PostAnalysis;
}

/**
 * Summarizes a scraped article using GPT-4o-mini.
 * Accepts the raw full text (truncated to 3000 chars) and returns a 2-3 sentence
 * medical-grade summary in the same language as the article.
 */
export async function summarizeArticle(title: string, text: string, language: 'pt' | 'en' = 'pt'): Promise<string> {
  const client = getClient();
  const body = text.slice(0, 3000);
  const lang = language === 'pt' ? 'português' : 'English';

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a medical editor. Write a concise 2-3 sentence summary in ${lang} of the article provided. Focus on the clinical or scientific key point. Return only the summary text, no labels.`,
      },
      {
        role: 'user',
        content: `Title: ${title}\n\n${body}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 200,
  });

  return (response.choices[0].message.content ?? '').trim();
}

/**
 * Analyzes a set of posts from an account and returns an overall content strategy overview.
 */
export async function analyzeAccount(
  handle: string,
  posts: Array<{ caption: string; likes: number; comments: number; format: string }>,
): Promise<AccountAnalysis> {
  const client = getClient();

  const topPosts = posts
    .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))
    .slice(0, 10)
    .map((p, i) => `Post ${i + 1} (${p.likes} likes, ${p.comments} comentários, ${p.format}): "${p.caption.slice(0, 150)}"`)
    .join('\n');

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Você é um especialista em estratégia de conteúdo para contas médicas no Instagram.',
      },
      {
        role: 'user',
        content: `Analise a estratégia de conteúdo da conta @${handle} com base nos 10 posts de maior engajamento:

${topPosts}

Retorne um JSON com:
- overallStrategy: descrição da estratégia geral identificada (2-3 frases)
- topContentPillars: array dos principais pilares de conteúdo
- avgEngagementInsight: insight sobre o padrão de engajamento
- bestPerformingFormats: array dos formatos que mais performam
- suggestions: array com até 5 sugestões estratégicas para melhorar o conteúdo`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.4,
  });

  return JSON.parse(response.choices[0].message.content ?? '{}') as AccountAnalysis;
}
