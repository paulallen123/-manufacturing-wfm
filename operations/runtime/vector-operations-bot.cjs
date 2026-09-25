'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = '/api/workforce/lifecycle/operations-bot';
const CONTRACT_VERSION = 'VECTOR_OPERATIONS_BOT_V1';
const PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_MESSAGE_BYTES = 8 * 1024;

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function compact(value, max = 240) { return String(value == null ? '' : value).trim().slice(0, max); }
function requestPath(req) { return String(req && req.url || '/').split('?')[0] || '/'; }

function cookieSessionToken(req) {
  const raw = String(req && req.headers && req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (item.startsWith('wfm_session=')) return item.slice('wfm_session='.length);
  }
  return '';
}

function writeJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
  return true;
}

async function readJson(req, max = MAX_MESSAGE_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > max) {
      const error = new Error('Request body too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value;
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

function normaliseLocale(value) {
  const raw = compact(value, 35).replace(/_/g, '-');
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(raw) ? raw : 'en-GB';
}

function language(locale) {
  return normaliseLocale(locale).split('-')[0].toLowerCase();
}

const COPY = Object.freeze({
  en: {
    supported: 'Yes. Vecta can do that.',
    unsupported: 'I cannot safely carry out that request with a proven Vecta action yet.',
    confirm: 'Would you like me to do this for you?',
    missingLeave: 'I can request leave for you. Tell me the date and the number of scheduled paid hours.',
    leavePlan: 'I can submit this leave request through your authenticated Vecta account and verify that it was saved.',
    timeReview: 'I can take you to the current Time Review evidence for your authorised scope.',
    agency: 'I can take you to Agency so you can work with the current authorised agency-worker view.',
    factory: 'I can take you to the live factory view for your authorised scope.',
    capabilities: 'Tell me the outcome you want. I will explain what Vecta can do and, where an authorised action exists, offer to do it for you.',
    completed: 'Done. Vecta completed the action and confirmed the saved result.',
    failed: 'The action did not complete, so Vecta has not reported it as done.',
    cancelled: 'No change was made.'
  },
  fr: {
    supported: 'Oui. Vecta peut le faire.',
    unsupported: 'Je ne peux pas encore exécuter cette demande en toute sécurité avec une action Vecta éprouvée.',
    confirm: 'Voulez-vous que je le fasse pour vous ?',
    missingLeave: 'Je peux demander ce congé pour vous. Indiquez-moi la date et le nombre d’heures payées prévues.',
    leavePlan: 'Je peux envoyer cette demande de congé via votre compte Vecta authentifié et vérifier qu’elle a bien été enregistrée.',
    timeReview: 'Je peux vous ouvrir les éléments Time Review correspondant à votre périmètre autorisé.',
    agency: 'Je peux vous ouvrir la vue Agence correspondant à votre périmètre autorisé.',
    factory: 'Je peux vous ouvrir la vue usine en direct correspondant à votre périmètre autorisé.',
    capabilities: 'Dites-moi le résultat souhaité. Je vous expliquerai ce que Vecta peut faire et, lorsqu’une action autorisée existe, je proposerai de la réaliser pour vous.',
    completed: 'Terminé. Vecta a exécuté l’action et confirmé le résultat enregistré.',
    failed: 'L’action n’a pas abouti ; Vecta ne la considère donc pas comme terminée.',
    cancelled: 'Aucune modification n’a été effectuée.'
  },
  de: {
    supported: 'Ja. Vecta kann das.',
    unsupported: 'Ich kann diese Anfrage noch nicht sicher mit einer nachgewiesenen Vecta-Aktion ausführen.',
    confirm: 'Soll ich das für Sie erledigen?',
    missingLeave: 'Ich kann Urlaub für Sie beantragen. Nennen Sie mir das Datum und die geplanten bezahlten Stunden.',
    leavePlan: 'Ich kann diesen Urlaubsantrag über Ihr authentifiziertes Vecta-Konto einreichen und prüfen, ob er gespeichert wurde.',
    timeReview: 'Ich kann die aktuelle Time-Review-Ansicht für Ihren berechtigten Bereich öffnen.',
    agency: 'Ich kann die Agenturansicht für Ihren berechtigten Bereich öffnen.',
    factory: 'Ich kann die Live-Fabrikansicht für Ihren berechtigten Bereich öffnen.',
    capabilities: 'Sagen Sie mir das gewünschte Ergebnis. Ich erkläre, was Vecta kann, und biete bei einer autorisierten Aktion an, sie für Sie auszuführen.',
    completed: 'Erledigt. Vecta hat die Aktion ausgeführt und das gespeicherte Ergebnis bestätigt.',
    failed: 'Die Aktion wurde nicht abgeschlossen und wird daher nicht als erledigt gemeldet.',
    cancelled: 'Es wurde nichts geändert.'
  },
  es: {
    supported: 'Sí. Vecta puede hacerlo.',
    unsupported: 'Todavía no puedo ejecutar esa solicitud de forma segura con una acción de Vecta demostrada.',
    confirm: '¿Quiere que lo haga por usted?',
    missingLeave: 'Puedo solicitar las vacaciones por usted. Dígame la fecha y el número de horas pagadas programadas.',
    leavePlan: 'Puedo enviar esta solicitud de vacaciones mediante su cuenta Vecta autenticada y comprobar que se haya guardado.',
    timeReview: 'Puedo abrir la evidencia actual de Time Review de su ámbito autorizado.',
    agency: 'Puedo abrir la vista de Agencia de su ámbito autorizado.',
    factory: 'Puedo abrir la vista de fábrica en directo de su ámbito autorizado.',
    capabilities: 'Dígame el resultado que quiere. Le explicaré qué puede hacer Vecta y, cuando exista una acción autorizada, me ofreceré a hacerla por usted.',
    completed: 'Hecho. Vecta completó la acción y confirmó el resultado guardado.',
    failed: 'La acción no se completó, por lo que Vecta no la ha marcado como realizada.',
    cancelled: 'No se realizó ningún cambio.'
  },
  it: {
    supported: 'Sì. Vecta può farlo.',
    unsupported: 'Non posso ancora eseguire questa richiesta in sicurezza con un’azione Vecta comprovata.',
    confirm: 'Vuoi che lo faccia per te?',
    missingLeave: 'Posso richiedere le ferie per te. Dimmi la data e il numero di ore retribuite previste.',
    leavePlan: 'Posso inviare questa richiesta di ferie tramite il tuo account Vecta autenticato e verificare che sia stata salvata.',
    timeReview: 'Posso aprire le evidenze Time Review del tuo ambito autorizzato.',
    agency: 'Posso aprire la vista Agenzia del tuo ambito autorizzato.',
    factory: 'Posso aprire la vista fabbrica in tempo reale del tuo ambito autorizzato.',
    capabilities: 'Dimmi il risultato che vuoi ottenere. Ti spiegherò cosa può fare Vecta e, quando esiste un’azione autorizzata, ti proporrò di eseguirla per te.',
    completed: 'Fatto. Vecta ha completato l’azione e confermato il risultato salvato.',
    failed: 'L’azione non è stata completata, quindi Vecta non l’ha segnalata come conclusa.',
    cancelled: 'Non è stata apportata alcuna modifica.'
  },
  pt: {
    supported: 'Sim. A Vecta pode fazer isso.',
    unsupported: 'Ainda não consigo executar esse pedido com segurança através de uma ação Vecta comprovada.',
    confirm: 'Quer que eu faça isso por si?',
    missingLeave: 'Posso pedir férias por si. Diga-me a data e o número de horas pagas previstas.',
    leavePlan: 'Posso enviar este pedido de férias através da sua conta Vecta autenticada e confirmar que ficou guardado.',
    timeReview: 'Posso abrir a evidência atual do Time Review dentro do seu âmbito autorizado.',
    agency: 'Posso abrir a vista de Agência dentro do seu âmbito autorizado.',
    factory: 'Posso abrir a vista da fábrica em direto dentro do seu âmbito autorizado.',
    capabilities: 'Diga-me o resultado que pretende. Explicarei o que a Vecta pode fazer e, quando existir uma ação autorizada, oferecerei executá-la por si.',
    completed: 'Concluído. A Vecta executou a ação e confirmou o resultado guardado.',
    failed: 'A ação não foi concluída, por isso a Vecta não a indicou como concluída.',
    cancelled: 'Nenhuma alteração foi efetuada.'
  },
  nl: {
    supported: 'Ja. Vecta kan dat.',
    unsupported: 'Ik kan dat verzoek nog niet veilig uitvoeren met een bewezen Vecta-actie.',
    confirm: 'Wilt u dat ik dit voor u doe?',
    missingLeave: 'Ik kan verlof voor u aanvragen. Geef de datum en het aantal geplande betaalde uren door.',
    leavePlan: 'Ik kan deze verlofaanvraag via uw geauthenticeerde Vecta-account indienen en controleren of deze is opgeslagen.',
    timeReview: 'Ik kan de huidige Time Review-bewijzen voor uw bevoegde scope openen.',
    agency: 'Ik kan de Agency-weergave voor uw bevoegde scope openen.',
    factory: 'Ik kan de live fabrieksweergave voor uw bevoegde scope openen.',
    capabilities: 'Vertel me het gewenste resultaat. Ik leg uit wat Vecta kan en bied aan het voor u uit te voeren wanneer er een geautoriseerde actie bestaat.',
    completed: 'Klaar. Vecta heeft de actie uitgevoerd en het opgeslagen resultaat bevestigd.',
    failed: 'De actie is niet voltooid en wordt daarom niet als gereed gemeld.',
    cancelled: 'Er is niets gewijzigd.'
  },
  pl: {
    supported: 'Tak. Vecta może to zrobić.',
    unsupported: 'Nie mogę jeszcze bezpiecznie wykonać tej prośby za pomocą sprawdzonej akcji Vecta.',
    confirm: 'Czy chcesz, żebym zrobił to za Ciebie?',
    missingLeave: 'Mogę złożyć wniosek urlopowy. Podaj datę i liczbę planowanych płatnych godzin.',
    leavePlan: 'Mogę wysłać ten wniosek urlopowy z uwierzytelnionego konta Vecta i sprawdzić, czy został zapisany.',
    timeReview: 'Mogę otworzyć aktualne dane Time Review w Twoim uprawnionym zakresie.',
    agency: 'Mogę otworzyć widok Agencji w Twoim uprawnionym zakresie.',
    factory: 'Mogę otworzyć widok fabryki na żywo w Twoim uprawnionym zakresie.',
    capabilities: 'Powiedz, jaki rezultat chcesz osiągnąć. Wyjaśnię, co potrafi Vecta, i zaproponuję wykonanie zadania, jeśli istnieje autoryzowana akcja.',
    completed: 'Gotowe. Vecta wykonała akcję i potwierdziła zapisany wynik.',
    failed: 'Akcja nie została ukończona, więc Vecta nie oznaczyła jej jako wykonanej.',
    cancelled: 'Nie wprowadzono żadnych zmian.'
  },
  ar: {
    supported: 'نعم. يمكن لـ Vecta القيام بذلك.',
    unsupported: 'لا أستطيع تنفيذ هذا الطلب بأمان حتى الآن من خلال إجراء Vecta مثبت.',
    confirm: 'هل تريدني أن أقوم بذلك نيابةً عنك؟',
    missingLeave: 'يمكنني تقديم طلب الإجازة نيابةً عنك. أخبرني بالتاريخ وعدد الساعات المدفوعة المجدولة.',
    leavePlan: 'يمكنني إرسال طلب الإجازة عبر حساب Vecta الموثق والتحقق من حفظه.',
    timeReview: 'يمكنني فتح أدلة Time Review الحالية ضمن نطاق صلاحياتك.',
    agency: 'يمكنني فتح عرض العمالة المؤقتة ضمن نطاق صلاحياتك.',
    factory: 'يمكنني فتح عرض المصنع المباشر ضمن نطاق صلاحياتك.',
    capabilities: 'أخبرني بالنتيجة التي تريدها. سأوضح ما يمكن لـ Vecta فعله، وعندما يتوفر إجراء مصرح به سأعرض تنفيذه نيابةً عنك.',
    completed: 'تم. أكملت Vecta الإجراء وتحققت من النتيجة المحفوظة.',
    failed: 'لم يكتمل الإجراء، لذلك لم تسجله Vecta على أنه منجز.',
    cancelled: 'لم يتم إجراء أي تغيير.'
  },
  zh: {
    supported: '可以。Vecta 可以做到。',
    unsupported: '我目前还不能通过已验证的 Vecta 操作安全地执行该请求。',
    confirm: '需要我替您完成吗？',
    missingLeave: '我可以替您提交休假申请。请告诉我日期和计划的带薪小时数。',
    leavePlan: '我可以通过您已登录的 Vecta 账户提交休假申请，并验证它是否已保存。',
    timeReview: '我可以打开您授权范围内的当前 Time Review 证据。',
    agency: '我可以打开您授权范围内的劳务/临时工视图。',
    factory: '我可以打开您授权范围内的实时工厂视图。',
    capabilities: '告诉我您想要的结果。我会说明 Vecta 能做什么；如存在已授权的操作，我会主动询问是否替您执行。',
    completed: '已完成。Vecta 已执行操作并确认保存结果。',
    failed: '操作未完成，因此 Vecta 不会将其报告为已完成。',
    cancelled: '未进行任何更改。'
  },
  ja: {
    supported: 'はい。Vectaで対応できます。',
    unsupported: 'その依頼を安全に実行できる実証済みのVectaアクションはまだありません。',
    confirm: '私が代わりに実行しましょうか？',
    missingLeave: '休暇申請を代わりに行えます。日付と予定されている有給時間数を教えてください。',
    leavePlan: '認証済みのVectaアカウントから休暇申請を送信し、保存されたことまで確認できます。',
    timeReview: '権限範囲内の現在のTime Review証拠を開けます。',
    agency: '権限範囲内の派遣労働者ビューを開けます。',
    factory: '権限範囲内のライブ工場ビューを開けます。',
    capabilities: '実現したい結果を伝えてください。Vectaでできることを説明し、承認済みの操作があれば代わりに実行することを提案します。',
    completed: '完了しました。Vectaが操作を実行し、保存結果を確認しました。',
    failed: '操作は完了していないため、Vectaは完了として報告しません。',
    cancelled: '変更は行われませんでした。'
  }
});

function copy(locale, key) {
  const set = COPY[language(locale)] || COPY.en;
  return set[key] || COPY.en[key] || '';
}

const CAPABILITIES = Object.freeze({
  'leave.request': Object.freeze({
    title: 'Request my leave',
    roles: Object.freeze(['employee']),
    execution: Object.freeze({ type: 'vector_workflow', operation: 'leaveRequest' }),
    consequence: 'Creates a pending employee leave request in the authenticated source workflow.',
    risk: 'medium',
    confirmationRequired: true
  }),
  'time_review.open': Object.freeze({
    title: 'Open Time Review',
    roles: Object.freeze(['manager']),
    execution: Object.freeze({ type: 'navigate', route: 'time-review' }),
    consequence: 'Opens current authorised Time Review evidence; it does not approve or alter records.',
    risk: 'low',
    confirmationRequired: true
  }),
  'agency.open': Object.freeze({
    title: 'Open Agency',
    roles: Object.freeze(['manager']),
    execution: Object.freeze({ type: 'navigate', route: 'temporary' }),
    consequence: 'Opens the current authorised agency-worker view; it does not create an assignment.',
    risk: 'low',
    confirmationRequired: true
  }),
  'factory.open': Object.freeze({
    title: 'Open live factory',
    roles: Object.freeze(['manager']),
    execution: Object.freeze({ type: 'navigate', route: 'readiness' }),
    consequence: 'Opens the current authorised live-factory view; it does not change production or staffing.',
    risk: 'low',
    confirmationRequired: true
  })
});

function roleClass(role) {
  return String(role || '').toLowerCase() === 'employee' ? 'employee' : 'manager';
}

function capabilityAllowed(capability, role) {
  const spec = CAPABILITIES[capability];
  return Boolean(spec && spec.roles.includes(roleClass(role)));
}

const LEAVE_WORDS = [
  'leave','holiday','vacation','time off','annual leave',
  'congé','conges','vacances','urlaub','ferien','vacaciones','permiso',
  'férias','ferias','ferie','congedo','verlof','vakantie','urlop','wakacje',
  'dovolená','dovolenka','semester','ledighet','ferie','loma','lomaa',
  'إجازة','اجازة','休假','请假','休暇','휴가','छुट्टी'
];
const REQUEST_WORDS = [
  'request','book','take','submit','ask for','want','need',
  'demande','demander','poser','prendre','beantragen','buchen','nehmen',
  'solicitar','pedir','tomar','richiedere','prendere','chiedere',
  'pedir','marcar','aanvragen','boeken','złożyć','poprosić',
  'طلب','أريد','申请','提交','申請','取りたい','신청','요청','चाहता','चाहती'
];

function includesAny(message, words) {
  const value = String(message || '').toLocaleLowerCase();
  return words.some(word => value.includes(String(word).toLocaleLowerCase()));
}

function parseDate(message) {
  const value = String(message || '');
  let match = value.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (match) {
    const iso = match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
    return Number.isFinite(Date.parse(iso + 'T00:00:00Z')) ? iso : null;
  }
  match = value.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
  if (!match) return null;
  const iso = match[3] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[1]).padStart(2, '0');
  return Number.isFinite(Date.parse(iso + 'T00:00:00Z')) ? iso : null;
}

function parseHours(message) {
  const value = String(message || '');
  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h)\b/i,
    /(\d+(?:[.,]\d+)?)\s*(?:heures?|stunden?|horas?|ore|uur|godzin(?:y)?|ساعات|小时|時間|시간|घंटे)/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const hours = Number(String(match[1]).replace(',', '.'));
    if (Number.isFinite(hours) && hours >= 0.5 && hours <= 12) return hours;
  }
  return null;
}

