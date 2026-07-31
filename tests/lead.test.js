import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLead, normalizeWhatsapp, formatWhatsapp } from '../api/_lib/lead.js';

const base = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Joana Ribeiro',
  whatsapp: '(11) 98765-4321',
  consentGroup: true,
};

test('normaliza telefone brasileiro para E.164', () => {
  assert.equal(normalizeWhatsapp('(11) 98765-4321'), '5511987654321');
  assert.equal(normalizeWhatsapp('11987654321'), '5511987654321');
  assert.equal(normalizeWhatsapp('+55 11 98765 4321'), '5511987654321');
  assert.equal(normalizeWhatsapp('1132654321'), '551132654321', 'fixo de 10 digitos');
  assert.equal(normalizeWhatsapp('011987654321'), '5511987654321', 'zero de operadora');
});

test('rejeita telefone incompleto', () => {
  assert.equal(normalizeWhatsapp('123'), '');
  assert.equal(normalizeWhatsapp(''), '');
  assert.equal(normalizeWhatsapp('abc'), '');
});

test('formata telefone para exibicao', () => {
  assert.equal(formatWhatsapp('5511987654321'), '+55 (11) 98765-4321');
});

test('aceita um cadastro minimo valido', () => {
  const result = parseLead(base);
  assert.equal(result.ok, true);
  assert.equal(result.lead.whatsapp, '5511987654321');
  assert.equal(result.lead.name, 'Joana Ribeiro');
  assert.ok(result.lead.createdAt, 'carimba a data no servidor');
});

test('exige nome, telefone e consentimento', () => {
  const result = parseLead({ ...base, name: 'J', whatsapp: '99', consentGroup: false });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
});

test('exige um id valido para garantir idempotencia', () => {
  assert.equal(parseLead({ ...base, id: undefined }).ok, false);
  assert.equal(parseLead({ ...base, id: 'x' }).ok, false, 'id curto demais');
});

test('descarta interesses fora da lista conhecida', () => {
  const result = parseLead({ ...base, interests: ['grupo-evento', 'invadir-o-banco', 'grupo-evento'] });
  assert.deepEqual(result.lead.interests, ['grupo-evento'], 'filtra e remove duplicados');
});

test('normaliza email e instagram', () => {
  const result = parseLead({
    ...base,
    email: '  JOANA@Empresa.COM ',
    instagram: 'https://instagram.com/joanaribeiro/',
  });
  assert.equal(result.lead.email, 'joana@empresa.com');
  assert.equal(result.lead.instagram, 'joanaribeiro');
});

test('rejeita email malformado', () => {
  const result = parseLead({ ...base, email: 'nao-e-email' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /E-mail invalido/);
});

test('bloqueia robo que preenche o honeypot', () => {
  const result = parseLead({ ...base, website: 'http://spam.example' });
  assert.equal(result.ok, false);
});

test('trunca texto livre muito longo', () => {
  const result = parseLead({ ...base, challenge: 'x'.repeat(5000) });
  assert.equal(result.lead.challenge.length, 600);
});

test('consentimento comercial e opcional e nao vaza valor estranho', () => {
  assert.equal(parseLead(base).lead.consentContact, false);
  assert.equal(parseLead({ ...base, consentContact: 'sim' }).lead.consentContact, false);
  assert.equal(parseLead({ ...base, consentContact: true }).lead.consentContact, true);
});
