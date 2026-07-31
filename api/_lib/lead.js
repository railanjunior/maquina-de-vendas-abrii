/**
 * Validacao e normalizacao do payload de pre-cadastro.
 *
 * Regra de ouro: ser tolerante com o que chega (evento tem pressa, dedo grande
 * e teclado de celular) mas gravar sempre no mesmo formato.
 */

const MAX = { name: 120, email: 160, company: 120, role: 120, challenge: 600, instagram: 80, source: 40 };

const str = (value, limit) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[a-z0-9][a-z0-9-]{7,63}$/i;

/** Aceita a lista fixa de interesses; ignora qualquer coisa inventada. */
export const INTERESSES = [
  'grupo-evento',
  'automacao-ia',
  'trafego-pago',
  'maquina-de-vendas',
  'consultoria',
  'parceria',
];

/**
 * Normaliza telefone brasileiro para E.164 (55DDDNUMERO).
 * Retorna string vazia se nao houver digitos suficientes.
 */
export function normalizeWhatsapp(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (!digits) return '';
  // Remove o zero de operadora / zero inicial de DDD.
  if (digits.length > 11 && digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  // Numero nacional (10 = fixo/antigo, 11 = celular com 9) ganha DDI 55.
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 15) return '';
  return digits;
}

/** Formata para exibicao: +55 (11) 91234-5678 quando reconhecivel. */
export function formatWhatsapp(e164) {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(e164 || '');
  if (!m) return e164 ? `+${e164}` : '';
  return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
}

/**
 * @param {any} body payload cru vindo do formulario
 * @returns {{ok: true, lead: object} | {ok: false, errors: string[]}}
 */
export function parseLead(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['Corpo da requisicao invalido.'] };
  }

  // Honeypot: bot preenche, humano nunca ve.
  if (str(body.website, 100)) {
    return { ok: false, errors: ['Cadastro rejeitado.'] };
  }

  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : '';
  if (!id) errors.push('Identificador do cadastro ausente ou invalido.');

  const name = str(body.name, MAX.name);
  if (name.length < 2) errors.push('Informe seu nome.');

  const whatsapp = normalizeWhatsapp(body.whatsapp);
  if (!whatsapp) errors.push('Informe um WhatsApp valido com DDD.');

  const email = str(body.email, MAX.email).toLowerCase();
  if (email && !EMAIL_RE.test(email)) errors.push('E-mail invalido.');

  if (body.consentGroup !== true) {
    errors.push('E preciso aceitar o compartilhamento dos dados para concluir.');
  }

  if (errors.length) return { ok: false, errors };

  const interests = Array.isArray(body.interests)
    ? [...new Set(body.interests.filter((i) => INTERESSES.includes(i)))]
    : [];

  const instagram = str(body.instagram, MAX.instagram).replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/+$/, '');

  return {
    ok: true,
    lead: {
      id,
      name,
      whatsapp,
      whatsappDisplay: formatWhatsapp(whatsapp),
      email,
      company: str(body.company, MAX.company),
      role: str(body.role, MAX.role),
      instagram,
      interests,
      challenge: typeof body.challenge === 'string' ? body.challenge.trim().slice(0, MAX.challenge) : '',
      consentGroup: true,
      consentContact: body.consentContact === true,
      source: str(body.source, MAX.source) || 'direto',
      clientCreatedAt: typeof body.clientCreatedAt === 'string' ? body.clientCreatedAt.slice(0, 40) : '',
      createdAt: new Date().toISOString(),
    },
  };
}
