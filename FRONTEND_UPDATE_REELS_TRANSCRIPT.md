# Frontend Update — Reels: vídeo no S3 e transcrição (Whisper)

Base URL: `http://localhost:5003`  
Autenticação: `Authorization: Bearer <accessToken>` (igual aos demais endpoints).

---

## O que mudou

1. **`GET /posts`** (e qualquer resposta que use o mesmo shape de post) passou a expor dois campos novos para Reels e posts de vídeo processados.
2. **Novo endpoint manual** para baixar o vídeo, comprimir se necessário, enviar ao S3 e transcrever com Whisper.

---

## Novos campos na lista/detalhe de post

Cada item de post pode incluir:

| Campo | Tipo | Quando vem preenchido |
|---|---|---|
| `videoUrl` | `string \| null` | URL permanente do `.mp4` no S3, após o pipeline de Reels rodar com sucesso |
| `transcript` | `string \| null` | Texto da transcrição (Whisper, PT), após o pipeline rodar com sucesso |

Exemplo (trecho):

```json
{
  "id": "...",
  "format": "Reels",
  "title": "...",
  "thumbnailUrl": null,
  "postUrl": "https://www.instagram.com/reel/.../",
  "videoUrl": "https://<bucket>.s3.<region>.amazonaws.com/instagram/handle/123.mp4",
  "transcript": "Hoje vou falar sobre três dicas para a prova de residência...",
  "carouselImages": []
}
```

**Importante:** `thumbnailUrl` continua podendo ser `null` em Reels (limitação do CDN do Instagram). O frontend pode usar `videoUrl` com `<video poster={...}>` ou placeholder quando não houver miniatura.

---

## Novo endpoint: processar Reels manualmente

```
POST /instagram-accounts/:id/scrape/reels?limit=10
```

- `:id` é o **externalId** da conta (ex.: handle `medway.residenciamedica`).
- `limit` opcional: quantidade máxima de Reels a processar nesta chamada (padrão **10**, máximo **20**).
- Operação **pesada** (download, ffmpeg, Whisper, S3). Indicado para botão explícito (“Processar Reels / Transcrever”) com loading e feedback de erro.

**Resposta 200:**

```json
{
  "total": 3,
  "reels": [
    {
      "id": "instagram_media_id",
      "shortCode": "ABCxyz",
      "s3VideoUrl": "https://...amazonaws.com/.../handle/id.mp4",
      "transcript": "texto completo...",
      "status": "ok"
    },
    {
      "id": "...",
      "shortCode": "...",
      "status": "failed",
      "error": "HTTP 403 downloading video"
    }
  ]
}
```

**Erros comuns:** `502` com `message: "Reels scrape failed"` (falha geral Apify); itens individuais com `status: "failed"` e `error` descritivo.

Após sucesso, o post correspondente fica persistido/atualizado no MongoDB; o frontend pode **refazer `GET /posts`** (ou invalidar cache da lista) para ver `videoUrl` e `transcript`.

---

## Sugestões de UI

### Página da conta Instagram

- Botão **“Transcrever / baixar Reels”** → `POST .../scrape/reels?limit=10`.
- Durante a requisição: spinner + texto do tipo “Isso pode levar vários minutos”.
- Ao terminar: toast com resumo (`ok` vs `failed`) e refresh da lista de posts.

### Linha / modal de post com `format === "Reels"`

- Se `videoUrl`: player `<video controls src={videoUrl} />` (ou embed equivalente).
- Se `transcript`: seção colapsável ou aba **“Transcrição”** com texto selecionável (útil para cópia e análise).
- Se ainda não processado: `videoUrl` e `transcript` `null` → mensagem do tipo “Ainda não processado” + CTA para disparar o endpoint acima.

### Cron (backend)

Contas com `ingestEnabled: true` recebem processamento de Reels no job diário; reels que **já têm** `transcript` preenchido são **ignorados** para não repetir Whisper. O frontend não precisa mudar nada por causa do cron, só exibir os campos quando existirem.

---

## Tipagem TypeScript (referência)

```ts
type Post = {
  // ...campos existentes
  videoUrl: string | null;
  transcript: string | null;
  carouselImages: string[];
};
```

---

## Checklist rápido para o frontend

- [ ] Estender o tipo de `Post` com `videoUrl` e `transcript`.
- [ ] Tratar `null` em Reels (placeholder de vídeo / texto “sem transcrição”).
- [ ] Opcional: player de vídeo quando `videoUrl` estiver definido.
- [ ] Opcional: botão que chama `POST /instagram-accounts/:id/scrape/reels`.
- [ ] Após o POST, atualizar lista de posts ou detalhe do post.
