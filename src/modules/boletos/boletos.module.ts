import { Module } from '@nestjs/common';
import { BoletosController } from './boletos.controller';
import { BoletosService } from './boletos.service';
import { InterBoletoProvider } from './inter-boleto.provider';

@Module({
  controllers: [BoletosController],
  providers: [BoletosService, InterBoletoProvider],
  exports: [BoletosService],
})
export class BoletosModule {}
