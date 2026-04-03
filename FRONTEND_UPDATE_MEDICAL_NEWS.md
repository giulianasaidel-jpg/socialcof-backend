# Frontend Update — Medical News v2

Data: 2026-04-03  
Endpoints afetados: `GET /medical-news`, `GET /medical-news/sources`, `GET /medical-news/stream`, `POST /medical-news/refresh`

---

## O que mudou

### 1. Resposta paginada com metadados

O `GET /medical-news` agora retorna um objeto paginado em vez de um array direto. Os dados ficam dentro de `data`.

### 2. Novos campos: `category` e `language`

Cada notícia agora possui `category` e `language`, permitindo filtros granulares no frontend.

### 3. Novos endpoints

- `GET /medical-news/sources` — lista as fontes disponíveis no banco
- `GET /medical-news/stream` — SSE: push de novas notícias em tempo real
- `POST /medical-news/refresh` — trigger manual de coleta de notícias

### 4. Fontes expandidas (20+ fontes)

| Categoria | Fontes |
|-----------|--------|
| **education** | EBSERH, ENARE/ENAMED, Residência Médica, PubMed - Educação Médica |
| **government** | CFM, Gov.br Saúde, Ministério da Saúde, ANVISA |
| **journal** | NEJM, The Lancet, BMJ, JAMA, Nature Medicine, Annals of Internal Medicine |
| **guidelines** | SBC, SBEM, AHA, ACC, PubMed - Diretrizes |
| **research** | FIOCRUZ, SciELO, PubMed - Saúde Pública BR |
| **global** | WHO, CDC, OPAS/OMS Brasil |

---

## Endpoints

### GET /medical-news

**Query params:**

| Param | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `page` | string | `"1"` | Página atual |
| `limit` | string | `"30"` | Itens por página (máx 100) |
| `category` | string | — | Filtro por categoria |
| `language` | string | — | `"pt"` ou `"en"` |
| `source` | string | — | Filtro por fonte exata |
| `dateFrom` | string (ISO) | — | Data mínima de publicação |

**Resposta (200):**

```ts
interface MedicalNewsResponse {
  data: {
    id: string;
    title: string;
    summary: string;
    source: string;
    url: string;
    category: 'education' | 'government' | 'journal' | 'guidelines' | 'research' | 'global';
    language: 'pt' | 'en';
    publishedAt: string;
  }[];
  total: number;
  page: number;
  totalPages: number;
}
```

**Exemplos de chamada:**

```ts
// Todas as notícias (padrão)
GET /medical-news

// Journals internacionais
GET /medical-news?category=journal&language=en

// Educação médica (residência, EBSERH, ENARE)
GET /medical-news?category=education

// Diretrizes de sociedades
GET /medical-news?category=guidelines

// Fontes nacionais
GET /medical-news?language=pt&page=2&limit=20

// Notícias da última semana
GET /medical-news?dateFrom=2026-03-27T00:00:00.000Z
```

---

### GET /medical-news/sources

Retorna array de strings com as fontes disponíveis no banco.

**Resposta (200):**

```ts
string[]
// Ex: ["ACC - Cardiology", "AHA - Cardiology", "ANVISA", "BMJ", "CDC", "CFM", ...]
```

---

### GET /medical-news/stream

Endpoint SSE (Server-Sent Events). Mantém a conexão aberta e envia um evento para cada notícia **nova** identificada pelo job de coleta. O browser reconecta automaticamente se a conexão cair.

**Headers da resposta:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Formato do evento:**

```ts
interface NewsEvent {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  category: 'education' | 'government' | 'journal' | 'guidelines' | 'research' | 'global';
  language: 'pt' | 'en';
  publishedAt: string; // ISO 8601
}
```

**Exemplo de uso:**

```ts
const token = getAuthToken();

const source = new EventSource(`/medical-news/stream?token=${token}`);

source.onmessage = (event) => {
  const news: NewsEvent = JSON.parse(event.data);
  addNewsToTop(news);
  showToast(`Nova notícia: ${news.title}`);
};

source.onerror = () => {
  // EventSource reconecta automaticamente
};

// Fechar conexão quando o componente for desmontado
onUnmount(() => source.close());
```

