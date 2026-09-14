import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Página de política de privacidade pública, exigida pelo Meta for
 * Developers para publicar o app do WhatsApp Business em modo Live.
 */
@Controller()
export class LegalController {
  @Get('privacidade.html')
  privacidade(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(PRIVACY_HTML);
  }
}

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Política de Privacidade - CECIM Assessoria Contábil</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #222; line-height: 1.6; }
  h1 { color: #14285c; }
  h2 { color: #14285c; margin-top: 32px; }
  footer { margin-top: 48px; font-size: 13px; color: #666; }
</style>
</head>
<body>
  <h1>Política de Privacidade</h1>
  <p>Última atualização: 14 de setembro de 2026</p>

  <p>Esta Política de Privacidade descreve como a <strong>CECIM Assessoria Contábil</strong> ("nós", "nosso") coleta, usa e protege as
  informações pessoais de nossos clientes ao utilizar nosso sistema de cobrança e comunicação (incluindo mensagens via WhatsApp, SMS e e-mail).</p>

  <h2>1. Informações que coletamos</h2>
  <p>Coletamos dados fornecidos diretamente por nossos clientes, como nome, CPF/CNPJ, telefone, e-mail e endereço, para fins de emissão
  de cobranças (boletos e Pix) e comunicação sobre pagamentos.</p>

  <h2>2. Como usamos as informações</h2>
  <p>Utilizamos essas informações exclusivamente para:</p>
  <ul>
    <li>Emitir boletos e códigos Pix referentes aos serviços contratados;</li>
    <li>Enviar lembretes e notificações de cobrança por WhatsApp, SMS ou e-mail;</li>
    <li>Responder a solicitações dos clientes relacionadas às suas cobranças.</li>
  </ul>

  <h2>3. Compartilhamento de dados</h2>
  <p>Não compartilhamos, vendemos ou alugamos suas informações pessoais a terceiros, exceto quando necessário para processar pagamentos
  (ex.: instituições bancárias parceiras) ou quando exigido por lei.</p>

  <h2>4. Comunicação via WhatsApp</h2>
  <p>Utilizamos a API oficial do WhatsApp Business para enviar mensagens relacionadas a cobranças. O cliente pode, a qualquer momento,
  solicitar a interrupção dessas mensagens entrando em contato conosco.</p>

  <h2>5. Segurança</h2>
  <p>Adotamos medidas técnicas e administrativas para proteger os dados pessoais contra acessos não autorizados, perda ou alteração.</p>

  <h2>6. Seus direitos</h2>
  <p>Em conformidade com a Lei Geral de Proteção de Dados (LGPD), o titular dos dados pode solicitar a qualquer momento acesso, correção
  ou exclusão de suas informações pessoais.</p>

  <h2>7. Contato</h2>
  <p>Em caso de dúvidas sobre esta política, entre em contato pelo e-mail: <a href="mailto:cecimfiscal@gmail.com">cecimfiscal@gmail.com</a></p>

  <footer>
    <p>&copy; 2026 CECIM Assessoria Contábil. Todos os direitos reservados.</p>
  </footer>
</body>
</html>`;
