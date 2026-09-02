import { PrismaClient, Channel, TemplateType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEFAULT_TEMPLATES: Array<{
  channel: Channel;
  type: TemplateType;
  name: string;
  subject?: string;
  body: string;
  providerTemplateName?: string;
}> = [
  {
    channel: Channel.WHATSAPP,
    type: TemplateType.COBRANCA_PENDENTE,
    name: 'WhatsApp - Cobrança pendente',
    body:
      'Olá {{cliente}}! Você tem uma cobrança de {{valor}} referente a "{{descricao}}", com vencimento em {{vencimento}}. ' +
      'Pague com facilidade pelo link: {{linkPagamento}}',
    providerTemplateName: 'cobranca_cecim',
  },
  {
    channel: Channel.WHATSAPP,
    type: TemplateType.LEMBRETE_VENCIMENTO,
    name: 'WhatsApp - Lembrete de vencimento',
    body:
      'Olá {{cliente}}, passando para lembrar que sua cobrança de {{valor}} ("{{descricao}}") vence em {{vencimento}}. ' +
      'Evite juros pagando agora: {{linkPagamento}}',
    providerTemplateName: 'lembrete_vencimento_cecim',
  },
  {
    channel: Channel.WHATSAPP,
    type: TemplateType.COBRANCA_VENCIDA,
    name: 'WhatsApp - Cobrança vencida',
    body:
      'Olá {{cliente}}, identificamos que a cobrança de {{valor}} ("{{descricao}}") venceu em {{vencimento}} e continua em aberto. ' +
      'Regularize agora: {{linkPagamento}}',
    providerTemplateName: 'cobranca_vencida_cecim',
  },
  {
    channel: Channel.SMS,
    type: TemplateType.COBRANCA_PENDENTE,
    name: 'SMS - Cobrança pendente',
    body: 'CECIM: cobranca de {{valor}} ref. {{descricao}}, vence {{vencimento}}. Pague: {{linkPagamento}}',
  },
  {
    channel: Channel.SMS,
    type: TemplateType.LEMBRETE_VENCIMENTO,
    name: 'SMS - Lembrete de vencimento',
    body: 'CECIM: lembrete - cobranca de {{valor}} vence {{vencimento}}. Pague: {{linkPagamento}}',
  },
  {
    channel: Channel.SMS,
    type: TemplateType.COBRANCA_VENCIDA,
    name: 'SMS - Cobrança vencida',
    body: 'CECIM: cobranca de {{valor}} venceu em {{vencimento}} e segue em aberto. Regularize: {{linkPagamento}}',
  },
  {
    channel: Channel.EMAIL,
    type: TemplateType.COBRANCA_PENDENTE,
    name: 'E-mail - Cobrança pendente',
    subject: 'Cobrança CECIM - {{descricao}}',
    body:
      '<p>Olá {{cliente}},</p>' +
      '<p>Você possui uma cobrança no valor de <strong>{{valor}}</strong> referente a <strong>{{descricao}}</strong>, ' +
      'com vencimento em <strong>{{vencimento}}</strong>.</p>' +
      '<p><a href="{{linkPagamento}}">Clique aqui para pagar</a></p>' +
      '<p>Qualquer dúvida, estamos à disposição.</p>',
  },
  {
    channel: Channel.EMAIL,
    type: TemplateType.LEMBRETE_VENCIMENTO,
    name: 'E-mail - Lembrete de vencimento',
    subject: 'Lembrete: cobrança vence em breve - {{descricao}}',
    body:
      '<p>Olá {{cliente}},</p>' +
      '<p>Passando para lembrar que sua cobrança de <strong>{{valor}}</strong> ({{descricao}}) vence em ' +
      '<strong>{{vencimento}}</strong>.</p>' +
      '<p><a href="{{linkPagamento}}">Pague agora</a> e evite juros.</p>',
  },
  {
    channel: Channel.EMAIL,
    type: TemplateType.COBRANCA_VENCIDA,
    name: 'E-mail - Cobrança vencida',
    subject: 'Cobrança em atraso - {{descricao}}',
    body:
      '<p>Olá {{cliente}},</p>' +
      '<p>Identificamos que sua cobrança de <strong>{{valor}}</strong> ({{descricao}}) venceu em ' +
      '<strong>{{vencimento}}</strong> e continua em aberto.</p>' +
      '<p><a href="{{linkPagamento}}">Regularize agora</a> para evitar maiores encargos.</p>',
  },
];

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@cecim.com.br';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'troque-esta-senha';

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: 'Administrador',
      email: adminEmail,
      passwordHash,
      role: 'ADMIN',
    },
  });
  console.log(`Usuário admin garantido: ${adminEmail}`);

  for (const tpl of DEFAULT_TEMPLATES) {
    await prisma.messageTemplate.upsert({
      where: { channel_type: { channel: tpl.channel, type: tpl.type } },
      update: {
        name: tpl.name,
        subject: tpl.subject,
        body: tpl.body,
        providerTemplateName: tpl.providerTemplateName,
      },
      create: tpl,
    });
  }
  console.log(`${DEFAULT_TEMPLATES.length} templates padrão garantidos.`);

  const reminderRules = [
    { name: 'Lembrete 3 dias antes do vencimento', offsetDays: -3, templateType: TemplateType.LEMBRETE_VENCIMENTO },
    { name: 'Lembrete no dia do vencimento', offsetDays: 0, templateType: TemplateType.LEMBRETE_VENCIMENTO },
    { name: 'Cobrança 1 dia após vencimento', offsetDays: 1, templateType: TemplateType.COBRANCA_VENCIDA },
    { name: 'Cobrança 7 dias após vencimento', offsetDays: 7, templateType: TemplateType.COBRANCA_VENCIDA },
  ];
  for (const rule of reminderRules) {
    const existing = await prisma.reminderRule.findFirst({ where: { name: rule.name } });
    if (!existing) {
      await prisma.reminderRule.create({ data: rule });
    }
  }
  console.log('Regras de lembrete padrão garantidas.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
