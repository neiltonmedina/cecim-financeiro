import { Controller, ForbiddenException, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { SchedulerService } from '../scheduler/scheduler.service';
import { DisparosAgendadosService } from '../charges/disparos-agendados.service';

/**
 * Gatilho externo da rotina diária (marcar vencidas + avançar a régua).
 *
 * Em hospedagens que "dormem" sem acesso (ex: plano gratuito do Render), o
 * agendamento interno das 08:00 não roda se o serviço estiver parado nesse
 * horário. Um agendador externo gratuito (ex: cron-job.org) chamando
 * POST /cron/rotina-diaria?token=<CRON_SECRET> uma vez por dia acorda o
 * serviço e executa a rotina. Rodar mais de uma vez no mesmo dia é seguro:
 * a régua só envia quando o intervalo configurado já passou.
 */
@ApiTags('cron')
@Controller('cron')
export class CronController {
  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerService,
    private readonly agendados: DisparosAgendadosService,
  ) {}

  /** Chamado a cada 10 min pelo cron-job.org: mantém o servidor acordado no plano grátis do Render. */
  @Get('ping')
  async ping() {
    // No plano grátis o servidor pode ter dormido na hora marcada: o ping também dispara o que ficou pendente.
    const disparos = await this.agendados.executarPendentes().catch(() => 0);
    return { ok: true, disparos };
  }

  @Post('rotina-diaria')
  @HttpCode(200)
  async rotinaDiaria(@Query('token') token?: string) {
    const secret = this.config.get<string>('cronSecret');
    if (!secret || !token || !this.tokenValido(token, secret)) {
      throw new ForbiddenException('Token inválido.');
    }
    await this.scheduler.runDailyReminders();
    return { ok: true };
  }

  private tokenValido(token: string, secret: string): boolean {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
