import { IsArray, IsBoolean, IsEmail, IsOptional, IsString, Matches } from 'class-validator';

export const TELEFONE_VALIDO = /^(\+55\d{10,11}|\+(?!55)[1-9]\d{7,14})$/;

export class CreateClientDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  // Brasil (+55): DDD + 8 ou 9 dígitos - barra número incompleto (ex: +55942122886).
  @Matches(TELEFONE_VALIDO, {
    message: 'Telefone inválido: use DDD + número com 8 ou 9 dígitos, ex: +5594991234567',
  })
  phoneE164?: string;

  // Outras pessoas da mesma empresa que também recebem as mensagens.
  @IsOptional()
  @IsArray()
  @Matches(TELEFONE_VALIDO, { each: true, message: 'Telefone extra inválido: use DDD + número com 8 ou 9 dígitos, ex: +5594991234567' })
  telefonesExtras?: string[];

  @IsOptional()
  @IsBoolean()
  whatsappOptIn?: boolean;

  @IsOptional()
  @IsBoolean()
  smsOptIn?: boolean;

  @IsOptional()
  @IsBoolean()
  emailOptIn?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  // Endereço - necessário para emissão de boleto no Inter (ele valida o CEP de verdade)
  @IsOptional()
  @IsString()
  cep?: string;

  @IsOptional()
  @IsString()
  endereco?: string;

  @IsOptional()
  @IsString()
  numero?: string;

  @IsOptional()
  @IsString()
  bairro?: string;

  @IsOptional()
  @IsString()
  cidade?: string;

  @IsOptional()
  @IsString()
  uf?: string;
}
