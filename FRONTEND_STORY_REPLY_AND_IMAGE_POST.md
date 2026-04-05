# Frontend Integration — Story Reply (Caixinha) & Image Post

Base URL: `http://localhost:5003` (dev) / production URL.

Todos os endpoints exigem `Authorization: Bearer <token>`, exceto onde indicado.

---

## 1. Story Reply (Caixinha de Perguntas)

Gera um par pergunta + resposta no estilo caixinha do Instagram Stories.

### 1.1 Generate — `POST /story-replies/generate`

**Request body:**

```json
{
  "accountId": "medcof",
  "productId": "residencia-medica",

  "sourcePostId": "663f...",
  "sourceNewsId": "663f...",
  "sourceTikTokPostId": "663f...",
  "sourceInstagramStoryId": "663f...",
  "sourceTranscript": "texto livre",
  "sourceCaption": "título opcional",

  "question": "qual dose de ataque da amio na PCR mesmo?",
  "answer": "~150mg IV~ em 10 min, depois manutenção ~1mg/min~ por 6h",

  "mode": "dark",
  "font": "classic",
  "textColor": "#ffffff",
  "highlightColor": "#FF6B2B",
  "tone": "didático"
}
```

> Forneça pelo menos uma fonte (`sourceXxxId` ou `sourceTranscript`) **ou** preencha `question` + `answer` diretamente para pular a geração via GPT.

**Fontes disponíveis (`font`):**

| Valor | Família |
|-------|---------|
| `classic` | Inter — padrão Instagram |
| `modern` | Playfair Display |
| `strong` | Oswald |
| `typewriter` | Courier Prime |
| `editor` | DM Serif Display |
| `poster` | Anton |
| `literature` | Lora |

**Destaques coloridos (`~til~`):**

Envolva termos com `~til~` no `answer` (e no `question`) para aplicar a cor `highlightColor`:

```
"answer": "dose: ~150mg IV~ em ~10 min~, manutenção ~1mg/min~ por 6h"
```

**Response `201`:**

```json
{
  "id": "663f...",
  "mode": "dark",
  "font": "classic",
  "textColor": "#ffffff",
  "highlightColor": "#FF6B2B",
  "question": "qual dose de ataque da amio na PCR mesmo?",
  "answer": "~150mg IV~ em 10 min...",
  "questionHtml": "<!DOCTYPE html>...",
  "answerHtml": "<!DOCTYPE html>...",
  "caption": "Manda sua dúvida na caixinha! 📩 #residenciamedica ...",
  "profileName": "MedCOF",
  "profileHandle": "medcof",
  "profileImageUrl": "https://...",
  "brandColors": ["#6C63FF"],
  "sourceTranscript": "...",
  "sourceCaption": "...",
  "sourcePostId": null,
  "sourceNewsId": null,
  "sourceTikTokPostId": null,
  "sourceInstagramStoryId": null,
  "status": "Rascunho",
  "generatedAt": "2026-04-04T...",
  "createdAt": "2026-04-04T..."
}
```

### 1.2 List — `GET /story-replies?accountId=medcof`

Retorna array com o mesmo shape acima.

### 1.3 Get one — `GET /story-replies/:id`

### 1.4 Update — `PATCH /story-replies/:id`

Campos editáveis (todos opcionais):

```json
{
  "question": "nova pergunta",
  "answer": "nova resposta com ~termo~",
  "mode": "light",
  "font": "literature",
  "textColor": "#f5f5f5",
  "highlightColor": "#FF6B2B",
  "status": "Aprovado"
}
```

Quando `question`, `answer`, `mode`, `font`, `textColor` ou `highlightColor` mudam, os HTMLs são regenerados automaticamente.

### 1.5 Delete — `DELETE /story-replies/:id`

Retorna `204 No Content`.

### 1.6 Export PNG — `GET /story-replies/:id/export/question` | `…/export/answer`

Retorna `image/png` (1080×1920, formato story 9:16).

### Renderização no frontend

