# Frontend Update — Twitter Posts v3

Data: 2026-04-03  
Endpoints afetados: `POST /twitter-posts/generate`

---

## O que mudou

### 1. Transcript como fonte principal de geração

O backend agora **prioriza o transcript** do post de origem como base para gerar os slides. A legenda original do post passa a ser apenas complementar.

### 2. Novo retorno `NO_TRANSCRIPT` (HTTP 422)

Quando `sourcePostId` é informado e o post de origem **não possui transcript**, o endpoint retorna `422` com o código `NO_TRANSCRIPT` em vez de tentar gerar com dados insuficientes.

---

## Novo fluxo de geração

```
Frontend envia POST /twitter-posts/generate com sourcePostId
         │
         ▼
   Post tem transcript?
   ├── SIM → geração normal, resposta 201 com o TwitterLikePost
   └── NÃO → resposta 422 { code: 'NO_TRANSCRIPT', message: '...' }
                  │
                  ▼
         Abrir modal de descrição manual
                  │
                  ▼
         Usuário descreve o conteúdo
                  │
                  ▼
         Reenviar com sourceTranscript preenchido
```

---

## Shape da resposta de erro

```ts
// HTTP 422
{
  code: 'NO_TRANSCRIPT';
  message: 'Post sem transcript. Descreva manualmente o conteúdo do post.';
}
```

---

## Tratamento no frontend

Ao chamar `POST /twitter-posts/generate`, intercepte o status `422` e verifique o `code`:

```ts
const res = await fetch('/twitter-posts/generate', {
  method: 'POST',
  body: JSON.stringify({ accountId, productId, sourcePostId, mode }),
});

if (res.status === 422) {
  const error = await res.json();
  if (error.code === 'NO_TRANSCRIPT') {
    openManualDescriptionModal({ sourcePostId });
    return;
  }
}

const post = await res.json();
```

---

## Modal de descrição manual

O modal deve coletar uma descrição textual do conteúdo do post. Ao confirmar, reenvie a request com o campo `sourceTranscript`:

```ts
async function generateWithManualDescription(params: {
  accountId: string;
  productId: string;
  sourcePostId: string;
  manualDescription: string;
  mode?: 'light' | 'dark';
}) {
  const res = await fetch('/twitter-posts/generate', {
    method: 'POST',
    body: JSON.stringify({
      accountId: params.accountId,
      productId: params.productId,
      sourcePostId: params.sourcePostId,
      sourceTranscript: params.manualDescription,
      mode: params.mode ?? 'dark',
    }),
  });

  return res.json();
}
```

> `sourceTranscript` enviado manualmente tem precedência sobre o transcript (inexistente) do post de origem, então o fluxo segue normalmente.

---

## Sugestão de layout do modal

```
┌──────────────────────────────────────────────┐
│  Descrição do conteúdo                       │
│                                              │
│  Este post não possui transcript automático. │
│  Descreva o conteúdo para gerarmos os slides.│
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ Ex: Neste vídeo falo sobre os        │   │
│  │ critérios diagnósticos de sepse,     │   │
│  │ bundle de 1 hora e manejo inicial... │   │
│  └──────────────────────────────────────┘   │
│                                              │
│         [ Cancelar ]  [ Gerar slides ]       │
└──────────────────────────────────────────────┘
```

---

## Checklist de atualização

- [ ] Interceptar status `422` com `code === 'NO_TRANSCRIPT'` no handler de geração
- [ ] Implementar modal de descrição manual
- [ ] Ao confirmar o modal, reenviar a request com `sourceTranscript` preenchido
- [ ] Não exibir mensagem de erro genérica para o código `NO_TRANSCRIPT` — usar o modal no lugar