function looksLikeCapabilityQuestion(message) {
  const value = String(message || '').toLocaleLowerCase();
  return /\b(can|could|does|do you|what can|capabilit|peux|pouvez|kann|puede|puoi|pode|kan|czy|هل|可以|でき|할 수|क्या)\b/u.test(value);
}

function deterministicInterpret(message, locale, role) {
  const raw = compact(message, 2000);
  if (!raw) return Object.freeze({ kind: 'empty' });

  const leave = includesAny(raw, LEAVE_WORDS);
  const request = includesAny(raw, REQUEST_WORDS);
  const capabilityQuestion = looksLikeCapabilityQuestion(raw);
  if (leave && (request || capabilityQuestion)) {
    if (!capabilityAllowed('leave.request', role)) {
      return Object.freeze({ kind: 'unsupported', topic: 'leave.request' });
    }
    if (capabilityQuestion && !request) {
      return Object.freeze({ kind: 'capability', capability: 'leave.request' });
    }
    const date = parseDate(raw);
    const hours = parseHours(raw);
    if (!date || hours == null) {
      return Object.freeze({ kind: 'needs_parameters', capability: 'leave.request', missing: Object.freeze([
        ...(!date ? ['date'] : []),
        ...(hours == null ? ['hours'] : [])
      ]) });
    }
    return Object.freeze({ kind: 'action', capability: 'leave.request', args: Object.freeze({ date, hours }) });
  }

  if (/\b(time review|time-review|attendance review|timesheet|feuille de temps|zeiterfassung|registro de horas|cartellino|urenregistratie)\b/i.test(raw)) {
    return capabilityAllowed('time_review.open', role)
      ? Object.freeze({ kind: 'action', capability: 'time_review.open', args: Object.freeze({}) })
      : Object.freeze({ kind: 'unsupported', topic: 'time_review.open' });
  }

  if (/\b(agency|temporary workers?|temps?|agence|intérim|zeitarbeit|leiharbeit|trabajadores temporales|agenzia|interinali|uitzend|agencja)\b/i.test(raw)) {
    return capabilityAllowed('agency.open', role)
      ? Object.freeze({ kind: 'action', capability: 'agency.open', args: Object.freeze({}) })
      : Object.freeze({ kind: 'unsupported', topic: 'agency.open' });
  }

  if (/\b(factory|plant|production|shop floor|usine|fabrik|fábrica|fabbrica|fabriek|zakład|مصنع|工厂|工場|공장)\b/iu.test(raw)) {
    return capabilityAllowed('factory.open', role)
      ? Object.freeze({ kind: 'action', capability: 'factory.open', args: Object.freeze({}) })
      : Object.freeze({ kind: 'unsupported', topic: 'factory.open' });
  }

  if (capabilityQuestion) return Object.freeze({ kind: 'capabilities' });
  return Object.freeze({ kind: 'unsupported' });
}

