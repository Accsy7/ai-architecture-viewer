const textValue = (value) => (typeof value === 'string' ? value.trim() : '');

export function resolveLocalizedConfigText(value, language, fallback = '') {
  if (typeof value === 'string') return textValue(value) || textValue(fallback);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return textValue(fallback);

  const preferredLanguage = language === 'en' ? 'en' : 'zh';
  const alternateLanguage = preferredLanguage === 'en' ? 'zh' : 'en';
  return textValue(value[preferredLanguage])
    || textValue(value[alternateLanguage])
    || textValue(fallback);
}
