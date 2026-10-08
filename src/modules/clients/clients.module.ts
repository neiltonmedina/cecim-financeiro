import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { BoletoLeituraService } from './boleto-leitura.service';

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, BoletoLeituraService],
  exports: [ClientsService],
})
export class ClientsModule {}
