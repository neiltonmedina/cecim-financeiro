import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';

/** Uma linha da planilha mensal, já com as colunas reconhecidas pelo painel (tudo como texto). */
export class LinhaPlanilhaDto {
  @IsOptional() @IsString() seuNumero?: string;
  @IsOptional() @IsString() nome?: string;
  @IsOptional() @IsString() documento?: string;
  @IsOptional() @IsString() valor?: string;
  @IsOptional() @IsString() dia?: string;
  @IsOptional() @IsString() cep?: string;
  @IsOptional() @IsString() logradouro?: string;
  @IsOptional() @IsString() numero?: string;
  @IsOptional() @IsString() bairro?: string;
  @IsOptional() @IsString() cidade?: string;
  @IsOptional() @IsString() uf?: string;
}

export class ConferirLoteDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mês inválido (use AAAA-MM).' })
  mes: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => LinhaPlanilhaDto)
  linhas: LinhaPlanilhaDto[];
}

export class CriarLoteDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mês inválido (use AAAA-MM).' })
  mes: string;

  @IsOptional() @IsString() nomeArquivo?: string;

  /** Aviso "boleto a vencer" quantos dias antes do vencimento (0 = no próprio dia). */
  @IsInt() @Min(0) @Max(30) diasAntes: number;

  @IsInt() @Min(1) @Max(60) intervalDays: number;

  @IsBoolean() envioAutomatico: boolean;
}

export class GerarLinhaDto {
  @ValidateNested()
  @Type(() => LinhaPlanilhaDto)
  linha: LinhaPlanilhaDto;
}

export class AtualizarLoteDto {
  @IsBoolean() envioAutomatico: boolean;
}
