# CECIM - Financeiro (Cobrança Multicanal: SMS, WhatsApp e E-mail)

Sistema completo para emitir cobranças e enviá-las automaticamente para
**clientes selecionados** por **SMS**, **WhatsApp** e **E-mail**, usando o
número de celular ("chip") novo contratado para a operação.

## Visão geral

- Cadastro de **clientes** (nome, telefone, e-mail, opt-in por canal).
- Cadastro/emissão de **cobranças** (individual ou em lote para vários
  clientes selecionados de uma vez).
- **Disparo multicanal**: ao emitir a cobrança, o sistema envia pelos canais
  habilitados para cada cliente — WhatsApp, SMS e E-mail — em paralelo.
- **Templates de mensagem** editáveis, com placeholders
  `{{cliente}}`, `{{valor}}`, `{{vencimento}}`, `{{linkPagamento}}`, `{{descricao}}`.
- **Fila de envio** (BullMQ + Redis) com retentativa automática (3 tentativas,
  backoff exponencial) caso um provedor falhe.
- **Lembretes automáticos** (cron diário): antes do vencimento, no dia, e
  cobrança automática X dias após vencer.
- **Webhooks de status de entrega**: WhatsApp (Meta) e SMS (Twilio)
  atualizam o status (enviado/entregue/lido/falhou) de cada notificação.
- **Agente de cobrança conversacional (WhatsApp + IA)**: quando o cliente
  responde, o sistema identifica a intenção (já pagou, vai negociar, quer
  falar com humano, etc.), responde em linguagem natural respeitando um tom
  profissional e as condições de negociação autorizadas, e **escala para um
  humano automaticamente** em situações sensíveis (veja seção própria abaixo).
- Autenticação via **JWT** para proteger a API.

## Controle operacional: o painel é a única interface (sem disparo automático não supervisionado)

A partir deste ajuste, **nenhum disparo acontece sem seleção manual e confirmação explícita no painel**. Resumo das regras:

1. **Seleção manual obrigatória**: o disparo (`POST /charges/dispatch`) só é aceito com `confirmado: true` no corpo da requisição - o painel exige que o operador selecione as cobranças (checkboxes) e clique em "Confirmar e disparar" antes de chamar esse endpoint. Sem isso, a API rejeita a chamada (`400 Bad Request`).
2. **Intervalo configurável**: ao confirmar a campanha, o operador escolhe o intervalo entre contatos da régua - **3, 5 ou 10 dias** (campo `intervalDays`). Esse valor fica salvo na conversa (`Conversation.intervalDays`) e é o que a rotina diária usa para decidir quando avançar pro próximo contato (lembrete → 3ª tentativa → encerramento). Não existe mais um intervalo fixo de 48h.
3. **Abordagem objetiva**: as mensagens agora informam os dias em atraso (`{{diasAtraso}}`) e oferecem duas opções fechadas - responder **1** para receber o Pix, ou **2** para o boleto atualizado. Essas duas respostas são tratadas de forma **determinística no backend** (sem IA) - o sistema apenas busca o Pix/link já prontos da cobrança e envia; qualquer outra mensagem do cliente (negociação, dúvidas, etc.) segue pro agente de IA normalmente.
4. **Valores sempre vêm do Inter, nunca calculados pela IA**: o boleto (com multa e juros já aplicados) e o Pix são obtidos da API do Banco Inter no momento da criação da cobrança. Nem o agente de IA nem nenhuma outra parte do sistema recalcula esses valores - eles só repassam o que o Inter já forneceu.
5. **Encerramento automático por pagamento**: um novo webhook (`POST /webhooks/inter/cobranca`) recebe a confirmação de pagamento do Inter e automaticamente marca a cobrança como **Paga** e encerra a régua/conversa daquele cliente - sem precisar de nenhuma ação manual. (⚠️ é necessário registrar essa URL de callback no Inter; o formato exato do payload deve ser validado nesse cadastro - o parser aceita as variações mais comuns de nome de campo).
6. **Painel como única interface de operação**: todo o controle - status das cobranças, histórico completo de mensagens, respostas dos clientes, pagamentos confirmados e **pausa manual** da régua de qualquer conversa - é feito exclusivamente pelo painel web (`/painel`). Não há (nem deve haver) operação paralela via WhatsApp Desktop/Web: o número de WhatsApp usado pela empresa é exclusivo da API oficial (Cloud API) que o sistema controla - conectar esse mesmo número num app/WhatsApp Web quebraria a automação (veja a seção de configuração do WhatsApp abaixo). A pausa manual (`PATCH /conversations/:id/pause`) permite ao operador congelar uma conversa específica a qualquer momento, direto pelo botão "Pausar automação" no histórico da conversa.

## Emissão automática de boleto (Banco Inter)

