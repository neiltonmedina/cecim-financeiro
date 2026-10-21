import { ArrayMinSize, IsArray, IsDateString, IsInt, IsPositive, IsUUID } from 'class-validator';

export class AgendarDisparoDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  chargeIds: string[];

  /** Intervalo (dias) entre os contatos da régua, como no disparo imediato. */
  @IsInt()
  @IsPositive()
  intervalDays: number;

  /** Quando disparar (ISO 8601). */
  @IsDateString()
  executarEm: string;
}
