# Frontend — Tela de Feed de Notícias Médicas (estilo Twitter)

Data: 2026-04-03

---

## Conceito

Uma coluna central de cards em scroll contínuo, inspirada no Twitter/X. O feed exibe notícias de fontes médicas nacionais e internacionais, com atualizações em tempo real via SSE. Quando novas notícias chegam, um banner "N novas notícias" aparece no topo — exatamente como o Twitter faz com "Show X new tweets".

---

## Layout geral

```
┌─────────────────────────────────────────────────────────────────┐
│  🩺 MedFeed                                      [● ao vivo]    │
├─────────────────────────────────────────────────────────────────┤
│  [Para você] [Journals] [Diretrizes] [Governo] [Educação]       │
│              [Pesquisa]  [Global]    [🇧🇷 PT] [🇺🇸 EN]          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌── banner SSE (aparece quando há novas notícias) ──────────┐  │
│  │  ↑  3 novas notícias                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  [NEJM]  New England Journal of Medicine  · 14min       │    │
│  │  ─────────────────────────────────────── ● journal · en │    │
│  │  Efficacy of Novel GLP-1 Agonist in T2DM Management     │    │
│  │  A randomized controlled trial demonstrated significant  │    │
│  │  reduction in HbA1c...                                   │    │
│  │                                          [Ler artigo ↗]  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  [MS]  Ministério da Saúde              · 1h            │    │
│  │  ─────────────────────────────────────── ● governo · pt │    │
│  │  Novo protocolo de atenção primária para HAS             │    │
│  │  O Ministério publicou atualização nas diretrizes de     │    │
│  │  hipertensão arterial sistêmica...                       │    │
│  │                                          [Ler artigo ↗]  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│                    [ Carregar mais ]                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Anatomia do card

```
┌─────────────────────────────────────────────────────────────┐
│  [avatar]  Nome da fonte              · tempo relativo       │
│            ────────────────────── badge-categoria  badge-lang│
│                                                             │
│  Título da notícia (negrito, até 2 linhas)                  │
│                                                             │
│  Resumo/summary (cinza, até 3 linhas, com truncate)         │
│                                                             │
│                                         [Ler artigo ↗]     │
└─────────────────────────────────────────────────────────────┘
```

### Campos do card

| Campo visual | Campo da API | Observação |
|---|---|---|
| Avatar | `source` | Iniciais da fonte em círculo colorido por categoria |
| Nome da fonte | `source` | Ex: "NEJM", "Ministério da Saúde" |
| Tempo relativo | `publishedAt` | "14min", "2h", "3 dias" |
| Badge de categoria | `category` | Cor distinta por categoria |
| Badge de idioma | `language` | "PT" ou "EN" |
| Título | `title` | Negrito, truncar em 2 linhas |
| Resumo | `summary` | Cor secundária, truncar em 3 linhas |
| Link externo | `url` | Abre em nova aba |

### Cores por categoria (sugestão)

| `category` | Label | Cor do badge |
|---|---|---|
| `journal` | Revistas | `#6366f1` (roxo) |
| `guidelines` | Diretrizes | `#f59e0b` (âmbar) |
| `government` | Governo | `#3b82f6` (azul) |
| `education` | Educação | `#10b981` (verde) |
| `research` | Pesquisa | `#8b5cf6` (violeta) |
| `global` | Global | `#ef4444` (vermelho) |

---

## Fluxo de dados

```
Montagem do componente
        │
        ├─► GET /medical-news?limit=20&page=1
        │         └─► renderiza feed inicial
        │
        └─► EventSource /medical-news/stream
                  │
                  └─► onmessage: nova notícia chegou
                            │
                            ├─► pendingCount++
                            └─► guarda em pendingItems[]

Usuário clica no banner "N novas notícias"
        │
        ├─► prepend pendingItems ao topo do feed
        ├─► pendingCount = 0
        └─► scroll suave para o topo

Usuário clica "Carregar mais" (ou scroll atinge o fim)
        │
        └─► GET /medical-news?limit=20&page=N+1
                  └─► append ao feed existente
```

---

## Estado do componente

```ts
interface MedFeedState {
  items: MedicalNewsItem[];
  pendingItems: MedicalNewsItem[];
  page: number;
  totalPages: number;
  loading: boolean;
  loadingMore: boolean;
  activeCategory: NewsCategory | null;
  activeLanguage: NewsLanguage | null;
  sseConnected: boolean;
}
```

---

## Implementação React (esqueleto completo)