Se configurado, toda cobrança criada (`POST /charges` ou `/charges/bulk`)
já gera o boleto automaticamente via **API de Cobrança do Banco Inter**,
com multa e juros de mora aplicados conforme configuração, e o link de
pagamento (`paymentLink`) é preenchido sozinho com o link do PDF do boleto.

**Configuração necessária** (`.env`):
- `INTER_CLIENT_ID` / `INTER_CLIENT_SECRET` — gerados no Internet Banking
  Inter Empresas → API.
- `INTER_CERT_BASE64` / `INTER_KEY_BASE64` — conteúdo dos arquivos de
  certificado (`.crt`/`.key`, exigidos pelo Inter para mTLS) convertidos
  para base64, em uma linha só.
- `INTER_MULTA_PERCENTUAL` / `INTER_MORA_TAXA_MENSAL` — regras fixas de
  multa/juros aplicadas a todo boleto (0 = sem cobrança extra).

**Importante**: o Inter não devolve um link público pronto — o PDF é obtido
via chamada autenticada. Por isso o sistema baixa o PDF, guarda no banco, e
serve através de `GET /boletos/:chargeId` (rota pública, sem login — o ID
da cobrança já funciona como token de acesso). Esse é o link que vai nas
mensagens de WhatsApp/SMS/E-mail.

O CPF/CNPJ do cliente (`document` no cadastro) é obrigatório para gerar o
boleto — sem ele, a cobrança é criada normalmente mas sem boleto, e o erro
fica registrado em `boletoErro` (consultável em `GET /charges/:id`).

⚠️ **Teste primeiro no ambiente sandbox do Inter** antes de usar em produção.

## Agente de cobrança conversacional (WhatsApp)

Quando uma cobrança é disparada por WhatsApp, o sistema abre uma
**conversa** (`Conversation`) para aquele cliente. Toda resposta do cliente
chega pelo webhook (`POST /webhooks/whatsapp`) e é processada assim:

1. O sistema identifica o cliente pelo telefone e localiza a cobrança em aberto.
2. A mensagem é enviada para o **Claude** (Anthropic), com instruções fixas de
   tom (educado, profissional, sem ameaças) e as **condições de negociação
   autorizadas** (`NegotiationPolicy` no banco — desconto máximo, parcelas
   máximas). O agente nunca inventa valores fora dessas condições.
3. O agente classifica a intenção (`JA_PAGOU`, `VAI_PAGAR`, `QUER_NEGOCIAR`,
   `NAO_RECONHECE`, `QUER_HUMANO`, etc.) e gera a resposta.
4. Se a intenção exigir atenção humana (cliente pede humano, não reconhece a
   cobrança, ou algo fora do que o agente pode resolver com segurança), a
   conversa é marcada `AGUARDANDO_HUMANO`, a **automação para** naquela
   conversa, e um e-mail é enviado para `ESCALATION_EMAIL`.
5. Sem resposta do cliente, uma rotina diária avança o fluxo automaticamente:
   1ª mensagem → lembrete (48h depois) → 3ª tentativa oferecendo negociação
   (mais 48h) → encerra o fluxo automático (evita excesso de mensagens).

**Configuração necessária:**
- `ANTHROPIC_API_KEY` — chave da API da Anthropic (console.anthropic.com).
- `ESCALATION_EMAIL` — e-mail que recebe o aviso de encaminhamento humano.
- Ajuste a tabela `NegotiationPolicy` (via `/docs` ou diretamente no banco)
  com o desconto/parcelamento que sua empresa realmente autoriza.
- No app do WhatsApp na Meta, o webhook precisa estar inscrito também no
  campo **`messages`** (não só `message_status`), para receber as respostas
  dos clientes.

**Endpoints úteis:**
- `GET /conversations` — lista conversas (filtro `?humanRequested=true` para
  ver só as que precisam de atendimento humano).
- `GET /conversations/:id` — histórico completo de uma conversa.
- `GET /reports/cobranca?from=2026-09-01&to=2026-09-30` — relatório com
  clientes contatados, que responderam, acordos, pagamentos confirmados,
  pedidos de negociação, encaminhados para humano, sem resposta e valor
  recuperado.

**Teste com um grupo pequeno primeiro**: como `POST /charges/dispatch`
recebe uma lista de `chargeIds`, basta selecionar poucos clientes por vez
(ex: 3-5) para testar o fluxo do agente antes de disparar para toda a base.

## Arquitetura / stack

- **NestJS + TypeScript**
- **PostgreSQL** via **Prisma ORM**
- **Redis + BullMQ** para a fila de envio assíncrono
- **WhatsApp Business Cloud API (Meta)** — usa o número novo cadastrado
- **Twilio** para SMS — também usando o número novo
- **SMTP** genérico para e-mail (Gmail, hospedagem própria, etc.)

## Como configurar o novo número/chip

### 1. WhatsApp Business API (Meta)

1. Insira o chip novo em um aparelho e tenha o número em mãos (formato
   internacional, ex: `+5511999998888`).
