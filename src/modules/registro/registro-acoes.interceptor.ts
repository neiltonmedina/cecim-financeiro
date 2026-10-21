import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

type Resumo = (req: any, res: any) => string | undefined;

const nomeCliente: Resumo = (req, res) => res?.client?.name ?? res?.name ?? req.body?.name;
const qtd = (campo: string, rotulo: string): Resumo => (req) => `${(req.body?.[campo] ?? []).length} ${rotulo}`;

/** Ações do painel que entram no registro (rota Express -> descrição). */
const ACOES: Record<string, [string, Resumo?]> = {
  'POST /clients': ['Cadastrou cliente', nomeCliente],
  'PATCH /clients/:id': ['Editou cliente', nomeCliente],
  'DELETE /clients/:id': ['Excluiu cliente'],
  'POST /charges': ['Criou cobrança', (req, res) => res?.description ?? req.body?.description],
  'POST /charges/bulk': ['Criou cobranças em lote', (req, res) => `${res?.criadas ?? ''} cobrança(s)`],
  'PATCH /charges/:id': ['Editou cobrança', nomeCliente],
  'PATCH /charges/:id/paid': ['Marcou cobrança como paga', nomeCliente],
  'PATCH /charges/:id/cancel': ['Cancelou cobrança', nomeCliente],
  'POST /charges/:id/gerar-boleto': ['Gerou boleto no Inter', nomeCliente],
  'POST /charges/dispatch': ['Disparou cobrança pelo WhatsApp', qtd('chargeIds', 'cobrança(s)')],
  'POST /charges/dispatch/agendar': ['Agendou disparo', (req) => `${(req.body?.chargeIds ?? []).length} cobrança(s) para ${new Date(req.body?.executarEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`],
  'DELETE /charges/dispatch/agendados/:id': ['Cancelou disparo agendado'],
  'POST /boletos/inter/importar': ['Importou boletos do Inter', (req, res) => `${res?.importadas ?? (req.body?.codigos ?? []).length} boleto(s)`],
  'POST /boletos/webhook/registrar': ['Ativou o aviso de pagamento do Inter'],
  'POST /lotes': ['Iniciou geração dos boletos do mês', (req) => `${req.body?.mes} · aviso ${req.body?.diasAntes} dia(s) antes · envio automático ${req.body?.envioAutomatico ? 'ligado' : 'desligado'}`],
  'POST /lotes/:id/gerar': ['Gerou boleto do mês', (req, res) => `${res?.cliente ?? req.body?.linha?.nome} · ${res?.status}`],
  'PATCH /lotes/:id': ['Alterou envio automático dos boletos do mês', (req) => (req.body?.envioAutomatico ? 'ligado' : 'desligado')],
  'POST /templates/:id/enviar-meta': ['Enviou modelo de mensagem para a Meta', (req, res) => res?.name],
  'PATCH /templates/:id': ['Editou modelo de mensagem', (req, res) => res?.name],
  'PATCH /conversations/:id/pause': ['Pausou conversa'],
  'PATCH /conversations/:id/resume-automation': ['Retomou conversa'],
  'POST /auth/change-password': ['Trocou a própria senha'],
  'POST /usuarios': ['Criou usuário', (req) => `${req.body?.name} (${req.body?.email})`],
  'PATCH /usuarios/:id': ['Alterou usuário', (req, res) =>
    [res?.name, req.body?.active === false ? 'desativado' : req.body?.active === true ? 'reativado' : '', req.body?.password ? 'senha redefinida' : '', req.body?.role ? 'perfil ' + req.body.role : '']
      .filter(Boolean).join(' · ')],
};

/** Grava quem fez cada ação do painel (só ações que deram certo, de usuário logado). */
@Injectable()
export class RegistroAcoesInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RegistroAcoesInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const acao = req?.route?.path && ACOES[`${req.method} ${req.route.path}`];
    if (!acao) return next.handle();
    return next.handle().pipe(
      tap((res) => {
        if (!req.user?.userId) return;
        let detalhe: string | undefined;
        try {
          detalhe = acao[1]?.(req, res) || undefined;
        } catch {
          detalhe = undefined;
        }
        this.prisma.registroAcao
          .create({ data: { userId: req.user.userId, userName: req.user.name ?? req.user.email, acao: acao[0], detalhe } })
          .catch((e) => this.logger.warn(`Falha ao gravar registro de ação: ${e.message}`));
      }),
    );
  }
}
