# Conexão — captação de contatos em evento

App de pré-cadastro para eventos presenciais. A pessoa aponta a câmera para o
QR Code, preenche em ~30 segundos e o contato cai no seu painel. Feito para o
cenário real de evento: internet ruim, pressa e nenhuma tolerância a perder lead.

- **Formulário público** — `/`
- **Painel + QR Code + exportações** — `/admin`
- **Diagnóstico** — `/api/health`

---

## Como os dados são protegidos

Essa é a parte que importa. São **quatro camadas** independentes:

1. **Grava antes de enviar.** O cadastro é salvo no IndexedDB do celular de quem
   preencheu *antes* de qualquer chamada de rede. Se a conexão cair no meio do
   submit, o dado já existe.
2. **Reenvio automático.** A fila sobe sozinha quando a internet volta, quando o
   app é reaberto e via *Background Sync* do Service Worker — que funciona **mesmo
   com a aba fechada**.
3. **Escrita dupla no servidor.** Upstash Redis (fonte da verdade do painel) e
   Google Sheets (planilha legível) são gravados em paralelo e de forma
   independente. Um lead só é confirmado quando ao menos um dos dois aceitou.
4. **Saída de emergência.** Se nada subir, a tela final oferece enviar o cadastro
   pelo seu WhatsApp com os dados já preenchidos.

Ainda: cada cadastro carrega um `id` gerado no dispositivo, então **reenvio nunca
duplica** — sobrescreve o mesmo registro. E o painel guarda uma cópia local de
tudo que já leu, continuando utilizável (e exportável) offline.

---

## Publicar no Vercel

### 1. Importar o projeto

Em [vercel.com/new](https://vercel.com/new), importe este repositório.

> ⚠️ **Passo obrigatório:** em **Root Directory**, clique em *Edit* e selecione
> `adapta-summit`. Sem isso o Vercel publica a raiz do repositório e o app não sobe.

Framework Preset: **Other**. Não há build — é estático + funções serverless.

### 2. Criar o banco (2 minutos)

No projeto: aba **Storage → Create Database → Upstash for Redis** (tem plano
gratuito). O Vercel injeta as variáveis sozinho — não precisa copiar nada.

### 3. Configurar as variáveis

Em **Settings → Environment Variables**:

| Variável | Obrigatória | Para que serve |
|---|---|---|
| `ADMIN_PIN` | **sim** | Senha do painel `/admin`. Sem ela o painel fica bloqueado. |
| `EVENT_NAME` | não | Nome exibido no app. Padrão: `Adapta Summit`. |
| `WHATSAPP_GROUP_URL` | não | Link de convite do grupo. Vira botão na tela de sucesso. |
| `ORGANIZER_WHATSAPP` | não | Seu número (ex.: `5511999998888`). Usado na saída de emergência. |
| `SHEETS_WEBHOOK_URL` | não | Espelho em planilha — veja `scripts/google-apps-script.gs`. |
| `SHEETS_WEBHOOK_SECRET` | não | Senha combinada com o Apps Script. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | — | Injetadas pela integração do passo 2. |

Depois de mexer em variáveis, **faça um redeploy** para elas valerem.

### 4. Conferir

Abra `/api/health`. Ele responde exatamente o que ainda falta configurar.

---

## No dia do evento

1. Abra `/admin` no celular ou notebook e entre com o PIN.
2. **Modo totem** deixa o QR em tela cheia — bom para apoiar na mesa ou projetar.
   Dá também para baixar o PNG e imprimir/colar no crachá.
3. Os cadastros aparecem no painel na hora.
4. No fim: **Baixar agenda (.vcf)** → importe no celular. Todos viram contatos com
   o sufixo `[NomeDoEvento]`, ficando agrupados na agenda — daí o WhatsApp deixa
   adicionar todo mundo no grupo de uma vez.

Para trabalhar os leads depois: **.csv** abre direto no Excel/Sheets e o
**.json** é o backup completo.

### Atalho na tela de início

O app é uma PWA instalável. No Android aparece o banner "Instalar"; no iPhone,
`Compartilhar → Adicionar à Tela de Início`. O próprio app explica o passo a passo
no botão *Adicionar à tela de início*.

---

## Desenvolvimento local

```bash
cd adapta-summit
npm run dev     # http://localhost:3000  ·  PIN do painel: 1234
npm test        # testes de validação e normalização
```

O servidor local sobe um Redis REST **falso em memória**, então dá para testar o
fluxo inteiro sem criar conta em lugar nenhum. Os dados somem ao reiniciar.

---

## Estrutura

```
adapta-summit/
├── api/
│   ├── _lib/{config,http,lead,store}.js   configuração, auth, validação, persistência
│   ├── leads.js                           POST cadastro · GET lista · DELETE
│   ├── health.js                          diagnóstico de configuração
│   └── app-config.js                      dados públicos para o front
├── public/
│   ├── index.html · admin.html            formulário e painel
│   ├── sw.js · manifest.webmanifest       PWA + Background Sync
│   └── assets/
│       ├── queue-core.js                  fila offline (página + Service Worker)
│       ├── app.js · admin.js · app.css
│       └── qrcode.js                      gerador de QR (MIT, embutido)
├── scripts/
│   ├── dev-server.js                      servidor local com Redis falso
│   └── google-apps-script.gs              webhook da planilha
└── tests/
```

## Privacidade

O formulário só envia com consentimento explícito de contato e entrada no grupo;
o aceite de conteúdo comercial é separado e opcional. Os leads são visíveis
apenas com o `ADMIN_PIN` e o painel é marcado como `noindex`. Excluir um contato
no painel apaga o registro do banco.
