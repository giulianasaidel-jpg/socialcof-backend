# Twitter-like posts — Fonte: notícias de sites (MedicalNews)

**Endpoint:** `POST /twitter-posts/generate`  
**Autenticação:** `Authorization: Bearer <accessToken>`

---

## Objetivo

Permitir gerar um carrossel estilo Twitter/X a partir de uma **notícia já persistida** no backend. Essas notícias vêm de **sites externos** (revistas, governo, diretrizes, etc.): o conteúdo é coletado, normalizado em `MedicalNews` (título, resumo, URL, fonte, categoria, idioma) e aparece no feed `GET /medical-news`. O fluxo de geração usa esse texto como **fonte principal** para o GPT montar os slides e a legenda com hashtags.

---

## Campos no body

| Campo | Obrigatório | Tipo | Descrição |
|--------|-------------|------|-----------|
| `accountId` | sim | string | `externalId` da conta Instagram |
| `productId` | sim | string | `externalId` do produto |
| `sourceNewsId` | não* | string | `_id` MongoDB do documento `MedicalNews` |
| `newsId` | não* | string | Alias de `sourceNewsId` (mesmo efeito) |

\* Junto com `accountId` e `productId`, é necessário **pelo menos uma fonte de conteúdo** entre as aceitas pelo endpoint (`texts`, `sourcePostId`, `sourceNewsId`/`newsId`, TikTok, Story Instagram, `sourceTranscript`, `sourceCaption`). Para este fluxo, use `sourceNewsId` ou `newsId`.

Os demais campos (`mode`, `bodyFontSize`, `profileName`, `profileHandle`, `profileImageUrl`, `slideCount`, `tone`) seguem o mesmo contrato dos outros modos de `POST /twitter-posts/generate`.

---

## Como o backend monta o texto enviado ao GPT

1. Carrega `MedicalNews` pelo id informado.
2. Monta um texto-base a partir de **`summary`** e **`title`**:
   - Se existirem os dois: `"{title}\n\n{summary}"`.
   - Caso contrário: usa o que existir (`summary` ou `title`).
3. Se, após isso, o texto ainda estiver vazio mas houver **`url`**, usa a URL como último recurso.
4. **`sourceTranscript`** efetivo para geração: valor já enviado no body **ou** o texto montado no passo 2–3 (o body tem prioridade se você enviar `sourceTranscript` manualmente).
5. **`sourceCaption`** efetivo para contexto complementar no GPT: valor do body **ou**, por padrão, o **`title`** da notícia.

O prompt trata o transcript/resumo como **fonte principal** e a legenda/título como apoio, alinhado ao restante do gerador de slides.

---

## Resposta (`TwitterLikePost`)

Além dos campos usuais (`slides`, `slideHtmls`, `caption`, `bodyFontSize`, etc.), a resposta inclui:

| Campo | Tipo | Descrição |
|--------|------|-----------|
| `sourceNewsId` | `string \| null` | Id da notícia usada como origem; `null` se não veio de `MedicalNews` |
| `sourceTranscript` | string | Texto-base que foi usado na geração (após resolução) |
| `sourceCaption` | string | Legenda/título de contexto usado na geração (após resolução) |

**Observação:** o modelo `TwitterLikePost` **não** duplica `url`, `source` nem `category` da notícia. Para mostrar “Ler no site original” ou o nome da publicação, o frontend deve **guardar** esses dados do item retornado em `GET /medical-news` (`data[].url`, `data[].source`, …) no momento em que o usuário escolhe a notícia, usando `sourceNewsId` só como chave de correlação.

---

## Erros

| HTTP | Código / mensagem | Quando |
|------|-------------------|--------|
| 400 | `MedicalNews not found` | Id inválido ou notícia inexistente |
| 422 | `NO_SUMMARY` — *Notícia sem conteúdo. Descreva manualmente o conteúdo.* | Não há título/resumo/URL utilizável após a regra acima |
| 502 | Geração GPT falhou | Tratar como erro temporário / mensagem genérica |

---

## Exemplo de requisição

```json
{
  "accountId": "augustocelho.medcof",
  "productId": "medcof",
  "sourceNewsId": "67f2a1b2c3d4e5f678901234",
  "mode": "dark",
  "slideCount": 5,
  "tone": "educativo e direto"
}
```

Equivalente com alias:

```json
{
  "accountId": "augustocelho.medcof",
  "productId": "medcof",
  "newsId": "67f2a1b2c3d4e5f678901234"
}
```

---

## Fluxo sugerido na UI

1. Listar notícias com `GET /medical-news` (filtros opcionais de `category`, `language`, etc.).
2. Usuário escolhe um card → guardar localmente `id`, `url`, `source`, `title` para exibição e link externo.
3. Chamar `POST /twitter-posts/generate` com `sourceNewsId: id` (ou `newsId`).
4. Exibir slides/HTML e a `caption` gerada; manter botão “Artigo original” usando o `url` guardado no passo 2.

---

## Relação com o feed de notícias

As notícias exibidas no feed e as aceitas aqui são a **mesma coleção**. Novos itens podem chegar via job de coleta ou fluxos administrativos de fontes; o id usado na geração é sempre o `id` retornado pela API de listagem de notícias médicas.
