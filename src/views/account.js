import { html } from '../util.js';
import { getSupabaseConfig } from '../config.js';
import { getSupabaseClient } from '../supabaseClient.js';
import { getState } from '../store.js';
import { backupLocalDataToSupabase, loadSupabaseDataIntoLocalState } from '../api/syncSupabase.js';

let currentUser = null;
let currentProfile = null;

export async function renderAccount() {
  const config = getSupabaseConfig();
  currentUser = await getCurrentUserSafe();
  currentProfile = currentUser ? await getCurrentProfileSafe() : null;

  return {
    header: html`
      <button class="back-btn" data-action="back">← 뒤로</button>
      <div class="title">계정</div>
      <div style="width:36px"></div>
    `,
    body: currentUser ? signedInBody(config) : signedOutBody(config),
    flush: false,
    showNav: false,
  };
}

function signedOutBody(config) {
  return html`
    <div class="callout callout--info">
      <span class="icon">i</span>
      <div><strong>Supabase Auth</strong><br>${config.url} 프로젝트에 이메일/비밀번호로 로그인합니다.</div>
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
      <button class="btn btn--secondary btn--block" type="submit" data-auth-mode="sign-up">가입</button>
      <div class="field-error" id="auth-error"></div>
      <div class="field-help" id="auth-help">가입 후 이메일 확인이 필요할 수 있습니다.</div>
    </form>
  `;
}

function signedInBody(config) {
  return html`
    <div class="callout callout--olive">
      <span class="icon">✓</span>
      <div><strong>로그인됨</strong><br>${currentUser.email}</div>
    </div>
    <div class="facts">
      <div class="fact"><span class="key">Project</span><span>${config.url}</span></div>
      <div class="fact"><span class="key">User ID</span><span>${currentUser.id}</span></div>
      <div class="fact"><span class="key">Plan</span><span>${currentProfile?.plan || 'free'}</span></div>
      <div class="fact"><span class="key">분석 사용량</span><span>${formatUsage(currentProfile)}</span></div>
    </div>
    <button class="btn btn--primary btn--block" data-action="backup-local" type="button">로컬 데이터 Supabase에 백업</button>
    <button class="btn btn--secondary btn--block" data-action="restore-remote" type="button">Supabase에서 불러오기</button>
    <button class="btn btn--secondary btn--block" data-action="sign-out" type="button">로그아웃</button>
    <div class="field-help" id="backup-status"></div>
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
    if (target?.dataset.action === 'backup-local') {
      const status = rootEl.querySelector('#backup-status');
      target.disabled = true;
      if (status) status.textContent = '백업 중...';
      try {
        const result = await backupLocalDataToSupabase();
        if (status) status.textContent = `백업 완료: 구성원 ${result.members}명, 레시피 ${result.recipes}개`;
      } catch (err) {
        if (status) status.textContent = err.message || '백업에 실패했습니다.';
      } finally {
        target.disabled = false;
      }
    }
    if (target?.dataset.action === 'restore-remote') {
      const state = getState();
      const hasLocalData = (state.recipes || []).length > 0 || (state.members || []).length > 0;
      if (hasLocalData && !confirm('현재 로컬 데이터를 Supabase 데이터로 교체할까요?')) return;
      const status = rootEl.querySelector('#backup-status');
      target.disabled = true;
      if (status) status.textContent = '불러오는 중...';
      try {
        const result = await loadSupabaseDataIntoLocalState();
        if (status) status.textContent = `불러오기 완료: 구성원 ${result.members}명, 레시피 ${result.recipes}개`;
      } catch (err) {
        if (status) status.textContent = err.message || '불러오기에 실패했습니다.';
      } finally {
        target.disabled = false;
      }
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
    helpNode.textContent = '처리 중...';

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
    helpNode.textContent = mode === 'sign-up'
      ? '가입 요청을 보냈습니다. 이메일 확인 후 로그인해주세요.'
      : '로그인했습니다.';
    navigate('/account');
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

async function getCurrentProfileSafe() {
  try {
    const { data } = await getSupabaseClient()
      .from('profiles')
      .select('plan,monthly_analyses_used,monthly_reset_at')
      .single();
    return data || null;
  } catch {
    return null;
  }
}

function formatUsage(profile) {
  if (!profile) return '0 / 20';
  const used = Number(profile.monthly_analyses_used) || 0;
  const limit = profile.plan === 'pro' || profile.plan === 'family' ? '무제한' : '20';
  const reset = profile.monthly_reset_at
    ? ` · ${new Date(profile.monthly_reset_at).toLocaleDateString('ko-KR')} 초기화`
    : '';
  return `${used} / ${limit}${reset}`;
}
