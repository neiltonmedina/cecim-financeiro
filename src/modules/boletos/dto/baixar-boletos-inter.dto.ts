import { ArrayMaxSize, ArrayMinSize, IsArray, Matches } from 'class-validator';

export class BaixarBoletosInterDto {
  /** Códigos de solicitação do Inter (vão para a URL do banco: só caracteres seguros). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @Matches(/^[A-Za-z0-9-]{8,64}$/, { each: true, message: 'Código de boleto inválido.' })
  codigos: string[];
}
