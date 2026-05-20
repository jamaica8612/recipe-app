import { html, raw } from '../util.js';
import { getState, addMember, deleteMember, updateMember } from '../store.js';
import { deleteMemberFromSupabase, syncMemberToSupabase } from '../api/syncSupabase.js';

const EMOJI_OPTIONS = ['👨', '👩', '👧', '👦', '👵', '👴', '🧑'];
const COLOR_OPTIONS = [
  { id: 'terra', name: '토마토' },
  { id: 'olive', name: '올리브' },
  { id: 'mustard', name: '머스터드' },
  { id: 'info', name: '블루' },
  { id: 'plum', name: '플럼' },
];

function recipeCount(memberId) {
  return getState().recipes.filter((recipe) => recipe.memberIds?.includes(memberId)).length;
}

export function renderMembers() {
  const { members } = getState();
  const list = members.map((member) => html`
    <li>
      <span class="avatar is-${member.color || 'terra'}">${member.emoji || '👤'}</span>
      <div class="name">
        ${member.name}
        <small>${recipeCount(member.id)}개 레시피</small>
      </div>
      <button class="icon-btn" data-action="delete-member" data-id="${member.id}" title="삭제">×</button>
      <button class="icon-btn" data-action="edit-member" data-id="${member.id}" title="수정">✎</button>
    </li>
  `).join('');

  const emojiOptions = EMOJI_OPTIONS.map((emoji) => html`
    <option value="${emoji}">${emoji}</option>
  `).join('');
  const colorOptions = COLOR_OPTIONS.map((color) => html`
    <option value="${color.id}">${color.name}</option>
  `).join('');

  return {
    header: html`
      <div class="title">구성원</div>
      <div style="width:36px"></div>
    `,
    body: html`
      <form id="member-form" class="member-form">
        <input type="hidden" name="editingId" />
        <div class="row">
          <label class="field member-name-field">
            <span class="field-label">이름</span>
            <input class="input" name="name" placeholder="예: 아빠" maxlength="12" required />
          </label>
          <label class="field member-emoji-field">
            <span class="field-label">이모지</span>
            <select class="select" name="emoji">${raw(emojiOptions)}</select>
          </label>
        </div>
        <label class="field">
          <span class="field-label">색상</span>
          <select class="select" name="color">${raw(colorOptions)}</select>
        </label>
        <button class="btn btn--primary btn--block" type="submit" id="member-submit">구성원 추가</button>
        <button class="btn btn--secondary btn--block" type="button" data-action="cancel-member-edit" hidden>수정 취소</button>
      </form>

      <ul class="member-list">
        ${raw(list)}
      </ul>
      <div class="field-help" id="member-sync-status"></div>
    `,
    flush: false,
    showNav: true,
    activeNav: 'members',
  };
}

export function bindMembers(rootEl) {
  const form = rootEl.querySelector('#member-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const editingId = String(data.get('editingId') || '');
    const name = String(data.get('name') || '').trim();
    if (!name) return;
    const payload = {
      name,
      emoji: String(data.get('emoji') || '👤'),
      color: String(data.get('color') || 'terra'),
    };
    const id = editingId || addMember(payload);
    if (editingId) updateMember(editingId, payload);
    const member = getState().members.find((item) => item.id === id);
    if (member) {
      setSyncStatus(rootEl, editingId ? '구성원 수정 중...' : '구성원 저장 중...');
      syncMemberToSupabase(member)
        .then((result) => {
          setSyncStatus(rootEl, result.skipped ? '로컬에 저장했습니다. 로그인하면 백업할 수 있어요.' : 'Supabase에 저장했습니다.');
        })
        .catch((err) => {
          console.warn('Supabase member sync failed', err);
          setSyncStatus(rootEl, '로컬에 저장했습니다. Supabase 저장은 계정 화면에서 다시 백업할 수 있어요.');
        });
    }
    resetMemberForm(rootEl);
  });

  rootEl.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'delete-member') {
      if (!confirm('이 구성원을 삭제할까요? 연결된 레시피 태그에서도 제거됩니다.')) return;
      const id = target.dataset.id;
      target.disabled = true;
      setSyncStatus(rootEl, '구성원 삭제 중...');
      try {
        await deleteMemberFromSupabase(id);
        setSyncStatus(rootEl, 'Supabase에서도 삭제했습니다.');
      } catch (err) {
        console.warn('Supabase member delete failed', err);
        setSyncStatus(rootEl, '로컬에서 삭제했습니다. Supabase는 계정 화면에서 다시 불러오기 전에 확인해 주세요.');
      } finally {
        deleteMember(id);
      }
    }
    if (target.dataset.action === 'edit-member') {
      const member = getState().members.find((item) => item.id === target.dataset.id);
      if (member) fillMemberForm(rootEl, member);
    }
    if (target.dataset.action === 'cancel-member-edit') {
      resetMemberForm(rootEl);
    }
  });
}

function setSyncStatus(rootEl, message) {
  const status = rootEl.querySelector('#member-sync-status');
  if (status) status.textContent = message;
}

function fillMemberForm(rootEl, member) {
  const form = rootEl.querySelector('#member-form');
  if (!form) return;
  form.editingId.value = member.id;
  form.name.value = member.name || '';
  form.emoji.value = member.emoji || '👤';
  form.color.value = member.color || 'terra';
  rootEl.querySelector('#member-submit').textContent = '구성원 수정';
  rootEl.querySelector('[data-action="cancel-member-edit"]').hidden = false;
  form.name.focus();
}

function resetMemberForm(rootEl) {
  const form = rootEl.querySelector('#member-form');
  if (!form) return;
  form.reset();
  form.editingId.value = '';
  rootEl.querySelector('#member-submit').textContent = '구성원 추가';
  rootEl.querySelector('[data-action="cancel-member-edit"]').hidden = true;
}
