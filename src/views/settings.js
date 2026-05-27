import { html, raw } from '../util.js';
import { clearBackendSettings, getBackendSettings, saveBackendSettings } from '../config.js';
import { addCategory, deleteCategory, getState, updateCategory } from '../store.js';
import { deleteCategoryFromSupabase, syncCategoryToSupabase } from '../api/syncSupabase.js';
import {
  startGmailOAuth,
  listGmailIntegrations,
  deleteGmailIntegration,
  triggerManualSync,
  listRecentImports,
} from '../api/gmailIntegration.js';
import { icon } from '../icons.js';

const CATEGORY_ICONS = ['🏷', '🥗', '🍲', '🍱', '🥘', '🥣', '🥪', '🍜', '🌶', '🧁'];
const DEFAULT_CATEGORY_IDS = new Set(['all', 'korean', 'western', 'japanese', 'chinese', 'dessert', 'etc']);

export function renderSettings() {
  const settings = getBackendSettings();
  const mode = settings.analyzeEndpoint ? 'Edge Function 연결 모드' : '목업 분석 모드';
  const state = getState();
  const categoryList = state.categories
    .filter((category) => category.id !== 'all')
    .map((category) => html`
      <li>
        <span>${category.icon || '🏷'} ${category.name}</span>
        <span class="row" style="gap:6px">
          ${DEFAULT_CATEGORY_IDS.has(category.id) ? raw('<small>기본</small>') : raw(`
            <button class="icon-btn" data-action="edit-category" data-id="${category.id}" title="수정">✎</button>
            <button class="icon-btn" data-action="delete-category" data-id="${category.id}" title="삭제">×</button>
          `)}
        </span>
      </li>
    `).join('');
  const iconOptions = CATEGORY_ICONS.map((icon) => html`<option value="${icon}">${icon}</option>`).join('');

  return {
    header: html`
      <div class="title">${raw(icon('settings', 18))}<span>설정</span></div>
      <div style="width:36px"></div>
    `,
    body: html`
      <div class="setting-links">
        <button class="setting-link" type="button" data-action="open-members">
          <span class="ic">${raw(icon('users', 22))}</span>
          <span class="lbl"><strong>가족 구성원</strong><small>이름·이모지·색상·알러지</small></span>
          <span class="chev">${raw(icon('chev-r', 18))}</span>
        </button>
        <button class="setting-link" type="button" data-action="open-account">
          <span class="ic">${raw(icon('user', 22))}</span>
          <span class="lbl"><strong>계정</strong><small>로그인·백업·로그아웃</small></span>
          <span class="chev">${raw(icon('chev-r', 18))}</span>
        </button>
      </div>

      <div class="callout callout--info">
        <span class="icon">i</span>
        <div><strong>${mode}</strong><br>Supabase Function URL과 anon key를 저장하면 분석 화면에서 실제 백엔드로 요청합니다.</div>
      </div>

      <form id="settings-form" class="stack">
        <label class="field">
          <span class="field-label">Analyze Function URL</span>
          <input class="input" name="analyzeEndpoint" placeholder="https://...functions.supabase.co/analyze-video" value="${settings.analyzeEndpoint}" />
        </label>
        <label class="field">
          <span class="field-label">Supabase anon key</span>
          <textarea class="textarea" name="supabaseAnonKey" rows="4" placeholder="eyJ...">${settings.supabaseAnonKey}</textarea>
        </label>
        <button class="btn btn--primary btn--lg btn--block" type="submit">설정 저장</button>
        <button class="btn btn--secondary btn--block" type="button" data-action="clear-settings">목업 모드로 되돌리기</button>
        <div class="field-help" id="settings-status"></div>
      </form>

      <div class="detail-section" id="gmail-section">
        <h3>📧 Gmail 자동입고</h3>
        <p class="section-note">쿠팡/컬리/SSG 주문 확정 메일을 자동으로 감지해서 냉장고·실온보관에 넣어줘요.</p>
        <div id="gmail-connect-row" class="stack" style="margin-top:12px">
          <button class="btn btn--primary btn--block" type="button" data-action="gmail-connect">Gmail 계정 연결</button>
          <button class="btn btn--secondary btn--block" type="button" data-action="gmail-sync">지금 동기화</button>
        </div>
        <div id="gmail-status" class="field-help"></div>
        <div id="gmail-integrations" class="stack" style="margin-top:12px"></div>
        <div id="gmail-recent" class="stack" style="margin-top:12px"></div>
      </div>

      <div class="detail-section">
        <h3>카테고리</h3>
        <form id="category-form" class="stack">
          <input type="hidden" name="editingId" />
          <input type="hidden" name="originalName" />
          <div class="row">
            <label class="field" style="flex:1 1 160px">
              <span class="field-label">이름</span>
              <input class="input" name="name" maxlength="16" placeholder="예: 샐러드" />
            </label>
            <label class="field" style="flex:0 0 92px">
              <span class="field-label">아이콘</span>
              <select class="select" name="icon">${raw(iconOptions)}</select>
            </label>
          </div>
          <button class="btn btn--primary btn--block" type="submit" id="category-submit">카테고리 추가</button>
          <button class="btn btn--secondary btn--block" type="button" data-action="cancel-category-edit" hidden>수정 취소</button>
          <div class="field-help" id="category-status"></div>
        </form>
        <ul class="member-list">
          ${raw(categoryList)}
        </ul>
      </div>
    `,
    flush: false,
    showNav: true,
    activeNav: 'settings',
  };
}

