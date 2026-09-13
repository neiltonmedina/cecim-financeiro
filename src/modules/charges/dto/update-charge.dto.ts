import { IsDateString, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class UpdateChargeDto {
  @IsOptional()
  @IsString()
  description?: string;

  /** Valor em centavos. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  amountCents?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
