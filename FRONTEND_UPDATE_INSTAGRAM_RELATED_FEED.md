# Frontend Update — Feed de interesses (Instagram relacionado)

Data: 2026-04-04  
Autenticação: `Authorization: Bearer <accessToken>` (igual aos demais endpoints).  
Base URL: a mesma da API (ex.: `http://localhost:5003`).

Endpoints afetados / novos:

- `GET /instagram-accounts/:id/related-feed` (timeline única, misturada)
- `GET /instagram-accounts/:id/related-feed/instagram`
- `GET /instagram-accounts/:id/related-feed/tiktok`
- `GET /instagram-accounts/:id/related-feed/news`

Contexto de configuração: `GET /instagram-accounts/:id` e `PATCH /instagram-accounts/:id` expõem `relatedInstagramAccountIds`, `relatedTikTokAccountIds` e `relatedMedNewsSourceIds` (strings de ObjectId). O `:id` nas rotas acima é o **externalId** da conta Instagram (handle / id público), não o `_id` do MongoDB.

---

## O que mudou

### 1. Endpoints separados por fonte

Além do feed **mesclado**, existem três rotas com a **mesma paginação** (`page`, `limit`), cada uma retornando apenas um tipo de conteúdo. Isso evita paginação “instável” quando se misturam Instagram, TikTok e notícias na mesma lista ordenada globalmente.

### 2. Recomendação de uso no front

| Cenário | Abordagem |
|---------|-----------|
| Tabs ou seções independentes (IG / TikTok / Notícias) | Três chamadas aos endpoints `/instagram`, `/tiktok` e `/news`, cada uma com sua página. Podem rodar em **paralelo** (`Promise.all`). |
| Uma única timeline infinita misturada | `GET .../related-feed` com `page` crescente (aceita que a ordem global depende de `sortAt` e de um desempate interno). |

### 3. `relatedNewsSources`

Nos endpoints **mesclado** e **somente notícias**, a resposta inclui `relatedNewsSources`: metadados das fontes vinculadas à conta, mesmo quando ainda não há artigos na página atual. Nos endpoints só Instagram e só TikTok esse campo **não** é enviado.

---

## Parâmetros comuns (query)

| Param | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `page` | string | `"1"` | Página (≥ 1) |
| `limit` | string | `"30"` | Itens por página (mín. 1, máx. 100) |

---

## Formato da resposta (todos os feeds)

```ts
type RelatedFeedItemType =
  | 'instagram_post'
  | 'instagram_reel'
  | 'instagram_story'
  | 'tiktok_post'
  | 'medical_news';

interface RelatedFeedRow {
  type: RelatedFeedItemType;
  sortAt: string; // ISO date — serializado do Date do Mongo
  payload: Record<string, unknown>; // ver seções por tipo abaixo
}

interface RelatedFeedPage {
  data: RelatedFeedRow[];
  total: number;
  page: number;
  limit: number;
  pages: number; // Math.ceil(total / limit)
}

interface RelatedNewsSourceMeta {
  id: string;
  name: string;
  url: string;
  newsPageUrl: string | null;
  lastScrapedAt: string | null;
  isActive: boolean;
  category: string;
  language: string;
}

type RelatedFeedWithSources = RelatedFeedPage & {
  relatedNewsSources: RelatedNewsSourceMeta[];
};
```

- **`GET .../related-feed`** e **`GET .../related-feed/news`**: corpo = `RelatedFeedWithSources` (se não houver fontes vinculadas, `relatedNewsSources` pode ser `[]`).
- **`GET .../related-feed/instagram`** e **`GET .../related-feed/tiktok`**: corpo = `RelatedFeedPage` apenas.

### Ordenação

Itens são ordenados por `sortAt` **descendente**. Quando dois itens têm o mesmo `sortAt`, o backend usa um desempate interno (ex.: presença de transcript em mídias) para não empurrar notícias para trás de forma exagerada no feed mesclado.

---

## Endpoints

### GET /instagram-accounts/:id/related-feed

Timeline única: posts/reels/stories dos IGs relacionados + TikToks relacionados + notícias cuja fonte está em `relatedMedNewsSourceIds`.

- Se não houver nenhum relacionamento configurado: `data: []`, `total: 0`, `relatedNewsSources: []`.

---

### GET /instagram-accounts/:id/related-feed/instagram

Apenas `instagram_post`, `instagram_reel` e `instagram_story` para contas em `relatedInstagramAccountIds`.

- Se não houver IGs relacionados: lista vazia, `total: 0`.

**`payload` (post/reel)** — campos principais: `id`, `instagramPostId`, `accountId` (preferencialmente externalId da conta), `title`, `postedAt`, `format`, métricas, URLs de mídia, `transcript`, `carouselImages`.

**`payload` (story)** — campos principais: `id`, `storyId`, `accountId`, `handle`, `mediaType`, URLs, `transcript`, `postedAt`, `syncedAt`, `expiresAt`.

---

### GET /instagram-accounts/:id/related-feed/tiktok

Apenas `tiktok_post` para contas em `relatedTikTokAccountIds`.

- Se não houver TikToks relacionados: lista vazia, `total: 0`.

**`payload`** — campos principais: `id`, `tiktokPostId`, `accountId`, `title`, `postedAt`, `thumbnailUrl`, `videoUrl`, `transcript`, engajamento, `postUrl`, `hashtags`, `syncedAt`.

---

### GET /instagram-accounts/:id/related-feed/news

Apenas `medical_news` filtradas pelas fontes vinculadas (`relatedMedNewsSourceIds`), com lookup no catálogo de fontes.

- Inclui `relatedNewsSources` como no feed mesclado.
- Se não houver fontes vinculadas: `data: []`, `relatedNewsSources: []`.

**`payload` (medical_news)** — campos principais: `id`, `title`, `summary`, `source`, `url`, `category`, `language`, `specialty`, `author`, `tags`, `wordCount`, `imageUrl`, `publishedAt`, `medNewsSourceId`, `medNewsSourceName`.

---

## Erros HTTP

| Status | Quando |
|--------|--------|
| `403` | Usuário não admin e `:id` não está em `allowedInstagramAccountIds` |
| `404` | Conta Instagram com esse `externalId` não existe |

---

## Exemplo: carregar as três fontes em paralelo

Cada aba mantém seu próprio `page` / `total` / `pages`. Os `limit` podem ser iguais ou diferentes.

```ts
const base = `/instagram-accounts/${encodeURIComponent(instagramExternalId)}`;
const q = (page: number, limit: number) =>
  `?page=${page}&limit=${limit}`;

const [ig, tt, news] = await Promise.all([
  fetch(`${base}/related-feed/instagram${q(igPage, 20)}`, { headers }),
  fetch(`${base}/related-feed/tiktok${q(ttPage, 20)}`, { headers }),
  fetch(`${base}/related-feed/news${q(newsPage, 20)}`, { headers }),
]);

const igJson = await ig.json();
const ttJson = await tt.json();
const newsJson = await news.json();

// igJson.data — só Instagram
// ttJson.data — só TikTok
// newsJson.data — só medical_news
// newsJson.relatedNewsSources — chips / filtros de fonte
```

---

## Referências no backend

- Rotas: `src/routes/instagramAccounts.routes.ts` (rotas específicas `/related-feed/...` registradas **antes** de `/:id/related-feed`).
- Handlers e agregações: `src/controllers/instagramAccounts.controller.ts`.

Notícias globais (fora do feed de interesses): [FRONTEND_UPDATE_MEDICAL_NEWS.md](./FRONTEND_UPDATE_MEDICAL_NEWS.md).
