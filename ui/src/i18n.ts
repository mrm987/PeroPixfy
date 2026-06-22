import { useUi, type Lang } from './stores/ui'
import { ko } from './i18n.ko'

// gettext 방식: 영문 문자열 자체가 키. ko 맵에 없으면 영문 그대로(graceful fallback).
// {name} 형태 플레이스홀더 보간 지원.
const MAPS: Record<Lang, Record<string, string>> = { en: {}, ko }

function fmt(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}

export function translate(lang: Lang, s: string, vars?: Record<string, string | number>): string {
  return fmt(MAPS[lang]?.[s] ?? s, vars)
}

/** 컴포넌트용 훅 — 언어 변경 시 자동 리렌더. `const t = useT()` 후 `t('Generate')`. */
export function useT() {
  const lang = useUi((st) => st.lang)
  return (s: string, vars?: Record<string, string | number>) => translate(lang, s, vars)
}

/** 비-컴포넌트(이벤트 핸들러/스토어의 confirm·alert)용 — 호출 시점 언어로 1회 번역. */
export function tr(s: string, vars?: Record<string, string | number>): string {
  return translate(useUi.getState().lang, s, vars)
}
