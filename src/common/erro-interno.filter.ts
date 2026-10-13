import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Erros inesperados (não-HTTP) viravam só "Internal server error" no painel,
 * sem pista do motivo. Agora o motivo vai na resposta e o stack completo no log.
 */
@Catch()
export class ErroInternoFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ErroInterno');

  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException || host.getType() !== 'http') {
      return super.catch(exception, host);
    }
    const err = exception as Error;
    const req = host.switchToHttp().getRequest();
    this.logger.error(`${req?.method} ${req?.url}: ${err?.message}`, err?.stack);
    const res = host.switchToHttp().getResponse();
    res.status(500).json({ statusCode: 500, message: `Erro interno: ${err?.message ?? String(exception)}` });
  }
}
