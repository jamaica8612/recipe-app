import { esc, formatTimestamp, ytThumbnail } from '../util.js';
import { icon } from '../icons.js';

const SHARED_ENDPOINT = 'https://xrrdokcjhjqdfvwtbenl.supabase.co/functions/v1/get-shared-recipe';
const PUBLISHABLE_KEY = 'sb_publishable_prnLDb7bcWORu7wrqTRsXQ_NWJL8Jnk';

export async function renderSharedView(code, appEl) {
  appEl.className = 'app-shell no-nav';
  appEl.innerHTML = `
    <div class="app-content">
      <main class="app-body">
        <div class="loading-screen">
          <div class="loading-dots">●●●</div>
          <div class="loading-msg">레시피 불러오는 중…</div>
        </div>
      </main>
    </div>
  `;

  let data;
  try {
    const res = await fetch(`${SHARED_ENDPOINT}?code=${encodeURIComponent(code)}`, {
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${PUBLISHABLE_KEY}`,
      },
    });
    data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      showSharedError(appEl, data?.error === 'not_found');
      return;
    }
  } catch {
    showSharedError(appEl, false);
    return;
  }

  const recipe = data.recipe;
  const thumb = recipe.videoId ? ytThumbnail(recipe.videoId) : null;
  const thumbStyle = thumb ? `background-image:url('${thumb}')` : '';
  const ytUrl = recipe.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(recipe.videoId)}` : '';

  const ingredients = (recipe.ingredients || []).map((item) => {
    const amount = [String(item.amount || ''), item.unit || ''].filter(Boolean).join('');
    const label = [item.name, amount].filter(Boolean).join(' ');
    return `<span class="ingredient-pill"><span>${esc(label)}</span></span>`;
  }).join('');

  const steps = (recipe.steps || []).map((step, index) => `
    <div class="cook-step">
      <span class="cook-step-box"></span>
      <span class="cook-step-main">
        <span class="cook-step-text"><strong>${step.order || index + 1}.</strong> ${esc(step.text)}</span>
        ${step.timestampSec ? `<span class="cook-step-time">${formatTimestamp(step.timestampSec)}</span>` : ''}
      </span>
    </div>
  `).join('');

  const tips = (recipe.tips || []).map((tip) => `<li>${esc(tip)}</li>`).join('');

  appEl.className = 'app-shell no-nav';
  appEl.innerHTML = `
    <div class="app-content">
      <main class="app-body is-flush">
        <article class="recipe-detail-card v2-detail-card">
          <div class="recipe-cover v2-cover ${thumb ? '' : 'no-thumb'}" style="${thumbStyle}">
            <div class="detail-overlay detail-overlay-left">
              <div class="shared-badge">${icon('share', 14)} 공유된 레시피</div>
            </div>
            <div class="detail-overlay detail-overlay-right">
              ${ytUrl ? `<a class="detail-video-btn" href="${esc(ytUrl)}" target="_blank" rel="noreferrer">${icon('external', 14)} 원본</a>` : ''}
            </div>
          </div>
          <div class="recipe-detail-head">
            <div class="detail-kicker">
              <span class="detail-dot"></span>
              <span>${esc(recipe.categoryIcon || '')} ${esc(recipe.categoryName || '기타')}</span>
              ${recipe.channelName ? `<span class="detail-sep">·</span><span>${esc(recipe.channelName)}</span>` : ''}
            </div>
            <h1>${esc(recipe.title)}</h1>
            <div class="detail-pills">
              ${ytUrl ? `<a href="${esc(ytUrl)}" target="_blank" rel="noreferrer">${icon('play', 13)} 원본 영상 보기</a>` : ''}
              <span>${recipe.cookTimeMin || 0}분</span>
              <span>${recipe.servings || 1}인분</span>
            </div>
          </div>
          <section class="detail-section detail-section--soft">
            <h3>재료 <small style="font-weight:400;color:var(--text-muted)">${recipe.servings || 1}인분 기준</small></h3>
            <div class="ingredient-pills">${ingredients}</div>
          </section>
          <section class="detail-section">
            <h3>조리 순서</h3>
            <div class="cook-steps">${steps}</div>
          </section>
          ${tips ? `<section class="detail-section"><h3>Tip</h3><ul class="tip-list">${tips}</ul></section>` : ''}
          <section class="detail-section detail-actions">
            <div class="shared-cta">
              <p class="shared-cta-msg">가족 레시피 앱에서 이 레시피를 저장할 수 있어요.</p>
              <a class="btn btn--primary btn--lg btn--block" href="#/account">앱에서 시작하기</a>
            </div>
          </section>
        </article>
      </main>
    </div>
  `;
}

function showSharedError(appEl, isNotFound) {
  const msg = isNotFound
    ? '링크가 만료됐거나 존재하지 않아요.'
    : '레시피를 불러오지 못했어요. 네트워크를 확인해주세요.';

  appEl.className = 'app-shell no-nav';
  appEl.innerHTML = `
    <div class="app-content">
      <main class="app-body">
        <div class="empty">
          <span class="emo">🔗</span>
          <div class="ttl">${esc(msg)}</div>
          <a class="btn btn--primary" href="#/account" style="margin-top:16px">앱으로 가기</a>
        </div>
      </main>
    </div>
  `;
}
