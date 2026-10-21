import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RegistroAcoesInterceptor } from './registro-acoes.interceptor';
import { RegistroController } from './registro.controller';

@Module({
  controllers: [RegistroController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: RegistroAcoesInterceptor }],
})
export class RegistroModule {}
