export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    // Necessário para provedores gerenciados como Upstash, que exigem TLS.
    tls: process.env.REDIS_TLS === 'true',
  },
  whatsapp: {
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v20.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
    templateName: process.env.WHATSAPP_TEMPLATE_NAME ?? 'cobranca_cecim',
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'pt_BR',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    fromNumber: process.env.TWILIO_FROM_NUMBER ?? '',
    statusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL ?? '',
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    fromName: process.env.SMTP_FROM_NAME ?? 'Cobrança',
    fromEmail: process.env.SMTP_FROM_EMAIL ?? '',
  },
});
