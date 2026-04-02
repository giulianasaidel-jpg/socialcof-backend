import OpenAI from 'openai';
import { env } from '../config/env';

function getClient(): OpenAI {
  if (!env.GPT_KEY) throw new Error('GPT_KEY is not configured');
  return new OpenAI({ apiKey: env.GPT_KEY });
}

const SYSTEM_PROMPT = `Você é um assistente que analisa imagens de posts do Instagram.
Para cada imagem:
1. Faça uma breve descrição do que está na imagem (máximo 2 frases).
2. Se houver texto, escrita, legenda ou qualquer conteúdo textual visível na imagem, transcreva-o exatamente após a linha "Texto na imagem:".
Responda sempre em português brasileiro. Seja objetivo e direto.`;

/**
 * Analyses a single image URL using GPT-4o vision.
 * Returns a description and any visible text transcription.
 */
export async function analyseImage(imageUrl: string): Promise<string> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 400,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
        ],
      },
    ],
  });

  return response.choices[0].message.content?.trim() ?? '';
}

/**
 * Analyses all slides of a carousel and returns a combined transcript.
 * Each slide is prefixed with its index (Slide 1, Slide 2, …).
 */
export async function analyseCarousel(imageUrls: string[]): Promise<string> {
  const analyses = await Promise.all(
    imageUrls.map((url, i) =>
      analyseImage(url)
        .then((text) => `[Slide ${i + 1}]\n${text}`)
        .catch(() => `[Slide ${i + 1}]\n(análise indisponível)`),
    ),
  );

  return analyses.join('\n\n');
}
