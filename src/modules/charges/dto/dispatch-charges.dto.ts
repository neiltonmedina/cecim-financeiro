import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';
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
}
