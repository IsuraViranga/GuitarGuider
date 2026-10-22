import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { APP_NAME } from './usePageTitle'

export function Layout() {
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const isFirstRender = useRef(true)

  // After navigating, move focus to the new page's heading so screen-reader users
  // hear where they are (single-page apps don't do this on their own).
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const heading = mainRef.current?.querySelector('h1')
    if (heading) {
      heading.setAttribute('tabindex', '-1')
      heading.focus()
    }
  }, [location.pathname])

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="site-title">
            🎸 {APP_NAME}
          </Link>
          <nav className="site-nav" aria-label="Main">
            <ul>
              <li>
                <NavLink to="/songs">Songs</NavLink>
              </li>
              <li>
                <NavLink to="/import">Import</NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
    </>
  )
}
