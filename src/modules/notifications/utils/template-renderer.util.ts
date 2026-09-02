import * as Handlebars from 'handlebars';
import { Charge, Client } from '@prisma/client';

export interface TemplateContext {
  cliente: string;
  valor: string;
  vencimento: string;
  linkPagamento: string;
  descricao: string;
}

export function formatCurrencyBRL(amountCents: number): string {
  return (amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDateBR(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(date);
}

export function buildTemplateContext(client: Client, charge: Charge, appUrl: string): TemplateContext {
  return {
    cliente: client.name,
    valor: formatCurrencyBRL(charge.amountCents),
    vencimento: formatDateBR(charge.dueDate),
    linkPagamento: charge.paymentLink ?? `${appUrl}/pagamentos/${charge.id}`,
    descricao: charge.description,
  };
}

const compiledCache = new Map<string, HandlebarsTemplateDelegate>();

/**
 * Renderiza um template com placeholders {{cliente}}, {{valor}}, {{vencimento}},
 * {{linkPagamento}} e {{descricao}}.
 */
export function renderTemplate(body: string, context: TemplateContext): string {
  let compiled = compiledCache.get(body);
  if (!compiled) {
    compiled = Handlebars.compile(body, { noEscape: true });
    compiledCache.set(body, compiled);
  }
  return compiled(context);
}
