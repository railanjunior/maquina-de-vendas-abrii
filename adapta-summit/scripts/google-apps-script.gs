/**
 * Espelho dos cadastros em uma planilha do Google (opcional, mas recomendado).
 *
 * Como usar
 * ---------
 *  1. Crie uma planilha nova em https://sheets.new
 *  2. Menu  Extensões > Apps Script
 *  3. Apague o conteúdo do editor e cole TUDO deste arquivo
 *  4. Troque o valor de SEGREDO por uma senha qualquer que você inventar
 *  5. Clique em  Implantar > Nova implantação
 *       - Tipo: Aplicativo da Web
 *       - Executar como: Eu
 *       - Quem pode acessar: Qualquer pessoa
 *  6. Copie a URL gerada e cadastre no Vercel:
 *       SHEETS_WEBHOOK_URL    = a URL copiada
 *       SHEETS_WEBHOOK_SECRET = o mesmo valor de SEGREDO
 *
 * A partir daí, cada pré-cadastro vira uma linha na planilha — em tempo real e
 * independente do banco. É a sua segunda cópia dos dados.
 */

var SEGREDO = 'troque-este-valor';

var COLUNAS = [
  'Recebido em', 'Nome', 'WhatsApp', 'E-mail', 'Empresa', 'Cargo', 'Instagram',
  'Interesses', 'Desafio', 'Quer grupo', 'Aceita contato', 'Origem', 'ID',
];

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (SEGREDO && payload.secret !== SEGREDO) {
      return resposta({ ok: false, error: 'segredo invalido' });
    }

    var lead = payload.lead || {};
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(COLUNAS);
      sheet.getRange(1, 1, 1, COLUNAS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    // Reenvio da fila offline traz o mesmo ID: atualiza a linha em vez de
    // duplicar o contato.
    var linhaExistente = acharLinhaPorId(sheet, lead.id);
    var valores = [
      new Date(),
      lead.name || '',
      "'" + (lead.whatsappDisplay || ('+' + lead.whatsapp)),
      lead.email || '',
      lead.company || '',
      lead.role || '',
      lead.instagram ? '@' + lead.instagram : '',
      (lead.interests || []).join(', '),
      lead.challenge || '',
      (lead.interests || []).indexOf('grupo-evento') >= 0 ? 'sim' : 'nao',
      lead.consentContact ? 'sim' : 'nao',
      lead.source || '',
      lead.id || '',
    ];

    if (linhaExistente > 0) {
      sheet.getRange(linhaExistente, 1, 1, valores.length).setValues([valores]);
    } else {
      sheet.appendRow(valores);
    }

    return resposta({ ok: true });
  } catch (err) {
    return resposta({ ok: false, error: String(err) });
  }
}

function doGet() {
  return resposta({ ok: true, info: 'webhook ativo' });
}

function acharLinhaPorId(sheet, id) {
  if (!id || sheet.getLastRow() < 2) return -1;
  var coluna = COLUNAS.indexOf('ID') + 1;
  var ids = sheet.getRange(2, coluna, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