```tsx
<iframe
  srcDoc={storyReply.questionHtml}
  style={{ width: 270, height: 480, border: 'none', transform: 'scale(0.25)', transformOrigin: 'top left' }}
/>
```

---

## 2. Image Post (Estático / Carrossel com Imagem de Fundo)

Gera posts do Instagram com foto de fundo real (Unsplash) e texto sobreposto no 1/3 inferior da imagem.

### Fluxo em duas fases

```
POST /image-posts/generate
  └─ overlayPhase: "preview"
     └─ overlayHtml = só a foto (sem texto)
          │
          ├─ usuário vê a foto, pode pedir outra
          │  POST /:id/slides/:index/alternate-backgrounds  →  lista de URLs
          │  PATCH /:id  { slides: [{ backgroundUrl, overlayText }] }
          │
          └─ usuário escolhe fonte e cores do band
             POST /:id/finalize-overlay  { overlayFont, bandStyle, bandColor, … }
               └─ overlayPhase: "final"
                  └─ overlayHtml = foto + band de texto no 1/3 inferior
```

Passe `"immediateFinal": true` no generate para pular a fase preview e gerar direto com texto+band.

---

### 2.1 Generate — `POST /image-posts/generate`

```json
{
  "accountId": "medcof",
  "productId": "residencia-medica",

  "backgroundUrls": ["https://..."],

  "sourcePostId": "663f...",
  "sourceNewsId": "663f...",
  "sourceTikTokPostId": "663f...",
  "sourceInstagramStoryId": "663f...",
  "sourceTranscript": "texto do conteúdo",
  "sourceCaption": "título",

  "manualTexts": ["**Amiodarona** na PCR: 150mg IV em 10 min"],

  "layout": "static",
  "mode": "dark",
  "bodyFontSize": 42,
  "slideCount": 3,
  "tone": "educativo",

  "immediateFinal": false,

  "overlayFont": "montserrat",
  "bandStyle": "solid",
  "bandColor": "#ffffff",
  "bandTextColor": "#111111",
  "overlayStrongColor": "#6C63FF"
}
```

**`backgroundUrls` é opcional.** Quando omitido, o backend busca fotos reais no Unsplash usando uma query derivada do conteúdo pelo GPT. Requer `UNSPLASH_ACCESS_KEY` no `.env`.

**Fontes disponíveis (`overlayFont`):**

| Valor | Família |
|-------|---------|
| `inter` | Inter (sans-serif) |
| `montserrat` | Montserrat (sans-serif) — **padrão** |
| `playfair` | Playfair Display (serif) |
| `dm-sans` | DM Sans (sans-serif) |
| `lora` | Lora (serif) |
| `oswald` | Oswald (condensed bold) |

**Band — faixa no 1/3 inferior do post:**

| Campo | Descrição | Padrão |
|-------|-----------|--------|
| `bandStyle` | `"solid"` → cor chapada (padrão); `"gradient"` → desvane da foto para a cor do band | `"solid"` |
| `bandColor` | Cor/fundo do band. Aceita `rgba()` para controlar opacidade | `"#ffffff"` |
| `bandTextColor` | Cor do texto e nome do perfil no band | `"#111111"` |
| `overlayStrongColor` | Cor do `**negrito**` no texto e borda do avatar | cor primária da conta |

```
┌──────────────────────────────────────────┐
│                                          │
│                                          │
│              foto de fundo               │  ~2/3 superiores
│                                          │
│                                          │
├──────── band (gradient ou solid) ────────┤
│                                          │
│  Texto do slide — **negrito** em cor     │  ~1/3 inferior (360 px)
│                                          │
│  [avatar]  Nome do perfil                │
└──────────────────────────────────────────┘
```

**Response `201`:**