export function bindSettings(rootEl, navigate) {
  handleGmailReturnParams(rootEl);
  refreshGmailIntegrations(rootEl);
  refreshGmailRecent(rootEl);

  rootEl.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'gmail-connect') {
      try {
        await startGmailOAuth();
      } catch (err) {
        setGmailStatus(rootEl, err.message || String(err));
      }
      return;
    }
    if (action === 'gmail-sync') {
      setGmailStatus(rootEl, '동기화 중...');
      try {
        const result = await triggerManualSync();
        const total = (result.results || []).reduce((sum, r) => sum + (r.inserted || 0), 0);
        setGmailStatus(rootEl, `완료: ${total}개 항목 추가`);
        refreshGmailRecent(rootEl);
      } catch (err) {
        setGmailStatus(rootEl, err.message || String(err));
      }
      return;
    }
    if (action === 'gmail-disconnect') {
      const id = e.target.closest('[data-action]').dataset.id;
      if (!confirm('Gmail 연결을 해제할까요?')) return;
      try {
        await deleteGmailIntegration(id);
        refreshGmailIntegrations(rootEl);
        setGmailStatus(rootEl, '연결 해제됨');
      } catch (err) {
        setGmailStatus(rootEl, err.message || String(err));
      }
      return;
    }
  });

  rootEl.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (target?.dataset.action === 'back') history.back();
    if (target?.dataset.action === 'open-members') return navigate?.('/members');
    if (target?.dataset.action === 'open-account') return navigate?.('/account');
    if (target?.dataset.action === 'clear-settings') {
      clearBackendSettings();
      location.hash = '#/settings';
      location.reload();
    }
    if (target?.dataset.action === 'edit-category') {
      const category = getState().categories.find((item) => item.id === target.dataset.id);
      if (category) fillCategoryForm(rootEl, category);
    }
    if (target?.dataset.action === 'cancel-category-edit') {
      resetCategoryForm(rootEl);
    }
    if (target?.dataset.action === 'delete-category') {
      const category = getState().categories.find((item) => item.id === target.dataset.id);
      if (!category || DEFAULT_CATEGORY_IDS.has(category.id)) return;
      if (!confirm('이 카테고리를 삭제할까요? 연결된 레시피는 기타로 이동합니다.')) return;
      target.disabled = true;
      setCategoryStatus(rootEl, '카테고리 삭제 중...');
      try {
        await deleteCategoryFromSupabase(category);
        setCategoryStatus(rootEl, 'Supabase에서도 삭제했습니다.');
      } catch (err) {
        console.warn('Supabase category delete failed', err);
        setCategoryStatus(rootEl, '로컬에서 삭제했습니다. Supabase는 계정 화면에서 다시 백업해 주세요.');
      } finally {
        deleteCategory(category.id);
      }
    }
  });

  const form = rootEl.querySelector('#settings-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    saveBackendSettings({
      analyzeEndpoint: data.get('analyzeEndpoint'),
      supabaseAnonKey: data.get('supabaseAnonKey'),
    });
    const status = rootEl.querySelector('#settings-status');
    if (status) status.textContent = '저장했습니다. 분석 화면에서 새 설정을 사용합니다.';
  });

  const categoryForm = rootEl.querySelector('#category-form');
  categoryForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(categoryForm);
    const editingId = String(data.get('editingId') || '');
    const originalName = String(data.get('originalName') || '');
    const name = String(data.get('name') || '').trim();
    if (!name) return;

    const payload = {
      name,
      icon: String(data.get('icon') || '🏷'),
    };
    if (editingId && originalName && originalName !== name) {
      await deleteCategoryFromSupabase({ id: editingId, name: originalName });
    }
    const id = editingId || addCategory(payload);
    if (editingId) updateCategory(editingId, payload);
    const category = getState().categories.find((item) => item.id === id);

    if (category) {
      setCategoryStatus(rootEl, editingId ? '카테고리 수정 중...' : '카테고리 저장 중...');
      try {
        const result = await syncCategoryToSupabase(category);
        setCategoryStatus(rootEl, result.skipped ? '로컬에 저장했습니다. 로그인하면 백업할 수 있어요.' : 'Supabase에 저장했습니다.');
      } catch (err) {
        console.warn('Supabase category sync failed', err);
        setCategoryStatus(rootEl, '로컬에 저장했습니다. Supabase 저장은 계정 화면에서 다시 백업할 수 있어요.');
      }
    }
    resetCategoryForm(rootEl);
  });
}

