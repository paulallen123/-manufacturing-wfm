;(function () {
  'use strict';

  const API = '/api/learning/adaptive';
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

    const feedback = el('p', { class: 'wfm-coach-feedback', 'aria-live': 'polite' }, '');
    const actions = el('div', { class: 'wfm-coach-actions' });
    const help = el('button', { type: 'button', class: 'wfm-coach-secondary' }, 'I need help');
    help.addEventListener('click', () => askForHelp(item, help));
    actions.append(help);
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
      const nextPlan = await request('/plan', { method: 'GET' });
      if (!nextPlan) return;
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