```json
{
  "id": "663f...",
  "layout": "static",
  "mode": "dark",
  "bodyFontSize": 42,
  "overlayPhase": "preview",
  "imageSearchQuery": "cardiopulmonary resuscitation amiodarone medical",
  "overlayFont": "montserrat",
  "bandStyle": "solid",
  "bandColor": "#ffffff",
  "bandTextColor": "#111111",
  "overlayBodyColor": "",
  "overlayStrongColor": "",
  "slides": [
    {
      "backgroundUrl": "https://images.unsplash.com/photo-xxx",
      "overlayHtml": "<!DOCTYPE html>...",
      "overlayText": "**Amiodarona** na PCR: 150mg IV em 10 min"
    }
  ],
  "caption": "Legenda com #hashtags ...",
  "profileName": "MedCOF",
  "profileHandle": "medcof",
  "profileImageUrl": "https://...",
  "brandColors": ["#6C63FF"],
  "sourceTranscript": "...",
  "sourceCaption": "...",
  "sourcePostId": null,
  "sourceNewsId": null,
  "sourceTikTokPostId": null,
  "sourceInstagramStoryId": null,
  "status": "Rascunho",
  "generatedAt": "2026-04-05T...",
  "createdAt": "2026-04-05T..."
}
```

---

### 2.1-A Layout `panoramic`

Carrossel onde **uma única imagem larga se revela progressivamente**. Cada slide mostra uma fatia horizontal diferente da mesma foto.

```
Slide 1        Slide 2        Slide 3
┌──────────┐   ┌──────────┐   ┌──────────┐
│          │ → │          │ → │          │
│  foto 1  │   │  foto 2  │   │  foto 3  │
│          │   │          │   │          │
│─ band ───│   │─ band ───│   │─ band ───│
│ texto 1  │   │ texto 2  │   │ texto 3  │
│ [avatar] │   │ [avatar] │   │ [avatar] │
└──────────┘   └──────────┘   └──────────┘
 (esquerda)     (centro)       (direita)
```

```json
{
  "accountId": "medcof",
  "productId": "residencia-medica",
  "sourceNewsId": "663f...",
  "layout": "panoramic",
  "slideCount": 3,
  "mode": "dark"
}
```

- `backgroundUrls[0]` opcional. Se omitido, o backend busca uma imagem landscape no Unsplash.
- Todos os slides compartilham a mesma URL, mas o `overlayHtml` de cada um usa `background-position` diferente para panear a imagem.
- Recomendado: 3 a 5 slides.

---

### 2.2 List — `GET /image-posts?accountId=medcof`

### 2.3 Get one — `GET /image-posts/:id`

### 2.4 Update — `PATCH /image-posts/:id`

Todos os campos são opcionais:

```json
{
  "slides": [
    {
      "backgroundUrl": "https://nova-imagem.jpg",
      "overlayText": "Novo texto **editado**"
    }
  ],
  "mode": "light",
  "bodyFontSize": 36,
  "status": "Aprovado",
  "caption": "nova legenda",
  "overlayFont": "lora",
  "bandStyle": "solid",
  "bandColor": "rgba(15,23,42,0.88)",
  "bandTextColor": "#f1f5f9",
  "overlayStrongColor": "#6C63FF"
}
```

Quando `slides`, `mode`, `bodyFontSize`, `overlayFont`, `bandStyle`, `bandColor`, `bandTextColor` ou `overlayStrongColor` mudam, todos os `overlayHtml` são regenerados automaticamente.

- **Fase `preview`**: HTML fica só com a foto — band aplicado apenas no `finalize-overlay`.
- **Fase `final`**: qualquer campo editado reconstrói o HTML com o band atualizado imediatamente, sem precisar chamar `finalize-overlay` novamente.

---

### 2.5 Finalize overlay — `POST /image-posts/:id/finalize-overlay`

Aplica o band de texto sobre a imagem. Move o post para `overlayPhase: "final"`.

```json
{
  "overlayFont": "montserrat",
  "bandStyle": "solid",
  "bandColor": "#ffffff",
  "bandTextColor": "#111111",
  "overlayStrongColor": "#6C63FF"
}
```

Todos os campos são opcionais — usa os valores já salvos se omitidos.

---

### 2.6 Buscar imagens alternativas — `POST /image-posts/:id/slides/:index/alternate-backgrounds`

Retorna novas sugestões do Unsplash usando a mesma query da busca original.

**Request body (opcional):**

```json
{ "page": 2 }
```

**Response:**