function fillCategoryForm(rootEl, category) {
  const form = rootEl.querySelector('#category-form');
  if (!form) return;
  form.editingId.value = category.id;
  form.originalName.value = category.name || '';
  form.name.value = category.name || '';
  form.icon.value = CATEGORY_ICONS.includes(category.icon) ? category.icon : '🏷';
  rootEl.querySelector('#category-submit').textContent = '카테고리 수정';
  rootEl.querySelector('[data-action="cancel-category-edit"]').hidden = false;
  form.name.focus();
}

function resetCategoryForm(rootEl) {
  const form = rootEl.querySelector('#category-form');
  if (!form) return;
  form.reset();
  form.editingId.value = '';
  form.originalName.value = '';
  rootEl.querySelector('#category-submit').textContent = '카테고리 추가';
  rootEl.querySelector('[data-action="cancel-category-edit"]').hidden = true;
}

function setCategoryStatus(rootEl, message) {
  const status = rootEl.querySelector('#category-status');
  if (status) status.textContent = message;
}

function setGmailStatus(rootEl, message) {
  const status = rootEl.querySelector('#gmail-status');
  if (status) status.textContent = message || '';
}

function handleGmailReturnParams(rootEl) {
  const hashQuery = location.hash.split('?')[1];
  if (!hashQuery) return;
  const params = new URLSearchParams(hashQuery);
  const connected = params.get('gmail_connected');
  const errorCode = params.get('gmail_error');
  if (connected) setGmailStatus(rootEl, `${decodeURIComponent(connected)} 연결 완료`);
  else if (errorCode) setGmailStatus(rootEl, `Gmail 연결 실패: ${errorCode}`);
  if (connected || errorCode) {
    history.replaceState(null, '', '#/settings');
  }
}

async function refreshGmailIntegrations(rootEl) {
  const container = rootEl.querySelector('#gmail-integrations');
  if (!container) return;
  try {
    const list = await listGmailIntegrations();
    if (!list.length) {
      container.innerHTML = '<p class="section-note">연결된 Gmail 계정이 없습니다.</p>';
      return;
    }
    container.innerHTML = list.map((row) => `
      <div class="fridge-item">
        <span class="fridge-item-main">
          <span class="fridge-item-name">${escapeHtml(row.email_address)}</span>
          <span class="fridge-item-meta">
            <span>${row.last_synced_at ? '최근 동기화 ' + new Date(row.last_synced_at).toLocaleString('ko') : '아직 동기화 안 됨'}</span>
          </span>
        </span>
        <button class="fridge-delete" type="button" data-action="gmail-disconnect" data-id="${row.id}" title="연결 해제">×</button>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="section-note">목록 조회 실패: ${escapeHtml(err.message || String(err))}</p>`;
  }
}

async function refreshGmailRecent(rootEl) {
  const container = rootEl.querySelector('#gmail-recent');
  if (!container) return;
  try {
    const items = await listRecentImports(8);
    if (!items.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `
      <h4 style="margin:8px 0 4px">최근 자동입고</h4>
      ${items.map((row) => {
        const count = Array.isArray(row.parsed_items?.items) ? row.parsed_items.items.length : 0;
        const date = row.received_at || row.created_at;
        return `
          <div class="fridge-item">
            <span class="fridge-item-main">
              <span class="fridge-item-name">${escapeHtml(row.subject || '(제목 없음)')}</span>
              <span class="fridge-item-meta">
                <span>${escapeHtml(row.from_address || '')}</span>
                <span>${date ? new Date(date).toLocaleDateString('ko') : ''}</span>
                <span>${row.status === 'parsed' ? `+${count}개 입고` : row.status === 'skipped' ? '식료품 아님' : '실패'}</span>
              </span>
            </span>
          </div>
        `;
      }).join('')}
    `;
  } catch (err) {
    container.innerHTML = `<p class="section-note">최근 입고 조회 실패: ${escapeHtml(err.message || String(err))}</p>`;
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
