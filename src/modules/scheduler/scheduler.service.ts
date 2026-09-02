import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TemplateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Todos os dias às 08:00 (America/Sao_Paulo), envia lembretes e cobranças automáticas. */
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: 'America/Sao_Paulo' })
  async runDailyReminders() {
    this.logger.log('Executando rotina diária de lembretes/cobranças automáticas...');
    await this.markOverdueCharges();

    const rules = await this.prisma.reminderRule.findMany({ where: { active: true } });
    for (const rule of rules) {
      await this.dispatchForRule(rule.offsetDays, rule.templateType);
    }
  }

  /** Marca como VENCIDA toda cobrança PENDENTE cujo vencimento já passou. */
  private async markOverdueCharges() {
    const today = startOfDay(new Date());
    const result = await this.prisma.charge.updateMany({
      where: { status: 'PENDENTE', dueDate: { lt: today } },
      data: { status: 'VENCIDA' },
    });
    if (result.count) {
      this.logger.log(`${result.count} cobrança(s) marcada(s) como VENCIDA.`);
    }
  }

  private async dispatchForRule(offsetDays: number, templateType: TemplateType) {
    const target = startOfDay(addDays(new Date(), offsetDays));
    const nextDay = addDays(target, 1);

    const charges = await this.prisma.charge.findMany({
      where: {
        status: { in: ['PENDENTE', 'VENCIDA'] },
        dueDate: { gte: target, lt: nextDay },
        client: { active: true },
      },
    });

    if (!charges.length) return;

    const chargeIds = charges.map((c) => c.id);
    this.logger.log(`Disparando ${templateType} (offset ${offsetDays}d) para ${chargeIds.length} cobrança(s).`);
    await this.notificationsService.dispatchCharges(chargeIds, { templateType });
  }
}
