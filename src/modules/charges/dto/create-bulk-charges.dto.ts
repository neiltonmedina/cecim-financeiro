import { ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

/**
 * Cria a mesma cobrança para uma lista de clientes selecionados de uma vez
 * (ex: mensalidade do mês para os clientes escolhidos).
 */
export class CreateBulkChargesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  clientIds: string[];

  @IsString()
  description: string;

  @IsInt()
  @IsPositive()
  amountCents: number;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsString()
  paymentLinkBase?: string;
}