```json
{
  "urls": [
    "https://images.unsplash.com/photo-aaa",
    "https://images.unsplash.com/photo-bbb"
  ],
  "query": "cardiopulmonary resuscitation medical",
  "page": 2,
  "slideIndex": 0
}
```

Após escolher uma URL, fazer `PATCH /image-posts/:id` com `slides` atualizados.

---

### 2.6-A Upload de imagem do computador — `POST /image-posts/:id/slides/:index/upload-background`

Faz upload de uma imagem local para S3 e atualiza o background do slide.

**Request:** `multipart/form-data`, campo `file` (jpeg, png, webp, gif — máx 10 MB).

**Response `200`:** O post completo atualizado, mais `backgroundUrl` e `slideIndex`.

O `overlayHtml` já é regenerado com a nova imagem. Se o post está em fase `preview`, o HTML fica só com a foto; se está em `final`, o band é reaplicado automaticamente.

> Requer `AWS_S3_BUCKET` configurado no `.env`.

---

### 2.7 Delete — `DELETE /image-posts/:id`

Retorna `204 No Content`.

---

### 2.8 Preview slide — `GET /image-posts/:id/slides/:index/preview`

Retorna o `overlayHtml` do slide como `text/html`.

> **Não requer autenticação** — pode ser usado como `src` de `<iframe>` diretamente.

```tsx
<iframe
  src={`${BASE_URL}/image-posts/${id}/slides/${index}/preview`}
  style={{ width: 540, height: 540, border: 'none' }}
/>
```

---

### 2.9 Export slide PNG — `GET /image-posts/:id/slides/:index/export`

`index` é 0-based. Retorna `image/png` (1080×1080).

### 2.10 Export todos os slides ZIP — `GET /image-posts/:id/export`

Retorna `application/zip` com `slide-1.png`, `slide-2.png`, etc.

---

### Renderização no frontend

`overlayHtml` é um HTML auto-contido de **1080×1080** px.

**Via `srcDoc` (HTML da resposta):**

```tsx
<iframe
  srcDoc={slide.overlayHtml}
  style={{
    width: 1080,
    height: 1080,
    border: 'none',
    transform: 'scale(0.5)',
    transformOrigin: 'top left',
  }}
/>
```

**Via endpoint público (sem token):**

```tsx
<iframe
  src={`${BASE_URL}/image-posts/${id}/slides/${index}/preview`}
  style={{ width: 540, height: 540, border: 'none' }}
/>
```

O campo `overlayText` contém o texto puro com markdown `**negrito**`. O frontend pode:
1. Exibir o `overlayHtml` como preview (iframe/srcDoc)
2. Deixar o usuário editar o `overlayText` num campo de texto
3. `PATCH` com os slides atualizados — o backend regenera os HTMLs automaticamente

---

## Padrões comuns

### Prioridade de fonte de conteúdo

Ambos os endpoints (`/story-replies/generate` e `/image-posts/generate`) resolvem o conteúdo nesta ordem:

1. `sourcePostId` → `post.transcript` + `post.title` + mídia
2. `sourceNewsId` → `news.summary` + `news.title` + `news.imageUrl`
3. `sourceTikTokPostId` → `tiktokPost.transcript` + `tiktokPost.title` + thumbnail
4. `sourceInstagramStoryId` → `story.transcript` + thumbnail
5. `sourceTranscript` / `sourceCaption` → texto manual direto

### Fluxo de status

`Rascunho` → `Aprovado` → `Publicado`

Atualizar via `PATCH /:id` com `{ "status": "Aprovado" }`.

### Códigos de erro

| HTTP | Code | Significado |
|------|------|-------------|
| 400 | — | Campos obrigatórios ausentes |
| 401 | — | Token ausente ou inválido |
| 403 | — | Sem permissão de admin |
| 404 | — | Recurso não encontrado |
| 422 | `NO_CONTENT` | Fonte sem transcript/texto para gerar |
| 502 | — | Falha na geração GPT ou busca de imagem |
| 503 | — | `UNSPLASH_ACCESS_KEY` não configurado |
