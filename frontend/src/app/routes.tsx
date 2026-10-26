import type { RouteObject } from 'react-router-dom'
import { AuthPage } from '../pages/AuthPage'
import { EditSongPage } from '../pages/EditSongPage'
import { HomePage } from '../pages/HomePage'
import { ImportPage } from '../pages/ImportPage'
import { LibraryPage } from '../pages/LibraryPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { PracticePage } from '../pages/PracticePage'
import { SongDetailPage } from '../pages/SongDetailPage'
import { Layout } from './Layout'

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/songs', element: <LibraryPage /> },
      { path: '/songs/:songId', element: <SongDetailPage /> },
      { path: '/songs/:songId/practice', element: <PracticePage /> },
      { path: '/songs/:songId/edit', element: <EditSongPage /> },
      { path: '/import', element: <ImportPage /> },
      { path: '/signin', element: <AuthPage mode="signin" /> },
      { path: '/signup', element: <AuthPage mode="signup" /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
