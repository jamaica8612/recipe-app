export function icon(name, size = 20) {
  const attrs = `width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const filled = `width="${size}" height="${size}" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"`;

  switch (name) {
    case 'home':
      return `<svg ${attrs}><path d="M3 9.5 10 3l7 6.5V17a1 1 0 0 1-1 1h-3v-5H9v5H4a1 1 0 0 1-1-1z"/></svg>`;
    case 'search':
      return `<svg ${attrs}><circle cx="9" cy="9" r="5"/><path d="m17 17-3.5-3.5"/></svg>`;
    case 'plus':
      return `<svg ${attrs}><path d="M10 4v12M4 10h12"/></svg>`;
    case 'play':
      return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5.5 3.8 16 10 5.5 16.2z"/></svg>`;
    case 'fridge':
      return `<svg ${attrs}><rect x="5" y="2.5" width="10" height="15" rx="1.5"/><path d="M5 8h10M7.5 5v1M7.5 10.5v3"/></svg>`;
    case 'settings':
      return `<svg ${attrs}><circle cx="10" cy="10" r="2.5"/><path d="M16.5 10c0-.6-.1-1.2-.2-1.7l1.4-1.1-1.6-2.8-1.7.5a6 6 0 0 0-3-1.7l-.4-1.8h-3l-.4 1.8a6 6 0 0 0-3 1.7l-1.7-.5-1.6 2.8 1.4 1.1c-.1.5-.2 1.1-.2 1.7s.1 1.2.2 1.7l-1.4 1.1 1.6 2.8 1.7-.5a6 6 0 0 0 3 1.7l.4 1.8h3l.4-1.8a6 6 0 0 0 3-1.7l1.7.5 1.6-2.8-1.4-1.1c.1-.5.2-1.1.2-1.7z"/></svg>`;
    case 'user':
      return `<svg ${attrs}><circle cx="10" cy="7" r="3"/><path d="M3.5 17a6.5 6.5 0 0 1 13 0"/></svg>`;
    case 'users':
      return `<svg ${attrs}><circle cx="7.5" cy="7" r="2.6"/><circle cx="14" cy="8" r="2"/><path d="M2.5 16c0-2.6 2.2-4.6 5-4.6s5 2 5 4.6"/><path d="M12 11.5c1.8 0 5 .9 5 4.5"/></svg>`;
    case 'star':
      return `<svg ${filled}><path d="M10 2.5 12.4 7.4l5.4.8-3.9 3.8.9 5.3L10 14.8 5.2 17.3l.9-5.3L2.2 8.2l5.4-.8z"/></svg>`;
    case 'tag':
      return `<svg ${attrs}><path d="M3.5 4.5v4.2L11.8 17l4.7-4.7-8.3-8.3z"/><circle cx="7" cy="7" r="1"/></svg>`;
    case 'cloud':
      return `<svg ${attrs}><path d="M5 14.5a3 3 0 0 1 .4-6 5 5 0 0 1 9.6 1.2A3 3 0 0 1 15 14.5z"/></svg>`;
    case 'chev-r':
      return `<svg ${attrs}><path d="m8 5 5 5-5 5"/></svg>`;
    case 'chev-l':
      return `<svg ${attrs}><path d="m12 5-5 5 5 5"/></svg>`;
    case 'external':
      return `<svg ${attrs}><path d="M8 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5V12"/><path d="M11 4h5v5M9 11l7-7"/></svg>`;
    case 'edit':
      return `<svg ${attrs}><path d="M4 14.5V17h2.5L15 8.5 12.5 6z"/><path d="m11.5 7 2.5 2.5"/></svg>`;
    case 'trash':
      return `<svg ${attrs}><path d="M4 6h12M8 6V4h4v2M6 6l.7 11h6.6L14 6M9 9v5M11 9v5"/></svg>`;
    case 'timer':
      return `<svg ${attrs}><circle cx="10" cy="11" r="6.5"/><path d="M10 11V8M8 2.5h4"/></svg>`;
    case 'pause':
      return `<svg ${filled}><rect x="5" y="3.5" width="4" height="13" rx="1"/><rect x="11" y="3.5" width="4" height="13" rx="1"/></svg>`;
    case 'check':
      return `<svg ${attrs}><path d="m4.5 10.5 3.5 3.5L16 6"/></svg>`;
    case 'book':
    default:
      return `<svg ${attrs}><path d="M4 4h11a2 2 0 0 1 2 2v11H6a2 2 0 0 1-2-2z"/><path d="M4 4v11a2 2 0 0 0 2 2"/></svg>`;
  }
}
