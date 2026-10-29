import type { RouteObject } from 'react-router-dom'
import { AuthPage } from '../pages/AuthPage'
import { DatasetPage } from '../pages/DatasetPage'
import { ForgotPasswordPage, ResetPasswordPage } from '../pages/PasswordResetPages'
import { EditSongPage } from '../pages/EditSongPage'
import { GuitarSetupPage } from '../pages/GuitarSetupPage'
import { HomePage } from '../pages/HomePage'
import { ImportPage } from '../pages/ImportPage'
import { LibraryPage } from '../pages/LibraryPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { PracticePage } from '../pages/PracticePage'
import { ProgressPage } from '../pages/ProgressPage'
import { SongDetailPage } from '../pages/SongDetailPage'
import { ApproveWithChangesPage, ReviewRequestPage } from '../pages/ShareRequests'
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
      { path: '/requests/:requestId', element: <ReviewRequestPage /> },
      { path: '/requests/:requestId/edit', element: <ApproveWithChangesPage /> },
      { path: '/import', element: <ImportPage /> },
      { path: '/progress', element: <ProgressPage /> },
      { path: '/guitar-setup', element: <GuitarSetupPage /> },
      { path: '/admin/dataset', element: <DatasetPage /> },
      { path: '/signin', element: <AuthPage mode="signin" /> },
      { path: '/signup', element: <AuthPage mode="signup" /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
