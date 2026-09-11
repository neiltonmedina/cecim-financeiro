import { IsBoolean, IsEmail, IsOptional, IsString, Matches } from 'class-validator';

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
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phoneE164 deve estar no formato internacional, ex: +5511999998888',
  })
  phoneE164?: string;

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
