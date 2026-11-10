import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import { trySilentSignIn } from '@/features/auth/lib/accessTokenProvider';
import { useAuthStore } from '@/stores/authStore';

export const GuestRoute = () => {
  const player = useAuthStore((state) => state.player);

  useEffect(() => {
    void trySilentSignIn();
  }, []);

  if (player) {
    return <Navigate to={ROUTES.projects} replace />;
  }

  return <Outlet />;
};
