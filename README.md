# ValidaMed - Cobrança Multicanal (SMS, WhatsApp e E-mail)

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
- Autenticação via **JWT** para proteger a API.

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
   janela de 24h (ex: `cobranca_validamed`, `lembrete_vencimento_validamed`,
   `cobranca_vencida_validamed`) — o texto sugerido está em `prisma/seed.ts`.
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
