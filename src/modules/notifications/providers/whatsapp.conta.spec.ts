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
