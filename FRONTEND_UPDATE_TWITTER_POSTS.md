# Frontend Update — Twitter/X-style Carousel Posts

Base URL: `http://localhost:5003`  
Autenticação: `Authorization: Bearer <accessToken>` (igual aos demais endpoints).

---

## Visão geral

O backend agora gera posts no estilo Twitter/X — cada slide é um card HTML auto-contido, pronto para renderizar e exportar como imagem. Os posts ficam salvos na coleção `TwitterLikePosts`.

Dois modos de geração:
- **AI**: passa um post existente (ou transcript/legenda direto) → GPT gera os textos → backend monta o HTML
- **Manual**: passa os textos prontos → backend monta o HTML diretamente

---

## Shape do objeto `TwitterLikePost`

```ts
type TwitterLikePost = {
  id: string;
  mode: 'light' | 'dark';
  profileName: string;
  profileHandle: string;
  profileImageUrl: string;
  slides: string[];         // textos de cada slide (editáveis)
  slideHtmls: string[];     // HTML auto-contido de cada slide (regenerado ao editar)
  sourceTranscript: string; // transcript de origem (se gerado por AI)
  sourceCaption: string;    // legenda de origem (se gerado por AI)
  status: 'Rascunho' | 'Aprovado' | 'Publicado';
  generatedAt: string;
  createdAt: string;
};
```

`slides[i]` e `slideHtmls[i]` sempre têm o mesmo índice — alterar `slides[i]` via PATCH regenera `slideHtmls[i]`.

---

## Endpoints

### GET /twitter-posts

Lista todos os posts. Filtro opcional por conta.

```
GET /twitter-posts?accountId=augustocelho.medcof
```

---

### GET /twitter-posts/:id

Retorna um post pelo id.

---

### POST /twitter-posts/generate

Cria um novo post. Aceita dois modos no mesmo endpoint.

#### Modo 1 — AI a partir de um post existente

O backend busca o `transcript` e a legenda do post e chama o GPT para gerar os textos.

```json
{
  "accountId": "augustocelho.medcof",
  "productId": "medcof",
  "sourcePostId": "<_id do Post no MongoDB>",
  "mode": "dark",
  "profileName": "MedCof",
  "profileHandle": "augustocelho.medcof",
  "profileImageUrl": "https://bucket.s3.region.amazonaws.com/...",
  "slideCount": 5,
  "tone": "educativo e direto"
}
```

#### Modo 2 — AI a partir de transcript/legenda manual

```json
{
  "accountId": "augustocelho.medcof",
  "productId": "medcof",
  "sourceTranscript": "Hoje vou falar sobre as três principais mudanças...",
  "sourceCaption": "Tudo que você precisa saber sobre a prova de residência",
  "mode": "light",
  "profileName": "MedCof",
  "profileHandle": "augustocelho.medcof",
  "slideCount": 4,
  "tone": "urgente e impactante"
}
```

#### Modo 3 — Textos diretos (sem GPT)

```json
{
  "accountId": "augustocelho.medcof",
  "productId": "medcof",
  "texts": [
    "Você sabia que 80% dos aprovados estudam por blocos de 50 minutos?",
    "O segundo segredo é revisão espaçada — não releitura.",
    "Priorize as especialidades com maior peso na sua prova."
  ],
  "mode": "dark",
  "profileName": "MedCof",
  "profileHandle": "augustocelho.medcof"
}
```

#### Campos do body (referência completa)

| Campo | Obrigatório | Tipo | Descrição |
|---|---|---|---|
| `accountId` | sim | string | externalId da conta Instagram |
| `productId` | sim | string | externalId do produto |
| `texts` | não* | string[] | Textos prontos (pula o GPT) |
| `sourcePostId` | não* | string | `_id` de um Post para usar transcript/legenda |
| `sourceTranscript` | não* | string | Transcript direto |
| `sourceCaption` | não* | string | Legenda direta |
| `mode` | não | `'light'` \| `'dark'` | Padrão: `'dark'` |
| `profileName` | não | string | Nome exibido no card |
| `profileHandle` | não | string | Handle (@) exibido no card |
| `profileImageUrl` | não | string | URL do avatar |
| `slideCount` | não | number | Qtd de slides que o GPT deve gerar. Padrão: 5 |
| `tone` | não | string | Tom para o GPT. Ex: `"empático"`, `"urgente"` |

