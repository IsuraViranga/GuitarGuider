import { Link } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'

export function NotFoundPage() {
  usePageTitle('Page not found')
  return (
    <div className="page stack">
      <h1>Page not found</h1>
      <Link className="button" to="/">
        Go to the home page
      </Link>
    </div>
  )
}