function responseForInterpretation(result, locale) {
  if (result.kind === 'capabilities' || result.kind === 'empty') {
    return { answer: copy(locale, 'capabilities'), offerToAct: false };
  }
  if (result.kind === 'unsupported') {
    return { answer: copy(locale, 'unsupported'), offerToAct: false };
  }
  if (result.kind === 'needs_parameters') {
    return { answer: copy(locale, 'missingLeave'), offerToAct: false, missing: result.missing };
  }
  if (result.kind === 'capability') {
    return {
      answer: copy(locale, 'supported') + ' ' + copy(locale, 'leavePlan'),
      offerToAct: false
    };
  }
  if (result.kind === 'action') {
    const key = result.capability === 'leave.request'
      ? 'leavePlan'
      : result.capability === 'time_review.open'
        ? 'timeReview'
        : result.capability === 'agency.open'
          ? 'agency'
          : 'factory';
    return {
      answer: copy(locale, 'supported') + ' ' + copy(locale, key),
      offerToAct: true,
      confirmation: copy(locale, 'confirm')
    };
  }
  return { answer: copy(locale, 'unsupported'), offerToAct: false };
}

function publicCapability(key, spec) {
  return {
    key,
    title: spec.title,
    risk: spec.risk,
    confirmationRequired: spec.confirmationRequired,
    consequence: spec.consequence
  };
}

