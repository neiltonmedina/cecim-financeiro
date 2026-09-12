import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { Channel, TemplateType } from '@prisma/client';

export class DispatchChargesDto {
  /** IDs das cobranças (clientes selecionados) que devem receber o disparo agora. */
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  chargeIds: string[];

  /** Canais desejados. Se omitido, usa todos os canais habilitados para cada cliente. */
  @IsOptional()
  @IsArray()
  @IsEnum(Channel, { each: true })
  channels?: Channel[];

  @IsOptional()
  @IsEnum(TemplateType)
  templateType?: TemplateType;

  /**
   * Intervalo (em dias) entre os contatos da régua de cobrança (lembrete,
   * 3ª tentativa, etc.), definido no painel antes de confirmar o disparo
   * da campanha. Valores permitidos: 5, 10 ou 15 dias.
   */
  @IsOptional()
  @IsIn([5, 10, 15])
  intervalDays?: number;

  /**
   * Confirmação explícita da campanha - o painel deve exigir essa marcação
   * antes de chamar o disparo. Sem isso, nada é enviado.
   */
  @IsBoolean()
  confirmado: boolean;
}
