import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ErroInternoFilter } from './common/erro-interno.filter';
import helmet from 'helmet';

async function bootstrap() {
  // rawBody: necessário para conferir a assinatura da Meta no webhook do WhatsApp.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Cabeçalhos de segurança. CSP desligada: o painel usa scripts no próprio HTML.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  if (!process.env.JWT_SECRET) {
    // eslint-disable-next-line no-console
    console.warn('JWT_SECRET não definido: usando chave aleatória (logins expiram a cada reinício). Defina JWT_SECRET no Render.');
  }

  app.useGlobalFilters(new ErroInternoFilter(app.get(HttpAdapterHost).httpAdapter));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('CECIM - Financeiro | Cobrança Multicanal')
    .setDescription('API para emissão de cobranças por SMS, WhatsApp e E-mail para clientes selecionados')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Aplicação de cobrança rodando na porta ${port}. Documentação em /docs`);
}
bootstrap();
