import { html } from '../util.js';
import { getSupabaseClient } from '../supabaseClient.js';
import { loadSupabaseDataIntoLocalState } from '../api/syncSupabase.js';

let currentUser = null;

export async function renderAccount() {
  currentUser = await getCurrentUserSafe();

  return {
    header: html`
      <button class="back-btn" data-action="back">← 뒤로</button>
      <div class="title">계정</div>
      <div style="width:36px"></div>
    `,
    body: currentUser ? signedInBody() : signedOutBody(),
    flush: false,
    showNav: false,
  };
}

function signedOutBody() {
  return html`
    <div class="callout callout--info">
      <span class="icon">i</span>
      <div><strong>로그인이 필요합니다</strong><br>이메일과 비밀번호로 로그인하면 레시피를 저장하고 불러올 수 있습니다.</div>
    </div>
    <form id="auth-form" class="stack">
      <label class="field">
        <span class="field-label">이메일</span>
        <input class="input" name="email" type="email" autocomplete="email" required />
      </label>
      <label class="field">
        <span class="field-label">비밀번호</span>
        <input class="input" name="password" type="password" autocomplete="current-password" minlength="6" required />
      </label>
      <button class="btn btn--primary btn--lg btn--block" type="submit" data-auth-mode="sign-in">로그인</button>
      <button class="btn btn--secondary btn--block" type="submit" data-auth-mode="sign-up">회원가입</button>
      <div class="field-error" id="auth-error"></div>
      <div class="field-help" id="auth-help">가입 후 이메일 확인이 필요할 수 있습니다.</div>
    </form>
  `;
}

function signedInBody() {
  return html`
    <div class="callout callout--olive">
      <span class="icon">✓</span>
      <div><strong>로그인됨</strong><br>${currentUser.email}</div>
    </div>
    <button class="btn btn--secondary btn--block" data-action="sign-out" type="button">로그아웃</button>
    <div class="field-help" id="account-status"></div>
  `;
}

export function bindAccount(rootEl, navigate) {
  rootEl.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (target?.dataset.action === 'back') history.back();
    if (target?.dataset.action === 'sign-out') {
      await getSupabaseClient().auth.signOut();
      navigate('/account');
    }
  });

  const form = rootEl.querySelector('#auth-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitter = e.submitter;
    const mode = submitter?.dataset.authMode || 'sign-in';
    const errorNode = rootEl.querySelector('#auth-error');
    const helpNode = rootEl.querySelector('#auth-help');
    errorNode.textContent = '';
    helpNode.textContent = '처리 중…';

    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    const auth = getSupabaseClient().auth;
    const result = mode === 'sign-up'
      ? await auth.signUp({ email, password })
      : await auth.signInWithPassword({ email, password });

    if (result.error) {
      errorNode.textContent = result.error.message;
      helpNode.textContent = '';
      return;
    }

    if (mode === 'sign-up') {
      helpNode.textContent = '가입 요청을 보냈습니다. 이메일 확인 후 로그인해주세요.';
      return;
    }

    // 로그인 성공 → Supabase에서 데이터 로드 후 홈으로
    helpNode.textContent = '데이터를 불러오는 중…';
    try {
      await loadSupabaseDataIntoLocalState();
    } catch (err) {
      console.warn('Supabase load after login failed', err);
    }
    navigate('/home');
  });
}

async function getCurrentUserSafe() {
  try {
    const { data } = await getSupabaseClient().auth.getUser();
    return data.user || null;
  } catch {
    return null;
  }
}
