/* Vector Operations Bot — conversational control layer.
 * Conversation may propose only registered actions. Existing authenticated workflows remain authoritative.
 */
(function () {
'use strict';

const API = '/api/workforce/lifecycle/operations-bot';
const MARKER = 'VECTOR_OPERATIONS_BOT_UI_V1';
const MAX_MESSAGE = 2000;
const state = {
  mounted: false,
  busy: false,
  pendingPlan: null,
  voiceReplies: true,
  recognition: null,
  listening: false,
  locale: ''
};

function locale() {
  if (state.locale) return state.locale;
  const html = String(document.documentElement.lang || '').trim();
  const browser = String(navigator.language || '').trim();
  state.locale = html || browser || 'en-GB';
  return state.locale;
}

function escapeText(value) {
  return String(value == null ? '' : value);
}

async function request(route, body) {
  const response = await fetch(API + route, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload.error || 'Vecta could not complete that request.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function panel() { return document.getElementById('wfm-bot'); }
function launcher() { return document.getElementById('wfm-bot-launch'); }
function messageInput() { return document.getElementById('bot-message'); }
function transcript() { return document.getElementById('wfm-bot-transcript'); }

function appendMessage(kind, text, options = {}) {
  const list = transcript();
  if (!list) return null;
  const row = document.createElement('div');
  row.className = 'wfm-bot-message ' + (kind === 'user' ? 'user' : 'assistant');
  row.dataset.kind = kind;
  const body = document.createElement('p');
  body.textContent = escapeText(text);
  row.appendChild(body);
  if (options.status) {
    const status = document.createElement('small');
    status.textContent = escapeText(options.status);
    row.appendChild(status);
  }
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return row;
}

function addConfirmation(planResponse) {
  const list = transcript();
  if (!list || !planResponse || !planResponse.plan) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'wfm-bot-confirm';
  wrapper.dataset.planId = planResponse.plan.id;

  const question = document.createElement('p');
  question.textContent = planResponse.confirmation || 'Would you like me to do this for you?';
  wrapper.appendChild(question);

  const detail = document.createElement('small');
  detail.textContent = planResponse.plan.consequence || '';
  wrapper.appendChild(detail);

  const actions = document.createElement('div');
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.dataset.wfmBotConfirm = 'yes';
  yes.textContent = 'Yes — do it';
  const no = document.createElement('button');
  no.type = 'button';
  no.dataset.wfmBotConfirm = 'no';
  no.textContent = 'No';
  actions.append(yes, no);
  wrapper.appendChild(actions);
  list.appendChild(wrapper);
  list.scrollTop = list.scrollHeight;
}

function speak(text) {
  if (!state.voiceReplies || !text || !('speechSynthesis' in window)) return false;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text).slice(0, 3000));
    utterance.lang = locale();
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

function setBusy(busy) {
  state.busy = Boolean(busy);
  const input = messageInput();
  const send = document.getElementById('wfm-bot-send');
  const mic = document.getElementById('wfm-bot-mic');
  if (input) input.disabled = state.busy;
  if (send) send.disabled = state.busy;
  if (mic) mic.disabled = state.busy;
  panel()?.classList.toggle('busy', state.busy);
}

function show() {
  const root = panel();
  if (!root) return;
  root.hidden = false;
  launcher()?.setAttribute('aria-expanded', 'true');
  queueMicrotask(() => messageInput()?.focus());
}

function hide() {
  const root = panel();
  if (!root) return;
  root.hidden = true;
  launcher()?.setAttribute('aria-expanded', 'false');
  if (state.recognition && state.listening) {
    try { state.recognition.stop(); } catch {}
  }
}

async function plan(message) {
  if (state.busy) return;
  const text = String(message || '').trim().slice(0, MAX_MESSAGE);
  if (!text) return;
  show();
  appendMessage('user', text);
  const input = messageInput();
  if (input) input.value = '';
  setBusy(true);
  try {
    const response = await request('/plan', { message: text, locale: locale() });
    appendMessage('assistant', response.answer || 'I checked that request.');
    speak(response.answer || '');
    state.pendingPlan = response.offerToAct && response.plan ? response : null;
    if (state.pendingPlan) addConfirmation(response);
  } catch (error) {
    appendMessage('assistant', error.message || 'Vecta could not check that request.', { status: 'No action was taken.' });
  } finally {
    setBusy(false);
  }
}

async function navigate(route) {
  const go = window.VectorWorkforceOperations && window.VectorWorkforceOperations.go;
  if (typeof go !== 'function') throw new Error('The requested Vecta workspace is not available in this view.');
  const ok = await go(route);
  if (ok === false) throw new Error('Your current role cannot open that Vecta workspace.');
  return { id: route, status: 'opened' };
}

async function executeClientAction(execution) {
  if (!execution || typeof execution !== 'object') throw new Error('Vecta returned an invalid execution instruction.');
  if (execution.type === 'navigate') return navigate(execution.route);

  if (execution.type === 'vector_workflow' && execution.operation === 'leaveRequest') {
    const workflow = window.VectorWorkflow;
    if (!workflow || typeof workflow.leaveRequest !== 'function') {
      throw new Error('The authenticated leave workflow is not available in this session.');
    }
    const result = await workflow.leaveRequest(execution.args || {});
    const receipt = typeof workflow.leaveState === 'function' ? workflow.leaveState().receipt : null;
    if (!result || !result.id || !receipt || receipt.id !== result.id) {
      throw new Error('The leave workflow did not return a verified saved receipt.');
    }
    return {
      id: receipt.id,
      status: receipt.status || result.status || null,
      version: receipt.version == null ? null : String(receipt.version)
    };
  }

  throw new Error('Vecta refused an unregistered execution instruction.');
}

async function confirmPlan(confirm) {
  const pending = state.pendingPlan;
  if (!pending || !pending.plan || state.busy) return;
  state.pendingPlan = null;
  const planId = pending.plan.id;
  setBusy(true);
  try {
    if (!confirm) {
      const cancelled = await request('/cancel', { planId });
      appendMessage('assistant', cancelled.answer || 'No change was made.');
      speak(cancelled.answer || '');
      return;
    }

    const authority = await request('/execute', { planId, confirm: true });
    let receipt = null;
    try {
      receipt = await executeClientAction(authority.execution);
    } catch (error) {
      try {
        await request('/complete', {
          planId,
          ok: false,
          receipt: { status: 'client-workflow-failed' }
        });
      } catch {}
      throw error;
    }

    const complete = await request('/complete', { planId, ok: true, receipt });
    appendMessage('assistant', complete.answer || 'Done.', {
      status: receipt && receipt.id ? 'Verified result: ' + receipt.id : 'Verified by the Vecta workflow.'
    });
    speak(complete.answer || '');
  } catch (error) {
    appendMessage('assistant', error.message || 'The action did not complete.', { status: 'Vecta has not reported it as done.' });
  } finally {
    setBusy(false);
  }
}

function SpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function toggleListening() {
  if (state.busy) return;
  const Ctor = SpeechRecognitionCtor();
  if (!Ctor) {
    appendMessage('assistant', 'Voice input is not available through this browser or device speech service. You can continue by typing.');
    return;
  }

  if (!state.recognition) {
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      const value = event && event.results && event.results[0] && event.results[0][0]
        ? String(event.results[0][0].transcript || '')
        : '';
      if (value) {
        const input = messageInput();
        if (input) input.value = value;
        void plan(value);
      }
    };
    recognition.onerror = event => {
      state.listening = false;
      document.getElementById('wfm-bot-mic')?.classList.remove('listening');
      const code = String(event && event.error || '');
      if (code && code !== 'no-speech' && code !== 'aborted') {
        appendMessage('assistant', 'Voice input could not be captured. No action was taken.');
      }
    };
    recognition.onend = () => {
      state.listening = false;
      document.getElementById('wfm-bot-mic')?.classList.remove('listening');
    };
    state.recognition = recognition;
  }

  if (state.listening) {
    try { state.recognition.stop(); } catch {}
    return;
  }

  state.recognition.lang = locale();
  try {
    state.recognition.start();
    state.listening = true;
    document.getElementById('wfm-bot-mic')?.classList.add('listening');
  } catch {
    state.listening = false;
  }
}

function mount() {
  if (state.mounted || document.getElementById('wfm-bot')) return;
  state.mounted = true;

  const launch = document.createElement('button');
  launch.id = 'wfm-bot-launch';
  launch.type = 'button';
  launch.className = 'wfm-bot-launch';
  launch.setAttribute('aria-controls', 'wfm-bot');
  launch.setAttribute('aria-expanded', 'false');
  launch.innerHTML = '<span aria-hidden="true">✦</span><b>Ask Vecta</b>';

  const root = document.createElement('aside');
  root.id = 'wfm-bot';
  root.className = 'wfm-bot';
  root.hidden = true;
  root.dataset.marker = MARKER;
  root.setAttribute('aria-label', 'Vecta Operations Bot');
  root.innerHTML =
    '<header><div><strong>Vecta Operations Bot</strong><small>Ask → approve → Vecta does the work</small></div>' +
      '<button type="button" data-wfm-bot-close aria-label="Close Operations Bot">×</button></header>' +
    '<div id="wfm-bot-transcript" class="wfm-bot-transcript" role="log" aria-live="polite" aria-relevant="additions"></div>' +
    '<div class="wfm-bot-controls">' +
      '<button type="button" id="wfm-bot-mic" aria-label="Speak to Vecta" title="Speak to Vecta">🎙</button>' +
      '<input id="bot-message" type="text" maxlength="2000" autocomplete="off" placeholder="Tell Vecta the outcome you want…" aria-label="Message Vecta Operations Bot">' +
      '<button type="button" id="wfm-bot-send" aria-label="Send to Vecta">Send</button>' +
    '</div>' +
    '<footer><label><input type="checkbox" id="wfm-bot-voice-reply" checked> Speak replies</label>' +
      '<details><summary>Language</summary><label>Voice/text locale <input id="wfm-bot-locale" type="text" inputmode="text" maxlength="35" aria-label="Voice and text locale"></label><small>Uses your device language by default. Voice availability depends on the browser/device speech service.</small></details></footer>';

  document.body.append(launch, root);
  const localeInput = document.getElementById('wfm-bot-locale');
  if (localeInput) localeInput.value = locale();

  appendMessage('assistant', 'Tell me what you want to achieve. If Vecta has a proven authorised action, I will ask whether you want me to do it for you.');

  launch.addEventListener('click', () => root.hidden ? show() : hide());
  root.querySelector('[data-wfm-bot-close]')?.addEventListener('click', hide);
  document.getElementById('wfm-bot-send')?.addEventListener('click', () => plan(messageInput()?.value));
  document.getElementById('wfm-bot-mic')?.addEventListener('click', toggleListening);
  document.getElementById('wfm-bot-voice-reply')?.addEventListener('change', event => {
    state.voiceReplies = Boolean(event.target.checked);
    if (!state.voiceReplies && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  });
  localeInput?.addEventListener('change', event => {
    const value = String(event.target.value || '').trim();
    state.locale = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value.replace(/_/g, '-'))
      ? value.replace(/_/g, '-')
      : (navigator.language || 'en-GB');
    event.target.value = state.locale;
  });
  root.addEventListener('click', event => {
    const action = event.target.closest('[data-wfm-bot-confirm]');
    if (!action || action.disabled) return;
    root.querySelectorAll('[data-wfm-bot-confirm]').forEach(button => { button.disabled = true; });
    void confirmPlan(action.dataset.wfmBotConfirm === 'yes');
  });
  messageInput()?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || state.busy) return;
    event.preventDefault();
    void plan(event.currentTarget.value);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();

window.VectorOperationsBot = Object.freeze({
  marker: MARKER,
  open: show,
  close: hide,
  ask: plan,
  locale: () => locale(),
  speechInputAvailable: () => Boolean(SpeechRecognitionCtor()),
  speechOutputAvailable: () => 'speechSynthesis' in window
});
}());