```tsx
import { useEffect, useRef, useState } from 'react';
import { api, getAuthToken } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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

const CATEGORY_META: Record<NewsCategory, { label: string; color: string }> = {
  journal:    { label: 'Revistas',   color: '#6366f1' },
  guidelines: { label: 'Diretrizes', color: '#f59e0b' },
  government: { label: 'Governo',    color: '#3b82f6' },
  education:  { label: 'Educação',   color: '#10b981' },
  research:   { label: 'Pesquisa',   color: '#8b5cf6' },
  global:     { label: 'Global',     color: '#ef4444' },
};

async function fetchNews(params: {
  page: number;
  category?: NewsCategory;
  language?: NewsLanguage;
}) {
  const q = new URLSearchParams({ page: String(params.page), limit: '20' });
  if (params.category) q.set('category', params.category);
  if (params.language) q.set('language', params.language);
  const res = await api.get(`/medical-news?${q}`);
  return res.data as { data: MedicalNewsItem[]; totalPages: number };
}

export function MedFeed() {
  const [items, setItems] = useState<MedicalNewsItem[]>([]);
  const [pendingItems, setPendingItems] = useState<MedicalNewsItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [category, setCategory] = useState<NewsCategory | null>(null);
  const [language, setLanguage] = useState<NewsLanguage | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  // Carrega feed inicial ou ao trocar filtro
  useEffect(() => {
    setLoading(true);
    setItems([]);
    setPendingItems([]);
    setPage(1);

    fetchNews({ page: 1, category: category ?? undefined, language: language ?? undefined })
      .then(({ data, totalPages }) => {
        setItems(data);
        setTotalPages(totalPages);
      })
      .finally(() => setLoading(false));
  }, [category, language]);

  // SSE — recebe novas notícias em tempo real
  useEffect(() => {
    const token = getAuthToken();
    const es = new EventSource(`/medical-news/stream?token=${token}`);
    sseRef.current = es;

    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);

    es.onmessage = (event) => {
      const news: MedicalNewsItem = JSON.parse(event.data);
      // Só adiciona ao pending se bater com o filtro ativo
      const matchCategory = !category || news.category === category;
      const matchLanguage = !language || news.language === language;
      if (matchCategory && matchLanguage) {
        setPendingItems((prev) => [news, ...prev]);
      }
    };

    return () => { es.close(); setSseConnected(false); };
  }, [category, language]);

  function showPendingItems() {
    setItems((prev) => [...pendingItems, ...prev]);
    setPendingItems([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadMore() {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const { data } = await fetchNews({ page: nextPage, category: category ?? undefined, language: language ?? undefined });
    setItems((prev) => [...prev, ...data]);
    setPage(nextPage);
    setLoadingMore(false);
  }

  return (
    <div className="feed-container">
      <FeedHeader sseConnected={sseConnected} />
      <FilterTabs activeCategory={category} activeLanguage={language} onCategory={setCategory} onLanguage={setLanguage} />

      {pendingItems.length > 0 && (
        <button className="pending-banner" onClick={showPendingItems}>
          ↑ {pendingItems.length} {pendingItems.length === 1 ? 'nova notícia' : 'novas notícias'}
        </button>
      )}

      {loading ? (
        <FeedSkeleton />
      ) : (
        <>
          {items.map((item) => <NewsCard key={item.id} item={item} />)}
          {page < totalPages && (
            <button className="load-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Carregando...' : 'Carregar mais'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function NewsCard({ item }: { item: MedicalNewsItem }) {
  const meta = CATEGORY_META[item.category];
  const timeAgo = formatDistanceToNow(new Date(item.publishedAt), {
    addSuffix: false,
    locale: item.language === 'pt' ? ptBR : undefined,
  });

  return (
    <article className="news-card">
      <div className="card-header">
        <SourceAvatar source={item.source} category={item.category} />
        <div className="card-meta">
          <span className="source-name">{item.source}</span>
          <span className="time-ago">· {timeAgo}</span>
        </div>
        <div className="badges">
          <span className="badge" style={{ backgroundColor: meta.color }}>{meta.label}</span>
          <span className="badge badge-lang">{item.language.toUpperCase()}</span>
        </div>
      </div>

      <h3 className="card-title">{item.title}</h3>
      {item.summary && <p className="card-summary">{item.summary}</p>}

      <div className="card-footer">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="read-link">
          Ler artigo ↗
        </a>
      </div>
    </article>
  );
}

function SourceAvatar({ source, category }: { source: string; category: NewsCategory }) {
  const initials = source.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const color = CATEGORY_META[category].color;
  return (
    <div className="source-avatar" style={{ backgroundColor: color }}>
      {initials}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="news-card skeleton">
          <div className="skeleton-line short" />
          <div className="skeleton-line" />
          <div className="skeleton-line medium" />
        </div>
      ))}
    </>
  );
}
```

