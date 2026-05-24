// 작은 헬퍼들

// 안전한 텍스트 — HTML 이스케이프
export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 태그드 템플릿 리터럴: html`...` — 보간되는 값은 자동 이스케이프됨
// 이미 안전한 HTML을 넣고 싶으면 { __html: '...' } 형태로 감싸면 그대로 출력
export function html(strings, ...values) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v == null || v === false) {
        // skip
      } else if (Array.isArray(v)) {
        out += v.join('');
      } else if (typeof v === 'object' && v.__html != null) {
        out += v.__html;
      } else {
        out += esc(v);
      }
    }
  }
  return out;
}

// 이미 안전한 HTML 문자열을 html``에서 그대로 쓰고 싶을 때
export function raw(s) {
  return { __html: s };
}

// 클래스 조합
export function cx(...args) {
  return args.filter(Boolean).join(' ');
}

// YouTube URL 또는 공유 텍스트 → videoId 추출
const YT_RE = /(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/;
export function extractVideoId(text) {
  if (!text) return null;
  const m = String(text).match(YT_RE);
  return m ? m[1] : null;
}

export function parseLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function formatDuration(min) {
  return `${min}분`;
}

export function formatTimestamp(sec) {
  const total = Number(sec) || 0;
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// YouTube 썸네일 URL
export function ytThumbnail(videoId) {
  if (!videoId || videoId.startsWith('fake-')) return null;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
