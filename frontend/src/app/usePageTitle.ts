import { useEffect } from 'react'

export const APP_NAME = 'Guitar Practice'

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} – ${APP_NAME}` : APP_NAME
  }, [title])
}
