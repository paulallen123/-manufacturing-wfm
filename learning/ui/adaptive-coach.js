;(function () {
  'use strict';

  const API = '/api/learning/adaptive';
  const TRAINING_API = '/api/learning/training';
  let plan = null;
  let root = null;
  let panel = null;
  let trigger = null;

  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'class') node.className = value;
        else if (key === 'hidden') node.hidden = Boolean(value);
        else node.setAttribute(key, String(value));
      }
    }
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  async function request(path, options) {
    const response = await fetch(API + path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error('Learning request failed');
    return response.json();
  }

  async function trainingRequest(path, options) {
    const response = await fetch(TRAINING_API + path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error('Training delivery request failed');
    return response.json();
  }

  function renderModule(card, module) {
    let host = card.querySelector('.wfm-coach-delivery');
    if (!host) { host = el('div', { class: 'wfm-coach-delivery', 'aria-live': 'polite' }); card.append(host); }
    host.replaceChildren();
    const meta = el('p', { class: 'wfm-coach-delivery-meta' }, module.mode.replaceAll('_', ' ') + ' · ' + module.surface);
    host.append(meta);
    if (module.mode === 'SHOW_ME' && module.video?.state === 'READY' && module.video.videoUrl) {
      const video = el('video', { controls: '', playsinline: '', preload: 'metadata', class: 'wfm-coach-video', 'aria-label': module.title + ' demonstration' });
      video.src = module.video.videoUrl;
      if (module.video.captionsUrl) {
        const track = el('track', { kind: 'captions', srclang: module.locale || 'en-GB', label: 'Captions', src: module.video.captionsUrl, default: '' });
        video.append(track);
      }
      host.append(video);
      if (module.video.transcriptUrl) {
        const transcript = el('a', { href: module.video.transcriptUrl, target: '_blank', rel: 'noopener', class: 'wfm-coach-transcript' }, 'Open transcript');
        host.append(transcript);
      }
      host.append(el('p', { class: 'wfm-coach-test-note' }, 'Watching this demonstration is guidance only. VECTOR still requires independent or observed task evidence for mastery.'));
      return;
    }
    if (module.mode === 'SHOW_ME' && module.video?.state && module.video.state !== 'READY') {
      host.append(el('p', { class: 'wfm-coach-test-note' }, 'A version-bound training video is not yet published for this exact VECTOR configuration. Showing the authoritative step guide instead.'));
    }
    if (module.mode === 'PRACTISE' && module.scenario) {
      host.append(el('p', { class: 'wfm-coach-question' }, module.scenario.prompt));
      const options = el('div', { class: 'wfm-coach-options' });
      module.scenario.episode.options.forEach(option => {
        const button = el('button', { type: 'button', class: 'wfm-coach-option' }, option.label);
        button.addEventListener('click', async () => {
          const result = await trainingRequest('/scenario/answer', { method: 'POST', body: JSON.stringify({ competencyKey: module.competencyKey, optionId: option.id }) });
          if (result) host.append(el('p', { class: 'wfm-coach-feedback', 'data-result': result.matchedRecommendation ? 'pass' : 'retry' }, result.feedback));
        });
        options.append(button);
      });
      host.append(options);
      return;
    }
    if (module.mode === 'TEST_ME') {
      host.append(el('p', { class: 'wfm-coach-test-note' }, 'Complete this task independently in VECTOR. Guidance is hidden and mastery can only come from authoritative observed-task evidence.'));
      return;
    }
    const steps = el('ol', { class: 'wfm-coach-steps' });
    module.steps.forEach(step => {
      const li = el('li');
      li.append(el('strong', null, step.title), el('span', null, step.instruction));
      steps.append(li);
    });
    host.append(steps);
  }

  async function openTrainingMode(item, mode, card) {
    const module = await trainingRequest('/module?competencyKey=' + encodeURIComponent(item.competencyKey) + '&mode=' + encodeURIComponent(mode), { method: 'GET' });
    if (module) renderModule(card, module);
  }

  function currentVectorRoute() {
    try {
      return location.hash.startsWith('#vector/') ? decodeURIComponent(location.hash.slice(8)) : '';
    } catch { return ''; }
  }

  function closePanel() {
    if (!panel) return;
    panel.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.focus();
  }

  function openPanel() {
    if (!panel) return;
    panel.hidden = false;
    trigger?.setAttribute('aria-expanded', 'true');
    panel.querySelector('button, [tabindex]')?.focus();
  }

  function renderProgress(container) {
    const progress = el('div', { class: 'wfm-coach-progress', 'aria-label': 'Learning progress' });
    progress.append(
      el('strong', null, plan.progress.percent + '% ready'),
      el('span', null, plan.progress.mastered + ' of ' + plan.progress.total + ' skills proven')
    );
    container.append(progress);
  }

  async function submitPractice(item, answerIndex, card) {
    const result = await request('/practice', {
      method: 'POST',
      body: JSON.stringify({ competencyKey: item.competencyKey, answer: answerIndex })
    });
    if (!result) return;
    const feedback = card.querySelector('.wfm-coach-feedback');
    feedback.textContent = result.feedback || (result.passed ? 'Correct.' : 'Try again.');
    feedback.dataset.result = result.passed ? 'pass' : 'retry';
    if (result.passed) {
      setTimeout(refresh, 450);
    }
  }

  async function askForHelp(item, button) {
    button.disabled = true;
    try {
      const result = await request('/help', {
        method: 'POST',
        body: JSON.stringify({ competencyKey: item.competencyKey, event: 'OPENED' })
      });
      button.textContent = result?.refreshScheduled ? 'Refresher scheduled' : 'Help noted';
    } finally {
      button.disabled = false;
    }
  }

  function renderItem(container, item) {
    const card = el('section', { class: 'wfm-coach-card' });
    const top = el('div', { class: 'wfm-coach-card-top' });
    top.append(
      el('span', { class: 'wfm-coach-kicker' }, item.critical ? 'Required for your role' : 'Recommended'),
      el('span', { class: 'wfm-coach-score' }, item.score + '/100')
    );
    card.append(top, el('h3', null, item.title), el('p', null, item.objective));
    if (item.recommendedMode && item.recommendedMode !== 'NONE') {
      card.append(el('p', { class: 'wfm-coach-recommended' }, 'Recommended now: ' + item.recommendedMode.replaceAll('_', ' ').toLowerCase()));
    }

    if (item.practice) {
      const practice = el('div', { class: 'wfm-coach-practice' });
      practice.append(el('p', { class: 'wfm-coach-question' }, item.practice.prompt));
      const options = el('div', { class: 'wfm-coach-options' });
      item.practice.options.forEach((label, index) => {
        const button = el('button', { type: 'button', class: 'wfm-coach-option' }, label);
        button.addEventListener('click', () => submitPractice(item, index, card));
        options.append(button);
      });
      practice.append(options);
      card.append(practice);
    }

    const modes = el('div', { class: 'wfm-coach-modes', 'aria-label': 'Choose how to learn' });
    [['SHOW_ME','Show me'],['GUIDE_ME','Guide me'],['PRACTISE','Practise'],['TEST_ME','Test me']].forEach(([mode,label]) => {
      const className = 'wfm-coach-mode' + (item.recommendedMode === mode ? ' recommended' : '');
      const button = el('button', { type: 'button', class: className, 'aria-label': label + (item.recommendedMode === mode ? ' — recommended' : '') }, label);
      button.addEventListener('click', () => openTrainingMode(item, mode, card));
      modes.append(button);
    });
    card.append(modes);

    const feedback = el('p', { class: 'wfm-coach-feedback', 'aria-live': 'polite' }, '');
    const actions = el('div', { class: 'wfm-coach-actions' });
    const help = el('button', { type: 'button', class: 'wfm-coach-secondary' }, 'I need help');
    help.addEventListener('click', () => askForHelp(item, help));
    const know = el('button', { type: 'button', class: 'wfm-coach-secondary' }, 'I already know this — test me');
    know.addEventListener('click', () => openTrainingMode(item, 'TEST_ME', card));
    actions.append(help, know);
    card.append(feedback, actions);
    container.append(card);
  }

  function render() {
    if (!root || !plan) return;
    const body = panel.querySelector('.wfm-coach-body');
    body.replaceChildren();
    renderProgress(body);

    if (!plan.next.length) {
      body.append(
        el('div', { class: 'wfm-coach-complete' },
          'You are up to date. Guidance will return only when you need a refresher or new functionality is introduced.')
      );
      trigger.hidden = true;
      closePanel();
      return;
    }

    trigger.hidden = false;
    trigger.querySelector('.wfm-coach-badge').textContent = String(plan.next.length);
    renderItem(body, plan.next[0]);

    if (plan.next.length > 1) {
      body.append(el('p', { class: 'wfm-coach-queue' }, '+' + (plan.next.length - 1) + ' more role skills waiting'));
    }
  }

  async function refresh() {
    try {
      const route = currentVectorRoute();
      const [nextPlan, deliveryPlan] = await Promise.all([
        request('/plan', { method: 'GET' }),
        trainingRequest('/plan?route=' + encodeURIComponent(route), { method: 'GET' })
      ]);
      if (!nextPlan) return;
      if (deliveryPlan?.competencies) {
        const recommendations = new Map(deliveryPlan.competencies.map(item => [item.competencyKey, item.recommendedMode]));
        nextPlan.next = nextPlan.next.map(item => ({ ...item, recommendedMode: recommendations.get(item.competencyKey) || null }));
        nextPlan.all = nextPlan.all.map(item => ({ ...item, recommendedMode: recommendations.get(item.competencyKey) || null }));
        if (route && deliveryPlan.next?.length) {
          const contextualKey = deliveryPlan.next[0].competencyKey;
          nextPlan.next.sort((a,b) => (a.competencyKey === contextualKey ? -1 : b.competencyKey === contextualKey ? 1 : 0));
        }
      }
      plan = nextPlan;
      if (!root) mount();
      render();
    } catch {
      if (trigger) trigger.hidden = true;
    }
  }

  function mount() {
    if (document.getElementById('wfm-adaptive-coach')) return;
    root = el('div', { id: 'wfm-adaptive-coach', class: 'wfm-coach-root' });

    trigger = el('button', {
      type: 'button',
      class: 'wfm-coach-trigger',
      'aria-controls': 'wfm-adaptive-coach-panel',
      'aria-expanded': 'false'
    });
    trigger.append(el('span', null, 'Guide'), el('span', { class: 'wfm-coach-badge' }, '0'));
    trigger.addEventListener('click', () => panel.hidden ? openPanel() : closePanel());

    panel = el('aside', {
      id: 'wfm-adaptive-coach-panel',
      class: 'wfm-coach-panel',
      'aria-label': 'Role learning guide',
      hidden: true
    });
    const header = el('div', { class: 'wfm-coach-header' });
    const heading = el('div');
    heading.append(el('span', { class: 'wfm-coach-kicker' }, 'Learn while you work'), el('h2', null, 'Your guide'));
    const close = el('button', { type: 'button', class: 'wfm-coach-close', 'aria-label': 'Close guide' }, '×');
    close.addEventListener('click', closePanel);
    header.append(heading, close);
    panel.append(header, el('div', { class: 'wfm-coach-body' }));
    root.append(trigger, panel);
    document.body.append(root);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && panel && !panel.hidden) closePanel();
    });
  }

  function start() {
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();