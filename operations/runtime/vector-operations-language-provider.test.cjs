'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTRACT_VERSION,
  safeEndpoint,
  sanitiseInterpretation,
  sanitiseTranslations,
  createVectorOperationsLanguageProvider
} = require('./vector-operations-language-provider.cjs');

test('language gateway refuses insecure or credential-bearing endpoints', () => {
  assert.throws(() => safeEndpoint('http://language.example.test/v1'), /HTTPS/);
  assert.throws(() => safeEndpoint('https://user:pass@language.example.test/v1'), /credentials/);
  assert.equal(safeEndpoint('https://language.example.test/v1').hostname, 'language.example.test');
});

test('interpretation may choose only capabilities already allowed by Vecta', () => {
  const allowed = ['leave.request'];
  const action = sanitiseInterpretation({
    kind: 'action',
    capability: 'leave.request',
    args: { date: '2026-10-04', hours: 8, extra: 'ignored' },
    detectedLocale: 'am-ET'
  }, allowed);
  assert.equal(action.kind, 'action');
  assert.equal(action.capability, 'leave.request');
  assert.deepEqual({ ...action.args }, { date: '2026-10-04', hours: 8 });
  assert.equal(action.detectedLocale, 'am-ET');

  assert.throws(() => sanitiseInterpretation({
    kind: 'action',
    capability: 'payroll.release',
    args: {}
  }, allowed), /unregistered or unauthorised/);
});

test('translation accepts only requested keys and non-empty bounded text', () => {
  assert.deepEqual(
    { ...sanitiseTranslations({ answer: 'Bonjour', extra: 'ignored' }, ['answer']) },
    { answer: 'Bonjour' }
  );
  assert.throws(() => sanitiseTranslations({}, ['answer']), /omitted/);
});

test('provider sends minimal role and capability context without tenant or workforce records', async () => {
  const calls = [];
  const provider = createVectorOperationsLanguageProvider({
    url: 'https://language.example.test/v1/vector',
    transport: async request => {
      calls.push(request);
      return {
        contractVersion: CONTRACT_VERSION,
        mode: 'interpret',
        result: {
          kind: 'action',
          capability: 'leave.request',
          args: { date: '2026-10-05', hours: 7.5 },
          detectedLocale: 'sw-KE'
        }
      };
    }
  });

  const result = await provider.interpret({
    message: 'Nataka likizo tarehe 2026-10-05 kwa saa 7.5',
    locale: 'sw-KE',
    roleClass: 'employee',
    allowedCapabilities: ['leave.request']
  });
  assert.equal(result.capability, 'leave.request');
  assert.equal(result.detectedLocale, 'sw-KE');
  assert.equal(calls.length, 1);
  const body = calls[0].body;
  assert.equal(body.mode, 'interpret');
  assert.equal(body.input.roleClass, 'employee');
  assert.deepEqual(body.input.allowedCapabilities, ['leave.request']);
  assert.equal('tenant' in body.input, false);
  assert.equal('email' in body.input, false);
  assert.equal('people' in body.input, false);
});

test('translation is UX-only and receives trusted source text plus target locale', async () => {
  const calls = [];
  const provider = createVectorOperationsLanguageProvider({
    url: 'https://language.example.test/v1/vector',
    transport: async request => {
      calls.push(request);
      return {
        contractVersion: CONTRACT_VERSION,
        mode: 'translate',
        translations: {
          answer: 'Ndiyo. Vecta inaweza kufanya hivyo.',
          confirmation: 'Ungependa nikufanyie hili?'
        }
      };
    }
  });

  const translated = await provider.translateMap({
    targetLocale: 'sw-KE',
    texts: {
      answer: 'Yes. Vecta can do that.',
      confirmation: 'Would you like me to do this for you?'
    }
  });
  assert.match(translated.answer, /Vecta/);
  assert.equal(calls[0].body.input.targetLocale, 'sw-KE');
  assert.ok(calls[0].body.input.preserve.includes('approval and confirmation meaning'));
});

test('malformed, mismatched and unregistered provider responses fail closed', async () => {
  const cases = [
    { response: null, pattern: /invalid/ },
    { response: { contractVersion: 'wrong', mode: 'interpret', result: {} }, pattern: /version mismatch/ },
    { response: { contractVersion: CONTRACT_VERSION, mode: 'translate', result: {} }, pattern: /mode mismatch/ },
    {
      response: {
        contractVersion: CONTRACT_VERSION,
        mode: 'interpret',
        result: { kind: 'action', capability: 'dangerous.unregistered', args: {} }
      },
      pattern: /unregistered or unauthorised/
    }
  ];

  for (const item of cases) {
    const provider = createVectorOperationsLanguageProvider({
      url: 'https://language.example.test/v1/vector',
      transport: async () => item.response
    });
    await assert.rejects(
      provider.interpret({
        message: 'test',
        locale: 'en-GB',
        roleClass: 'employee',
        allowedCapabilities: ['leave.request']
      }),
      item.pattern
    );
  }
});
