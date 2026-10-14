// Адрес опубликованной веб-версии (например, https://имя.github.io/lyricwave/).
// Нужен, чтобы настольная версия могла делать ссылки «поделиться плейлистом».
// Когда приложение само открыто по https-адресу, адрес определяется автоматически.
export const WEB_URL = 'https://rizobek.github.io/lyricwave/';

export function webUrl() {
  if (WEB_URL) return WEB_URL;
  if (location.protocol === 'https:') return location.origin + location.pathname;
  return '';
}
