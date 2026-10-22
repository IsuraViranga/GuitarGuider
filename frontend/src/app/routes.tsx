import type { RouteObject } from 'react-router-dom'
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
      { path: '/import', element: <ImportPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
