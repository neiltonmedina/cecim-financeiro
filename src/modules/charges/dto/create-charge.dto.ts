import { IsDateString, IsInt, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class CreateChargeDto {
  @IsUUID()
  clientId: string;

  @IsString()
  description: string;

  /** Valor em centavos, para evitar problemas de arredondamento com ponto flutuante. */
  @IsInt()
  @IsPositive()
  amountCents: number;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsString()
  paymentLink?: string;

  @IsOptional()
  @IsString()
  externalRef?: string;
}
