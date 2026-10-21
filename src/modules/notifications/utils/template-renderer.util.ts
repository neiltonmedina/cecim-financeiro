import * as Handlebars from 'handlebars';
import { Charge, Client } from '@prisma/client';

export interface TemplateContext {
  cliente: string;
  valor: string;
  vencimento: string;
  vencimentoBoleto: string;
  linkPagamento: string;
  descricao: string;
  diasAtraso: number;
  pix: string;
  linhaDigitavel: string;
}

export function formatCurrencyBRL(amountCents: number): string {
  return (amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Datas de vencimento são "só o dia", gravadas como meia-noite UTC (ex: 15/10 ->
 * 2026-10-15T00:00Z). Formatar no fuso de São Paulo (UTC-3) voltava um dia
 * (14/10 21h) - por isso a formatação é em UTC.
 */
export function formatDateBR(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
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
    // Vencimento registrado no boleto do Inter (a segunda via muda essa data).
    vencimentoBoleto: formatDateBR(charge.boletoDataVencimento ?? charge.dueDate),
    linkPagamento: charge.paymentLink ?? `${appUrl}/pagamentos/${charge.id}`,
    descricao: charge.description,
    diasAtraso: calcularDiasAtraso(charge.dueDate),
    pix: charge.pixCopiaECola ?? '',
    linhaDigitavel: charge.linhaDigitavel ?? '',
  };
}

/** Variáveis que o painel permite usar nos modelos do WhatsApp (chave do contexto -> exemplo p/ a Meta). */
export const VARIAVEIS_MODELO: Record<string, string> = {
  cliente: 'Maria Silva',
  vencimentoBoleto: '15/10/2026',
  valor: 'R$ 150,00',
  linhaDigitavel: '07790001161206142039908513267545515860000015000',
  diasAtraso: '5',
  descricao: 'Mensalidade 10/2026',
};

/** Botões de resposta rápida de cada modelo de cobrança. */
export const BOTOES_COBRANCA: Record<string, string[]> = {
  BOLETO_DISPONIVEL: ['Pix', 'Boleto'],
  COBRANCA_PENDENTE: ['Pix Copia e Cola', 'Novo Boleto'],
  LEMBRETE_VENCIMENTO: ['Pix', 'Boleto'],
};

/** Rodapé (texto cinza acima dos botões) de cada modelo de cobrança. */
export const RODAPE_COBRANCA: Record<string, string> = {
  COBRANCA_PENDENTE: 'Caso o pagamento já tenha sido realizado, desconsidere.',
  LEMBRETE_VENCIMENTO: 'Caso o pagamento já tenha sido realizado, desconsidere.',
};

/** Payload de cada botão: identifica a ação e a cobrança exata (ex: "PIX:<id>"). */
export function payloadsDosBotoes(botoes: string[], chargeId: string): string[] {
  return botoes.map((b) => `${/pix/i.test(b) ? 'PIX' : 'BOLETO'}:${chargeId}`);
}

/** Valores dos {{1}}, {{2}}... do modelo, na ordem gravada em providerParams. */
export function parametrosDoModelo(providerParams: string[], context: TemplateContext): string[] {
  return providerParams.map((k) =>
    k === 'linhaDigitavel' ? context.linhaDigitavel || context.pix : String((context as any)[k] ?? ''),
  );
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