> O primeiro "evento" após conectar é um comentário de keep-alive (`: connected`), ignorado pelo `EventSource` automaticamente.

---

### POST /medical-news/refresh

Dispara coleta manual de todas as fontes. A coleta roda em background — a resposta é imediata.

**Resposta (200):**

```ts
{ message: "Refresh started in background" }
```

---

## Breaking change: formato da resposta

**Antes (v1):**

```ts
const news = await res.json(); // era um array direto
news.forEach(item => ...);
```

**Agora (v2):**

```ts
const { data, total, page, totalPages } = await res.json();
data.forEach(item => ...);
```

---

## Categorias

| Valor | Label sugerido | Descrição |
|-------|---------------|-----------|
| `education` | Educação Médica | Residência, EBSERH, ENARE, ENAMED |
| `government` | Governo & Órgãos | Ministério da Saúde, ANVISA, CFM |
| `journal` | Revistas Científicas | NEJM, Lancet, BMJ, JAMA, Nature Medicine |
| `guidelines` | Diretrizes | Sociedades brasileiras e americanas |
| `research` | Pesquisa | FIOCRUZ, SciELO, PubMed |
| `global` | Saúde Global | WHO, CDC, OPAS |

---

## Sugestão de UI: filtros com tabs/chips

```
┌─────────────────────────────────────────────────────────────┐
│  Notícias Médicas                          [ ↻ Atualizar ]  │
│                                                             │
│  [Todas] [Educação] [Governo] [Journals] [Diretrizes]      │
│  [Pesquisa] [Saúde Global]                                  │
│                                                             │
│  Idioma: [🇧🇷 PT] [🇺🇸 EN] [Todos]                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 📄 NEJM · journal · en               2h atrás      │    │
│  │ Title of the Article                                │    │
│  │ Brief summary of the article content...             │    │
│  │                                           [Abrir ↗] │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ 📄 Ministério da Saúde · government · pt  5h atrás │    │
│  │ Título da Notícia                                   │    │
│  │ Resumo breve do conteúdo...                         │    │
│  │                                           [Abrir ↗] │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Página 1 de 5        [ ← Anterior ]  [ Próxima → ]        │
└─────────────────────────────────────────────────────────────┘
```

---

## Exemplo de implementação (React)

```ts
type NewsCategory = 'education' | 'government' | 'journal' | 'guidelines' | 'research' | 'global';
type NewsLanguage = 'pt' | 'en';

interface MedicalNewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  category: NewsCategory;
  language: NewsLanguage;
  publishedAt: string;
}

interface FetchNewsParams {
  page?: number;
  limit?: number;
  category?: NewsCategory;
  language?: NewsLanguage;
  source?: string;
  dateFrom?: string;
}

async function fetchMedicalNews(params: FetchNewsParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.category) query.set('category', params.category);
  if (params.language) query.set('language', params.language);
  if (params.source) query.set('source', params.source);
  if (params.dateFrom) query.set('dateFrom', params.dateFrom);

  const res = await api.get(`/medical-news?${query.toString()}`);
  return res.data as {
    data: MedicalNewsItem[];
    total: number;
    page: number;
    totalPages: number;
  };
}

async function fetchSources(): Promise<string[]> {
  const res = await api.get('/medical-news/sources');
  return res.data;
}

async function triggerRefresh(): Promise<void> {
  await api.post('/medical-news/refresh');
}
```

---

## Checklist de atualização

- [ ] Atualizar a chamada `GET /medical-news` para extrair `data` do objeto (breaking change)
- [ ] Adicionar filtros de `category` (tabs ou chips)
- [ ] Adicionar filtro de `language` (PT / EN / Todos)
- [ ] Implementar paginação usando `page`, `total`, `totalPages`
- [ ] Adicionar botão "Atualizar" que chama `POST /medical-news/refresh`
- [ ] (Opcional) Dropdown de fonte usando `GET /medical-news/sources`
- [ ] Atualizar types/interfaces com os novos campos `category` e `language`
- [ ] Conectar ao `GET /medical-news/stream` via `EventSource` para receber novas notícias em tempo real
- [ ] Exibir badge/toast quando uma nova notícia chegar via SSE
- [ ] Fechar a conexão `EventSource` ao desmontar o componente