2. Crie/acesse um app no [Meta for Developers](https://developers.facebook.com/)
   com o produto **WhatsApp** habilitado.
3. Em **WhatsApp > Configuração da API**, cadastre o número novo como
   número de exibição (você precisará verificar por SMS/ligação — use o
   próprio chip para receber o código).
4. Anote o `Phone Number ID` e o `WhatsApp Business Account ID`.
5. Gere um **token de acesso permanente** (usuário de sistema, com
   permissão `whatsapp_business_messaging`).
6. Crie e submeta para aprovação os **templates de mensagem** usados fora da
   janela de 24h (ex: `cobranca_cecim`, `lembrete_vencimento_cecim`,
   `cobranca_vencida_cecim`) — o texto sugerido está em `prisma/seed.ts`.
7. Preencha no `.env`: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`,
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_TEMPLATE_NAME`.
8. Configure o **webhook** apontando para
   `https://SEU_DOMINIO/webhooks/whatsapp`, usando o mesmo valor definido em
   `WHATSAPP_VERIFY_TOKEN`, e inscreva o campo `messages`.

### 2. SMS (Twilio) com o número novo

1. Se o chip novo for portado/registrado como número Twilio (ou você usar um
   número Twilio dedicado só para SMS), crie uma conta em
   [twilio.com](https://www.twilio.com/), compre/porte o número e habilite SMS.
2. Preencha `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_FROM_NUMBER`
   (o número novo, formato `+55DDDXXXXXXXX`).
3. Configure `TWILIO_STATUS_CALLBACK_URL` para
   `https://SEU_DOMINIO/webhooks/sms/twilio/status`, para receber
   confirmação de entrega.

### 3. E-mail (SMTP)

1. Use uma conta de e-mail dedicada para cobrança (ex: `cobranca@seudominio.com.br`)
   ou um App Password do Gmail.
2. Preencha `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
   `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` no `.env`.

## Como rodar localmente

```bash
cp .env.example .env
# edite o .env com as credenciais do WhatsApp, Twilio e SMTP

docker compose up -d postgres redis

npm install
npm run prisma:migrate      # cria as tabelas
npm run prisma:seed         # cria usuário admin + templates padrão + regras de lembrete

npm run start:dev
```

A API sobe em `http://localhost:3000`, com documentação Swagger em
`http://localhost:3000/docs`.

Login inicial (definido no seed / `.env`):
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`

## Fluxo de uso (emitir cobrança para clientes selecionados)

1. **Login**: `POST /auth/login` → retorna `accessToken`.
2. **Cadastrar clientes**: `POST /clients` (telefone em E.164 e e-mail).
3. **Emitir cobrança para os clientes selecionados** (em lote):

   ```http
   POST /charges/bulk
   {
     "clientIds": ["id-1", "id-2", "id-3"],
     "description": "Mensalidade - Setembro/2026",
     "amountCents": 15000,
     "dueDate": "2026-09-10"
   }
   ```

4. **Disparar o envio** pelos 3 canais (ou canais específicos) para as
   cobranças criadas:

   ```http
   POST /charges/dispatch
   {
     "chargeIds": ["charge-id-1", "charge-id-2"],
     "channels": ["WHATSAPP", "SMS", "EMAIL"]
   }
   ```

   O sistema verifica automaticamente, por cliente, quais canais estão
   disponíveis (telefone/e-mail cadastrados + opt-in) e envia apenas por
   esses.

5. Acompanhar o status de entrega em `GET /charges/:id`, que lista o
   histórico de `NotificationLog` (fila → enviado → entregue/lido/falhou)
   por canal.

Além do disparo manual, a rotina automática diária (08:00,
`America/Sao_Paulo`) envia lembretes 3 dias antes do vencimento, no dia do
vencimento, e cobranças de atraso 1 e 7 dias após vencer — configurável em
`ReminderRule` (tabela) ou via `prisma/seed.ts`.

## Estrutura do projeto

```
src/
  modules/
    auth/            # login JWT
    clients/          # cadastro de clientes selecionáveis
    templates/        # templates de mensagem por canal
    charges/           # emissão de cobranças + disparo multicanal
    notifications/      # fila (BullMQ), provedores (WhatsApp/SMS/Email), processor
    scheduler/            # lembretes automáticos (cron)
    webhooks/              # status de entrega (Meta e Twilio)
  prisma/               # PrismaService/Module
prisma/
  schema.prisma        # modelo de dados
  seed.ts               # admin + templates + regras padrão
```

## Testes

```bash
npm run test
```

## Segurança

- Nunca commitar o `.env` com tokens reais (já está no `.gitignore`).
- Troque `JWT_SECRET` e a senha do admin (`SEED_ADMIN_PASSWORD`) em produção.
- Valide o `WHATSAPP_VERIFY_TOKEN` e proteja os endpoints de webhook contra
  abuso (rate limiting/proxy reverso), pois são públicos por natureza.
