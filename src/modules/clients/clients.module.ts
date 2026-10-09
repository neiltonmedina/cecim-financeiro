import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { BoletoLeituraService } from './boleto-leitura.service';
import { CnpjConsultaService } from './cnpj-consulta.service';

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, BoletoLeituraService, CnpjConsultaService],
  exports: [ClientsService],
})
export class ClientsModule {}
