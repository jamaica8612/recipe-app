// 냉장고 — v1.2 계획 기능. 지금은 placeholder + 곧 나올 기능 안내.
import { html } from '../util.js';

export function renderFridge() {
  return {
    header: html`
      <div class="title">🧊 <span>냉장고</span></div>
      <div style="width:36px"></div>
    `,
    body: html`
      <div class="empty">
        <span class="emo">🧊</span>
        <div class="ttl">곧 나옵니다</div>
        <div style="margin-top:8px;">가지고 있는 재료를 등록하면<br>만들 수 있는 레시피를 추천해드려요.</div>
      </div>
      <div class="callout" style="margin-top:24px;">
        <span class="icon">📝</span>
        <div>
          <strong>v1.2에서 추가될 기능</strong><br>
          • 재료 체크리스트 (유통기한 알림)<br>
          • "오늘 뭐 만들어?" 추천<br>
          • 장보기 자동 합산
        </div>
      </div>
    `,
    flush: false,
    showNav: true,
    activeNav: 'fridge',
  };
}

export function bindFridge() {
  // 아직 인터랙션 없음
}