function createVectorOperationsBot(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  if (!dbPath) throw new Error('Vector Operations Bot requires WFM_DB.');
  const interpreter = typeof options.intentProvider === 'function' ? options.intentProvider : null;
  const db = new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS vector_operations_bot_plans(' +
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,actor_email TEXT NOT NULL,actor_role TEXT NOT NULL,' +
      'locale TEXT NOT NULL,capability TEXT NOT NULL,args_json TEXT NOT NULL,status TEXT NOT NULL,' +
      'created_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL,completed_at_ms INTEGER);' +
    'CREATE TABLE IF NOT EXISTS vector_operations_bot_audit(' +
      'id TEXT PRIMARY KEY,plan_id TEXT,tenant TEXT NOT NULL,actor_email TEXT NOT NULL,event TEXT NOT NULL,' +
      'detail_json TEXT NOT NULL,created_at TEXT NOT NULL);' +
    'CREATE TRIGGER IF NOT EXISTS no_vector_operations_bot_audit_update BEFORE UPDATE ON vector_operations_bot_audit ' +
      "BEGIN SELECT RAISE(ABORT,'Operations bot audit is append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_vector_operations_bot_audit_delete BEFORE DELETE ON vector_operations_bot_audit ' +
      "BEGIN SELECT RAISE(ABORT,'Operations bot audit is append only.'); END;"
  );

  const auth = db.prepare(
    'SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email ' +
    'WHERE s.token_hash=? AND s.expires>?'
  );
  const insertPlan = db.prepare(
    'INSERT INTO vector_operations_bot_plans(' +
      'id,tenant,actor_email,actor_role,locale,capability,args_json,status,created_at_ms,expires_at_ms' +
    ') VALUES(?,?,?,?,?,?,?,?,?,?)'
  );
  const getPlan = db.prepare('SELECT * FROM vector_operations_bot_plans WHERE id=?');
  const updateStatus = db.prepare(
    'UPDATE vector_operations_bot_plans SET status=?,completed_at_ms=? WHERE id=? AND status=?'
  );
  const insertAudit = db.prepare(
    'INSERT INTO vector_operations_bot_audit(id,plan_id,tenant,actor_email,event,detail_json,created_at) VALUES(?,?,?,?,?,?,?)'
  );

  function context(req) {
    const token = cookieSessionToken(req);
    return token ? auth.get(sha256(token), Date.now()) || null : null;
  }

  function requireUser(req, res) {
    const ctx = context(req);
    if (!ctx) {
      writeJson(res, 401, { error: 'Sign in is required.' });
      return null;
    }
    return ctx;
  }

  function audit(ctx, event, planId, detail) {
    insertAudit.run(
      randomUUID(),
      planId || null,
      String(ctx.tenant),
      String(ctx.email),
      compact(event, 80),
      JSON.stringify(detail && typeof detail === 'object' ? detail : {}),
      nowIso()
    );
  }

  function filteredCapabilities(ctx) {
    return Object.entries(CAPABILITIES)
      .filter(([key]) => capabilityAllowed(key, ctx.role))
      .map(([key, spec]) => publicCapability(key, spec));
  }

  async function interpret(message, locale, ctx) {
    if (interpreter) {
      try {
        const proposal = await interpreter(Object.freeze({
          message,
          locale,
          roleClass: roleClass(ctx.role),
          allowedCapabilities: Object.freeze(filteredCapabilities(ctx).map(item => item.key))
        }));
        if (proposal && proposal.kind === 'action' && capabilityAllowed(proposal.capability, ctx.role)) {
          const args = proposal.args && typeof proposal.args === 'object' && !Array.isArray(proposal.args)
            ? proposal.args
            : {};
          if (proposal.capability === 'leave.request') {
            const date = parseDate(args.date || message);
            const hours = Number(args.hours != null ? args.hours : parseHours(message));
            if (!date || !Number.isFinite(hours) || hours < 0.5 || hours > 12) {
              return deterministicInterpret(message, locale, ctx.role);
            }
            return Object.freeze({ kind: 'action', capability: proposal.capability, args: Object.freeze({ date, hours }) });
          }
          return Object.freeze({ kind: 'action', capability: proposal.capability, args: Object.freeze({}) });
        }
      } catch {
        // The deterministic path is the fail-closed fallback.
      }
    }
    return deterministicInterpret(message, locale, ctx.role);
  }

  async function plan(req, res, ctx) {
    const body = await readJson(req);
    const message = compact(body.message, 2000);
    const locale = normaliseLocale(body.locale);
    if (!message) return writeJson(res, 400, { error: 'message is required.' });

    const interpretation = await interpret(message, locale, ctx);
    const response = responseForInterpretation(interpretation, locale);

    if (interpretation.kind !== 'action' || !capabilityAllowed(interpretation.capability, ctx.role)) {
      audit(ctx, 'PLAN_NON_EXECUTABLE', null, {
        locale,
        result: interpretation.kind,
        capability: interpretation.capability || interpretation.topic || null
      });
      return writeJson(res, 200, {
        contractVersion: CONTRACT_VERSION,
        locale,
        supported: interpretation.kind !== 'unsupported',
        ...response
      });
    }

    const spec = CAPABILITIES[interpretation.capability];
    const planId = 'vop-' + randomUUID();
    const createdAt = Date.now();
    insertPlan.run(
      planId,
      String(ctx.tenant),
      String(ctx.email),
      String(ctx.role),
      locale,
      interpretation.capability,
      JSON.stringify(interpretation.args || {}),
      'PENDING_CONFIRMATION',
      createdAt,
      createdAt + PLAN_TTL_MS
    );
    audit(ctx, 'PLAN_CREATED', planId, {
      capability: interpretation.capability,
      risk: spec.risk,
      confirmationRequired: true
    });

    return writeJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      locale,
      supported: true,
      ...response,
      plan: {
        id: planId,
        capability: interpretation.capability,
        title: spec.title,
        risk: spec.risk,
        consequence: spec.consequence,
        args: interpretation.args,
        expiresAt: new Date(createdAt + PLAN_TTL_MS).toISOString()
      }
    });
  }

  function assertOwnedPlan(row, ctx) {
    return row &&
      String(row.tenant) === String(ctx.tenant) &&
      String(row.actor_email) === String(ctx.email) &&
      String(row.actor_role) === String(ctx.role);
  }

  async function execute(req, res, ctx) {
    const body = await readJson(req);
    const planId = compact(body.planId, 120);
    if (!planId || body.confirm !== true) {
      return writeJson(res, 400, { error: 'Explicit confirmation is required.' });
    }
    const row = getPlan.get(planId);
    if (!assertOwnedPlan(row, ctx)) return writeJson(res, 404, { error: 'Action plan not found.' });
    if (row.status !== 'PENDING_CONFIRMATION') return writeJson(res, 409, { error: 'This action plan is no longer pending confirmation.' });
    if (Date.now() > Number(row.expires_at_ms)) {
      updateStatus.run('EXPIRED', Date.now(), planId, 'PENDING_CONFIRMATION');
      audit(ctx, 'PLAN_EXPIRED', planId, {});
      return writeJson(res, 409, { error: 'This action plan expired. Ask Vecta again so it can re-check the current state.' });
    }
    if (!capabilityAllowed(row.capability, ctx.role)) {
      audit(ctx, 'AUTHORITY_RECHECK_FAILED', planId, { capability: row.capability });
      return writeJson(res, 403, { error: 'Your current authority does not allow this action.' });
    }
    const spec = CAPABILITIES[row.capability];
    const changed = updateStatus.run('AUTHORIZED_FOR_EXECUTION', null, planId, 'PENDING_CONFIRMATION');
    if (Number(changed.changes || 0) !== 1) return writeJson(res, 409, { error: 'Action state changed. Ask Vecta to re-check it.' });
    audit(ctx, 'EXECUTION_AUTHORIZED', planId, { capability: row.capability, execution: spec.execution.type });
    return writeJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      planId,
      locale: row.locale,
      execution: {
        ...spec.execution,
        args: JSON.parse(row.args_json)
      },
      verifyAfterExecution: true
    });
  }

  async function complete(req, res, ctx) {
    const body = await readJson(req);
    const planId = compact(body.planId, 120);
    const row = getPlan.get(planId);
    if (!assertOwnedPlan(row, ctx)) return writeJson(res, 404, { error: 'Action plan not found.' });
    if (row.status !== 'AUTHORIZED_FOR_EXECUTION') return writeJson(res, 409, { error: 'This action plan is not awaiting an execution result.' });

    const ok = body.ok === true;
    const status = ok ? 'COMPLETED' : 'FAILED';
    const changed = updateStatus.run(status, Date.now(), planId, 'AUTHORIZED_FOR_EXECUTION');
    if (Number(changed.changes || 0) !== 1) return writeJson(res, 409, { error: 'Action state changed.' });
    const receipt = body.receipt && typeof body.receipt === 'object' && !Array.isArray(body.receipt)
      ? {
          id: compact(body.receipt.id, 160) || null,
          status: compact(body.receipt.status, 80) || null,
          version: compact(body.receipt.version, 80) || null
        }
      : {};
    audit(ctx, ok ? 'EXECUTION_VERIFIED_BY_WORKFLOW' : 'EXECUTION_FAILED', planId, { capability: row.capability, receipt });
    return writeJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      planId,
      ok,
      locale: row.locale,
      answer: copy(row.locale, ok ? 'completed' : 'failed'),
      receipt
    });
  }

  async function cancel(req, res, ctx) {
    const body = await readJson(req);
    const planId = compact(body.planId, 120);
    const row = getPlan.get(planId);
    if (!assertOwnedPlan(row, ctx)) return writeJson(res, 404, { error: 'Action plan not found.' });
    if (row.status !== 'PENDING_CONFIRMATION') return writeJson(res, 409, { error: 'This action plan cannot be cancelled in its current state.' });
    const changed = updateStatus.run('CANCELLED', Date.now(), planId, 'PENDING_CONFIRMATION');
    if (Number(changed.changes || 0) !== 1) return writeJson(res, 409, { error: 'Action state changed.' });
    audit(ctx, 'PLAN_CANCELLED', planId, {});
    return writeJson(res, 200, { ok: true, answer: copy(row.locale, 'cancelled') });
  }

  async function handleRequest(req, res) {
    const path = requestPath(req);
    if (!path.startsWith(PREFIX)) return false;
    const ctx = requireUser(req, res);
    if (!ctx) return true;
    try {
      if (req.method === 'GET' && path === PREFIX + '/capabilities') {
        return writeJson(res, 200, {
          contractVersion: CONTRACT_VERSION,
          capabilities: filteredCapabilities(ctx),
          executionRule: 'Explain -> offer -> explicit confirmation -> authority re-check -> execute -> verify -> report.'
        });
      }
      if (req.method === 'POST' && path === PREFIX + '/plan') return await plan(req, res, ctx);
      if (req.method === 'POST' && path === PREFIX + '/execute') return await execute(req, res, ctx);
      if (req.method === 'POST' && path === PREFIX + '/complete') return await complete(req, res, ctx);
      if (req.method === 'POST' && path === PREFIX + '/cancel') return await cancel(req, res, ctx);
      return writeJson(res, 404, { error: 'Operations Bot endpoint not found.' });
    } catch (error) {
      return writeJson(res, Number(error && error.statusCode || 500), {
        error: error && error.statusCode ? error.message : 'Operations Bot failed safely.'
      });
    }
  }

  return Object.freeze({
    handleRequest,
    close() { try { db.close(); } catch {} }
  });
}

module.exports = Object.freeze({
  PREFIX,
  CONTRACT_VERSION,
  CAPABILITIES,
  normaliseLocale,
  parseDate,
  parseHours,
  deterministicInterpret,
  responseForInterpretation,
  createVectorOperationsBot
});
