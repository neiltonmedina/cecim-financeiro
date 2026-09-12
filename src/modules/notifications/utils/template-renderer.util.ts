import * as Handlebars from 'handlebars';
import { Charge, Client } from '@prisma/client';

export interface TemplateContext {
  cliente: string;
  valor: string;
  vencimento: string;
  linkPagamento: string;
  descricao: string;
  diasAtraso: number;
  pix: string;
  linhaDigitavel: string;
}

export function formatCurrencyBRL(amountCents: number): string {
  return (amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDateBR(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(date);
}

/** Dias corridos de atraso (0 se ainda não venceu). */
export function calcularDiasAtraso(dueDate: Date): number {
  return Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / (24 * 60 * 60 * 1000)));
}

export function buildTemplateContext(client: Client, charge: Charge, appUrl: string): TemplateContext {
  return {
    cliente: client.name,
    valor: formatCurrencyBRL(charge.amountCents),
    vencimento: formatDateBR(charge.dueDate),
    linkPagamento: charge.paymentLink ?? `${appUrl}/pagamentos/${charge.id}`,
    descricao: charge.description,
    diasAtraso: calcularDiasAtraso(charge.dueDate),
    pix: charge.pixCopiaECola ?? '',
    linhaDigitavel: charge.linhaDigitavel ?? '',
  };
}

const compiledCache = new Map<string, HandlebarsTemplateDelegate>();

/**
 * Renderiza um template com placeholders {{cliente}}, {{valor}}, {{vencimento}},
 * {{linkPagamento}}, {{descricao}}, {{diasAtraso}} e {{pix}}.
 */
export function renderTemplate(body: string, context: TemplateContext): string {
  let compiled = compiledCache.get(body);
  if (!compiled) {
    compiled = Handlebars.compile(body, { noEscape: true });
    compiledCache.set(body, compiled);
  }
  return compiled(context);
}
