// Fix plan RP4.5 (2026-11-07): a contract can be signed by typing a full
// legal name (same typed-name pattern as the pay and add-card flows) and
// ticking a confirm box -- a keyboard-only path for a client who can't
// draw. respond-to-contract still requires a data:image/ signature, so the
// typed name is rendered onto a canvas and sent as that image. Runs the
// page's real card renderer and respondToContract() in jsdom with stubbed
// canvas, fetch and session. Made-up data only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'contracts.html'), 'utf8');

function grab(name) {
  const start = html.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) { i++; break; } }
  return html.slice(start, i);
}

function page({ drawn = null } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="list"></div></body>', { runScripts: 'outside-only', url: 'https://www.triplehenterprisesllc.biz/portal/contracts.html' });
  const w = dom.window;
  w.drawnText = [];
  w.HTMLCanvasElement.prototype.getContext = function () {
    return { fillRect() {}, fillText: (t) => w.drawnText.push(t), measureText: (t) => ({ width: t.length * 20 }), set font(v) {}, set fillStyle(v) {}, set textAlign(v) {}, set textBaseline(v) {} };
  };
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,' + 'A'.repeat(400);
  w.sent = [];
  w.fetch = async (u, init) => { w.sent.push(JSON.parse(init.body)); return { json: async () => ({ ok: true, status: 'signed', signed_on: 'November 7, 2026' }) }; };
  w.client = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } };
  w.SUPABASE_ANON_KEY = 'anon';
  w.portalConfirm = async () => true;
  w.portalLoginUrl = () => '/portal/login.html';
  w.showToast = () => {};
  w.renderContracts = () => { w.rerendered = true; };
  w.escapeHtml = (s) => String(s);
  w.formatDate = () => 'Nov 1, 2026';
  w.contractFactsHtml = () => '';
  w.renderContractBody = () => '';
  w.getContractSignatureDataUrl = () => drawn;
  w.eval(['renderContractCard', 'typedSignatureOn', 'toggleTypedSignature', 'typedSignatureDataUrl', 'respondToContract']
    .map(grab).join('\n') + ';window.respondToContract = respondToContract; window.toggleTypedSignature = toggleTypedSignature;');
  w.document.getElementById('list').innerHTML = w.eval('renderContractCard')({ id: 7, status: 'pending', contract_title: 'Deck repair', created_at: '2026-11-01', blocks: [] });
  return w;
}
const $ = (w, id) => w.document.getElementById(id);

test('the typed-name option is a real, labelled, keyboard-reachable control next to the pad', () => {
  const w = page();
  const toggle = $(w, 'signatureModeToggle-7');
  assert.equal(toggle.tagName, 'BUTTON');
  assert.equal(toggle.getAttribute('type'), 'button');
  assert.equal(toggle.textContent, "Can't draw? Type your name instead");
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal($(w, 'signatureTyped-7').hidden, true);
  assert.equal(w.document.querySelector('label[for="signatureTypedName-7"]').textContent, 'Type your full legal name');
  assert.equal($(w, 'signatureCanvas-7').getAttribute('role'), 'img', 'the pad is labelled for screen readers');
  assert.equal($(w, 'signatureCanvas-7').getAttribute('aria-labelledby'), 'signatureLabel-7');

  assert.equal(toggle.getAttribute('onclick'), 'toggleTypedSignature(7)');
  w.toggleTypedSignature(7); // what the button's onclick runs (outside-only jsdom skips inline handlers)
  assert.equal($(w, 'signatureTyped-7').hidden, false);
  assert.equal($(w, 'signatureDrawn-7').hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.textContent, 'Draw my signature instead');
  assert.equal(w.document.activeElement, $(w, 'signatureTypedName-7'), 'focus moves to the name field');
  w.close();
});

test('typed signing needs the name AND the confirm box; then the name goes as a rendered signature image', async () => {
  const w = page();
  w.toggleTypedSignature(7);
  await w.respondToContract(7, 'sign', null);
  assert.equal($(w, 'contractError-7').textContent, 'Please type your full legal name above before signing.');
  $(w, 'signatureTypedName-7').value = '  Jordan Q. Sample ';
  await w.respondToContract(7, 'sign', null);
  assert.equal($(w, 'contractError-7').textContent, 'Please tick the box to confirm your typed name is your signature.');
  assert.equal(w.sent.length, 0, 'nothing sent yet');

  $(w, 'signatureTypedAgree-7').checked = true;
  await w.respondToContract(7, 'sign', null);
  assert.equal(w.sent.length, 1);
  const body = w.sent[0];
  assert.equal(body.contract_id, 7);
  assert.equal(body.action, 'sign');
  assert.match(body.client_signature_data_url, /^data:image\/png;base64,/);
  assert.ok(body.client_signature_data_url.length > 100, 'passes respond-to-contract\'s looksLikeSignatureDataUrl()');
  assert.equal(body.signer_name, 'Jordan Q. Sample');
  assert.equal(body.signature_method, 'typed');
  assert.ok(w.drawnText.includes('Jordan Q. Sample'), 'the typed name is what is drawn');
  w.close();
});

test('draw mode is unchanged: no drawing, no request; a drawing is sent as before', async () => {
  const w = page();
  await w.respondToContract(7, 'sign', null);
  assert.match($(w, 'contractError-7').textContent, /^Please draw your signature above before signing, or tap "Can't draw\? Type your name instead"\.$/);
  assert.equal(w.sent.length, 0);
  w.close();
  const d = page({ drawn: 'data:image/png;base64,' + 'B'.repeat(300) });
  await d.respondToContract(7, 'sign', null);
  assert.equal(d.sent[0].client_signature_data_url, 'data:image/png;base64,' + 'B'.repeat(300));
  assert.equal(d.sent[0].signature_method, 'drawn');
  d.close();
});

test('declining never needs a signature in either mode', async () => {
  const w = page();
  w.toggleTypedSignature(7);
  await w.respondToContract(7, 'decline', null);
  assert.deepEqual([w.sent[0].action, w.sent[0].client_signature_data_url], ['decline', null]);
  w.close();
});
