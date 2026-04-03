# Frontend Update — Twitter Posts v4

Data: 2026-04-02  
Endpoints afetados: `POST /twitter-posts/generate`, `PATCH /twitter-posts/:id`

---

## O que mudou

### Novo campo `bodyFontSize` — tamanho da fonte do corpo do slide

O template de cada slide agora expõe o tamanho da fonte do texto principal como um campo configurável. O frontend pode enviar `bodyFontSize` tanto na criação quanto na edição de um post.

- **Default anterior:** `17px` (hardcoded)
- **Novo default:** `20px`
- **Tipo:** `number` (em pixels)
- **Quando alterado no `PATCH`:** todos os `slideHtmls` são regenerados automaticamente

---

## Campo no response

Todos os endpoints que retornam um `TwitterLikePost` agora incluem `bodyFontSize`:

```ts
interface TwitterLikePostResponse {
  id: string;
  mode: 'light' | 'dark';
  bodyFontSize: number;        // novo
  profileName: string;
  profileHandle: string;
  profileImageUrl: string;
  slides: string[];
  slideHtmls: string[];
  caption: string;
  sourceTranscript: string;
  sourceCaption: string;
  status: 'Rascunho' | 'Aprovado' | 'Publicado';
  generatedAt: string;
  createdAt: string;
}
```

---

## Criação — `POST /twitter-posts/generate`

Envie `bodyFontSize` junto com os demais campos. Se omitido, usa `20`.

```ts
const res = await fetch('/twitter-posts/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    accountId: 'abc123',
    productId: 'xyz456',
    sourcePostId: '...',
    mode: 'dark',
    bodyFontSize: 22,   // opcional, default 20
  }),
});

const post = await res.json();
// post.bodyFontSize === 22
```

---

## Edição — `PATCH /twitter-posts/:id`

Envie apenas `bodyFontSize` para alterar o tamanho da fonte sem mexer em mais nada. Os `slideHtmls` são regenerados no backend automaticamente.

```ts
await fetch(`/twitter-posts/${postId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ bodyFontSize: 18 }),
});
```

---

## Sugestão de controle de UI

Um slider ou input numérico simples com range sugerido entre `14` e `28`:

```
Tamanho do texto
  ─────●────────
  14           28
       [ 20 ]
```

Ao soltar o slider (evento `onBlur` ou `onChange` com debounce), disparar o `PATCH` e re-renderizar os slides com os novos `slideHtmls` retornados.

```ts
async function updateFontSize(postId: string, bodyFontSize: number) {
  const res = await fetch(`/twitter-posts/${postId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bodyFontSize }),
  });
  const updated = await res.json();
  setSlideHtmls(updated.slideHtmls);
}
```

---

## Checklist de atualização

- [ ] Adicionar `bodyFontSize` ao tipo/interface local de `TwitterLikePost`
- [ ] Renderizar o campo no estado do post ao buscar/criar
- [ ] Adicionar controle de UI (slider ou input) para ajustar o tamanho da fonte
- [ ] Ao alterar o valor, chamar `PATCH /twitter-posts/:id` com `{ bodyFontSize }`
- [ ] Atualizar os `slideHtmls` exibidos com o retorno da chamada
