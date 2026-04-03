# Frontend Update — Twitter Posts v2

Data: 2026-04-02  
Endpoints afetados: `POST /twitter-posts/generate`, `PATCH /twitter-posts/:id`, `GET /twitter-posts`, `GET /twitter-posts/:id`

---

## O que mudou

### 1. Novo campo `caption`

O objeto `TwitterLikePost` agora inclui um campo `caption` — a legenda pronta para publicar no Instagram, com hashtags ao final.

### 2. Slides sem hashtags

Os textos dos slides não contêm mais hashtags. O conteúdo foi melhorado para trazer dados clínicos concretos (protocolos, estatísticas, doses) voltados para a persona de médicos residentes e estudantes de medicina.

### 3. Cantos e exportação corrigidos

- O HTML de cada slide é `560×560px` (1:1, formato quadrado do Instagram)
- Background uniforme — sem cantos brancos em modo escuro
- O avatar é embutido como **base64** no HTML — o download via `html2canvas` funciona sem erros de CORS

---

## Shape atualizado do `TwitterLikePost`

```ts
type TwitterLikePost = {
  id: string;
  mode: 'light' | 'dark';
  profileName: string;
  profileHandle: string;
  profileImageUrl: string;
  slides: string[];         // textos dos slides — sem hashtags
  slideHtmls: string[];     // HTML 560×560 auto-contido por slide
  caption: string;          // NOVO — legenda do Instagram com hashtags ao final
  sourceTranscript: string;
  sourceCaption: string;
  status: 'Rascunho' | 'Aprovado' | 'Publicado';
  generatedAt: string;
  createdAt: string;
};
```

---

## Exibir a legenda no editor

A legenda deve ser mostrada como campo editável abaixo do carrossel de slides:

```
┌─────────────────────────────────────────────┐
│  [Slide 2 / 5]  ◀  ▶                        │
│                                             │
│  ┌──────────────── card 560×560 ──────────┐ │
│  │  @augustocelho.medcof  ✓               │ │
│  │                                        │ │
│  │  A mortalidade por sepse cai 7%        │ │
│  │  a cada hora sem antibiótico...        │ │
│  │                                        │ │
│  │  272 Reposts · 1.7k Curtidas           │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  Legenda do post                            │
│  ┌─────────────────────────────────────┐   │
│  │ Você conhece o bundle de sepse?     │   │
│  │ A cada hora sem ATB, mortalidade    │   │
│  │ sobe 7%...                          │   │
│  │                                     │   │
│  │ #residenciamedica #medicina #UTI    │   │
│  └─────────────────────────────────────┘   │
│  [ Copiar legenda ]                         │
│                                             │
│  [ ↓ Baixar slide ]  [ ↓ Baixar todos ]    │
└─────────────────────────────────────────────┘
```

### Botão "Copiar legenda"

```ts
navigator.clipboard.writeText(post.caption);
```

---

## Editar a legenda

Use o mesmo `PATCH /twitter-posts/:id` existente, passando o campo `caption`:

```json
PATCH /twitter-posts/:id
{
  "caption": "Nova legenda editada pelo usuário...\n\n#residenciamedica #medicina"
}
```

Quando só `caption` ou `status` mudam, os `slideHtmls` **não são regenerados** (sem custo de processamento).

---

## Como exportar os slides como imagem

O HTML de cada `slideHtmls[i]` é `560×560px` auto-contido (avatar em base64, sem dependências externas). Recomendamos renderizar em um `<div>` oculto e usar `html2canvas`:

```ts
import html2canvas from 'html2canvas';

async function downloadSlide(htmlString: string, filename: string) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;width:560px;height:560px;';
  wrapper.innerHTML = htmlString;
  document.body.appendChild(wrapper);

  const canvas = await html2canvas(wrapper, {
    width: 560,
    height: 560,
    scale: 2,           // 1120×1120px — alta resolução para Instagram
    useCORS: false,     // não necessário, avatar já é base64
    allowTaint: false,
  });

  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');

  document.body.removeChild(wrapper);
}

// Uso:
downloadSlide(post.slideHtmls[currentIndex], `slide-${currentIndex + 1}.png`);
```

### Baixar todos os slides em sequência

```ts
async function downloadAll(post: TwitterLikePost) {
  for (let i = 0; i < post.slideHtmls.length; i++) {
    await downloadSlide(post.slideHtmls[i], `${post.profileHandle}-slide-${i + 1}.png`);
    await new Promise(r => setTimeout(r, 300)); // pequeno delay entre downloads
  }
}
```

---

## Renderizar no `<iframe>` (alternativa ao div oculto)

```tsx
<iframe
  srcDoc={post.slideHtmls[currentSlide]}
  style={{ width: 560, height: 560, border: 'none', display: 'block' }}
  sandbox="allow-same-origin"
  title={`Slide ${currentSlide + 1}`}
/>
```

Para exportar a partir do iframe, acesse `iframe.contentDocument.body` e passe para `html2canvas`.

---

## Checklist de atualização

- [ ] Adicionar `caption: string` ao tipo `TwitterLikePost`
- [ ] Exibir `caption` como textarea editável abaixo do carrossel
- [ ] Botão "Copiar legenda" (`navigator.clipboard.writeText`)
- [ ] `PATCH` com campo `caption` ao salvar edição da legenda
- [ ] Atualizar export: `html2canvas` com `scale: 2` para alta resolução
- [ ] Remover qualquer lógica que removia hashtags dos slides no frontend (o backend já faz isso)