---

## CSS (referência de classes)

```css
.feed-container {
  max-width: 600px;
  margin: 0 auto;
  padding: 0 16px;
}

.pending-banner {
  width: 100%;
  background: #1d9bf0;
  color: white;
  border: none;
  padding: 12px;
  border-radius: 9999px;
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 12px;
  transition: background 0.15s;
}

.news-card {
  border-bottom: 1px solid #2f3336;
  padding: 16px 0;
  animation: slideDown 0.25s ease;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.source-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.source-name { font-weight: 700; font-size: 15px; }
.time-ago    { color: #71767b; font-size: 14px; }

.badges {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.badge {
  font-size: 11px;
  font-weight: 600;
  color: white;
  padding: 2px 8px;
  border-radius: 9999px;
}

.badge-lang {
  background: #2f3336;
  color: #e7e9ea;
}

.card-title {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
  margin: 0 0 6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-summary {
  font-size: 14px;
  color: #71767b;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0 0 10px;
}

.card-footer {
  display: flex;
  justify-content: flex-end;
}

.read-link {
  font-size: 14px;
  color: #1d9bf0;
  text-decoration: none;
  font-weight: 500;
}

.read-link:hover { text-decoration: underline; }

.load-more {
  width: 100%;
  padding: 14px;
  background: transparent;
  border: 1px solid #2f3336;
  color: #1d9bf0;
  border-radius: 9999px;
  font-weight: 600;
  cursor: pointer;
  margin: 16px 0;
}

/* Skeleton */
.skeleton { pointer-events: none; }

.skeleton-line {
  height: 14px;
  background: #2f3336;
  border-radius: 4px;
  margin-bottom: 8px;
  animation: pulse 1.4s ease-in-out infinite;
}

.skeleton-line.short  { width: 40%; }
.skeleton-line.medium { width: 70%; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
```

---

## Indicador "ao vivo"

Exibir no header quando `sseConnected === true`:

```
[● ao vivo]   ← verde pulsante quando conectado
[○ offline]   ← cinza quando desconectado
```

```tsx
function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <span className={`live-dot ${connected ? 'live' : 'offline'}`}>
      {connected ? '● ao vivo' : '○ offline'}
    </span>
  );
}
```

```css
.live-dot        { font-size: 12px; font-weight: 600; }
.live-dot.live   { color: #00ba7c; animation: livePulse 2s ease-in-out infinite; }
.live-dot.offline{ color: #71767b; }

@keyframes livePulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
}
```

---

## Autenticação no EventSource

O `EventSource` nativo **não suporta headers customizados**. Envie o token via query string e valide no backend:

```ts
const es = new EventSource(`/medical-news/stream?token=${getAuthToken()}`);
```

> Se o projeto usa cookies httpOnly para auth, o `EventSource` os envia automaticamente — sem necessidade de query string.

---

## Comportamento esperado por cenário

| Cenário | Comportamento |
|---------|---------------|
| Sem filtro ativo | Feed misto, todas as categorias e idiomas |
| Filtro `journal + en` | Apenas NEJM, Lancet, BMJ, etc. |
| Filtro `education` | EBSERH, ENARE, Residência, PubMed Educação |
| Nova notícia via SSE | Banner "N novas notícias" aparece no topo |
| Clique no banner | Novidades inseridas no topo com animação, scroll sobe |
| Nova notícia não bate com filtro ativo | Ignorada, não entra no pending |
| Fim do feed | Botão "Carregar mais" busca próxima página |
| SSE desconectado | Indicador "offline", reconecta automaticamente |

---

## Checklist de implementação

- [ ] Componente `MedFeed` com estado de `items` e `pendingItems`
- [ ] Tabs de filtro por `category`
- [ ] Toggle de filtro por `language` (PT / EN / Todos)
- [ ] Conexão SSE via `EventSource` com token na query
- [ ] Banner "N novas notícias" clicável
- [ ] Animação `slideDown` nos cards novos
- [ ] Indicador "ao vivo" no header com estado SSE
- [ ] Skeleton de carregamento inicial
- [ ] Botão "Carregar mais" com paginação
- [ ] Avatar com iniciais + cor por categoria
- [ ] Badge de categoria com cor semântica
- [ ] Badge de idioma PT/EN
- [ ] Tempo relativo com `date-fns`
- [ ] Fechar `EventSource` no `unmount`
