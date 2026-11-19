import { WhatsAppProvider } from './whatsapp.provider';

const config = (valores: Record<string, string>) => ({ get: (k: string) => valores[k] }) as any;

describe('WhatsAppProvider.contaNaMeta - de quem é a conta do WhatsApp', () => {
  afterEach(() => jest.restoreAllMocks());

  it('traz o portfólio dono e os dados do número', async () => {
    const urls: string[] = [];
    jest.spyOn(global, 'fetch' as any).mockImplementation(async (url: any) => {
      urls.push(String(url));
      const dados = String(url).includes('/WABA1?')
        ? { id: 'WABA1', name: 'CECIM-Finanças', owner_business_info: { id: '999', name: 'CECIM Assessoria' } }
        : { display_phone_number: '+55 94 99999-0077', verified_name: 'CECIM', quality_rating: 'GREEN' };
      return { ok: true, json: async () => dados } as any;
    });
    const p = new WhatsAppProvider(config({ 'whatsapp.accessToken': 't', 'whatsapp.apiVersion': 'v20.0', 'whatsapp.businessAccountId': 'WABA1', 'whatsapp.phoneNumberId': 'PH1' }));
    const r: any = await p.contaNaMeta();
    expect(r.conta.dados.owner_business_info.name).toBe('CECIM Assessoria');
    expect(r.numero.dados.verified_name).toBe('CECIM');
    expect(urls.some((u) => u.startsWith('https://graph.facebook.com/v20.0/WABA1?fields=') && u.includes('owner_business_info'))).toBe(true);
  });

  it('sem permissão para a conta, ainda mostra o número (e o motivo do erro)', async () => {
    jest.spyOn(global, 'fetch' as any).mockImplementation(async (url: any) =>
      String(url).includes('/WABA1?')
        ? ({ ok: false, status: 403, json: async () => ({ error: { message: 'Missing permissions' } }) } as any)
        : ({ ok: true, json: async () => ({ display_phone_number: '+55 94 99999-0077' }) } as any));
    const p = new WhatsAppProvider(config({ 'whatsapp.accessToken': 't', 'whatsapp.apiVersion': 'v20.0', 'whatsapp.businessAccountId': 'WABA1', 'whatsapp.phoneNumberId': 'PH1' }));
    const r: any = await p.contaNaMeta();
    expect(r.conta.erro).toBe('Missing permissions');
    expect(r.numero.dados.display_phone_number).toBe('+55 94 99999-0077');
  });
});

describe('WhatsAppProvider - passos finais do número novo', () => {
  afterEach(() => jest.restoreAllMocks());
  const provider = () =>
    new WhatsAppProvider(config({ 'whatsapp.accessToken': 't', 'whatsapp.apiVersion': 'v20.0', 'whatsapp.businessAccountId': 'WABA1', 'whatsapp.phoneNumberId': 'PH1' }));

  it('registra o número na API com o PIN de 6 dígitos', async () => {
    const chamadas: any[] = [];
    jest.spyOn(global, 'fetch' as any).mockImplementation(async (url: any, init: any) => {
      chamadas.push({ url: String(url), init });
      return { ok: true, json: async () => ({ success: true }) } as any;
    });
    await provider().registrarNumero('123456');
    expect(chamadas[0].url).toBe('https://graph.facebook.com/v20.0/PH1/register');
    expect(chamadas[0].init.method).toBe('POST');
    expect(JSON.parse(chamadas[0].init.body)).toEqual({ messaging_product: 'whatsapp', pin: '123456' });
  });

  it('recusa PIN que não tem 6 números (sem chamar a Meta)', async () => {
    const fetch = jest.spyOn(global, 'fetch' as any);
    await expect(provider().registrarNumero('12a456')).rejects.toThrow('6 números');
    await expect(provider().registrarNumero('1234567')).rejects.toThrow('6 números');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('liga o recebimento na conta configurada no Render quando nenhuma é informada', async () => {
    const urls: string[] = [];
    jest.spyOn(global, 'fetch' as any).mockImplementation(async (url: any) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ success: true }) } as any;
    });
    await provider().subscribeApp('');
    expect(urls[0]).toBe('https://graph.facebook.com/v20.0/WABA1/subscribed_apps');
  });

  it('a consulta mostra se o app está inscrito para receber as respostas', async () => {
    jest.spyOn(global, 'fetch' as any).mockImplementation(async (url: any) => {
      const u = String(url);
      const dados = u.includes('subscribed_apps') ? { data: [{ whatsapp_business_api_data: { id: 'APP' } }] }
        : u.includes('/PH1?') ? { platform_type: 'CLOUD_API', name_status: 'APPROVED' } : { id: 'WABA1' };
      return { ok: true, json: async () => dados } as any;
    });
    const r: any = await provider().contaNaMeta();
    expect(r.inscricao.dados.data).toHaveLength(1);
    expect(r.numero.dados.platform_type).toBe('CLOUD_API');
  });
});
