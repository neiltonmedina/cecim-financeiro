/** Todos os telefones que recebem as mensagens do cliente: o principal e os extras, sem repetir. */
export function telefonesDoCliente(client: { phoneE164?: string | null; telefonesExtras?: string[] | null }): string[] {
  return [...new Set([client.phoneE164, ...(client.telefonesExtras ?? [])].filter((t): t is string => !!t))];
}