*Pelo menos um de `texts`, `sourcePostId`, `sourceTranscript` ou `sourceCaption` é obrigatório.

#### Resposta 201

```json
{
  "id": "6613abc...",
  "mode": "dark",
  "profileName": "MedCof",
  "profileHandle": "augustocelho.medcof",
  "profileImageUrl": "https://...",
  "slides": [
    "Você sabia que 80% dos aprovados estudam com método?",
    "O segundo segredo é revisão espaçada."
  ],
  "slideHtmls": [
    "<!DOCTYPE html><html>...</html>",
    "<!DOCTYPE html><html>...</html>"
  ],
  "status": "Rascunho",
  "generatedAt": "2026-04-02T18:00:00.000Z",
  "createdAt": "2026-04-02T18:00:00.000Z"
}
```

---

### PATCH /twitter-posts/:id

Edita o post. Quando qualquer campo visual é alterado (`slides`, `mode`, `profileName`, `profileHandle`, `profileImageUrl`), os `slideHtmls` são **regenerados automaticamente**.

#### Editar texto de slides

```json
{
  "slides": [
    "Novo texto do slide 1 editado pelo usuário",
    "Slide 2 mantido igual",
    "Slide 3 também editado"
  ]
}
```

#### Trocar modo claro/escuro

```json
{ "mode": "light" }
```

#### Atualizar perfil

```json
{
  "profileName": "MedCof Residência",
  "profileHandle": "medcof",
  "profileImageUrl": "https://nova-foto.jpg"
}
```

#### Atualizar status

```json
{ "status": "Aprovado" }
```

---

### DELETE /twitter-posts/:id

Remove o post.

---

## Como renderizar os slides no frontend

Cada item de `slideHtmls` é um documento HTML completo e auto-contido. Recomendamos renderizar em `<iframe>` para isolamento de estilos:

```tsx
<iframe
  srcDoc={post.slideHtmls[currentSlide]}
  style={{ width: 560, height: 320, border: 'none', borderRadius: 16 }}
  sandbox="allow-same-origin"
/>
```

Para **exportar como imagem**, use `html2canvas` apontando para o `<iframe>` ou para um `<div>` com `dangerouslySetInnerHTML`:

```tsx
import html2canvas from 'html2canvas';

async function downloadSlide(htmlString: string, filename: string) {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.innerHTML = htmlString;
  document.body.appendChild(container);

  const canvas = await html2canvas(container.querySelector('.card') as HTMLElement);
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
  document.body.removeChild(container);
}
```

---

## Sugestão de UI

### Página de criação

```
┌──────────────────────────────────────────────┐
│  Gerar Twitter Post                          │
│                                              │
│  Fonte:  ○ Post existente  ○ Texto livre     │
│  Modo:   ● Escuro  ○ Claro                   │
│  Slides: [5 ▼]   Tom: [educativo ▼]          │
│  Nome:   [MedCof]   Handle: [@augusto...]     │
│  Avatar: [URL ou upload]                     │
│                                              │
│              [Gerar com IA]                  │
└──────────────────────────────────────────────┘
```

### Editor de slides (após geração)

```
◀  [Slide 2 / 5]  ▶

┌─────────────────────────────────┐
│  𝕏  MedCof  @augusto...         │
│                                 │
│  Você sabia que 80% dos         │
│  aprovados estudam com método?  │
│                                 │
│  💬 0  🔁 0  ❤️ 0  📊 0        │
└─────────────────────────────────┘

[ Editar texto ]  [ ↓ Baixar slide ]  [ ↓ Baixar todos ]
```

O botão **"Editar texto"** abre um textarea com o `slides[i]` correspondente. Ao salvar, chama `PATCH /twitter-posts/:id` com o array `slides` completo (com a edição aplicada no índice correto). O backend retorna os `slideHtmls` atualizados.

---

## Checklist

- [ ] Tipo `TwitterLikePost` no frontend
- [ ] Formulário de criação com as 3 fontes possíveis
- [ ] Visualizador de slides com navegação (prev/next)
- [ ] Botão "Editar texto" com textarea inline
- [ ] Ao salvar edição: `PATCH` com array `slides` atualizado
- [ ] Botão "Baixar slide" (html2canvas)
- [ ] Botão "Baixar todos" (zip ou sequência)
- [ ] Seletor modo claro/escuro com preview ao vivo
